--- ESX's own inventory, used when ox_inventory is not running (verified against es_extended 1.16.3
--- server/classes/player/inventory.lua and server/modules/items/registry.lua).
---
--- With ox_inventory present ESX hands its inventory to ox, and the ox adapter is picked first.

local function esx()
    return exports.es_extended:getSharedObject()
end

local EsxInv = {}

function EsxInv.detect()
    if WC.started('ox_inventory') or not WC.started('es_extended') then return false end
    return true, 'es_extended ' .. (WC.version('es_extended') or '')
end

function EsxInv.items(src)
    local x = esx().GetPlayerFromId(src)
    if not x then return nil, 'no_character' end
    local out = {}
    for _, it in pairs(x.getInventory() or {}) do
        if type(it) == 'table' and it.name and (tonumber(it.count) or 0) > 0 then
            out[#out + 1] = { name = it.name, label = it.label or it.name, count = tonumber(it.count) or 0 }
        end
    end
    return out
end

function EsxInv.add(src, name, count)
    local x = esx().GetPlayerFromId(src)
    if not x then return false, 'no_character' end
    if not x.canCarryItem(name, count) then return false, 'cannot_carry' end
    x.addInventoryItem(name, count)
    return true
end

function EsxInv.remove(src, name, count)
    local x = esx().GetPlayerFromId(src)
    if not x then return false, 'no_character' end
    local have = x.getInventoryItem(name)
    if not have or (tonumber(have.count) or 0) < count then return false, 'not_enough_items' end
    x.removeInventoryItem(name, count)
    return true
end

function EsxInv.canCarry(src, name, count)
    local x = esx().GetPlayerFromId(src)
    return x ~= nil and x.canCarryItem(name, count) == true
end

function EsxInv.catalog()
    local out = {}
    for name, def in pairs(esx().GetItems() or {}) do
        out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
    end
    return out
end

-- Emptying, one item at a time: ESX's own inventory has no clear call.
function EsxInv.clear(src)
    local x = esx().GetPlayerFromId(src)
    if not x then return false, 'no_character' end
    for _, it in pairs(x.getInventory() or {}) do
        if type(it) == 'table' and it.name and (tonumber(it.count) or 0) > 0 then x.removeInventoryItem(it.name, it.count) end
    end
    return true
end

WC.Adapters.register('inventory', 'esx_builtin', EsxInv)
