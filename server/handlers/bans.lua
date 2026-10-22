--- Bans.
---
--- The server has ONE ban store since 2026-10-22: w_core's `bans` (w_core/server/bans.lua). The website
--- reads and writes it through w_core's exports, so a ban from the site, from w_admin's console or from
--- the anti-cheat is one list, and both join gates read it. A lifted or expired ban stays as history.
--- wc_bans is no longer read: its rows were moved into `bans` once (migrateLegacy below).

--- Anything longer than this is not a "temporary" ban in any meaningful sense, and calling it one is
--- how a moderator issues a life sentence with a permission the owner deliberately withheld from
--- them. w_admin capped it here for exactly that reason; the cap was lost in the port.
local MAX_TEMP_DAYS = 30
local PERMANENT = 2147483647

local function core()
    return GetResourceState('w_core') == 'started' and exports.w_core or nil
end

--- `"30d"`, `"6h"`, `"permanent"` -> minutes (0 = permanent), and the kind of ban.
---
--- Over the cap the answer is `permanent`, not a very distant expiry: the caller derives the required
--- permission from the kind, so `"3650d"` demands `player.ban.permanent` instead of sailing through on
--- `player.ban.temporary`.
local function minutesFrom(duration)
    local d = tostring(duration or 'permanent'):lower()
    if d == 'permanent' or d == '' then return 0, 'permanent' end
    local n, unit = d:match('^(%d+)([hd])$')
    if not n then return 0, 'permanent' end
    local amount = tonumber(n)
    local days = (unit == 'h') and (amount / 24) or amount
    if days > MAX_TEMP_DAYS then return 0, 'permanent' end
    return amount * ((unit == 'h') and 60 or 1440), 'temporary'
end

--- Severity inferred from the reason, so the panel's colour coding means something without asking
--- an admin to grade their own ban on a scale.
local function severityFrom(reason)
    local r = tostring(reason or ''):lower()
    for _, word in ipairs({ 'cheat', 'hack', 'exploit', 'inject', 'menu', 'dupe' }) do
        if r:find(word, 1, true) then return 'critical' end
    end
    for _, word in ipairs({ 'racis', 'slur', 'threat', 'harass', 'toxic' }) do
        if r:find(word, 1, true) then return 'high' end
    end
    return 'medium'
end

local function bare(id)
    return type(id) == 'string' and (id:match('^%w+:(.+)$') or id) or ''
end

--- A row of w_core's `bans` in the shape the website's Bans tab reads (dates in milliseconds).
local function toSite(r, prior)
    local expire = tonumber(r.expire) or PERMANENT
    local perm = expire >= PERMANENT
    local created = tonumber(r.created)
    local identifier = r.license or r.discord or r.steam or ''
    local av = Players.avatars[identifier] or {}
    local duration = 'permanent'
    if not perm then
        local span = expire - (created or expire)
        duration = span >= 86400 and ('%dd'):format(math.floor(span / 86400 + 0.5)) or ('%dh'):format(math.max(1, math.floor(span / 3600 + 0.5)))
    end
    return {
        id = r.id, identifier = identifier, steam_hex = bare(r.steam), discord_id = bare(r.discord),
        username = r.name or '', character_name = r.character_name or '', avatar = av.avatar_url or '',
        ban_type = perm and 'permanent' or 'temporary', severity = severityFrom(r.reason),
        reason = r.reason or '', banned_by = r.bannedby or '',
        ban_date = created and created * 1000 or nil, expiry_date = (not perm) and expire * 1000 or nil,
        updated_at = (tonumber(r.unbanned_at) or created or 0) * 1000,
        appeal_status = 'none', previous_bans = prior or 0, duration = duration,
        is_active = (r.active == 1 or r.active == true) and 1 or 0,
        ip_address = (Config.showIpAddress and r.ip) or '',
    }
end

--- An identifier of any kind ('license:…', 'discord:…', 'steam:…', a bare Discord id) as w_core's ids table.
local function idsFrom(identifier)
    local id = tostring(identifier or '')
    local kind = id:match('^(%w+):')
    if kind == 'license' or kind == 'discord' or kind == 'steam' then return { [kind] = id } end
    if id:match('^%d+$') then return { discord = id } end
    return { license = id }
end

