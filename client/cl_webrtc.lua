--- The spectate signalling relay.
---
--- READ THIS BEFORE WIRING SPECTATE UP: the signalling below is complete and correct, but this
--- resource ships NO NUI, and WebRTC frame capture needs a browser context to capture INTO. So the
--- offer/answer/ICE exchange will complete and no video will ever arrive.
---
--- That is not a regression. The panel already has spectate switched off
--- (`SPECTATE_ENABLED = false` in admin/src/pages/redm/panel/tabs/LiveMapTab.tsx) because RedM has
--- no frame-capture producer to begin with. The relay exists so the website's routes stay wired and
--- so the day a producer exists, only this file changes.
---
--- Turning it on later means adding a `ui_page` — which is a deliberate product decision, not a
--- code change, because a `ui_page` is the one thing this resource was designed not to have.

local sessions = {}

RegisterNetEvent('w_connector:webrtcStart', function(sessionId, iceServers)
    if not sessionId then return end
    sessions[sessionId] = { iceServers = iceServers, startedAt = GetGameTimer() }
    -- Where a capture NUI would be told to begin. Nothing to send it today.
end)

RegisterNetEvent('w_connector:webrtcSignal', function(sessionId, kind, data)
    if not sessionId or not sessions[sessionId] then return end
    -- Where the viewer's answer and ICE candidates would be handed to the peer connection.
end)

RegisterNetEvent('w_connector:webrtcStop', function(sessionId)
    if not sessionId then return end
    sessions[sessionId] = nil
end)

--- The outbound half, ready for a producer to call.
---
--- `kind` is `offer` or `ice`; the viewer expects an offer's payload to be a RAW SDP STRING and an
--- ICE candidate to be the object from `candidate.toJSON()` — see SpectateModal.tsx.
function WConnectorSignalOut(sessionId, kind, data)
    if not sessionId or not sessions[sessionId] then return end
    TriggerServerEvent('w_connector:webrtcSignalOut', sessionId, kind, data)
end

--- Sessions the server never closed — a viewer who shut their laptop, a dropped connection. The
--- website expires its own side after 60s idle; this keeps the client's table from growing forever.
CreateThread(function()
    while true do
        Wait(60000)
        local now = GetGameTimer()
        for id, s in pairs(sessions) do
            if now - (s.startedAt or 0) > 600000 then sessions[id] = nil end
        end
    end
end)
