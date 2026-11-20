--- Universal w_lib framework adapter — automatically supports any framework added to w_lib.
--- Registered after the built-in per-framework adapters (or forced via `set wraith_framework "wlib"`),
--- so any new RedM framework supported by w_lib works with w_connector without editing w_connector.

local ACCOUNTS = {
    { id = 'cash', label = 'Cash', kind = 'cash' },
    { id = 'bank', label = 'Bank', kind = 'bank' },
    { id = 'gold', label = 'Gold', kind = 'other' },
}
local KNOWN = { cash = true, bank = true, gold = true }

local WLib = {}

function WLib.detect()
    if not WC.started('w_lib') then return false end
    local ok, name = pcall(function() return exports.w_lib:FwName() end)
    if not ok or type(name) ~= 'string' or name == '' or name == 'none' then return false end
    return true, name .. ' (w_lib ' .. tostring(WC.version('w_lib') or '') .. ')'
end

function WLib.accounts()
    return ACCOUNTS
end

function WLib.player(src)
    local ok, d = pcall(function() return exports.w_lib:FwGetPlayerData(src) end)
    if not ok or type(d) ~= 'table' or not d.citizenid then return nil end
    local ci = type(d.charinfo) == 'table' and d.charinfo or {}
    local job = type(d.job) == 'table' and d.job or {}
    local gang = type(d.gang) == 'table' and d.gang or {}
    local meta = type(d.metadata) == 'table' and d.metadata or {}
    local okC, cash = pcall(function() return exports.w_lib:FwGetCurrency(src, 'cash') end)
    local okB, bank = pcall(function() return exports.w_lib:FwGetCurrency(src, 'bank') end)
    local okG, gold = pcall(function() return exports.w_lib:FwGetCurrency(src, 'gold') end)
    local jobGrade = type(job.grade) == 'table' and (tonumber(job.grade.level) or 0) or (tonumber(job.grade) or 0)
    return {
        charId = tostring(d.citizenid),
        charName = ((tostring(ci.firstname or '') .. ' ' .. tostring(ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')),
        job = { name = job.name, label = job.label, labelAr = job.label_ar, grade = jobGrade },
        gang = (gang.name and gang.name ~= 'none') and { name = gang.name, label = gang.label } or nil,
        money = {
            cash = okC and tonumber(cash) or 0,
            bank = okB and tonumber(bank) or 0,
            gold = okG and tonumber(gold) or 0,
        },
        status = {
            dead = meta.isdead == true or meta.inlaststand == true,
            needs = { hunger = meta.hunger, thirst = meta.thirst },
        },
    }
end

function WLib.addMoney(src, account, amount)
    if not KNOWN[account] then return false, 'unknown_account' end
    local okId, cid = pcall(function() return exports.w_lib:FwGetCharacterIdentifier(src) end)
    if not okId or not cid then return false, 'no_character' end
    local ok, done = pcall(function() return exports.w_lib:FwAddCurrency(src, account, amount, 'wraith-panel') end)
    if not ok or done == false then return false, 'refused' end
    return true
end

function WLib.removeMoney(src, account, amount)
    if not KNOWN[account] then return false, 'unknown_account' end
    local okId, cid = pcall(function() return exports.w_lib:FwGetCharacterIdentifier(src) end)
    if not okId or not cid then return false, 'no_character' end
    local okCur, cur = pcall(function() return exports.w_lib:FwGetCurrency(src, account) end)
    if not okCur or (tonumber(cur) or 0) < amount then return false, 'insufficient_funds' end
    local ok, done = pcall(function() return exports.w_lib:FwRemoveCurrency(src, account, amount, 'wraith-panel') end)
    if not ok or done == false then return false, 'refused' end
    return true
end

function WLib.setJob(src, job, grade)
    local ok, done = pcall(function() return exports.w_lib:FwSetJob(src, job, grade) end)
    if not ok or done == false then return false, 'unknown_job' end
    return true
end

function WLib.setGang(src, gang, grade)
    local ok, done = pcall(function() return exports.w_lib:FwSetGang(src, gang, grade) end)
    if not ok or done == false then return false, 'unknown_gang' end
    return true
end

function WLib.setName(src, first, last)
    local ok, done = pcall(function() return exports.w_lib:FwSetCharInfo(src, { firstname = first, lastname = last }) end)
    if not ok or done == false then return false, 'refused' end
    return true
end

function WLib.canRevive() return WC.started('w_medic') end
function WLib.revive(src) TriggerClientEvent('hospital:client:Revive', src) return true end
function WLib.heal(src) TriggerClientEvent('hospital:client:adminHeal', src) return true end

function WLib.setNeeds(src, needs)
    if needs.hunger then pcall(function() exports.w_lib:FwSetMetadata(src, 'hunger', needs.hunger) end) end
    if needs.thirst then pcall(function() exports.w_lib:FwSetMetadata(src, 'thirst', needs.thirst) end) end
    return true
end

function WLib.moneyOffline(charId, account, delta, reason)
    if not KNOWN[account] then return false, 'unknown_account' end
    local okR, ready = pcall(function() return exports.w_lib:EconIsReady() end)
    if not okR or not ready then return false, 'bank_not_ready' end
    local ok, done, why = pcall(function()
        return exports.w_lib:EconAdjustPlayer(charId, account, delta, type(reason) == 'string' and reason ~= '' and reason or 'wraith-panel (offline)')
    end)
    if not ok or not done then return false, type(why) == 'string' and why or 'refused' end
    return true
end

function WLib.consoleCatalog()
    local okJ, jobs = pcall(function() return exports.w_lib:FwGetSharedJobs() end)
    local okG, gangs = pcall(function() return exports.w_lib:FwGetSharedGangs() end)
    return {
        jobs = okJ and type(jobs) == 'table' and jobs or {},
        gangs = okG and type(gangs) == 'table' and gangs or {},
    }
end

WC.Adapters.register('framework', 'wlib', WLib)
