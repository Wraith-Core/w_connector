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

--- (2026-10-14) The roster IS the game's staff ranks: w_core keeps who holds what (w_rank_members,
--- several ranks a person, by license or steam). The website still sees ONE role a staff member: his
--- highest rank. Granting here adds a rank; changing swaps the shown (highest) one; removing takes them
--- all. The master does any of it; since 2026-10-24 (owner) staff holding the node do it too, for ranks and
--- people below their own level only (Perms.managesLevel). A master from server.cfg (w_ranks:masters)
--- cannot be changed or removed from here. wc_admins only keeps the resolved-report count.

--- A stable number for a roster entry (the panel keys its rows on `id`)
local function idOf(identifier)
    local h = 5381
    for i = 1, #identifier do h = (h * 33 + identifier:byte(i)) & 0x7FFFFFFF end
    return h
end

Registry.invoke('adminpanel:GetAdminsData', 'admins.view', function()
    Perms.load()
    local reports = {}
    for _, r in ipairs(MySQL.query.await('SELECT `identifier`, `resolved_reports` FROM `wc_admins`') or {}) do
        reports[(r.identifier or ''):lower()] = tonumber(r.resolved_reports) or 0
    end
    local admins = {}
    for identifier in pairs(Perms.members) do
        local entry = Perms.adminOf(identifier)
        if entry then
            local role = Perms.get(entry.group)
            local src = tonumber(entry.online)
            local live = src and Players.get(src) or nil
            local av = Players.avatars[identifier] or (live and live.identifier and Players.avatars[live.identifier]) or {}
            admins[#admins + 1] = {
                id = idOf(identifier),
                source = src,
                steamHex = identifier,     -- the panel's name for "whichever identifier matched"
                identifier = identifier,
                username = entry.username ~= '' and entry.username or (av.discord_username or identifier),
                realName = av.discord_username or entry.username,
                role = entry.group,
                roles = entry.groups,      -- every rank he holds (the panel shows `role`, the highest)
                roleLevel = role and role.lvl or 0,
                avatar = av.avatar_url or '',
                online = src ~= nil,
                lastLogin = live and live.lastLogin or nil,
                reportsFinalized = reports[identifier] or 0,
                discordId = live and live.discordId or av.discord_id,
            }
        end
    end
    table.sort(admins, function(x, y) return (x.roleLevel or 0) > (y.roleLevel or 0) end)
    return { admins = admins }
end)

--- Grant a rank by player or identifier (it is added to the ranks he already holds).
Registry.invoke('adminpanel:setPermission', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local api = Perms.core()
    if not api then return H.fail('ranks_unavailable') end

    local ref = H.playerRef(args)
    local group = Perms.canon(H.str(args.permission or args.role or args.group, 64))
    local role = Perms.get(group)
    if not role then return H.fail('unknown_role') end
    if not Perms.managesLevel(actor, role.lvl) then return H.fail('rank_not_below_yours') end

    local src = H.liveSource(ref)
    local identifier = Perms.normalizeIdentifier(H.str(ref.identifier or args.identifier, 100))
    local target
    if src then
        target = { source = src }
    elseif identifier then
        target = { identifier = identifier, name = ref.username }
    else
        return H.fail('missing_identifier')
    end

    local ok, err = api:RanksAssign(0, target, group)
    if not ok then return H.fail(Perms.rankError(err)) end
    Perms.load()
    Log.write(actor, 'admin_action', 'Granted staff role',
        ('%s -> %s'):format(identifier or ('#' .. tostring(src)), group),
        { name = ref.username, identifier = identifier, severity = 'high' })
    return H.ok()
end)

--- Change the rank the panel shows (his highest) to another one; his other ranks stay.
Registry.invoke('adminpanel:changeAdminRole', 'change.admin.role', function(actor, args)
    args = type(args) == 'table' and args or {}
    local api = Perms.core()
    if not api then return H.fail('ranks_unavailable') end

    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local identifier = Perms.normalizeIdentifier(H.str(target.identifier or target.steamHex or args.identifier, 100))
    if not identifier then return H.fail('missing_identifier') end

    local group = Perms.canon(H.str(args.role or args.group, 64))
    local role = Perms.get(group)
    if not role then return H.fail('unknown_role') end
    if not Perms.managesLevel(actor, role.lvl) then return H.fail('rank_not_below_yours') end

    local existing = Perms.adminOf(identifier)
    if not existing then return H.fail('not_an_admin') end
    if not Perms.managesLevel(actor, Perms.level(existing.group)) then return H.fail('target_outranks_you') end
    if existing.group == group then return H.ok() end

    -- the new one first: a failed swap must never leave him with nothing
    local ok, err = api:RanksAssign(0, { identifier = existing.identifier, name = existing.username }, group)
    if not ok then return H.fail(Perms.rankError(err)) end
    ok, err = api:RanksRevoke(0, existing.identifier, existing.group)
    Perms.load()
    if not ok then return H.fail(Perms.rankError(err)) end

    Log.write(actor, 'admin_action', 'Changed staff role',
        ('%s: %s -> %s%s'):format(identifier, existing.group, group,
            args.reason and (' (' .. H.str(args.reason, 200) .. ')') or ''),
        { identifier = identifier, severity = 'high' })
    return H.ok()
end)

--- Take every rank from a staff member (a master from server.cfg keeps his).
Registry.invoke('adminpanel:removeAdmin', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local api = Perms.core()
    if not api then return H.fail('ranks_unavailable') end

    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local identifier = Perms.normalizeIdentifier(H.str(args.identifier or target.identifier or target.steamHex, 100))
    if not identifier then return H.fail('missing_identifier') end

    local existing = Perms.adminOf(identifier)
    if not existing then return H.fail('not_an_admin') end
    if not Perms.managesLevel(actor, Perms.level(existing.group)) then return H.fail('target_outranks_you') end
    local lastErr
    for _, rank in ipairs(existing.groups or {}) do
        local ok, err = api:RanksRevoke(0, existing.identifier, rank)
        if not ok then lastErr = err end
    end
    Perms.load()
    if lastErr then return H.fail(Perms.rankError(lastErr)) end

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
