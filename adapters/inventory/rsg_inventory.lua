--- rsg-inventory 2.x (verified against rsg-inventory 2.7.0 server/exports.lua).
---
--- A player's items live on the RSG player as `PlayerData.items` (slot -> {name, label, amount, info}).
--- `CanAddItem` answers `ok, 'weight'|'slots'`. Item definitions are `RSGCore.Shared.Items`.
--- Wraith's w_inventory provides the rsg-inventory name; it has its own adapter.

local function rsg()
    return exports['rsg-core']:GetCoreObject()
end

local function inv()
    return exports['rsg-inventory']
end

local RsgInv = {}

function RsgInv.detect()
    if WC.started('w_inventory') or not WC.started('rsg-inventory') then return false end
    return true, WC.version('rsg-inventory')
end

function RsgInv.items(src)
    local p = rsg().Functions.GetPlayer(src)
    if not p or not p.PlayerData then return nil, 'no_character' end
    local out = {}
    for _, it in pairs(p.PlayerData.items or {}) do
        if type(it) == 'table' and it.name then
            out[#out + 1] = { name = it.name, label = it.label or it.name, count = tonumber(it.amount) or 0, metadata = it.info }
        end
    end
    return out
end

function RsgInv.add(src, name, count, metadata)
    if not inv():AddItem(src, name, count, nil, metadata, 'wraith-panel') then return false, 'refused' end
    return true
end

function RsgInv.remove(src, name, count)
    if not inv():RemoveItem(src, name, count, nil, 'wraith-panel') then return false, 'refused' end
    return true
end

function RsgInv.canCarry(src, name, count)
    return inv():CanAddItem(src, name, count) == true
end

function RsgInv.catalog()
    local out = {}
    for name, def in pairs(rsg().Shared.Items or {}) do
        out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
    end
    return out
end

-- Emptying (server/exports.lua:362 ClearInventory). Weapons are items here.
function RsgInv.clear(src)
    inv():ClearInventory(src)
    return true
end

WC.Adapters.register('inventory', 'rsg_inventory', RsgInv)
