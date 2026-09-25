-- Connector contract over w_lib. Website character IDs are players.id; game ownership
-- and inventory keys remain citizenid. No duplicate character database is created.
CoreBridge = {ready=false, CURRENCY={MONEY=0,GOLD=1,ROL=2}}
local api=exports.w_lib
local ids={}
local function isVorp() return api:FwName()=='vorp' end
-- ! CompatGetCore answers nil until a core has registered, so this indexed nil and threw for every
--   caller below it (snapshot, sourceOfChar, the bank branch, addXp) during the first seconds.
local function object(src)
    local core=api:CompatGetCore('wcore')
    if type(core)~='table' or type(core.Functions)~='table' then return nil end
    return core.Functions.GetPlayer(tonumber(src))
end
local function data(src) local p=object(src); return p and p.PlayerData end
local function charId(citizenid)
    if not citizenid then return nil end
    if isVorp() then return tonumber(citizenid) end
    if not ids[citizenid] then ids[citizenid]=w.database.scalar.await('SELECT id FROM players WHERE citizenid = ?', {citizenid}) end
    return tonumber(ids[citizenid])
end
-- The website's character id (players.id; VORP: charidentifier) of a citizen id, so a reference
-- that names the character by the id staff use (H.playerRef) lands on the key the handlers'
-- offline paths read.
function CoreBridge.charIdOf(citizenid)
    if citizenid==nil then return nil end
    return charId(tostring(citizenid))
end
-- A citizen id is handed on (vanity numbers) while players.id stays with its character: a cached
-- mapping left behind would report the next holder of the number to the website -- and credit
-- its playtime -- as the previous one. w_core fires this after a reassign (server-only event).
AddEventHandler('w_core:server:citizenIdChanged',function(old,new)
    if old~=nil then ids[tostring(old)]=nil end
    if new~=nil then ids[tostring(new)]=nil end
end)
-- ── character deletion (w_core) ─────────────────────────────────────────────
-- wc_playtime (sv_schema.lua) is keyed by players.id, not by the citizen id, so the row is found
-- through the core row, read here and never through the cache (a stale entry would name another
-- character). The orphan sweep takes the rows whose core row is already gone -- characters
-- deleted before this export existed, or a core row removed first; players.id is never reused.
-- Idempotent: a second run finds nothing and answers ok.
exports('PurgeCharacter',function(citizenid,ctx)
    -- a wipe of anyone's playtime on demand: only the character deletion may ask for it
    if GetInvokingResource()~='w_core' then return false,'forbidden' end
    if type(citizenid)=='number' then
        citizenid=(citizenid>0 and citizenid<1e15 and citizenid%1==0) and ('%d'):format(citizenid) or nil
    end
    if type(citizenid)~='string' or #citizenid>64 or not citizenid:match('^%w+$') then return false,'invalid_id' end
    -- dropped whatever happens below: a mapping for a number being handed on is never worth keeping
    ids[citizenid]=nil
    -- the VORP layer keys playtime by characters.charidentifier and has no `players` to join
    if isVorp() then return false,'unsupported_framework' end
    local ok,result=pcall(function()
        local id=tonumber(w.database.scalar.await('SELECT id FROM players WHERE citizenid = ?',{citizenid}))
        -- a player who went back to the selection and deleted the character he just played still
        -- has its players.id in his Players.cache entry (cleared only on playerDropped): the
        -- one-minute playtime sampler would write the row back. Dropped before the DELETE; the
        -- 30-second top-up re-reads the entry once a character is loaded again.
        if id and type(Players)=='table' and type(Players.cache)=='table' then
            for _,p in pairs(Players.cache) do
                if type(p)=='table' and tonumber(p.id)==id then p.id=nil end
            end
        end
        local removed=id and w.database.update.await('DELETE FROM `wc_playtime` WHERE `char_id` = ?',{id}) or 0
        local orphans=w.database.update.await('DELETE p FROM `wc_playtime` p LEFT JOIN `players` c ON c.`id` = p.`char_id` WHERE c.`id` IS NULL') or 0
        return {wc_playtime=tonumber(removed) or 0,wc_playtime_orphans=tonumber(orphans) or 0}
    end)
    if not ok then
        print('^1[w_connector] playtime purge failed for '..citizenid..': '..tostring(result)..'^0')
        return false,'database'
    end
    if result.wc_playtime+result.wc_playtime_orphans>0 then
        print(('[w_connector] purged character %s: %d playtime row(s), %d orphan(s) (by %s)'):format(citizenid,
            result.wc_playtime,result.wc_playtime_orphans,tostring(type(ctx)=='table' and ctx.by or 'w_core')))
    end
    return true,result
end)
function CoreBridge.currencyFromPanel(value)
    value=tonumber(value) or 0
    return (value==1 or value==2) and value or 0
