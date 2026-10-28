--- QBCore (verified against qb-core 1.3.0: shared/main.lua, server/functions.lua, server/player.lua, config.lua).
---
--- The Player object is a class instance; its metatable does not survive being handed to another
--- resource, which is why qb-core generates `Player.Functions.X` wrappers. Those are what is called here.
--- Money types are `QBCore.Config.Money.MoneyTypes` (cash, bank, crypto by default).

local function qb()
    return exports['qb-core']:GetCoreObject()
end

local function player(src)
    local p = qb().Functions.GetPlayer(src)
    if not p or not p.PlayerData or not p.PlayerData.citizenid then return nil end
    return p
end

local LABELS = { cash = 'Cash', bank = 'Bank', crypto = 'Crypto' }

local function accountsFrom(money)
    local names = {}
    for name in pairs(money) do names[#names + 1] = name end
    table.sort(names)
    local out = {}
    for _, name in ipairs(names) do
        out[#out + 1] = { id = name, label = LABELS[name] or name, kind = (name == 'cash' or name == 'bank') and name or 'other' }
    end
    return out
end

local Qb = {}

function Qb.detect()
    -- Qbox provides qb-core; it has its own adapter.
    if WC.started('qbx_core') or not WC.started('qb-core') then return false end
    return true, WC.version('qb-core')
end

function Qb.accounts()
    local cfg = qb().Config
    return accountsFrom(cfg and cfg.Money and cfg.Money.MoneyTypes or { cash = 0, bank = 0, crypto = 0 })
end

function Qb.player(src)
    local p = player(src)
    if not p then return nil end
    local d = p.PlayerData
    local ci = d.charinfo or {}
    local job, gang = d.job or {}, d.gang or {}
    return {
        charId = tostring(d.citizenid),
        charName = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
        job = { name = job.name, label = job.label, grade = tonumber(job.grade and job.grade.level) or 0 },
        gang = (gang.name and gang.name ~= 'none') and { name = gang.name, label = gang.label } or nil,
        money = d.money or {},
    }
end

function Qb.addMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    if p.PlayerData.money[account] == nil then return false, 'unknown_account' end
    if not p.Functions.AddMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

function Qb.removeMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    local have = p.PlayerData.money[account]
    if have == nil then return false, 'unknown_account' end
    if (tonumber(have) or 0) < amount then return false, 'insufficient_funds' end
    if not p.Functions.RemoveMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

-- Phase 3b: jobs, gangs, name (qb-core player.lua:66, 97, 144; shared/jobs.lua). Revive belongs to
-- qb-ambulancejob, not verified here, so it is not offered.

function Qb.jobs()
    local out = {}
    for name, def in pairs(qb().Shared.Jobs or {}) do out[#out + 1] = { name = name, label = def.label or name } end
    return out
end

function Qb.setJob(src, job, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetJob(job, grade) then return false, 'unknown_job' end
    return true
end

function Qb.setGang(src, gang, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetGang(gang, grade) then return false, 'unknown_gang' end
    return true
end

function Qb.setName(src, first, last)
    local p = player(src)
    if not p then return false, 'no_character' end
    local ci = p.PlayerData.charinfo or {}
    ci.firstname, ci.lastname = first, last
    p.Functions.SetPlayerData('charinfo', ci)
    return true
end


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

function Qb.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT citizenid, license, name, charinfo, job, money FROM players
        WHERE citizenid = ? OR license = ? OR name LIKE ? OR charinfo LIKE ? ORDER BY last_updated DESC LIMIT 25]], { q, q, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = rowOf(r) end
    return out
end

function Qb.offline(charId)
    local r = MySQL.single.await('SELECT citizenid, license, name, charinfo, job, money FROM players WHERE citizenid = ?', { charId })
    return r and rowOf(r) or nil
end

WC.Adapters.register('framework', 'qbcore', Qb)
