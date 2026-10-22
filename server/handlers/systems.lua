--- The game's systems from the website (2026-10-22, one admin system): each system's own admin board,
--- its DATA ops only (positions, polygons and placing stay in game, where the admin can see them).
---
--- A system opts in with one export in its own resource, SiteAdmin(op, args, by) (w_farming's livestock
--- part: lsSiteAdmin), that answers only w_connector and runs the board's own code as the console:
---   -> { ok = true, data = <anything>, read = true|nil } | { ok = false, error = '<reason key>' }
--- `read` marks an op that changed nothing (no log line). The economy part is answered here: the central
--- bank's ledger and the job / gang accounts (w_centralbank's exports; every change moves money to or
--- from the reserve, never out of nowhere).
---
--- Each system is its own permission node (system.<key>), checked here; the registry's own gate is the
--- panel's access node.

local SYSTEMS = {
    economy   = { node = 'system.economy', resource = 'w_centralbank', ['local'] = true },
    farms     = { node = 'system.farms', resource = 'w_farming' },
    livestock = { node = 'system.livestock', resource = 'w_farming', export = 'lsSiteAdmin' },
    heists    = { node = 'system.heists', resource = 'w_heists' },
    missions  = { node = 'system.missions', resource = 'w_missions' },
    jobs      = { node = 'system.jobs', resource = 'w_jobs' },
    tribes    = { node = 'system.tribes', resource = 'w_tribes' },
    kingdoms  = { node = 'system.kingdoms', resource = 'w_kingdoms' },
    stables   = { node = 'system.stables', resource = 'w_stables' },
    stores    = { node = 'system.stores', resource = 'w_store' },
    planes    = { node = 'system.planes', resource = 'w_planefly' },
    doors     = { node = 'system.doors', resource = 'w_doorlock' },
    pets      = { node = 'system.pets', resource = 'w_pets' },
    baloot    = { node = 'system.baloot', resource = 'w_baloot' },
    guard     = { node = 'system.guard', resource = 'w_guard' },
}

-- ── the economy (answered here) ───────────────────────────────────────────────────────────────────

local function bank() return GetResourceState('w_centralbank') == 'started' and exports.w_centralbank or nil end

--- A job's or a gang's account, as the ledger names it. Players' wallets are the players page's; the
--- reserve itself is the central bank's own (its president prints).
local function sharedAccount(id)
    id = tostring(id or '')
    return (id:match('^society:[%w_]+$') or id:match('^gang:[%w_]+$')) and id or nil
end

local ECONOMY = {}

function ECONOMY.overview()
    local cb = bank()
    if not cb then return { ok = false, error = 'not_supported_here' } end
    local ok, ready = pcall(function() return cb:IsReady() end)
    if not ok or not ready then return { ok = false, error = 'err_char_economy' } end
    local reserve = {}
    for _, id in ipairs({ 'central:reserve', 'central:gold' }) do
        local okB, bal = pcall(function() return cb:GetBalance(id) end)
        reserve[#reserve + 1] = { id = id, balance = okB and tonumber(bal) or nil }
    end
    local rows = MySQL.query.await([[SELECT id, owner, currency, balance FROM cb_accounts
        WHERE id LIKE 'society:%' OR id LIKE 'gang:%' ORDER BY id LIMIT 300]]) or {}
    local accounts = {}
    for _, r in ipairs(rows) do
        accounts[#accounts + 1] = { id = r.id, owner = r.owner, currency = r.currency, balance = (tonumber(r.balance) or 0) / 100 }
    end
    local banks = {}
    local okBanks, list = pcall(function() return cb:GetBanks() end)
    if okBanks and type(list) == 'table' then banks = list end
    return { ok = true, read = true, data = { reserve = reserve, accounts = accounts, banks = banks } }
end

--- { account = 'society:<job>' | 'gang:<gang>', delta = dollars (+ from the reserve, - back to it), reason }
function ECONOMY.adjust(args, by)
    local cb = bank()
    if not cb then return { ok = false, error = 'not_supported_here' } end
    local id = sharedAccount(args.account)
    if not id then return { ok = false, error = 'err_invalid_value' } end
    local delta = tonumber(args.delta)
    if not delta or delta ~= delta or delta == 0 or math.abs(delta) > 100000000 then return { ok = false, error = 'invalid_amount' } end
    delta = math.floor(delta * 100 + (delta >= 0 and 0.5 or -0.5)) / 100
    local reason = ('website %s: %s'):format(tostring(by or 'admin'), H.str(args.reason, 120))
    pcall(function() return cb:EnsureAccount(id, id:match(':(.+)$'), id:match('^(%w+):')) end)
    local okA, done, why = pcall(function() return cb:AdjustAccount(id, delta, reason) end)
    if not okA or not done then return { ok = false, error = (okA and why) or 'update_failed_account' } end
    return { ok = true, data = { account = id, delta = delta } }
end

local function economy(op, args, by)
    local fn = ECONOMY[op]
    if not fn then return { ok = false, error = 'unknown_action' } end
    return fn(type(args) == 'table' and args or {}, by)
end

-- ── the gateway ───────────────────────────────────────────────────────────────────────────────────

--- The systems this server runs and this staff member may open (the website's Systems tab lists them).
Registry.invoke('systemsList', 'access_admin_panel', function(actor)
    local out = {}
    for key, def in pairs(SYSTEMS) do
        if GetResourceState(def.resource) == 'started' and Perms.has(actor, def.node) then out[#out + 1] = key end
    end
    table.sort(out)
    return { systems = out }
end)

--- { system, op, args }: one op of one system's board.
Registry.invoke('systemAdmin', 'access_admin_panel', function(actor, args)
    args = type(args) == 'table' and args or {}
    local key = H.str(args.system, 32)
    local def = SYSTEMS[key]
    if not def then return H.fail('unknown_action') end
    if not Perms.has(actor, def.node) then return H.fail('no_permission') end
    if GetResourceState(def.resource) ~= 'started' then return H.fail('not_supported_here') end
    local op = H.str(args.op, 48)
    if op == '' then return H.fail('unknown_action') end
    local by = actor.label or 'Web Admin'

    local ok, res
    if def['local'] then
        ok, res = pcall(economy, op, args.args, by)
    else
        local name = def.export or 'SiteAdmin'
        ok, res = pcall(function() return exports[def.resource][name](exports[def.resource], op, args.args or {}, by) end)
    end
    if not ok or type(res) ~= 'table' then
        if not ok then print(('^1[w_connector] system %s %s failed: %s^0'):format(key, op, tostring(res))) end
        return H.fail('admin_console_error')
    end
    if not res.ok then
        local out = H.fail(res.error or 'admin_console_error')
        out.data = res.data
        return out
    end
    if not res.read then
        local detail = ''
        pcall(function() detail = json.encode(args.args or {}) end)
        Log.write(actor, 'admin_action', ('%s: %s'):format(key, op), detail:sub(1, 600))
    end
    return { success = true, data = res.data }
end)
