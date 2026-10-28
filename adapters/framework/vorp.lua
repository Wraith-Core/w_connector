--- VORP core 3.x (verified against vorp_core 3.3: server/apicontroller.lua, server/class/user.lua, character.lua).
---
--- `Core.getUser(src)` is keyed by the steam identifier and returns nil without one. Its
--- `getUsedCharacter` is a FIELD holding a snapshot, `{}` until a character is chosen — so a fresh call
--- is needed after every write. Currencies are numbered: 0 money, 1 gold, 2 rol. `removeCurrency` does
--- not stop at zero, so removals are clamped here.

local CURRENCY = { cash = 0, gold = 1, rol = 2 }
local FIELD = { cash = 'money', gold = 'gold', rol = 'rol' }

local function core()
    return exports.vorp_core:GetCore()
end

local function character(src)
    local user = core().getUser(src)
    local char = user and user.getUsedCharacter
    if type(char) ~= 'table' or char.charIdentifier == nil then return nil end
    return char
end

local Vorp = {}

function Vorp.detect()
    -- w_core provides vorp_core; it is spoken to through the RSG contract instead.
    if WC.started('w_core') or not WC.started('vorp_core') then return false end
    return true, WC.version('vorp_core')
end

function Vorp.accounts()
    return {
        { id = 'cash', label = 'Money', kind = 'cash' },
        { id = 'gold', label = 'Gold', kind = 'other' },
        { id = 'rol', label = 'Rol', kind = 'other' },
    }
end

function Vorp.player(src)
    local char = character(src)
    if not char then return nil end
    local name = ((char.firstname or '') .. ' ' .. (char.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')
    return {
        charId = tostring(char.charIdentifier),
        charName = name,
        job = { name = char.job, label = char.jobLabel, grade = tonumber(char.jobGrade) or 0 },
        gang = nil,
        money = { cash = tonumber(char.money) or 0, gold = tonumber(char.gold) or 0, rol = tonumber(char.rol) or 0 },
    }
end

function Vorp.addMoney(src, account, amount)
    local char = character(src)
    if not char then return false, 'no_character' end
    if not CURRENCY[account] then return false, 'unknown_account' end
    char.addCurrency(CURRENCY[account], amount)
    return true
end

function Vorp.removeMoney(src, account, amount)
    local char = character(src)
    if not char then return false, 'no_character' end
    if not CURRENCY[account] then return false, 'unknown_account' end
    local have = tonumber(char[FIELD[account]]) or 0
    if have < amount then return false, 'insufficient_funds' end
    char.removeCurrency(CURRENCY[account], amount)
    return true
end

-- Phase 3b: jobs, name, revive/heal (vorp_core 3.3 character.lua:580-644, apicontroller.lua:200-224, 277).

function Vorp.jobs()
    local out = {}
    for name, def in pairs(core().GetRegisteredJobs() or {}) do
        out[#out + 1] = { name = name, label = type(def) == 'table' and (def.label or def.joblabel) or name }
    end
    return out
end

function Vorp.setJob(src, job, grade)
    local char = character(src)
    if not char then return false, 'no_character' end
    char.setJob(job, true)
    char.setJobGrade(grade, true)
    return true
end

function Vorp.setName(src, first, last)
    local char = character(src)
    if not char then return false, 'no_character' end
    char.setFirstname(first)
    char.setLastname(last)
    return true
end

function Vorp.canRevive() return true end
function Vorp.revive(src) core().Player.Revive(src) return true end
function Vorp.heal(src) core().Player.Heal(src) return true end


-- Offline: VORP's characters table (columns read on the staging database fwtest_vorp).
local function vorpRow(r)
    return { charId = tostring(r.charidentifier), license = r.identifier, name = r.steamname,
        charName = ((r.firstname or '') .. ' ' .. (r.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
        job = { name = r.job, label = r.joblabel, grade = tonumber(r.jobgrade) or 0 },
        money = { cash = tonumber(r.money) or 0, gold = tonumber(r.gold) or 0, rol = tonumber(r.rol) or 0 } }
end

function Vorp.search(q)
    local like = '%' .. q .. '%'
    local rows = MySQL.query.await([[SELECT charidentifier, identifier, steamname, firstname, lastname, job, joblabel, jobgrade, money, gold, rol
        FROM characters WHERE charidentifier = ? OR identifier = ? OR firstname LIKE ? OR lastname LIKE ? OR steamname LIKE ? LIMIT 25]],
        { tonumber(q) or -1, q, like, like, like }) or {}
    local out = {}
    for _, r in ipairs(rows) do out[#out + 1] = vorpRow(r) end
    return out
end

function Vorp.offline(charId)
    local r = MySQL.single.await([[SELECT charidentifier, identifier, steamname, firstname, lastname, job, joblabel, jobgrade, money, gold, rol
        FROM characters WHERE charidentifier = ?]], { tonumber(charId) or -1 })
    return r and vorpRow(r) or nil
end

WC.Adapters.register('framework', 'vorp', Vorp)
