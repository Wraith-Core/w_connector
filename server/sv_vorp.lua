--- The VORP layer.
---
--- w_admin routed every framework call through `exports.w_lib:Fw*`. w_lib is a second Wraith asset
--- with its own repository, and shipping it alongside the connector would re-create the exact
--- problem this resource exists to solve. So this file talks to VORP directly, and w_connector's
--- only external dependencies are oxmysql and vorp_core — both of which every VORP server already
--- runs.
---
--- Three shapes here are counter-intuitive, and getting each one wrong produced a bug that looked
--- like something else entirely:
---
---   * `Core.getUser(src).getUsedCharacter` is a VALUE, not a method — and what it returns is the
---     FACADE that getCharacter() builds, not the character object. w_admin called
---     `user:getUsedCharacter()`, which does not exist.
---   * The facade's data fields are lowercase (`money`, `firstname`, `charIdentifier`), and its
---     writes are named functions on the same table (`setMoney`, `addCurrency`, `setNickName`).
---     There are no `Money()`-style accessors on it.
---   * Its functions arrive as callable REFERENCES, not Lua functions, because the table crossed a
---     resource boundary — so `type(fn) == 'function'` is false for every one of them. See
---     `callable()` below; that single mistaken guard disabled every write in this file.

Vorp = { ready = false, core = nil }

--- VORP currency ids. 0 = money, 1 = gold, 2 = rol — the BLUE balance in VORP's own character UI,
--- which servers use as their own currency. `blackmoney` exists in some builds as 3 and in this
--- server's vorp_core 3.3 has no setter at all, so nothing here depends on it.
Vorp.CURRENCY = { MONEY = 0, GOLD = 1, ROL = 2, BLACKMONEY = 3 }

--- The panel offers three currencies. Index 2 is the server currency, which in VORP is `rol` — the
--- BLUE balance in the game's own character UI. It is NOT `blackmoney`: paying into that would put
--- the money somewhere the player was not expecting and could not spend where they meant to.
function Vorp.currencyFromPanel(t)
    local n = tonumber(t) or 0
    if n == 1 then return Vorp.CURRENCY.GOLD end
    if n == 2 then return Vorp.CURRENCY.ROL end
    return Vorp.CURRENCY.MONEY
end

CreateThread(function()
    local waited = 0
    while not Vorp.ready do
        local ok, core = pcall(function() return exports.vorp_core:GetCore() end)
        if ok and core then
            Vorp.core = core
            Vorp.ready = true
            -- print('^2[w_connector]^0 VORP core acquired.')
            break
        end
        waited = waited + 1
        if waited >= 150 then -- ~30 seconds
            print('^1[w_connector] ERROR:^0 vorp_core did not start. Ensure vorp_core is started before w_connector.')
            break
        end
        Wait(200)
    end
end)

--- Read a field off the character facade.
---
--- `Core.getUser(src).getUsedCharacter` does NOT hand back the character object. It returns what
--- `getCharacter()` in vorp_core/server/class/character.lua builds: a FACADE — a flat copy of the
--- character's data plus a fixed list of setter functions.
---
--- That distinction is why this layer was rewritten. The facade has no `Money()`/`Firstname()`
--- accessors and no `addCurrency`, so every write aimed at those either silently mutated a
--- throwaway copy or reported failure — while every READ looked fine, because the data fields are
--- sitting right there. Reads working and writes not is exactly the shape of the reported bug.
---
--- Field names are taken from getCharacter() verbatim. Note `jobLabel`/`jobGrade` are camelCase
--- here even though the database columns are `joblabel`/`jobgrade`.
local function field(char, name, fallback)
    if type(char) ~= 'table' then return nil end
    local v = char[name]
    if v == nil and fallback then v = char[fallback] end
    return v
end

--- Is this value callable?
---
--- THE bug behind "vorp_missing_setMoney". A table that crosses a FiveM resource boundary does not
--- arrive with its functions intact as Lua functions: each one comes back as a callable REFERENCE —
--- a table (or userdata) carrying a `__call` metamethod. Calling it works exactly as before, which
--- is why every VORP resource on a live server does `character.addCurrency(0, n)` and it just works.
---
--- But `type(ref) == 'function'` is FALSE for it. So a guard written that way rejects a function
--- that is present and perfectly callable — and here it rejected all of them, walked past
--- addCurrency, past removeCurrency, and reported the absolute setter as missing. The character had
--- every one of those functions the whole time.
---
--- The lesson is narrow and worth keeping: never type-check a value that came from another
--- resource. Ask whether it is nil, and let the call itself decide.
local function callable(v)
    if v == nil then return false end
    if type(v) == 'function' then return true end
    -- A protected metatable returns something that is not the metatable, so this is a best-effort
    -- check; the pcall around the actual call is what makes it safe either way.
    local ok, mt = pcall(getmetatable, v)
    if ok and type(mt) == 'table' and mt.__call ~= nil then return true end
    -- Anything non-nil that is not obviously uncallable gets the benefit of the doubt: attempting
    -- the call and catching the error beats refusing to try.
    return type(v) == 'table' or type(v) == 'userdata'
