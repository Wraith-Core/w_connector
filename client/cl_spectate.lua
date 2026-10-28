--- Spectate, client half: the server's session messages go to the hidden capture page (nui/capture.html),
--- and the page's offer and ICE go back to the server, which checks they come from the session's target.
--- Another client resource may not raise them locally.

local function foreign()
    local inv = GetInvokingResource()
    return inv ~= nil and inv ~= GetCurrentResourceName()
end

RegisterNetEvent('w_connector:spectateStart', function(sessionId, iceServers)
    if foreign() then return end
    SendNUIMessage({ action = 'webrtcStart', sessionId = sessionId, iceServers = iceServers })
end)

RegisterNetEvent('w_connector:spectateSignal', function(sessionId, kind, data)
    if foreign() then return end
    SendNUIMessage({ action = 'webrtcSignal', sessionId = sessionId, kind = kind, data = data })
end)

RegisterNetEvent('w_connector:spectateStop', function(sessionId)
    if foreign() then return end
    SendNUIMessage({ action = 'webrtcStop', sessionId = sessionId })
end)

RegisterNUICallback('webrtcSignalOut', function(d, cb)
    if type(d) == 'table' then TriggerServerEvent('w_connector:spectateOut', d.sessionId, d.kind, d.data) end
    cb('ok')
end)
