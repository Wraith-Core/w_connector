--- The staff roster.
---
--- Three things are different here from w_admin, all of them because the original was unsafe:
---
---   * `GetAdminsData` has a permission node. It had none, and since every callback was also a net
---     event, any player could pull the full roster — names, identifiers and Discord IDs.
---   * `setPermission` and `changeAdminRole` check rank. Only `removeAdmin` did, so anyone holding
---     `manage_permissions` could promote anybody, themselves included, to owner.
---   * Avatars are read from `wc_avatars` and never resolved inside the request. The original walked
---     the roster one entry at a time with `Citizen.Await` and a 100ms pause between lookups, so a
---     server with twenty admins turned one page load into a multi-second stall.

local function onlineByIdentifier()
    local out = {}
    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid)
        if p and p.identifier then out[p.identifier] = p end
        -- The account identifier is what wc_admins keys on for Steam-based installs, so index both.
        if p and p.steamHex then out['steam:' .. p.steamHex] = p end
    end
    return out
end

Registry.invoke('adminpanel:GetAdminsData', 'admins.view', function()
    local rows = MySQL.query.await(
        'SELECT `id`, `identifier`, `group`, `username`, `discord_id`, `resolved_reports`, ' ..
        '`assigned_date`, `last_updated` FROM `wc_admins` WHERE `is_active` = 1') or {}
    local online = onlineByIdentifier()
    local admins = {}
    for _, r in ipairs(rows) do
        local live = online[r.identifier]
        local role = Perms.get(r.group)
        local av = Players.avatars[r.identifier] or {}
        admins[#admins + 1] = {
            id = r.id,
            source = live and live.source or nil,
            steamHex = r.identifier,     -- the panel's name for "whichever identifier matched"
            identifier = r.identifier,
            username = r.username ~= '' and r.username or (av.discord_username or r.identifier),
            realName = av.discord_username or r.username,
            role = r.group,
            roleLevel = role and role.lvl or 0,
            avatar = av.avatar_url or '',
            online = live ~= nil,
            lastLogin = live and live.lastLogin or r.last_updated,
            reportsFinalized = tonumber(r.resolved_reports) or 0,
            discordId = r.discord_id,
        }
    end
    table.sort(admins, function(a, b) return (a.roleLevel or 0) > (b.roleLevel or 0) end)
    return { admins = admins }
end)

--- Grant or change someone's role by identifier. Creates the roster row if it does not exist.
Registry.invoke('adminpanel:setPermission', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref = H.playerRef(args)
    local identifier = H.str(ref.identifier or args.identifier, 100)
    if identifier == '' then return H.fail('missing_identifier') end

    local group = H.str(args.permission or args.role or args.group, 64)
    local role = Perms.get(group)
    if not role then return H.fail('unknown_role') end

    -- You cannot grant a role you do not outrank. Without this, `manage_permissions` is the only
    -- permission that matters, because its holder can simply give themselves every other one.
    if not Perms.outranks(actor, group) then return H.fail('cannot_grant_role_at_or_above_your_own') end

    local existing = Perms.adminOf(identifier)
    if existing and not Perms.outranks(actor, existing.group) then
        return H.fail('cannot_modify_equal_or_higher_rank')
    end

    local username = ref.username or ''
    local live = ref.source and Players.get(ref.source) or nil
    local av = Players.avatars[identifier] or {}

    MySQL.insert.await(
        'INSERT INTO `wc_admins` (`identifier`,`group`,`username`,`discord_id`) VALUES (?,?,?,?) ' ..
        'ON DUPLICATE KEY UPDATE `group` = VALUES(`group`), `is_active` = 1, ' ..
        '`username` = COALESCE(NULLIF(VALUES(`username`), \'\'), `username`)',
        { identifier, group, username ~= '' and username or (av.discord_username or ''),
          (live and live.discordId) or av.discord_id or '' })

    Log.write(actor, 'admin_action', existing and 'Changed staff role' or 'Granted staff role',
        ('%s -> %s'):format(identifier, group), { name = username, identifier = identifier, severity = 'high' })
    return H.ok()
end)

