--- The website's Entry tab: the queue, the priorities and the switches of the way in.
---
--- The engine is server/sv_queue.lua (`Entry`, loaded after the handlers; every handler below only
--- reaches it when called). `adminpanel:addQueuePriority` is also what the site's store delivers a
--- bought priority through (shopDelivery.ts, kind `queue_priority`), with the owner as actor and an
--- order id that makes a retried delivery land once. It does not need the buyer online.

local MAX_POINTS = 1000

--- 'discord:<id>' | 'license:<hex>' | 'steam:<hex>' from what staff typed (a bare Discord id, Steam
--- hex or license hash is recognised), or nil.
local function parseIdentifier(value)
    local s = tostring(value or ''):lower():gsub('%s', '')
    if s == '' then return nil end
    local kind, rest = s:match('^(%a+):(.+)$')
    if not kind then
        if s:match('^%d+$') and #s >= 15 and #s <= 22 then return 'discord:' .. s end
        if s:match('^1[01]0000%x+$') then return 'steam:' .. s end
        if s:match('^%x+$') and #s == 40 then return 'license:' .. s end
        return nil
    end
    if kind == 'discord' and rest:match('^%d+$') and #rest >= 15 and #rest <= 22 then return s end
    if (kind == 'steam' or kind == 'license') and rest:match('^%x+$') and #rest >= 8 then return s end
    return nil
end

