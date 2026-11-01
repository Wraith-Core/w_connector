-- Standalone counterpart of the w_admin tool vocabulary. No framework or w_lib dependency.
WConsoleTools = { modes = {}, spawned = {} }
local T, redm = WConsoleTools, GetGameName() == 'redm'
local toggles = { invisible = true, boost = true, stamina = true, showCoords = true, hashes = true, laser = true }
local function ok(data) return { ok = true, data = data } end
local function fail(key) return { ok = false, error = key } end
local function ped() return PlayerPedId() end
local function stateOf(e)
    if not NetworkGetEntityIsNetworked(e) then return {} end
    return Entity(e).state
end
local function protected(e)
    if not e or e == 0 or not DoesEntityExist(e) then return true end
    if IsEntityAPed(e) and IsPedAPlayer(e) then return true end
    local s = stateOf(e)
    if s.horseUUID or s.w_stables or s.owner or s.owned then return true end
    for _, idx in ipairs(GetActivePlayers()) do
        local p = GetPlayerPed(idx)
        if p == e or GetVehiclePedIsIn(p, false) == e or (redm and GetMount(p) == e) then return true end
    end
    return false
end
T.protected = protected
local function control(e) return DoesEntityExist(e) and WMenu.entityControl(e) end
local function vehicle()
    local own = GetVehiclePedIsIn(ped(), false)
    if own ~= 0 then return own end
    local at, nearest, distance = GetEntityCoords(ped()), nil, 6.0
    for _, e in ipairs(GetGamePool('CVehicle')) do
        local d = #(GetEntityCoords(e) - at)
        if d < distance and not protected(e) then nearest, distance = e, d end
    end
    return nearest
end
local function ray(distance)
    local rot, at = GetGameplayCamRot(2), GetGameplayCamCoord()
    local yaw, pitch = math.rad(rot.z), math.rad(rot.x)
    local to = vector3(at.x - math.sin(yaw) * math.cos(pitch) * distance,
        at.y + math.cos(yaw) * math.cos(pitch) * distance, at.z + math.sin(pitch) * distance)
    local handle = StartShapeTestRay(at.x, at.y, at.z, to.x, to.y, to.z, 511, ped(), 7)
    local deadline = GetGameTimer() + 500
    repeat
        local status, hit, coords, _, entity = GetShapeTestResult(handle)
        if status == 2 then return hit == 1 or hit == true, coords, entity end
        Wait(0)
    until GetGameTimer() >= deadline
    return false
end
local function remove(e)
    if protected(e) then return false, 'quick_protected_entity' end
    if not control(e) then return false, 'no_control' end
    if protected(e) then return false, 'quick_protected_entity' end
    SetEntityAsMissionEntity(e, true, true)
    DeleteEntity(e)
    local deadline = GetGameTimer() + 1000
    while DoesEntityExist(e) and GetGameTimer() < deadline do Wait(25) end
    if DoesEntityExist(e) then return false, 'quick_delete_failed' end
    T.spawned[e] = nil
    return true
end
local function ownCount()
    local count = 0
    for e, model in pairs(T.spawned) do
        if DoesEntityExist(e) and GetEntityModel(e) == model then count = count + 1 else T.spawned[e] = nil end
    end
    return count
end
local function spawn(action, a)
    if ownCount() >= 25 then return fail('quick_spawn_limit') end
    if WMenu.selfState().noclip or WMenu.spectating() then return fail('quick_exit_mode') end
    local hash = GetHashKey(a.model)
    local wagon = action == 'spawnWagon'
    if not IsModelInCdimage(hash) or not IsModelValid(hash) or (wagon and not IsModelAVehicle(hash))
        or (not wagon and not IsModelAPed(hash)) then return fail('invalid_model') end
    RequestModel(hash)
    local deadline = GetGameTimer() + 8000
    while not HasModelLoaded(hash) and GetGameTimer() < deadline do Wait(25) end
    if not HasModelLoaded(hash) then SetModelAsNoLongerNeeded(hash); return fail('quick_model_timeout') end
    if not WConsole.live() then SetModelAsNoLongerNeeded(hash); return fail('no_session') end
    local c = GetOffsetFromEntityInWorldCoords(ped(), 0.0, wagon and 7.0 or 3.0, 0.0)
    local e
    if wagon then e = CreateVehicle(hash, c.x, c.y, c.z, GetEntityHeading(ped()), true, true, false, false)
    elseif redm then e = CreatePed(hash, c.x, c.y, c.z, GetEntityHeading(ped()), true, true, false, false)
    else e = CreatePed(4, hash, c.x, c.y, c.z, GetEntityHeading(ped()), true, true) end
    SetModelAsNoLongerNeeded(hash)
    if not e or e == 0 or not DoesEntityExist(e) then return fail('invalid_model') end
    SetEntityAsMissionEntity(e, true, true); T.spawned[e] = hash
    if wagon then
        SetVehicleOnGroundProperly(e)
        if a.mount ~= false then TaskWarpPedIntoVehicle(ped(), e, -1) end
    else
        if redm then Citizen.InvokeNative(0x283978A15512B2FE, e, true) end
        SetEntityHealth(e, GetEntityMaxHealth(e))
        if action == 'spawnHorse' then
            Citizen.InvokeNative(0xADB3F206518799E8, e, GetHashKey('PLAYER'))
            Citizen.InvokeNative(0xCC97B29285B1DC3B, e, 1)
            if a.mount ~= false then SetPedOntoMount(ped(), e, -1, true) end
        else
            SetBlockingOfNonTemporaryEvents(e, true)
            if a.behavior == 'wander' then TaskWanderStandard(e, 10.0, 10) else FreezeEntityPosition(e, true) end
        end
    end
    return ok({ entity = NetworkGetNetworkIdFromEntity(e) })