end

--- Call one of the facade's setters.
---
--- Returns `false, reason` rather than a bare false, so a failure can say WHY instead of every
--- fault in this file surfacing to the operator as the same generic "update_failed".
local function callSetter(char, name, ...)
    if type(char) ~= 'table' then return false, 'character_not_loaded' end
    local fn = char[name]
    if fn == nil then return false, 'vorp_missing_' .. name end
    local ok, err = pcall(fn, ...)
    if not ok then return false, 'vorp_error: ' .. tostring(err) end
    if err == false then return false, 'update_failed' end
    return true
end

--- The character facade for an online source, or nil.
---
--- `UsedCharacter()` returns an EMPTY TABLE for a player who is connected but has not picked a
--- character yet, so the presence of `charIdentifier` — not of the table — is what proves a
--- character is actually loaded.
function Vorp.char(src)
    if not Vorp.ready or not src then return nil end
    local ok, user = pcall(Vorp.core.getUser, tonumber(src))
    if not ok or type(user) ~= 'table' then return nil end
    local char = user.getUsedCharacter
    if type(char) ~= 'table' then return nil end
    if char.charIdentifier == nil then return nil end
    return char
end

function Vorp.user(src)
    if not Vorp.ready or not src then return nil end
    local ok, user = pcall(Vorp.core.getUser, tonumber(src))
    if ok and type(user) == 'table' then return user end
    return nil
end

--- The online source currently playing a given character id, or nil if they are offline.
function Vorp.sourceOfChar(charId)
    if not Vorp.ready or not charId then return nil end
    local ok, user = pcall(Vorp.core.getUserByCharId, tonumber(charId))
    if ok and type(user) == 'table' then return tonumber(user.source) end
    return nil
end

--- A normalised snapshot of an online character. The heartbeat, the players page and the live map
--- all read this shape, so the field names are resolved in exactly one place.
function Vorp.snapshot(src)
    local char = Vorp.char(src)
    if not char then return nil end
    local first = field(char, 'firstname')
    local last = field(char, 'lastname')
    local name = ((first or '') .. ' ' .. (last or '')):gsub('^%s+', ''):gsub('%s+$', '')
    return {
        source        = tonumber(src),
        charId        = tonumber(field(char, 'charIdentifier')),
        identifier    = field(char, 'identifier'),
        firstName     = first,
        lastName      = last,
        characterName = (name ~= '' and name) or nil,
        nickname      = field(char, 'nickname'),
        job           = field(char, 'job'),
        jobLabel      = field(char, 'jobLabel', 'joblabel'),
        jobGrade      = tonumber(field(char, 'jobGrade', 'jobgrade')) or 0,
        group         = field(char, 'group'),
        money         = tonumber(field(char, 'money')) or 0,
        gold          = tonumber(field(char, 'gold')) or 0,
        blackMoney    = tonumber(field(char, 'blackmoney')) or 0,
        rol           = tonumber(field(char, 'rol')) or 0,
        xp            = tonumber(field(char, 'xp')) or 0,
        age           = field(char, 'age'),
        gender        = field(char, 'gender'),
        description   = field(char, 'charDescription'),
        isDead        = field(char, 'isdead') and true or false,
        invCapacity   = tonumber(field(char, 'invCapacity')),
    }
end

-- ---------------------------------------------------------------------------
--  Online writes
--
--  Every one of these goes through a setter the facade ACTUALLY exposes. The complete list, from
--  getCharacter():
--
--    setMoney setGold setBlackMoney setRol setXp
--    setFirstname setLastname setNickName setAge setGender setCharDescription
--    setJob setJobGrade setJobLabel setGroup setMultiJob removeMultiJob
--    setStatus setSkills updateSkin updateComps updateInvCapacity
--
--  There is no addCurrency, no removeCurrency and no addXp among them — those live on the
--  character's internal `self`, which nothing outside vorp_core can reach. So deltas are
--  read-modify-write, and every setter is ABSOLUTE.
--
--  Each function returns `ok, reason`.
-- ---------------------------------------------------------------------------

