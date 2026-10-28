--- Wraith's own pages that live in w_admin and w_level, reached the way v1 reached them: w_admin exports
--- SiteCharacterAction / SitePlayerAction / SiteRun and w_level exports AdminCitizen, each answering
--- only a caller named w_connector (verified in _fwtest/wcore: w_admin server/sv_characters.lua:457,
--- sv_console.lua:994 and :1259; w_level server/main.lua:1092). One implementation for both panels; these
--- ops exist only while those resources run.

local function admin() return WC.started('w_admin') and exports.w_admin or nil end
local function level() return WC.started('w_level') and exports.w_level or nil end

--- w_admin's page answer ({ ok, error, msg, data }) as an op's.
local function answer(res)
    if type(res) ~= 'table' then return false, 'admin_error' end
    if not res.ok then return false, tostring(res.error or 'admin_error'):sub(1, 60) end
    return true, { message = res.msg, data = res.data }
end

local function cid(v)
    v = tostring(v or '')
    return v:match('^[%w_%-]+$') and #v <= 32 and v or nil
end
local function token(v)
    v = tostring(v or '')
    return v:match('^[%w]+$') and #v >= 6 and #v <= 40 and v or nil
end

-- Characters (w_core trusts w_admin for these): read one, block / unblock, reassign the number,
-- transfer a number, delete — the last two are long and answered later by their status ops.
-- Each action: the payload w_admin expects, and the fields that must be present (a nil is simply
-- absent from a Lua table, so they are named rather than looked for).
local CHARACTER = {
    get = { function(a) return { citizenid = cid(a.charId) } end, { 'citizenid' } },
    block = { function(a) return { citizenid = cid(a.charId), reason = tostring(a.reason or ''):sub(1, 255) } end, { 'citizenid' } },
    unblock = { function(a) return { citizenid = cid(a.charId) } end, { 'citizenid' } },
    reassign = { function(a) return { citizenid = cid(a.charId), newId = cid(a.newId) } end, { 'citizenid', 'newId' } },
    transfer = { function(a) return { citizenid = cid(a.charId), target = cid(a.target), token = token(a.token) } end, { 'citizenid', 'target', 'token' } },
    transferStatus = { function(a) return { token = token(a.token) } end, { 'token' } },
    delete = { function(a) return { citizenid = cid(a.charId), token = token(a.token) } end, { 'citizenid', 'token' } },
    deleteStatus = { function(a) return { token = token(a.token) } end, { 'token' } },
}

WC.Ops.define('character.action', function() return admin() ~= nil end, function(args, actor)
    local def = CHARACTER[args.action]
    if not def then return false, 'invalid_args' end
    local payload = def[1](args)
    for _, field in ipairs(def[2]) do if payload[field] == nil then return false, 'invalid_args' end end
    local ok, res = pcall(function() return admin():SiteCharacterAction(args.action, payload, actor and actor.name or 'Web Admin') end)
    if not ok then return false, 'admin_error' end
    return answer(res)
end)

--- needs: { hunger, thirst, … } as w_admin's console sets them.
WC.Ops.define('player.setNeeds', function() return admin() ~= nil end, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local ok, res = pcall(function() return admin():SitePlayerAction('needs', src, type(args.needs) == 'table' and args.needs or {}) end)
    if not ok then return false, 'admin_error' end
    return answer(res)
end)

-- The pause-menu news and the world's cycle (frozen time, dynamic weather, blackout).
local RUN = {
    news = { newsList = true, newsSave = true, newsReset = true },
    server = { freezeTime = true, dynamicWeather = true, blackout = true, world = true },
}

WC.Ops.define('admin.run', function() return admin() ~= nil end, function(args, actor)
    local kind = type(args.kind) == 'string' and args.kind or ''
    local payload = type(args.payload) == 'table' and args.payload or {}
    if not RUN[kind] or not RUN[kind][payload.action] then return false, 'invalid_args' end
    local ok, res = pcall(function() return admin():SiteRun(kind, payload, actor and actor.name or 'Web Admin') end)
    if not ok then return false, 'admin_error' end
    return answer(res)
end)

-- Level and XP boost (w_level's own /setlevel and /xpboost).
WC.Ops.define('player.setLevel', function() return level() ~= nil end, function(args, actor)
    local id, n = cid(args.charId), math.tointeger(tonumber(args.level))
    if not id or not n or n < 0 or n > 1000 then return false, 'invalid_args' end
    local ok, done, why = pcall(function() return level():AdminCitizen(id, 'setlevel', n, nil, actor and actor.name or 'Web Admin') end)
    if not ok then return false, 'admin_error' end
    if done ~= true then return false, tostring(why or 'refused') end
    return true
end)

WC.Ops.define('player.xpBoost', function() return level() ~= nil end, function(args, actor)
    local id = cid(args.charId)
    local mult, minutes = tonumber(args.multiplier), math.tointeger(tonumber(args.minutes))
    if not id or not mult or not minutes or mult <= 1 or mult > 10 or minutes <= 0 or minutes > 1440 then return false, 'invalid_args' end
    local ok, done, why = pcall(function() return level():AdminCitizen(id, 'boost', mult, minutes * 60, actor and actor.name or 'Web Admin') end)
    if not ok then return false, 'admin_error' end
    if done ~= true then return false, tostring(why or 'refused') end
    return true
end)
