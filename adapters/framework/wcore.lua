--- Wraith Core — w_core, Red River's own framework (verified against w_core 1.0.4 as it runs on Red
--- River: server/main.lua, functions.lua, player.lua, economy.lua; and w_centralbank server/ledger.lua).
---
--- w_core `provide`s rsg-core and vorp_core, so it is detected before both. Its player API follows the
--- RSG shape (Functions.GetPlayer, PlayerData.citizenid/charinfo/job/gang), but balances live in
--- w_centralbank: AddMoney/RemoveMoney go through `WCore.Economy.change`, which allows only cash, bank
--- and gold (bloodmoney is an alias of gold) and refuses everything while the bank is not ready. Jobs
--- carry an Arabic label (`label_ar`), passed on so the panel can show it.

local ACCOUNTS = {
    { id = 'cash', label = 'Cash', kind = 'cash' },
    { id = 'bank', label = 'Bank', kind = 'bank' },
    { id = 'gold', label = 'Gold', kind = 'other' },
}
local KNOWN = { cash = true, bank = true, gold = true }

local function core()
    return exports.w_core:GetCoreObject()
end

local function player(src)
    local p = core().Functions.GetPlayer(src)
    if not p or not p.PlayerData or not p.PlayerData.citizenid then return nil end
    return p
end

local function bankReady()
    return WC.started('w_centralbank') and exports.w_centralbank:IsReady() == true
end

local WCore = {}

function WCore.detect()
    if not WC.started('w_core') then return false end
    return true, WC.version('w_core')
end

function WCore.accounts()
    return ACCOUNTS
end

function WCore.player(src)
    local p = player(src)
    if not p then return nil end
    local d = p.PlayerData
    local ci = d.charinfo or {}
    local job, gang = d.job or {}, d.gang or {}
    local money = {}
    for _, a in ipairs(ACCOUNTS) do
        money[a.id] = tonumber(p.Functions.GetMoney(a.id)) or 0
    end
    return {
        charId = tostring(d.citizenid),
        charName = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
        job = { name = job.name, label = job.label, labelAr = job.label_ar, grade = tonumber(job.grade and job.grade.level) or 0 },
        gang = (gang.name and gang.name ~= 'none') and { name = gang.name, label = gang.label } or nil,
        money = money,
    }
end

function WCore.addMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not KNOWN[account] then return false, 'unknown_account' end
    if not bankReady() then return false, 'bank_not_ready' end
    if not p.Functions.AddMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

function WCore.removeMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not KNOWN[account] then return false, 'unknown_account' end
    if not bankReady() then return false, 'bank_not_ready' end
    if (tonumber(p.Functions.GetMoney(account)) or 0) < amount then return false, 'insufficient_funds' end
    if not p.Functions.RemoveMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

-- Phase 3b: jobs, gangs, name (w_core player.lua:231-306). w_core keeps its job list in a global (WJobs)
-- with no export to read it, so there is no jobs() here; SetJob still refuses an unknown job. Revive and
-- heal go through w_medic's events (client/main.lua:809, 978) while it runs.

function WCore.setJob(src, job, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetJob(job, grade) then return false, 'unknown_job' end
    return true
end

function WCore.setGang(src, gang, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetGang(gang, grade) then return false, 'unknown_gang' end
    return true
end

function WCore.setName(src, first, last)
    local p = player(src)
    if not p then return false, 'no_character' end
    local ci = p.PlayerData.charinfo or {}
    ci.firstname, ci.lastname = first, last
    p.Functions.SetPlayerData('charinfo', ci)
    return true
end

function WCore.canRevive() return WC.started('w_medic') end
function WCore.revive(src) TriggerClientEvent('hospital:client:Revive', src) return true end
function WCore.heal(src) TriggerClientEvent('hospital:client:adminHeal', src) return true end


-- Offline: the framework's own players table (citizenid, license, charinfo JSON, job JSON, money JSON —
-- the columns read on the staging databases fwtest_rsg / fwtest_wcore and in qbcore.sql).
local function rowOf(r)
    local ci = type(r.charinfo) == 'string' and json.decode(r.charinfo) or (r.charinfo or {})
    local job = type(r.job) == 'string' and json.decode(r.job) or (r.job or {})
    local money = type(r.money) == 'string' and json.decode(r.money) or (r.money or {})
    return { charId = tostring(r.citizenid), license = r.license, name = r.name,
        charName = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
        job = { name = job.name, label = job.label, grade = tonumber(job.grade and job.grade.level) or 0 }, money = money }
end

function WCore.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT citizenid, license, name, charinfo, job, money FROM players
        WHERE citizenid = ? OR license = ? OR name LIKE ? OR charinfo LIKE ? ORDER BY last_updated DESC LIMIT 25]], { q, q, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = rowOf(r) end
    return out
end

function WCore.offline(charId)
    local r = MySQL.single.await('SELECT citizenid, license, name, charinfo, job, money FROM players WHERE citizenid = ?', { charId })
    return r and rowOf(r) or nil
end

-- Offline money straight on the central bank's ledger (w_centralbank ledger.lua:183 AdjustPlayer).
function WCore.moneyOffline(charId, account, delta)
    if not KNOWN[account] then return false, 'unknown_account' end
    if not bankReady() then return false, 'bank_not_ready' end
    local ok, why = exports.w_centralbank:AdjustPlayer(charId, account, delta, 'wraith-panel (offline)')
    if not ok then return false, type(why) == 'string' and why or 'refused' end
    return true
end

WC.Adapters.register('framework', 'wcore', WCore)
