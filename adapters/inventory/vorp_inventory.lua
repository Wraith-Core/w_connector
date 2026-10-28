--- VORP inventory v2 (verified against vorp_inventory server/services/inventoryApiService.lua and
--- DbService.lua).
---
--- Every export takes a callback AND returns the answer (`respond(cb, result)`), and several block on
--- Citizen.Await internally — so each goes through WC.callBoth: one call, either channel, a timeout.
--- `subItem` with ANY non-nil metadata (even `{}`) takes the exact-metadata branch and cannot remove a
--- stack that carries metadata, so removals pass nil.

local TIMEOUT_MS = 5000

local function inv()
    return exports.vorp_inventory
end

local VorpInv = {}

function VorpInv.detect()
    -- w_inventory and ox_inventory both answer to the vorp_inventory name; they have their own adapter.
    if WC.started('w_inventory') or WC.started('ox_inventory') or not WC.started('vorp_inventory') then return false end
    return true, WC.version('vorp_inventory')
end

function VorpInv.items(src)
    local list, err = WC.callBoth(TIMEOUT_MS, function(cb) return inv():getUserInventoryItems(src, cb) end)
    if list == nil then return nil, err or 'no_character' end
    local out = {}
    for _, it in pairs(list) do
        if type(it) == 'table' and it.name then
            out[#out + 1] = { name = it.name, label = it.label or it.name, count = tonumber(it.count) or 0, metadata = it.metadata }
        end
    end
    return out
end

function VorpInv.add(src, name, count, metadata)
    local ok, err = WC.callBoth(TIMEOUT_MS, function(cb) return inv():addItem(src, name, count, metadata, cb) end)
    if ok ~= true then return false, err or 'refused' end
    return true
end

function VorpInv.remove(src, name, count)
    local ok, err = WC.callBoth(TIMEOUT_MS, function(cb) return inv():subItem(src, name, count, nil, cb) end)
    if ok ~= true then return false, err or 'refused' end
    return true
end

function VorpInv.canCarry(src, name, count)
    return WC.callBoth(TIMEOUT_MS, function(cb) return inv():canCarryItem(src, name, count, cb) end) == true
end

--- The `items` table (item, label, weight): VORP has no export for the whole list.
function VorpInv.catalog()
    if not MySQL then return {} end
    local rows = MySQL.query.await('SELECT item, label, weight FROM items') or {}
    local out = {}
    for _, r in ipairs(rows) do
        out[r.item] = { label = r.label or r.item, weight = tonumber(r.weight) or 0 }
    end
    return out
end

-- Emptying (inventoryApiService.lua:88 subAllItems, :844 subAllWeapons). VORP keeps weapons apart.
function VorpInv.clear(src, scope)
    if scope ~= 'weapons' then
        local ok, err = WC.callBoth(TIMEOUT_MS, function(cb) return inv():subAllItems(src, cb) end)
        if ok == nil and err then return false, err end
    end
    if scope ~= 'items' then
        local ok, err = WC.callBoth(TIMEOUT_MS, function(cb) return inv():subAllWeapons(src, cb) end)
        if ok == nil and err then return false, err end
    end
    return true
end

WC.Adapters.register('inventory', 'vorp_inventory', VorpInv)