end
function T.state()
    local b, c = WMenu.selfState(), GetEntityCoords(ped())
    local s = { noclip = b.noclip, godmode = b.godmode, names = b.ids, canGoBack = b.back,
        spectating = WMenu.spectateTarget and WMenu.spectateTarget() or false, coords = { x = c.x, y = c.y, z = c.z, heading = GetEntityHeading(ped()) }, spawnedCount = ownCount() }
    for name in pairs(toggles) do s[name] = T.modes[name] == true end
    return s
end
function T.stop()
    for name in pairs(T.modes) do T.modes[name] = false end
    WMenu.stopAll()
    SetEntityVisible(ped(), true)
    SetPedMoveRateOverride(ped(), 1.0)
end
local mapThemePending
RegisterNetEvent('w_map:editorSaved', function(kind, saved, err, id)
    if kind ~= 'look' or not mapThemePending or mapThemePending.id ~= id then return end
    local pending = mapThemePending; mapThemePending = nil
    pending.promise:resolve({ ok = saved == true, error = err })
end)
-- 2.2.0: player.sitOnMount runs on the TARGET's own client (ops/native_player.lua; was w_admin
-- cl_admin.lua): the closest live horse within 8 m that no player rides, then the saddle.
local function sitOnMount()
    if not redm then return fail('capability_missing') end
    local me = ped()
    if IsPedOnMount(me) or IsPedInAnyVehicle(me, false) then return fail('err_target_mounted') end
    local at, closest, distance = GetEntityCoords(me), nil, 8.0
    for _, horse in ipairs(GetGamePool('CPed')) do
        local isHorse = Citizen.InvokeNative(0x772A1969F649E902, GetEntityModel(horse)) -- IsThisModelAHorse
        if horse ~= me and (isHorse == 1 or isHorse == true) and not IsPedDeadOrDying(horse, true) then
            local d = #(GetEntityCoords(horse) - at)
            if d < distance then
                local ridden = false
                for _, idx in ipairs(GetActivePlayers()) do if GetMount(GetPlayerPed(idx)) == horse then ridden = true break end end
                if not ridden then closest, distance = horse, d end
            end
        end
    end
    if not closest then return fail('no_mount_nearby') end
    SetPedOntoMount(me, closest, -1, true)
    return ok()
