--- qb-inventory 2.x, QBCore only (verified against qb-inventory 2.2.3 server/functions.lua).
---
--- A player's items live on the QBCore player as `PlayerData.items` (slot -> {name, label, amount, info}).
--- Item definitions are `QBCore.Shared.Items`.

local function qb()
    return exports['qb-core']:GetCoreObject()
end

local function inv()
    return exports['qb-inventory']
end

local QbInv = {}

function QbInv.detect()
    if not WC.started('qb-inventory') then return false end
    return true, WC.version('qb-inventory')
end

function QbInv.items(src)
    local p = qb().Functions.GetPlayer(src)
    if not p or not p.PlayerData then return nil, 'no_character' end
    local out = {}
    for _, it in pairs(p.PlayerData.items or {}) do
        if type(it) == 'table' and it.name then
            out[#out + 1] = { name = it.name, label = it.label or it.name, count = tonumber(it.amount) or 0, metadata = it.info }
        end
    end
    return out
end

function QbInv.add(src, name, count, metadata)
    if not inv():AddItem(src, name, count, false, metadata, 'wraith-panel') then return false, 'refused' end
    return true
end

function QbInv.remove(src, name, count)
    if not inv():RemoveItem(src, name, count, false, 'wraith-panel') then return false, 'refused' end
    return true
end

function QbInv.canCarry(src, name, count)
    return inv():CanAddItem(src, name, count) == true
end

function QbInv.catalog()
    local out = {}
    for name, def in pairs(qb().Shared.Items or {}) do
        out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
    end
    return out
end

-- Emptying (server/functions.lua:439 ClearInventory). Weapons are items here.
function QbInv.clear(src)
    inv():ClearInventory(src)
    return true
end

function QbInv.openPlayer(actor, target)
    local result = inv():OpenInventoryById(actor, target)
    -- Stock qb-inventory returns nil on both success and hook refusal.
    return result ~= false and (result ~= nil or Player(target).state.inv_busy == true)
end

WC.Adapters.register('inventory', 'qb_inventory', QbInv)
