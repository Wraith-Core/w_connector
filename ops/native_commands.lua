-- 2.2.2: the chat commands w_admin registered (its server/sv_commands.lua and sv_chat.lua), so they keep
-- working once w_admin is gone. Nothing here decides who may: every command runs one console action
-- through WC.Console.runAs, the same website decision, lease, ticket and target binding as the page's
-- button. Opening the console (/admin, /am, /quickadmin) is the page's own open, which asks the website too.
--
-- While w_admin runs it keeps its own commands: these are registered only when it is not started, and
-- again when it stops. If it starts later its registration is the newer one and FXServer runs that;
-- should ours still be reached, it answers nothing (it never fights w_admin for a command).
-- /report stays in core/events.lua.
local C = WC.Console
local PAPER, DIM = { 242, 242, 242 }, { 180, 180, 180 } -- w_admin's monochrome chat palette
local LIMITS = { reason = 300, text = 1000 }                 -- the website's own limits (consolePolicy.ts)
local COOLDOWN = { staffchat = 2000, announce = 10000, warn = 2000 } -- ms between two of one admin's commands

-- ── texts: the server dictionary, as w_admin built chat lines (and core/join.lua its refusals) ──
local dictionaries = {}
local function L(key, ...)
    local lang = GetConvar('w_lib:locale', 'ar') == 'ar' and 'ar' or 'en'
    if not dictionaries[lang] then
        local ok, d = pcall(json.decode, LoadResourceFile(GetCurrentResourceName(), 'locales/' .. lang .. '.json') or '{}')
        dictionaries[lang] = ok and type(d) == 'table' and d or {}
    end
    local s = dictionaries[lang][key]
    if type(s) ~= 'string' then return key end
    if select('#', ...) == 0 then return s end
    local ok, out = pcall(string.format, s, ...)
    return ok and out or s
end
local function has(key) return L(key) ~= key end

--- At most `n` letters, never half an Arabic letter.
local function cut(s, n)
    if type(s) ~= 'string' or not utf8.len(s) then return '' end
    if utf8.len(s) <= n then return s end
    return s:sub(1, utf8.offset(s, n + 1) - 1)
end
-- spaces only, never %s: under a Latin-1 locale %s matches bytes inside Arabic letters (w_hud announce.lua)
local function trim(s) return (s:gsub('^[ \t\r\n]+', ''):gsub('[ \t\r\n]+$', '')) end

local function line(target, title, text, color)
    if WC.started('chat') then
        TriggerClientEvent('chat:addMessage', target, { color = color or PAPER, multiline = true, args = { title, text } })
    end
end
local function toast(target, text, ms)
    -- VORP's notification event; on Red River w_lib answers it (compat/host_client.lua), as cl_actions.lua uses it
    if WC.gameName() == 'rdr3' then TriggerClientEvent('vorp:TipRight', target, text, ms or 6000) end
end
local function label(src)
    local id = tostring(WC.playerView(src).charId or '')
    return id ~= '' and ('%s (%s)'):format(GetPlayerName(src) or '?', id) or ('%s (#%d)'):format(GetPlayerName(src) or '?', src)
end

--- Why a command did nothing, in words: the console's reason key, and for a missing permission the
--- website node that grants it.
local function refuse(src, action, r)
    local key = type(r) == 'table' and type(r.error) == 'string' and r.error or 'failed'
    local text
    if key == 'no_permission' then
        text = L('cmd_err_no_permission', C.contract[action] and C.contract[action].permission or action)
    elseif key == 'capability_missing' and type(r.data) == 'table' and type(r.data.reason) == 'string' and has(r.data.reason) then
        text = L(r.data.reason)
    elseif has('cmd_err_' .. key) then text = L('cmd_err_' .. key)
    elseif has(key) then text = L(key)
    else text = L('cmd_err_other', key) end
    line(src, L('chat_system'), text); toast(src, text)
end
local function say(src, text) line(src, L('chat_system'), text); toast(src, text) end

--- At most `n` bytes, cut at a letter boundary (a UTF-8 continuation byte is 0x80-0xBF).
local function cutBytes(s, n)
    if #s <= n then return s end
    local i = n
    while i > 0 and s:byte(i + 1) and s:byte(i + 1) >= 0x80 and s:byte(i + 1) < 0xC0 do i = i - 1 end
    return s:sub(1, i)
