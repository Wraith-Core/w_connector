--- Website-owned native grants. These are leases on isolated player principals, never saved ranks.
--- The local watchdog does not await HTTP: a stalled or late request cannot extend an old grant.
WC = WC or {}
local P = { sessions = {}, pending = {}, owned = {} }
WC.ScriptPermissions = P

local LEASE_MS, REFRESH_MS = 45000, 15000
local epoch = ('sp2_%08x%08x%08x%08x'):format(math.random(0, 0xffffffff), math.random(0, 0xffffffff), math.random(0, 0xffffffff), math.random(0, 0xffffffff))
local generation, sequence, busy, stopped = 0, 0, nil, false
local lastStart, dirty = -REFRESH_MS, true
local me = GetCurrentResourceName()
local JOURNAL_KEY = 'wcsite_cleanup_v1'
local journalBlocked, lastJournal, lastWarning = false, nil, nil

local function now() return GetGameTimer() end
local function sourceId(value)
    local n = math.tointeger(tonumber(value))
    return n and n > 0 and n < 65536 and n or nil
end
local function linked() return type(WC.linked) == 'function' and WC.linked() == true end
local function identifiers(src)
    if not GetPlayerName(src) then return nil end
    local ids = WC.identifiers(src)
    local discord, license = ids.discord, ids.license or ids.license2
    local kind, value
    if type(license) == 'string' then kind, value = license:match('^(license2?):(%x+)$') end
    if type(discord) ~= 'string' or not discord:match('^discord:%d+$') or #discord < 23 or #discord > 29
        or not kind or #value < 16 or #value > 64 or license ~= license:lower() then return nil end
    return discord, license
end
local function aclReady()
    if type(IsPrincipalAceAllowed) ~= 'function' then return false end
    for _, command in ipairs({ 'add_ace', 'remove_ace', 'add_principal', 'remove_principal' }) do
        if not IsPrincipalAceAllowed('resource.' .. me, 'command.' .. command) then return false end
    end
    return true
end
-- 2.2.3: ExecuteCommand is void. A real FXServer returns false for every line, applied or silently denied,
-- so its result proves nothing; only a native fault counts here and every caller verifies the ACE itself.
local function execute(line)
    return (pcall(ExecuteCommand, line))
end
local function warning(message)
    local t = now()
    if WC.log and (not lastWarning or t < lastWarning or t - lastWarning >= 15000) then
        WC.log('warning: %s', message)
        lastWarning = t
    end
end
local function aceAllowed(principal, node)
    if type(IsPrincipalAceAllowed) ~= 'function' then return nil end
    local ok, value = pcall(IsPrincipalAceAllowed, principal, node)
    -- 2.2.3: the native BOOL arrives as 1 when allowed and false when not; anything else stays unknown.
    if not ok then return nil end
    if value == true or value == 1 then return true end
    if value == false or value == 0 then return false end
    return nil
