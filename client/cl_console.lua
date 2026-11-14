-- Host for the original w_admin full console (F10) and quick menu (Page Up).
-- NUI shapes requests; the server and signed website decide every permission.
WMenu = { open = false, game = GetGameName() == 'redm' and 'redm' or 'fivem' }
WConsole = { session = nil, mode = 'full', ready = false, waiting = {} }
local C, seq, opening, mapWatch, openGeneration = WConsole, 0, false, false, 0
local lang = GetResourceKvpString('wc_console_language') == 'en' and 'en' or 'ar'
local dictionaries = {}
local function strings()
    if not dictionaries[lang] then dictionaries[lang] = json.decode(LoadResourceFile(GetCurrentResourceName(), 'locales/' .. lang .. '.json') or '{}') end
    return dictionaries[lang]
end
local ERRORS = {
    ar = { no_access = 'ما عندك صلاحية لفتح لوحة الإدارة. راجع رتبتك في الموقع.', no_permission = 'ما عندك صلاحية لهذا الإجراء.',
        no_session = 'انتهت جلسة الإدارة. افتح اللوحة من جديد.', offline = 'تعذر الاتصال بلوحة الموقع. جرّب بعد قليل.',
        capability_missing = 'هذه الميزة تحتاج إضافة متوافقة ومشغّلة على السيرفر.', target_changed = 'تغيّرت جلسة اللاعب أو شخصيته. حدّث القائمة وحاول من جديد.',
        timeout = 'تأخر رد السيرفر. تحقق من النتيجة قبل إعادة المحاولة.', rate_limited = 'انتظر قليلًا ثم حاول مرة ثانية.',
        money_reason_required = 'اكتب سببًا واضحًا لإضافة المبلغ.', money_limit = 'المبلغ أكبر من الحد المسموح للإجراء الواحد.',
        failed = 'ما اكتملت العملية. راجع التفاصيل أو سجل السيرفر.', player_offline = 'اللاعب غير متصل الآن.',
        no_discord = 'لازم يكون حساب ديسكورد مربوطًا بدخولك للسيرفر.', session_expired = 'انتهت صلاحية جلسة الإدارة.',
        jail_not_set = 'حدّد مكان السجن أولًا: قف في المكان واضغط «اجعل مكاني مكان السجن»، أو حدّده في الموقع.',
        not_jailed = 'هذا اللاعب ليس في السجن.', no_license = 'تعذر التعرف على حساب اللاعب.' },
    en = { no_access = 'You do not have access to the admin console. Check your website role.', no_permission = 'You do not have permission for this action.',
        no_session = 'Your admin session ended. Open the console again.', offline = 'The website panel is unavailable. Try again shortly.',
        capability_missing = 'This feature needs a compatible, running server integration.', target_changed = 'The player session or character changed. Refresh and try again.',
        timeout = 'The server response timed out. Check the result before retrying.', rate_limited = 'Please wait and try again.',
        money_reason_required = 'Enter a clear reason for the money grant.', money_limit = 'This amount exceeds the per-action limit.',
        failed = 'The action did not complete. Check the details or server log.', player_offline = 'The player is offline.',
        no_discord = 'Your game connection needs a linked Discord account.', session_expired = 'Your admin session expired.',
        jail_not_set = 'Set the jail place first: stand there and press "Make my spot the jail", or set it on the website.',
        not_jailed = 'This player is not in jail.', no_license = 'The player account could not be identified.' },
}
local function send(action, data) SendNUIMessage({ action = action, data = data or {} }) end
local function foreign() local inv = GetInvokingResource(); return inv ~= nil and inv ~= GetCurrentResourceName() end
local function finish(r)
    if type(r) ~= 'table' then return { ok = false, error = ERRORS[lang].failed } end
    if not r.ok then
        local key = tostring(r.error or 'failed'); r.errorKey = key
        -- 2.4.0: an unavailable action says why when the server names a reason with a text (w_map_running)
        local why = key == 'capability_missing' and type(r.data) == 'table' and type(r.data.reason) == 'string' and strings()[r.data.reason] or nil
        r.error = why or ERRORS[lang][key] or strings()[key] or ERRORS[lang].failed
    end
    if r.ok and type(r.data) == 'table' and r.data.banId and r.data.kicked == false then
        send('toast', { type = 'info', text = lang == 'ar' and 'تم حفظ الحظر. تعذر فصل جلسة اللاعب الحالية؛ تحقق من قائمة اللاعبين.' or 'The ban was saved. The current connection could not be removed; check the player list.' })
    end
    return r
