--- Character and player-control ops (Phase 3b). Each is offered only where it can actually work: the
--- framework adapter has the function (and, for revive/heal, the medic resource it relies on is running).
--- Teleport and freeze use server natives that exist with OneSync (GetPlayerPed, SetEntityCoords,
--- FreezeEntityPosition — verified in this FXServer build's natives_server.lua).

local function fw() return WC.Adapters.get('framework') end
local function fwHas(fn) return function() local f = fw() return f ~= nil and type(f[fn]) == 'function' end end

local function name(v, max)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' or #v > (max or 40) or v:find('[%c<>]') then return nil end
    return v
end

local function ident(v)
    return type(v) == 'string' and v:match('^[%w_%-]+$') and #v <= 50 and v or nil
end

local function grade(v)
    local g = math.tointeger(tonumber(v or 0))
    return g and g >= 0 and g <= 100 and g or nil
end

WC.Ops.define('jobs.list', fwHas('jobs'), function()
    local list = fw().jobs()
    table.sort(list, function(a, b) return tostring(a.name) < tostring(b.name) end)
    return true, list
end)

WC.Ops.define('player.setJob', fwHas('setJob'), function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local job, g = ident(args.job), grade(args.grade)
    if not job or not g then return false, 'invalid_args' end
    return fw().setJob(src, job, g)
end)

WC.Ops.define('player.setGang', fwHas('setGang'), function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local gang, g = ident(args.gang), grade(args.grade)
    if not gang or not g then return false, 'invalid_args' end
    return fw().setGang(src, gang, g)
end)

WC.Ops.define('player.setName', fwHas('setName'), function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local first, last = name(args.firstname), name(args.lastname)
    if not first or not last then return false, 'invalid_args' end
    return fw().setName(src, first, last)
end)

local function canRevive() local f = fw() return f ~= nil and type(f.canRevive) == 'function' and f.canRevive() == true end

WC.Ops.define('player.revive', canRevive, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    return fw().revive(src)
end)

WC.Ops.define('player.heal', canRevive, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    return fw().heal(src)
end)

local function ped(src)
    local p = GetPlayerPed(src)
    return p ~= 0 and p or nil
end

local function coord(v)
    local n = tonumber(v)
    return n and n == n and math.abs(n) < 100000 and n or nil
end

WC.Ops.define('player.teleport', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local p = ped(src)
    if not p then return false, 'no_ped' end
    local x, y, z = coord(args.x), coord(args.y), coord(args.z)
    if not x or not y or not z then return false, 'invalid_args' end
    SetEntityCoords(p, x, y, z, false, false, false, false)
    return true
end)

--- Move one player to where another one stands.
WC.Ops.define('player.bring', nil, function(args)
    local src, to = WC.onlineSource(args.source), WC.onlineSource(args.to)
    if not src or not to then return false, 'player_offline' end
    local p, target = ped(src), ped(to)
    if not p or not target then return false, 'no_ped' end
    local c = GetEntityCoords(target)
    SetEntityCoords(p, c.x, c.y, c.z + 0.5, false, false, false, false)
    return true
end)

WC.Ops.define('player.freeze', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local p = ped(src)
    if not p then return false, 'no_ped' end
    FreezeEntityPosition(p, args.frozen == true)
    return true
end)

-- A private message, through chat like announcements.
WC.Ops.define('player.message', function() return WC.started('chat') end, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local msg = type(args.message) == 'string' and args.message:sub(1, 500) or ''
    if msg == '' then return false, 'invalid_args' end
    local by = type(args.by) == 'string' and args.by:sub(1, 60) or 'Staff'
    TriggerClientEvent('chat:addMessage', src, { color = { 255, 196, 0 }, multiline = true, args = { by, msg } })
    return true
end)