end
function T.execute(name, a, target)
    if name == 'player.sitOnMount' then return sitOnMount() end
    local action = name:match('^[a-z]+%.(.+)$')
    if name == 'query.map' then
        local cfg = exports.w_map:GetMapConfig()
        if type(cfg) ~= 'table' then return fail('capability_missing') end
        local data = exports.w_map:GetMapData()
        return ok({ tilesBase = 'https://cfx-nui-w_map/web/tiles', theme = cfg.theme or 'light', projection = cfg.projection,
            tiles = cfg.tiles, mapData = data })
    end
    if name:sub(1, 4) == 'map.' then
        if action == 'waypoint' or action == 'clearWaypoint' then
            if redm then
                if GetResourceState('w_map') ~= 'started' then return fail('capability_missing') end
                local result
                if action == 'clearWaypoint' then result = exports.w_map:ClearWaypoint() else result = exports.w_map:SetWaypoint(a.x, a.y) end
                return { ok = result ~= false }
            end
            if action == 'clearWaypoint' then SetWaypointOff() else SetNewWaypoint(a.x, a.y) end
            return ok()
        elseif action == 'copyCoords' then
            SendNUIMessage({ action = 'connectorClipboard', data = { text = ('vector2(%.3f, %.3f)'):format(a.x, a.y) } }); return ok()
        elseif action == 'setTheme' then
            if mapThemePending then return fail('busy') end
            local pending = { id = 'wc:' .. GetGameTimer(), promise = promise.new() }; mapThemePending = pending
            TriggerServerEvent('w_map:saveTheme', a.theme, pending.id)
            SetTimeout(8000, function() if mapThemePending == pending then mapThemePending = nil; pending.promise:resolve(fail('timeout')) end end)
            return Citizen.Await(pending.promise)
        end
    end
    if name == 'player.spectate' then
        if a.state == false then WMenu.stopSpectate(); return ok() end
        if not a.coords then return fail('player_offline') end
        WMenu.close(); WMenu.startSpectate(target, a.coords)
        return { ok = true, active = true }
    end
    if action == 'names' then return WMenu.applySelf('self.viewids', { on = a.state }) end
    if action == 'noclip' or action == 'godmode' then return WMenu.applySelf(name, { on = a.state }) end
    if action == 'noclipSpeed' or action == 'tpWaypoint' or action == 'tpCoords' or action == 'tpBack' or action == 'stopSpectate' then
        return WMenu.applySelf(name, a)
    end
    if toggles[action] then
        if action == 'laser' and a.state == true and (WMenu.selfState().noclip or WMenu.spectating()) then return fail('quick_exit_mode') end
        T.modes[action] = a.state == true
        if action == 'invisible' then SetEntityVisible(ped(), not T.modes.invisible) end
        return { ok = true, active = T.modes[action] }
    end
    if action == 'spawnHorse' or action == 'spawnWagon' or action == 'spawnAnimal' or action == 'spawnPed' then return spawn(action, a) end
    if action == 'cleanupSpawned' then
        local removed, skipped = 0, 0
        for e in pairs(T.spawned) do local yes = remove(e); if yes then removed = removed + 1 else skipped = skipped + 1 end end
        return ok({ removed = removed, skipped = skipped })
    end
    if action == 'copyCoords' then
        local c, heading = GetEntityCoords(ped()), GetEntityHeading(ped())
        local text = a.type == 'heading' and ('%.3f'):format(heading)
            or a.type == 'coords3' and ('vector3(%.3f, %.3f, %.3f)'):format(c.x, c.y, c.z)
            or ('vector4(%.3f, %.3f, %.3f, %.3f)'):format(c.x, c.y, c.z, heading)
        SendNUIMessage({ action = 'connectorClipboard', data = { text = text } }); return ok({ text = text })
    end
    if action == 'cleanPed' then ClearPedBloodDamage(ped()); ClearPedWetness(ped()); return ok() end
    if action == 'tpForward' then
        local hit, c = ray(15.0)
        if not hit then return fail('err_invalid_coords') end
        return WMenu.applySelf('self.tpCoords', { x = c.x, y = c.y, z = c.z + 0.6 })
    end
    if action == 'healMount' then
        local mount = redm and GetMount(ped()) or 0
        if mount == 0 or not control(mount) then return fail('no_mount_nearby') end
        if IsEntityDead(mount) then return fail('quick_mount_dead') end
        SetEntityHealth(mount, GetEntityMaxHealth(mount))
        Citizen.InvokeNative(0xC6258F41D86676E0, mount, 0, 100)
        Citizen.InvokeNative(0xC6258F41D86676E0, mount, 1, 100)
        RestorePedStamina(mount, 100.0); ClearPedBloodDamage(mount); return ok()
    end
    if action == 'deleteEntity' then
        local e = NetworkGetEntityFromNetworkId(a.netId)
        if e == 0 or #(GetEntityCoords(e) - GetEntityCoords(ped())) > 100.0 then return fail('err_invalid_value') end
        local yes, error = remove(e); return { ok = yes, error = error }
    end
    if action == 'clearArea' then
        local count, skipped, at = 0, 0, GetEntityCoords(ped())
        for _, pool in ipairs({ 'CPed', 'CVehicle', 'CObject' }) do
            for _, e in ipairs(GetGamePool(pool)) do
                if count + skipped >= 100 then break end
                if #(GetEntityCoords(e) - at) <= a.radius then
                    if not WConsole.live() then return fail('no_session') end
                    local yes = remove(e); if yes then count = count + 1 else skipped = skipped + 1 end
                end
            end
        end
        return ok({ removed = count, skipped = skipped })
    end
    if action == 'repairVehicle' or action == 'flipVehicle' or action == 'vehicleBoost' or action == 'deleteVehicle' then
        local e = vehicle()
        if not e or not control(e) then return fail('err_no_vehicle') end
        for _, idx in ipairs(GetActivePlayers()) do
            if idx ~= PlayerId() and GetVehiclePedIsIn(GetPlayerPed(idx), false) == e then return fail('quick_protected_entity') end
        end
        if action == 'repairVehicle' then SetVehicleFixed(e); SetVehicleDirtLevel(e, 0.0)
        elseif action == 'flipVehicle' then SetEntityRotation(e, 0.0, 0.0, GetEntityHeading(e), 2, true); SetVehicleOnGroundProperly(e)
        elseif action == 'vehicleBoost' then SetVehicleForwardSpeed(e, math.min(GetEntitySpeed(e) + 10.0, 50.0))
        else local yes, error = remove(e); return { ok = yes, error = error } end
        return ok()
    end
    return fail('capability_missing')