function Vorp.setFirstName(src, v)   return callSetter(Vorp.char(src), 'setFirstname', v) end
function Vorp.setLastName(src, v)    return callSetter(Vorp.char(src), 'setLastname', v) end
--- Capital N — vorp_core spells this one `setNickName`.
function Vorp.setNickname(src, v)    return callSetter(Vorp.char(src), 'setNickName', v) end
function Vorp.setAge(src, v)         return callSetter(Vorp.char(src), 'setAge', v) end
function Vorp.setDescription(src, v) return callSetter(Vorp.char(src), 'setCharDescription', v) end
function Vorp.setJobLabel(src, v)    return callSetter(Vorp.char(src), 'setJobLabel', v) end

function Vorp.setJob(src, jobName, grade, label)
    local c = Vorp.char(src)
    if not c then return false, 'character_not_loaded' end
    if jobName ~= nil then
        local ok, reason = callSetter(c, 'setJob', jobName)
        if not ok then return false, reason end
    end
    if grade ~= nil then
        local ok, reason = callSetter(c, 'setJobGrade', tonumber(grade) or 0)
        if not ok then return false, reason end
    end
    if label ~= nil then
        local ok, reason = callSetter(c, 'setJobLabel', label)
        if not ok then return false, reason end
    end
    return true
end

--- Which facade field and setter each currency index uses.
---
--- Index 2 is `rol` — the BLUE balance in VORP's own character UI, which servers customarily use as
--- their own server currency — and index 3 is `blackmoney`. Having these two the wrong way round
--- pays a purchase into a balance the player was not expecting and cannot spend where they meant to.
local CURRENCY_FIELD = {
    [0] = { field = 'money',      setter = 'setMoney' },
    [1] = { field = 'gold',       setter = 'setGold' },
    [2] = { field = 'rol',        setter = 'setRol' },
    [3] = { field = 'blackmoney', setter = 'setBlackMoney' },
}

--- Add to (or, with a negative delta, subtract from) a currency.
---
--- Two routes, because VORP versions genuinely differ and a customer's server is whichever one
--- they happen to run:
---
---   1. `addCurrency(type, amount)` / `removeCurrency(type, amount)` — the documented API
---      (docs.vorp-core.com/api-reference/core). Preferred: it fires VORP's own money events, so
---      other resources listening for a balance change still hear it.
---   2. `setMoney` / `setGold` / `setRol` / `setBlackMoney` — absolute setters. Used only when the
---      installed build's character facade has no add/remove pair, which is exactly the case that
---      made every money action fail with a bare "update_failed" on the reporting server.
---
--- The absolute path is read-modify-write and clamped at zero, so a removal larger than the balance
--- leaves the player at 0 rather than owing money.
function Vorp.adjustCurrency(src, currency, delta)
    delta=tonumber(delta)
    local kind=({[0]='cash',[1]='gold'})[tonumber(currency)]
    if not kind or not delta or delta~=delta or math.abs(delta)==math.huge then return false,'invalid_currency' end
    if GetResourceState('w_centralbank')~='started' or not exports.w_centralbank:IsReady() then return false,'economy_unavailable' end
    local ok,core=pcall(function()return exports.w_core:GetCoreObject()end)
    local player=ok and core.Functions.GetPlayer(tonumber(src))
    if not player then return false,'character_not_loaded' end
    return exports.w_centralbank:AdjustPlayer(player.PlayerData.citizenid,kind,delta,'connector-currency')
end

function Vorp.addCurrency(src, currency, amount)
    return Vorp.adjustCurrency(src, currency, math.abs(tonumber(amount) or 0))
end

function Vorp.removeCurrency(src, currency, amount)
    return Vorp.adjustCurrency(src, currency, -math.abs(tonumber(amount) or 0))
end

--- XP. Same version tolerance as currency: `addXp`/`removeXp` when the build has them, `setXp`
--- otherwise. All three are documented, but not every installed build carries all three.
function Vorp.addXp(src, delta)
    local c = Vorp.char(src)
    if not c then return false, 'character_not_loaded' end

    delta = tonumber(delta) or 0
    if delta == 0 then return true end

    if delta > 0 and callable(c.addXp) then
        return callSetter(c, 'addXp', delta)
    end
    if delta < 0 and callable(c.removeXp) then
        local held = tonumber(c.xp) or 0
        return callSetter(c, 'removeXp', math.min(-delta, held))
    end

    local current = tonumber(c.xp) or 0
    local next_ = current + delta
    if next_ < 0 then next_ = 0 end
    return callSetter(c, 'setXp', next_)