end
function CoreBridge.identifiers(src)
    local result={}
    for _,id in ipairs(GetPlayerIdentifiers(src)) do
        local kind,value=id:match('^([^:]+):(.+)$')
        if kind then result[kind]=kind=='license' and id or value end
    end
    return result
end
function CoreBridge.snapshot(src)
    local pd=data(src)
    if not pd then return nil end
    local c,j,m,meta=pd.charinfo or {},pd.job or {},pd.money or {},pd.metadata or {}
    local identity=api:FwGetCharacterData(src) or {}
    return {source=tonumber(src),charId=charId(pd.citizenid),citizenid=pd.citizenid,
        identifier=pd.license,firstName=c.firstname,lastName=c.lastname,
        characterName=api:FwGetCharacterName(src),nickname=c.nickname or pd.name,
        job=j.name,jobLabel=j.label,jobGrade=j.grade and j.grade.level or 0,
        group=meta.group,money=m.cash or 0,gold=identity.gold or 0,rol=m.bank or 0,
        blackMoney=0,xp=meta.xp or 0,age=c.age,gender=c.gender,description=c.description,
        isDead=meta.isdead==true,invCapacity=meta.invCapacity}
end
function CoreBridge.sourceOfChar(id)
    for _,src in ipairs(GetPlayers()) do
        local pd=data(tonumber(src))
        if pd and charId(pd.citizenid)==tonumber(id) then return tonumber(src) end
    end
end
for method,exportName in pairs({setFirstName='FwSetFirstName',setLastName='FwSetLastName',
    setNickname='FwSetNickname',setAge='FwSetAge',setDescription='FwSetDescription',setJobLabel='FwSetJobLabel',
    heal='FwHeal',revive='FwRevive',respawn='FwRespawn'}) do
    CoreBridge[method]=function(...) return api[exportName](api,...) end
end
function CoreBridge.setJob(src,name,grade,label)
    local current=CoreBridge.snapshot(src)
    if not current then return false,'character_not_loaded' end
    return api:FwSetJob(src,name or current.job,grade or current.jobGrade)==true
end
function CoreBridge.adjustCurrency(src,kind,delta)
    delta=tonumber(delta)
    if not delta or delta~=delta or math.abs(delta)==math.huge then return false,'invalid_amount' end
    if tonumber(kind)==2 then
        local player=object(src)
        if not player then return false,'character_not_loaded' end
        if delta >= 0 then return player.Functions.AddMoney('bank',delta,'connector-adjustment') end
        return player.Functions.RemoveMoney('bank',-delta,'connector-adjustment')
    end
    if delta>=0 then return api:FwAddCurrency(src,kind,delta) end
    return api:FwRemoveCurrency(src,kind,-delta)
