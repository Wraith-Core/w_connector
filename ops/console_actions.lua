-- Framework-neutral handlers. Mutations use the existing adapters, never guessed framework events
-- or direct SQL. Optional systems are offered only when their owning resource is running.
local C = WC.Console
local models = json.decode(LoadResourceFile(GetCurrentResourceName(), 'core/console_models.json') or '{}')
local function fw() return WC.Adapters.get('framework') end
local function inv() return WC.Adapters.get('inventory') end
local function hasOp(name) for _, n in ipairs(WC.Ops.available()) do if n == name then return true end end return false end
local function op(name, args) return WC.Ops.run(name, args or {}) end
local function available(name) return function() return hasOp(name) end end
local function allowMove(src)
    if WC.started('w_guard') then pcall(function() exports.w_guard:AllowMove(src, 5) end) end
end
local returned, frozen, moneyLocks = {}, {}, {}
local function position(src)
    local p = GetPlayerPed(src)
    if not p or p == 0 then return nil end
    local c = GetEntityCoords(p)
    return { x = c.x, y = c.y, z = c.z, heading = GetEntityHeading(p) }
end
local function normalize(src, session)
    local p, c = WC.playerView(src), position(src)
    local ped = GetPlayerPed(src)
    local health = ped ~= 0 and GetEntityHealth(ped) or 0
    local maxHealth = ped ~= 0 and GetEntityMaxHealth(ped) or 0
    local dead = p.status and p.status.dead
    if type(dead) == 'boolean' then
        if maxHealth <= 0 then maxHealth = WC.gameName() == 'rdr3' and 600 or 200 end
        if dead then health = 0 elseif health <= 0 then health = maxHealth end
    elseif WC.gameName() == 'rdr3' and health <= 0 then
        -- RedM may report zero for a living ped. Unknown health is not a death report.
        maxHealth, dead = 0, false
    else dead = ped == 0 or health <= 0 end
    local first, last = tostring(p.charName or p.name or ''):match('^(%S+)%s*(.*)$')
    local view = { id = src, name = p.name, citizenid = tostring(p.charId or ''), firstname = first or '', lastname = last or '',
        job = p.job or {}, gang = p.gang or {}, money = {}, ping = p.ping, health = health,
        maxHealth = maxHealth, dead = dead, needs = p.status and p.status.needs,
        coords = c or {}, group = '', frozen = frozen[src] ~= nil and frozen[src] == C.identity(src), canReturn = returned[src] and returned[src].identity == C.identity(src) or false,
        jail = WC.Jail and WC.Jail.view(src) or nil }
    for _, permission in ipairs(session.permissions or {}) do if permission == 'players.view' then view.money = p.money or {} end end
    if session.allowed['player.money'] then view.money = p.money or {} end
    if view.money.money ~= nil and view.money.cash == nil then
        local copy = {}; for key, value in pairs(view.money) do copy[key] = value end
        copy.cash = view.money.money; view.money = copy
    end
    if WC.started('w_hud') then
        local ok, needs = pcall(function() return exports.w_hud:GetNeedsPair(src) end)
        if ok and type(needs) == 'table' then view.needs = needs end
    end
    return view
