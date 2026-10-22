--- The way in: ONE gate for every join, run from the website (2026-10-14).
---
--- It replaces connectqueue and the old sv_connect.lua. In order, for each connecting player:
---   identity -> closed -> bans (wc_bans) -> whitelist -> priority -> the queue.
---
--- * The switches (whitelist on/off, closed, grace minutes, the rank and Discord-role points) live
---   in wc_settings, set from the website's Entry tab, and survive a restart. The convar
---   `w_connector_whitelist` is only the default before the site ever set it.
--- * A player's priority is the HIGHEST of: his ranks' points, his Discord roles' points, his own
---   priority given on the site, what he bought in the store (wc_priority), his VIP tier (w_vip, by his
---   Cfx.re account: queue_points 100..950, 1.1.2) and a short grace after a crash. Higher goes first;
---   equal priority keeps the order of arrival. A VIP is never staff: Entry.isStaff reads the ranks only.
--- * Seats are counted on the server (players in game + the ones let through and still connecting),
---   never from a client event the way connectqueue did.
---
--- Rules kept from the old gate, because both were right:
---   * Empty identifiers never match a ban: a row whose `steam_hex` is '' would otherwise ban every
---     player who has no Steam identifier.
---   * A database error on the BAN check allows the join: a ban briefly not enforced is recoverable,
---     a server nobody (the owner included) can enter is not. The whitelist, whose whole point is to
---     keep people out, asks the player to retry instead.
---
--- Staff (anyone holding a rank) pass the closed and whitelist checks, so an owner who closed the
--- server can still get in to work on it. They still queue, at their ranks' points.

Entry = {
    ready = false,
    settings = {},
    queue = {},        -- waiting players, see newEntry()
    connecting = {},   -- [temp source] = { license, at, lostAt }: let through, not in game yet
    priorities = {},   -- active wc_priority rows
    grace = {},        -- [license] = unix seconds until which a crashed player gets back in first
}

local WAIT_FOR_DB_MS   = 30000
local CONNECT_TIMEOUT  = 120     -- seconds a let-through player may take to reach the game
local LOST_TIMEOUT     = 10      -- seconds his temporary id may be gone before the seat is freed
local DISCORD_TTL      = 300     -- seconds a member's Discord roles are cached
local GRACE_POINTS     = 1000
local MAX_POINTS       = 1000
local DISCORD_API      = 'https://discord.com/api/v10'

local DEFAULTS = {
    whitelist_enabled   = Config.useWhitelist == true,
    closed              = false,
    grace_minutes       = 5,
    rank_points         = { master = MAX_POINTS, owner = MAX_POINTS },
    discord_role_points = {},
}

-- ---------------------------------------------------------------------------
--  What the connecting player reads (the server language: w_lib:locale)
-- ---------------------------------------------------------------------------

local TEXT = {
    ar = {
        checking   = 'ريد ريفر — نتحقق من دخولك…',
        no_license = 'تعذّر التعرف على حسابك في روكستار. أغلق اللعبة وافتحها من جديد.',
        closed     = 'السيرفر مغلق أمام اللاعبين الآن. حاول لاحقًا.',
        banned     = 'أنت محظور من السيرفر. السبب: %s.%s',
        ban_perm   = ' الحظر دائم.',
        ban_until  = ' ينتهي: %s',
        no_reason  = 'بدون سبب',
        whitelist  = 'السيرفر يعمل بالقائمة البيضاء وحسابك ليس فيها. قدّم طلبك من موقع السيرفر.',
        wl_retry   = 'تعذّر التحقق من القائمة البيضاء الآن. حاول بعد دقيقة.',
        queue      = 'ريد ريفر — دورك %d من %d في الطابور%s · انتظرت %s',
        queue_prio = ' · أولويتك %d',
        removed    = 'أخرجتك الإدارة من الطابور.',
        replaced   = 'دخلت من اتصال آخر بالحساب نفسه.',
    },
    en = {
        checking   = 'Red River — checking your access…',
        no_license = 'We could not identify your Rockstar account. Restart the game and try again.',
        closed     = 'The server is currently closed to players. Please try again later.',
        banned     = 'You are banned from this server. Reason: %s.%s',
        ban_perm   = ' This ban is permanent.',
        ban_until  = ' Expires: %s',
        no_reason  = 'No reason given',
        whitelist  = 'This server is whitelisted and your account is not on the list. Apply on the server website.',
        wl_retry   = 'The whitelist could not be checked right now. Please try again in a minute.',
        queue      = 'Red River — you are %d of %d in the queue%s · waited %s',
        queue_prio = ' · priority %d',
        removed    = 'Staff removed you from the queue.',
        replaced   = 'You connected again from another session.',
    },
}