end
function CoreBridge.addCurrency(src,kind,amount) return CoreBridge.adjustCurrency(src,kind,math.abs(amount)) end
function CoreBridge.removeCurrency(src,kind,amount) return CoreBridge.adjustCurrency(src,kind,-math.abs(amount)) end
function CoreBridge.addXp(src,delta)
    local p=object(src)
    if not p then return false,'character_not_loaded' end
    p.Functions.SetMetaData('xp',math.max(0,(tonumber(p.PlayerData.metadata.xp) or 0)+(tonumber(delta) or 0)))
    return true
end
-- ! `or {}` like countAccounts: setOffline indexes this result, and a nil answer before the
--   bridge is up threw instead of failing the action cleanly.
function CoreBridge.registeredJobs() return api:FwGetSharedJobs() or {} end

-- A read projection for the website's existing field names. All writes below use
-- the real players table, with bound values and a closed list of JSON fields.
CoreBridge.select = [[SELECT id AS charidentifier,citizenid,license AS identifier,name AS steamname,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.firstname')) AS firstname,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.lastname')) AS lastname,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.nickname')) AS nickname,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.age')) AS age,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.gender')) AS gender,
 JSON_UNQUOTE(JSON_EXTRACT(charinfo,'$.description')) AS character_desc,
 JSON_UNQUOTE(JSON_EXTRACT(job,'$.name')) AS job,
 JSON_UNQUOTE(JSON_EXTRACT(job,'$.label')) AS joblabel,
 JSON_EXTRACT(job,'$.grade.level') AS jobgrade,
 COALESCE(JSON_EXTRACT(money,'$.cash'),0)+0 AS money,
 COALESCE(JSON_EXTRACT(money,'$.gold'),JSON_EXTRACT(money,'$.bloodmoney'),0)+0 AS gold,
 COALESCE(JSON_EXTRACT(money,'$.bank'),0)+0 AS rol, 0 AS blackmoney,
 COALESCE(JSON_EXTRACT(metadata,'$.xp'),0)+0 AS xp,
 JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.group')) AS `group`,
 JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.isdead')) AS isdead,last_updated AS LastLogin FROM players]]
