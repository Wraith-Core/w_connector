--- Death log, client half: when this player dies, tell the server who killed them and with what.
--- GET_PED_SOURCE_OF_DEATH and GET_PED_CAUSE_OF_DEATH exist on both games; a game without one simply
--- reports less.

local function killerServerId(ped)
    if not GetPedSourceOfDeath then return nil end
    local ent = GetPedSourceOfDeath(ped)
    if not ent or ent == 0 or not DoesEntityExist(ent) then return nil end
    if IsEntityAVehicle(ent) then ent = GetPedInVehicleSeat(ent, -1) end
    if ent and ent ~= 0 and IsPedAPlayer(ent) then
        local idx = NetworkGetPlayerIndexFromPed(ent)
        if idx and idx ~= -1 then return GetPlayerServerId(idx) end
    end
    return nil
end

CreateThread(function()
    local wasDead = false
    while true do
        Wait(500)
        local ped = PlayerPedId()
        local dead = ped ~= 0 and IsEntityDead(ped)
        if dead and not wasDead then
            local cause = GetPedCauseOfDeath and GetPedCauseOfDeath(ped) or 0
            local c = GetEntityCoords(ped)
            TriggerServerEvent('w_connector:died', killerServerId(ped), cause, c.x, c.y, c.z)
        end
        wasDead = dead
    end
end)
