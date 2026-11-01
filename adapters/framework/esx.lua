--- ESX (verified against es_extended 1.16.3: shared/main.lua, server/modules/player/lookup.lua,
--- server/classes/player/{base,accounts,job}.lua, shared/config/main.lua).
---
--- Accounts are named `money` (cash), `bank` and `black_money`. `getName()` is "first last" when
--- esx_identity filled the columns, the FiveM name otherwise. ESX has no gangs.

local function esx()
    return exports.es_extended:getSharedObject()
end

local function xPlayer(src)
    return esx().GetPlayerFromId(src)
end

local KIND = { money = 'cash', bank = 'bank' }

local Esx = {}

function Esx.detect()
    if not WC.started('es_extended') then return false end
    return true, WC.version('es_extended')
end

--- From a connected player's own account list when one is online, so custom accounts show too.
function Esx.accounts(src)
    local x = src and xPlayer(src)
    local list = x and x.getAccounts() or { { name = 'money', label = 'Cash' }, { name = 'bank', label = 'Bank' }, { name = 'black_money', label = 'Dirty money' } }
    local out = {}
    for _, a in ipairs(list) do
        out[#out + 1] = { id = a.name, label = a.label or a.name, kind = KIND[a.name] or 'other' }
    end
    return out
end

function Esx.player(src)
    local x = xPlayer(src)
    if not x then return nil end
    local job = x.getJob() or {}
    return {
        charId = tostring(x.getIdentifier()),
        charName = x.getName(),
        job = { name = job.name, label = job.label, grade = tonumber(job.grade) or 0 },
        gang = nil,
        money = x.getAccounts(true),
    }
end

function Esx.addMoney(src, account, amount)
    local x = xPlayer(src)
    if not x then return false, 'no_character' end
    if not x.getAccount(account) then return false, 'unknown_account' end
    x.addAccountMoney(account, amount, 'wraith-panel')
    return true
end

function Esx.removeMoney(src, account, amount)
    local x = xPlayer(src)
    if not x then return false, 'no_character' end
    local acc = x.getAccount(account)
    if not acc then return false, 'unknown_account' end
    if (tonumber(acc.money) or 0) < amount then return false, 'insufficient_funds' end
    x.removeAccountMoney(account, amount, 'wraith-panel')
    return true
end

-- Phase 3b: jobs (es_extended modules/jobs/registry.lua:123, 152; player/job.lua:38). ESX has no gangs;
-- its character name and revive live in optional resources (esx_identity, esx_ambulancejob) not verified
-- here, so they are not offered.

function Esx.jobs()
    local out = {}
    for name, def in pairs(esx().GetJobs() or {}) do out[#out + 1] = { name = name, label = def.label or name } end
    return out
end

function Esx.setJob(src, job, grade)
    local x = xPlayer(src)
    if not x then return false, 'no_character' end
    if not esx().DoesJobExist(job, grade) then return false, 'unknown_job' end
    x.setJob(job, grade)
    return true
end


-- Offline: ESX has no API for it, only its users table (es_extended.sql; names from esx_identity).
local function esxRow(r)
    local acc = type(r.accounts) == 'string' and json.decode(r.accounts) or (r.accounts or {})
    return { charId = tostring(r.identifier), license = r.identifier,
        charName = ((r.firstname or '') .. ' ' .. (r.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
        job = { name = r.job, grade = tonumber(r.job_grade) or 0 }, money = acc }
end

function Esx.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT identifier, firstname, lastname, job, job_grade, accounts FROM users
        WHERE identifier = ? OR firstname LIKE ? OR lastname LIKE ? LIMIT 25]], { q, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = esxRow(r) end
    return out
end

function Esx.offline(charId)
    local r = MySQL.single.await('SELECT identifier, firstname, lastname, job, job_grade, accounts FROM users WHERE identifier = ?', { charId })
    return r and esxRow(r) or nil
end

-- Raw, framework-owned definitions for the shared admin UI.
function Esx.consoleCatalog()
    return { jobs = esx().GetJobs() }
end

WC.Adapters.register('framework', 'esx', Esx)