end
function WMenu.toast(kind, key) send('toast', { type = kind, text = ERRORS[lang][key] or strings()[key] or key }) end
function WMenu.close()
    WMenu.open = false; opening = false; mapWatch = false; openGeneration = openGeneration + 1
    C.wantOpen = false
    SetNuiFocus(false, false); SetNuiFocusKeepInput(false); send('close')
    TriggerServerEvent('w_connector:console:closed')
end
-- 2.6.1: the server's lease is up to 10 minutes now (ops/console.lua LEASE); it ends early only when the server
-- revokes it. The old 45 s cap closed the menu and switched every mode off whenever one renewal was late.
local LEASE_MAX = 600000
function C.live()
    return C.session ~= nil and GetGameTimer() - C.session.at >= 0 and GetGameTimer() - C.session.at < math.min(LEASE_MAX, C.session.lease or 45000)
end
function C.ask(name, data, cb)
    if not C.live() then cb(finish({ ok = false, error = 'no_session' })); return end
    if not C.session.actions[name] then cb(finish({ ok = false, error = 'no_permission' })); return end
    seq = seq % 999999999 + 1
    local id = seq; C.waiting[id] = cb
    TriggerServerEvent('w_connector:console:request', id, name, data or {}, C.session.nonce)
    SetTimeout(22000, function()
        local fn = C.waiting[id]
        if fn then C.waiting[id] = nil; fn(finish({ ok = false, error = 'timeout' })) end
    end)
end
function WMenu.self(name, details, cb)
    if name == 'self.viewids' then name = 'self.names' end
    details.state = details.on; C.ask(name, { args = details }, cb)
end
local function pushSelf() if WConsoleTools then send('self', WConsoleTools.state()) end end
local PUSH = { players = { 'query.players', 'players', 'list' }, server = { 'query.server', 'serverInfo' },
    bans = { 'query.bans', 'bans', 'list' }, catalog = { 'query.catalog', 'catalog' },
    modules = { 'scripts.list', 'modules', 'list' }, blocks = { 'characters.blocks', 'blocks', 'list' }, map = { 'query.map', 'mapCfg' },
    -- 2.4.2: the HUD's own settings page (pages/hub ModulePage, built-in source) asks refresh('hud'); without this
    -- entry nothing answered and the page stayed read-only, waiting for values that never came
    hud = { 'query.hud', 'hudCfg', 'cfg' } }
-- 2.3.1: the permissions page's data (ops/console.lua C.access): asked when the page opens, then again only
-- when the session's accessRev changes while the console stays open
local accessWanted, accessRev = false, nil
local function askAccess()
    if not C.live() then return end
    accessWanted = true
    TriggerServerEvent('w_connector:console:access', C.session.nonce)
end
local function refresh(what)
    if what == 'self' then pushSelf(); return end
    if what == 'access' then askAccess(); return end
    local def = PUSH[what]
    if not def or not C.live() or not C.session.actions[def[1]] then return end
    local generation = openGeneration
    C.ask(def[1], {}, function(r)
        if not r.ok or not WMenu.open or generation ~= openGeneration then return end
        if what == 'map' and type(r.data) == 'table' and r.data.mapData then send('mapData', r.data.mapData); r.data.mapData = nil end
        if what == 'server' and type(r.data) == 'table' and r.data.protectedResources then send('connectorProtected', { list = r.data.protectedResources }) end
        send(def[2], def[3] and { [def[3]] = r.data or {} } or r.data)
    end)
