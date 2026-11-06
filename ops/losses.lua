--- 2.6.0 (owner 2026-11-06): what a character lost, and giving it back.
---
---   losses.list     { charId, limit? }                       staff: items (w_inventory w_losses) + money
---                                                            (w_centralbank journal moves out of his accounts)
---   losses.restore  { charId, kind = 'item'|'money', id, idx? }   staff: give one row back, once
---   player.profile also carries `losses` (ops/profile.lua -> WC.Losses.forPlayer) without who took it.
---
--- The website checks the staff permission and writes its own audit before it queues a command; each
--- row can be given back once only (the inventory claims the row, the bank uses one request key).

WC = WC or {}
WC.Losses = WC.Losses or {}

local function started(name) return GetResourceState(name) == 'started' end
local function usable() return started('w_inventory') or started('w_centralbank') end

local function validCid(v)
    return type(v) == 'string' and v ~= '' and #v <= 64 and not v:find('[^%w_%-]')
end

local function text(v, max)
    if v == nil then return nil end
    v = tostring(v)
    return #v > max and v:sub(1, max) or v
end

local labels = {}
local function labelOf(name)
    if labels[name] ~= nil then return labels[name] or nil end
    local ok, item = pcall(function() return exports.w_inventory:Items(name) end)
    labels[name] = ok and type(item) == 'table' and type(item.label) == 'string' and item.label or false
    return labels[name] or nil
end

-- the character's server id while he is in play (the inventory knows every loaded bag)
local function onlineOf(cid)
    if not started('w_inventory') then return nil end
    local ok, src = pcall(function() return exports.w_inventory:SourceOfCitizen(cid) end)
    return ok and tonumber(src) or nil
end

--- A few readable facts of an item's metadata (never the whole table: it can be large).
local function metaFacts(m)
    if type(m) ~= 'table' then return nil end
    local out = {
        serial = text(m.serial or m.serie, 40),
        durability = tonumber(m.durability) and math.floor(tonumber(m.durability)) or nil,
        label = text(m.label, 60),
        stars = tonumber(m.stars),
    }
    return next(out) and out or nil
end

local function itemRows(cid, limit, beforeId, forPlayer)
    if not started('w_inventory') then return nil end
    local ok, rows = pcall(function() return exports.w_inventory:ListLosses(cid, limit, beforeId) end)
    if not ok or type(rows) ~= 'table' then return nil end
    local out = {}
    for _, r in ipairs(rows) do
        out[#out + 1] = {
            id = tonumber(r.id), item = text(r.item, 64), label = labelOf(r.item), count = tonumber(r.count),
            how = text(r.how, 32), place = text(r.place, 100),
            byName = not forPlayer and text(r.by_name, 100) or nil, byCid = not forPlayer and text(r.by_cid, 64) or nil,
            coords = not forPlayer and text(r.coords, 48) or nil,
            meta = metaFacts(r.metadata),
            at = tonumber(r.at), restoredAt = tonumber(r.restored_at), restoredBy = not forPlayer and text(r.restored_by, 100) or nil,
        }
    end
    return out
end

local function moneyRows(cid, limit, beforeId, forPlayer)
    if not started('w_centralbank') then return nil end
    local ok, rows = pcall(function() return exports.w_centralbank:PlayerOutflows(cid, limit, beforeId) end)
    if not ok or type(rows) ~= 'table' then return nil end
    local out = {}
    for _, r in ipairs(rows) do
        out[#out + 1] = {
            id = tonumber(r.id), idx = tonumber(r.idx), kind = text(r.kind, 8), amount = tonumber(r.amount),
            reason = text(r.reason, 120), at = tonumber(r.at), refunded = r.refunded == true,
            to = not forPlayer and text(r.to, 100) or nil, toCid = not forPlayer and text(r.toCid, 64) or nil,
            actor = not forPlayer and text(r.actor, 100) or nil,
        }
    end
    return out
end

--- player.profile: his own list, without who took it or where it went.
function WC.Losses.forPlayer(cid)
    if not validCid(cid) then return nil end
    return { items = itemRows(cid, 30, nil, true) or {}, money = moneyRows(cid, 30, nil, true) or {} }
end

WC.Ops.define('losses.list', usable, function(args)
    local cid = args.charId
    if not validCid(cid) then return false, 'invalid_args' end
    local limit = math.max(1, math.min(200, math.floor(tonumber(args.limit) or 100)))
    return true, {
        charId = cid,
        online = onlineOf(cid) ~= nil,
        items = itemRows(cid, limit, tonumber(args.beforeItem), false),
        money = moneyRows(cid, limit, tonumber(args.beforeMoney), false),
    }
end)

WC.Ops.define('losses.restore', usable, function(args, actor)
    local cid = args.charId
    local id = math.floor(tonumber(args.id) or 0)
    if not validCid(cid) or id < 1 then return false, 'invalid_args' end
    local by = text(type(actor) == 'table' and (('%s (%s)'):format(tostring(actor.name or '-'), tostring(actor.id or '-'))) or 'website', 100)
    if args.kind == 'item' then
        if not started('w_inventory') then return false, 'no_adapter' end
        -- the row must be this character's (the website names both); the inventory tells the player
        local ok, data = exports.w_inventory:RestoreLoss(id, by, cid)
        if not ok then return false, tostring(data or 'restore_failed') end
        return true, { kind = 'item', item = data.item, count = data.count }
    elseif args.kind == 'money' then
        if not started('w_centralbank') then return false, 'no_adapter' end
        local idx = math.floor(tonumber(args.idx) or 0)
        if idx < 1 then return false, 'invalid_args' end
        local ok, data = exports.w_centralbank:RefundOutflow(cid, id, idx, by)
        if not ok then return false, tostring(data or 'restore_failed') end
        local src = onlineOf(cid)
        if src then
            TriggerClientEvent('w_inventory:notify', src, { type = 'success', key = 'loss_refunded', args = { tostring(data.amount) } })
        end
        return true, { kind = 'money', amount = data.amount, account = data.kind }
    end
    return false, 'invalid_args'
end)
