--- Server control: announcements, restarts, weather and time.
---
--- Two of these take a BARE PRIMITIVE rather than a table — the website sends a number to
--- `adminpanel:scheduleRestart` and a string to `adminpanel:sendAnnouncement`. The bridge passes
--- `args` through verbatim, so these handlers must accept both shapes.

ServerState = { closed = false }

local WEATHERSYNC = 'weathersync'

--- w_admin fired the weathersync events unconditionally and reported success, so on a server
--- without that resource the panel said "weather changed" and nothing changed. Telling the truth is
--- more useful than a green toast.
local function weathersyncReady()
    return GetResourceState(WEATHERSYNC) == 'started'
end

--- An announcement to every player (2026-10-17): on screen through w_hud -- white text at the top
--- centre under the compass, for `seconds` (nil = w_hud's 10 s) -- and a chat line from the client
--- event. Without w_hud the client shows its old notice instead (`shown` = false). Global: entry.lua
--- announces the open / closed switch through it too.
---@param message string
---@param seconds number|nil
---@param title string|nil
function ConnectorAnnounce(message, seconds, title)
    local shown = false
    if GetResourceState('w_hud') == 'started' then
        local ok, sent = pcall(function()
            return exports.w_hud:Announce(message, seconds, { title = title, by = 'website' })
        end)
        shown = ok and sent == true
    end
    TriggerClientEvent('w_connector:announce', -1, message, shown)
end

local function forward(eventName, ...)
    if not weathersyncReady() then return H.fail('weathersync_missing') end
    TriggerEvent(eventName, ...)
    return H.ok()
end

--- Red River runs w_weathersync (exports setTime / setWeather / setTimeFreeze), not weathersync: the
--- website's weather and time buttons answered weathersync_missing there (2026-10-22). Its setters
--- answer false for a value they refuse.
local function wsync()
    return GetResourceState('w_weathersync') == 'started' and exports.w_weathersync or nil
end

Registry.invoke('adminpanel:sendAnnouncement', 'send_announcement', function(actor, args)
    -- Bare string OR { message, seconds? }: seconds on screen (3-1800, w_hud clamps; nil = 10).
    local message = (type(args) == 'string') and args or H.str(type(args) == 'table' and (args.message or args.text) or nil, 500)
    message = H.str(message, 500)
    if message == '' then return H.fail('missing_message') end
    local seconds = type(args) == 'table' and tonumber(args.seconds or args.duration) or nil

    ConnectorAnnounce(message, seconds)
    -- txAdmin's own announcement channel, when the server runs it.
    TriggerEvent('txaBroadcast', { message = message, author = actor.label or 'Admin' })

    Log.write(actor, 'server_event', 'Announcement', message)
    return H.ok()
end)

Registry.invoke('adminpanel:scheduleRestart', 'schedule_restart', function(actor, args)
    -- Bare number OR { minutes }.
    local minutes = tonumber(args)
    if not minutes and type(args) == 'table' then minutes = tonumber(args.minutes or args.delay) end
    minutes = H.clamp(minutes, 1, 60, nil)
    if not minutes then return H.fail('invalid_minutes') end

    ConnectorAnnounce(('سيُعاد تشغيل السيرفر بعد %d دقيقة.'):format(minutes), 30)
    Log.write(actor, 'server_event', 'Scheduled restart', ('%d minutes'):format(minutes),
        { severity = 'high' })

    -- 2026-10-22: through the deploy agent when it runs here (w_deploy RequestRestart): its own restart --
    -- the players' 3-minute countdown, then quit, then txAdmin brings the server back -- asked for so it
    -- ends when the announced time does. A bare quit only on a server without it.
    local COUNTDOWN = 180
    SetTimeout(math.max(0, minutes * 60 - COUNTDOWN) * 1000, function()
        if GetResourceState('w_deploy') == 'started' then
            local ok, taken = pcall(function() return exports.w_deploy:RequestRestart('scheduled by ' .. tostring(actor.label or 'website')) end)
            if ok and taken then return end
        end
        SetTimeout(math.min(minutes * 60, COUNTDOWN) * 1000, function()
            print('^3[w_connector]^0 scheduled restart firing now (no deploy agent: plain quit).')
            ExecuteCommand('quit Scheduled restart')
        end)
    end)
    return H.ok(('restart_in_%d_minutes'):format(minutes))
end)

--- THE switch that closes the server to players (2026-10-22: one for the website, w_admin and w_core's
--- /closeserver -- w_core used to keep its own in memory). Kept in wc_settings (sv_queue.lua), so a
--- closed server stays closed across a restart; staff still get in (the queue's gate).
local function setClosed(want, by)
    ServerState.closed = want
    if Entry and Entry.saveSetting then Entry.saveSetting('closed', want, by or 'Web Admin') end
    ConnectorAnnounce(want and 'السيرفر مغلق الآن أمام اللاعبين، والإدارة فقط تستطيع الدخول.' or 'السيرفر مفتوح للاعبين من جديد.')
end

exports('SetServerClosed', function(closed, by)
    setClosed(closed == true, by)
    Log.write({ label = by or 'console' }, 'server_event', closed and 'Closed server to players' or 'Reopened server', nil,
        { severity = 'high' })
    return true
end)
exports('IsServerClosed', function() return ServerState.closed == true end)

Registry.invoke('adminpanel:closeServerForPlayers', 'close_server_for_players', function(actor, args)
    -- Accept an explicit value so the panel can set the state rather than only toggling it; a toggle
    -- against a state the page has not re-read is how a server ends up closed by accident.
    local want
    if type(args) == 'table' and args.closed ~= nil then want = args.closed and true or false end
    if type(args) == 'boolean' then want = args end
    if want == nil then want = not ServerState.closed end

    setClosed(want, actor.label or 'Web Admin')
    Log.write(actor, 'server_event', want and 'Closed server to players' or 'Reopened server', nil,
        { severity = 'high' })
    return { success = true, closed = want }
end)

Registry.invoke('adminpanel:kickAllPlayers', 'admin.kickall', function(actor, args)
    local reason = H.str(type(args) == 'table' and args.reason or args, 200)
    if reason == '' then reason = 'Server maintenance' end

    local kicked, spared = 0, 0
    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid)
        local admin = p and p.identifier and Perms.adminOf(p.identifier)
        -- Staff who hold the exemption stay, so an owner does not disconnect themselves along with
        -- everybody else and lose the ability to see what happened next.
        if admin and Perms.has({ group = admin.group }, 'ignore_while_kicking_allplayers') then
            spared = spared + 1
        else
            DropPlayer(sid, reason)
            kicked = kicked + 1
        end
    end

    Log.write(actor, 'server_event', 'Kicked all players',
        ('%d kicked, %d exempt — %s'):format(kicked, spared, reason), { severity = 'high' })
    return H.ok(('%d kicked'):format(kicked))
end)

Registry.invoke('adminpanel:refreshResources', 'refresh_resources', function(actor)
    ExecuteCommand('refresh')
    Log.write(actor, 'server_event', 'Refreshed resource list')
    return H.ok()
end)

-- ---------------------------------------------------------------------------
--  Weather and time — forwarded to weathersync
-- ---------------------------------------------------------------------------

Registry.invoke('adminpanel:server:setTime', 'server.time.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    local day = H.clamp(args.day, 1, 7, 1)
    local hour = H.clamp(args.hour, 0, 23, 12)
    local min = H.clamp(args.min, 0, 59, 0)
    local sec = H.clamp(args.sec, 0, 59, 0)
    local res
    local ws = wsync()
    if ws then
        local ok, set = pcall(function() return ws:setTime(hour, min) end)
        res = (ok and set ~= false) and H.ok() or H.fail('invalid_time')
        if res.success and args.freeze ~= nil then pcall(function() ws:setTimeFreeze(args.freeze and true or false) end) end
    else
        res = forward('weathersync:setTime', day, hour, min, sec,
            H.int(args.transition, 0) or 0, args.freeze and true or false)
    end
    if res.success then
        Log.write(actor, 'server_event', 'Set time', ('%02d:%02d:%02d'):format(hour, min, sec))
    end
    return res
end)

Registry.invoke('adminpanel:server:setWeather', 'server.weather.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    local weather = H.str(args.weather, 64)
    if weather == '' then return H.fail('missing_weather') end
    local res
    local ws = wsync()
    if ws then
        local ok, set = pcall(function() return ws:setWeather(weather) end)
        res = (ok and set ~= false) and H.ok() or H.fail('unknown_weather')
    else
        res = forward('weathersync:setWeather', weather, H.int(args.transition, 0) or 0,
            args.freeze and true or false, args.permanentSnow and true or false)
    end
    if res.success then Log.write(actor, 'server_event', 'Set weather', weather) end
    return res
end)

Registry.invoke('adminpanel:server:setTimescale', 'server.timescale.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    local scale = H.clamp(args.timescale, 0, 100, nil)
    if not scale then return H.fail('invalid_timescale') end
    if wsync() and not weathersyncReady() then return H.fail('not_supported_here') end
    local res = forward('weathersync:setTimescale', scale)
    if res.success then Log.write(actor, 'server_event', 'Set timescale', tostring(scale)) end
    return res
end)

Registry.invoke('adminpanel:server:setWind', 'server.wind.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    if wsync() and not weathersyncReady() then return H.fail('not_supported_here') end
    local res = forward('weathersync:setWind',
        H.clamp(args.windDirection, 0, 360, 0), H.clamp(args.windSpeed, 0, 100, 0),
        args.freeze and true or false)
    if res.success then Log.write(actor, 'server_event', 'Set wind') end
    return res
end)

Registry.invoke('adminpanel:server:setSyncDelay', 'server.syncdelay.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    local delay = H.clamp(args.syncDelay, 0, 600000, nil)
    if not delay then return H.fail('invalid_delay') end
    if wsync() and not weathersyncReady() then return H.fail('not_supported_here') end
    local res = forward('weathersync:setSyncDelay', delay)
    if res.success then Log.write(actor, 'server_event', 'Set sync delay', tostring(delay)) end
    return res
end)
