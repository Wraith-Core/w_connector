--- Wraith inventory — w_inventory, Red River's own (verified against w_inventory 2.0.2:
--- modules/inventory/server.lua, modules/items/server.lua).
---
--- It keeps ox_inventory's server signatures and answers by return value. It `provide`s
--- vorp_inventory, rsg-inventory and qbr-inventory, so it is detected before all of them.

local function inv()
    return exports.w_inventory
end

local WInv = {}

function WInv.detect()
    if not WC.started('w_inventory') then return false end
    return true, WC.version('w_inventory')
end

function WInv.items(src)
    local slots = inv():GetInventoryItems(src)
    if slots == nil then return nil, 'no_character' end
    local out = {}
    for _, it in pairs(slots) do
        if type(it) == 'table' and it.name then
            out[#out + 1] = { name = it.name, label = it.label or it.name, count = tonumber(it.count) or 0, metadata = it.metadata }
        end
    end
    return out
end

function WInv.add(src, name, count, metadata)
    local ok, resp = inv():AddItem(src, name, count, metadata)
    if not ok then return false, type(resp) == 'string' and resp or 'refused' end
    return true
end

function WInv.remove(src, name, count)
    local ok, resp = inv():RemoveItem(src, name, count)
    if not ok then return false, type(resp) == 'string' and resp or 'refused' end
    return true
end

function WInv.canCarry(src, name, count)
    return inv():CanCarryItem(src, name, count) == true
end

function WInv.catalog()
    local out = {}
    for name, def in pairs(inv():Items() or {}) do
        out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
    end
    return out
end

-- Emptying (modules/inventory/server.lua Inventory.Clear, exported as ClearInventory). Weapons are items here.
function WInv.clear(src)
    inv():ClearInventory(src)
    return true
end

WC.Adapters.register('inventory', 'w_inventory', WInv)
