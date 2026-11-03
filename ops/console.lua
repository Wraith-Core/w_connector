-- The imported console has no authority of its own. Every request crosses the signed website
-- boundary; a queued result is accepted only for a request this connection actually issued.
WC.Console = { sessions = {}, issued = {}, handlers = {}, clientPending = {}, refreshHooks = {} }
local C = WC.Console
local LEASE, REFRESH, TIMEOUT = 45000, 15000, 18000
local rates, opening, modes = {}, {}, {}
local contract = json.decode(LoadResourceFile(GetCurrentResourceName(), 'core/console_contract.json') or '{}')
C.contract = contract
local function now() return GetGameTimer() end
local MODE_FLAGS = {
    ['self.noclip'] = { 'fly', 'move', 'invisible', 'godmode' },
    ['self.invisible'] = { 'invisible' }, ['self.godmode'] = { 'godmode' },
    ['self.boost'] = { 'move' }, ['player.spectate'] = { 'move', 'invisible', 'godmode' },
}
function C.allowMode(name, src)
    if not WC.started('w_guard') then return true end
    for _, flag in ipairs(MODE_FLAGS[name] or {}) do
        local ok, accepted = pcall(function() return exports.w_guard:AllowFlag(src, flag, 3) end)
        if not ok or accepted ~= true then return false end
    end
    return true
end
local function nonce()
    return ('%08x%08x%08x%08x'):format(math.random(0, 0xffffffff), math.random(0, 0xffffffff), math.random(0, 0xffffffff), math.random(0, 0xffffffff))
end
local function identity(src)
    if not WC.onlineSource(src) then return nil end
    local ids = WC.identifiers(src)
    if not (ids.license or ids.license2) then return nil end
    local fw, cid = WC.Adapters.get('framework'), ''
    if fw then local ok, p = pcall(fw.player, src); if ok and p then cid = tostring(p.charId or '') end end
    return table.concat({ ids.license or ids.license2, ids.discord or '', cid }, '|')
end
C.identity = identity
function C.valid(s)
    return s and C.sessions[s.source] == s and WC.linked() and now() >= s.at and now() - s.at < LEASE and identity(s.source) == s.identity
end
local function who(src) return { source = src, name = GetPlayerName(src), identifiers = WC.identifiers(src) } end
function C.define(name, available, fn)
    assert(contract[name], 'console action has no website policy: ' .. name)
    assert(not C.handlers[name], 'duplicate console action: ' .. name)
    C.handlers[name] = { available = available, run = fn }
end
function C.available(name, src)
    local h = C.handlers[name]
    if not h then return false end
    if not h.available then return true end
    local ok, value, reason = pcall(h.available, src)
    return ok and value == true, reason