end
local offered = {}

-- ── the two console actions w_admin had only as commands ────────────────────────────────────────

-- /warn: the website stored the warning (with the FXServer identity of the bound target), counted his
-- warnings and decided the kick at the panel's threshold; here he is told, and kicked when it says so.
C.define('player.warn', nil, function(data, ctx)
    local a = type(data.args) == 'table' and data.args or {}
    local reason = type(a.reason) == 'string' and cut(trim(a.reason), LIMITS.reason) or ''
    local count = math.tointeger(tonumber(a.count)) or 0
    if reason == '' or count < 1 then return false, 'invalid_args' end
    if not ctx.valid() then return false, 'target_changed' end
    local target, by = ctx.target, GetPlayerName(ctx.source) or 'Staff'
    line(target, L('chat_system'), L('chat_warning', by, reason))
    line(target, L('chat_system'), L('cmd_warn_total', count))
    toast(target, L('warn_received'), 8000)
    if ctx.source ~= target then line(ctx.source, L('chat_system'), L('chat_warned', label(target), reason)) end
    -- txAdmin's own event: w_logs records it (server/bridge.lua tx('playerWarned')); raised only when it runs
    if WC.started('w_logs') then
        TriggerEvent('txAdmin:events:playerWarned', { author = by, reason = reason, actionId = tostring(math.tointeger(tonumber(a.warningId)) or ''),
            target = target, targetNetId = target, targetName = GetPlayerName(target) })
    end
    local kicked = false
    if a.kick == true then
        if not ctx.valid() then return false, 'target_changed' end
        -- players.kick keeps 200 bytes: the reason is shortened here, at a letter, so the text never breaks
        local text = L('cmd_warn_kick', count, cut(reason, 60))
        kicked = WC.Ops.run('players.kick', { source = target, reason = cutBytes(text, 200) }) == true
    end
    return true, { count = count, kicked = kicked }
end)

-- /staffchat: the website kept the line in its staff chat and named who reads it: the players online now
-- whose website access holds staffchat.use (data.recipients, from the subjects this connector sent). Each
-- is still the same Discord account on that server id, or he is skipped.
C.define('staff.chat', nil, function(data, ctx)
    local text = type(data.message) == 'string' and cut(trim(data.message), LIMITS.text) or ''
    if text == '' then return false, 'invalid_args' end
    if not ctx.valid() then return false, 'no_session' end
    local title, sent, done = L('chat_staff', GetPlayerName(ctx.source) or 'Staff'), 1, { [ctx.source] = true }
    line(ctx.source, title, text, DIM)
    for _, r in ipairs(type(data.recipients) == 'table' and data.recipients or {}) do
        local n = type(r) == 'table' and WC.onlineSource(r.source)
        if n and not done[n] and type(r.discord) == 'string' and WC.identifiers(n).discord == r.discord then
            done[n] = true; line(n, title, text, DIM); sent = sent + 1
        end
    end
    return true, { delivered = sent }
end)

-- 2.2.2: a staff reply to a report, in the reporter's game, in the server's language (consoleData.ts sends it
-- after checking he still holds that server id); offered while chat runs, like player.message
WC.Ops.define('reports.reply', function() return WC.started('chat') end, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local id = math.tointeger(tonumber(args.reportId))
    local msg = type(args.message) == 'string' and cut(trim(args.message), LIMITS.text) or ''
    if not id or msg == '' then return false, 'invalid_args' end
    local text = L('cmd_report_reply', id, msg)
    line(src, L('chat_system'), text); toast(src, text, 10000)
    return true
end)

-- ── the commands ────────────────────────────────────────────────────────────────────────────────
local function adminRuns() local st = GetResourceState('w_admin'); return st == 'started' or st == 'starting' end
local function rest(args, from) return trim(table.concat(args, ' ', from or 1)) end

