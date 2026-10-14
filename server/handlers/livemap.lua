--- The live map, and the spectate relay's server half.

--- Built from the NATIVE player list, never from the cache.
---
--- `Players.cache` is empty for everyone already connected in the seconds after a resource restart,
--- and the live map is exactly the page an admin opens when something is going wrong — i.e. the
--- worst possible moment for it to report an empty server. The cache is used only to decorate names
--- and avatars onto entries that the native list has already proven exist.
local function mapPlayers()
    local out = {}
    -- the staff: whoever holds a rank (w_core), under any identifier he plays with
    local roster = {}
    for identifier in pairs(Perms.members or {}) do roster[identifier] = true end

    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid) or {}
        local ped = GetPlayerPed(sid)
        local x, y, z, h = 0.0, 0.0, 0.0, 0.0
        if ped and ped ~= 0 then
            local c = GetEntityCoords(ped)
            x, y, z, h = c.x, c.y, c.z, GetEntityHeading(ped)
        end
        local name = p.characterName or GetPlayerName(sid)
        local av = Players.avatars[p.identifier or ''] or {}
        out[#out + 1] = {
            id = sid,
            source = sid,
            -- the id staff type (players.citizenid); sent back as `citizenid` it names the one
            -- character, where a server id read when the map loaded may since belong to someone else
            citizenid = w.citizen.idOf(sid),
            name = name,
            characterName = name,
            username = p.username or GetPlayerName(sid),
            identifier = p.identifier,
            job = p.jobLabel or p.job or 'N/A',
            isAdmin = ((p.identifier and roster[p.identifier:lower()]) or (p.steamHex and roster['steam:' .. p.steamHex:lower()])) and true or false,
            avatar = av.avatar_url,
            coordinates = { x = x, y = y, z = z },
            x = x, y = y, z = z, heading = h,
        }
    end
    return out
end

Registry.read('getMapPlayers', 'view.livemap', mapPlayers)
Registry.invoke('getMapPlayers', 'view.livemap', mapPlayers)

--- w_admin's version of this never called logAction, so the one page where an admin can move a
--- player around the world with two clicks left no record of having done so.
Registry.invoke('adminpanel:liveMapActions', 'livemap.action', function(actor, args)
    args = type(args) == 'table' and args or {}
    local action = H.str(args.action, 32)
    local target = tonumber(args.playerId or args.id or args.source)
    -- A citizen id, when the website sends one, decides who is acted on (a server id is reused as
    -- players come and go); these actions need him in the game.
    local typed = args.citizenid or args.citizenId
    if typed ~= nil and typed ~= '' then
        local who, reason = w.citizen.requireOnline(typed)
        if not who then return H.fail(reason == 'offline' and 'player_not_online' or 'player_not_found') end
        target = who.source
    end
    if not target then return H.fail('missing_target') end
    if not Vorp.snapshot(target) then return H.fail('player_not_online') end

    local p = Players.get(target) or {}

    if action == 'kick' then
        if not Perms.has(actor, 'player.kick') then return H.fail('no_permission') end
        DropPlayer(target, H.str(args.reason, 200) ~= '' and H.str(args.reason, 200) or 'Kicked by an administrator')
        Log.write(actor, 'player_action', 'Kicked player (live map)', nil,
            { name = p.characterName, identifier = p.identifier, severity = 'medium' })
        return H.ok()
    end

    if action == 'teleport' or action == 'bring' then
        -- Both need somewhere to go. From a browser there is no admin ped, so the destination is
        -- either explicit coordinates or another online player.
        local ped = GetPlayerPed(target)
        if not ped or ped == 0 then return H.fail('target_not_spawned') end

        local x, y, z = tonumber(args.x), tonumber(args.y), tonumber(args.z)
        if not (x and y and z) then
            local anchor = tonumber(args.toSource or args.adminSource)
            if not anchor then return H.fail('missing_destination') end
            local anchorPed = GetPlayerPed(anchor)
            if not anchorPed or anchorPed == 0 then return H.fail('destination_not_spawned') end
            local c = GetEntityCoords(anchorPed)
            x, y, z = c.x, c.y, c.z
        end

        if not Perms.has(actor, action == 'bring' and 'player.teleport.bring' or 'player.teleport.to_player') then
            return H.fail('no_permission')
        end
        SetEntityCoords(ped, x, y, z, false, false, false, false)
        Log.write(actor, 'player_action', 'Teleported player (live map)',
            ('%.1f, %.1f, %.1f'):format(x, y, z), { name = p.characterName, identifier = p.identifier })
        return H.ok()
    end

    return H.fail('invalid_action')
end)

--- Spectate. The website's WebRTC relay drives this; the client half captures the frame.
---
--- The panel currently has spectate switched off (`SPECTATE_ENABLED = false` in LiveMapTab.tsx)
--- because RedM has no frame-capture producer, but the whole path has to exist for the routes to
--- stay wired — and so it works the day that changes.
Registry.action('spectate', 'player.spectate', function(actor, args)
    args = type(args) == 'table' and args or {}
    local ref, live = H.playerRef(args), nil
    live = H.liveSource(ref) or tonumber(args.target or args.playerId)
    if not live then return H.fail('player_not_online') end
    return H.ok('use_webrtc_start')
end)
