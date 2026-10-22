--- Players: the page, the profile edits, the inventory, and every moderation verb.
---
--- Every write here works on ONLINE and OFFLINE targets. Online goes through the VORP character
--- object so the running game sees the change immediately; offline goes straight to `characters`.
--- Which one applies is decided by `H.liveSource`, not by what the website believed when the page
--- last loaded — server ids get reused, and acting on a stale one means moderating the wrong person.

local PAGE_SIZE = 10

-- ---------------------------------------------------------------------------
--  Playtime
-- ---------------------------------------------------------------------------

local function playtimeOf(charId)
    if not charId then return 0 end
    local r = MySQL.single.await('SELECT `seconds` FROM `wc_playtime` WHERE `char_id` = ?', { tonumber(charId) })
    return tonumber(r and r.seconds) or 0
end

local function playtimeMany(charIds)
    local out = {}
    if type(charIds) ~= 'table' or #charIds == 0 then return out end
    local nums = {}
    for _, id in ipairs(charIds) do
        local n = tonumber(id)
        if n then nums[#nums + 1] = tostring(math.floor(n)) end
    end
    if #nums == 0 then return out end
    local rows = MySQL.query.await(
        'SELECT `char_id`, `seconds` FROM `wc_playtime` WHERE `char_id` IN (' .. table.concat(nums, ',') .. ')') or {}
    for _, r in ipairs(rows) do out[tonumber(r.char_id)] = tonumber(r.seconds) or 0 end
    return out
end

--- One minute of credit per minute online, per character. Cheap, and it is the only source of this
--- number on a VORP server.
CreateThread(function()
    Schema.await()
    while true do
        Wait(60000)
        for _, sid in ipairs(Players.online()) do
            local p = Players.get(sid)
            if p and p.id then
                pcall(function()
                    MySQL.insert.await(
                        'INSERT INTO `wc_playtime` (`char_id`,`identifier`,`seconds`) VALUES (?,?,60) ' ..
                        'ON DUPLICATE KEY UPDATE `seconds` = `seconds` + 60',
                        { p.id, p.identifier or '' })
                end)
            end
        end
    end
end)

-- ---------------------------------------------------------------------------
--  Reads
-- ---------------------------------------------------------------------------

--- The player's level: w_level's when it runs (the framework's `xp` metadata is w_core's per-skill table).
local function levelOf(sid, snap)
    if GetResourceState('w_level') == 'started' then
        local ok, n = pcall(function() return exports.w_level:GetPlayerLevel(sid) end)
        if ok and tonumber(n) then return tonumber(n) end
    end
    return tonumber(snap and snap.xp) or 0
end

local function onlineRow(sid)
    local snap = Vorp.snapshot(sid)
    local cached = Players.get(sid) or {}
    local identifier = (snap and snap.identifier) or cached.identifier
    local av = Players.avatars[identifier or ''] or {}
    return {
        id = (snap and snap.charId) or cached.id,
        source = sid,
        -- the id staff type everywhere (players.citizenid): shown, searched, and accepted back as
        -- `citizenid` in a player reference (H.playerRef)
        citizenid = (snap and snap.citizenid and tostring(snap.citizenid)) or w.citizen.idOf(sid),
        characterName = (snap and snap.characterName) or cached.characterName or GetPlayerName(sid),
        username = (snap and snap.nickname) or cached.username or GetPlayerName(sid),
        identifier = identifier,
        job = (snap and (snap.jobLabel or snap.job)) or cached.jobLabel or cached.job or 'N/A',
        jobName = (snap and snap.job) or cached.job,
        jobGrade = (snap and snap.jobGrade) or cached.jobGrade or 0,
        money = (snap and snap.money) or 0,
        gold = (snap and snap.gold) or 0,
        bank = (snap and snap.rol) or 0,
        level = levelOf(sid, snap),
        playtime = playtimeOf((snap and snap.charId) or cached.id),
        lastLogin = cached.lastLogin,
        online = true,
        ping = GetPlayerPing(sid),
        -- Withheld unless the owner opted in. An IP is personal data and most owners neither need
        -- it nor want it mirrored into a browser.
        endPoint = Config.showIpAddress and (cached.endPoint or GetPlayerEndpoint(sid)) or nil,
        DiscordData = {
            id = cached.discordId,
            username = av.discord_username,
            avatar = av.avatar_url,
        },
    }
end

local function offlineRow(r, playtimes)
    local name = ((r.firstname or '') .. ' ' .. (r.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')
    local av = Players.avatars[r.identifier or ''] or {}
    return {
        id = tonumber(r.charidentifier),
        source = nil,
        citizenid = r.citizenid ~= nil and tostring(r.citizenid) or nil,
        characterName = (name ~= '' and name) or r.nickname or r.steamname or 'Unknown',
        username = r.nickname or r.steamname or '',
        identifier = r.identifier,
        job = r.joblabel or r.job or 'N/A',
        jobName = r.job,
        jobGrade = tonumber(r.jobgrade) or 0,
        money = tonumber(r.money) or 0,
        gold = tonumber(r.gold) or 0,
        bank = tonumber(r.rol) or 0,
        -- with w_level the level is its own table: the profile reads it (getCharacterInfo), the list leaves it out
        level = GetResourceState('w_level') ~= 'started' and (tonumber(r.xp) or 0) or nil,
        playtime = playtimes[tonumber(r.charidentifier)] or 0,
        lastLogin = r.LastLogin,
        online = false,
        ping = 0,
        DiscordData = {
            id = av.discord_id,
            username = av.discord_username,
            avatar = av.avatar_url,
        },
    }
end

Registry.invoke('adminpanel:getPlayersPage', 'players_page', function(actor, args)
    args = type(args) == 'table' and args or {}
    local page = math.max(H.int(args.page, 1) or 1, 1)
    local search = H.str(args.searchTerm or args.search, 64)
    if search == '' then search = nil end

    -- A search that is an id matches that id alone: a citizen id that character whole ('1' is not
    -- 12, and not every licence whose hex holds a "1"), '#5' whoever is on server id 5 (the same
    -- convention as every in-game input). Anything else searches the text as before.
    local searchKind, searchId = nil, nil
    if search then searchKind, searchId = w.citizen.parse(search) end
    if searchKind == 'self' then searchKind = nil end

    -- Online first, always in full: there are rarely more than a couple of dozen, and an admin
    -- looking for someone to act on is almost always looking for someone who is playing.
    local online, onlineIds = {}, {}
    for _, sid in ipairs(Players.online()) do
        local row = onlineRow(sid)
        local haystack = ((row.characterName or '') .. ' ' .. (row.username or '') .. ' ' ..
                          (row.identifier or '')):lower()
        local match
        if not search then
            match = true
        elseif searchKind == 'citizen' then
            match = row.citizenid == searchId
        elseif searchKind == 'server' then
            match = sid == searchId
        else
            match = haystack:find(search:lower(), 1, true) ~= nil
        end
        if match then
            online[#online + 1] = row
        end
        if row.id then onlineIds[#onlineIds + 1] = row.id end
    end

    local totalOnline = #online
    local offlineTotal = Vorp.countCharacters(search, onlineIds)

    -- One virtual list: the online rows occupy the first slots, offline rows continue from there.
    local from = (page - 1) * PAGE_SIZE
    local players = {}

    for i = from + 1, math.min(from + PAGE_SIZE, totalOnline) do
        players[#players + 1] = online[i]
    end

    local stillNeeded = PAGE_SIZE - #players
    if stillNeeded > 0 then
        local offlineOffset = math.max(from - totalOnline, 0)
        local rows = Vorp.offlineCharacters(search, stillNeeded, offlineOffset, onlineIds)
        local playtimes = {}
        local ids = {}
        for _, r in ipairs(rows) do ids[#ids + 1] = r.charidentifier end
        playtimes = playtimeMany(ids)
        for _, r in ipairs(rows) do players[#players + 1] = offlineRow(r, playtimes) end
    end

    return {
        players = players,
        totalPlayers = totalOnline + offlineTotal,
        totalOnline = totalOnline,
        offlinePlayers = offlineTotal,
    }
end)

--- The lightweight list the bridge exposes as a `read`.
Registry.read('getPlayersList', 'players_page', function()
    local out = {}
    for _, sid in ipairs(Players.online()) do
        local snap = Vorp.snapshot(sid)
        local cached = Players.get(sid) or {}
        out[#out + 1] = {
            source = sid,
            id = (snap and snap.charId) or cached.id,
            citizenid = (snap and snap.citizenid and tostring(snap.citizenid)) or w.citizen.idOf(sid),
            name = (snap and snap.characterName) or cached.characterName or GetPlayerName(sid),
            username = (snap and snap.nickname) or cached.username,
            identifier = (snap and snap.identifier) or cached.identifier,
            job = (snap and snap.job) or cached.job,
            jobLabel = (snap and snap.jobLabel) or cached.jobLabel,
            discord = cached.discordId,
        }
    end
    return out
end)

--- The target of the two inventory verbs, which the website names with bare `playerId` /
--- `characterId`. A citizen id sent beside them (`citizenid`, as every row now carries it) decides
--- who it is, exactly as in H.playerRef, so these two verbs take the id staff use as well.
local function inventoryRef(args)
    return H.playerRef({ playerId = args.playerId, characterId = args.characterId,
                         citizenid = args.citizenid or args.citizenId })
end

Registry.invoke('getPlayerInventory', 'players_page', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = inventoryRef(args)
    local live = H.liveSource(ref)
    if live then return Inv.contents(live, ref.charId) end
    return Inv.offlineContents(ref.charId)
end)

Registry.invoke('getAvailableItems', 'add.item.to_player', function(actor, args)
    args = type(args) == 'table' and args or {}
    local search = H.str(args.search, 64):lower()
    local page = math.max(H.int(args.page, 1) or 1, 1)
    local limit = H.clamp(args.limit, 1, 100, 25)

    local pool = {}
    for _, e in ipairs(Inv.catalogue.items) do pool[#pool + 1] = e end
    for _, e in ipairs(Inv.catalogue.weapons) do pool[#pool + 1] = e end

    local matched = {}
    for _, e in ipairs(pool) do
        if search == '' or (e.label or ''):lower():find(search, 1, true) or (e.name or ''):lower():find(search, 1, true) then
            matched[#matched + 1] = e
        end
    end

    local out, from = {}, (page - 1) * limit
    for i = from + 1, math.min(from + limit, #matched) do out[#out + 1] = matched[i] end
    return { items = out, total = #matched, page = page }
end)

-- ---------------------------------------------------------------------------
--  Warnings
-- ---------------------------------------------------------------------------

Registry.invoke('getPlayerWarnings', 'get_player_warnings', function(actor, args)
    args = type(args) == 'table' and args or {}
    local identifier = H.str(args.identifier, 100)
    if identifier == '' then return { warnings = {} } end
    local rows = MySQL.query.await(
        'SELECT `id`, `reason`, `severity`, `warned_by`, `warn_date` FROM `wc_warnings` ' ..
        'WHERE `player_identifier` = ? AND `is_active` = 1 ORDER BY `warn_date` DESC', { identifier }) or {}
    return { warnings = rows }
end)

Registry.invoke('removeWarning', 'player.removewarn', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.warningId or args.id)
    if not id then return H.fail('missing_warning_id') end
    local n = MySQL.update.await('UPDATE `wc_warnings` SET `is_active` = 0 WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('warning_not_found') end
    Log.write(actor, 'admin_action', 'Removed warning', 'Warning #' .. id)
    return H.ok()
end)

-- ---------------------------------------------------------------------------
--  Character edits — each one online and offline
-- ---------------------------------------------------------------------------

--- Shared shape: resolve the target, apply online or offline, log, answer.
local function edit(actor, args, opts)
    local ref = H.playerRef(args)
    local value = opts.value
    if value == nil or value == '' then return H.fail('missing_value') end

    local live = H.liveSource(ref)
    local applied, reason
    if live then
        applied, reason = opts.online(live, value)
        -- Keep the cache honest so the next heartbeat reports the new value rather than the old.
        local cached = Players.get(live)
        if cached and opts.cacheKey then cached[opts.cacheKey] = value end
    else
        if not ref.charId then return H.fail('player_not_found') end
        applied = Vorp.setOffline(ref.charId, opts.column, value)
    end
    if not applied then return H.fail(reason or 'update_failed') end

    Log.write(actor, 'admin_action', opts.action, tostring(value),
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end

Registry.invoke('setNickname', 'set.nickname', function(actor, args)
    return edit(actor, args, {
        value = type(args) == 'table' and args.nickname or nil, column = 'nickname',
        cacheKey = 'username', action = 'Changed nickname',
        online = function(src, v) return Vorp.setNickname(src, v) end,
    })
end)

Registry.invoke('setFirstName', 'set.firstname', function(actor, args)
    return edit(actor, args, {
        value = type(args) == 'table' and args.firstName or nil, column = 'firstname',
        cacheKey = 'firstName', action = 'Changed first name',
        online = function(src, v) return Vorp.setFirstName(src, v) end,
    })
end)

Registry.invoke('setLastName', 'set.lastname', function(actor, args)
    return edit(actor, args, {
        value = type(args) == 'table' and args.lastName or nil, column = 'lastname',
        cacheKey = 'lastName', action = 'Changed last name',
        online = function(src, v) return Vorp.setLastName(src, v) end,
    })
end)

Registry.invoke('setAge', 'set.age', function(actor, args)
    local age = type(args) == 'table' and H.int(args.age) or nil
    if not age or age < 1 or age > 120 then return H.fail('invalid_age') end
    return edit(actor, args, {
        value = age, column = 'age', action = 'Changed age',
        online = function(src, v) return Vorp.setAge(src, v) end,
    })
end)

Registry.invoke('setCharacterDescription', 'set.chardescription', function(actor, args)
    return edit(actor, args, {
        value = type(args) == 'table' and H.str(args.description, 400) or nil, column = 'character_desc',
        cacheKey = 'description', action = 'Changed description',
        online = function(src, v) return Vorp.setDescription(src, v) end,
    })
end)

-- ---------------------------------------------------------------------------
--  Jobs
-- ---------------------------------------------------------------------------

Registry.invoke('getAvailableJobs', 'set.jobwithgrade', function()
    -- VORP HAS a job registry. w_admin returned an empty table for VORP and only populated this on
    -- RSGCore, so the panel's job picker was permanently blank for every RedM customer.
    local jobs = Vorp.registeredJobs()
    local out = {}
    for name, def in pairs(jobs) do
        if type(def) == 'table' then
            -- the Arabic name first (Wraith Core's jobs carry label_ar; the panel speaks Arabic)
            out[#out + 1] = { name = name, label = def.label_ar or def.label or name, grades = def.grades or def.Grades }
        else
            out[#out + 1] = { name = name, label = tostring(def) }
        end
    end
    table.sort(out, function(a, b) return (a.label or '') < (b.label or '') end)
    return { jobs = out }
end)

Registry.invoke('getPlayerJobs', 'players_page', function(actor, args)
    local ref = H.playerRef(args)
    local live = H.liveSource(ref)
    if live then
        local snap = Vorp.snapshot(live)
        if not snap then return { jobs = {} } end
        return { jobs = { { name = snap.job, label = snap.jobLabel, grade = snap.jobGrade, current = true } } }
    end
    if not ref.charId then return { jobs = {} } end
    local row = Vorp.offlineChar(ref.charId)
    if not row then return { jobs = {} } end
    return { jobs = { { name = row.job, label = row.joblabel, grade = tonumber(row.jobgrade) or 0, current = true } } }
end)

local function applyJob(actor, args, jobName, grade, label, action)
    local ref = H.playerRef(args)
    local live = H.liveSource(ref)
    local ok, reason
    if live then
        ok, reason = Vorp.setJob(live, jobName, grade, label)
        local cached = Players.get(live)
        if cached then
            if jobName then cached.job = jobName end
            if label then cached.jobLabel = label end
            if grade then cached.jobGrade = grade end
        end
    else
        if not ref.charId then return H.fail('player_not_found') end
        ok = true
        if jobName then ok = Vorp.setOffline(ref.charId, 'job', jobName) and ok end
        if label then ok = Vorp.setOffline(ref.charId, 'joblabel', label) and ok end
        if grade then ok = Vorp.setOffline(ref.charId, 'jobgrade', grade) and ok end
    end
    if not ok then return H.fail(reason or 'update_failed') end
    Log.write(actor, 'admin_action', action,
        ('%s (grade %s)'):format(tostring(jobName or label or '?'), tostring(grade or 0)),
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end

Registry.invoke('setPlayerJob', 'set.jobwithgrade', function(actor, args)
    args = type(args) == 'table' and args or {}
    local job = H.str(args.job or args.jobName, 64)
    if job == '' then return H.fail('missing_job') end
    return applyJob(actor, args, job, H.int(args.grade, 0), args.label, 'Set job')
end)

Registry.invoke('setJobWithGrade', 'set.jobwithgrade', function(actor, args)
    args = type(args) == 'table' and args or {}
    local job = H.str(args.job or args.jobName, 64)
    if job == '' then return H.fail('missing_job') end
    return applyJob(actor, args, job, H.int(args.grade or args.jobGrade, 0), args.label, 'Set job')
end)

Registry.invoke('setJobLabel', 'set.joblabel', function(actor, args)
    args = type(args) == 'table' and args or {}
    local label = H.str(args.label or args.jobLabel, 100)
    if label == '' then return H.fail('missing_label') end
    return applyJob(actor, args, nil, nil, label, 'Set job label')
end)

Registry.invoke('setJobGradeOnly', 'set.jobgrade', function(actor, args)
    args = type(args) == 'table' and args or {}
    local grade = H.int(args.grade or args.jobGrade)
    if not grade then return H.fail('missing_grade') end
    return applyJob(actor, args, nil, grade, nil, 'Set job grade')
end)

Registry.invoke('removePlayerJob', 'set.jobwithgrade', function(actor, args)
    return applyJob(actor, args, 'unemployed', 0, 'Unemployed', 'Removed job')
end)

-- ---------------------------------------------------------------------------
--  Inventory writes
-- ---------------------------------------------------------------------------

Registry.invoke('removeItemFromPlayer', 'remove.item.from_player', function(actor, args)
    args = type(args) == 'table' and args or {}
    local item = args.item
    local name = type(item) == 'table' and (item.name or item.item) or item
    if not name or name == '' then return H.fail('missing_item') end
    local count = math.max(H.int(args.count, 1) or 1, 1)
    local isWeapon = type(item) == 'table' and item.type == 'weapon'

    local ref = inventoryRef(args)
    local info = type(args.playerInfo) == 'table' and args.playerInfo or {}
    local live = H.liveSource(ref)

    -- `a and f() or g()` is not an if/else: when f() returns FALSE it falls through and runs g().
    -- Here that meant a failed WEAPON removal quietly went on to remove an ITEM by the same name
    -- instead — the caller was told the removal succeeded, and the wrong thing had been taken. The
    -- identical shape was already found and fixed once in addCash.
    local weaponId = type(item) == 'table' and item.id or nil
    local ok
    if live then
        if isWeapon then
            ok = Inv.removeWeapon(live, weaponId)
        else
            ok = Inv.removeItem(live, name, count)
        end
    else
        if not ref.charId then return H.fail('player_not_found') end
        if isWeapon then
            ok = Inv.offlineRemoveWeapon(ref.charId, weaponId)
        else
            ok = Inv.offlineRemoveItem(ref.charId, name, count)
        end
    end
    if not ok then return H.fail('remove_failed') end

    Log.write(actor, 'player_action', 'Removed item', ('%s x%d'):format(name, count),
        { name = info.characterName, identifier = info.identifier })
    return H.ok()
end)

--- Not called by the panel today, but it IS the natural target for a store product's delivery —
--- shopDelivery.ts lets an owner name any callback, and "give the buyer an item" is the most
--- obvious thing to name.
Registry.invoke('addItemsToPlayer', 'add.item.to_player', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local items = args.items
    if type(items) ~= 'table' then
        local single = args.item or args.itemName
        if not single then return H.fail('missing_items') end
        items = { { name = type(single) == 'table' and single.name or single, count = H.int(args.count, 1) or 1 } }
    end

    local live = H.liveSource(ref)
    local results, anyOk = {}, false
    for _, entry in ipairs(items) do
        local name = type(entry) == 'table' and (entry.name or entry.item) or entry
        local count = math.max(H.int(type(entry) == 'table' and entry.count or 1, 1) or 1, 1)
        local isWeapon = tostring(name):find('^weapon_') ~= nil
        local ok = false
        if live then
            if isWeapon then
                ok = Inv.giveWeapon(live, name)
            elseif Inv.canCarry(live, name, count) then
                ok = Inv.addItem(live, name, count)
            else
                results[#results + 1] = { item = name, success = false, message = 'cannot_carry' }
                goto continue
            end
        elseif ref.charId then
            -- Same trap as the removal path above: as `and/or`, a weapon that failed to be granted
            -- fell through and added a plain ITEM under the weapon's name, leaving an unusable entry
            -- in the player's bag and reporting success.
            if isWeapon then
                ok = Inv.offlineAddWeapon(ref.charId, ref.identifier, name)
            else
                ok = Inv.offlineAddItem(ref.charId, name, count)
            end
        end
        anyOk = anyOk or ok
        results[#results + 1] = { item = name, success = ok }
        ::continue::
    end

    if not anyOk then return H.fail('add_failed') end
    Log.write(actor, 'player_action', 'Gave items', json.encode(results),
        { name = ref.username, identifier = ref.identifier })
    return { success = true, results = results }
end)

-- ---------------------------------------------------------------------------
--  Money and XP
-- ---------------------------------------------------------------------------

Registry.invoke('addCash', 'currency.addorremove', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local amount = tonumber(args.amount)
    if not amount or amount <= 0 then return H.fail('invalid_amount') end
    local removing = tostring(args.action or 'add') == 'remove'
    local currency = Vorp.currencyFromPanel(args.currencyType)

    local live = H.liveSource(ref)
    local ok, reason
    if live then
        -- An if/else, not `removing and remove() or add()`. That chain reads naturally and is
        -- wrong: when a removal returned false it fell through to the `or` and ADDED the money
        -- instead — the one outcome nobody would ever want from a deduction.
        if removing then
            ok, reason = Vorp.removeCurrency(live, currency, amount)
        else
            ok, reason = Vorp.addCurrency(live, currency, amount)
        end
    else
        if not ref.charId then return H.fail('player_not_found') end
        local column = ({ [0] = 'money', [1] = 'gold', [2] = 'rol', [3] = 'blackmoney' })[currency] or 'money'
        ok = Vorp.adjustOffline(ref.charId, column, removing and -amount or amount)
        reason = (not ok) and 'character_row_not_updated' or nil
    end
    if not ok then return H.fail(reason or 'update_failed') end

    Log.write(actor, 'economy', removing and 'Removed currency' or 'Added currency',
        ('%s %s (type %d)'):format(removing and '-' or '+', tostring(amount), currency),
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

--- XP, implemented for real.
---
--- w_admin's version called `AddXP`/`RemoveXP`, two stubs that resolved a character id and then
--- returned `{success = true}` without touching anything. It is also one of the two shop-delivery
--- presets, so every customer who has ever bought XP from a Wraith store paid and received nothing.
Registry.invoke('adminpanel:xpAction', 'add.xp', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local amount = tonumber(args.amount)
    if not amount or amount <= 0 then return H.fail('invalid_amount') end
    local removing = tostring(args.action or 'add') == 'remove'
    -- Removal is a separate node; the registry gate covers `add.xp`, so check the other one here.
    if removing and not Perms.has(actor, 'remove.xp') then return H.fail('no_permission') end
    local delta = removing and -amount or amount

    local live = H.liveSource(ref)
    local ok, reason
    -- 1.1.1: on a server that runs w_level the player's level is w_level's (player_levels), not the
    -- framework's `xp` metadata: on w_core that metadata is the per-skill table, and writing a number
    -- over it broke every skill. The grant is exact and logged there (its trusted AdminAdjust export);
    -- an offline character is refused (staff use /addxp in game, which reaches a saved row).
    if GetResourceState('w_level') == 'started' then
        local okL, done
        if live then
            okL, done = pcall(function() return exports.w_level:AdminAdjust(live, delta, 'website') end)
        else
            -- 2026-10-22: offline too, his saved row by the citizen id (w_level AdminCitizen, as /addxp)
            local p = type(args.player) == 'table' and args.player or {}
            local cid = p.citizenid or args.citizenid or ref.citizenid
            if not cid then return H.fail('player_not_online') end
            okL, done = pcall(function()
                return exports.w_level:AdminCitizen(tostring(cid), removing and 'remove' or 'add', amount, nil, actor.label)
            end)
        end
        if not okL or done ~= true then return H.fail('admin_console_error') end
        Log.write(actor, 'economy', removing and 'Removed XP' or 'Added XP', tostring(amount),
            { name = ref.username, identifier = ref.identifier })
        return H.ok()
    end
    if live then
        ok, reason = Vorp.addXp(live, delta)
    else
        if not ref.charId then return H.fail('player_not_found') end
        ok = Vorp.adjustOffline(ref.charId, 'xp', delta)
        reason = (not ok) and 'character_row_not_updated' or nil
    end
    if not ok then return H.fail(reason or 'update_failed') end

    Log.write(actor, 'economy', removing and 'Removed XP' or 'Added XP', tostring(amount),
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

-- ---------------------------------------------------------------------------
--  Moderation verbs
--
--  Registered as actions so the bridge's direct `type: "kick"` form reaches them, and dispatched
--  again from `handlePlayerAction` so the panel's button form reaches the same code.
-- ---------------------------------------------------------------------------

local function targetOf(args)
    local ref = H.playerRef(args)
    local live = H.liveSource(ref)
    -- The 2.0 panel identifies a player by `target` alone, so the reference arrives with no name and
    -- no identifier. Every audit row written from it would record a blank target — an admin log that
    -- cannot say who was acted on is not much of an audit log. Fill them in from the game once the
    -- player has resolved.
    if live then
        local snap = Vorp.snapshot(live)
        if snap then
            ref.username = ref.username or snap.characterName
            ref.identifier = ref.identifier or snap.identifier
            ref.charId = ref.charId or snap.charId
        end
    end
    return ref, live
end

local function onlineOnly(actor, args, node, verb, run)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    if not run(live, ref) then return H.fail(verb .. '_failed') end
    Log.write(actor, 'player_action', verb, nil, { name = ref.username, identifier = ref.identifier })
    return H.ok()
end

Registry.action('kick', 'player.kick', function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    local reason = H.str(type(args) == 'table' and args.reason or nil, 200)
    if reason == '' then reason = 'Kicked by an administrator' end
    DropPlayer(live, reason)
    Log.write(actor, 'player_action', 'Kicked player', reason,
        { name = ref.username, identifier = ref.identifier, severity = 'medium' })
    return H.ok()
end)

Registry.action('heal', 'player.heal', function(actor, args)
    return onlineOnly(actor, args, 'player.heal', 'heal', function(src) return Vorp.heal(src) end)
end)

Registry.action('revive', 'player.revive', function(actor, args)
    return onlineOnly(actor, args, 'player.revive', 'revive', function(src) return Vorp.revive(src) end)
end)

Registry.action('respawn', 'player.respawn', function(actor, args)
    return onlineOnly(actor, args, 'player.respawn', 'respawn', function(src) return Vorp.respawn(src) end)
end)

Registry.action('kill', 'player.kill', function(actor, args)
    return onlineOnly(actor, args, 'player.kill', 'kill', function(src)
        TriggerClientEvent('w_connector:effect', src, 'kill')
        return true
    end)
end)

local freezeState = {}

Registry.action('freeze', 'player.freeze', function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    local frozen = not freezeState[live]
    freezeState[live] = frozen or nil
    TriggerClientEvent('w_connector:effect', live, 'freeze', frozen)
    Log.write(actor, 'player_action', frozen and 'Froze player' or 'Unfroze player', nil,
        { name = ref.username, identifier = ref.identifier })
    return H.ok(frozen and 'frozen' or 'unfrozen')
end)

AddEventHandler('playerDropped', function() freezeState[source] = nil end)

Registry.action('message', 'player.message', function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    local message = H.str(type(args) == 'table' and (args.message or args.text) or nil, 500)
    if message == '' then return H.fail('missing_message') end
    TriggerClientEvent('w_connector:message', live, actor.label or 'Admin', message)
    Log.write(actor, 'admin_action', 'Sent private message', message,
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

--- The same code as w_admin's console runs these (exports.w_admin:SitePlayerAction, 2026-10-22): one
--- implementation for both panels. The registry already checked the node and the rank guard.
local function consoleAction(actor, args, verb, values, what)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    if GetResourceState('w_admin') ~= 'started' then return H.fail('not_supported_here') end
    local ok, res = pcall(function() return exports.w_admin:SitePlayerAction(verb, live, values) end)
    if not ok or type(res) ~= 'table' then return H.fail('admin_console_error') end
    if not res.ok then return H.fail(res.error or 'admin_console_error') end
    Log.write(actor, 'player_action', what, json.encode(values), { name = ref.username, identifier = ref.identifier })
    return H.ok()
end

--- Move a player to a point on the map (the website's town list, or typed coordinates). No height:
--- the player is put on the ground there.
Registry.action('teleportCoords', 'player.teleport.bring', function(actor, args)
    args = type(args) == 'table' and args or {}
    local x, y = tonumber(args.x), tonumber(args.y)
    if not x or not y then return H.fail('err_invalid_coords') end
    return consoleAction(actor, args, 'tpCoords', { x = x, y = y, z = tonumber(args.z) }, 'Teleported player')
end)

--- Food and water to a value (0-100); the panel's button fills both. Under the heal node: it is care.
Registry.action('setNeeds', 'player.heal', function(actor, args)
    args = type(args) == 'table' and args or {}
    local hunger, thirst = tonumber(args.hunger), tonumber(args.thirst)
    if not hunger and not thirst then return H.fail('err_invalid_value') end
    return consoleAction(actor, args, 'needs', { hunger = hunger, thirst = thirst }, 'Set food and water')
end)

--- Teleports run server-side. `SetEntityCoords` works on a server-owned entity handle, so there is
--- no need to involve the client for these two.
local function teleport(actor, args, bringThem)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    -- The admin has no ped: they are on a website, not in the game. Both directions need an in-game
    -- anchor, and the only one available is another online player named by the caller.
    local anchor = tonumber(type(args) == 'table' and (args.adminSource or args.toSource) or nil)
    if not anchor then return H.fail('missing_destination') end
    local from, to = (bringThem and live or anchor), (bringThem and anchor or live)
    local ped = GetPlayerPed(to)
    if not ped or ped == 0 then return H.fail('target_not_spawned') end
    local c = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)
    local movingPed = GetPlayerPed(from)
    if not movingPed or movingPed == 0 then return H.fail('target_not_spawned') end
    -- Handed to the client rather than done here. Only the client can wait for the destination's
    -- collision to stream in, and moving a ped there before it has is how players end up falling
    -- through the map. The heading goes with it so they arrive facing the way the anchor faces
    -- instead of snapping to due north.
    TriggerClientEvent('w_connector:effect', from, 'teleport', { x = c.x, y = c.y, z = c.z, h = heading })
    Log.write(actor, 'player_action', bringThem and 'Brought player' or 'Teleported to player', nil,
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end

Registry.action('gotoplayer', 'player.teleport.to_player', function(actor, args)
    return teleport(actor, args, false)
end)

Registry.action('bring', 'player.teleport.bring', function(actor, args)
    return teleport(actor, args, true)
end)

--- THE warning store (2026-10-22): the website's warn and w_admin's /warn (export AddWarning) both write
--- wc_warnings, so the panel's count and the kick at the threshold see every warning. -> total in force
local function storeWarning(identifier, steamHex, reason, severity, by)
    MySQL.insert.await(
        'INSERT INTO `wc_warnings` (`player_identifier`,`steam_hex`,`reason`,`severity`,`warned_by`) VALUES (?,?,?,?,?)',
        { identifier, steamHex or '', reason, severity, by or 'Web Admin' })
    local counted = MySQL.single.await(
        'SELECT COUNT(*) AS n FROM `wc_warnings` WHERE `player_identifier` = ? AND `is_active` = 1', { identifier })
    return tonumber(counted and counted.n) or 1
end

local function kickAtThreshold(live, total, reason)
    if Config.warnKickThreshold > 0 and total >= Config.warnKickThreshold and live then
        DropPlayer(live, ('طُردت بعد %d تحذيرات. آخرها: %s'):format(total, reason))
        return true
    end
    return false
end

--- w_admin's /warn (and any script): a warning to a player in game, stored like the website's. The caller
--- tells the player and writes its own log line (w_admin's log reaches wc_logs through GameLog).
--- -> total warnings in force, kicked | nil, err
exports('AddWarning', function(src, reason, by, severity)
    src = tonumber(src)
    if not src or not GetPlayerName(src) then return nil, 'player_not_online' end
    local snap = Vorp.snapshot(src)
    local cached = Players.get(src) or {}
    local identifier = (snap and snap.identifier) or cached.identifier
    if not identifier then return nil, 'player_not_found' end
    reason = H.str(reason, 300)
    if reason == '' then return nil, 'missing_reason' end
    if severity ~= 'low' and severity ~= 'medium' and severity ~= 'high' then severity = 'medium' end
    local total = storeWarning(identifier, cached.steamHex, reason, severity, by or 'Admin')
    return total, kickAtThreshold(src, total, reason)
end)

Registry.action('warn', 'player.warn', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref, live = targetOf(args)
    local identifier = ref.identifier
    if not identifier and live then
        local snap = Vorp.snapshot(live)
        identifier = snap and snap.identifier
    end
    if not identifier then return H.fail('player_not_found') end

    local reason = H.str(args.reason, 300)
    if reason == '' then return H.fail('missing_reason') end
    local severity = args.severity
    if severity ~= 'low' and severity ~= 'medium' and severity ~= 'high' then severity = 'medium' end

    local cached = live and Players.get(live) or {}
    local total = storeWarning(identifier, cached.steamHex, reason, severity, actor.label or 'Web Admin')

    -- A warning carries more than its text: who issued it, how serious it is, and how many the player
    -- now has. Sent as a generic tip ("[Warning] <reason>") all three were dropped, and "warning 3 of
    -- 3" is the part that actually changes behaviour.
    if live then
        TriggerClientEvent('w_connector:warning', live, {
            reason = reason,
            severity = severity,
            warnedBy = actor.label or 'Web Admin',
            total = total,
            threshold = Config.warnKickThreshold,
        })
    end

    Log.write(actor, 'player_action', 'Warned player', ('%s (warning %d)'):format(reason, total),
        { name = ref.username, identifier = identifier, severity = severity })

    if kickAtThreshold(live, total, reason) then
        return H.ok(('warned_and_kicked_at_%d'):format(total))
    end
    return H.ok()
end)

--- Client-side effects. Each is a single event to the target; the client file runs the natives and
--- draws nothing.
local EFFECTS = {
    clearWeapons = 'player.inventory.remove_items',
    clearItems = 'player.inventory.remove_items',
    clearAllInventory = 'player.inventory.clear',
}

Registry.action('clearWeapons', EFFECTS.clearWeapons, function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    -- Without a live inventory `Inv.weapons`/`Inv.items` answer with an empty list, the loop below
    -- runs zero times, and this reports SUCCESS having cleared nothing — an admin is told a player
    -- was stripped while the player still has everything. Refuse, with a reason the panel can name.
    if not Inv.available() then return H.fail('inventory_export_unavailable') end
    local removed = 0
    for _, w in ipairs(Inv.weapons(live)) do
        if Inv.removeWeapon(live, w.id or w.weaponId) then removed = removed + 1 end
    end
    Log.write(actor, 'player_action', 'Cleared weapons', tostring(removed) .. ' removed',
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

Registry.action('clearItems', EFFECTS.clearItems, function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    if not Inv.available() then return H.fail('inventory_export_unavailable') end
    local removed = 0
    for _, it in ipairs(Inv.items(live)) do
        local name = it.name or it.item
        local count = tonumber(it.count or it.amount) or 0
        if name and count > 0 and Inv.removeItem(live, name, count) then removed = removed + 1 end
    end
    Log.write(actor, 'player_action', 'Cleared items', tostring(removed) .. ' stacks removed',
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

Registry.action('clearAllInventory', EFFECTS.clearAllInventory, function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    if not Inv.available() then return H.fail('inventory_export_unavailable') end
    for _, it in ipairs(Inv.items(live)) do
        local name = it.name or it.item
        local count = tonumber(it.count or it.amount) or 0
        if name and count > 0 then Inv.removeItem(live, name, count) end
    end
    for _, w in ipairs(Inv.weapons(live)) do Inv.removeWeapon(live, w.id or w.weaponId) end
    Log.write(actor, 'player_action', 'Cleared entire inventory', nil,
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

--- Eight of the nine troll effects. Purely client-side natives — there is no server-side way to set
--- a ped on fire — so each is one event to the target and nothing more.
---
--- Lightning is the ninth and is registered separately below, because it is the one that is not done
--- TO a ped and must not go to the target alone.
local TROLLS = {
    'trollSetOnFire', 'trollTPHeaven', 'trollRagdoll', 'trollWildAttack',
    'trollDrainStamina', 'trollHandcuff', 'trollDrunk', 'trollInvisible',
}

for _, verb in ipairs(TROLLS) do
    Registry.action(verb, 'player.troll', function(actor, args)
        local ref, live = targetOf(args)
        if not live then return H.fail('player_not_online') end
        TriggerClientEvent('w_connector:effect', live, verb)
        Log.write(actor, 'player_action', verb, nil, { name = ref.username, identifier = ref.identifier })
        return H.ok()
    end)
end

--- Lightning strikes a PLACE, and everyone should see it.
---
--- `ForceLightningFlashAtCoords` lights the sky at a position, so sending it only to the player being
--- struck would mean the victim sees a flash and the server sees nothing — which is the opposite of
--- the point. It is broadcast to every client, exactly as w_admin did.
---
--- The coordinates are read HERE, on the server, from the target's own ped. Taking them from the
--- request instead would let whoever can reach this action call down a flash anywhere on the map,
--- which is not what the button is for.
Registry.action('trollLightning', 'player.troll', function(actor, args)
    local ref, live = targetOf(args)
    if not live then return H.fail('player_not_online') end
    local c = GetEntityCoords(GetPlayerPed(live))
    if not c then return H.fail('player_not_found') end
    TriggerClientEvent('w_connector:lightning', -1, c.x, c.y, c.z)
    Log.write(actor, 'player_action', 'trollLightning', nil,
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

-- ---------------------------------------------------------------------------
--  handlePlayerAction — the panel's single entry point for all of the above
-- ---------------------------------------------------------------------------

Registry.invoke('handlePlayerAction', 'players_page', function(actor, args)
    args = type(args) == 'table' and args or {}
    local action = H.str(args.action, 64)
    if action == '' then return H.fail('missing_action') end
    -- Routed through the registry so the permission node is applied exactly once, in one place —
    -- rather than each verb remembering to check for itself, which is how thirteen of w_admin's
    -- callbacks ended up checking nothing.
    local ok, res, err = Registry.callAction(actor, action, args)
    if not ok then return H.fail(err or 'invalid_action') end
    return res
end)