end
local function probe(s) return s.principal .. '.bound' end
local function persist()
    if journalBlocked or type(SetResourceKvp) ~= 'function' or type(GetResourceKvpString) ~= 'function'
        or type(json) ~= 'table' or type(json.encode) ~= 'function' then
        warning('native permission cleanup journal is unavailable; new grants are blocked')
        return false
    end
    local entries = {}
    for _, s in pairs(P.owned) do
        local nodes = {}
        for node in pairs(s.nodes) do nodes[#nodes + 1] = node end
        table.sort(nodes)
        entries[#entries + 1] = { source = s.source, principal = s.principal, nodes = nodes, bound = s.bound == true, probe = s.probe == true }
    end
    if #entries > 4096 then warning('native permission cleanup journal capacity reached; new grants are blocked'); return false end
    table.sort(entries, function(a, b) return a.principal < b.principal end)
    local ok, encoded = pcall(json.encode, { version = 1, entries = entries })
    if not ok or type(encoded) ~= 'string' then warning('failed to encode native permission cleanup journal'); return false end
    if #encoded > 8 * 1024 * 1024 then warning('native permission cleanup journal capacity reached; new grants are blocked'); return false end
    local readOk, previous = pcall(GetResourceKvpString, JOURNAL_KEY)
    if readOk and encoded == lastJournal and previous == encoded then return true end
    local writeOk = pcall(SetResourceKvp, JOURNAL_KEY, encoded)
    local verifyOk, stored = pcall(GetResourceKvpString, JOURNAL_KEY)
    if not writeOk or not verifyOk or stored ~= encoded then warning('failed to save native permission cleanup journal'); return false end
    lastJournal = encoded
    return true
end
local function notify(s)
    if WC.started('w_admin') and type(TriggerClientEvent) == 'function' then pcall(TriggerClientEvent, 'w_admin:client:recheck', s.source) end
end
local function clear(s)
    local changed = not s.cleanup and (s.bound or next(s.nodes) ~= nil)
    s.cleanup, s.grants, s.deadline, s.grantedAt = true, {}, 0, 0
    P.pending[s.principal], P.owned[s.principal] = s, s
    local unbound = false
    -- Remove only our own parent. A manual rank or an ACE on another principal is never touched.
    if s.bound then
        unbound = execute(('remove_principal player.%d %s'):format(s.source, s.principal))
        if unbound and aceAllowed('player.' .. s.source, probe(s)) == false then s.bound = false; changed = true end
    end
    for node in pairs(s.nodes) do
        local ok = execute(('remove_ace %s %s allow'):format(s.principal, node))
        if ok and aceAllowed(s.principal, node) == false then s.nodes[node] = nil; changed = true end
    end
    -- Once every real owned ACE is gone, remove the probe too. A pre-existing manual wildcard can
    -- independently grant this probe to the player; it must not prevent retiring an empty principal.
    if not next(s.nodes) and s.probe then
        local ok = execute(('remove_ace %s %s allow'):format(s.principal, probe(s)))
        if ok and aceAllowed(s.principal, probe(s)) == false then s.probe = false end
    end
    if unbound and not next(s.nodes) and not s.probe then
        if s.bound then changed = true end
        s.bound = false
    end
    local complete = not s.bound and not next(s.nodes) and not s.probe
    if complete then
        P.pending[s.principal], P.owned[s.principal] = nil, nil
        s.cleanup, s.deadline, s.grantedAt = false, nil, nil
    else warning('native permission cleanup is pending; owned authority remains tracked for retry') end
    persist()
    if changed then notify(s) end
    return complete
end
local function pendingSource(src, except)
    for _, s in pairs(P.pending) do if s.source == src and s ~= except then return true end end
    return false
end
local function samePlayer(s)
    if P.sessions[s.source] ~= s then return false end
    local discord, license = identifiers(s.source)
    return discord == s.discord and license == s.license
end
local function reconcilePlayers()
    local seen, players = {}, {}
    for _, raw in ipairs(GetPlayers()) do
        local src = sourceId(raw)
        if src and not seen[src] then
            seen[src] = true
            local discord, license = identifiers(src)
            local s = P.sessions[src]
            if s and (s.discord ~= discord or s.license ~= license) then clear(s); P.sessions[src] = nil; s = nil end
            if discord and not s then
                generation = generation + 1
                s = { source = src, discord = discord, license = license, session = epoch .. '_' .. generation,
                    principal = ('wcsite.%s.%d.%d'):format(epoch, src, generation), nodes = {}, grants = {}, bound = false }
                P.sessions[src] = s
            end
            if s then players[#players + 1] = s end
        end
    end
    for src, s in pairs(P.sessions) do if not seen[src] then clear(s); P.sessions[src] = nil end end
    table.sort(players, function(a, b) return a.source < b.source end)
    return players
end
local function array(value, max)
    if type(value) ~= 'table' then return false end
    local count = 0
    for key in pairs(value) do
        if type(key) ~= 'number' or not math.tointeger(key) or key < 1 or key > max then return false end
        count = count + 1
    end
    return count == #value and count <= max
end
local function apply(s, grants, allowed, deadline, started)
    local nodes = {}
    local changed = false
    deadline, started = deadline or s.deadline, started or s.grantedAt
    local function timely()
        local t = now()
        return not stopped and type(deadline) == 'number' and type(started) == 'number' and t >= started and t < deadline
    end
    for id in pairs(grants) do
        local permission = allowed[id]
        if not permission or not WC.ScriptCatalog.safeNode(permission.node) then return false end
        nodes[permission.node] = true
    end
    if pendingSource(s.source, s) or (s.cleanup and not clear(s)) then return false end
    if not next(nodes) then return clear(s) end
    if not timely() then clear(s); return false end
    local before, oldBound, oldProbe = {}, s.bound, s.probe == true
    for node in pairs(s.nodes) do before[node] = true end
    -- Journal a conservative superset BEFORE issuing native adds. A process/resource interruption
    -- can then replay removals, never restore privileges, even if it happened between two commands.
    for node in pairs(nodes) do s.nodes[node] = true end
    s.bound, s.probe = true, true
    P.owned[s.principal] = s
    if not persist() then
        s.nodes, s.bound, s.probe = before, oldBound, oldProbe
        if not oldBound and not oldProbe and not next(before) then P.owned[s.principal] = nil end
        return false
    end
    if not timely() or not samePlayer(s) or not linked() then clear(s); return false end
    if not oldProbe or aceAllowed(s.principal, probe(s)) ~= true then
        if not execute(('add_ace %s %s allow'):format(s.principal, probe(s))) or aceAllowed(s.principal, probe(s)) ~= true then clear(s); return false end
    end
    -- Revoke obsolete nodes before adding the new set. Verification is conservative: an inherited
    -- ancestor may prevent proving one exact removal, in which case clear all owned grants and retry.
    for node in pairs(before) do
        if not nodes[node] then
            if not execute(('remove_ace %s %s allow'):format(s.principal, node)) or aceAllowed(s.principal, node) ~= false then clear(s); return false end
            s.nodes[node] = nil
            changed = true
        end
    end
    for node in pairs(nodes) do
        if not timely() then clear(s); return false end
        if not before[node] or aceAllowed(s.principal, node) ~= true then
            if not execute(('add_ace %s %s allow'):format(s.principal, node)) or aceAllowed(s.principal, node) ~= true then clear(s); return false end
            changed = true
        end
    end
    if not timely() or not samePlayer(s) or not linked() then clear(s); return false end
    if not oldBound or aceAllowed('player.' .. s.source, probe(s)) ~= true then
        if not execute(('add_principal player.%d %s'):format(s.source, s.principal)) or aceAllowed('player.' .. s.source, probe(s)) ~= true then clear(s); return false end
    end
    s.nodes, s.grants = nodes, grants
    s.cleanup = false
    persist()
    if changed then notify(s) end
    return true
end

local function validate(body, requested, allowed)
    if type(body) ~= 'table' or body.ok ~= true or body.epoch ~= epoch or body.leaseSeconds ~= 45 or not array(body.players, 2048) then return nil end
    local result = {}
    for _, entry in ipairs(body.players) do
        if type(entry) ~= 'table' then return nil end
        local src = sourceId(entry.source)
        local s = src and requested[src]
        if type(entry.source) ~= 'number' or not s or result[src] or entry.discord ~= s.discord or entry.license ~= s.license or entry.session ~= s.session
            or not array(entry.permissions, 1024) then return nil end
        local grants = {}
        for _, id in ipairs(entry.permissions) do
            if type(id) ~= 'string' or not allowed[id] or grants[id] then return nil end
            grants[id] = true
        end
        result[src] = grants
    end
    return result
end

function P.refresh()
    if stopped or busy or journalBlocked or type(WC.request) ~= 'function' then return false end
    lastStart, dirty = now(), false
    if not linked() then P.reset(); return false end
    if not aclReady() then P.reset(); warning('native permission ACL commands are unavailable; new grants are blocked'); return false end
    local players = reconcilePlayers()
    local catalogOk, _, allowed = pcall(WC.ScriptCatalog.build)
    if not catalogOk then P.reset(); warning('native permission catalog unavailable; owned grants retired'); return false end
    if not next(allowed) then for _, s in ipairs(players) do clear(s) end; return false end
    local started = now()
    sequence = sequence + 1
    local seq = sequence
    busy, lastStart, dirty = seq, started, false
    local payload, requested = { epoch = epoch, players = {} }, {}
    for _, s in ipairs(players) do
        s.sequence = seq
        requested[s.source] = s
        payload.players[#payload.players + 1] = { source = s.source, discord = s.discord, license = s.license, session = s.session }
    end
    local ok, status, body = pcall(WC.request, 'POST', '/permissions', payload, LEASE_MS)
    if busy == seq then busy = nil end
    if stopped or seq ~= sequence then return false end
    local finished = now()
    -- Build the whitelist again: a resource/command can stop while HTTP is in flight.
    local currentOk, _, currentAllowed = pcall(WC.ScriptCatalog.build)
    if not currentOk then P.reset(); warning('native permission catalog unavailable; owned grants retired'); return false end
    local desired = ok and status == 200 and linked() and aclReady() and finished >= started and finished < started + LEASE_MS
        and validate(body, requested, currentAllowed) or nil
    local applied = desired ~= nil
    for src, s in pairs(requested) do
        if samePlayer(s) and s.sequence == seq then
            if desired then
                if apply(s, desired[src] or {}, currentAllowed, started + LEASE_MS, started) then s.grantedAt, s.deadline = started, started + LEASE_MS
                else clear(s); applied = false end
            else clear(s) end
        end
    end
    return applied
end

function P.tick()
    local t = now()
    -- Cleanup debt survives its active session. Retry before checking link state, including while
    -- disconnected, after a source id was reused, or after a reset retired every session.
    for _, s in pairs(P.pending) do clear(s) end
    if stopped or not linked() then
        if next(P.sessions) then P.reset() end
        return
    end
    local catalogOk, _, allowed = pcall(WC.ScriptCatalog.build)
    if not catalogOk then P.reset(); warning('native permission catalog unavailable; owned grants retired'); return end
    for src, s in pairs(P.sessions) do
        if stopped or not samePlayer(s) then clear(s); P.sessions[src] = nil
        elseif s.cleanup then -- already retried above; never turn cleanup debt into a fresh grant
        elseif s.deadline and (t < s.grantedAt or t >= s.deadline) then clear(s)
        elseif next(s.grants) then
            local retained, changed = {}, false
            for id in pairs(s.grants) do if allowed[id] then retained[id] = true else changed = true end end
            if changed and not apply(s, retained, allowed) then clear(s) end
        end
    end
end

function P.catalog() return WC.ScriptCatalog.build() end
function P.fingerprint(catalog)
    catalog = catalog or P.catalog()
    return WC.ScriptCatalog.fingerprint(catalog)
end
function P.reset()
    sequence = sequence + 1
    for src, s in pairs(P.sessions) do clear(s); P.sessions[src] = nil end
    dirty = true
end

local function loadCleanupJournal()
    if type(GetResourceKvpString) ~= 'function' then return end
    local readOk, raw = pcall(GetResourceKvpString, JOURNAL_KEY)
    if readOk and raw == nil then return end
    local function invalid()
        journalBlocked = true
        warning('native permission cleanup journal could not be verified; new grants are blocked')
    end
    if not readOk or type(raw) ~= 'string' or #raw > 8 * 1024 * 1024 or type(json) ~= 'table' or type(json.decode) ~= 'function' then return invalid() end
    local decodeOk, value = pcall(json.decode, raw)
    if not decodeOk or type(value) ~= 'table' or value.version ~= 1 or not array(value.entries, 4096) then return invalid() end
    local seen = {}
    for _, entry in ipairs(value.entries) do
        if type(entry) ~= 'table' or type(entry.principal) ~= 'string' or #entry.principal > 96 then return invalid() end
        local boot, srcText, gen = entry.principal:match('^wcsite%.(sp2_%x+)%.(%d+)%.(%d+)$')
        local src = sourceId(entry.source)
        local generationNumber = gen and tonumber(gen)
        if not boot or #boot ~= 36 or entry.principal ~= entry.principal:lower() or not src or tonumber(srcText) ~= src
            or srcText ~= tostring(src) or #gen > 16 or not generationNumber or generationNumber < 1 or generationNumber > 9007199254740991
            or tostring(math.tointeger(generationNumber)) ~= gen or seen[entry.principal]
            or type(entry.bound) ~= 'boolean' or type(entry.probe) ~= 'boolean'
            or not array(entry.nodes, 1024) then return invalid() end
        local nodes = {}
        for _, node in ipairs(entry.nodes) do
            -- Cleanup accepts previously valid exact object names even if the current catalogue
            -- retired them. It may only REMOVE from this strictly-owned, journaled principal.
            if type(node) ~= 'string' or #node > 96 or not node:match('^[a-z][a-z0-9_.%-]+$')
                or node:find('..', 1, true) or node:sub(-1) == '.' or nodes[node] then return invalid() end
            nodes[node] = true
        end
        local s = { source = src, principal = entry.principal, nodes = nodes, grants = {}, bound = entry.bound,
            probe = entry.probe, cleanup = true, deadline = 0, grantedAt = 0 }
        seen[entry.principal] = true
        P.pending[s.principal], P.owned[s.principal] = s, s
    end
    lastJournal = raw
end
loadCleanupJournal()

AddEventHandler('playerJoining', function()
    local src = sourceId(source)
    if src and P.sessions[src] then clear(P.sessions[src]); P.sessions[src] = nil end
    dirty = true
end)
AddEventHandler('playerDropped', function()
    local src = sourceId(source)
    if src and P.sessions[src] then clear(P.sessions[src]); P.sessions[src] = nil end
end)
AddEventHandler('onResourceStop', function(resource)
    if resource == me then
        stopped = true; P.reset()
        -- Native removals do not yield. Retry boundedly while the stopping resource still exists;
        -- unsuccessful removals remain in the verified KVP journal for the next resource start.
        for _ = 1, 3 do for _, s in pairs(P.pending) do clear(s) end end
        if next(P.pending) then warning('native permission cleanup remains pending at resource stop; recovery journal is retained') end
    else P.tick(); dirty = true end
end)
AddEventHandler('onResourceStart', function(resource)
    if resource ~= me then dirty = true end
end)

CreateThread(function()
    while not stopped do
        local ok = pcall(P.tick)
        if not ok then P.reset(); warning('native permission watchdog fault; owned grants retired for retry') end
        Wait(500)
    end
end)
CreateThread(function()
    Wait(2500)
    while not stopped do
        local elapsed = now() - lastStart
        if linked() and not busy and (elapsed < 0 or elapsed >= REFRESH_MS or (dirty and elapsed >= 1500)) then
            CreateThread(function() P.refresh() end)
        end
        Wait(500)
    end
end)