Registry.invoke('adminpanel:changeAdminRole', 'change.admin.role', function(actor, args)
    args = type(args) == 'table' and args or {}
    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local identifier = H.str(target.identifier or target.steamHex or args.identifier, 100)
    if identifier == '' then return H.fail('missing_identifier') end

    local group = H.str(args.role or args.group, 64)
    local role = Perms.get(group)
    if not role then return H.fail('unknown_role') end

    local existing = Perms.adminOf(identifier)
    if not existing then return H.fail('not_an_admin') end
    if not Perms.outranks(actor, existing.group) then return H.fail('cannot_modify_equal_or_higher_rank') end
    if not Perms.outranks(actor, group) then return H.fail('cannot_grant_role_at_or_above_your_own') end

    MySQL.update.await('UPDATE `wc_admins` SET `group` = ? WHERE `identifier` = ?', { group, identifier })
    Log.write(actor, 'admin_action', 'Changed staff role',
        ('%s: %s -> %s%s'):format(identifier, existing.group, group,
            args.reason and (' (' .. H.str(args.reason, 200) .. ')') or ''),
        { identifier = identifier, severity = 'high' })
    return H.ok()
end)

Registry.invoke('adminpanel:removeAdmin', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local identifier = H.str(args.identifier or target.identifier or target.steamHex, 100)
    if identifier == '' then return H.fail('missing_identifier') end

    local existing = Perms.adminOf(identifier)
    if not existing then return H.fail('not_an_admin') end
    if not Perms.outranks(actor, existing.group) then return H.fail('cannot_modify_equal_or_higher_rank') end

    MySQL.update.await('DELETE FROM `wc_admins` WHERE `identifier` = ?', { identifier })
    Log.write(actor, 'admin_action', 'Removed staff member', identifier,
        { identifier = identifier, severity = 'high' })
    return H.ok()
end)

--- The identifier the roster knows whoever is on server id `src` by (the same one Players.register
--- files him under), or nil when nobody is connected there.
local function liveIdentifier(src)
    if not GetPlayerName(src) then return nil end
    local snap = Vorp.snapshot(src)
    local cached = Players.get(src) or {}
    return (snap and snap.identifier) or cached.identifier or Vorp.identifiers(src).license
end

--- Is `identifier` one of the identities of whoever is on server id `src` right now? A roster row may
--- hold the licence or a bare steam / discord id, so every identifier he connected with counts.
local function carries(src, identifier)
    if liveIdentifier(src) == identifier then return true end
    for i = 0, GetNumPlayerIdentifiers(src) - 1 do
        local id = GetPlayerIdentifier(src, i)
        if id and (id == identifier or id:match('^[^:]+:(.+)$') == identifier) then return true end
    end
    return false
end

Registry.invoke('adminpanel:adminAction', 'admin.action', function(actor, args)
    args = type(args) == 'table' and args or {}
    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local src = tonumber(target.source)
    local action = H.str(args.action, 32)

    -- Rank first, and before anything is looked up. w_admin resolved the target BEFORE checking the
    -- permission, so the lookup ran for callers who were never allowed to make the call.
    local identifier = H.str(target.identifier or target.steamHex, 100)
    if identifier ~= '' then
        local existing = Perms.adminOf(identifier)
        if existing and not Perms.outranks(actor, existing.group) then
            return H.fail('cannot_act_on_equal_or_higher_rank')
        end
    end

    if action == 'kick' then
        if not src then return H.fail('player_not_online') end
        -- ! The server id must still be the staff member the rank was checked on. The website read it
        --    when the page loaded and server ids are reused: a source sent beside a junior's
        --    identifier, or with none, kicked whoever held it (a senior admin too) past the rank check.
        local live = liveIdentifier(src)
        if not live or (identifier ~= '' and not carries(src, identifier)) then
            return H.fail('player_not_online')
        end
        if identifier == '' then
            identifier = live
            local existing = Perms.adminOf(identifier)
            if existing and not Perms.outranks(actor, existing.group) then
                return H.fail('cannot_act_on_equal_or_higher_rank')
            end
        end
        DropPlayer(src, H.str(args.reason, 200) ~= '' and H.str(args.reason, 200) or 'Removed by an administrator')
        Log.write(actor, 'admin_action', 'Kicked staff member', identifier, { identifier = identifier })
        return H.ok()
    end

    if action == 'teleport' or action == 'spectate' then
        -- Both need an in-game admin to move or attach a camera. The caller is on a website, so
        -- there is nobody to move — the live map's own teleport is the path that works from there.
        return H.fail('requires_in_game_admin')
    end

    return H.fail('invalid_action')
end)
