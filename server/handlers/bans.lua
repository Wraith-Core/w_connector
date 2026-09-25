--- Bans.
---
--- Everything here is plain SQL against `wc_bans`; no framework call is involved, which is why a
--- ban can be issued against a player who has never been online.

--- Anything longer than this is not a "temporary" ban in any meaningful sense, and calling it one is
--- how a moderator issues a life sentence with a permission the owner deliberately withheld from
--- them. w_admin capped it here for exactly that reason; the cap was lost in the port.
local MAX_TEMP_DAYS = 30

--- `"30d"`, `"6h"`, `"permanent"` -> an expiry timestamp, or nil for permanent.
---
--- Over the cap the answer is `permanent`, not a very distant expiry — which matters twice. The
--- caller derives the required permission from this second return value, so `"3650d"` now demands
--- `player.ban.permanent` instead of sailing through on `player.ban.temporary`; and the row is stored
--- as a permanent ban with a NULL expiry rather than as a temporary one expiring in 2036, so the
--- panel describes it honestly. Both match what w_admin did.
local function expiryFrom(duration)
    local d = tostring(duration or 'permanent'):lower()
    if d == 'permanent' or d == '' then return nil, 'permanent' end
    local n, unit = d:match('^(%d+)([hd])$')
    if not n then return nil, 'permanent' end
    local amount = tonumber(n)
    local days = (unit == 'h') and (amount / 24) or amount
    if days > MAX_TEMP_DAYS then return nil, 'permanent' end
    local seconds = amount * ((unit == 'h') and 3600 or 86400)
    return os.date('%Y-%m-%d %H:%M:%S', os.time() + seconds), 'temporary'
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

Registry.invoke('getBannedPlayers', 'show_banned_players', function()
    local rows = MySQL.query.await(
        'SELECT `id`, `identifier`, `steam_hex`, `discord_id`, `username`, `character_name`, `avatar`, ' ..
        '`ban_type`, `severity`, `reason`, `banned_by`, `ban_date`, `expiry_date`, `appeal_status`, ' ..
        '`previous_bans`, `duration` FROM `wc_bans` WHERE `is_active` = 1 ORDER BY `ban_date` DESC LIMIT 1000') or {}
    return { bannedPlayers = rows }
end)

Registry.invoke('getBanHistory', 'ban_history', function(actor, args)
    args = type(args) == 'table' and args or {}
    local identifier = H.str(args.identifier, 100)
    if identifier == '' then return { banHistory = {} } end
    -- Matched on the account as well as the character: a player with five characters who was banned
    -- on one of them has a history, not a clean record.
    local rows = MySQL.query.await(
        'SELECT `id`, `ban_type`, `severity`, `reason`, `banned_by`, `duration`, `ban_date`, ' ..
        '`expiry_date`, `updated_at`, `ip_address`, `is_active` FROM `wc_bans` ' ..
        'WHERE `identifier` = ? OR (`steam_hex` <> \'\' AND `steam_hex` = ' ..
        '(SELECT `steam_hex` FROM `wc_bans` WHERE `identifier` = ? AND `steam_hex` <> \'\' LIMIT 1)) ' ..
        'ORDER BY `ban_date` DESC', { identifier, identifier }) or {}
    return { banHistory = rows }
end)

Registry.invoke('unbanPlayer', 'unban_player', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.banId or args.id)
    if not id then return H.fail('missing_banId') end
    local n = MySQL.update.await('UPDATE `wc_bans` SET `is_active` = 0 WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('ban_not_found') end
    Log.write(actor, 'admin_action', 'Lifted ban', 'Ban #' .. id, { severity = 'medium' })
    return H.ok()
end)

Registry.invoke('editBan', 'edit_ban', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.banId or args.id)
    if not id then return H.fail('missing_banId') end
    local reason = H.str(args.reason, 500)
    local duration = H.str(args.duration, 32)
    local expiry, banType = expiryFrom(duration)
    local n = MySQL.update.await(
        'UPDATE `wc_bans` SET `reason` = ?, `duration` = ?, `expiry_date` = ?, `ban_type` = ? WHERE `id` = ?',
        { reason, duration ~= '' and duration or 'permanent', expiry, banType, id })
    if (tonumber(n) or 0) == 0 then return H.fail('ban_not_found') end
    Log.write(actor, 'admin_action', 'Edited ban', ('#%d -> %s / %s'):format(id, duration, reason))
    return H.ok()
