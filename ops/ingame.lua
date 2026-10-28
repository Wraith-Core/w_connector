--- The in-game Wraith menu, server half (docs/admin-platform/08-ingame-menu.md).
---
--- The client (client/cl_menu.lua) only ever names an action and its arguments. Who the player is comes
--- from FXServer here (`source`, GetPlayerName, GetPlayerIdentifier); what they may do comes from the
--- website (/ingame/session, the web panel's own roles), and every action is authorised again, audited and
--- run by the website (/ingame/act) through the same ops the panel uses. Nothing a client sends is taken as
--- a role, a permission or an identity.
---
--- Ops come back through this connector's own command loop: the website puts our ticket in the op's args
--- (`_ingame`), and the wrapper below hands the op's real result to the player waiting on that ticket.

local SESSION_TTL = 60000      -- ms a session (the website's answer) is trusted before it is asked again
local RESULT_TIMEOUT = 15000   -- ms a player waits for a queued op
local RATE_WINDOW, RATE_MAX = 5000, 12 -- menu requests per player per window
local OPEN_GAP = 2000          -- ms between two session requests of one player

local sessions = {}  -- src -> { perms = { [perm] = true }, list = { … }, role, at }
local rate = {}      -- src -> { start, n, openAt }
local pending = {}   -- ticket -> { src, p }

WC.Menu = { sessions = sessions, pending = pending }

-- Self-administration: client-side features, each needing one permission (same table as the website's
-- /ingame/audit, which checks again before it records the use).
local SELF = {
    ['self.noclip'] = 'self.playermode', ['self.godmode'] = 'self.playermode', ['self.freeze'] = 'self.playermode',
    ['self.tpWaypoint'] = 'self.teleport', ['self.tpCoords'] = 'self.teleport', ['self.tpBack'] = 'self.teleport',
    ['self.viewids'] = 'self.viewids',
    ['vehicle.repair'] = 'players.manage', ['vehicle.delete'] = 'players.manage',
    ['spectate.stop'] = 'players.spectate',
}

local function now() return GetGameTimer() end

--- The player as FXServer knows them. Never anything the client said.
local function who(src)
    return { source = src, name = GetPlayerName(src), identifiers = WC.identifiers(src) }
end

local function limited(src)
    local r = rate[src]
    local t = now()
    if not r or t - r.start >= RATE_WINDOW then
        r = { start = t, n = 0, openAt = r and r.openAt or nil }
        rate[src] = r
    end
    r.n = r.n + 1
    return r.n > RATE_MAX
end

local function ticket()
    return ('%08x%08x%08x%08x'):format(math.random(0, 0xffffffff), math.random(0, 0xffffffff),
        math.random(0, 0xffffffff), math.random(0, 0xffffffff))
end

--- Ask the website whether this player may use the menu. Returns the session or nil, error.
local function openSession(src)
    if not WC.linked() then return nil, 'offline' end
    local status, body = WC.request('POST', '/ingame/session', who(src))
    if status == 200 and type(body) == 'table' and body.ok and type(body.permissions) == 'table' then
        local perms, list = {}, {}
        for _, p in ipairs(body.permissions) do
            if type(p) == 'string' then perms[p] = true; list[#list + 1] = p end
        end
        local s = { perms = perms, list = list, role = tostring(body.role or ''), at = now() }
        sessions[src] = s
        return s
    end
    sessions[src] = nil
    return nil, (type(body) == 'table' and type(body.error) == 'string') and body.error:sub(1, 40) or ('http_' .. tostring(status))
end

--- A live session, asked again when it is older than the TTL.
local function session(src)
    local s = sessions[src]
    if s and now() - s.at < SESSION_TTL then return s end
    if not s then return nil, 'no_session' end
    local fresh, err = openSession(src)
    if not fresh then TriggerClientEvent('w_connector:menu:revoked', src, err) end
    return fresh, err
end

-- Keys that would name a player or an actor: never forwarded from a client, whatever they hold.
local IDENTITY = { source = true, identifiers = true, discord = true, discordId = true, actor = true, ticket = true, role = true, permissions = true }

--- Client arguments: a flat table of strings, numbers and booleans, small. Anything else is dropped.
local function cleanArgs(v)
    local out, n = {}, 0
    if type(v) ~= 'table' then return out end
    for k, x in pairs(v) do
        if type(k) == 'string' and #k <= 24 and k:match('^%a%w*$') and not IDENTITY[k] then
            local t = type(x)
            if t == 'number' and x == x and math.abs(x) < 1e12 or t == 'boolean' or t == 'string' and #x <= 1000 then
                n = n + 1
                if n > 16 then break end
                out[k] = x
            end
        end
    end
    return out
end

-- Every op run on this server passes here; a ticket of ours answers the player waiting on it.
local run = WC.Ops.run
function WC.Ops.run(name, args, actor)
    local t = nil
    if type(args) == 'table' and args._ingame ~= nil then
        t = args._ingame
        args._ingame = nil
    end
    local ok, data = run(name, args, actor)
    local w = type(t) == 'string' and pending[t] or nil
    if w then
        pending[t] = nil
        w.p:resolve({ ok = ok and true or false, data = ok and data or nil, error = (not ok) and data or nil })
    end
    return ok, data
end

--- Players for the menu's list, from this server; identifiers only for staff who manage players.
local function playerList(s)
    local out = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if src then
            local p = { source = src, name = GetPlayerName(src), ping = GetPlayerPing(src) }
            local fw = WC.Adapters.get('framework')
            if fw then
                local ok, char = pcall(fw.player, src)
                if ok and char then
                    p.charName = char.charName
                    p.job = type(char.job) == 'table' and (char.job.label or char.job.name) or nil
                end
            end
            if s.perms['players.manage'] then p.identifiers = WC.identifiers(src) end
            out[#out + 1] = p
        end
    end
    return out
end

-- Answered by this server alone, under the session's permission.
local LOCAL = {
    ['players.list'] = { perm = 'players.view', run = function(s) return { ok = true, data = playerList(s) } end },
    ['server.local'] = { perm = 'overview.view', run = function()
        return { ok = true, data = {
            uptime = GetGameTimer() // 1000, players = #GetPlayers(), maxPlayers = GetConvarInt('sv_maxclients', 32),
            resources = GetNumResources(), game = WC.gameName(),
        } }
    end },
}

local function reply(src, reqId, result)
    TriggerClientEvent('w_connector:menu:result', src, reqId, result)
end

local function validReq(reqId) return type(reqId) == 'number' and math.tointeger(reqId) ~= nil and reqId > 0 and reqId < 1e9 end

-- ── Open: may this player use the menu? ─────────────────────────────────────────────────────────
RegisterNetEvent('w_connector:menu:open', function()
    local src = source
    if not WC.onlineSource(src) then return end
    local r = rate[src] or { start = now(), n = 0 }
    rate[src] = r
    if r.openAt and now() - r.openAt < OPEN_GAP then return end
    r.openAt = now()
    CreateThread(function()
        local s, err = openSession(src)
        if not s then
            TriggerClientEvent('w_connector:menu:session', src, { ok = false, error = err })
            return
        end
        TriggerClientEvent('w_connector:menu:session', src, {
            ok = true, role = s.role, permissions = s.list, game = WC.gameName(), ops = WC.Ops.available(), self = src,
        })
    end)
end)

-- ── Act: one action, authorised and run by the website ──────────────────────────────────────────
RegisterNetEvent('w_connector:menu:act', function(reqId, action, args)
    local src = source
    if not WC.onlineSource(src) or not validReq(reqId) then return end
    if type(action) ~= 'string' or #action > 40 or not action:match('^[a-z]+%.[a-zA-Z]+$') then
        return reply(src, reqId, { ok = false, error = 'unknown_action' })
    end
    if limited(src) then return reply(src, reqId, { ok = false, error = 'rate_limited' }) end
    local clean = cleanArgs(args)
    CreateThread(function()
        local s, err = session(src)
        if not s then return reply(src, reqId, { ok = false, error = err }) end

        local loc = LOCAL[action]
        if loc then
            if not s.perms[loc.perm] then return reply(src, reqId, { ok = false, error = 'no_permission' }) end
            return reply(src, reqId, loc.run(s, clean))
        end

        if not WC.linked() then return reply(src, reqId, { ok = false, error = 'offline' }) end
        local t = ticket()
        local w = { src = src, p = promise.new() }
        pending[t] = w
        local body = who(src)
        body.action, body.args, body.ticket = action, clean, t
        local status, res = WC.request('POST', '/ingame/act', body)
        if status ~= 200 or type(res) ~= 'table' or not res.ok or not res.queued then
            pending[t] = nil
            if status == 403 and type(res) == 'table' and (res.error == 'no_access' or res.error == 'no_discord') then
                sessions[src] = nil
                TriggerClientEvent('w_connector:menu:revoked', src, res.error)
            end
            if type(res) == 'table' and res.ok then return reply(src, reqId, { ok = true, data = res.data }) end
            return reply(src, reqId, { ok = false, error = type(res) == 'table' and type(res.error) == 'string' and res.error:sub(1, 40) or ('http_' .. tostring(status)) })
        end
        -- Queued: the op's real result arrives through the command loop (the wrapper above).
        if pending[t] then SetTimeout(RESULT_TIMEOUT, function() if pending[t] == w then pending[t] = nil; w.p:resolve({ ok = false, error = 'timeout' }) end end) end
        reply(src, reqId, Citizen.Await(w.p))
    end)
end)

-- ── Self: may this player use a client-side feature? Each use is recorded on the website ─────────
RegisterNetEvent('w_connector:menu:self', function(reqId, action, details)
    local src = source
    if not WC.onlineSource(src) or not validReq(reqId) then return end
    local perm = type(action) == 'string' and SELF[action] or nil
    if not perm then return reply(src, reqId, { ok = false, error = 'unknown_action' }) end
    if limited(src) then return reply(src, reqId, { ok = false, error = 'rate_limited' }) end
    local d = cleanArgs(details)
    local clean = { x = type(d.x) == 'number' and d.x or nil, y = type(d.y) == 'number' and d.y or nil, z = type(d.z) == 'number' and d.z or nil }
    if type(d.on) == 'boolean' then clean.on = d.on end
    if type(d.target) == 'number' then clean.target = math.tointeger(d.target) end
    CreateThread(function()
        local s, err = session(src)
        if not s then return reply(src, reqId, { ok = false, error = err }) end
        if not s.perms[perm] then return reply(src, reqId, { ok = false, error = 'no_permission' }) end
        reply(src, reqId, { ok = true })
        if WC.linked() then
            local body = who(src)
            body.action, body.details = action, clean
            WC.request('POST', '/ingame/audit', body)
        end
    end)
end)

AddEventHandler('playerDropped', function()
    local src = source
    sessions[src] = nil
    rate[src] = nil
    for t, w in pairs(pending) do
        if w.src == src then pending[t] = nil end
    end
end)