end
local function open()
    if not C.ready or not C.live() then return end
    C.wantOpen = false
    WMenu.open = true; openGeneration = openGeneration + 1
    accessWanted, accessRev = false, nil
    local s = C.session
    local roleLabels = lang == 'ar' and { owner = 'مالك اللوحة', admin = 'إداري', moderator = 'مشرف', viewer = 'مشاهد', custom = 'رتبة مخصصة' }
        or { owner = 'Panel owner', admin = 'Administrator', moderator = 'Moderator', viewer = 'Viewer', custom = 'Custom role' }
    local roleLabel = s.role == 'custom' and type(s.customRoles) == 'table' and #s.customRoles > 0 and table.concat(s.customRoles, ' / ') or roleLabels[s.role] or s.role
    local hasTools = false
    for name in pairs(s.actions) do if name:sub(1, 5) == 'self.' then hasTools = true; break end end
    local initialPage = s.actions['query.server'] and 'dashboard' or s.actions['query.players'] and 'players'
        or hasTools and 'tools' or s.perms.reports and 'reports' or s.perms.ranks and 'ranks' or 'perms'
    SetNuiFocus(true, true)
    send('open', { mode = C.mode, initialPage = initialPage, admin = { id = s.self, name = GetPlayerName(PlayerId()), group = roleLabel },
        locale = lang, dir = lang == 'ar' and 'rtl' or 'ltr', strings = strings(), perms = s.perms, actions = s.actionAreas,
        selfId = s.self, serverName = s.serverName, banDurations = { 0, 60, 1440, 10080, 43200 },
        connector = { actions = s.list, unavailable = s.unavailable, game = s.game } })
    pushSelf()
    for _, what in ipairs({ 'players', 'server', 'catalog', 'bans', 'modules', 'blocks' }) do refresh(what) end
end
local function setSession(s)
    local actions = {}; for _, name in ipairs(s.actions or {}) do actions[name] = true end
    s.list, s.actions, s.at = s.actions, actions, GetGameTimer()
    C.session = s
    if WConsoleTools then
        for name, on in pairs(WConsoleTools.modes) do if on and not actions['self.' .. name] then WConsoleTools.modes[name] = false end end
        -- 2.2.2: only what is on: a chat command's lease (any staff member) must not reset another
        -- script's invincibility through the god-mode switch
        local on = WMenu.selfState and WMenu.selfState() or {}
        for action, key in pairs({ noclip = 'noclip', godmode = 'godmode', names = 'viewids' }) do
            if not actions['self.' .. action] and on[key == 'viewids' and 'ids' or key] then WMenu.applySelf('self.' .. key, { on = false }) end
        end
        if not actions['player.spectate'] then WMenu.stopSpectate() end
    end