local function where(search,excluded)
    local clauses,values={},{}
    if search and search~='' then
        -- A citizen id typed in the panel's search finds that one character, compared whole: staff
        -- work with that id only, and it was not searchable at all. It is not also matched as text,
        -- or '12' would list every licence whose hex holds "12" and bury the character asked for.
        local kind,id=w.citizen.parse(search)
        if kind=='citizen' then
            clauses[#clauses+1]='citizenid = ?'
            values[#values+1]=id
        elseif kind=='server' then
            -- '#5' names whoever is on that server id: an online row, never an offline one
            clauses[#clauses+1]='1 = 0'
        else
            clauses[#clauses+1]='(firstname LIKE ? OR lastname LIKE ? OR identifier LIKE ? OR steamname LIKE ?)'
            for _=1,4 do values[#values+1]='%'..search..'%' end
        end
    end
    if excluded and #excluded>0 then
        local marks={}
        for _,id in ipairs(excluded) do marks[#marks+1]='?'; values[#values+1]=tonumber(id) end
        clauses[#clauses+1]='charidentifier NOT IN ('..table.concat(marks,',')..')'
    end
    return #clauses>0 and ' WHERE '..table.concat(clauses,' AND ') or '',values
end
function CoreBridge.offlineChar(id)
    return w.database.single.await('SELECT * FROM ('..CoreBridge.select..') c WHERE charidentifier = ?', {tonumber(id)})
end
function CoreBridge.offlineCharByIdentifier(identifier)
    return w.database.single.await('SELECT * FROM ('..CoreBridge.select..') c WHERE identifier = ? ORDER BY LastLogin DESC LIMIT 1',{identifier})
end
function CoreBridge.offlineCharacters(search,limit,offset,excluded)
    local filter,values=where(search,excluded)
    values[#values+1]=math.floor(math.max(1,math.min(tonumber(limit) or 10,100)))
    values[#values+1]=math.floor(math.max(0,tonumber(offset) or 0))
    -- ! `or {}`: the VORP one guaranteed a table and its callers ipairs() the result straight away.
    return w.database.query.await('SELECT * FROM ('..CoreBridge.select..') c'..filter..' ORDER BY LastLogin DESC LIMIT ? OFFSET ?',values) or {}
end
function CoreBridge.countCharacters(search,excluded)
    local filter,values=where(search,excluded)
    return w.database.scalar.await('SELECT COUNT(*) FROM ('..CoreBridge.select..') c'..filter,values) or 0
end
-- ! An ACCOUNT, not a character. FwCountAllCharacters counts rows in `players`, which is exactly
--   what countCharacters already returns — the panel would have shown the same number twice and
--   the "accounts vs characters" pair would have lost its meaning. One licence can hold several
--   characters, so the account count is the distinct licence count. VORP keeps its own users table.
function CoreBridge.countAccounts()
    if isVorp() then return api:FwCountAllCharacters() or 0 end
    return w.database.scalar.await('SELECT COUNT(DISTINCT license) FROM players') or 0
end
function CoreBridge.totalMoney()
    local row=w.database.single.await('SELECT SUM(money) AS money,SUM(gold) AS gold FROM ('..CoreBridge.select..') c') or {}
    return tonumber(row.money) or 0,tonumber(row.gold) or 0
end
local fields={firstname={'charinfo','firstname'},lastname={'charinfo','lastname'},nickname={'charinfo','nickname'},
 age={'charinfo','age'},gender={'charinfo','gender'},character_desc={'charinfo','description'},
 money={'money','cash'},gold={'money','bloodmoney'},rol={'money','bank'},xp={'metadata','xp'}}
function CoreBridge.setOffline(id,column,value)
    local row=CoreBridge.offlineChar(id)
    if not row then return false end
    local online=CoreBridge.sourceOfChar(id)
    if online then return false,'player_is_online' end -- never overwrite a live bag/character snapshot
    if column == 'money' or column == 'gold' or column == 'rol' then
        value = tonumber(value)
        if not value or value ~= value or value < 0 or value == math.huge then return false, 'invalid_amount' end
        if GetResourceState('w_centralbank') ~= 'started' or not exports.w_centralbank:IsReady() then return false, 'economy_unavailable' end
        local currency = ({ money = 'cash', gold = 'gold', rol = 'bank' })[column]
        local balance = exports.w_centralbank:GetBalance('player:' .. tostring(row.citizenid) .. ':' .. currency)
        if balance == nil then return false, 'account_unavailable' end
        return exports.w_centralbank:AdjustPlayer(tostring(row.citizenid), currency, value - balance, 'connector-offline-adjustment')
    end
    if isVorp() then
        local columns={firstname='firstname',lastname='lastname',nickname='nickname',age='age',gender='gender',
            character_desc='charDescription',money='money',gold='gold',rol='rol',xp='xp',job='job',jobgrade='jobgrade',joblabel='joblabel'}
        local actual=columns[column]
        if not actual then return false,'unsupported_field' end
        return w.database.update.await(('UPDATE characters SET `%s` = ? WHERE charidentifier = ?'):format(actual),{value,tonumber(id)})>0
    end
    if column=='job' or column=='jobgrade' or column=='joblabel' then
        local name=column=='job' and value or row.job
        local grade=column=='jobgrade' and tonumber(value) or tonumber(row.jobgrade) or 0
        local jobs=CoreBridge.registeredJobs(); local def=jobs[name]
        local rank=def and def.grades and (def.grades[grade] or def.grades[tostring(grade)])
        if not rank then return false,'invalid_job_grade' end
        local job={name=name,label=def.label,onduty=def.defaultDuty,isboss=rank.isboss==true,
            payment=rank.payment or 0,grade={name=rank.name or tostring(grade),level=grade}}
        return w.database.update.await('UPDATE players SET job = ? WHERE id = ?', {json.encode(job),tonumber(id)})>0
    end
    local field=fields[column]
    if not field then return false,'unsupported_field' end
    if column=='gold' then
        local money=w.database.scalar.await('SELECT money FROM players WHERE id = ?',{tonumber(id)})
        local decoded=money and json.decode(money) or {}
        field={'money',decoded.gold~=nil and 'gold' or 'bloodmoney'}
    end
    return w.database.update.await(('UPDATE players SET `%s` = JSON_SET(COALESCE(NULLIF(`%s`,\'\'),\'{}\'), ?, ?) WHERE id = ?')
        :format(field[1],field[1]), {'$.'..field[2],value,tonumber(id)})>0
end
function CoreBridge.adjustOffline(id,column,delta)
    local row=CoreBridge.offlineChar(id)
    if not row then return false end
    delta=tonumber(delta)
    if not delta or delta~=delta or math.abs(delta)==math.huge then return false end
    return CoreBridge.setOffline(id,column,math.max(0,(tonumber(row[column]) or 0)+delta))
end
-- ═══════════════════════════════════════════════════════════════════════════════════
--  Repointing the VORP layer
--
--  sv_vorp.lua is not one thing. Three of its functions already speak this server's own
--  language — adjustCurrency/addCurrency/removeCurrency go through w_centralbank and
--  w_core (sv_vorp.lua:251-268), and identifiers() reads the natives — and those are left
--  exactly as they are. Everything listed below does not: it either queries a VORP table
--  (`characters`, `users`) or reaches through exports.vorp_core:GetCore(), a core that
--  never answers on a Wraith Core host, so Vorp.ready never flips and Vorp.char() returns
--  nil for every caller. On this server those functions are not "different", they are
--  dead: a failing query or a nil character, every time.
--
--  So the check is per call and on the framework itself, not a swap: a VORP host runs the
--  original untouched, and anything else runs the citizenid implementation beside it.
-- ═══════════════════════════════════════════════════════════════════════════════════
local REPOINTED = {
    -- reads of VORP's own tables
    'offlineChar', 'offlineCharByIdentifier', 'offlineCharacters',
    'countCharacters', 'countAccounts', 'totalMoney', 'setOffline', 'adjustOffline',
    -- reads through the vorp_core character facade
    'snapshot', 'sourceOfChar', 'setJob', 'addXp', 'registeredJobs',
    'setFirstName', 'setLastName', 'setNickname', 'setAge', 'setDescription', 'setJobLabel',
    'heal', 'revive', 'respawn',
}

CreateThread(function()
    while not api:FwReady() do Wait(100) end
    if type(Vorp) == 'table' then
        for _, name in ipairs(REPOINTED) do
            local original = Vorp[name]
            if type(CoreBridge[name]) == 'function' then
                Vorp[name] = function(...)
                    if isVorp() and type(original) == 'function' then return original(...) end
                    return CoreBridge[name](...)
                end
            end
        end
        -- ! Vorp.ready gates the player-cache top-up loop (sv_players.lua:228,250). It waits on a
        --   vorp_core that never answers here, so that loop has never run once on this server.
        if not isVorp() then Vorp.ready = true end
        -- One line at boot, so the console says which layer is answering rather than leaving
        -- it to be inferred from whether the `characters` failures have stopped.
        print(('^2[w_connector] framework bridge: host=%s -> %s^0'):format(tostring(api:FwName()),
            isVorp() and 'VORP layer kept' or ('%d Vorp.* calls repointed at the citizenid schema'):format(#REPOINTED)))
    end
    if isVorp() then
        CoreBridge.select=[[SELECT charidentifier,CAST(charidentifier AS CHAR) AS citizenid,identifier,'' AS steamname,
            firstname,lastname,nickname,age,gender,charDescription AS character_desc,job,joblabel,jobgrade,
            money,gold,rol,0 AS blackmoney,xp,`group`,isdead,LastLogin FROM characters]]
    end
    CoreBridge.ready=true
end)