local COMMANDS = {} -- name -> { action (shown to who may run it), help, params, run(src, args) }
local function usage(src, name)
    local def, parts = COMMANDS[name], { '/' .. name }
    for _, p in ipairs(def.params or {}) do parts[#parts + 1] = '[' .. L(p) .. ']' end
    line(src, L('chat_system'), L('cmd_usage', table.concat(parts, ' ')))
end
--- Run one action as `src` and tell him why when it did nothing. Returns the result when it worked.
local function act(src, action, data)
    local r = C.runAs(src, action, data)
    if not r.ok then refuse(src, action, r); return nil end
    return r
end
--- Longer than the website takes: refused, naming the limit (a message is never cut short unseen).
local function tooLong(src, text, limit)
    local n = utf8.len(text)
    if not n then refuse(src, nil, { error = 'invalid_args' }); return true end
    if n > limit then say(src, L('cmd_err_too_long', limit, n)); return true end
    return false
end
--- One admin's pace for the commands that reach everyone or write a record (COOLDOWN).
local lastUse = {}
local function cooling(src, name)
    local wait, at = COOLDOWN[name], lastUse[src] and lastUse[src][name]
    if not wait then return false end
    if at and GetGameTimer() - at < wait then
        say(src, L('cmd_err_cooldown', math.ceil((wait - (GetGameTimer() - at)) / 1000))); return true
    end
    lastUse[src] = lastUse[src] or {}; lastUse[src][name] = GetGameTimer()
    return false
end
local function console(mode) return function(src) TriggerClientEvent('w_connector:console:command', src, mode) end end
for _, name in ipairs({ 'admin', 'am' }) do COMMANDS[name] = { help = 'cmd_menu', run = console('full') } end
COMMANDS.quickadmin = { help = 'cmd_menu', run = console('quick') }

COMMANDS.staffchat = { action = 'staff.chat', help = 'cmd_staffchat', params = { 'param_message' }, run = function(src, args)
    local msg = rest(args)
    if msg == '' then return usage(src, 'staffchat') end
    if tooLong(src, msg, LIMITS.text) or cooling(src, 'staffchat') then return end
    act(src, 'staff.chat', { message = msg })
end }

-- /announce [5m|30s|5د|30ث] <text>: w_hud splits the optional first word; 10 s without one, 3 s to 30 min.
COMMANDS.announce = { action = 'server.announce', help = 'cmd_announce', params = { 'param_message' }, run = function(src, args)
    local msg, seconds = rest(args), nil
    if msg == '' then return usage(src, 'announce') end
    if WC.started('w_hud') then
        local ok, secs, text = pcall(function() return exports.w_hud:SplitDuration(msg) end)
        if ok and tonumber(secs) and type(text) == 'string' and trim(text) ~= '' then seconds, msg = tonumber(secs), trim(text) end
    end
    seconds = math.max(3, math.min(math.floor(seconds or 10), 1800))
    if tooLong(src, msg, LIMITS.text) or cooling(src, 'announce') then return end
    if not act(src, 'server.announce', { args = { text = msg, seconds = seconds } }) then return end
    line(-1, L('chat_announcement'), msg)
end }

COMMANDS.warn = { action = 'player.warn', help = 'cmd_warn', params = { 'param_player_id', 'param_warn_reason' }, run = function(src, args)
    local reason = rest(args, 2)
    if not args[1] or reason == '' then return usage(src, 'warn') end
    if tooLong(src, reason, LIMITS.reason) or cooling(src, 'warn') then return end
    local r = act(src, 'player.warn', { citizenid = args[1], args = { reason = reason } })
    if r and type(r.data) == 'table' and r.data.delivered == false then line(src, L('chat_system'), L('cmd_warn_stored')) end
end }

-- noclip: the client knows whether it flies. Off needs no authority (the page turns it off on the client
-- alone too); on, the client asks back (w_connector:console:noclip) and that runs self.noclip as the page does.
local noclipAsked = {}
COMMANDS.noclip = { action = 'self.noclip', help = 'cmd_noclip', run = function(src)
    noclipAsked[src] = GetGameTimer()
    TriggerClientEvent('w_connector:console:command', src, 'noclip')
end }
RegisterNetEvent('w_connector:console:noclip', function()
    local src = source
    local at = noclipAsked[src]
    noclipAsked[src] = nil
    if not at or GetGameTimer() - at > 5000 or adminRuns() then return end
    CreateThread(function() act(src, 'self.noclip', { args = { state = true } }) end)
end)

-- bring / bringback / goto: the console's player actions (the player is moved by his own client, and
-- bring keeps where he stood, tied to his identity, for bringback)
for name, action in pairs({ bring = 'player.bring', bringback = 'player.bringBack', ['goto'] = 'player.teleportTo' }) do
    COMMANDS[name] = { action = action, help = 'cmd_' .. name, params = { 'param_player_id' }, run = function(src, args)
        if not args[1] then return usage(src, name) end
        local who = trim(args[1]):lower()
        if who == 'me' or who == '#' .. src or who == tostring(WC.playerView(src).charId or ''):lower() then
            return refuse(src, action, { error = 'self_action' })
        end
        act(src, action, { citizenid = args[1], args = {} })
    end }
