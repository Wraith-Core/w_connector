--- Qbox (verified against qbx_core 1.24.0: server/functions.lua, server/player.lua, config/server.lua).
---
--- Qbox exports its API directly. Money goes through `exports.qbx_core:AddMoney/RemoveMoney/GetMoney`,
--- which validate the type and amount themselves; money types are cash, bank and crypto by default.
--- It `provide`s qb-core, so it is detected before the QBCore adapter.

local function qbx()
    return exports.qbx_core
end

local function player(src)
    local p = qbx():GetPlayer(src)
    if not p or not p.PlayerData or not p.PlayerData.citizenid then return nil end
    return p
end

local LABELS = { cash = 'Cash', bank = 'Bank', crypto = 'Crypto' }

local Qbox = {}

function Qbox.detect()
    if not WC.started('qbx_core') then return false end
    return true, WC.version('qbx_core')
end

function Qbox.accounts(src)
    local p = src and player(src)
    local money = p and p.PlayerData.money or { cash = 0, bank = 0, crypto = 0 }
    local names = {}
    for name in pairs(money) do names[#names + 1] = name end
    table.sort(names)
    local out = {}
    for _, name in ipairs(names) do
        out[#out + 1] = { id = name, label = LABELS[name] or name, kind = (name == 'cash' or name == 'bank') and name or 'other' }
    end
    return out
end

function Qbox.player(src)
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
        status = { dead = (d.metadata or {}).isdead == true or (d.metadata or {}).inlaststand == true,
            needs = { hunger = (d.metadata or {}).hunger, thirst = (d.metadata or {}).thirst } },
    }
end

function Qbox.addMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    if p.PlayerData.money[account] == nil then return false, 'unknown_account' end
    if not qbx():AddMoney(src, account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

function Qbox.removeMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    local have = p.PlayerData.money[account]
    if have == nil then return false, 'unknown_account' end
    if (tonumber(have) or 0) < amount then return false, 'insufficient_funds' end
    if not qbx():RemoveMoney(src, account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

-- Phase 3b: jobs and gangs through qbx_core's exports (groups.lua:325 GetJobs; player.lua:192 SetJob,
-- 433 SetGang). Revive belongs to qbx_medical, not verified here.

function Qbox.jobs()
    local out = {}
    for name, def in pairs(qbx():GetJobs() or {}) do out[#out + 1] = { name = name, label = def.label or name } end
    return out
end

function Qbox.setJob(src, job, grade)
    if not player(src) then return false, 'no_character' end
    if not qbx():SetJob(src, job, grade) then return false, 'unknown_job' end
    return true
end

function Qbox.setGang(src, gang, grade)
    if not player(src) then return false, 'no_character' end
    if not qbx():SetGang(src, gang, grade) then return false, 'unknown_gang' end
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

function Qbox.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT citizenid, license, name, charinfo, job, money FROM players
        WHERE citizenid = ? OR license = ? OR name LIKE ? OR charinfo LIKE ? ORDER BY last_updated DESC LIMIT 25]], { q, q, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = rowOf(r) end
    return out
end

function Qbox.offline(charId)
    local r = MySQL.single.await('SELECT citizenid, license, name, charinfo, job, money FROM players WHERE citizenid = ?', { charId })
    return r and rowOf(r) or nil
end

-- Offline money: qbx_core's money exports take a citizen id and work offline (player.lua:1320-1492).
function Qbox.moneyOffline(charId, account, delta)
    local ok = delta > 0 and qbx():AddMoney(charId, account, delta, 'wraith-panel (offline)') or qbx():RemoveMoney(charId, account, -delta, 'wraith-panel (offline)')
    if not ok then return false, 'refused' end
    return true
end

-- Raw, framework-owned definitions for the shared admin UI.
function Qbox.consoleCatalog()
    return { jobs = qbx():GetJobs(), gangs = qbx():GetGangs() }
end

WC.Adapters.register('framework', 'qbox', Qbox)