end
RegisterNetEvent('w_connector:console:session', function(s)
    if foreign() then return end
    local requested = opening
    opening = false
    if not requested or IsPauseMenuActive() or IsNuiFocused() then return end
    if type(s) ~= 'table' or not s.ok then
        local r = finish(s)
        if GetResourceState('chat') == 'started' then TriggerEvent('chat:addMessage', { args = { 'Wraith', r.error } }) end
        return
    end
    setSession(s); C.wantOpen = true; open()
end)
RegisterNetEvent('w_connector:console:permissions', function(s)
    if foreign() or type(s) ~= 'table' or s.ok ~= true then return end
    -- 2.2.2: a chat command (ops/native_commands.lua) opens a lease without the page: take it, so its
    -- client tools (noclip ...) run as they do from the page
    if C.session and s.nonce ~= C.session.nonce then return end
    setSession(s)
    if WMenu.open then send('permissions', { perms = s.perms, actions = s.actionAreas }); send('connectorCapabilities', { actions = s.list, unavailable = s.unavailable, game = s.game }); pushSelf() end
    if WMenu.open and accessWanted and s.accessRev ~= accessRev then askAccess() end
end)
RegisterNetEvent('w_connector:console:access', function(block, nonce)
    if foreign() or not WMenu.open or not C.session or nonce ~= C.session.nonce or type(block) ~= 'table' then return end
    accessRev = block.rev
    send('access', block)
end)
RegisterNetEvent('w_connector:console:result', function(id, r, nonce)
    if foreign() then return end
    if not C.session or nonce ~= C.session.nonce then return end
    local cb = C.waiting[id]; if cb then C.waiting[id] = nil; cb(finish(r)) end
end)
RegisterNetEvent('w_connector:console:revoked', function()
    if foreign() then return end
    C.session = nil; WMenu.close()
    if WConsoleTools then WConsoleTools.stop() end
    local waiting = C.waiting; C.waiting = {}
    for _, cb in pairs(waiting) do cb(finish({ ok = false, error = 'no_session' })) end
end)
RegisterNetEvent('w_connector:console:execute', function(ticket, name, args, target)
    if foreign() or type(ticket) ~= 'string' or #ticket ~= 32 or type(name) ~= 'string' or type(args) ~= 'table' then return end
    CreateThread(function()
        local mode = name == 'player.spectate' or name == 'self.noclip' or name == 'self.godmode' or name == 'self.invisible'
            or name == 'self.names' or name == 'self.boost' or name == 'self.stamina' or name == 'self.laser'
            or name == 'self.showCoords' or name == 'self.hashes' or name:sub(1, 10) == 'self.spawn'
        if mode and (not C.live() or not C.session.actions[name]) then TriggerServerEvent('w_connector:console:executed', ticket, { ok = false, error = 'no_session' }); return end
        local called, result = pcall(WConsoleTools.execute, name, args, target)
        result = called and type(result) == 'table' and result or { ok = false, error = 'failed' }
        TriggerServerEvent('w_connector:console:executed', ticket, result); pushSelf()
    end)
end)
RegisterNetEvent('w_connector:console:stopMode', function(name)
    if foreign() then return end
    if name == 'player.spectate' then WMenu.stopSpectate()
    elseif WConsoleTools and type(name) == 'string' then WConsoleTools.execute(name, { state = false }) end
    pushSelf()
end)
local function toggle(mode)
    mode = mode == 'quick' and 'quick' or 'full'
    if WMenu.open then
        if C.mode == mode then WMenu.close() else C.mode = mode; send('mode', { mode = mode }) end
        return true
    end
    if opening or IsPauseMenuActive() then return false end
    if IsNuiFocused() then return false end
    C.mode, opening = mode, true
    -- 2.6.1: the server may wait for a website ask already on its way before it answers (up to ~20 s)
    TriggerServerEvent('w_connector:console:open'); SetTimeout(25000, function() opening = false end)
    return true
end
exports('OpenAdminConsole', toggle)
exports('UsesUnifiedConsole', function() return true end)
-- 2.2.2: the server's /admin, /am, /quickadmin and /noclip (ops/native_commands.lua, only while w_admin is off)
RegisterNetEvent('w_connector:console:command', function(what)
    if foreign() then return end
    if what == 'full' or what == 'quick' then
        if not (WMenu.open and C.mode == what) then toggle(what) end
    elseif what == 'noclip' and WMenu.selfState then
        if WMenu.selfState().noclip then
            -- turning it off needs no authority, as the page's own off switch
            WConsoleTools.execute('self.noclip', { state = false }); TriggerServerEvent('w_connector:console:modeOff', 'self.noclip'); pushSelf()
        else TriggerServerEvent('w_connector:console:noclip') end
    end
end)
RegisterCommand('wadmin', function() toggle('full') end, false)
RegisterCommand('wquickadmin', function() toggle('quick') end, false)
-- RegisterKeyMapping is available on both games. If an old w_admin is started its own binding
-- delegates here, so neither resource races to toggle a second NUI or steals focus back.
-- 2.4.1 (owner 2026-11-03): Page Up opens the quick menu, F10 the full console. A saved binding wins over
-- a mapping's default, so the keys live under NEW command names; the 2.4.0 names (+wc_console_quick,
-- +wc_console_full) stay as plain commands with no key mapping.
local function keyed(mode)
    return function() if GetResourceState('w_admin') ~= 'started' then toggle(mode) end end
end
local function released() end
RegisterCommand('+wc_quick_menu', keyed('quick'), false)
RegisterCommand('-wc_quick_menu', released, false)
RegisterCommand('+wc_admin_console', keyed('full'), false)
RegisterCommand('-wc_admin_console', released, false)
RegisterCommand('+wc_console_quick', keyed('quick'), false)
RegisterCommand('-wc_console_quick', released, false)
RegisterCommand('+wc_console_full', keyed('full'), false)
RegisterCommand('-wc_console_full', released, false)
if RegisterKeyMapping then
    RegisterKeyMapping('+wc_quick_menu', 'Wraith quick administration', 'keyboard', 'PAGEUP')
    RegisterKeyMapping('+wc_admin_console', 'Wraith administration console', 'keyboard', 'F10')
