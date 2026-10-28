--- Gameplay modules (Phase 5): each Wraith system's admin board, through the export the system already
--- has — `SiteAdmin(op, args, by)` → `{ ok = true, data, read? } | { ok = false, error }` — the same
--- contract w_connector v1 uses (game/w_connector/server/handlers/systems.lua), so the systems work
--- unchanged. Which modules a server may use is decided by the website from the subscription; the
--- connector only reports which ones are running and calls them.
---
--- Other resources can join with `exports.w_connector:RegisterModule(id, version, resource, exportName)`.

local MODULES = {
    economy   = { resource = 'w_centralbank', builtin = true },
    farms     = { resource = 'w_farming' },
    livestock = { resource = 'w_farming', export = 'lsSiteAdmin' },
    heists    = { resource = 'w_heists' },
    missions  = { resource = 'w_missions' },
    jobs      = { resource = 'w_jobs' },
    tribes    = { resource = 'w_tribes' },
    kingdoms  = { resource = 'w_kingdoms' },
    stables   = { resource = 'w_stables' },
    stores    = { resource = 'w_store' },
    planes    = { resource = 'w_planefly' },
    doors     = { resource = 'w_doorlock' },
    pets      = { resource = 'w_pets' },
    baloot    = { resource = 'w_baloot' },
    guard     = { resource = 'w_guard' },
}

exports('RegisterModule', function(id, version, resource, exportName)
    if type(id) ~= 'string' or not id:match('^[a-z][a-z0-9_]*$') or #id > 32 then return false end
    if type(resource) ~= 'string' or resource == '' then return false end
    MODULES[id] = { resource = resource, export = type(exportName) == 'string' and exportName or nil, version = tostring(version or '1') }
    return true
end)

--- The modules running on this server, for hello.
function WC.modules()
    local out = {}
    for id, m in pairs(MODULES) do
        if WC.started(m.resource) then
            out[#out + 1] = { id = id, version = m.version or (WC.version(m.resource) or '1'):sub(1, 20) }
        end
    end
    table.sort(out, function(a, b) return a.id < b.id end)
    return out
end

-- ── The economy, answered here from w_centralbank's exports (ported from w_connector v1) ─────────
local function bank() return WC.started('w_centralbank') and exports.w_centralbank or nil end
local function sharedAccount(id)
    id = tostring(id or '')
    return (id:match('^society:[%w_]+$') or id:match('^gang:[%w_]+$')) and id or nil
end

local ECONOMY = {}

function ECONOMY.overview()
    local cb = bank()
    if not cb then return { ok = false, error = 'not_supported_here' } end
    local ok, ready = pcall(function() return cb:IsReady() end)
    if not ok or not ready then return { ok = false, error = 'bank_not_ready' } end
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

function ECONOMY.adjust(args, by)
    local id = sharedAccount(args.account)
    if not id then return { ok = false, error = 'invalid_args' } end
    local delta = tonumber(args.delta)
    if not delta or delta ~= delta or delta == 0 or math.abs(delta) > 100000000 then return { ok = false, error = 'invalid_args' } end
    local cb = bank()
    if not cb then return { ok = false, error = 'not_supported_here' } end
    delta = math.floor(delta * 100 + (delta >= 0 and 0.5 or -0.5)) / 100
    local reason = ('website %s: %s'):format(tostring(by or 'admin'), tostring(args.reason or ''):sub(1, 120))
    pcall(function() return cb:EnsureAccount(id, id:match(':(.+)$'), id:match('^(%w+):')) end)
    local okA, done, why = pcall(function() return cb:AdjustAccount(id, delta, reason) end)
    if not okA or not done then return { ok = false, error = (okA and why) or 'refused' } end
    return { ok = true, data = { account = id, delta = delta } }
end

-- ── The ops ────────────────────────────────────────────────────────────────────────────────────
WC.Ops.define('modules.list', nil, function()
    return true, WC.modules()
end)

--- { module, op, args } → `{ data, read }`. `read` says the op changed nothing (the website skips the audit).
WC.Ops.define('module.call', nil, function(args, actor)
    local id = type(args.module) == 'string' and args.module or ''
    local m = MODULES[id]
    if not m then return false, 'unknown_module' end
    if not WC.started(m.resource) then return false, 'module_not_running' end
    local op = type(args.op) == 'string' and args.op or ''
    if not op:match('^[%w_%.:%-]+$') or #op > 48 then return false, 'invalid_args' end
    local opArgs = type(args.args) == 'table' and args.args or {}
    local by = type(actor) == 'table' and actor.name or 'Web Admin'

    local ok, res
    if m.builtin then
        local fn = ECONOMY[op]
        if not fn then return false, 'unknown_action' end
        ok, res = pcall(fn, opArgs, by)
    else
        local name = m.export or 'SiteAdmin'
        ok, res = pcall(function() return exports[m.resource][name](exports[m.resource], op, opArgs, by) end)
    end
    if not ok or type(res) ~= 'table' then
        if not ok then WC.log('module %s %s failed: %s', id, op, tostring(res)) end
        return false, 'module_error'
    end
    -- The Wraith systems answer only the resource named w_connector (each SiteAdmin checks
    -- GetInvokingResource), which is why this resource ships under that name. If it is installed
    -- under another folder name, say so plainly instead of a bare 'forbidden'.
    if not res.ok then
        if res.error == 'forbidden' then return false, 'module_restricted' end
        return false, tostring(res.error or 'module_error'):sub(1, 60)
    end
    return true, { data = res.data, read = res.read == true }
end)