end
local WEB = { ['query.bans'] = true, ['bans.unban'] = true, ['logs.query'] = true }
for _, kind in ipairs({ 'ranks', 'reports' }) do
    for name in pairs(contract) do if name:sub(1, #kind + 1) == kind .. '.' then WEB[name] = true end end
end
local function package(s)
    local actions, unavailable, areas, actionAreas = {}, {}, { perms = true }, {}
    for name in pairs(s.allowed) do
        local capable, reason = C.available(name, s.source)
        if WEB[name] or capable then
            actions[#actions + 1] = name
            local d = contract[name]
            if d then
                -- Read-only identity/catalog queries must not grant any action area.
                if name ~= 'query.self' and name ~= 'query.catalog' then areas[d.area] = true end
                local kind, action = name:match('^(%a+)%.(.+)$')
                actionAreas[kind] = actionAreas[kind] or {}; actionAreas[kind][action] = d.area
            end
        else unavailable[name] = reason or 'capability_missing' end
    end
    table.sort(actions)
    return { ok = true, nonce = s.nonce, role = s.role, customRoles = s.customRoles, actions = actions, unavailable = unavailable, perms = areas,
        actionAreas = actionAreas, permissions = s.permissions, accessRev = s.accessRev, self = s.source, game = WC.gameName(),
        serverName = GetConvar('sv_projectName', GetConvar('sv_hostname', 'Wraith')), lease = math.max(0, LEASE - (now() - s.at)) }
end
local function retire(s, reason)
    if not s then return end
    if C.sessions[s.source] == s then C.sessions[s.source] = nil end
    modes[s.source] = nil
    for t, issue in pairs(C.issued) do
        if issue.session == s then
            C.issued[t] = nil
            local w = WC.Menu.pending[t]
            if w then WC.Menu.pending[t] = nil; w.p:resolve({ ok = false, error = reason or 'no_session' }) end
        end
    end
    for t, w in pairs(C.clientPending) do
        if w.session == s then C.clientPending[t] = nil; w.promise:resolve({ ok = false, error = 'no_session' }) end
    end
    TriggerClientEvent('w_connector:console:revoked', s.source, reason or 'no_session')
end
C.retire = retire
-- 2.3.1: the permissions page (web/src/pages/perms) shows the admin's access the way the website models it.
-- Everything below is display data, checked for shape and size; authority stays in s.allowed and the website.
local function stringList(list, max, len)
    local out = {}
    if type(list) ~= 'table' then return out end
    for _, v in ipairs(list) do
        if type(v) == 'string' and #v <= len and #out < max then out[#out + 1] = v end
    end
    return out
end
local function texts(v, len)
    if type(v) ~= 'table' or type(v.ar) ~= 'string' or type(v.en) ~= 'string' or #v.ar > len or #v.en > len then return nil end
    return { ar = v.ar, en = v.en }
end
-- The website's permission names { tag, list }: one copy for the resource, sent again only when its tag changes.
C.webCatalog = nil
local function keepWebCatalog(body)
    local tag = body.permissionCatalogTag
    if type(tag) ~= 'string' or #tag > 64 or not tag:match('^[%w_%-]+$') or type(body.permissionCatalog) ~= 'table' then return end
    local list = {}
    for _, p in ipairs(body.permissionCatalog) do
        if type(p) == 'table' and type(p.id) == 'string' and p.id:match('^[a-z]+%.[a-z]+$') and #list < 128 then
            local label, description = texts(p.label, 300), texts(p.description, 900)
            if label and description then list[#list + 1] = { id = p.id, label = label, description = description, ownerOnly = p.ownerOnly == true or nil } end
        end
    end
    C.webCatalog = { tag = tag, list = list }
end
local function keepAccess(s, body)
    s.roleSources = {}
    for _, r in ipairs(type(body.customRoleSources) == 'table' and body.customRoleSources or {}) do
        if type(r) == 'table' and type(r.name) == 'string' and #r.name <= 120 and #s.roleSources < 16 then
            s.roleSources[#s.roleSources + 1] = { name = r.name, direct = r.direct == true, discord = r.discord == true }
        end
    end
    -- nil from an older website: C.access then reads what core/script_permissions.lua applies
    s.scriptPermissions = type(body.scriptPermissions) == 'table' and stringList(body.scriptPermissions, 1024, 146) or nil
    local m = body.manage
    s.manage = type(m) == 'table' and type(m.url) == 'string' and #m.url <= 200 and m.url:match('^https?://[%w%.%-:%[%]]+/[%w/_%-]*$')
        and { url = m.url, where = texts(m.where, 300) } or nil
    keepWebCatalog(body)
    local roles = {}
    for _, r in ipairs(s.roleSources) do roles[#roles + 1] = r.name .. (r.direct and '+' or '') .. (r.discord and '@' or '') end
    local key = table.concat({ tostring(s.role), table.concat(s.customRoles, ','), table.concat(roles, ','), table.concat(stringList(s.permissions, 128, 64), ','),
        s.scriptPermissions and table.concat(s.scriptPermissions, ',') or '-', C.webCatalog and C.webCatalog.tag or '', s.manage and s.manage.url or '' }, '|')
    if key ~= s.accessKey then s.accessKey, s.accessRev = key, (s.accessRev or 0) + 1 end
end
--- The permissions page's data: this session's own role, custom roles and website permissions (with the
--- website's names), and its script permissions with this server's catalogue names. Read only.
function C.access(s)
    local held, from = s.scriptPermissions, 'website'
    if not held then
        held, from = {}, 'server'
        local p = WC.ScriptPermissions and WC.ScriptPermissions.sessions[s.source]
        for id in pairs(p and p.grants or {}) do held[#held + 1] = id end
        table.sort(held)
    end
    local roles = s.roleSources or {}
    if #roles == 0 and #s.customRoles > 0 then -- an older website sends the names only
        roles = {}; for _, name in ipairs(s.customRoles) do roles[#roles + 1] = { name = name } end
    end
    local built, catalog = pcall(WC.ScriptCatalog.build)
    return { rev = s.accessRev or 0, role = type(s.role) == 'string' and s.role or nil, roles = roles,
        web = { held = stringList(s.permissions, 128, 64), catalog = C.webCatalog and C.webCatalog.list or nil },
        scripts = { held = held, from = from, groups = built and type(catalog) == 'table' and catalog.groups or {} },
        manage = s.manage }
end
local function refresh(src, old)
    if opening[src] then return nil, 'busy' end
    local bound, at = identity(src), now()
    if not bound or not WC.linked() then return nil, 'offline' end
    local lock = {}; opening[src] = lock
    local ask = who(src)
    ask.catalogTag = C.webCatalog and C.webCatalog.tag or nil -- 2.3.1: the website omits names we already hold
    local status, body = WC.request('POST', '/ingame/console/session', ask, 10000)
    if opening[src] ~= lock then return nil, 'no_session' end
    opening[src] = nil
    if identity(src) ~= bound or now() - at >= LEASE or (old and C.sessions[src] ~= old) then return nil, 'no_session' end
    if status ~= 200 or type(body) ~= 'table' or not body.ok or type(body.actions) ~= 'table' then
        retire(old, 'no_access')
        -- 2.2.2: a refusal also takes back his chat suggestions (ops/native_commands.lua)
        if status == 403 then for _, fn in ipairs(C.refreshHooks) do pcall(fn, src, nil) end end
        return nil, type(body) == 'table' and body.error or 'offline'
    end
    local s = old or { source = src, identity = bound, nonce = nonce() }
    s.allowed, s.at, s.refreshAt, s.role, s.permissions = {}, at, now(), body.role, body.permissions or {}
    s.customRoles = {}
    for _, name in ipairs(type(body.customRoles) == 'table' and body.customRoles or {}) do
        if type(name) == 'string' and #s.customRoles < 16 then s.customRoles[#s.customRoles + 1] = name:sub(1, 120) end
    end
    for _, name in ipairs(body.actions) do if contract[name] then s.allowed[name] = true end end
    keepAccess(s, body) -- 2.3.1
    C.sessions[src] = s
    -- Modes use their exact action, not a broad area; a revoked mode stops on the next watchdog tick.
    for name in pairs(modes[src] or {}) do if not s.allowed[name] then modes[src][name] = nil end end
    TriggerClientEvent('w_connector:console:permissions', src, package(s))
    for _, fn in ipairs(C.refreshHooks) do pcall(fn, src, s) end -- 2.2.2: ops/native_commands.lua (chat suggestions)
    return s
end
local function limited(src)
    local r, t = rates[src], now()
    if not r or t < r.at or t - r.at >= 5000 then r = { at = t, n = 0 }; rates[src] = r end
    r.n = r.n + 1; return r.n > 32
end
local function targetOf(src, data)
    if data.citizenid then
        local input = tostring(data.citizenid):match('^%s*(.-)%s*$')
        for n, digit in ipairs({ '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩' }) do input = input:gsub(digit, tostring(n - 1)) end
        for n, digit in ipairs({ '۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹' }) do input = input:gsub(digit, tostring(n - 1)) end
        if input:lower() == 'me' then return src end
        local server = input:match('^#%s*(%d+)$')
        if server then return WC.onlineSource(tonumber(server)) end
        if input:match('^%d+$') then input = input:gsub('^0+', '') end
        if input:match('^%a%a%a%d%d%d%d%d$') then input = input:upper() end
        for _, id in ipairs(GetPlayers()) do
            local n = tonumber(id); local fw = WC.Adapters.get('framework')
            local p = fw and fw.player(n)
            if p and tostring(p.charId) == input then return n end
        end
        return nil
    end
    return WC.onlineSource(data.id)
end
local function bounded(v, depth, budget)
    if depth > 7 then return false end
    local typ = type(v)
    if typ == 'nil' or typ == 'boolean' then return true end
    if typ == 'number' then return v == v and math.abs(v) < 1e12 end
    if typ == 'string' then budget.n = budget.n + #v; return #v <= 16000 and budget.n <= 64000 end
    if typ ~= 'table' then return false end
    for k, x in pairs(v) do
        budget.keys = budget.keys + 1
        if budget.keys > 1800 or not (type(k) == 'string' and #k <= 200 or type(k) == 'number' and k > 0 and k <= 1024 and k % 1 == 0) then return false end
        if not bounded(x, depth + 1, budget) then return false end
    end
    return true
end
RegisterNetEvent('w_connector:console:open', function()
    local src = source
    if not WC.onlineSource(src) or limited(src) then return end
    local s = C.sessions[src]
    if C.valid(s) and now() - s.refreshAt < 2000 then s.uiOpen = true; TriggerClientEvent('w_connector:console:session', src, package(s)); return end
    CreateThread(function()
        local fresh, err = refresh(src, s)
        if fresh then fresh.uiOpen = true end
        TriggerClientEvent('w_connector:console:session', src, fresh and package(fresh) or { ok = false, error = err })
    end)
end)
local function reply(src, id, result, sessionNonce) TriggerClientEvent('w_connector:console:result', src, id, result, sessionNonce) end
local LOCAL_READS = { ['query.players'] = true, ['query.server'] = true, ['query.resources'] = true,
    ['query.catalog'] = true, ['query.self'] = true, ['query.map'] = true, ['query.hud'] = true,
    ['citizen.lookup'] = true, ['map.players'] = true }
RegisterNetEvent('w_connector:console:request', function(id, name, data, sessionNonce)
    local src = source
    local function answer(result) reply(src, id, result, sessionNonce) end
    if type(id) ~= 'number' or id % 1 ~= 0 or id < 1 or id > 1e9 then return end
    if type(name) ~= 'string' or not contract[name] or type(data) ~= 'table' or not bounded(data, 0, { n = 0, keys = 0 }) then
        answer({ ok = false, error = 'invalid_args' }); return
    end
    if limited(src) then answer({ ok = false, error = 'rate_limited' }); return end
    local s = C.sessions[src]
    if not C.valid(s) or sessionNonce ~= s.nonce then retire(s); answer({ ok = false, error = 'no_session' }); return end
    if not s.allowed[name] then answer({ ok = false, error = 'no_permission' }); return end
    if not WEB[name] and not C.available(name, src) then answer({ ok = false, error = 'capability_missing' }); return end
    -- Read the live server through the bounded website lease. This avoids a website round trip and
    -- queue poll for each player-list refresh. Every mutation still gets a fresh website decision.
    if LOCAL_READS[name] then
        CreateThread(function()
            local ctx = { source = src, session = s, valid = function() return C.valid(s) and s.allowed[name] end }
            local called, ok, result = pcall(C.handlers[name].run, data, ctx)
            if not ctx.valid() then return end
            answer({ ok = called and ok == true, data = called and ok and result or nil,
                error = not called and 'failed' or not ok and result or nil })
        end)
        return
    end
    CreateThread(function() C.dispatch(src, s, name, data, answer) end)
end)
-- One checked request on its way to the website: target bound, ticket issued, signed POST, the
-- queued result awaited. The page's request above and a chat command (C.runAs) both end here.
-- Runs inside a thread; `answer` is called exactly once.
function C.dispatch(src, s, name, data, answer)
    local target, targetIdentity
    -- 2.2.2: /reportr names the reporter, not the report; the website finds his open report
    local reportTarget = name == 'reports.message' and (data.citizenid ~= nil or data.id ~= nil)
    if name:sub(1, 7) == 'player.' or name == 'map.teleport' or name == 'hud.setNeed' or reportTarget then
        local selector = data
        if name == 'map.teleport' then selector = { id = data.target == 'self' and src or data.target or src, citizenid = data.citizenid } end
        local found, resolved = pcall(targetOf, src, selector)
        target = found and resolved or nil; targetIdentity = target and identity(target)
        if not targetIdentity then answer({ ok = false, error = 'player_offline' }); return end
        if name == 'map.teleport' then data.target, data.citizenid = target, nil
        else data.id, data.citizenid = target, nil end
    end
    local t = nonce()
    local issue = { session = s, name = name, target = target, targetIdentity = targetIdentity, at = now() }
    C.issued[t] = issue
    local w = { src = src, p = promise.new() }; WC.Menu.pending[t] = w
    local body = who(src)
    body.consoleAction, body.data, body.ticket, body.session, body.targetSource = name, data, t, s.nonce, target
    if target then body.targetIdentity = { source = target, name = GetPlayerName(target), identifiers = WC.identifiers(target), charId = WC.playerView(target).charId } end
    -- 2.2.2: staff.chat too: the website picks who among the players online may read it
    if name:sub(1, 6) == 'ranks.' or name == 'staff.chat' then
        body.subjects = {}
        for _, id in ipairs(GetPlayers()) do
            local n = tonumber(id)
            body.subjects[#body.subjects + 1] = { source = n, name = GetPlayerName(n), charId = WC.playerView(n).charId, discord = WC.identifiers(n).discord }
        end
    end
    local status, res = WC.request('POST', '/ingame/console', body, 8000)
    if not C.valid(s) then C.issued[t], WC.Menu.pending[t] = nil, nil; answer({ ok = false, error = 'no_session' }); return end
    if status ~= 200 or type(res) ~= 'table' or not res.ok or not res.queued then
        C.issued[t], WC.Menu.pending[t] = nil, nil
        if status == 403 then retire(s, 'no_access') end
        answer(type(res) == 'table' and res or { ok = false, error = 'offline' }); return
    end
    if WC.Menu.pending[t] then SetTimeout(math.max(1, TIMEOUT - (now() - issue.at)), function()
        if WC.Menu.pending[t] == w then WC.Menu.pending[t] = nil; C.issued[t] = nil; w.p:resolve({ ok = false, error = 'timeout' }) end
    end) end
    local result = Citizen.Await(w.p)
    if name == 'player.ban' and type(res.banId) == 'number' then
        result = { ok = true, data = { banId = res.banId, kicked = result.ok == true } }
    end
    -- 2.2.2: like a ban, the warning is already stored; the live part (shown to him, the kick) may still fail
    if name == 'player.warn' and type(res.warningId) == 'number' then
        local live = result.ok == true and type(result.data) == 'table' and result.data or {}
        result = { ok = true, data = { warningId = res.warningId, count = tonumber(res.count), delivered = result.ok == true, kicked = live.kicked == true } }
    end
    answer(result)
end
-- 2.2.2: a chat command (ops/native_commands.lua) runs one console action as the admin who typed it:
-- the same lease (renewed by the website when older than 2 s), the same allowed list, availability,
-- target binding, ticket and signed request as the page. There is no other way in. Call it from a thread.
---@return table result { ok, data?, error? } as the page gets it
function C.runAs(src, name, data)
    if not WC.onlineSource(src) then return { ok = false, error = 'player_offline' } end
    if type(name) ~= 'string' or not contract[name] or not (WEB[name] or C.handlers[name]) or type(data) ~= 'table'
        or not bounded(data, 0, { n = 0, keys = 0 }) then return { ok = false, error = 'invalid_args' } end
    if limited(src) then return { ok = false, error = 'rate_limited' } end
    local s = C.sessions[src]
    -- a character change (or a reused server id) ends the old lease; never renew it in place
    if s and s.identity ~= identity(src) then retire(s, 'no_session'); s = nil end
    if C.valid(s) and now() - s.refreshAt < 2000 then
        TriggerClientEvent('w_connector:console:permissions', src, package(s))
    else
        local err
        s, err = refresh(src, s)
        if not s then return { ok = false, error = err or 'no_session' } end
    end
    if not C.valid(s) then return { ok = false, error = 'no_session' } end
    if not s.allowed[name] then return { ok = false, error = 'no_permission' } end
    if not WEB[name] then
        local capable, reason = C.available(name, src)
        if not capable then return { ok = false, error = 'capability_missing', data = { reason = reason } } end
    end
    local out
    C.dispatch(src, s, name, data, function(result) out = result end)
    return type(out) == 'table' and out or { ok = false, error = 'failed' }
end
WC.Ops.define('console.run', nil, function(args)
    local issue = C.issued[args.request]
    if not issue then return false, 'no_request' end
    C.issued[args.request] = nil -- consume before any export or await; a replay cannot run it twice
    local s = issue.session
    if not C.valid(s) or s.source ~= args.source or s.nonce ~= args.session or issue.name ~= args.name
        or not s.allowed[args.name] or now() - issue.at >= TIMEOUT then return false, 'no_session' end
    if issue.target and identity(issue.target) ~= issue.targetIdentity then return false, 'target_changed' end
    if not C.available(args.name, s.source) then return false, 'capability_missing' end
    local context = { source = s.source, session = s, target = issue.target, targetIdentity = issue.targetIdentity }
    if issue.target and type(args.data) == 'table' then
        if args.name == 'map.teleport' then args.data.target, args.data.citizenid = issue.target, nil
        else args.data.id, args.data.citizenid = issue.target, nil end
    end
    function context.valid()
        return C.valid(s) and s.allowed[args.name] and (not issue.target or identity(issue.target) == issue.targetIdentity)
    end
    local ok, result, detail = C.handlers[args.name].run(type(args.data) == 'table' and args.data or {}, context)
    if not ok and type(detail) == 'table' then
        local waiter = WC.Menu.pending[args.request]
        if waiter then WC.Menu.pending[args.request] = nil; waiter.p:resolve({ ok = false, error = result, data = detail }) end
    end
    if not ok then result = type(result) == 'string' and result or 'failed' end
    return ok, result
end)
function C.client(name, args, ctx)
    if not ctx.valid() then return false, 'no_session' end
    local t, p = nonce(), promise.new()
    local w = { session = ctx.session, source = ctx.source, promise = p, ctx = ctx, name = name }
    C.clientPending[t] = w
    TriggerClientEvent('w_connector:console:execute', ctx.source, t, name, args, ctx.target)
    SetTimeout(10000, function() if C.clientPending[t] == w then C.clientPending[t] = nil; p:resolve({ ok = false, error = 'timeout' }) end end)
    local result = Citizen.Await(p)
    if not ctx.valid() then return false, 'no_session' end
    return result.ok == true, result.ok and result.data or result.error
end
RegisterNetEvent('w_connector:console:executed', function(t, result)
    local src, w = source, C.clientPending[t]
    if not w or w.source ~= src or type(result) ~= 'table' or not w.ctx.valid() then return end
    C.clientPending[t] = nil
    local on = result.ok == true and result.active == true
    modes[src] = modes[src] or {}
    modes[src][w.name] = on and { target = w.ctx.target, identity = w.ctx.targetIdentity } or nil
    w.promise:resolve({ ok = result.ok == true, data = type(result.data) == 'table' and result.data or nil,
        error = type(result.error) == 'string' and result.error:sub(1, 80) or 'failed' })
end)
RegisterNetEvent('w_connector:console:modeOff', function(name)
    local src = source
    if type(name) == 'string' and modes[src] then modes[src][name] = nil end
end)
RegisterNetEvent('w_connector:console:closed', function()
    local s = C.sessions[source]
    if s then s.uiOpen = false end
end)
-- 2.3.1: the permissions page asks when it opens, and again when accessRev changes (client/cl_console.lua)
RegisterNetEvent('w_connector:console:access', function(sessionNonce)
    local src = source
    if not WC.onlineSource(src) or limited(src) then return end
    local s = C.sessions[src]
    if not C.valid(s) or sessionNonce ~= s.nonce then return end
    TriggerClientEvent('w_connector:console:access', src, C.access(s), s.nonce)
end)
function C.watchdog()
        for src, s in pairs(C.sessions) do
            if not C.valid(s) then retire(s, 'session_expired')
            else
                if (s.uiOpen or next(modes[src] or {})) and now() - s.refreshAt >= REFRESH and not opening[src] then CreateThread(function() refresh(src, s) end) end
                    for name, mode in pairs(modes[src] or {}) do
                        if mode.target and identity(mode.target) ~= mode.identity then
                            modes[src][name] = nil
                            TriggerClientEvent('w_connector:console:stopMode', src, name)
                        end
                        if modes[src][name] and s.allowed[name] and not C.allowMode(name, src) then
                            modes[src][name] = nil
                            TriggerClientEvent('w_connector:console:stopMode', src, name)
                        end
                    end
            end
        end
end
CreateThread(function() while true do Wait(1000); C.watchdog() end end)
AddEventHandler('playerDropped', function()
    local src = source
    retire(C.sessions[src]); rates[src], opening[src], modes[src] = nil, nil, nil
end)
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    for _, s in pairs(C.sessions) do retire(s, 'resource_stopped') end
end)