end

-- /reportr <reporter> <text>: the reply joins his open report on the website, which also shows it to him
COMMANDS.reportr = { action = 'reports.message', help = 'cmd_reportr', params = { 'param_player_id', 'param_message' }, run = function(src, args)
    local msg = rest(args, 2)
    if not args[1] or msg == '' then return usage(src, 'reportr') end
    local r = act(src, 'reports.message', { citizenid = args[1], message = msg })
    if not r then return end
    local replied = type(r.data) == 'table' and type(r.data.replied) == 'table' and r.data.replied or {}
    line(src, L('chat_report_response', ('#%s %s'):format(tostring(replied.reportId or '?'), tostring(replied.reporter or args[1]))), msg)
    toast(src, L('report_reply_sent'))
end }

for name, kind in pairs({ vector3 = 'coords3', vector4 = 'coords4', heading = 'heading' }) do
    COMMANDS[name] = { action = 'self.copyCoords', help = 'cmd_' .. name, run = function(src)
        local r = act(src, 'self.copyCoords', { args = { type = kind } })
        if not r then return end
        local key = kind == 'coords3' and 'vec3_copied' or kind == 'coords4' and 'vec4_copied' or 'heading_copied'
        local text = type(r.data) == 'table' and type(r.data.text) == 'string' and r.data.text or ''
        line(src, L('chat_system'), text ~= '' and ('%s: %s'):format(L(key), text) or L(key)); toast(src, L(key))
    end }
end

local function handler(name)
    return function(src, args)
        src = tonumber(src) or 0
        if adminRuns() then return end -- w_admin's own command answers (see the header)
        if src <= 0 then
            print(('[w_connector] /%s refused: run it in game; the website decides who may, and the server console has no website identity'):format(name))
            return
        end
        CreateThread(function() COMMANDS[name].run(src, type(args) == 'table' and args or {}) end)
    end
end
-- Once per start of this resource. FXServer runs the newest registration of a name and drops a resource's
-- own when it stops, so ours answer again by themselves once w_admin is gone.
local registered = false
local function register()
    if registered then return end
    for name in pairs(COMMANDS) do RegisterCommand(name, handler(name), false) end
    registered = true
end
C.commands = COMMANDS

-- ── chat suggestions: only for what the website lets this admin run ─────────────────────────────
local function suggest(src, s)
    if not registered or adminRuns() then return end
    offered[src] = offered[src] or {}
    for name, def in pairs(COMMANDS) do
        local may = s ~= nil and (def.action == nil or s.allowed[def.action] == true)
        if may and not offered[src][name] then
            local params = {}
            for _, p in ipairs(def.params or {}) do params[#params + 1] = { name = L(p), help = L(p) } end
            TriggerClientEvent('chat:addSuggestion', src, '/' .. name, L(def.help), params)
            offered[src][name] = true
        elseif not may and offered[src][name] then
            TriggerClientEvent('chat:removeSuggestion', src, '/' .. name)
            offered[src][name] = nil
        end
    end
end
C.refreshHooks[#C.refreshHooks + 1] = suggest

if not adminRuns() then register() end
AddEventHandler('onResourceStop', function(res)
    if res ~= 'w_admin' then return end
    -- its commands leave with it: ours take over (registered now if w_admin ran when we started), and
    -- are offered again at the next lease
    register()
    for src in pairs(offered) do offered[src] = nil end
end)
AddEventHandler('onResourceStart', function(res)
    -- w_admin's registration is the newer one now; take back what we offered so the list is its own
    if res ~= 'w_admin' then return end
    for src, list in pairs(offered) do
        for name in pairs(list) do TriggerClientEvent('chat:removeSuggestion', src, '/' .. name) end
        offered[src] = nil
    end
end)
AddEventHandler('playerDropped', function()
    local src = source
    offered[src], noclipAsked[src], lastUse[src] = nil, nil, nil
end)