local function list(limit)
    local api = core()
    if not api then return {} end
    local out = {}
    for _, r in ipairs(api:GetBans(limit) or {}) do out[#out + 1] = toSite(r) end
    return out
end

Registry.invoke('getBannedPlayers', 'show_banned_players', function()
    return { bannedPlayers = list(1000) }
end)

Registry.invoke('getBanHistory', 'ban_history', function(actor, args)
    args = type(args) == 'table' and args or {}
    local identifier = H.str(args.identifier, 100)
    local api = core()
    if identifier == '' or not api then return { banHistory = {} } end
    local rows = api:GetBanHistory(idsFrom(identifier)) or {}
    local out = {}
    for i, r in ipairs(rows) do out[#out + 1] = toSite(r, #rows - i) end
    return { banHistory = out }
end)

local function lift(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.banId or args.id)
    if not id then return H.fail('missing_banId') end
    local api = core()
    if not api then return H.fail('core_not_ready') end
    local ok = api:UnbanId(id, actor.label or 'Web Admin')
    if not ok then return H.fail('ban_not_found') end
    Log.write(actor, 'admin_action', 'Lifted ban', 'Ban #' .. id, { severity = 'medium' })
    return H.ok()
end
Registry.invoke('unbanPlayer', 'unban_player', lift)
Registry.action('unban', 'unban_player', lift)

Registry.invoke('editBan', 'edit_ban', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.banId or args.id)
    if not id then return H.fail('missing_banId') end
    local api = core()
    if not api then return H.fail('core_not_ready') end
    local reason = H.str(args.reason, 500)
    local duration = H.str(args.duration, 32)
    local minutes = nil
    if duration ~= '' then minutes = (minutesFrom(duration)) end
    local ok = api:EditBan(id, reason ~= '' and reason or nil, minutes)
    if not ok then return H.fail('ban_not_found') end
    Log.write(actor, 'admin_action', 'Edited ban', ('#%d -> %s / %s'):format(id, duration, reason))
    return H.ok()
end)

Registry.read('getBansList', 'show_banned_players', function()
    local out = {}
    for _, b in ipairs(list(500)) do
        out[#out + 1] = { id = b.id, identifier = b.identifier, username = b.username, reason = b.reason,
            ban_date = b.ban_date, expiry_date = b.expiry_date, banned_by = b.banned_by }
    end
    return out
end)

--- Issue a ban. Works against an online player, an offline character, or a bare identifier.
local function issueBan(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local live = H.liveSource(ref)

    local duration = H.str(args.duration, 32)
    if duration == '' then duration = 'permanent' end
    local minutes, banType = minutesFrom(duration)

    -- The two ban lengths are separate permissions, so the node depends on what was asked for.
    local node = (banType == 'permanent') and 'player.ban.permanent' or 'player.ban.temporary'
    if not Perms.has(actor, node) then return H.fail('no_permission') end

    local reason = H.str(args.reason, 500)
    if reason == '' then reason = 'Banned by an administrator' end
    local by = actor.label or 'Web Admin'

    local api = core()
    if not api then return H.fail('core_not_ready') end
    local ok, err, name
    if live then
        name = GetPlayerName(live)
        ok, err = api:BanPlayer(live, reason, minutes, by)
    elseif ref.citizenid then
        name = ref.username
        ok, err = api:BanCitizen(ref.citizenid, reason, minutes, by)
    else
        local identifier = ref.identifier
        if (not identifier or identifier == '') and ref.charId then
            local row = Vorp.offlineChar(ref.charId)
            identifier = row and row.identifier
        end
        if not identifier or identifier == '' then return H.fail('player_not_found') end
        local ids = idsFrom(identifier)
        local av = Players.avatars[identifier] or {}
        local id
        id, err = api:BanIdentifiers({
            license = ids.license, discord = ids.discord or (av.discord_id ~= '' and av.discord_id or nil),
            steam = ids.steam or (av.steam_hex ~= '' and av.steam_hex or nil),
            name = ref.username, reason = reason, minutes = minutes, bannedBy = by,
        })
        ok, name = id ~= nil, ref.username
    end
    if not ok then return H.fail(err or 'ban_failed') end

    Log.write(actor, 'player_action', 'Banned player', ('%s — %s'):format(duration, reason),
        { name = name, identifier = ref.identifier, severity = 'high' })
    return H.ok()
end

--- Registered under the loosest of the two ban nodes; `issueBan` then checks the one that actually
--- applies. Without this the registry gate would reject a temporary ban from someone who only holds
--- `player.ban.temporary`.
Registry.action('ban', 'player.ban.temporary', issueBan)
Registry.action('banPlayer', 'player.ban.temporary', issueBan)

Registry.action('removewarn', 'player.removewarn', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.warningId or args.id)
    if not id then return H.fail('missing_warning_id') end
    local n = MySQL.update.await('UPDATE `wc_warnings` SET `is_active` = 0 WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('warning_not_found') end
    Log.write(actor, 'admin_action', 'Removed warning', 'Warning #' .. id)
    return H.ok()
end)

--- Once: the website's own bans of before 2026-10-22 (wc_bans) move into the one store, then are closed
--- there, so a re-run finds nothing to move. Marked in wc_settings.
CreateThread(function()
    Schema.await()
    for _ = 1, 60 do
        if GetResourceState('w_core') == 'started' then break end
        Wait(1000)
    end
    local api = core()
    if not api then return end
    Wait(5000) -- w_core's bans.lua adds its columns at its own start
    local done = MySQL.scalar.await('SELECT 1 FROM `wc_settings` WHERE `key` = ?', { 'bans_in_core' })
    if done then return end
    local rows = MySQL.query.await('SELECT * FROM `wc_bans` WHERE `is_active` = 1') or {}
    local moved = 0
    for _, r in ipairs(rows) do
        local minutes = 0
        if r.ban_type == 'temporary' and tonumber(r.expiry_date) then
            minutes = math.floor((tonumber(r.expiry_date) / 1000 - os.time()) / 60)
        end
        if r.ban_type ~= 'temporary' or minutes > 0 then
            local ids = idsFrom(r.identifier)
            local id = api:BanIdentifiers({
                license = ids.license, discord = ids.discord or (r.discord_id ~= '' and r.discord_id or nil),
                steam = ids.steam or (r.steam_hex ~= '' and r.steam_hex or nil),
                name = r.username, characterName = r.character_name, reason = r.reason,
                minutes = minutes, bannedBy = r.banned_by,
            })
            if id then moved = moved + 1 end
        end
        MySQL.update.await('UPDATE `wc_bans` SET `is_active` = 0 WHERE `id` = ?', { r.id })
    end
    MySQL.insert.await('INSERT IGNORE INTO `wc_settings` (`key`, `value`, `updated_by`) VALUES (?, ?, ?)',
        { 'bans_in_core', json.encode({ moved = moved, at = os.time() }), 'migration' })
end)
