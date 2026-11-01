--- RSG core 2.x (verified against rsg-core 2.3.6: server/main.lua, server/functions.lua, server/player.lua,
--- config.lua).
---
--- Money goes through `Player.Functions.AddMoney/RemoveMoney/GetMoney`; the types are whatever
--- `RSGConfig.Money.MoneyTypes` lists (cash and bank by default). AddMoney answers false for an unknown
--- type and nil for a negative amount. Wraith Core provides rsg-core but has its own adapter.

local function core()
    return exports['rsg-core']:GetCoreObject()
end

local function player(src)
    local p = core().Functions.GetPlayer(src)
    if not p or not p.PlayerData or not p.PlayerData.citizenid then return nil end
    return p
end

local LABELS = { cash = 'Cash', bank = 'Bank', bloodmoney = 'Blood money' }

local Rsg = {}

function Rsg.detect()
    if WC.started('w_core') or not WC.started('rsg-core') then return false end
    return true, WC.version('rsg-core')
end

function Rsg.accounts()
    local cfg = core().Config
    local types = cfg and cfg.Money and cfg.Money.MoneyTypes or { cash = 0, bank = 0 }
    local names = {}
    for name in pairs(types) do names[#names + 1] = name end
    table.sort(names)
    local out = {}
    for _, name in ipairs(names) do
        out[#out + 1] = { id = name, label = LABELS[name] or name, kind = (name == 'cash' or name == 'bank') and name or 'other' }
    end
    return out
end

function Rsg.player(src)
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

function Rsg.addMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    if p.PlayerData.money[account] == nil then return false, 'unknown_account' end
    if not p.Functions.AddMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

function Rsg.removeMoney(src, account, amount)
    local p = player(src)
    if not p then return false, 'no_character' end
    local have = p.PlayerData.money[account]
    if have == nil then return false, 'unknown_account' end
    if (tonumber(have) or 0) < amount then return false, 'insufficient_funds' end
    if not p.Functions.RemoveMoney(account, amount, 'wraith-panel') then return false, 'refused' end
    return true
end

-- Phase 3b: jobs, gangs, name (rsg-core player.lua:183-266, shared/jobs.lua). Revive and heal go
-- through rsg-medic's admin events (rsg-medic client/client.lua:521, 594) while it runs.

function Rsg.jobs()
    local out = {}
    for name, def in pairs(core().Shared.Jobs or {}) do out[#out + 1] = { name = name, label = def.label or name } end
    return out
end

function Rsg.setJob(src, job, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetJob(job, grade) then return false, 'unknown_job' end
    return true
end

function Rsg.setGang(src, gang, grade)
    local p = player(src)
    if not p then return false, 'no_character' end
    if not p.Functions.SetGang(gang, grade) then return false, 'unknown_gang' end
    return true
end

function Rsg.setName(src, first, last)
    local p = player(src)
    if not p then return false, 'no_character' end
    local ci = p.PlayerData.charinfo or {}
    ci.firstname, ci.lastname = first, last
    p.Functions.SetPlayerData('charinfo', ci)
    return true
end

function Rsg.canRevive() return WC.started('rsg-medic') end
function Rsg.revive(src) TriggerClientEvent('rsg-medic:client:adminRevive', src) return true end
function Rsg.heal(src) TriggerClientEvent('rsg-medic:client:adminHeal', src) return true end


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

function Rsg.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT citizenid, license, name, charinfo, job, money FROM players
        WHERE citizenid = ? OR license = ? OR name LIKE ? OR charinfo LIKE ? ORDER BY last_updated DESC LIMIT 25]], { q, q, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = rowOf(r) end
    return out
end

function Rsg.offline(charId)
    local r = MySQL.single.await('SELECT citizenid, license, name, charinfo, job, money FROM players WHERE citizenid = ?', { charId })
    return r and rowOf(r) or nil
end

-- Raw, framework-owned definitions for the shared admin UI.
function Rsg.consoleCatalog()
    return { jobs = core().Shared.Jobs, gangs = core().Shared.Gangs, wagons = core().Shared.Vehicles }
end

WC.Adapters.register('framework', 'rsg', Rsg)
