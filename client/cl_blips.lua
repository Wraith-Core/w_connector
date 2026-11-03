--- 2.4.0: the console's map blips (ops/native_blips.lua) on the game's own map, for every player, RedM only.
--- The list arrives in GlobalState['w_connector:blips'] (on join and on every change); each change rebuilds
--- every blip, because RDR3 has no native to take a modifier (the colour) back off a blip.
--- While w_map runs it owns the map and its blips (/mapedit): ours are taken off and come back when it stops.
---
--- Natives (alloc8or/rdr3-nativedb-data, namespace MAP; the same calls w_lib, w_crafting and w_marketplace use):
---   BLIP_ADD_FOR_COORDS 0x554D9D53F696D002 (blipHash, x, y, z) -> Blip   blipHash 1664425300, every coord blip of ours
---   SET_BLIP_SPRITE     0x74F74D3207ED525C (blip, hash, p2)
---   SET_BLIP_SCALE      0xD38744167B2FA257 (blip, scale)
---   BLIP_ADD_MODIFIER   0x662D364ABF16DE2F (blip, modifierHash) -> BOOL      BLIP_MODIFIER_MP_COLOR_1..32
---   _SET_BLIP_NAME      0x9CB1A1623062F402 (blip, name)             set last, after the modifiers (w_map's order)
---   REMOVE_BLIP         0xF2C3C9DA47AAA54A (Blip*) through RemoveBlip
if GetGameName() ~= 'redm' then return end

local KEY = 'w_connector:blips'
local STYLE = 1664425300
local drawn = {}

local function wmap() return GetResourceState('w_map') == 'started' end

local function clear()
    for _, b in ipairs(drawn) do if DoesBlipExist(b) then RemoveBlip(b) end end
    drawn = {}
end

local function draw(value)
    clear()
    if wmap() or type(value) ~= 'table' or type(value.list) ~= 'table' then return end
    for _, d in ipairs(value.list) do
        if type(d) == 'table' and tonumber(d.x) and tonumber(d.y) and type(d.sprite) == 'string' then
            local b = Citizen.InvokeNative(0x554D9D53F696D002, STYLE, d.x + 0.0, d.y + 0.0, (tonumber(d.z) or 0.0) + 0.0)
            if b and b ~= 0 then
                Citizen.InvokeNative(0x74F74D3207ED525C, b, joaat(d.sprite), true)
                Citizen.InvokeNative(0xD38744167B2FA257, b, (tonumber(d.scale) or 1.0) + 0.0)
                if type(d.color) == 'string' then Citizen.InvokeNative(0x662D364ABF16DE2F, b, joaat(d.color)) end
                Citizen.InvokeNative(0x9CB1A1623062F402, b, tostring(d.name or ''))
                drawn[#drawn + 1] = b
            end
        end
    end
end

AddStateBagChangeHandler(KEY, 'global', function(_, _, value)
    draw(value)
    -- an open blips page reads the list again (another admin changed it)
    if WMenu and WMenu.open and type(value) == 'table' then SendNUIMessage({ action = 'blipsRev', data = { rev = value.rev } }) end
end)
CreateThread(function() draw(GlobalState[KEY]) end)

AddEventHandler('onClientResourceStart', function(res)
    if res == 'w_map' then clear() end
end)
AddEventHandler('onClientResourceStop', function(res)
    if res == 'w_map' then SetTimeout(500, function() draw(GlobalState[KEY]) end) end
end)
AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() then clear() end
end)

-- The page's «موقعي» / «نقطة الطريق» buttons: the admin's own position or waypoint, read here and only
-- typed into the form; the save still goes through the server and the website.
RegisterNUICallback('blipsWhere', function(data, cb)
    if not WMenu or not WMenu.open then cb({ ok = false, errorKey = 'no_session' }); return end
    if type(data) == 'table' and data.what == 'waypoint' then
        if not IsWaypointActive() then cb({ ok = false, errorKey = 'err_no_waypoint' }); return end
        local c = GetWaypointCoords()
        local found, z = GetGroundZFor_3dCoord(c.x + 0.0, c.y + 0.0, 1000.0, false)
        cb({ ok = true, data = { x = c.x, y = c.y, z = found and z or nil } })
        return
    end
    local c = GetEntityCoords(PlayerPedId())
    cb({ ok = true, data = { x = c.x, y = c.y, z = c.z } })
end)