end)

Registry.read('getBansList', 'show_banned_players', function()
    return MySQL.query.await(
        'SELECT `id`, `identifier`, `username`, `reason`, `ban_date`, `expiry_date`, `banned_by` ' ..
        'FROM `wc_bans` WHERE `is_active` = 1 ORDER BY `ban_date` DESC LIMIT 500') or {}
end)

--- Issue a ban. Works against an online source or an offline character id.
local function issueBan(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local live = H.liveSource(ref)

    local duration = H.str(args.duration, 32)
    if duration == '' then duration = 'permanent' end
    local expiry, banType = expiryFrom(duration)

    -- The two ban lengths are separate permissions, so the node depends on what was asked for.
    local node = (banType == 'permanent') and 'player.ban.permanent' or 'player.ban.temporary'
    if not Perms.has(actor, node) then return H.fail('no_permission') end

    local reason = H.str(args.reason, 500)
    if reason == '' then reason = 'Banned by an administrator' end

    -- Identity: prefer what the game holds right now, fall back to the character row, and only then
    -- to whatever the website sent.
    local identifier, steamHex, discordId, charName, username, ip
    if live then
        local snap = Vorp.snapshot(live)
        local cached = Players.get(live) or {}
        identifier = (snap and snap.identifier) or cached.identifier
        steamHex, discordId = cached.steamHex, cached.discordId
        charName = (snap and snap.characterName) or cached.characterName
        username = cached.username
        ip = cached.endPoint
    elseif ref.charId then
        local row = Vorp.offlineChar(ref.charId)
        if row then
            identifier = row.identifier
            charName = ((row.firstname or '') .. ' ' .. (row.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')
            username = row.nickname or row.steamname
        end
    end
    identifier = identifier or ref.identifier
    if not identifier or identifier == '' then return H.fail('player_not_found') end

    local av = Players.avatars[identifier] or {}
    steamHex = steamHex or av.steam_hex or ''
    discordId = discordId or av.discord_id or ''

    local prior = MySQL.single.await(
        'SELECT COUNT(*) AS n FROM `wc_bans` WHERE `identifier` = ?', { identifier })

    MySQL.insert.await(
        'INSERT INTO `wc_bans` (`identifier`,`steam_hex`,`discord_id`,`username`,`character_name`,`reason`,' ..
        '`banned_by`,`duration`,`expiry_date`,`ban_type`,`severity`,`previous_bans`,`ip_address`,`avatar`) ' ..
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        { identifier, steamHex, discordId, username or '', charName or '', reason,
          actor.label or 'Web Admin', duration, expiry, banType, severityFrom(reason),
          tonumber(prior and prior.n) or 0, (Config.showIpAddress and ip) or '', av.avatar_url or '' })

    if live then
        DropPlayer(live, ('Banned: %s%s'):format(reason, expiry and (' (until ' .. expiry .. ')') or ''))
    end

    Log.write(actor, 'player_action', 'Banned player', ('%s — %s'):format(duration, reason),
        { name = charName or username, identifier = identifier, severity = 'high' })
    return H.ok()
end

--- Registered under the loosest of the two ban nodes; `issueBan` then checks the one that actually
--- applies. Without this the registry gate would reject a temporary ban from someone who only holds
--- `player.ban.temporary`.
Registry.action('ban', 'player.ban.temporary', issueBan)
Registry.action('banPlayer', 'player.ban.temporary', issueBan)

Registry.action('unban', 'unban_player', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.banId or args.id)
    if not id then return H.fail('missing_banId') end
    local n = MySQL.update.await('UPDATE `wc_bans` SET `is_active` = 0 WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('ban_not_found') end
    Log.write(actor, 'admin_action', 'Lifted ban', 'Ban #' .. id)
    return H.ok()
end)

Registry.action('removewarn', 'player.removewarn', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.warningId or args.id)
    if not id then return H.fail('missing_warning_id') end
    local n = MySQL.update.await('UPDATE `wc_warnings` SET `is_active` = 0 WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('warning_not_found') end
    Log.write(actor, 'admin_action', 'Removed warning', 'Warning #' .. id)
    return H.ok()
end)
