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

-- The WebRTC relay's limits. A session id is opaque but never a document; an SDP offer is a few KB
-- and ICE candidates are small; a real connection sends a handful of signals a second, never a flood.
local SESSION_MAX  = 64
local SIGNAL_MAX   = 32768
local SIGNAL_WINDOW = 1000   -- ms
local SIGNAL_BURST = 15      -- signals one player may spend inside that window
local SIGNAL_KINDS = { offer = true, answer = true, candidate = true }

local sessionOwner = {}   -- [sessionId] = the player the website opened it for
local signalSeen = {}     -- [src] = { first = ms, count = n }

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
        -- A call with a requestId runs once: a store delivery retried after a timeout that had in fact
        -- run must not grant twice (2026-10-22). The first one claims the id; a second answers from
        -- the stored result, or 'in_progress' while the first still runs (the site retries later).
        local rid = type(rd.requestId) == 'string' and rd.requestId ~= '' and #rd.requestId <= 80 and rd.requestId or nil
        if rid then
            -- affected rows: 1 = this call claimed the id, 0 = it was there already
            local claimed = MySQL.update.await(
                'INSERT IGNORE INTO `wc_requests` (`id`, `name`, `state`, `created_at`) VALUES (?, ?, ?, ?)',
                { rid, H.str(rd.name, 64), 'running', os.time() })
            local row = (not claimed or claimed == 0) and MySQL.single.await(
                'SELECT `state`, `result` FROM `wc_requests` WHERE `id` = ?', { rid }) or nil
            if row then
                if row.state ~= 'done' then report(a.id, false, 'in_progress') return end
                local okDec, prev = pcall(json.decode, row.result or 'null')
                report(a.id, true, nil, okDec and prev or nil)
                return
            end
        end
        local ok, result, err = Registry.callInvoke(actor, rd.name, rd.args)
        if rid then
            local delivered = ok and not (type(result) == 'table' and result.success == false)
            if delivered then
                MySQL.update.await('UPDATE `wc_requests` SET `state` = ?, `result` = ? WHERE `id` = ?',
                    { 'done', result ~= nil and json.encode(result) or 'null', rid })
            else
                MySQL.update.await('DELETE FROM `wc_requests` WHERE `id` = ?', { rid })
            end
        end
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
            -- the session is opened for one named player; remember who, so that only they may answer
            -- for it (see w_connector:webrtcSignalOut below)
            local sid = data.sessionId
            if type(sid) ~= 'string' or sid == '' or #sid > SESSION_MAX then
                report(a.id, false, 'missing_session')
                return
            end
            sessionOwner[sid] = target
            TriggerClientEvent('w_connector:webrtcStart', target, sid, data.iceServers)
        elseif a.type == 'webrtc_deliver' then
            TriggerClientEvent('w_connector:webrtcSignal', target, data.sessionId, data.kind, data.data)
        else
            if type(data.sessionId) == 'string' then sessionOwner[data.sessionId] = nil end
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
---
--- This is the one inbound edge that a PLAYER, not the website, drives -- a RegisterNetEvent is
--- reachable by any client script -- and every accepted call becomes an outbound request carrying
--- this server's API key. Three things follow, and all three are closed below:
---
---   * without a rate limit one player in a loop turns this server into a request amplifier against
---     the vendor API: from the server's own address, with the server's own key;
---   * without a type and length test, `data` may be a table of any size and `sessionId` any string
---     at all, and the lot of it is serialised into a JSON body;
---   * without an owner test a player may name ANY session -- including one a third party is being
---     streamed on -- and push their own offer or ICE into it.
---
--- The owner is known here, and did not need the website to tell us: `webrtc_start` above hands a
--- session to one named player, so the bridge records that pairing and only lets that player speak
--- for the session. The website still owns the guild check; this adds the server's own.

local SESSION_MAX  = 64      -- opaque, but a session id is never a document
local SIGNAL_MAX   = 32768   -- an SDP offer is a few KB, ICE candidates are small

--- Whether this press may go out: right shape, right size, this player's own session, and not a flood.
---@return boolean
local function signalAllowed(src, sessionId, kind, data)
    if type(sessionId) ~= 'string' or sessionId == '' or #sessionId > SESSION_MAX then return false end
    if type(kind) ~= 'string' or not SIGNAL_KINDS[kind] then return false end
    if type(data) ~= 'string' or #data > SIGNAL_MAX then return false end
    -- the session must be one this server opened, and it must be the caller's
    if sessionOwner[sessionId] ~= src then return false end

    local now = GetGameTimer()
    local seen = signalSeen[src]
    if not seen or now - seen.first > SIGNAL_WINDOW then
        signalSeen[src] = { first = now, count = 1 }
        return true
    end
    seen.count = seen.count + 1
    return seen.count <= SIGNAL_BURST
end

RegisterNetEvent('w_connector:webrtcSignalOut', function(sessionId, kind, data)
    if not Config.enabled or Config.base == '' then return end
    if not signalAllowed(source, sessionId, kind, data) then return end
    PerformHttpRequest(Config.base .. '/webrtc/signal', function() end, 'POST',
        json.encode({ sessionId = sessionId, role = 'streamer', kind = kind, data = data }), HDR)
end)

--- A player leaving takes their sessions and their rate window with them.
AddEventHandler('playerDropped', function()
    local src = source
    signalSeen[src] = nil
    for sid, owner in pairs(sessionOwner) do
        if owner == src then sessionOwner[sid] = nil end
    end
end)

if not Config.enabled then
    print('^3[w_connector]^0 no wraith_apikey set — paste the key from your RedM panel into server.cfg:')
    print('^3[w_connector]^0     set wraith_apikey "fvm_....."')
    print('^3[w_connector]^0 The connector is idle until then.')
    return
end

CreateThread(function()
    Schema.await()
    -- requestIds are kept 30 days; one left 'running' by a crash mid-call is released for a retry
    pcall(function()
        MySQL.update.await('DELETE FROM `wc_requests` WHERE `created_at` < ? OR (`state` = ? AND `created_at` < ?)',
            { os.time() - 30 * 86400, 'running', os.time() - 600 })
    end)
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

    local backoff = 0
    while true do
        local done, lastCode = false, nil
        PerformHttpRequest(ENDPOINT .. '/next?wait=' .. Config.pollWait, function(code, body)
            done = true
            lastCode = code
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
        -- the site down or refusing: wait longer each time (1 s up to 30 s) instead of every 150 ms
        if done and lastCode == 200 then
            backoff = 0
            Wait(150)
        else
            backoff = backoff == 0 and 1000 or math.min(30000, backoff * 2)
            Wait(backoff)
        end
    end
end)
