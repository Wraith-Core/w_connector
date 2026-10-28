--- Ops (what the website may ask for) and adapters (how this server's framework and inventory are spoken to).
---
--- The website authorises every command before it is queued; it never sends an op this server did not
--- declare in hello. The connector still refuses anything it doesn't know, validates every argument,
--- and never runs an op whose adapter is missing.

WC = WC or {}

local ops = {}       -- name -> { needs = 'framework'|'inventory'|function|nil, run = function(args, actor) }
local adapters = { framework = {}, inventory = {} } -- kind -> ordered list of { id, impl }
local active = { framework = nil, inventory = nil } -- kind -> { id, version, impl }

WC.Ops = {}

--- Register an op. `needs` names the adapter it can't work without, or is a function answering whether
--- the op can work on this server right now (a resource it relies on is running, an ACE is granted).
function WC.Ops.define(name, needs, run)
    assert(type(name) == 'string' and name:match('^[a-z]+%.[a-zA-Z]+$'), 'op names are domain.verb')
    assert(ops[name] == nil, 'op defined twice: ' .. name)
    ops[name] = { needs = needs, run = run }
end

local function usable(op)
    if op.needs == nil then return true end
    if type(op.needs) == 'function' then
        local ok, yes = pcall(op.needs)
        return ok and yes == true
    end
    return active[op.needs] ~= nil
end

--- The ops this server can actually perform, given which adapters were found. Sorted, for hello.
function WC.Ops.available()
    local out = {}
    for name, op in pairs(ops) do
        if usable(op) then out[#out + 1] = name end
    end
    table.sort(out)
    return out
end

--- Run one op. Returns `true, data` or `false, errorKey`.
function WC.Ops.run(name, args, actor)
    local op = ops[name]
    if not op then return false, 'unknown_op' end
    if not usable(op) then return false, type(op.needs) == 'function' and 'unavailable' or 'no_adapter' end
    local ok, a, b = pcall(op.run, type(args) == 'table' and args or {}, actor)
    if not ok then
        WC.log('op %s failed: %s', name, tostring(a))
        return false, 'exception'
    end
    return a, b
end

WC.Adapters = {}

--- Adapters register in detection order; the first whose detect() succeeds wins.
function WC.Adapters.register(kind, id, impl)
    local list = assert(adapters[kind], 'unknown adapter kind ' .. tostring(kind))
    list[#list + 1] = { id = id, impl = impl }
end

--- Pick this server's adapters. A convar (`wraith_framework` / `wraith_inventory`) names one outright.
function WC.Adapters.detect()
    for kind, list in pairs(adapters) do
        active[kind] = nil
        local forced = GetConvar('wraith_' .. kind, '')
        for _, entry in ipairs(list) do
            if forced == '' or forced == entry.id then
                local ok, found, version = pcall(entry.impl.detect)
                if ok and found then
                    active[kind] = { id = entry.id, version = version, impl = entry.impl }
                    break
                end
            end
        end
    end
    return active
end

function WC.Adapters.get(kind)
    local a = active[kind]
    return a and a.impl or nil
end

--- `{ id, version }` for hello, or nil when none was found.
function WC.Adapters.describe(kind)
    local a = active[kind]
    return a and { id = a.id, version = a.version } or nil
end
