--- 2.2.0: the link to the Wraith host agent (game/wraith_agent), the supervisor that runs FXServer from outside
--- the game in place of txAdmin.
---
--- Heartbeat: a structured trace on fd 3 every 3 s. The agent restarts a server whose heartbeat stops (a hung main
--- thread still answers HTTP). Without an agent the trace goes nowhere.
---
--- `wc_event <name> <base64 json>`: a console-only command the agent writes to FXServer's stdin. The connector
--- re-fires the txAdmin event of the same name, which our resources already listen to (w_inventory and w_level
--- save on serverShuttingDown, w_inventory saves on scheduledRestart at 60 s, w_pausemenu keeps announcements),
--- then does what txAdmin's own resource did: shows the announcement, refuses new joins and drops everyone before
--- a shutdown.

WC.Host = { shuttingDown = false }

local text = {
    ar = {
        restart_in = 'سيُعاد تشغيل السيرفر بعد %d دقيقة.',
        restart_in_few = 'سيُعاد تشغيل السيرفر بعد %d دقائق.',
        restart_in_two = 'سيُعاد تشغيل السيرفر بعد دقيقتين.',
        restart_in_one = 'سيُعاد تشغيل السيرفر بعد دقيقة واحدة. احفظ ما تعمله الآن.',
        restart_title = 'إعادة تشغيل السيرفر',
        restart_skipped = 'أُلغيت إعادة التشغيل القادمة.',
        shutdown = 'يُعاد تشغيل السيرفر الآن. ادخل مرة أخرى بعد قليل.',
        closing = 'السيرفر يُغلق الآن. حاول الدخول بعد قليل.',
        announce_title = 'إعلان من الإدارة',
    },
    en = {
        restart_in = 'The server restarts in %d minutes.',
        restart_in_few = 'The server restarts in %d minutes.',
        restart_in_two = 'The server restarts in 2 minutes.',
        restart_in_one = 'The server restarts in one minute. Save what you are doing now.',
        restart_title = 'Server restart',
        restart_skipped = 'The next restart was cancelled.',
        shutdown = 'The server is restarting now. Please reconnect in a moment.',
        closing = 'The server is closing. Please try again in a moment.',
        announce_title = 'Staff announcement',
    },
}
local function say(key, ...)
    local lang = GetConvar('w_lib:locale', 'ar') == 'ar' and 'ar' or 'en'
    return text[lang][key]:format(...)
end
WC.Host.say = say

-- ── heartbeat ───────────────────────────────────────────────────────────────────────────────────────────────
local beat = json.encode({ type = 'wraithHeartBeat' })
CreateThread(function()
    if type(PrintStructuredTrace) ~= 'function' then return end
    while true do
        PrintStructuredTrace(beat)
        Wait(3000)
    end
end)
-- The connector stopping (by an admin, or a hot restart) is not a hung server: say goodbye, so the agent stops
-- expecting the heartbeat until it beats again.
AddEventHandler('onResourceStop', function(name)
    if name ~= GetCurrentResourceName() or type(PrintStructuredTrace) ~= 'function' then return end
    PrintStructuredTrace(json.encode({ type = 'wraithHeartBeat', stop = true }))
end)

-- ── wc_event ────────────────────────────────────────────────────────────────────────────────────────────────
local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local B64INDEX = {}
for i = 1, #B64 do B64INDEX[B64:byte(i)] = i - 1 end
local function unbase64(s)
    if type(s) ~= 'string' or #s > 12000 or #s % 4 ~= 0 or s:find('[^%w%+/=]') then return nil end
    local out, bits, n = {}, 0, 0
    for i = 1, #s do
        local c = s:byte(i)
        if c == 61 then break end -- '='
        local v = B64INDEX[c]
        if v == nil then return nil end
        bits = (bits << 6) | v; n = n + 6
        if n >= 8 then n = n - 8; out[#out + 1] = string.char((bits >> n) & 0xFF) end
    end
    return table.concat(out)
end
WC.Host.unbase64 = unbase64

local function announce(message, seconds, title, by)
    if WC.started('w_hud') then
        local ok = pcall(function() exports.w_hud:Announce(message, seconds, { title = title, by = by }) end)
        if ok then return end
    end
    TriggerClientEvent('chat:addMessage', -1, { args = { title, message } })
end

local HANDLERS = {}

-- { delay ms, author, message }: resources save (txAdmin event), joins stop, everyone is dropped just before the quit.
function HANDLERS.serverShuttingDown(data)
    WC.Host.shuttingDown = true
    local delay = math.tointeger(tonumber(data.delay)) or 0
    delay = math.max(0, math.min(delay, 120000))
    -- still running a minute after the quit was due (the agent died, or someone typed it by hand): joins open again
    local mark = {}; WC.Host.shutdownMark = mark
    SetTimeout(delay + 60000, function() if WC.Host.shutdownMark == mark then WC.Host.shuttingDown = false end end)
    local message = type(data.message) == 'string' and data.message ~= '' and data.message:sub(1, 200) or nil
    TriggerEvent('txAdmin:events:serverShuttingDown', { delay = delay, author = tostring(data.author or 'Wraith'):sub(1, 64), message = message or say('shutdown') })
    SetTimeout(math.max(0, delay - 500), function()
        local reason = say('shutdown')
        for _, id in ipairs(GetPlayers()) do DropPlayer(id, reason) end
    end)
end

-- { secondsRemaining, translatedMessage }: the scheduler's warnings (30 / 15 / 10 / 5 / 4 / 3 / 2 / 1 min).
function HANDLERS.scheduledRestart(data)
    local seconds = math.tointeger(tonumber(data.secondsRemaining))
    if not seconds or seconds <= 0 then return end
    TriggerEvent('txAdmin:events:scheduledRestart', { secondsRemaining = seconds, translatedMessage = data.translatedMessage or '' })
    local minutes = math.max(1, seconds // 60)
    -- Arabic counts: 1 دقيقة واحدة, 2 دقيقتين, 3-10 دقائق, 11+ دقيقة
    local line = minutes == 1 and say('restart_in_one') or minutes == 2 and say('restart_in_two')
        or minutes <= 10 and say('restart_in_few', minutes) or say('restart_in', minutes)
    announce(line, 12, say('restart_title'))
end

function HANDLERS.scheduledRestartSkipped(data)
    TriggerEvent('txAdmin:events:scheduledRestartSkipped', { secondsRemaining = tonumber(data.secondsRemaining) or 0, temporary = data.temporary == true, author = tostring(data.author or 'Wraith'):sub(1, 64) })
    announce(say('restart_skipped'), 8, say('restart_title'))
end

-- { author, message }: an announcement from the panel.
function HANDLERS.announcement(data)
    local message = type(data.message) == 'string' and data.message:gsub('^%s+', ''):gsub('%s+$', ''):sub(1, 500) or ''
    if message == '' then return end
    local author = tostring(data.author or 'Wraith'):sub(1, 64)
    TriggerEvent('txAdmin:events:announcement', { author = author, message = message })
    announce(message, 15, say('announce_title'), author)
end

RegisterCommand('wc_event', function(src, args)
    if src ~= 0 then return end -- the host agent writes to the console; a player can never send this
    local name, payload = args[1], args[2]
    local handler = type(name) == 'string' and HANDLERS[name]
    if not handler then return end
    local raw = unbase64(payload or '')
    local ok, data = pcall(json.decode, raw or '')
    if not ok or type(data) ~= 'table' then return end
    local called, err = pcall(handler, data)
    if not called then print(('^1[w_connector] host event %s failed: %s^7'):format(name, tostring(err))) end
end, true)