local function t(key)
    local lang = GetConvar('w_lib:locale', 'ar') == 'en' and 'en' or 'ar'
    return TEXT[lang][key] or TEXT.en[key] or key
end

local function clock(seconds)
    seconds = math.max(0, math.floor(seconds or 0))
    return ('%02d:%02d'):format(seconds // 60, seconds % 60)
end

-- ---------------------------------------------------------------------------
--  Settings (wc_settings)
-- ---------------------------------------------------------------------------

local function applyDefaults()
    for k, v in pairs(DEFAULTS) do
        if Entry.settings[k] == nil then
            Entry.settings[k] = type(v) == 'table' and json.decode(json.encode(v)) or v
        end
    end
    if ServerState then ServerState.closed = Entry.settings.closed == true end
end

local function loadSettings()
    local rows = MySQL.query.await('SELECT `key`, `value` FROM `wc_settings`') or {}
    local settings = {}
    for _, row in ipairs(rows) do
        local ok, value = pcall(json.decode, row.value or 'null')
        if ok and value ~= nil then settings[row.key] = value end
    end
    Entry.settings = settings
    applyDefaults()
end

--- Persist one switch. The memory copy changes first, so the gate follows at once even when the
--- write is slow; a failed write is reported to the caller.
function Entry.saveSetting(key, value, by)
    Entry.settings[key] = value
    if key == 'closed' and ServerState then ServerState.closed = value == true end
    local ok, err = pcall(function()
        MySQL.query.await(
            'INSERT INTO `wc_settings` (`key`, `value`, `updated_by`) VALUES (?, ?, ?) ' ..
            'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_by` = VALUES(`updated_by`)',
            { key, json.encode(value), H.str(by, 100) })
    end)
    if not ok then print(('^1[w_connector] [queue] could not save setting %s: %s^0'):format(key, tostring(err))) end
    return ok
end

-- ---------------------------------------------------------------------------
--  Player priorities (wc_priority)
-- ---------------------------------------------------------------------------

function Entry.loadPriorities()
    local rows = MySQL.query.await(
        'SELECT `id`, `identifier`, `alt_ids`, `name`, `points`, `expires_at`, `source`, `note`, `added_by`, `created_at` ' ..
        'FROM `wc_priority` WHERE `expires_at` IS NULL OR `expires_at` > ?', { os.time() - 7 * 86400 }) or {}
    Entry.priorities = rows
    return rows
end

--- The identifiers a connecting / online player can be matched by: 'license:..', 'steam:..', 'discord:..'.
local function keysOf(ids)
    local keys = {}
    if ids.license and ids.license ~= '' then keys[#keys + 1] = ids.license:lower() end
    if ids.steam and ids.steam ~= '' then keys[#keys + 1] = 'steam:' .. ids.steam:lower() end
    if ids.discord and ids.discord ~= '' then keys[#keys + 1] = 'discord:' .. ids.discord end
    return keys
end

local function rowMatches(row, keySet)
    if keySet[row.identifier] then return true end
    for alt in tostring(row.alt_ids or ''):gmatch('[^,]+') do
        if keySet[alt] then return true end
    end
    return false
end

-- ---------------------------------------------------------------------------
--  Discord roles (the w_logs bot, see config.lua)
-- ---------------------------------------------------------------------------

local discordCache = {}

local function discordReady()
    return Config.discordToken ~= '' and Config.discordGuild ~= ''
end
Entry.discordReady = discordReady

--- The role ids a Discord member holds, as a set. Cached; a Discord that does not answer within five
--- seconds costs the player his Discord points for this join, never the join itself.
local function discordRolesOf(discordId)
    if not discordReady() or not discordId or discordId == '' then return {} end
    local cached = discordCache[discordId]
    if cached and os.time() - cached.at < DISCORD_TTL then return cached.roles end

    local p = promise.new()
    local settled = false
    local function done(v) if not settled then settled = true; p:resolve(v) end end
    PerformHttpRequest(('%s/guilds/%s/members/%s'):format(DISCORD_API, Config.discordGuild, discordId),
        function(code, body)
            if code == 200 and body and body ~= '' then
                local ok, data = pcall(json.decode, body)
                done(ok and data or false)
            elseif code == 404 then
                done({ roles = {} })   -- not in the guild: no roles, and worth caching
            else
                done(false)
            end
        end, 'GET', '', { ['Authorization'] = 'Bot ' .. Config.discordToken })
    SetTimeout(5000, function() done(false) end)

    local member = Citizen.Await(p)
    if type(member) ~= 'table' then return cached and cached.roles or {} end
    local roles = {}
    for _, id in ipairs(type(member.roles) == 'table' and member.roles or {}) do roles[tostring(id)] = true end
    discordCache[discordId] = { roles = roles, at = os.time() }
    return roles
end

-- ---------------------------------------------------------------------------
--  Priority
-- ---------------------------------------------------------------------------

--- The ranks a player holds (any of his identifiers): w_core's members where the ranks are w_core's
--- (Red River), otherwise the one wc_admins role of the generic connector.
local function ranksOf(keys)
    local held, out = {}, {}
    local function add(rank)
        if type(rank) == 'string' and not held[rank] then held[rank] = true; out[#out + 1] = rank end
    end
    for _, key in ipairs(keys) do
        if Perms.members then
            local m = Perms.members[key]
            for _, rank in ipairs(m and m.ranks or {}) do add(rank) end
        else
            local ok, admin = pcall(Perms.adminOf, key)
            if ok and admin then add(admin.group) end
        end
    end
    return out
end

function Entry.isStaff(ids)
    return #ranksOf(keysOf(ids)) > 0
end

--- 1.1.2: the VIP tier's queue points (w_vip, a soft dependency): points, tier. A connecting player has no
--- server id yet, so the tier is asked by his Cfx.re identifier; 0, 0 when w_vip does not run.
--- 1.1.3: + the queue priority bought in the server store (w_vip 1.1.0 PerkOfIdentifiers: tier + extras), kept
--- one point under MAX_POINTS so staff always stay first.
local function vipPointsOf(ids)
    if not ids.fivem or ids.fivem == '' or GetResourceState('w_vip') ~= 'started' then return 0, 0 end
    local list = { 'fivem:' .. ids.fivem }
    local ok, tier = pcall(function() return exports.w_vip:TierOfIdentifiers(list) end)
    tier = ok and tonumber(tier) or 0
    local okP, points = pcall(function() return exports.w_vip:PerkOfIdentifiers(list, 'queue_points', 0) end)
    points = okP and tonumber(points) or 0
    return math.min(points, MAX_POINTS - 1), tier
end

--- points, sources ({ 'rank:admin', 'discord:<roleId>', 'player', 'shop', 'vip:<tier>', 'grace' }).
function Entry.priorityOf(ids, discordRoles)
    local best, sources, now = 0, {}, os.time()
    local function offer(points, source)
        points = tonumber(points) or 0
        if points <= 0 then return end
        sources[#sources + 1] = source
        if points > best then best = math.min(points, MAX_POINTS) end
    end

    local keys = keysOf(ids)
    local rankPoints = Entry.settings.rank_points or {}
    for _, rank in ipairs(ranksOf(keys)) do offer(rankPoints[rank], 'rank:' .. rank) end

    if discordRoles then
        for _, row in ipairs(Entry.settings.discord_role_points or {}) do
            if discordRoles[tostring(row.roleId)] then offer(row.points, 'discord:' .. tostring(row.roleId)) end
        end
    end

    local keySet = {}
    for _, k in ipairs(keys) do keySet[k] = true end
    for _, row in ipairs(Entry.priorities) do
        local live = row.expires_at == nil or tonumber(row.expires_at) > now
        if live and rowMatches(row, keySet) then
            offer(row.points, row.source == 'shop' and 'shop' or 'player')
        end
    end

    local vipPoints, vipTier = vipPointsOf(ids)
    offer(vipPoints, vipTier > 0 and ('vip:' .. vipTier) or 'store')   -- 'store' = priority bought alone (1.1.3)

    local license = ids.license and ids.license:lower()
    if license and Entry.grace[license] and Entry.grace[license] > now then offer(GRACE_POINTS, 'grace') end
    return best, sources
end

-- ---------------------------------------------------------------------------
--  Seats
-- ---------------------------------------------------------------------------

function Entry.maxSlots()
    return GetConvarInt('sv_maxclients', 48)
end

local function endpointAlive(src)
    return GetPlayerEndpoint(src) ~= nil
end

local function connectingCount()
    local now, n = os.time(), 0
    for src, c in pairs(Entry.connecting) do
        if not endpointAlive(src) then c.lostAt = c.lostAt or now else c.lostAt = nil end
        if now - c.at > CONNECT_TIMEOUT or (c.lostAt and now - c.lostAt > LOST_TIMEOUT) then
            Entry.connecting[src] = nil
        else
            n = n + 1
        end
    end
    return n
end

function Entry.occupied()
    return #GetPlayers() + connectingCount()
end

-- ---------------------------------------------------------------------------
--  Bans and whitelist
-- ---------------------------------------------------------------------------

--- nil when the join may go on, otherwise the text to refuse it with. The server's one ban store is
--- w_core's `bans` (2026-10-22): a ban from the website, from w_admin or from the anti-cheat keeps the
--- player out here, by license, Steam or Discord. An expired ban is closed there on contact.
local function banCheck(ids)
    if GetResourceState('w_core') ~= 'started' then return nil end
    local ok, ban, text = pcall(function() return exports.w_core:CheckBan(ids) end)
    if not ok then
        print('^3[w_connector] [queue] ban check failed, allowing the join: ' .. tostring(ban) .. '^0')
        return nil
    end
    if not ban then return nil end
    local reason = ban.reason ~= nil and ban.reason ~= '' and ban.reason or t('no_reason')
    local when = tonumber(ban.expire)
    local tail = (when and when < 2147483647) and t('ban_until'):format(os.date('%Y-%m-%d %H:%M', when)) or t('ban_perm')
    return t('banned'):format(reason, tail)
end

--- true / false, or nil when the database could not answer. Matches by Steam OR Discord.
local function whitelisted(ids)
    local clauses, values = {}, {}
    if ids.steam and ids.steam ~= '' then
        clauses[#clauses + 1] = '`steam_hex` = ?'; values[#values + 1] = ids.steam
    end
    if ids.discord and ids.discord ~= '' then
        clauses[#clauses + 1] = '(`discord_id` <> \'\' AND `discord_id` = ?)'; values[#values + 1] = ids.discord
    end
    if #clauses == 0 then return false end
    local ok, row = pcall(MySQL.single.await,
        'SELECT `steam_hex` FROM `wc_whitelist` WHERE `status` = \'active\' AND (' ..
        table.concat(clauses, ' OR ') .. ') LIMIT 1', values)
    if not ok then return nil end
    return row ~= nil
end
Entry.whitelisted = whitelisted

-- ---------------------------------------------------------------------------
--  The queue
-- ---------------------------------------------------------------------------

local seq = 0

local function finish(e, reason)
    if e.done then return end
    e.done = true
    pcall(function()
        if reason then e.deferrals.done(reason) else e.deferrals.done() end
    end)
end

local function removeAt(i, reason)
    local e = table.remove(Entry.queue, i)
    if e then finish(e, reason) end
    return e
end

local function sortQueue()
    table.sort(Entry.queue, function(a, b)
        if (a.front ~= nil) ~= (b.front ~= nil) then return a.front ~= nil end
        if a.front and b.front and a.front ~= b.front then return a.front < b.front end
        if a.priority ~= b.priority then return a.priority > b.priority end
        return a.seq < b.seq
    end)
end

local function admit(e)
    local license = e.ids.license and e.ids.license:lower()
    if license and Entry.grace[license] then Entry.grace[license] = nil end
    Entry.connecting[e.src] = { license = license, at = os.time() }
    finish(e)
end

--- Re-read every waiting player's priority (a rank, a setting or a priority changed on the site).
function Entry.reprioritize()
    for _, e in ipairs(Entry.queue) do
        e.priority, e.sources = Entry.priorityOf(e.ids, e.discordRoles)
    end
    sortQueue()
end

local function updateTexts(now)
    local total = #Entry.queue
    for i, e in ipairs(Entry.queue) do
        local prio = e.priority > 0 and t('queue_prio'):format(e.priority) or ''
        local text = t('queue'):format(i, total, prio, clock(now - e.joined))
        if text ~= e.lastText or now - (e.lastUpdate or 0) >= 5 then
            e.lastText, e.lastUpdate = text, now
            pcall(function() e.deferrals.update(text) end)
        end
    end
end

function Entry.tick()
    local now = os.time()
    for i = #Entry.queue, 1, -1 do
        local e = Entry.queue[i]
        if e.done or not endpointAlive(e.src) then
            table.remove(Entry.queue, i)
        elseif Entry.settings.closed and not e.staff then
            removeAt(i, t('closed'))
        end
    end
    if #Entry.queue == 0 then return end

    sortQueue()
    local free = Entry.maxSlots() - Entry.occupied()
    while free > 0 and #Entry.queue > 0 do
        admit(table.remove(Entry.queue, 1))
        free = free - 1
    end
    updateTexts(now)
end

CreateThread(function()
    while true do
        Wait(1000)
        local ok, err = pcall(Entry.tick)
        if not ok then print('^1[w_connector] [queue] tick error: ' .. tostring(err) .. '^0') end
    end
end)

-- ---------------------------------------------------------------------------
--  The gate
-- ---------------------------------------------------------------------------

AddEventHandler('playerConnecting', function(name, _, deferrals)
    local src = source
    deferrals.defer()

    CreateThread(function()
        Wait(0)
        deferrals.update(t('checking'))

        local waited = 0
        while not Entry.ready and waited < WAIT_FOR_DB_MS do
            Wait(200)
            waited = waited + 200
        end

        local ids = Vorp.identifiers(src)
        if not ids.license or ids.license == '' then return deferrals.done(t('no_license')) end
        local staff = Entry.isStaff(ids)

        if Entry.settings.closed and not staff then return deferrals.done(t('closed')) end

        local banned = banCheck(ids)
        if banned then return deferrals.done(banned) end

        if Entry.settings.whitelist_enabled and not staff then
            local allowed = whitelisted(ids)
            if allowed == nil then return deferrals.done(t('wl_retry')) end
            if not allowed then return deferrals.done(t('whitelist')) end
        end

        -- Discord roles only when some role is worth points (one request, cached, five seconds at most).
        local discordRoles
        if #(Entry.settings.discord_role_points or {}) > 0 and ids.discord then
            discordRoles = discordRolesOf(ids.discord)
        end
        if not endpointAlive(src) then return end   -- he left while we were checking

        local priority, sources = Entry.priorityOf(ids, discordRoles)
        local license = ids.license:lower()

        -- The same account again (a crash, a second click): it takes over its old place in the line.
        for i, old in ipairs(Entry.queue) do
            if old.ids.license and old.ids.license:lower() == license then
                table.remove(Entry.queue, i)
                finish(old, t('replaced'))
                seq = seq + 1
                local e = { id = seq, seq = old.seq, joined = old.joined, front = old.front,
                            src = src, name = H.str(name, 64), ids = ids, staff = staff,
                            priority = priority, sources = sources, discordRoles = discordRoles,
                            deferrals = deferrals }
                Entry.queue[#Entry.queue + 1] = e
                sortQueue()
                return updateTexts(os.time())
            end
        end

        -- Nobody waiting and a seat free: straight in.
        if #Entry.queue == 0 and Entry.occupied() < Entry.maxSlots() then
            local license_ = license
            if Entry.grace[license_] then Entry.grace[license_] = nil end
            Entry.connecting[src] = { license = license_, at = os.time() }
            return deferrals.done()
        end

        seq = seq + 1
        Entry.queue[#Entry.queue + 1] = {
            id = seq, seq = seq, joined = os.time(), src = src, name = H.str(name, 64), ids = ids,
            staff = staff, priority = priority, sources = sources, discordRoles = discordRoles,
            deferrals = deferrals,
        }
        sortQueue()
        updateTexts(os.time())
    end)
end)

--- The let-through player reached the game: his seat is now counted by GetPlayers().
AddEventHandler('playerJoining', function(oldId)
    local old = tonumber(oldId)
    if old then Entry.connecting[old] = nil end
end)

--- A crash or a timeout earns a short way back in; leaving on purpose does not.
AddEventHandler('playerDropped', function(reason)
    local src = source
    local minutes = tonumber(Entry.settings.grace_minutes) or 0
    if minutes <= 0 then return end
    local why = tostring(reason or ''):lower()
    if why:find('exit') or why:find('quit') or why:find('kick') or why:find('ban') then return end
    local license = GetPlayerIdentifierByType(src, 'license')
    if license and license ~= '' then
        Entry.grace[license:lower()] = os.time() + minutes * 60
    end
end)

-- ---------------------------------------------------------------------------
--  Boot and upkeep
-- ---------------------------------------------------------------------------

CreateThread(function()
    Schema.await(WAIT_FOR_DB_MS)
    local ok, err = pcall(loadSettings)
    if not ok then
        print('^1[w_connector] [queue] settings unreadable, using the defaults: ' .. tostring(err) .. '^0')
        applyDefaults()
    end
    pcall(Entry.loadPriorities)
    Entry.ready = true

    local sweeps = 0
    while true do
        Wait(60000)
        pcall(Entry.loadPriorities)
        local now = os.time()
        for license, untilAt in pairs(Entry.grace) do
            if untilAt <= now then Entry.grace[license] = nil end
        end
        for id, c in pairs(discordCache) do
            if now - c.at > DISCORD_TTL then discordCache[id] = nil end
        end
        sweeps = sweeps + 1
        if sweeps % 60 == 0 then
            -- rows that ran out more than a week ago (the panel shows a week of expired ones)
            pcall(MySQL.update.await, 'DELETE FROM `wc_priority` WHERE `expires_at` IS NOT NULL AND `expires_at` < ?',
                { now - 7 * 86400 })
        end
    end
end)

-- a rank given or taken on the site or in game moves the people already waiting
AddEventHandler('w_core:ranks:changed', function()
    SetTimeout(500, function() pcall(Entry.reprioritize) end)
end)

-- 1.1.2: so does a VIP tier gained, changed or ended (w_vip's server-local event)
AddEventHandler('w_vip:changed', function()
    SetTimeout(500, function() pcall(Entry.reprioritize) end)
end)