--- The identifiers of an online player: the main one (Discord first: the store and the site know
--- players by it) and the others, comma separated.
local function identifiersOfSource(src)
    local ids = Vorp.identifiers(src)
    local list = {}
    if ids.discord then list[#list + 1] = 'discord:' .. ids.discord end
    if ids.license then list[#list + 1] = ids.license:lower() end
    if ids.steam then list[#list + 1] = 'steam:' .. ids.steam:lower() end
    if #list == 0 then return nil end
    local main = table.remove(list, 1)
    return main, table.concat(list, ','), GetPlayerName(src)
end

local function points(v)
    local n = tonumber(v)
    if not n or n ~= n or n < 1 or n > MAX_POINTS then return nil end
    return math.floor(n)
end

local function done(actor, action, details)
    Log.write(actor, 'admin_action', action, details)
    pcall(Entry.loadPriorities)
    pcall(Entry.reprioritize)
    return H.ok()
end

-- ---------------------------------------------------------------------------
--  Read
-- ---------------------------------------------------------------------------

Registry.invoke('adminpanel:getEntryState', 'queue.view', function()
    local s = Entry.settings
    local now = os.time()

    local queue = {}
    for i, e in ipairs(Entry.queue) do
        queue[#queue + 1] = {
            id = e.id, position = i, name = e.name, priority = e.priority, sources = e.sources or {},
            waited = now - e.joined, front = e.front ~= nil,
            discordId = e.ids.discord, license = e.ids.license, steam = e.ids.steam,
        }
    end

    local ranks = {}
    for _, r in ipairs(Perms.list()) do
        ranks[#ranks + 1] = { name = r.name, label = r.label, color = r.color,
                              points = tonumber((s.rank_points or {})[r.name]) or 0 }
    end

    local priorities = {}
    for _, row in ipairs(Entry.priorities) do
        priorities[#priorities + 1] = {
            id = row.id, identifier = row.identifier, kind = row.identifier:match('^(%a+):') or 'license',
            altIds = row.alt_ids, name = row.name, points = row.points,
            expiresAt = row.expires_at and tonumber(row.expires_at) or json.null,
            expired = row.expires_at ~= nil and tonumber(row.expires_at) <= now,
            source = row.source, note = row.note, addedBy = row.added_by, createdAt = row.created_at,
        }
    end
    table.sort(priorities, function(a, b) return (a.createdAt or 0) > (b.createdAt or 0) end)

    local connecting = 0
    for _ in pairs(Entry.connecting) do connecting = connecting + 1 end

    return {
        settings = {
            whitelistEnabled = s.whitelist_enabled == true,
            closed = s.closed == true,
            graceMinutes = tonumber(s.grace_minutes) or 0,
            maxSlots = Entry.maxSlots(),
        },
        online = #GetPlayers(),
        connecting = connecting,
        queue = queue,
        ranks = ranks,
        discordRoles = s.discord_role_points or {},
        discordConfigured = Entry.discordReady(),
        priorities = priorities,
        now = now,
    }
end)

-- ---------------------------------------------------------------------------
--  Switches
-- ---------------------------------------------------------------------------

Registry.invoke('adminpanel:setEntrySettings', 'queue.manage', function(actor, args)
    args = type(args) == 'table' and args or {}
    local by, changed = actor.label or 'Web Admin', {}

    if args.whitelistEnabled ~= nil then
        Entry.saveSetting('whitelist_enabled', args.whitelistEnabled == true, by)
        changed[#changed + 1] = 'whitelist ' .. (args.whitelistEnabled == true and 'on' or 'off')
    end
    if args.closed ~= nil then
        local closed = args.closed == true
        local was = Entry.settings.closed == true
        Entry.saveSetting('closed', closed, by)
        changed[#changed + 1] = closed and 'closed' or 'open'
        if was ~= closed then
            ConnectorAnnounce(closed and 'The server is now closed to new players.' or 'The server is open again.')
        end
    end
    if args.graceMinutes ~= nil then
        local minutes = tonumber(args.graceMinutes)
        if not minutes or minutes ~= minutes or minutes < 0 or minutes > 60 then return H.fail('invalid_points') end
        Entry.saveSetting('grace_minutes', math.floor(minutes), by)
        changed[#changed + 1] = ('grace %d min'):format(math.floor(minutes))
    end
    if type(args.rankPoints) == 'table' then
        local merged = {}
        for k, v in pairs(Entry.settings.rank_points or {}) do merged[k] = v end
        for name, value in pairs(args.rankPoints) do
            if type(name) ~= 'string' or not name:match('^[a-z][a-z0-9_]*$') or #name > 32 then
                return H.fail('invalid_rank')
            end
            local n = tonumber(value)
            if not n or n ~= n or n < 0 or n > MAX_POINTS then return H.fail('invalid_points') end
            merged[name] = n > 0 and math.floor(n) or nil
        end
        Entry.saveSetting('rank_points', merged, by)
        changed[#changed + 1] = 'rank points'
    end
    if type(args.discordRolePoints) == 'table' then
        local list, seen = {}, {}
        for _, row in ipairs(args.discordRolePoints) do
            local roleId = type(row) == 'table' and tostring(row.roleId or ''):gsub('%D', '') or ''
            local n = type(row) == 'table' and tonumber(row.points) or nil
            if roleId == '' or #roleId > 22 then return H.fail('invalid_identifier') end
            if not n or n ~= n or n < 0 or n > MAX_POINTS then return H.fail('invalid_points') end
            if not seen[roleId] and n > 0 then
                seen[roleId] = true
                list[#list + 1] = { roleId = roleId, points = math.floor(n) }
            end
            if #list >= 50 then break end
        end
        Entry.saveSetting('discord_role_points', list, by)
        changed[#changed + 1] = 'discord role points'
    end

    if #changed == 0 then return H.fail('nothing_to_change') end
    pcall(Entry.reprioritize)
    Log.write(actor, 'server_event', 'Entry settings', table.concat(changed, ', '), { severity = 'high' })
    return H.ok()
end)

-- ---------------------------------------------------------------------------
--  Player priorities
-- ---------------------------------------------------------------------------

Registry.invoke('adminpanel:setPriority', 'queue.manage', function(actor, args)
    args = type(args) == 'table' and args or {}
    local p = points(args.points)
    if not p then return H.fail('invalid_points') end

    local identifier, alt, name
    if args.identifier and args.identifier ~= '' then
        identifier = parseIdentifier(args.identifier)
        if not identifier then return H.fail('invalid_identifier') end
        alt, name = '', H.str(args.name, 100)
    else
        local src = H.liveSource(H.playerRef(args))
        if not src then return H.fail('player_not_online') end
        identifier, alt, name = identifiersOfSource(src)
        if not identifier then return H.fail('invalid_identifier') end
        if args.name and args.name ~= '' then name = H.str(args.name, 100) end
    end

    -- no days = permanent. 0 stands for NULL in the statements below (a nil inside a parameter
    -- list would cut it short), and NULLIF turns it back.
    local days = tonumber(args.days)
    local expires = 0
    if days ~= nil then
        if days ~= days or days < 1 or days > 3650 then return H.fail('invalid_points') end
        expires = os.time() + math.floor(days * 86400)
    end
    local note, by = H.str(args.note, 255), H.str(actor.label or 'Web Admin', 100)

    local existing = MySQL.single.await(
        'SELECT `id` FROM `wc_priority` WHERE `source` = \'manual\' AND `identifier` = ? LIMIT 1', { identifier })
    if existing then
        MySQL.update.await(
            'UPDATE `wc_priority` SET `points` = ?, `expires_at` = NULLIF(?, 0), `note` = ?, `added_by` = ?, ' ..
            '`name` = COALESCE(NULLIF(?, \'\'), `name`), `alt_ids` = COALESCE(NULLIF(?, \'\'), `alt_ids`) WHERE `id` = ?',
            { p, expires, note, by, H.str(name, 100), alt or '', existing.id })
    else
        MySQL.insert.await(
            'INSERT INTO `wc_priority` (`identifier`,`alt_ids`,`name`,`points`,`expires_at`,`source`,`note`,`added_by`,`created_at`) ' ..
            'VALUES (?,?,?,?,NULLIF(?, 0),\'manual\',?,?,?)',
            { identifier, alt or '', H.str(name, 100), p, expires, note, by, os.time() })
    end
    return done(actor, 'Set queue priority', ('%s = %d%s'):format(identifier, p,
        expires > 0 and (' for %d day(s)'):format(math.floor(days)) or ' (permanent)'))
end)

Registry.invoke('adminpanel:removePriority', 'queue.manage', function(actor, args)
    local id = H.int(type(args) == 'table' and args.id or args, nil)
    if not id then return H.fail('not_found') end
    local row = MySQL.single.await('SELECT `identifier`, `points` FROM `wc_priority` WHERE `id` = ?', { id })
    if not row then return H.fail('not_found') end
    MySQL.update.await('DELETE FROM `wc_priority` WHERE `id` = ?', { id })
    return done(actor, 'Removed queue priority', ('%s (%d)'):format(row.identifier, row.points))
end)

--- A bought priority (the store). Several purchases stack in time: the new one starts when the
--- player's current priority of at least the same points runs out, so nothing bought is wasted.
Registry.invoke('adminpanel:addQueuePriority', 'queue.manage', function(actor, args)
    args = type(args) == 'table' and args or {}
    local p = points(args.points)
    if not p then return H.fail('invalid_points') end
    local days = tonumber(args.days)
    if not days or days ~= days or days < 1 or days > 365 then return H.fail('invalid_points') end
    local qty = math.max(1, math.min(50, math.floor(tonumber(args.qty) or 1)))

    local ids = {}
    local discordId = tostring(args.discordId or ''):gsub('%D', '')
    if discordId ~= '' then ids[#ids + 1] = parseIdentifier('discord:' .. discordId) end
    if args.license and args.license ~= '' then
        local lic = tostring(args.license):lower()
        ids[#ids + 1] = parseIdentifier(lic:find(':') and lic or ('license:' .. lic))
    end
    if args.steam and args.steam ~= '' then
        local st = tostring(args.steam):lower()
        ids[#ids + 1] = parseIdentifier(st:find(':') and st or ('steam:' .. st))
    end
    local clean = {}
    for _, id in pairs(ids) do if id then clean[#clean + 1] = id end end
    if #clean == 0 then return H.fail('invalid_identifier') end
    local identifier = table.remove(clean, 1)

    local orderId = H.str(args.orderId, 64)
    if orderId ~= '' then
        local seen = MySQL.single.await('SELECT `id` FROM `wc_priority` WHERE `order_id` = ?', { orderId })
        if seen then return H.ok('already_delivered') end
    end

    local now = os.time()
    local latest = MySQL.scalar.await(
        'SELECT MAX(`expires_at`) FROM `wc_priority` WHERE `source` = \'shop\' AND `identifier` = ? ' ..
        'AND `points` >= ? AND `expires_at` > ?', { identifier, p, now })
    local start = math.max(now, tonumber(latest) or 0)
    local expires = start + math.floor(days * qty * 86400)

    MySQL.insert.await(
        'INSERT INTO `wc_priority` (`identifier`,`alt_ids`,`name`,`points`,`expires_at`,`source`,`order_id`,`note`,`added_by`,`created_at`) ' ..
        'VALUES (?,?,?,?,?,\'shop\',NULLIF(?, \'\'),?,?,?)',
        { identifier, table.concat(clean, ','), H.str(args.name, 100), p, expires,
          orderId, ('store: %d day(s) x%d'):format(math.floor(days), qty),
          H.str(actor.label or 'Wraith Shop', 100), now })
    return done(actor, 'Store queue priority', ('%s = %d until %s'):format(identifier, p, os.date('%Y-%m-%d', expires)))
end)

-- ---------------------------------------------------------------------------
--  The live queue
-- ---------------------------------------------------------------------------

Registry.invoke('adminpanel:queueAction', 'queue.manage', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = H.int(args.id, nil)
    for i, e in ipairs(Entry.queue) do
        if e.id == id and not e.done then
            if args.action == 'front' then
                e.front = os.clock()
                Entry.reprioritize()
                Log.write(actor, 'admin_action', 'Moved to the front of the queue', e.name)
                return H.ok()
            elseif args.action == 'remove' then
                table.remove(Entry.queue, i)
                e.done = true
                pcall(function()
                    e.deferrals.done(GetConvar('w_lib:locale', 'ar') == 'en' and 'Staff removed you from the queue.'
                        or 'أخرجتك الإدارة من الطابور.')
                end)
                Log.write(actor, 'admin_action', 'Removed from the queue', e.name)
                return H.ok()
            end
            return H.fail('invalid_action')
        end
    end
    return H.fail('queue_entry_gone')
end)
