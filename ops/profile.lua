--- player.profile (2.5.0, owner 2026-11-05): what a player owns, for their own account page on the server's
--- website ("حسابي"): characters, money, level, VIP, bag, houses, horses, wagons, pets, planes, farms, tribe.
---
--- The website asks with the license of the Discord account that is signed in (it was matched from the
--- game's own identifiers, never typed), and shows the answer only to that account. Read-only: nothing here
--- writes. Every part is read on its own (pcall) and left out when its resource is not running, so one
--- missing script never hides the rest. Needs w_core as the framework (its `players` table).

local function wcore()
    local a = WC.Adapters.describe('framework')
    return a ~= nil and a.id == 'wcore' and WC.started('w_core')
end

local function decode(v)
    if type(v) == 'table' then return v end
    if type(v) ~= 'string' or v == '' then return {} end
    local ok, out = pcall(json.decode, v)
    return ok and type(out) == 'table' and out or {}
end

local function text(v, max)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    return v:sub(1, max or 80)
end

local function num(v) return tonumber(v) or 0 end

--- Run one part; a failure (missing table, changed export) leaves that part out instead of failing the op.
local function part(fn)
    local ok, out = pcall(fn)
    if ok then return out end
    return nil
end

local function query(sql, params)
    return MySQL.query.await(sql, params) or {}
end

local function charName(r)
    local ci = decode(r.charinfo)
    local n = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')
    return n ~= '' and n or (text(r.name) or tostring(r.citizenid))
end

--- An item's label in both languages (w_inventory keeps the sources in i18n, see modules/items/shared.lua).
local labels = {}
local function itemLabels(name, fallback)
    if labels[name] then return labels[name][1], labels[name][2] end
    local ar, en = fallback, fallback
    local def = part(function() return exports.w_inventory:Items(name) end)
    if type(def) == 'table' then
        local src = type(def.i18n) == 'table' and def.i18n or def
        if type(src.label) == 'table' then
            ar, en = src.label.ar or src.label.en or fallback, src.label.en or src.label.ar or fallback
        else
            ar = src.label_ar or src.label or def.label or fallback
            en = src.label_en or src.label or def.label or fallback
        end
    end
    labels[name] = { tostring(ar or name), tostring(en or name) }
    return labels[name][1], labels[name][2]
end

local function inventoryOf(cid)
    if not WC.started('w_inventory') then return nil end
    local items, weapons = exports.w_inventory:GetNativeOfflineInventory(cid)
    local merged, order = {}, {}
    local function add(row, kind)
        local name = WC.itemName(row.name)
        if not name then return end
        local count = math.max(1, math.floor(num(row.count or row.amount)))
        if not merged[name] then
            local ar, en = itemLabels(name, text(row.label, 60) or name)
            merged[name] = { name = name, labelAr = ar, labelEn = en, count = 0, weapon = kind == 'weapon' or nil }
            order[#order + 1] = name
        end
        merged[name].count = merged[name].count + count
    end
    for _, row in pairs(items or {}) do add(row, 'item') end
    for _, row in pairs(weapons or {}) do add(row, 'weapon') end
    local out = {}
    for _, name in ipairs(order) do out[#out + 1] = merged[name] end
    table.sort(out, function(a, b) return a.count > b.count end)
    local total = #out
    while #out > 120 do out[#out] = nil end
    return { items = out, kinds = total }
end

local function moneyOf(cid, fallback)
    local rows = part(function()
        return query('SELECT id, kind, balance FROM cb_accounts WHERE owner = ?', { cid })
    end)
    local m = { cash = num(fallback.cash), bank = num(fallback.bank), gold = num(fallback.gold), savings = 0 }
    if rows and #rows > 0 then
        for _, r in ipairs(rows) do
            local id, v = tostring(r.id or ''), num(r.balance) / 100
            if id:match(':cash$') then m.cash = v
            elseif id:match(':bank$') then m.bank = v
            elseif id:match(':gold$') then m.gold = v
            elseif r.kind == 'legacy_bank' then m.savings = m.savings + v end
        end
    end
    return m
end

local function housesOf(cid)
    if not WC.started('w_housing') then return nil end
    local owned = query([[SELECT id, label_ar, label_en, price_paid, price, locked, tax_due_at
        FROM w_housing_houses WHERE owner = ? AND deleted = 0 ORDER BY id]], { cid })
    local debt = {}
    for _, r in ipairs(part(function()
        return query("SELECT house_id, SUM(amount) AS due FROM w_housing_taxes WHERE owner = ? AND status = 'unpaid' GROUP BY house_id", { cid })
    end) or {}) do debt[tonumber(r.house_id)] = num(r.due) end
    local out = {}
    for _, r in ipairs(owned) do
        out[#out + 1] = {
            id = tonumber(r.id), labelAr = text(r.label_ar), labelEn = text(r.label_en),
            price = num(r.price_paid) > 0 and num(r.price_paid) or num(r.price),
            locked = r.locked == 1 or r.locked == true, taxDue = debt[tonumber(r.id)] or 0,
        }
    end
    local keys = part(function()
        local k = MySQL.scalar.await([[SELECT COUNT(*) FROM w_housing_keys k JOIN w_housing_houses h ON h.id = k.house_id
            WHERE k.citizenid = ? AND h.deleted = 0 AND (h.owner IS NULL OR h.owner <> ?)]], { cid, cid })
        return num(k)
    end) or 0
    return { owned = out, keys = keys }
end

local function stablesOf(cid)
    if not WC.started('w_stables') then return nil end
    local rows = query([[SELECT s.id, s.type, s.name, s.modelname, s.breed, s.sex, s.level, s.isDefault, s.is_dead,
            s.wagon_type, s.condition_pct
        FROM stables s WHERE BINARY s.charidentifier = ? AND s.owner_state = 'owned' ORDER BY s.isDefault DESC, s.id]], { cid })
    local rarity = {}
    part(function()
        for _, r in ipairs(query([[SELECT h.horse_id, h.rarity FROM w_stables_horses h JOIN stables s ON s.id = h.horse_id
            WHERE BINARY s.charidentifier = ?]], { cid })) do rarity[tonumber(r.horse_id)] = text(r.rarity, 20) end
    end)
    local horses, wagons = {}, {}
    for _, r in ipairs(rows) do
        local entry = {
            name = text(r.name, 40), model = text(r.modelname, 60),
            active = r.isDefault == 1 or r.isDefault == true or nil,
        }
        if r.type == 'wagon' then
            entry.kind = text(r.wagon_type, 30)
            entry.condition = r.condition_pct and math.floor(num(r.condition_pct)) or nil
            if #wagons < 40 then wagons[#wagons + 1] = entry end
        else
            entry.breed = text(r.breed, 40)
            entry.sex = text(r.sex, 10)
            entry.level = r.level and math.floor(num(r.level)) or nil
            entry.dead = (r.is_dead == 1 or r.is_dead == true) or nil
            entry.rarity = rarity[tonumber(r.id)]
            if #horses < 40 then horses[#horses + 1] = entry end
        end
    end
    return { horses = horses, wagons = wagons }
end

local function levelOf(license)
    if not WC.started('w_level') then return nil end
    local r = MySQL.single.await('SELECT level, xp, total_xp FROM player_levels WHERE identifier = ?', { license })
    if not r then return nil end
    return { level = math.floor(num(r.level)), xp = math.floor(num(r.xp)), total = math.floor(num(r.total_xp)) }
end

local function vipOf(cid)
    if not WC.started('w_vip') then return nil end
    local tier = exports.w_vip:TierOfCitizen(cid)
    if type(tier) == 'table' then tier = tier.key or tier.name or tier.tier end
    if tier == nil or tier == 0 or tier == false then return nil end
    return text(tostring(tier), 20)
end

local function petsOf(cid)
    if not WC.started('w_pets') then return nil end
    local out = {}
    for _, r in ipairs(query('SELECT name, model FROM w_pets WHERE citizenid = ? LIMIT 20', { cid })) do
        out[#out + 1] = { name = text(r.name, 40), model = text(r.model, 60) }
    end
    return out
end

local function planesOf(cid)
    if not WC.started('w_planefly') then return nil end
    local out = {}
    for _, r in ipairs(query('SELECT name, plane FROM w_planefly WHERE citizenid = ? LIMIT 20', { cid })) do
        out[#out + 1] = { name = text(r.name, 40), model = text(r.plane, 40) }
    end
    return out
end

local function farmsOf(cid)
    if not WC.started('w_farming') then return nil end
    local leases = part(function()
        return num(MySQL.scalar.await("SELECT COUNT(*) FROM w_farming_leases WHERE cid = ? AND status = 'active'", { cid }))
    end) or 0
    local barns = {}
    for _, r in ipairs(part(function() return query('SELECT name FROM w_livestock_barns WHERE owner_cid = ? LIMIT 20', { cid }) end) or {}) do
        barns[#barns + 1] = text(r.name, 60) or '—'
    end
    if leases == 0 and #barns == 0 then return nil end
    return { plots = leases, barns = barns }
end

local function tribeOf(cid)
    if not WC.started('w_tribes') then return nil end
    local r = MySQL.single.await([[SELECT t.label, t.level, m.rank FROM tribe_members m JOIN tribes t ON t.id = m.tribe_id
        WHERE m.citizenid = ?]], { cid })
    if not r then return nil end
    return { label = text(r.label, 60), level = r.level and math.floor(num(r.level)) or nil, rank = text(tostring(r.rank or ''), 30) }
end

local function kingdomOf(cid)
    if not WC.started('w_kingdoms') then return nil end
    local r = MySQL.single.await([[SELECT k.name, k.name_en, o.office FROM w_kingdoms_offices o JOIN w_kingdoms k ON k.id = o.kingdom_id
        WHERE o.cid = ?]], { cid })
    if not r then return nil end
    return { name = text(r.name, 60), nameEn = text(r.name_en, 60), office = text(r.office, 30) }
end

WC.Ops.define('player.profile', wcore, function(args)
    local license = type(args.license) == 'string' and args.license or ''
    if not license:match('^license2?:[a-f0-9]+$') or #license > 80 then return false, 'invalid_args' end
    local chars = query([[SELECT citizenid, cid, license, name, charinfo, job, money, last_updated
        FROM players WHERE license = ? ORDER BY last_updated DESC LIMIT 10]], { license })
    if #chars == 0 then return false, 'not_found' end

    local wanted = type(args.charId) == 'string' and args.charId or nil
    local row = chars[1]
    local list = {}
    for _, r in ipairs(chars) do
        list[#list + 1] = { charId = tostring(r.citizenid), name = charName(r), slot = tonumber(r.cid), lastPlayed = r.last_updated }
        if wanted and tostring(r.citizenid) == wanted then row = r end
    end
    local cid = tostring(row.citizenid)
    local job = decode(row.job)
    local ci = decode(row.charinfo)

    return true, {
        characters = list,
        charId = cid,
        character = {
            name = charName(row),
            gender = ci.gender, birthdate = text(ci.birthdate, 20), nationality = text(ci.nationality, 40),
            job = job.name and {
                name = text(job.name, 40), label = text(job.label, 60), labelAr = text(job.label_ar, 60),
                grade = math.floor(num(job.grade and job.grade.level)), gradeName = text(job.grade and job.grade.name, 40),
                boss = job.isboss == true or nil,
            } or nil,
            lastPlayed = row.last_updated,
        },
        money = moneyOf(cid, decode(row.money)),
        level = part(function() return levelOf(license) end),
        vip = part(function() return vipOf(cid) end),
        inventory = part(function() return inventoryOf(cid) end),
        houses = part(function() return housesOf(cid) end),
        stables = part(function() return stablesOf(cid) end),
        pets = part(function() return petsOf(cid) end),
        planes = part(function() return planesOf(cid) end),
        farms = part(function() return farmsOf(cid) end),
        tribe = part(function() return tribeOf(cid) end),
        kingdom = part(function() return kingdomOf(cid) end),
    }
end)
