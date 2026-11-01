--- ox_inventory, on FiveM and in its RedM fork (verified against ox_inventory 2.48.1 and the Black Panther
--- RedM fork 2.0.0: modules/inventory/server.lua, modules/items/server.lua).
---
--- All calls return their answer. A player's inventory is addressed by their server id. Wraith's
--- w_inventory keeps these signatures but has its own adapter.

local function inv()
    return exports.ox_inventory
end

local Ox = {}

function Ox.detect()
    if WC.started('w_inventory') or not WC.started('ox_inventory') then return false end
    return true, WC.version('ox_inventory')
end

function Ox.items(src)
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

function Ox.add(src, name, count, metadata)
    local ok, resp = inv():AddItem(src, name, count, metadata)
    if not ok then return false, type(resp) == 'string' and resp or 'refused' end
    return true
end

function Ox.remove(src, name, count)
    local ok, resp = inv():RemoveItem(src, name, count)
    if not ok then return false, type(resp) == 'string' and resp or 'refused' end
    return true
end

function Ox.canCarry(src, name, count)
    return inv():CanCarryItem(src, name, count) == true
end

function Ox.catalog()
    local out = {}
    for name, def in pairs(inv():Items() or {}) do
        out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
    end
    return out
end

-- Emptying (modules/inventory/server.lua Inventory.Clear, exported as ClearInventory). Weapons are items here.
function Ox.clear(src)
    inv():ClearInventory(src)
    return true
end

function Ox.openPlayer(actor, target)
    local result = inv():forceOpenInventory(actor, 'player', target)
    return result ~= nil and result ~= false
end

WC.Adapters.register('inventory', 'ox_inventory', Ox)
