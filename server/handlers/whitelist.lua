--- The whitelist.
---
--- Also the landing point for website-approved applications: redmWhitelistGrant.ts invokes
--- `adminpanel:addwhitelist` with `{ username, steamHex, discordId, reason }` and treats
--- `result.success == false` as a permanent failure, so the message returned here is what an
--- operator eventually reads in the dashboard.

--- The panel reads camelCase; the table stores snake_case. Aliasing in SQL keeps the translation in
--- one place rather than spread across three handlers.
local SELECT_COLUMNS =
    '`steam_hex` AS `steamHex`, `username`, `character_name` AS `characterName`, ' ..
    '`discord_id` AS `discordId`, `status`, `added_by` AS `addedBy`, `added_date` AS `addedDate`, ' ..
    '`last_login` AS `lastLogin`, `reason`, `avatar`, `is_online` AS `isOnline`'

Registry.invoke('getwhitelistdata', 'whitelist.view', function()
    -- w_admin's version had NO permission check, and since every one of its callbacks was also a
    -- plain net event, any player on the server could read the whole list.
    local rows = MySQL.query.await(
        'SELECT ' .. SELECT_COLUMNS .. ' FROM `wc_whitelist` ORDER BY `added_date` DESC') or {}
    return { whitelist = rows }
end)

Registry.invoke('adminpanel:addwhitelist', 'whitelist.add', function(actor, args)
    args = type(args) == 'table' and args or {}
    local steamHex = H.str(args.steamHex or args.steam_hex, 100)
    if steamHex == '' then return H.fail('missing_steam_hex') end
    local username = H.str(args.username, 100)
    local discordId = H.str(args.discordId or args.discord_id, 32):gsub('%D', '')
    local reason = H.str(args.reason, 500)

    local existing = MySQL.single.await('SELECT `steam_hex` FROM `wc_whitelist` WHERE `steam_hex` = ?', { steamHex })
    if existing then
        -- Re-approving someone who is already listed is a normal thing to do — an application can be
        -- resubmitted after a suspension — so this reactivates rather than failing.
        MySQL.update.await(
            'UPDATE `wc_whitelist` SET `status` = \'active\', `reason` = ?, `added_by` = ?, ' ..
            '`username` = COALESCE(NULLIF(?, \'\'), `username`), ' ..
            '`discord_id` = COALESCE(NULLIF(?, \'\'), `discord_id`) WHERE `steam_hex` = ?',
            { reason, actor.label or 'Web Admin', username, discordId, steamHex })
        Log.write(actor, 'admin_action', 'Reactivated whitelist entry', steamHex, { name = username })
        return H.ok('reactivated')
    end

    MySQL.insert.await(
        'INSERT INTO `wc_whitelist` (`steam_hex`,`username`,`discord_id`,`status`,`added_by`,`reason`,`avatar`) ' ..
        'VALUES (?,?,?,?,?,?,?)',
        { steamHex, username, discordId, 'active', actor.label or 'Web Admin', reason, '' })

    -- Fill the avatar out of band so approving an application never waits on Discord.
    if discordId ~= '' then
        CreateThread(function()
            Players.resolveAvatar('steam:' .. steamHex, steamHex, discordId)
            local av = Players.avatars['steam:' .. steamHex]
            if av and av.avatar_url then
                pcall(function()
                    MySQL.update.await('UPDATE `wc_whitelist` SET `avatar` = ? WHERE `steam_hex` = ?',
                        { av.avatar_url, steamHex })
                end)
            end
        end)
    end

    Log.write(actor, 'admin_action', 'Added to whitelist', steamHex, { name = username })
    return H.ok()
end)

Registry.invoke('adminpanel:editwhitelistplayer', 'whitelist.edit', function(actor, args)
    args = type(args) == 'table' and args or {}
    local steamHex = H.str(args.playerId or args.steamHex, 100)
    if steamHex == '' then return H.fail('missing_steam_hex') end
    local n = MySQL.update.await('UPDATE `wc_whitelist` SET `reason` = ? WHERE `steam_hex` = ?',
        { H.str(args.reason, 500), steamHex })
    if (tonumber(n) or 0) == 0 then return H.fail('entry_not_found') end
    Log.write(actor, 'admin_action', 'Edited whitelist entry', steamHex)
    return H.ok()
end)

--- The four verbs the panel sends. Each maps to its own permission node.
---
--- w_admin built the node by concatenating `'whitelist.' .. data.action`, which meant the vocabulary
--- was whatever the website happened to send — and `activate` produced `whitelist.activate`, a node
--- that existed in no role's list, so only wildcard roles could ever reactivate anybody. A fixed
--- table means an unknown verb is refused rather than silently becoming an unknown node.
local VERBS = {
    remove   = { node = 'whitelist.remove',   status = nil,          label = 'Removed from whitelist' },
    suspend  = { node = 'whitelist.suspend',  status = 'suspended',  label = 'Suspended whitelist entry' },
    activate = { node = 'whitelist.activate', status = 'active',     label = 'Reactivated whitelist entry' },
    approve  = { node = 'whitelist.approve',  status = 'active',     label = 'Approved whitelist entry' },
}

Registry.invoke('adminpanel:whitelistedplayeraction', 'whitelist.view', function(actor, args)
    args = type(args) == 'table' and args or {}
    local steamHex = H.str(args.playerId or args.steamHex, 100)
    if steamHex == '' then return H.fail('missing_steam_hex') end

    local verb = VERBS[tostring(args.action or '')]
    if not verb then return H.fail('invalid_action') end
    if not Perms.has(actor, verb.node) then return H.fail('no_permission') end

    local n
    if verb.status == nil then
        n = MySQL.update.await('DELETE FROM `wc_whitelist` WHERE `steam_hex` = ?', { steamHex })
    else
        n = MySQL.update.await('UPDATE `wc_whitelist` SET `status` = ? WHERE `steam_hex` = ?',
            { verb.status, steamHex })
    end
    if (tonumber(n) or 0) == 0 then return H.fail('entry_not_found') end

    Log.write(actor, 'admin_action', verb.label, steamHex)
    return H.ok()
end)

--- The join check itself (Steam OR Discord, switched on and off from the website) is
--- server/sv_queue.lua's `whitelisted()`.
