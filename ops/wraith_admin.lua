--- Wraith's level page in w_level, reached the way v1 reached it: w_level exports AdminCitizen, answering
--- only a caller named w_connector (w_level server/main.lua:1092). These ops exist only while w_level runs.
--- 2.2.0: the w_admin pages that used to be reached from here (characters, needs, news, the world's cycle)
--- run in the connector itself: ops/native_characters.lua, ops/native_settings.lua, ops/native_news.lua.

local function level() return WC.started('w_level') and exports.w_level or nil end

local function cid(v)
    v = tostring(v or '')
    return v:match('^[%w_%-]+$') and #v <= 32 and v or nil
end

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
