--- The bridge: the only way into this resource from outside.
---
--- Outbound only. No inbound port is opened; the resource long-polls the website for queued actions
--- and posts results back, authenticated by one header. That is what lets a customer install this
--- behind any firewall with nothing to configure but an API key.
---
--- The protocol is fixed by the website, which is already deployed — the action types, the error
--- strings, the calling convention and the result shape all have to match exactly or web code has
--- to change. See the notes on each branch.

local ENDPOINT = Config.endpoint
local HDR = { ['Content-Type'] = 'application/json', ['x-api-key'] = Config.apiKey }

local function report(id, ok, err, result)
    if not id then return end
    PerformHttpRequest(ENDPOINT .. '/result', function() end, 'POST',
        json.encode({ id = id, ok = ok and true or false, error = err, result = result }), HDR)
end

--- Turn `action.actor` into a validated actor, or nil.
---
--- Failing closed on an unrecognised group is deliberate and it is a change from w_admin, which
--- fell back to `owner`. An unknown role therefore became the MOST privileged role on the server —
--- the exact inversion of what a fallback should do — and it fires on ordinary drift, not just
--- attack: rename a role in the panel while an action is in flight, or point a server at a site
--- whose role names have moved on, and a restricted moderator's action executes as the owner.
local function actorFor(action)
    return Perms.actorFrom(action and action.actor)
end

local function runAction(a)
    if type(a) ~= 'table' or not a.type then return end

    local actor = actorFor(a)
    if not actor then
        report(a.id, false, 'unknown_group')
        return
    end

    local data = a.data

    -- READ — three names, each returning a table the website streams straight through.
    if a.type == 'read' then
        local rd = type(data) == 'table' and data or {}
        local ok, result, err = Registry.callRead(actor, rd.name, rd.args or {})
        report(a.id, ok, err, result)
        return
    end

    -- INVOKE — the primary path, and deliberately an OPEN surface.
    --
    -- src/features/sites/shopDelivery.ts invokes a callback name the STORE OWNER types into the
    -- dashboard, validated only against a character pattern. Restricting this to an allow-list
    -- would break every shop product that delivers through a third-party resource. An unregistered
    -- name answers `unknown_callback` and the website decides what that means — it already
    -- classifies it as a permanent failure rather than retrying forever.
    --
    -- `args` is passed VERBATIM and may be a bare primitive: the website sends a number to
    -- `adminpanel:scheduleRestart` and a string to `adminpanel:sendAnnouncement`.
    if a.type == 'invoke' then
        local rd = type(data) == 'table' and data or {}
        local ok, result, err = Registry.callInvoke(actor, rd.name, rd.args)
        report(a.id, ok, err, result)
        return
    end

    -- WEBRTC — the spectate relay.
    --
    -- Spectating through WebRTC is spectating. These three branches ran before any permission test
    -- in the original, so a role explicitly denied `player.spectate` could still open a live video
    -- feed of any player's screen — the most invasive thing the panel can do, and the one path that
    -- did not ask.
    if a.type == 'webrtc_start' or a.type == 'webrtc_deliver' or a.type == 'webrtc_stop' then
        if not Perms.has(actor, 'player.spectate') then
            report(a.id, false, 'no_permission')
            return
        end
        local target = tonumber(type(data) == 'table' and data.target or nil)
        if not target then
            report(a.id, false, 'missing_target')
            return
        end
        if a.type == 'webrtc_start' then
            TriggerClientEvent('w_connector:webrtcStart', target, data.sessionId, data.iceServers)
        elseif a.type == 'webrtc_deliver' then
            TriggerClientEvent('w_connector:webrtcSignal', target, data.sessionId, data.kind, data.data)
        else
            TriggerClientEvent('w_connector:webrtcStop', target, data.sessionId)
        end
        report(a.id, true)
        return
    end

    -- DIRECT VERBS — kick / ban / heal / … Each returns `{success, message}`, which is what the
    -- website's `outcome()` reads.
    local ok, result, err = Registry.callAction(actor, a.type, type(data) == 'table' and data or {})
    if not ok then
        report(a.id, false, err)
    elseif type(result) == 'table' then
        report(a.id, result.success and true or false, result.message)
    else
        report(a.id, true)
    end
end

--- The streamer's NUI bounces its offer and ICE candidates through the server to the website, which
--- the admin's viewer then drains. Same base URL, same key.
RegisterNetEvent('w_connector:webrtcSignalOut', function(sessionId, kind, data)
    if not Config.enabled or Config.base == '' then return end
    -- The source is the player being spectated, and the website validates the session against the
    -- guild, so a forged sessionId from another player reaches a session it does not own and is
    -- answered with `no_session`.
    PerformHttpRequest(Config.base .. '/webrtc/signal', function() end, 'POST',
        json.encode({ sessionId = sessionId, role = 'streamer', kind = kind, data = data }), HDR)
end)

if not Config.enabled then
    print('^3[w_connector]^0 no wraith_apikey set — paste the key from your RedM panel into server.cfg:')
    print('^3[w_connector]^0     set wraith_apikey "fvm_....."')
    print('^3[w_connector]^0 The connector is idle until then.')
    return
end

CreateThread(function()
    Schema.await()
    Wait(3000)

    local masked = (#Config.apiKey > 10)
        and (Config.apiKey:sub(1, 6) .. '...' .. Config.apiKey:sub(-4))
        or '(short/invalid)'
    print('^2[w_connector]^0 linked — long-polling ' .. tostring(ENDPOINT))
    -- print('^2[w_connector]^0 using key ' .. masked .. ' — must match the key shown in your RedM panel.')
    local function count(t)
        local n = 0
        for _ in pairs(t) do n = n + 1 end
        return n
    end
    -- print(('^2[w_connector]^0 %d callbacks, %d reads, %d actions registered.')
        -- :format(count(Registry.invokes), count(Registry.reads), count(Registry.actions)))

    while true do
        local done = false
        PerformHttpRequest(ENDPOINT .. '/next?wait=' .. Config.pollWait, function(code, body)
            done = true
            if code == 200 and body and body ~= '' then
                local ok, data = pcall(json.decode, body)
                if ok and type(data) == 'table' and data.action then
                    -- Run in its own thread so a slow handler does not hold the poll loop; the
                    -- guard below still bounds how long we wait before re-polling.
                    local action = data.action
                    CreateThread(function()
                        local okRun, err = pcall(runAction, action)
                        if not okRun then
                            print('^1[w_connector] action error:^0 ' .. tostring(err))
                            report(action.id, false, 'exception')
                        end
                    end)
                end
            end
        end, 'GET', '', HDR)

        -- The site clamps `wait` to 1–30s, so anything past that plus a margin means the request
        -- itself is lost rather than merely idle.
        local guard = 0
        while not done and guard < (Config.pollWait + 12) do
            Wait(500)
            guard = guard + 0.5
        end
        Wait(150)
    end
end)
