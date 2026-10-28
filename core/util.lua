--- Small helpers every other file uses.

WC = WC or {}

local TIMEOUT = {}

--- Call an export that may answer by callback, by return value, or both, and get one answer.
---
--- VORP's inventory exports answer through `cb`; Wraith's w_inventory and VORP v2's `respond` helper
--- also RETURN the value; and a Lua callback handed to another resource arrives there as a callable
--- reference, so code on that side that tests `type(cb) == 'function'` never calls it (the Black
--- Panther ox_inventory fork still does this). So: ONE call — never a retry, a retried addItem gives
--- the item twice — and whichever channel answers first settles it. The timeout stops an export that
--- never answers from parking the caller forever.
---
--- Returns `value` or `nil, 'timeout'` / `nil, 'exception'`.
function WC.callBoth(timeoutMs, invoke)
    local p = promise.new()
    local settled = false
    local function settle(v)
        if settled then return end
        settled = true
        p:resolve(v)
    end

    local ok, direct = pcall(invoke, function(v) settle(v) end)
    if not ok then return nil, 'exception' end
    if direct ~= nil then settle(direct) end
    if not settled then
        SetTimeout(timeoutMs, function() settle(TIMEOUT) end)
    end

    local v = Citizen.Await(p)
    if v == TIMEOUT then return nil, 'timeout' end
    return v
end

function WC.started(resource)
    return GetResourceState(resource) == 'started'
end

function WC.version(resource)
    return GetResourceMetadata(resource, 'version', 0)
end

--- A connected player's server id, or nil. Accepts a number or a numeric string.
function WC.onlineSource(v)
    local src = math.tointeger(tonumber(v))
    if not src or src <= 0 then return nil end
    if GetPlayerName(src) == nil then return nil end
    return src
end

--- The identifiers FXServer itself knows, keyed by type (license, discord, steam, …). Same on both games.
function WC.identifiers(src)
    local out = {}
    for i = 0, GetNumPlayerIdentifiers(src) - 1 do
        local id = GetPlayerIdentifier(src, i)
        local kind = id and id:match('^([%w]+):')
        if kind and not out[kind] then out[kind] = id end
    end
    return out
end

--- Item names come from customers' item tables: letters, digits and _ - . only.
function WC.itemName(v)
    if type(v) ~= 'string' or #v == 0 or #v > 64 then return nil end
    if not v:match('^[%w_%-%.]+$') then return nil end
    return v
end

--- A positive whole count, capped.
function WC.count(v, max)
    local n = math.tointeger(tonumber(v))
    if not n or n <= 0 or n > (max or 1000000) then return nil end
    return n
end

function WC.log(msg, ...)
    print(('[w_connector] ' .. msg):format(...))
end
