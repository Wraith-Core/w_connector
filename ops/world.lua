--- Time and weather. There is no server native for either: they are synced by a resource, so this goes
--- through the one whose exports are verified — Wraith's w_weathersync (server/main.lua:383-396:
--- setWeather(type), setTime(hour, minute), getWeatherState()). Without it the ops are not offered.

local function weathersync() return WC.started('w_weathersync') end

WC.Ops.define('world.state', weathersync, function()
    return true, exports.w_weathersync:getWeatherState()
end)

WC.Ops.define('world.setWeather', weathersync, function(args)
    local w = type(args.weather) == 'string' and args.weather:upper() or ''
    if not w:match('^[A-Z_]+$') or #w > 30 then return false, 'invalid_args' end
    if not exports.w_weathersync:setWeather(w) then return false, 'unknown_weather' end
    return true
end)

WC.Ops.define('world.setTime', weathersync, function(args)
    local h, m = math.tointeger(tonumber(args.hour)), math.tointeger(tonumber(args.minute or 0))
    if not h or not m or h < 0 or h > 23 or m < 0 or m > 59 then return false, 'invalid_args' end
    if not exports.w_weathersync:setTime(h, m) then return false, 'refused' end
    return true
end)