end
C.define('query.players', nil, function(_, ctx)
    local out = {}
    for _, id in ipairs(GetPlayers()) do out[#out + 1] = normalize(tonumber(id), ctx.session) end
    return true, out
end)
C.define('query.self', nil, function(_, ctx) return true, normalize(ctx.source, ctx.session) end)
C.define('query.server', nil, function(_, ctx)
    local resources, world, weather, time = {}, nil, nil, nil
    if ctx.session.allowed['server.startResource'] or ctx.session.allowed['query.resources'] then local ok, list = op('resources.list'); if ok then resources = list end end
    local protected = {}; for _, r in ipairs(resources) do if r.protected then protected[#protected + 1] = r.name end end
    if hasOp('world.state') then
        local ok, state = op('world.state')
        if ok and type(state) == 'table' then weather = state.weather or state.weatherType; time = state.time; world = state
        elseif ok and type(state) == 'string' then weather = state end
        if WC.started('w_weathersync') then
            local read, clock = pcall(function() return exports.w_weathersync:GetTime() end)
            if read then time = clock end
            world = { timeFrozen = exports.w_weathersync:getTimeFreezeState(), dynamicWeather = exports.w_weathersync:getDynamicWeather(), blackout = exports.w_weathersync:getBlackoutState() }
        end
    end
    return true, { uptime = GetGameTimer() // 1000, playersOnline = #GetPlayers(), maxPlayers = GetConvarInt('sv_maxclients', 32),
        version = WC.version(GetCurrentResourceName()), weather = weather, time = time, resources = resources, protectedResources = protected,
        world = world, bansCount = nil, blocksCount = nil }
end)
C.define('query.resources', nil, function() return op('resources.list') end)
C.define('query.catalog', nil, function(_, ctx)
    local out = { jobs = {}, gangs = {}, items = {}, weathers = {}, horses = {}, wagons = {}, animals = {}, peds = {}, groups = {} }
    if ctx.session.allowed['player.setJob'] and hasOp('jobs.list') then local ok, list = op('jobs.list'); if ok then out.jobs = list end end
    if ctx.session.allowed['player.giveItem'] and hasOp('items.catalog') then
        local ok, list = op('items.catalog')
        -- 2.4.2: every inventory adapter answers the website panel's map { [name] = { label, weight } }; the
        -- pages read a list (App.tsx arr()), so a map arrived as an EMPTY item picker (give item, both pages)
        if ok and type(list) == 'table' then
            local items = {}
            for name, def in pairs(list) do
                if type(name) == 'string' then
                    items[#items + 1] = { name = name, label = type(def) == 'table' and def.label or name, weight = type(def) == 'table' and def.weight or nil }
                elseif type(def) == 'table' and type(def.name) == 'string' then items[#items + 1] = def end
            end
            table.sort(items, function(a, b) return tostring(a.name) < tostring(b.name) end)
            out.items = items
        end
    end
    if fw() and type(fw().consoleCatalog) == 'function' then
        local read, more = pcall(fw().consoleCatalog)
        more = read and type(more) == 'table' and more or {}
        for _, key in ipairs({ 'jobs', 'gangs', 'horses', 'wagons', 'animals', 'peds' }) do
            if type(more[key]) == 'table' then
                local list = {}
                for name, row in pairs(more[key]) do
                    if type(row) == 'table' then
                        if key == 'jobs' or key == 'gangs' then
                            local grades = {}
                            for grade, entry in pairs(row.grades or {}) do
                                local n = tonumber(grade)
                                if n then grades[#grades + 1] = { grade = n, name = type(entry) == 'table' and (entry.name or entry.label) or tostring(entry) } end
                            end
                            table.sort(grades, function(a,b) return a.grade < b.grade end)
                            list[#list + 1] = { name = tostring(name), label = row.label_ar or row.label or row.joblabel or tostring(name), grades = grades }
                        else
                            local model = row.model or (type(name) == 'string' and name)
                            if model then list[#list + 1] = { model = model, label = row.name or row.label or model } end
                        end
                    end
                end
                table.sort(list, function(a,b) return (a.label or '') < (b.label or '') end)
                out[key] = list
            end
        end
    end
    local defaults = models[WC.gameName()] or {}
    for _, key in ipairs({ 'horses', 'wagons', 'animals', 'peds' }) do
        if #out[key] == 0 then out[key] = defaults[key] or {} end
    end
    if WC.started('w_weathersync') then
        local ok, list = pcall(function() return exports.w_weathersync:GetWeatherTypes() end)
        if ok and type(list) == 'table' then out.weathers = list end
    end
    return true, out
end)
C.define('citizen.lookup', nil, function(data, ctx)
    local input = tostring(data.input or ''):match('^%s*(.-)%s*$')
    for i, digit in ipairs({ '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩' }) do input = input:gsub(digit, tostring(i - 1)) end
    for i, digit in ipairs({ '۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹' }) do input = input:gsub(digit, tostring(i - 1)) end
    if input:match('^%d+$') then input = input:gsub('^0+', '') end
    if input:match('^%a%a%a%d%d%d%d%d$') then input = input:upper() end
    local id = input == 'me' and ctx.source or tonumber(input:match('^#(%d+)$'))
    if id then
        if not WC.onlineSource(id) then return false, 'player_offline' end
        local p = WC.playerView(id)
        return true, { citizenid = tostring(p.charId or ''), name = p.charName or p.name, online = true, source = id }
    end
    for _, source in ipairs(GetPlayers()) do
        local src = tonumber(source); local p = WC.playerView(src)
        if tostring(p.charId or '') == input then return true, { citizenid = input, name = p.charName or p.name, online = true, source = src } end
    end
    local ok, p = op('player.offline', { charId = input })
    if not ok then return false, p end
    return true, { citizenid = tostring(p.charId), name = p.charName or p.name or '', online = false }
end)
local SIMPLE = {
    revive = { 'player.revive' }, heal = { 'player.heal' },
    setJob = { 'player.setJob', function(a) return { job = a.name, grade = a.grade } end },
    setGang = { 'player.setGang', function(a) return { gang = a.name, grade = a.grade } end },
    clearInventory = { 'inventory.clear', function() return { scope = 'all' } end },
    needs = { 'player.setNeeds', function(a) return { needs = a } end },
    notify = { 'player.message', function(a) return { message = a.text, by = 'Staff' } end },
    kick = { 'players.kick', function(a) return { reason = a.reason } end },
}
for action, def in pairs(SIMPLE) do
    C.define('player.' .. action, available(def[1]), function(data, ctx)
        local a = def[2] and def[2](data.args or {}) or {}; a.source = ctx.target
        if not ctx.valid() then return false, 'target_changed' end
        return op(def[1], a)
    end)
end
C.define('player.giveItem', available('inventory.add'), function(data, ctx)
    local a, inventory = data.args, inv()
    if not inventory.canCarry(ctx.target, a.item, a.count) then return false, 'cannot_carry' end
    if not ctx.valid() then return false, 'target_changed' end
    return inventory.add(ctx.target, a.item, a.count)
end)
for action, kind in pairs({ teleportTo = 'goto', bring = 'bring', bringBack = 'back', tpCoords = 'coords' }) do
    C.define('player.' .. action, nil, function(data, ctx)
        local src, dst, c = ctx.source, ctx.target
        if kind == 'goto' then c = position(dst); dst = src
        elseif kind == 'bring' then
            c = position(src); returned[dst] = { identity = C.identity(dst), coords = position(dst) }
        elseif kind == 'back' then
            local r = returned[dst]
            if not r or r.identity ~= C.identity(dst) or not r.coords then return false, 'nothing_to_return_to' end
            c = r.coords
        else c = data.args end
        if not c then return false, 'no_ped' end
        if not ctx.valid() then return false, 'target_changed' end
        allowMove(dst)
        if not c.z then return C.client('self.tpCoords', c, { source = dst, session = ctx.session, valid = ctx.valid }) end
        local ok, err = op('player.teleport', { source = dst, x = c.x, y = c.y, z = c.z })
        if ok and kind == 'back' then returned[dst] = nil end
        return ok, err
    end)
end
C.define('player.freeze', nil, function(data, ctx)
    local on = data.args and data.args.state == true
    local ok, err = op('player.freeze', { source = ctx.target, frozen = on })
    if ok then frozen[ctx.target] = on and C.identity(ctx.target) or nil end
    return ok, err
end)
-- 2.8.0 (owner 2026-11-14): the admin jail (ops/jail.lua). The website stored the stay against the bound target and
-- added its two places to the arguments before this runs; the jail itself holds him from here on.
C.define('player.jail', nil, function(data, ctx)
    local a = data.args or {}
    if not ctx.valid() then return false, 'target_changed' end
    return op('player.jail', { source = ctx.target, minutes = a.minutes, reason = a.reason, by = GetPlayerName(ctx.source),
        place = a.place, release = a.release })
end)
C.define('player.unjail', nil, function(_, ctx)
    if not ctx.valid() then return false, 'target_changed' end
    local license = WC.Jail.licenseOf(ctx.target)
    -- the website already ended its record: a player this server does not hold is simply done
    if not license or not WC.Jail.stays[license] then return true end
    return op('player.unjail', { source = ctx.target })
end)
-- the place where the admin stands becomes the jail (or the release) place; the website saved it already
C.define('jail.setPlace', nil, function(data)
    local ok = WC.Jail.setPlace(data.kind == 'release' and 'release' or 'jail', data.at)
    return ok, ok and nil or 'invalid_args'
end)
C.define('player.money', available('money.adjust'), function(data, ctx)
    local a, target = data.args, ctx.target
    local key = ctx.targetIdentity
    if moneyLocks[key] then return false, 'busy' end
    moneyLocks[key] = true
    local called, ok, result = pcall(function()
        local p = fw().player(target)
        if not ctx.valid() or not p then return false, 'target_changed' end
        local account = a.type
        if a.type == 'cash' then for _, acc in ipairs(fw().accounts(target) or {}) do if acc.kind == 'cash' then account = acc.id; break end end end
        if not ctx.valid() then return false, 'target_changed' end
        local current = p.money and tonumber(p.money[account])
        if not current then return false, 'unknown_account' end
        local amount = a.op == 'set' and (a.amount - current) or (a.op == 'remove' and -a.amount or a.amount)
        if amount > 0 then
            if #tostring(a.reason or ''):gsub('%s', '') < 3 then return false, 'money_reason_required' end
            local limit = GetConvarInt('wraith_console_money_' .. a.type .. '_limit', a.type == 'gold' and 100 or 100000)
            if amount > math.max(0, limit) then return false, 'money_limit' end
        end
        if amount == 0 then return true end
        if not ctx.valid() then return false, 'target_changed' end
        return op('money.adjust', { source = target, account = account, amount = amount })
    end)
    moneyLocks[key] = nil
    if not called then return false, 'failed' end
    return ok, result
end)
C.define('player.ban', nil, function(data, ctx)
    -- The website already saved the ban against the bound identifiers. This is only the live kick.
    return op('players.kick', { source = ctx.target, reason = data.args.reason })
end)
C.define('player.spectate', nil, function(data, ctx)
    if data.args.state ~= false and not C.allowMode('player.spectate', ctx.source) then return false, 'capability_missing' end
    allowMove(ctx.source)
    return C.client('player.spectate', { state = data.args.state ~= false, coords = position(ctx.target) }, ctx)
end)
-- 2.2.0: the native w_admin bridge (wardrobe, sit on mount, live settings, HUD, offline character edits)
-- is gone; each part now runs here without w_admin: ops/native_*.lua.
C.define('player.openInventory', function() return inv() and type(inv().openPlayer) == 'function' end, function(_, ctx)
    if not ctx.valid() then return false, 'target_changed' end
    return inv().openPlayer(ctx.source, ctx.target)
end)
for _, name in ipairs({ 'revive', 'heal' }) do
    C.define('self.' .. name, available('player.' .. name), function(_, ctx) return op('player.' .. name, { source = ctx.source }) end)
end
local CLIENT = { 'noclip', 'invisible', 'godmode', 'names', 'boost', 'stamina', 'cleanPed', 'noclipSpeed',
    'tpWaypoint', 'tpBack', 'tpForward', 'tpCoords', 'stopSpectate', 'spawnHorse', 'spawnWagon', 'spawnAnimal',
    'spawnPed', 'cleanupSpawned', 'repairVehicle', 'flipVehicle', 'vehicleBoost', 'healMount',
    'laser', 'copyCoords', 'showCoords', 'hashes' }
for _, action in ipairs(CLIENT) do
    local name = 'self.' .. action
    C.define(name, function()
        if action == 'spawnHorse' or action == 'healMount' then return WC.gameName() == 'rdr3' end
        return true
    end, function(data, ctx)
        local a = data.args or {}
        if action:sub(1, 2) == 'tp' or action == 'noclip' then allowMove(ctx.source) end
        if a.state ~= false and not C.allowMode(name, ctx.source) then return false, 'capability_missing' end
        if action:sub(1, 5) == 'spawn' and WC.started('w_guard') then pcall(function() exports.w_guard:ExpectEntity(ctx.source, GetHashKey(a.model), 1, 8) end) end
        return C.client(name, a, ctx)
    end)
end
for action, name in pairs({ weather = 'world.setWeather', time = 'world.setTime', announce = 'server.announce' }) do
    C.define('server.' .. action, function() return action == 'announce' and WC.started('w_hud') or hasOp(name) end, function(data, ctx)
        local a = data.args
        if action == 'weather' then return op(name, { weather = a.type }) end
        if action == 'announce' then
            if WC.started('w_hud') then
                local shown = exports.w_hud:Announce(a.text, a.seconds, { by = GetPlayerName(ctx.source) }) ~= false
                -- 2.2.0: the pause menu's announcements card records it, as after w_admin's (w_pausemenu 2.0.3 trusts this resource)
                if shown then TriggerEvent('w_admin:server:announced', a.text, GetPlayerName(ctx.source)) end
                return shown
            end
            return op(name, { message = a.text })
        end
        return op(name, a)
    end)
end
for _, action in ipairs({ 'freezeTime', 'dynamicWeather', 'blackout', 'announceClear' }) do
    C.define('server.' .. action, function() return action == 'announceClear' and WC.started('w_hud') or action ~= 'announceClear' and WC.started('w_weathersync') end, function(data)
        if action == 'announceClear' then return exports.w_hud:ClearAnnouncement() ~= false end
        local fn = ({ freezeTime = 'setTimeFreeze', dynamicWeather = 'setDynamicWeather', blackout = 'setBlackout' })[action]
        local result = exports.w_weathersync[fn](exports.w_weathersync, data.args.state)
        return type(result) == 'boolean', { state = result }
    end)
end
C.define('query.hud', function() return WC.started('w_hud') end, function() return true, exports.w_hud:GetServerHudCfg() end)
C.define('query.map', nil, function(_, ctx)
    if WC.started('w_map') then return C.client('query.map', {}, ctx) end
    local gta = WC.gameName() == 'gta5'
    return true, { tilesBase = '', theme = 'dark', tiles = { grid = true, size = 512, minZoom = 1, maxZoom = 7, maxView = 7 },
        projection = { image = { 16384, 16384 }, topLeft = gta and { -6000, 10000 } or { -7168, 5632 },
            bottomRight = gta and { 10000, -6000 } or { 9216, -10752 }, refZoom = 6 } }
end)
C.define('map.players', nil, function(_, ctx)
    local list = {}
    for _, id in ipairs(GetPlayers()) do
        local n = tonumber(id); local p = normalize(n, ctx.session); local c = p.coords
        if c.x then list[#list + 1] = { id = n, name = p.name, citizenid = p.citizenid, job = p.job.label or p.job.name or '', dead = p.dead, x = c.x, y = c.y, z = c.z } end
    end
    return true, list
end)
C.define('map.teleport', nil, function(data, ctx)
    local dst = ctx.target or ctx.source
    allowMove(dst)
    if not data.z then return C.client('self.tpCoords', data, { source = dst, session = ctx.session, valid = ctx.valid }) end
    return op('player.teleport', { source = dst, x = data.x, y = data.y, z = data.z })
end)
for _, action in ipairs({ 'waypoint', 'clearWaypoint', 'copyCoords', 'setTheme' }) do
    C.define('map.' .. action, action == 'setTheme' and function() return WC.started('w_map') end or nil,
        function(data, ctx) return C.client('map.' .. action, data, ctx) end)
end
-- scripts.list / open / run: ops/native_scripts.lua (2.2.0)
C.define('scripts.start', nil, function(data) return op('resources.control', { name = data.resource, action = 'start' }) end)
for action, verb in pairs({ startResource = 'start', stopResource = 'stop', restartResource = 'restart' }) do
    C.define('server.' .. action, nil, function(data, ctx)
        if not ctx.valid() then return false, 'no_session' end
        return op('resources.control', { name = data.args.name, action = verb })
    end)
end
-- news.* and characters.*: ops/native_news.lua and ops/native_characters.lua (2.2.0)
AddEventHandler('playerDropped', function() returned[source], frozen[source] = nil, nil end)