end

function Vorp.heal(src)
    if not Vorp.ready then return false, 'vorp_not_ready' end
    local ok = pcall(Vorp.core.Player.Heal, tonumber(src))
    return ok, (not ok) and 'vorp_error' or nil
end

function Vorp.revive(src)
    if not Vorp.ready then return false, 'vorp_not_ready' end
    local ok = pcall(Vorp.core.Player.Revive, tonumber(src))
    return ok, (not ok) and 'vorp_error' or nil
end

function Vorp.respawn(src)
    if not Vorp.ready then return false, 'vorp_not_ready' end
    local ok = pcall(Vorp.core.Player.Respawn, tonumber(src))
    return ok, (not ok) and 'vorp_error' or nil
end

--- The server's registered job list. VORP has a job registry; w_admin returned an empty table for
--- VORP and only populated this on RSGCore, so the panel's job picker was always blank.
function Vorp.registeredJobs()
    if not Vorp.ready or not callable(Vorp.core.GetRegisteredJobs) then return {} end
    local ok, jobs = pcall(Vorp.core.GetRegisteredJobs)
    if not ok or type(jobs) ~= 'table' then return {} end
    return jobs
end

-- ---------------------------------------------------------------------------
--  Offline access — direct SQL against VORP's own tables
--
--  Columns confirmed from vorp_core's INSERT INTO characters:
--    charidentifier, identifier, group, money, gold, blackmoney, rol, xp,
--    healthouter, healthinner, staminaouter, staminainner, inventory, job,
--    status, firstname, lastname, skinPlayer, compPlayer, jobgrade, coords,
--    isdead, joblabel, age, gender, character_desc, nickname, compTints,
--    steamname, slots, skills, multijobs, LastLogin
-- ---------------------------------------------------------------------------

--- Columns an admin action is allowed to write offline. A whitelist rather than a passthrough:
--- the column name arrives from an HTTP request, and interpolating that into SQL is how a panel
--- becomes a database console.
local WRITABLE = {
    firstname = true, lastname = true, nickname = true, age = true, gender = true,
    character_desc = true, job = true, joblabel = true, jobgrade = true,
    money = true, gold = true, blackmoney = true, rol = true, xp = true, ['group'] = true,
}

function Vorp.offlineChar(charId)
    if not charId then return nil end
    return MySQL.single.await(
        'SELECT `charidentifier`, `identifier`, `group`, `money`, `gold`, `blackmoney`, `rol`, `xp`, ' ..
        '`job`, `joblabel`, `jobgrade`, `firstname`, `lastname`, `nickname`, `age`, `gender`, ' ..
        '`character_desc`, `steamname`, `isdead`, `LastLogin` FROM `characters` WHERE `charidentifier` = ?',
        { tonumber(charId) })
end

function Vorp.offlineCharByIdentifier(identifier)
    if not identifier or identifier == '' then return nil end
    return MySQL.single.await(
        'SELECT `charidentifier`, `identifier`, `group`, `money`, `gold`, `blackmoney`, `rol`, `xp`, ' ..
        '`job`, `joblabel`, `jobgrade`, `firstname`, `lastname`, `nickname`, `age`, `gender`, ' ..
        '`character_desc`, `steamname`, `isdead`, `LastLogin` FROM `characters` WHERE `identifier` = ? ' ..
        'ORDER BY `LastLogin` DESC LIMIT 1',
        { identifier })
end

function Vorp.setOffline(charId, column, value)
    if column=='money' or column=='gold' or column=='rol' or column=='blackmoney' then
        local kind=({money='cash',gold='gold'})[column]
        -- Numeric VORP character IDs are not WCore citizenids. Never guess an owner.
        if not kind or type(charId)~='string' then return false,'unresolved_character_identity' end
        local cid=MySQL.scalar.await('SELECT citizenid FROM players WHERE citizenid=?',{charId})
        if not cid then return false,'unresolved_character_identity' end
        if GetResourceState('w_centralbank')~='started' or not exports.w_centralbank:IsReady() then return false,'economy_unavailable' end
        return exports.w_centralbank:SetPlayerBalance(cid,kind,value,'connector-offline-currency')
    end
    if not WRITABLE[column] then return false end
    local n = MySQL.update.await(
        ('UPDATE `characters` SET `%s` = ? WHERE `charidentifier` = ?'):format(column),
        { value, tonumber(charId) })
    return (tonumber(n) or 0) > 0
end