end
CreateThread(function()
    local hadBoost, hiddenPed
    while true do
        local m, p = T.modes, ped()
        if m.invisible then SetEntityVisible(p, false); hiddenPed = p
        elseif hiddenPed and not WMenu.selfState().noclip and not WMenu.spectating() then SetEntityVisible(hiddenPed, true); hiddenPed = nil end
        if m.boost then SetPedMoveRateOverride(p, 1.35); hadBoost = p
        elseif hadBoost then SetPedMoveRateOverride(hadBoost, 1.0); hadBoost = nil end
        if m.stamina then RestorePlayerStamina(PlayerId(), 1.0) end
        if m.showCoords then
            local c = GetEntityCoords(p)
            WMenu.drawWorldText(c.x, c.y, c.z + 1.2, ('%.2f, %.2f, %.2f | %.1f'):format(c.x, c.y, c.z, GetEntityHeading(p)))
        end
        if m.hashes then
            local at, n = GetEntityCoords(p), 0
            for _, pool in ipairs({ 'CPed', 'CVehicle', 'CObject' }) do
                for _, e in ipairs(GetGamePool(pool)) do
                    if n >= 30 then break end
                    local c = GetEntityCoords(e)
                    if #(c - at) < 5 and not (pool == 'CPed' and IsPedAPlayer(e)) then WMenu.drawWorldText(c.x, c.y, c.z + 0.7, tostring(GetEntityModel(e))); n = n + 1 end
                end
            end
        end
        Wait((m.boost or m.stamina or m.showCoords or m.hashes) and 0 or 250)
    end
end)
local deleting = false
RegisterCommand('+wc_console_laserdelete', function()
    local e = T.laserTarget
    if not T.modes.laser or WMenu.open or deleting or not e or not DoesEntityExist(e) or protected(e) then return end
    local netId = NetworkGetEntityIsNetworked(e) and NetworkGetNetworkIdFromEntity(e) or 0
    if netId == 0 then return end
    deleting = true
    WConsole.ask('self.deleteEntity', { args = { netId = netId } }, function() deleting = false end)
end, false)
RegisterCommand('-wc_console_laserdelete', function() end, false)
if RegisterKeyMapping then RegisterKeyMapping('+wc_console_laserdelete', 'Wraith entity deletion tool', 'keyboard', 'J') end
RegisterCommand('+wc_console_lasercopy', function()
    local e = T.laserTarget
    if not T.modes.laser or not WConsole.live() or WMenu.open or not e or not DoesEntityExist(e) then return end
    local c = GetEntityCoords(e)
    SendNUIMessage({ action = 'connectorClipboard', data = {
        text = ('model: %s | vec4(%.3f, %.3f, %.3f, %.3f)'):format(GetEntityModel(e), c.x, c.y, c.z, GetEntityHeading(e)) } })
end, false)
RegisterCommand('-wc_console_lasercopy', function() end, false)
if RegisterKeyMapping then RegisterKeyMapping('+wc_console_lasercopy', 'Wraith copy targeted entity', 'keyboard', '7') end
CreateThread(function()
    while true do
        if T.modes.laser and not WMenu.open then
            local hit, c, e = ray(100.0)
            T.laserTarget = hit and e or nil
            if hit and c then
                local at = GetEntityCoords(ped())
                DrawLine(at.x, at.y, at.z + 0.6, c.x, c.y, c.z, 203, 1, 1, 230)
                if e and e ~= 0 then
                    WMenu.drawWorldText(c.x, c.y, c.z + 0.3, ('%s | J / 7'):format(GetEntityModel(e)))
                end
            end
            DisableControlAction(0, redm and 0x07CE1E61 or 24, true)
            Wait(0)
        else T.laserTarget = nil; Wait(250) end
    end
end)
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    T.stop()
    for e, model in pairs(T.spawned) do if DoesEntityExist(e) and GetEntityModel(e) == model and not protected(e) then DeleteEntity(e) end end
end)
