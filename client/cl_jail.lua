--- 2.8.0: the admin jail, on the jailed player's own screen (ops/jail.lua holds him; this only shows it).
--- The page draws «سجن إداري», the time left and the reason (web/src/app/JailBanner.tsx); it counts down by itself.

local function nui(action, data) SendNUIMessage({ action = action, data = data or {} }) end

RegisterNetEvent('w_connector:jail:state', function(state)
    if type(state) == 'table' then
        nui('jail', { left = tonumber(state.left) or 0, reason = tostring(state.reason or '') })
    else
        nui('jail', { left = 0 })
    end
end)

RegisterNetEvent('w_connector:jail:freed', function()
    nui('jail', { left = 0, freed = true })
end)

-- the server put him somewhere far: load the ground there so he does not fall through it
RegisterNetEvent('w_connector:jail:moved', function(at)
    if type(at) ~= 'table' or not at.x then return end
    RequestCollisionAtCoord(at.x + 0.0, at.y + 0.0, at.z + 0.0)
end)

-- after a restart of this resource (or a join), ask for the state once the page is up
CreateThread(function()
    Wait(5000)
    TriggerServerEvent('w_connector:jail:ask')
end)