end
RegisterNUICallback('ready', function(_, cb) C.ready = true; cb({ ok = true }); if C.wantOpen and C.live() and not WMenu.open then open() end end)
RegisterNUICallback('close', function(_, cb) WMenu.close(); cb({ ok = true }) end)
RegisterNUICallback('mode', function(data, cb) C.mode = data.mode == 'quick' and 'quick' or 'full'; send('mode', { mode = C.mode }); cb({ ok = true }) end)
RegisterNUICallback('refresh', function(data, cb) if WMenu.open then refresh(data.what) end; cb({ ok = WMenu.open }) end)
RegisterNUICallback('catalog', function(_, cb) refresh('catalog'); cb({ ok = WMenu.open }) end)
RegisterNUICallback('locale', function(data, cb)
    if data.action ~= 'set' or data.locale ~= 'ar' and data.locale ~= 'en' then cb(finish({ ok = false, error = 'invalid_args' })); return end
    lang = data.locale; SetResourceKvp('wc_console_language', lang)
    send('locale', { locale = lang, dir = lang == 'ar' and 'rtl' or 'ltr', strings = strings() }); cb({ ok = true })
end)
local function forward(kind, data, cb)
    if not WMenu.open or type(data) ~= 'table' or type(data.action) ~= 'string' then cb(finish({ ok = false, error = 'no_session' })); return end
    local action = data.action; data.action = nil
    if kind == 'self' and type(data.args) == 'table' and data.args.state == false then
        local result = WConsoleTools.execute('self.' .. action, data.args)
        TriggerServerEvent('w_connector:console:modeOff', 'self.' .. action)
        pushSelf(); cb(finish(result)); return
    end
    local closes = kind == 'player' and (action == 'spectate' or action == 'openInventory' or action == 'wardrobe' or action == 'teleportTo')
    if closes then WMenu.close() end
    C.ask(kind .. '.' .. action, data, function(r)
        if not r.ok and r.errorKey == 'timeout' and kind == 'characters' and (action == 'delete' or action == 'transfer') then r.data = { timedOut = true } end
        if r.ok then
            if kind == 'player' then refresh('players') end
            if kind == 'server' then refresh('server') end
            if kind == 'self' then
                pushSelf()
                if (action == 'noclip' or action == 'laser') and data.args and data.args.state or action:sub(1, 2) == 'tp' then WMenu.close() end
            end
            -- 2.2.0: a hub quick command (ops/native_scripts.lua built the line from its registry): run
            -- here, as this admin, while the console stays open; the script's own message shows the result
            if kind == 'scripts' and type(r.data) == 'table' and type(r.data.exec) == 'string' then
                local line = r.data.exec; r.data.exec = nil; ExecuteCommand(line)
            end
            if type(r.data) == 'table' and type(r.data.route) == 'table' then
                local route = r.data.route; r.data.route = nil; WMenu.close()
                SetTimeout(150, function()
                    if route.kind == 'command' and type(route.line) == 'string' then ExecuteCommand(route.line)
                    elseif route.kind == 'export' and type(route.res) == 'string' and type(route.fn) == 'string' and GetResourceState(route.res) == 'started' then pcall(function() exports[route.res][route.fn]() end) end
                end)
            end
        end
        cb(r)
    end)
end
-- 2.4.0: 'blips' (ops/native_blips.lua, the page in web/src/pages/blips)
for _, kind in ipairs({ 'player', 'self', 'server', 'hud', 'characters', 'scripts', 'settings', 'news', 'reports', 'ranks', 'bans', 'blips', 'jail' }) do
    RegisterNUICallback(kind, function(data, cb) forward(kind, data, cb) end)
