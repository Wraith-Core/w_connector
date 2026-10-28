--- FiveM map blips and zones from the website (ops/live.lua map.sync → GlobalState). Blips are drawn on
--- the map; a player inside a zone gets the replicated state bag `w_zone` (the zone's name) that other
--- scripts can read, and the local event `w_connector:zone` (name, previous) when it changes. A zone
--- marked debug is outlined in the world.
if GetGameName() ~= 'fivem' then return end

local KEY = 'w_connector:map'
local blips, zones = {}, {}

local function clearBlips()
    for _, b in ipairs(blips) do if DoesBlipExist(b) then RemoveBlip(b) end end
    blips = {}
end

local function apply(map)
    clearBlips()
    zones = type(map) == 'table' and type(map.zones) == 'table' and map.zones or {}
    if type(map) ~= 'table' or type(map.blips) ~= 'table' then return end
    for _, d in ipairs(map.blips) do
        local b = AddBlipForCoord(d.x + 0.0, d.y + 0.0, d.z + 0.0)
        SetBlipSprite(b, d.sprite or 1)
        SetBlipColour(b, d.color or 0)
        SetBlipScale(b, (d.scale or 0.8) + 0.0)
        SetBlipAsShortRange(b, d.shortRange ~= false)
        BeginTextCommandSetBlipName('STRING')
        AddTextComponentSubstringPlayerName(d.label or 'Blip')
        EndTextCommandSetBlipName(b)
        blips[#blips + 1] = b
    end
end

AddStateBagChangeHandler(KEY, 'global', function(_, _, value) apply(value) end)
CreateThread(function() apply(GlobalState[KEY]) end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() then clearBlips() end
end)

-- Ray casting: is (x, y) inside the polygon?
local function inside(pts, x, y)
    local hit, j = false, #pts
    for i = 1, #pts do
        local a, b = pts[i], pts[j]
        if ((a.y > y) ~= (b.y > y)) and (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) then hit = not hit end
        j = i
    end
    return hit
end

CreateThread(function()
    local current = nil
    while true do
        Wait(1000)
        local c = GetEntityCoords(PlayerPedId())
        local found = nil
        for _, z in ipairs(zones) do
            if c.z >= (z.minZ or -200) and c.z <= (z.maxZ or 1000) and inside(z.points, c.x, c.y) then found = z.name break end
        end
        if found ~= current then
            local prev = current
            current = found
            LocalPlayer.state:set('w_zone', found, true)
            TriggerEvent('w_connector:zone', found, prev)
        end
    end
end)

-- Outlines of the zones marked debug, near the player.
CreateThread(function()
    while true do
        local any = false
        local c = GetEntityCoords(PlayerPedId())
        for _, z in ipairs(zones) do
            if z.debug then
                local p1 = z.points[1]
                if p1 and #(vector2(p1.x, p1.y) - vector2(c.x, c.y)) < 300.0 then
                    any = true
                    local lo, hi = (z.minZ or c.z - 5) + 0.0, math.min(z.maxZ or c.z + 30, c.z + 30) + 0.0
                    for i = 1, #z.points do
                        local a, b = z.points[i], z.points[i % #z.points + 1]
                        DrawLine(a.x, a.y, math.max(lo, c.z - 5), b.x, b.y, math.max(lo, c.z - 5), 16, 185, 129, 220)
                        DrawLine(a.x, a.y, hi, b.x, b.y, hi, 16, 185, 129, 220)
                        DrawLine(a.x, a.y, math.max(lo, c.z - 5), a.x, a.y, hi, 16, 185, 129, 160)
                    end
                end
            end
        end
        Wait(any and 0 or 1000)
    end
end)