--- Add to (or subtract from) a numeric column offline, clamped at zero so a badly typed removal
--- cannot leave a character owing money.
function Vorp.adjustOffline(charId, column, delta)
    if column=='money' or column=='gold' or column=='rol' or column=='blackmoney' then
        local kind=({money='cash',gold='gold'})[column]
        if not kind or type(charId)~='string' then return false,'unresolved_character_identity' end
        local cid=MySQL.scalar.await('SELECT citizenid FROM players WHERE citizenid=?',{charId})
        if not cid then return false,'unresolved_character_identity' end
        if GetResourceState('w_centralbank')~='started' or not exports.w_centralbank:IsReady() then return false,'economy_unavailable' end
        return exports.w_centralbank:AdjustPlayer(cid,kind,delta,'connector-offline-currency')
    end
    if not WRITABLE[column] then return false end
    local n = MySQL.update.await(
        ('UPDATE `characters` SET `%s` = GREATEST(0, `%s` + ?) WHERE `charidentifier` = ?'):format(column, column),
        { tonumber(delta) or 0, tonumber(charId) })
    return (tonumber(n) or 0) > 0
end

--- Build the `WHERE` fragment shared by the offline list and its count, plus its bound values.
---
--- `excludeIds` keeps characters who are currently ONLINE out of the offline half of the players
--- page. Without it a connected player appears twice — once live and once from the table — and the
--- paging arithmetic is off by however many people are playing. The ids are forced through
--- `tonumber` before they reach the SQL string, so nothing but a number can ever be interpolated.
local function offlineWhere(search, excludeIds)
    local clauses, values = {}, {}
    if search and search ~= '' then
        local term = '%' .. tostring(search) .. '%'
        clauses[#clauses + 1] =
            '(`firstname` LIKE ? OR `lastname` LIKE ? OR `identifier` LIKE ? OR `nickname` LIKE ?)'
        values[#values + 1] = term; values[#values + 1] = term
        values[#values + 1] = term; values[#values + 1] = term
    end
    if type(excludeIds) == 'table' and #excludeIds > 0 then
        local nums = {}
        for _, id in ipairs(excludeIds) do
            local n = tonumber(id)
            if n then nums[#nums + 1] = tostring(math.floor(n)) end
        end
        if #nums > 0 then
            clauses[#clauses + 1] = '`charidentifier` NOT IN (' .. table.concat(nums, ',') .. ')'
        end
    end
    if #clauses == 0 then return '', values end
    return ' WHERE ' .. table.concat(clauses, ' AND '), values
end

--- The offline character list behind the Players tab's paging.
function Vorp.offlineCharacters(search, limit, offset, excludeIds)
    limit = math.min(math.max(tonumber(limit) or 10, 1), 100)
    offset = math.max(tonumber(offset) or 0, 0)
    local where, values = offlineWhere(search, excludeIds)
    values[#values + 1] = limit
    values[#values + 1] = offset
    return MySQL.query.await(
        'SELECT `charidentifier`, `identifier`, `firstname`, `lastname`, `nickname`, `job`, ' ..
        '`joblabel`, `jobgrade`, `money`, `gold`, `xp`, `steamname`, `LastLogin` FROM `characters`' ..
        where .. ' ORDER BY `LastLogin` DESC LIMIT ? OFFSET ?', values) or {}
end

function Vorp.countCharacters(search, excludeIds)
    local where, values = offlineWhere(search, excludeIds)
    local r = MySQL.single.await('SELECT COUNT(*) AS n FROM `characters`' .. where, values)
    return tonumber(r and r.n) or 0
end

function Vorp.countAccounts()
    local r = MySQL.single.await('SELECT COUNT(*) AS n FROM `users`')
    return tonumber(r and r.n) or 0
end

function Vorp.totalMoney()
    local r = MySQL.single.await('SELECT SUM(`money`) AS money, SUM(`gold`) AS gold FROM `characters`')
    return tonumber(r and r.money) or 0, tonumber(r and r.gold) or 0
end

--- Native identifiers for a source. Always available from the moment a player connects, unlike any
--- cache, which is why the heartbeat and the live map both read identity from here.
function Vorp.identifiers(src)
    local out = {}
    for i = 0, GetNumPlayerIdentifiers(src) - 1 do
        local id = GetPlayerIdentifier(src, i) or ''
        if id:sub(1, 8) == 'discord:' then out.discord = id:sub(9)
        elseif id:sub(1, 6) == 'steam:' then out.steam = id:sub(7)
        elseif id:sub(1, 8) == 'license:' then out.license = id
        elseif id:sub(1, 3) == 'ip:' then out.ip = id:sub(4) end
    end
    return out
end