end
RegisterNUICallback('citizen', function(data, cb) C.ask('citizen.lookup', { input = data.input }, cb) end)
RegisterNUICallback('logs', function(data, cb) C.ask('logs.query', data, cb) end)
RegisterNUICallback('map', function(data, cb)
    if data.action == 'stopPlayers' then mapWatch = false; cb({ ok = true }); return end
    local action = data.action
    if action == 'players' then mapWatch = true; refresh('map') end
    forward('map', data, function(r)
        if r.ok and mapWatch and action == 'players' then send('mapPlayers', { list = r.data or {} }) end
        if r.ok and action == 'setTheme' then refresh('map') end
        cb(r)
    end)
end)
RegisterNUICallback('sound', function(_, cb) cb({ ok = true }) end)

-- 2.8.0 (the notebook look): 'where' = the game's town / district keys for a list of points, so the page names a
-- place («فالنتاين · 1.2 كم منك») instead of printing its coordinates. The same hashes as w_lib's lib.place
-- (w_zonenotify's): GetMapZoneAtCoords type 1 = town, 10 = district. RedM only; elsewhere every point is nil and
-- the page shows the distance alone. A zone is remembered per 8 m cell (at most 1024 cells).
local WHERE_TOWNS = {
    [459833523] = 'valentine', [2046780049] = 'rhodes', [-765540529] = 'saint_denis', [427683330] = 'strawberry',
    [1053078005] = 'blackwater', [-744494798] = 'armadillo', [-1524959147] = 'tumbleweed', [7359335] = 'annesburg',
    [2126321341] = 'van_horn', [201158410] = 'manicato', [1463094051] = 'manzanita_post',
}
local WHERE_DISTRICTS = {
    [2025841068] = 'bayou_nwa', [822658194] = 'big_valley', [1308232528] = 'bluewater_marsh',
    [1835499550] = 'cumberland_forest', [476637847] = 'great_plains', [1645618177] = 'grizzlies',
    [-120156735] = 'grizzlies', [-512529193] = 'guarma', [131399519] = 'heartlands', [178647645] = 'roanoke_ridge',
    [-864275692] = 'scarlett_meadows', [1684533001] = 'tall_trees', [-2066240242] = 'gaptooth_ridge',
    [-2145992129] = 'rio_bravo', [-108848014] = 'cholla_springs', [892930832] = 'hennigans_stead',
}
local whereCells, whereCount = {}, 0
local IS_RDR = GetGameName() == 'redm'

local function whereZone(x, y, z)
    local cell = ('%d:%d'):format(math.floor(x / 8), math.floor(y / 8))
    local hit = whereCells[cell]
    if hit then return hit end
    local zone = 'wild'
    local okT, town = pcall(GetMapZoneAtCoords, x + 0.0, y + 0.0, (z or 100.0) + 0.0, 1)
    if okT and WHERE_TOWNS[town] then
        zone = WHERE_TOWNS[town]
    else
        local okD, district = pcall(GetMapZoneAtCoords, x + 0.0, y + 0.0, (z or 100.0) + 0.0, 10)
        if okD and WHERE_DISTRICTS[district] then zone = WHERE_DISTRICTS[district] end
    end
    if whereCount >= 1024 then whereCells, whereCount = {}, 0 end
    whereCells[cell], whereCount = zone, whereCount + 1
    return zone
end

RegisterNUICallback('where', function(data, cb)
    local out = {}
    local list = type(data) == 'table' and type(data.list) == 'table' and data.list or {}
    for i = 1, math.min(#list, 64) do
        local c = list[i]
        local x, y = type(c) == 'table' and tonumber(c.x), type(c) == 'table' and tonumber(c.y)
        out[i] = (IS_RDR and x and y) and whereZone(x, y, tonumber(c.z)) or false
    end
    cb({ ok = true, data = out })
end)
CreateThread(function()
    local nextRefresh = 0
    while true do
        if C.session and not C.live() then C.session = nil; WMenu.close(); if WConsoleTools then WConsoleTools.stop() end end
        if WMenu.open then
            if IsPauseMenuActive() then WMenu.close()
            elseif GetGameTimer() >= nextRefresh then
                refresh('players'); refresh('server'); pushSelf()
                if mapWatch then C.ask('map.players', {}, function(r) if r.ok and mapWatch then send('mapPlayers', { list = r.data or {} }) end end) end
                nextRefresh = GetGameTimer() + 5000
            end
        end
        Wait(500)
    end
end)
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    WMenu.close(); C.session = nil; if WConsoleTools then WConsoleTools.stop() end
end)
