--- 2.2.0: the characters page, run here (it used to run in w_admin server/sv_characters.lua): the console's
--- characters tab and its Bans & blocks page (console actions characters.*) and the website's own character
--- page (op character.action). Every character, online or not, is addressed by its CITIZEN ID.
---
--- Wraith Core (w_core) has the whole page: w_core owns the id itself (server/citizen.lua: resolve, block,
--- reassign, transfer, dependencies, delete; its staff exports trust w_connector since w_core 1.0.8). An
--- offline character's money moves on w_centralbank's ledger (the WCore adapter's moneyOffline), its items
--- through w_inventory's own offline add (MutateNativeOfflineInventory), its job / gang through w_core's
--- offline player (the WCore adapter's setRoleOffline). Other frameworks: search and read through the
--- adapter's offline ops, edits on a character in play; what they cannot do answers capability_missing.
---
--- A character in play is edited through the connector's own online ops (money.adjust, inventory.add,
--- player.setJob / setGang) with player.money's rules: money that is added needs a reason (3+ letters) and
--- one press is capped (convar wraith_console_money_<type>_limit; cash/bank 100000, gold 100). One change per
--- character at a time; a second press while one runs is refused.
---
--- Answers: `true, data[, message]` or `false, key[, detail]`; keys are the page's locale keys
--- (locales/*.json). The website writes the audit row of every action (game_audit_log: the staff member,
--- the request, ok / error), as it does for every other console action and op.

local C = WC.Console
local function fw() return WC.Adapters.get('framework') end
local function op(name, args) return WC.Ops.run(name, args or {}) end
local function hasOp(name) for _, n in ipairs(WC.Ops.available()) do if n == name then return true end end return false end
local function core() return exports.w_core end

--- The full page needs w_core itself as this server's framework.
local function wcore()
    local a = WC.Adapters.describe('framework')
    return a ~= nil and a.id == 'wcore' and WC.started('w_core')
end

local function text(v, max)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    return v:sub(1, max or 200)
end
local function decode(s)
    if type(s) == 'table' then return s end
    if type(s) ~= 'string' or s == '' then return {} end
    local ok, v = pcall(json.decode, s)
    return ok and type(v) == 'table' and v or {}
end
local function scalar(v) return (type(v) == 'string' or type(v) == 'number') and tostring(v) or '' end
local function fullName(ci)
    return ((scalar(ci.firstname) .. ' ' .. scalar(ci.lastname)):gsub('^%s+', ''):gsub('%s+$', ''))
end
--- At most `n` bytes, never cut inside a multi-byte letter (a reason may be Arabic).
local function clip(s, n)
    s = tostring(s or ''):sub(1, n)
    while #s > 0 and not utf8.len(s) do s = s:sub(1, -2) end
    return s
end
--- players.last_updated as 'YYYY-MM-DD HH:MM'. oxmysql hands a TIMESTAMP back as epoch MILLISECONDS
--- (a number); a string (dateStrings setups) passes through.
local function seen(v)
    local ms = tonumber(v)
    if ms then return os.date('%Y-%m-%d %H:%M', math.floor(ms / 1000)) end
    return v and tostring(v) or nil
end

--- The server id of every character in play, by citizen id (one pass over the players).
local function onlineMap()
    local out, f = {}, fw()
    if not f then return out end
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        local ok, p = pcall(f.player, src)
        if ok and type(p) == 'table' and p.charId ~= nil then out[tostring(p.charId)] = src end
    end
    return out
end

--- A typed citizen id in its one spelling (w_core's rules on w_core), or nil.
local function normalize(v)
    if wcore() then
        local ok, id = pcall(function() return core():NormalizeCitizenId(v) end)
        return ok and type(id) == 'string' and id or nil
    end
    v = tostring(v or ''):match('^%s*(.-)%s*$')
    return v ~= '' and #v <= 64 and v:match('^[%w:_%-]+$') and v or nil
end

--- Where the character is: { citizenid, source (in play) | nil } or nil + the page's key.
local function locate(cid)
    if wcore() then
        local info, err = core():ResolveCitizen(cid)
        if type(info) ~= 'table' then return nil, err == 'invalid_id' and 'err_invalid_value' or 'err_char_not_found' end
        return { citizenid = tostring(info.citizenid), source = info.online and WC.onlineSource(info.source) or nil }
    end
    local src = onlineMap()[cid]
    if src then return { citizenid = cid, source = src } end
    local ok, row = op('player.offline', { charId = cid })
    if ok and type(row) == 'table' then return { citizenid = tostring(row.charId or cid) } end
    if row == 'not_found' then return nil, 'err_char_not_found' end
    if row == 'invalid_args' then return nil, 'err_invalid_value' end
    return nil, 'capability_missing'
end

-- ── who is asking ─────────────────────────────────────────────────────────────
--- by: the name w_core files the change under; key: whose late answers these are (a deletion's or a
--- transfer's, kept per staff member and token); valid: re-checked before every change (the console's
--- session and permission; a website call was authorised by the website and stays valid).
local function consoleWho(ctx)
    local ids = WC.identifiers(ctx.source)
    return { by = clip(GetPlayerName(ctx.source) or ('#' .. tostring(ctx.source)), 96),
        key = 'game:' .. tostring(ids.license or ids.license2 or ctx.source), valid = ctx.valid }
end
local function siteWho(actor)
    actor = type(actor) == 'table' and actor or {}
    local name = type(actor.name) == 'string' and actor.name ~= '' and actor.name or 'Web Admin'
    return { by = clip(name, 96), key = 'web:' .. tostring(actor.id or actor.name or 'site'), valid = function() return true end }
end

-- One change per character at a time (a double press, the console and the website at once).
local busy = {}
local function locked(cid, fn)
    if busy[cid] then return false, 'err_char_action_busy' end
    busy[cid] = true
    local called, ok, a, b = pcall(fn)
    busy[cid] = nil
    if not called then
        WC.log('character %s change failed: %s', cid, tostring(ok))
        return false, 'err_failed'
    end
    return ok, a, b
end

-- ── the list and one character ────────────────────────────────────────────────
--- One players row (w_core) as the page's row.
local function row(r, live)
    local ci, job = decode(r.charinfo), decode(r.job)
    local cid = tostring(r.citizenid)
    local name = fullName(ci)
    return {
        citizenid = cid, name = name ~= '' and name or cid, account = r.name, license = r.license, slot = tonumber(r.cid),
        lastSeen = seen(r.last_updated), job = job.label_ar or job.label or job.name, online = live[cid],
    }
end

--- One adapter row (players.search / player.offline, other frameworks) as the page's row.
local function adapterRow(p, live)
    local accounts = {}
    for id, balance in pairs(type(p.money) == 'table' and p.money or {}) do
        accounts[#accounts + 1] = { id = tostring(id), balance = tonumber(balance) or 0, currency = tostring(id) }
    end
    table.sort(accounts, function(a, b) return a.id < b.id end)
    local cid = tostring(p.charId)
    local job = type(p.job) == 'table' and p.job or {}
    return { citizenid = cid, name = scalar(p.charName) ~= '' and scalar(p.charName) or scalar(p.name), account = scalar(p.name),
        license = scalar(p.license), slot = 0, lastSeen = p.lastSeen, job = job.label or job.name or '', online = live[cid],
        money = accounts, gang = '', dependencies = {}, siblings = {} }
end

local A = {}

function A.search(p)
    local q = text(p.q, 64)
    if wcore() then
        local rows
        if not q then
            rows = MySQL.query.await('SELECT citizenid, cid, license, name, charinfo, job, last_updated FROM players ORDER BY last_updated DESC LIMIT 60')
        else
            local like = '%' .. q:gsub('[%%_\\]', '\\%0') .. '%'
            rows = MySQL.query.await([[SELECT citizenid, cid, license, name, charinfo, job, last_updated FROM players
                WHERE citizenid = ? OR citizenid LIKE ? OR license LIKE ? OR name LIKE ? OR charinfo LIKE ?
                ORDER BY (citizenid = ?) DESC, last_updated DESC LIMIT 60]], { q, like, like, like, like, q })
        end
        local live, out = onlineMap(), {}
        for _, r in ipairs(rows or {}) do
            local item = row(r, live)
            local block = core():GetCharacterBlock(item.citizenid)
            if type(block) == 'table' then item.blocked = block.reason ~= nil and block.reason ~= '' and block.reason or true end
            out[#out + 1] = item
        end
        return true, out
    end
    -- the adapter's search needs two letters at least: an empty box lists nothing here
    if not q or #q < 2 then return true, {} end
    local ok, rows = op('players.search', { q = q })
    if not ok then return false, rows == 'invalid_args' and 'err_invalid_value' or 'err_failed' end
    local live, out = onlineMap(), {}
    for _, r in ipairs(type(rows) == 'table' and rows or {}) do out[#out + 1] = adapterRow(r, live) end
    return true, out
end

function A.get(p)
    if not wcore() then
        local cid = normalize(p.citizenid)
        if not cid then return false, 'err_invalid_value' end
        local ok, r = op('player.offline', { charId = cid })
        if not ok then return false, r == 'not_found' and 'err_char_not_found' or 'err_invalid_value' end
        return true, adapterRow(r, onlineMap())
    end
    local info, err = core():ResolveCitizen(p.citizenid)
    if type(info) ~= 'table' then return false, err == 'invalid_id' and 'err_invalid_value' or 'err_char_not_found' end
    local cid = tostring(info.citizenid)
    local r = MySQL.single.await('SELECT citizenid, cid, license, name, charinfo, job, gang, last_updated FROM players WHERE citizenid = ?', { cid })
    if not r then return false, 'err_char_not_found' end
    local out = row(r, { [cid] = info.online and info.source or nil })
    local gang = decode(r.gang)
    out.gang = gang.label_ar or gang.label or gang.name
    out.block = core():GetCharacterBlock(cid)
    out.dependencies = core():CharacterDependencies(cid) or {}
    out.money = {}
    if WC.started('w_centralbank') then
        local read, accounts = pcall(MySQL.query.await, 'SELECT id, balance, currency FROM cb_accounts WHERE owner = ?', { cid })
        for _, a in ipairs(read and type(accounts) == 'table' and accounts or {}) do
            out.money[#out.money + 1] = { id = a.id, balance = (tonumber(a.balance) or 0) / 100, currency = a.currency }
        end
    end
    -- the account's other characters (the same license)
    out.siblings = {}
    if type(r.license) == 'string' and r.license ~= '' then
        for _, s in ipairs(MySQL.query.await('SELECT citizenid, charinfo FROM players WHERE license = ? AND citizenid <> ?', { r.license, cid }) or {}) do
            out.siblings[#out.siblings + 1] = { citizenid = tostring(s.citizenid), name = fullName(decode(s.charinfo)) }
        end
    end
    return true, out
end

-- ── blocks ────────────────────────────────────────────────────────────────────
function A.block(p, who)
    local cid = normalize(p.citizenid)
    if not cid then return false, 'err_char_bad_id' end
    if not who.valid() then return false, 'no_session' end
    local reason = text(p.reason, 255) or ''
    local ok, err = core():BlockCharacter(cid, reason, who.by)
    if not ok then return false, err == 'not_found' and 'err_char_not_found' or err == 'forbidden' and 'err_char_forbidden' or 'err_failed' end
    return true, { citizenid = cid, reason = reason }, 'toast_char_blocked'
end

function A.unblock(p, who)
    local cid = normalize(p.citizenid)
    if not cid then return false, 'err_char_bad_id' end
    if not who.valid() then return false, 'no_session' end
    local ok, err = core():UnblockCharacter(cid)
    if not ok then return false, err == 'forbidden' and 'err_char_forbidden' or 'err_failed' end
    return true, { citizenid = cid }, 'toast_char_unblocked'
end

--- Every blocked character, newest first: { citizenid, name, reason, blocked_by, blocked_at, online }.
function A.blocks()
    -- COLLATE: w_core_character_blocks was created utf8mb4_unicode_ci and players is utf8mb4_general_ci;
    -- "=" between two implicit collations is refused ("Illegal mix of collations").
    local ok, rows = pcall(MySQL.query.await, [[SELECT b.citizenid, b.reason, b.blocked_by, b.blocked_at, p.charinfo
        FROM w_core_character_blocks b LEFT JOIN players p ON p.citizenid = b.citizenid COLLATE utf8mb4_general_ci
        ORDER BY b.blocked_at DESC LIMIT 500]])
    if not ok or type(rows) ~= 'table' then return false, 'err_db' end
    local live, list = onlineMap(), {}
    for _, r in ipairs(rows) do
        local cid = tostring(r.citizenid)
        list[#list + 1] = { citizenid = cid, name = fullName(decode(r.charinfo)), reason = r.reason or '', blocked_by = r.blocked_by or '',
            blocked_at = tonumber(r.blocked_at) or 0, online = live[cid] }
    end
    return true, list
end

-- ── a vanity id ───────────────────────────────────────────────────────────────
local REASSIGN_ERRORS = { invalid_id = 'err_char_bad_id', same_id = 'err_char_bad_id', not_found = 'err_char_not_found',
    id_taken = 'err_char_id_taken', online = 'err_char_online', not_ready = 'err_failed', database = 'err_db',
    busy = 'err_char_busy', still_online = 'err_char_logout', economy_not_ready = 'err_char_economy',
    accounts_changed = 'err_char_accounts_changed', error = 'err_char_error', forbidden = 'err_char_forbidden' }
function A.reassign(p, who)
    local old, new = normalize(p.citizenid), normalize(p.newId)
    if not old or not new then return false, 'err_char_bad_id' end
    if not who.valid() then return false, 'no_session' end
    local ok, info = core():ReassignCitizenId(old, new, who.by)
    if not ok then return false, REASSIGN_ERRORS[info] or 'err_failed' end
    return true, { citizenid = new, old = old, touched = info }, 'toast_char_reassigned'
end

-- ── the long jobs: delete, hand a number on ───────────────────────────────────
-- The last answers of deletions and number transfers, by the staff member, the kind and the page's
-- request token, for ten minutes: the console's call gives up after 18 s while a long purge (an online
-- character's logout, every resource, two registry scans) or a transfer (two logouts, two moves) still
-- runs here. The page then asks 'deleteStatus' / 'transferStatus' until the answer is in.
local finished = {}
local FINISHED_TTL = 600
local function tokenOf(who, p, kind)
    local t = p.token
    if type(t) ~= 'string' or #t < 6 or #t > 40 or not t:match('^[%w]+$') then return nil end
    return who.key .. ':' .. kind .. ':' .. t
end
local function remember(who, p, result, kind)
    local key = tokenOf(who, p, kind)
    if not key then return result end
    local now = os.time()
    for k, f in pairs(finished) do if now - f.at > FINISHED_TTL then finished[k] = nil end end
    finished[key] = { at = now, result = result }
    return result
end
local function statusOf(who, p, kind)
    local key = tokenOf(who, p, kind)
    if not key then return false, 'err_invalid_value' end
    local f = finished[key]
    if not f then return true, { done = false } end
    return true, { done = true, result = f.result }
end
local function fail(key, data) return { ok = false, error = key, data = data } end
local function done(key, data) return { ok = true, msg = key, data = data } end
--- A remembered answer as this file's returns.
local function answer(r)
    if r.ok then return true, r.data, r.msg end
    return false, r.error, r.data
end

-- w_core's own refusals (resource 'w_core', or none) -> the page's text: every reason C.Purge answers
-- for itself (w_core/server/citizen.lua, its doc above C.Purge).
local CORE_ERRORS = {
    not_found = 'err_char_not_found', invalid_id = 'err_char_bad_id', not_ready = 'err_char_not_ready',
    busy = 'err_char_busy', still_online = 'err_char_logout', assets = 'err_char_assets',
    balance_changed = 'err_char_balance_changed', economy_not_ready = 'err_char_economy', database = 'err_db',
    error = 'err_char_error', forbidden = 'err_char_forbidden',
}
-- the same words from a resource (its other reasons are its own text, shown as they came)
local RESOURCE_ERRORS = {
    restarting = 'err_char_restarting', busy = 'err_char_res_busy', error = 'err_char_error',
    not_ready = 'err_char_not_ready', economy_not_ready = 'err_char_economy', balance_changed = 'err_char_balance_changed',
    database = 'err_db', database_error = 'err_db',
}
-- keys C.Purge puts next to the resources' summaries
local REPORT_META = { tombstone = true, clean = true, leftovers = true }

--- w_core's deletion report (C.Purge) as the list the page prints in order:
---   { { resource, total, items = { { name, count } }, money = { USD, GOLD } | nil, notes = text | nil } }
--- A resource that reported nothing is left out.
local function reportList(report)
    local out = {}
    if type(report) ~= 'table' then return out end
    for resource, summary in pairs(report) do
        if type(resource) == 'string' and not REPORT_META[resource] then
            local entry = { resource = resource:sub(1, 64), items = {}, total = 0 }
            if type(summary) == 'string' and summary ~= '' then
                entry.notes = clip(summary, 300) -- an older w_core: 'no_export', 'skipped: ...'
            elseif type(summary) == 'table' then
                for name, v in pairs(summary) do
                    if name == 'money' and type(v) == 'table' then
                        for _, cur in ipairs({ 'USD', 'GOLD' }) do
                            local n = tonumber(v[cur])
                            if n and n == n and n ~= 0 then entry.money = entry.money or {}; entry.money[cur] = n end
                        end
                    elseif name == 'notes' then
                        if type(v) == 'string' and v ~= '' then entry.notes = clip(v, 300) end
                    elseif type(name) == 'string' then
                        local n = tonumber(v)
                        if n and n == n and n ~= 0 then
                            entry.items[#entry.items + 1] = { name = name:sub(1, 64), count = n }
                            entry.total = entry.total + n
                        end
                    end
                end
                table.sort(entry.items, function(a, b) return a.name < b.name end)
            end
            if #entry.items > 0 or entry.money or entry.notes then out[#out + 1] = entry end
        end
    end
    table.sort(out, function(a, b) return a.resource < b.resource end)
    return out
end

local function deleteCharacter(who, cid)
    local ok, a, b, c = core():DeleteCharacterByStaff(cid, who.by)
    if ok ~= true then
        local reason = a ~= nil and clip(a, 300) or nil
        local resource = type(b) == 'string' and b ~= '' and b:sub(1, 64) or nil
        local own = resource == nil or resource == 'w_core'
        local key = reason and (own and CORE_ERRORS[reason] or (not own and RESOURCE_ERRORS[reason])) or nil
        -- what stands in the way: the assets not released, the accounts still funded
        local detail = type(c) == 'string' and c ~= '' and clip(c, 600) or nil
        return fail(own and (key or 'err_failed') or 'err_char_refused',
            { reason = reason, reasonKey = key or nil, resource = resource or 'w_core', detail = detail })
    end
    local report = reportList(a)
    local total, money = 0, {}
    for _, e in ipairs(report) do
        total = total + e.total
        for cur, n in pairs(e.money or {}) do money[cur] = (money[cur] or 0) + n end
    end
    local rep = type(a) == 'table' and a or {}
    local tombstone = type(rep.tombstone) == 'string' and rep.tombstone or nil
    -- anything still under the number: not the "free now" answer (w_core retries once by itself)
    local clean = rep.clean ~= false
    local leftovers = not clean and clip(rep.leftovers or '?', 600) or nil
    if not clean then WC.log('delete of character %s left records under the number (warning): %s', cid, leftovers) end
    return done(clean and 'toast_char_deleted' or 'toast_char_deleted_unclean', { citizenid = cid, report = report, total = total,
        money = next(money) and money or nil, tombstone = tombstone, clean = clean, leftovers = leftovers })
end

function A.delete(p, who)
    local cid = normalize(p.citizenid)
    if not cid then return answer(remember(who, p, fail('err_char_not_found'), 'delete')) end
    if not who.valid() then return false, 'no_session' end
    -- remembered even if it throws: the page waiting for it is told, not left asking
    local called, result = pcall(deleteCharacter, who, cid)
    if not called then
        WC.log('delete of character %s failed: %s', cid, tostring(result))
        result = fail('err_failed')
    end
    return answer(remember(who, p, result, 'delete'))
end
function A.deleteStatus(p, who) return statusOf(who, p, 'delete') end

-- w_core's TransferNumber reasons -> the page's text
local TRANSFER_ERRORS = {
    invalid_id = 'err_char_bad_id', same_id = 'err_char_transfer_same', busy = 'err_char_busy',
    not_found = 'err_char_not_found', target_not_found = 'err_char_target_not_found', online = 'err_char_online',
    restarting = 'err_char_restarting', economy_not_ready = 'err_char_economy', no_fresh_id = 'err_char_no_fresh_id',
    still_online = 'err_char_logout', id_taken = 'err_char_transfer_unclean', accounts_changed = 'err_char_accounts_changed',
    database = 'err_db', error = 'err_char_error', forbidden = 'err_char_forbidden', not_ready = 'err_char_not_ready',
}

--- A character's name from its saved row ('' when there is none).
local function nameOf(cid)
    local r = MySQL.single.await('SELECT charinfo FROM players WHERE citizenid = ?', { cid })
    return fullName(decode(r and r.charinfo))
end

local function transferNumber(who, n, target)
    -- the names now: both numbers change under them
    local aName, bName = nameOf(n), nameOf(target)
    local ok, a, b, c = core():TransferCitizenNumber(n, target, who.by)
    if ok ~= true then
        local reason = a ~= nil and clip(a, 100) or nil
        local key = reason and TRANSFER_ERRORS[reason] or nil
        local detail = b ~= nil and b ~= '' and clip(b, 600) or nil
        local movedTo = type(c) == 'string' and c ~= '' and c or nil
        if movedTo then
            -- half done: the holder has its new number, the target kept its own, n has no holder
            WC.log('transfer of citizen id %s to %s STOPPED HALF WAY (failed): its holder moved to %s, %s did not take it: %s',
                n, target, movedTo, target, tostring(reason))
            return fail('err_char_transfer_partial', { number = n, target = target, movedTo = movedTo, aName = aName, bName = bName,
                reason = reason, reasonKey = key, detail = detail })
        end
        return fail(key or 'err_failed', { reason = reason, reasonKey = key, detail = detail })
    end
    local r = type(a) == 'table' and a or {}
    return done('toast_char_transferred', { number = n, movedTo = r.movedTo, freed = r.freed or target, aName = aName, bName = bName })
end

function A.transfer(p, who)
    local n, target = normalize(p.citizenid), normalize(p.target)
    if not n or not target then return answer(remember(who, p, fail('err_char_bad_id'), 'transfer')) end
    if not who.valid() then return false, 'no_session' end
    local called, result = pcall(transferNumber, who, n, target)
    if not called then
        WC.log('transfer of citizen id %s to %s failed: %s', n, target, tostring(result))
        result = fail('err_failed')
    end
    return answer(remember(who, p, result, 'transfer'))
end
function A.transferStatus(p, who) return statusOf(who, p, 'transfer') end

-- ── money, an item, the job and the gang: online or offline ───────────────────
--- Lock the character, find it, and run `live(cid, source, identity)` while it is in play or
--- `saved(cid)` while it is not.
local function edit(p, live, saved)
    local cid = normalize(p.citizenid)
    if not cid then return false, 'err_invalid_value' end
    return locked(cid, function()
        local at, err = locate(cid)
        if not at then return false, err end
        if at.source then
            local identity = C.identity(at.source)
            if not identity then return false, 'player_offline' end
            return live(at.citizenid, at.source, identity)
        end
        return saved(at.citizenid)
    end)
end
--- Is the same character still in play on `src`? (a logout, a character switch, a reused server id)
local function same(src, identity) return WC.onlineSource(src) ~= nil and C.identity(src) == identity end
--- Still offline? (an offline write must not race the character's own save)
local function stillOffline(cid)
    local at = locate(cid)
    return at ~= nil and at.source == nil
end

--- A money amount in whole cents (the central bank keeps cents: 2.5 gold is fine, 2.555 is rounded).
local function cents(v)
    local n = tonumber(v)
    if not n or n ~= n or n < 0 or n > 1e9 then return nil end
    return math.floor(n * 100 + 0.5 + 1e-7) / 100
end
--- player.money's rule for what an add (or a set above the balance) takes from the reserve.
local function grantCheck(kind, grant, reason)
    if grant <= 0 then return true end
    if #tostring(reason or ''):gsub('%s', '') < 3 then return false, 'money_reason_required' end
    local limit = GetConvarInt('wraith_console_money_' .. kind .. '_limit', kind == 'gold' and 100 or 100000)
    if grant > math.max(0, limit) + 1e-9 then return false, 'money_limit' end
    return true
end
local MONEY_ERRORS = { insufficient_funds = 'err_char_no_funds', bank_not_ready = 'err_char_economy',
    economy_not_ready = 'err_char_economy', unknown_account = 'err_invalid_value', invalid_amount = 'err_invalid_value',
    invalid_args = 'err_invalid_value', account_missing = 'err_char_not_found', account_frozen = 'err_char_account_frozen',
    player_offline = 'target_changed', no_character = 'target_changed' }

function A.money(p, who)
    local kind = p.type
    return edit(p, function(cid, src, identity)
        local f = fw()
        local amount = cents(p.amount)
        if not amount or (kind ~= 'cash' and kind ~= 'bank' and kind ~= 'gold')
            or (p.op ~= 'add' and p.op ~= 'remove' and p.op ~= 'set') or (p.op ~= 'set' and amount <= 0) then
            return false, 'err_invalid_value'
        end
        local account = kind
        if kind == 'cash' then for _, acc in ipairs(f.accounts(src) or {}) do if acc.kind == 'cash' then account = acc.id; break end end end
        local view = f.player(src)
        local current = type(view) == 'table' and type(view.money) == 'table' and tonumber(view.money[account]) or nil
        if not current then return false, 'err_invalid_value' end
        local delta = p.op == 'set' and (amount - current) or (p.op == 'remove' and -amount or amount)
        delta = (delta < 0 and -math.floor(-delta * 100 + 0.5) or math.floor(delta * 100 + 0.5)) / 100
        local fine, why = grantCheck(kind, delta, p.reason)
        if not fine then return false, why end
        if delta == 0 then return true, { citizenid = cid, online = true, type = kind, amount = 0 }, 'toast_money_set' end
        if not who.valid() then return false, 'no_session' end
        if not same(src, identity) then return false, 'target_changed' end
        local ok, err = op('money.adjust', { source = src, account = account, amount = delta })
        if not ok then return false, MONEY_ERRORS[err] or 'err_failed' end
        return true, { citizenid = cid, online = true, type = kind, amount = delta }, 'toast_money_set'
    end, function(cid)
        -- offline: the central bank moves the money itself (cash / gold; the bank tab is its own)
        local amount = cents(p.amount)
        if (kind ~= 'cash' and kind ~= 'gold') or not amount or amount <= 0 or (p.op ~= 'add' and p.op ~= 'remove') then
            return false, 'err_char_offline_money'
        end
        local fine, why = grantCheck(kind, p.op == 'add' and amount or 0, p.reason)
        if not fine then return false, why end
        local f = fw()
        if type(f.moneyOffline) ~= 'function' then return false, 'capability_missing', { reason = 'offline_money' } end
        if not who.valid() then return false, 'no_session' end
        local reason = text(p.reason, 150)
        local note = clip(('wraith-panel (offline) by %s%s'):format(who.by, reason and (': ' .. reason) or ''), 255)
        local delta = p.op == 'add' and amount or -amount
        local ok, err = f.moneyOffline(cid, kind, delta, note)
        if not ok then return false, MONEY_ERRORS[err] or 'err_failed' end
        return true, { citizenid = cid, online = false, type = kind, amount = delta }, 'toast_money_set'
    end)
end

-- w_inventory's offline refusals (modules/inventory/native_offline.lua) -> the page's text
local ITEM_ERRORS = { ['Invalid native item'] = 'invalid_item', ['Character not found'] = 'err_char_not_found',
    ['Invalid quantity'] = 'err_invalid_value', ['Character is loading'] = 'target_changed', ['Character is online'] = 'target_changed',
    ['Character is online; use the online inventory API'] = 'target_changed' }

function A.giveItem(p, who)
    local item = WC.itemName(p.item)
    local count = WC.count(p.count, 1000)
    if not item or not count then return false, 'err_invalid_value' end
    item = item:lower()
    return edit(p, function(cid, src, identity)
        if not hasOp('inventory.add') then return false, 'capability_missing', { reason = 'inventory' } end
        if not who.valid() then return false, 'no_session' end
        if not same(src, identity) then return false, 'target_changed' end
        local ok, err = op('inventory.add', { source = src, item = item, count = count })
        if not ok then
            return false, err == 'cannot_carry' and 'err_char_cannot_carry' or err == 'invalid_item' and 'invalid_item'
                or err == 'invalid_args' and 'err_invalid_value' or err == 'player_offline' and 'target_changed' or 'item_not_given'
        end
        return true, { citizenid = cid, online = true, item = item, count = count }, 'item_given'
    end, function(cid)
        -- offline: w_inventory's own offline add, on the framework's saved bag (it locks the owner itself)
        local read, native = false, nil
        if WC.started('w_inventory') then read, native = pcall(function() return exports.w_inventory:GetNativeStorage() end) end
        if not read or not native then
            -- 2.2.0: w_core keeps w_inventory's own storage (no native framework bag): the platform library's
            -- offline add is the one that knows that layout (what w_admin used). Optional: only when it runs.
            if not WC.started('w_lib') then return false, 'capability_missing', { reason = 'offline_items' } end
            if not who.valid() then return false, 'no_session' end
            local called, ok, why = pcall(function() return exports.w_lib:FwAddItemOffline(cid, item, count) end)
            if not called then
                WC.log('offline item for character %s failed: %s', cid, tostring(ok))
                return false, 'item_not_given'
            end
            if ok ~= true then return false, (why == 'Item definition not found' and 'invalid_item') or (why == 'Player not found' and 'err_char_not_found') or 'item_not_given' end
            return true, { citizenid = cid, online = false, item = item, count = count }, 'item_given'
        end
        if not who.valid() then return false, 'no_session' end
        local called, ok, why = pcall(function() return exports.w_inventory:MutateNativeOfflineInventory(cid, 'add', item, count) end)
        if not called then
            WC.log('offline item for character %s failed: %s', cid, tostring(ok))
            return false, 'item_not_given'
        end
        if ok ~= true then return false, ITEM_ERRORS[why] or 'item_not_given' end
        return true, { citizenid = cid, online = false, item = item, count = count }, 'item_given'
    end)
end

local ROLE_ERRORS = { unknown_job = 'err_unknown_job', unknown_gang = 'err_unknown_gang', unknown_grade = 'err_unknown_grade',
    not_found = 'err_char_not_found', invalid_args = 'err_invalid_value', player_offline = 'target_changed', no_character = 'target_changed' }

local function setRole(p, who, kind)
    local name = text(p.name, 50)
    local grade = math.tointeger(tonumber(p.grade))
    if not name or not name:match('^[%w_%-]+$') or not grade or grade < 0 or grade > 100 then return false, 'err_invalid_value' end
    name = name:lower()
    local f = fw()
    if not f then return false, 'capability_missing', { reason = 'framework' } end
    -- the framework's own grades, when it can tell (w_core): an unknown grade is refused, not saved as "No Grades"
    if type(f.roleGrade) == 'function' then
        local fits, why = f.roleGrade(kind, name, grade)
        if not fits then return false, ROLE_ERRORS[why] or 'err_invalid_value' end
    end
    local message = kind == 'job' and 'toast_job_set' or 'toast_gang_set'
    return edit(p, function(cid, src, identity)
        local name_op = kind == 'job' and 'player.setJob' or 'player.setGang'
        if not hasOp(name_op) then return false, 'capability_missing', { reason = kind } end
        if not who.valid() then return false, 'no_session' end
        if not same(src, identity) then return false, 'target_changed' end
        local ok, err = op(name_op, { source = src, job = kind == 'job' and name or nil, gang = kind == 'gang' and name or nil, grade = grade })
        if not ok then return false, ROLE_ERRORS[err] or 'err_failed' end
        return true, { citizenid = cid, online = true, name = name, grade = grade }, message
    end, function(cid)
        if type(f.setRoleOffline) ~= 'function' then return false, 'capability_missing', { reason = 'offline_' .. kind } end
        if not who.valid() then return false, 'no_session' end
        -- logged in meanwhile: his own save would overwrite this one
        if not stillOffline(cid) then return false, 'target_changed' end
        local ok, err = f.setRoleOffline(cid, kind, name, grade)
        if not ok then return false, ROLE_ERRORS[err] or 'err_failed' end
        return true, { citizenid = cid, online = false, name = name, grade = grade }, message
    end)
end
function A.setJob(p, who) return setRole(p, who, 'job') end
function A.setGang(p, who) return setRole(p, who, 'gang') end

--- Run one action, its errors contained (an export that throws answers 'err_failed', never a stack).
local function run(name, p, who)
    local called, ok, a, b = pcall(A[name], type(p) == 'table' and p or {}, who)
    if not called then
        WC.log('characters %s failed: %s', name, tostring(ok))
        return false, 'err_failed'
    end
    return ok, a, b
end

-- ── the console's characters page ─────────────────────────────────────────────
local function coreOnly() if wcore() then return true end return false, 'capability_missing' end
local function viaOp(name) return function() if wcore() or hasOp(name) then return true end return false, 'capability_missing' end end
local AVAILABLE = {
    search = viaOp('players.search'), get = viaOp('player.offline'),
    blocks = coreOnly, block = coreOnly, unblock = coreOnly, reassign = coreOnly,
    transfer = coreOnly, transferStatus = coreOnly, delete = coreOnly, deleteStatus = coreOnly,
    money = viaOp('money.adjust'), giveItem = function() if wcore() or hasOp('inventory.add') then return true end return false, 'capability_missing' end,
    setJob = viaOp('player.setJob'), setGang = viaOp('player.setGang'),
}
for name, available in pairs(AVAILABLE) do
    C.define('characters.' .. name, available, function(data, ctx)
        local ok, a, b = run(name, data, consoleWho(ctx))
        if ok then return true, a end
        return false, a, type(b) == 'table' and b or nil
    end)
end

-- ── the website's character page (op character.action, same args and answers as before 2.2.0) ──
local function cid(v)
    v = tostring(v or '')
    return v:match('^[%w_%-]+$') and #v <= 32 and v or nil
end
local function token(v)
    v = tostring(v or '')
    return v:match('^[%w]+$') and #v >= 6 and #v <= 40 and v or nil
end
-- Each action: the payload from the op's args, and the fields that must be present (a nil is simply
-- absent from a Lua table, so they are named rather than looked for).
local SITE = {
    get = { function(a) return { citizenid = cid(a.charId) } end, { 'citizenid' } },
    block = { function(a) return { citizenid = cid(a.charId), reason = tostring(a.reason or ''):sub(1, 255) } end, { 'citizenid' } },
    unblock = { function(a) return { citizenid = cid(a.charId) } end, { 'citizenid' } },
    reassign = { function(a) return { citizenid = cid(a.charId), newId = cid(a.newId) } end, { 'citizenid', 'newId' } },
    transfer = { function(a) return { citizenid = cid(a.charId), target = cid(a.target), token = token(a.token) } end, { 'citizenid', 'target', 'token' } },
    transferStatus = { function(a) return { token = token(a.token) } end, { 'token' } },
    delete = { function(a) return { citizenid = cid(a.charId), token = token(a.token) } end, { 'citizenid', 'token' } },
    deleteStatus = { function(a) return { token = token(a.token) } end, { 'token' } },
}

WC.Ops.define('character.action', wcore, function(args, actor)
    local def = SITE[args.action]
    if not def then return false, 'invalid_args' end
    local payload = def[1](args)
    for _, field in ipairs(def[2]) do if payload[field] == nil then return false, 'invalid_args' end end
    local ok, a, b = run(args.action, payload, siteWho(actor))
    if not ok then return false, tostring(a or 'err_failed'):sub(1, 60) end
    return true, { message = b, data = a }
end)
