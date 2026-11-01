-- Network entity deletion is decided on the server, including ownership, occupied mounts,
-- routing bucket and distance. A client never gets an unrestricted delete ticket.
local C = WC.Console
local function distance(a, b) return math.sqrt((a.x-b.x)^2 + (a.y-b.y)^2 + (a.z-b.z)^2) end
local function protected(entity)
    if not entity or entity == 0 or not DoesEntityExist(entity) then return true end
    local state = Entity(entity).state
    if state.horseUUID or state.w_stables or state.owner or state.owned or state.vehicleid then return true end
    local kind, at = GetEntityType(entity), GetEntityCoords(entity)
    for _, id in ipairs(GetPlayers()) do
        local p = GetPlayerPed(tonumber(id))
        if p and p ~= 0 then
            if p == entity then return true end
            if kind == 2 and GetVehiclePedIsIn(p, false) == entity then return true end
            -- RedM mount lookup is client-only; a nearby rider protects the mount on the server.
            if kind == 1 and distance(GetEntityCoords(p), at) < 2.5 then return true end
        end
    end
    return false
end
local function erase(entity, radius, ctx)
    if not ctx.valid() then return false, 'no_session' end
    local p = GetPlayerPed(ctx.source)
    if not p or p == 0 or not entity or entity == 0 or not DoesEntityExist(entity) then return false, 'quick_no_target' end
    if GetEntityRoutingBucket(entity) ~= GetPlayerRoutingBucket(ctx.source) or protected(entity) then return false, 'quick_protected_entity' end
    if distance(GetEntityCoords(entity), GetEntityCoords(p)) > radius then return false, 'quick_too_far' end
    DeleteEntity(entity)
    return true
end
local function removed(entity)
    local deadline = GetGameTimer() + 1000
    while DoesEntityExist(entity) and GetGameTimer() < deadline do Wait(25) end
    if DoesEntityExist(entity) then return false, 'quick_delete_failed' end
    return true
end
C.define('self.deleteEntity', function() return type(NetworkGetEntityFromNetworkId) == 'function' end, function(data, ctx)
    local entity = NetworkGetEntityFromNetworkId(data.args.netId)
    local yes, err = erase(entity, 100, ctx)
    if not yes then return false, err end
    return removed(entity)
end)
C.define('self.deleteVehicle', function() return type(GetAllVehicles) == 'function' end, function(_, ctx)
    local at, nearest, range = GetEntityCoords(GetPlayerPed(ctx.source)), nil, 6.0
    for _, entity in ipairs(GetAllVehicles()) do
        if DoesEntityExist(entity) and not protected(entity) then
            local d = distance(at, GetEntityCoords(entity))
            if d < range and GetEntityRoutingBucket(entity) == GetPlayerRoutingBucket(ctx.source) then nearest, range = entity, d end
        end
    end
    if not nearest then return false, 'err_no_vehicle' end
    local yes, err = erase(nearest, 6, ctx)
    if not yes then return false, err end
    return removed(nearest)
end)
C.define('self.clearArea', function() return type(GetAllPeds) == 'function' and type(GetAllVehicles) == 'function' and type(GetAllObjects) == 'function' end, function(data, ctx)
    local deleted, skipped, count, pending = 0, 0, 0, {}
    for _, pool in ipairs({ GetAllPeds(), GetAllVehicles(), GetAllObjects() }) do
        for _, entity in ipairs(pool) do
            if count >= 100 then break end
            if DoesEntityExist(entity) and distance(GetEntityCoords(entity), GetEntityCoords(GetPlayerPed(ctx.source))) <= data.args.radius then
                count = count + 1
                local yes = erase(entity, data.args.radius, ctx)
                if yes then pending[#pending + 1] = entity else skipped = skipped + 1 end
                if count % 10 == 0 then Wait(0); if not ctx.valid() then break end end
            end
        end
    end
    -- One shared acknowledgement window, rather than up to 100 sequential one-second waits.
    local deadline = GetGameTimer() + 1000
    repeat
        local left = false
        for _, entity in ipairs(pending) do if DoesEntityExist(entity) then left = true; break end end
        if not left or GetGameTimer() >= deadline then break end
        Wait(25)
    until not ctx.valid()
    for _, entity in ipairs(pending) do if DoesEntityExist(entity) then skipped = skipped + 1 else deleted = deleted + 1 end end
    return true, { removed = deleted, skipped = skipped, interrupted = not ctx.valid() or nil }
end)
