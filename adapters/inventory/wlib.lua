--- Universal w_lib inventory adapter — automatically supports any inventory added to w_lib.
--- Registered after the built-in per-inventory adapters (or forced via `set wraith_inventory "wlib"`).

local WLibInv = {}

function WLibInv.detect()
    if not WC.started('w_lib') then return false end
    local ok, name = pcall(function() return exports.w_lib:InvName() end)
    if not ok or type(name) ~= 'string' or name == '' then return false end
    return true, name .. ' (w_lib)'
end

function WLibInv.items(src)
    local ok, slots = pcall(function() return exports.w_lib:InvGetItems(src) end)
    if not ok or slots == nil then return nil, 'no_character' end
    local out = {}
    for _, it in pairs(slots) do
        if type(it) == 'table' and it.name then
            out[#out + 1] = {
                name = it.name,
                label = it.label or it.name,
                count = tonumber(it.count or it.amount) or 0,
                metadata = it.metadata,
            }
        end
    end
    return out
end

function WLibInv.add(src, name, count, metadata)
    local ok, done, why = pcall(function() return exports.w_lib:InvAddItem(src, name, count, metadata) end)
    if not ok or done == false or done == nil then return false, type(why) == 'string' and why or 'refused' end
    return true
end

function WLibInv.remove(src, name, count)
    local ok, done, why = pcall(function() return exports.w_lib:InvRemoveItem(src, name, count) end)
    if not ok or done == false or done == nil then return false, type(why) == 'string' and why or 'refused' end
    return true
end

function WLibInv.canCarry(src, name, count)
    local ok, can = pcall(function() return exports.w_lib:InvCanCarry(src, name, count) end)
    return ok and can == true
end

function WLibInv.catalog()
    local ok, defs = pcall(function() return exports.w_lib:InvItems() end)
    if not ok or type(defs) ~= 'table' then return {} end
    local out = {}
    for name, def in pairs(defs) do
        if type(def) == 'table' then
            out[name] = { label = def.label or name, weight = tonumber(def.weight) or 0 }
        end
    end
    return out
end

function WLibInv.clear(src)
    local ok, done = pcall(function() return exports.w_lib:FwClearInventory(src) end)
    return ok and done ~= false
end

function WLibInv.openPlayer(actor, target)
    local ok, res = pcall(function() return exports.w_lib:InvOpenInventory(actor, 'player', target) end)
    return ok and res ~= nil and res ~= false
end

WC.Adapters.register('inventory', 'wlib', WLibInv)
