--- The handler table.
---
--- w_admin's `RegisterCallback(name, fn)` did two things: it stored the handler AND called
--- `RegisterNetEvent(name, …)`. Every one of its 95 callbacks was therefore also a plain net event
--- that any player could fire with a forged request id, and the only gate was a `HasPermission`
--- call inside the handler — which THIRTEEN of them never made, including the one that returns the
--- full admin roster with Discord IDs and identifiers.
---
--- Here, handlers live in a private table reachable only from the bridge dispatcher. No net events,
--- so no client can reach any of it. And the permission node is declared AT REGISTRATION and
--- checked by the dispatcher before the handler body runs — a handler cannot be registered without
--- one. That closes the whole class of bug by construction instead of by remembering.
---
--- Handler signature: `fn(actor, args) -> result`
---   * `actor` is `{ group, level, label, identifier, discord }`, already validated.
---   * `args` is whatever the website sent, VERBATIM. It may be a bare primitive: the website sends
---     a number to `adminpanel:scheduleRestart` and a string to `adminpanel:sendAnnouncement`.
---   * Action-shaped handlers return `{ success = boolean, message = string? }`, because the
---     website's `outcome()` reads exactly that. Read-shaped handlers return their documented
---     object or array.

Registry = { invokes = {}, reads = {}, actions = {} }

--- A node that every authenticated actor holds. Used only by handlers that are pure presentation
--- of data the panel already had, where a separate node would be noise.
Registry.OPEN = 'access_admin_panel'

local function define(bucket, name, node, fn)
    if type(name) ~= 'string' or name == '' then
        error('w_connector: handler registered without a name', 2)
    end
    if type(node) ~= 'string' or node == '' then
        error(('w_connector: handler %s registered without a permission node'):format(name), 2)
    end
    if type(fn) ~= 'function' then
        error(('w_connector: handler %s registered without a function'):format(name), 2)
    end
    bucket[name] = { node = node, fn = fn }
end

function Registry.invoke(name, node, fn) define(Registry.invokes, name, node, fn) end
function Registry.read(name, node, fn)   define(Registry.reads,   name, node, fn) end
function Registry.action(name, node, fn) define(Registry.actions, name, node, fn) end

--- The rank a call's target player holds, or nil (no target, or not staff). Every identifier we can
--- name for him counts: the one the website sent, and all of the live player's.
local PLAYER_KEYS = { 'source', 'target', 'citizenid', 'citizenId', 'identifier', 'playerId', 'characterId', 'charId' }
local function targetRank(args)
    if type(args) ~= 'table' or type(H) ~= 'table' or not H.playerRef then return nil, {} end
    -- the player reference the panel sends ({player = {...}}), or only the player fields of the args:
    -- a bare `id` is a warning, a ban or a report as often as a character, so it never names a target
    local probe = args
    if type(args.player) ~= 'table' and type(args.targetPlayer) ~= 'table' then
        probe = {}
        for _, k in ipairs(PLAYER_KEYS) do probe[k] = args[k] end
    end
    local ok, ref = pcall(H.playerRef, probe)
    if not ok or type(ref) ~= 'table' then return nil, {} end
    local ids = {}
    if type(ref.identifier) == 'string' and ref.identifier ~= '' then ids[#ids + 1] = ref.identifier end
    local okSrc, src = pcall(H.liveSource, ref)
    if okSrc and src then
        for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do ids[#ids + 1] = id end
    end
    local best
    for _, id in ipairs(ids) do
        local admin = Perms.adminOf(id)
        if admin and (not best or Perms.level(admin.group) > Perms.level(best.group)) then best = admin end
    end
    return best, ids
end

--- A staff member acts on players below his own rank only (2026-10-22: a helper could ban, freeze or
--- wipe the master from the site; only adminAction checked). The master acts on anyone, anyone acts on
--- himself, and reads (get*, lookups) are not limited. Answers the error string, or nil to go on.
local function rankGuard(actor, name, args)
    if Perms.isMaster(actor) then return nil end
    local bare = tostring(name or ''):gsub('^adminpanel:', '')
    if bare:lower():find('^get') or bare:find('Lookup') then return nil end
    local target, ids = targetRank(args)
    if not target then return nil end
    if actor.discord then
        for _, id in ipairs(ids) do
            if id == 'discord:' .. actor.discord then return nil end
        end
    end
    if Perms.outranks(actor, target.group) then return nil end
    return 'target_outranks_you'
end

--- Run one entry under an actor.
--- Returns `ok, result, err` where `err` is one of the website's documented error strings.
local function run(entry, actor, args, missing, name)
    if not entry then return false, nil, missing end
    if not Perms.has(actor, entry.node) then return false, nil, 'no_permission' end
    local refused = rankGuard(actor, name, args)
    if refused then return false, nil, refused end
    local ok, res = pcall(entry.fn, actor, args)
    if not ok then
        print(('^1[w_connector] handler error:^0 %s'):format(tostring(res)))
        return false, nil, 'exception'
    end
    return true, res, nil
end

function Registry.callInvoke(actor, name, args)
    return run(Registry.invokes[name], actor, args, 'unknown_callback', name)
end

function Registry.callRead(actor, name, args)
    return run(Registry.reads[name], actor, args, 'unknown_read', 'get')
end

function Registry.callAction(actor, name, args)
    return run(Registry.actions[name], actor, args, 'unsupported', name)
end

function Registry.hasInvoke(name) return Registry.invokes[name] ~= nil end

-- ---------------------------------------------------------------------------
--  Small shared helpers, so twelve handler files do not each grow their own.
-- ---------------------------------------------------------------------------

H = {}

function H.ok(message)  return { success = true,  message = message } end
function H.fail(message) return { success = false, message = message } end

function H.int(v, default)
    local n = tonumber(v)
    if not n then return default end
    return math.floor(n)
end

function H.clamp(v, lo, hi, default)
    local n = tonumber(v) or default
    if not n then return default end
    if n < lo then return lo end
    if n > hi then return hi end
    return n
end

function H.str(v, maxLen)
    if v == nil then return '' end
    local s = tostring(v)
    if maxLen and #s > maxLen then s = s:sub(1, maxLen) end
    return s
end

--- The four-field player reference the website sends to every player-scoped callback:
--- `{ source, id, identifier, username }`. Both the panel and shopDelivery.ts build this shape, so
--- reading it lives in one place.
function H.playerRef(args)
    local p = (type(args) == 'table' and (args.player or args.targetPlayer or args)) or {}
    if type(p) ~= 'table' then return {} end
    local ref = {
        source = tonumber(p.source or p.playerId or p.id),
        charId = tonumber(p.id or p.characterId or p.charId),
        identifier = p.identifier,
        username = p.username or p.characterName or p.name,
        -- `target` is what the FiveM 2.0 panel sends INSTEAD of the four-field shape, and reading it
        -- was simply missing: every verb that resolves a player — kick, ban, freeze, revive, kill, the
        -- teleports, the inventory wipes and all nine troll effects — answered `player_not_online` for
        -- a player whose row showed a live ping. It is kept separate from `source` and `charId`
        -- because it is AMBIGUOUS: the Players page sends a character id, the map sends a server id.
        -- H.liveSource decides which it is by asking the game, rather than guessing here.
        target = tonumber(p.target),
    }

    -- The CITIZEN id (players.citizenid), the one id staff use everywhere else. Unlike the numbers
    -- above it names exactly one character, so when the website sends it (`citizenid`, or text in
    -- `target` that is not a plain number: an old 'OMG95204' id or '#5' for a server id) it
    -- replaces them: the live source when he plays, and the website character id the offline paths
    -- key on. A citizen id that names nobody clears them all, the account identifier included, so
    -- neither a stale number nor an identifier sent beside it can redirect the action (a ban falls
    -- back to ref.identifier) to someone else.
    local typed = p.citizenid or p.citizenId
    if typed == nil and type(p.target) == 'string' and not tonumber(p.target) then typed = p.target end
    if typed ~= nil and typed ~= '' then
        local who = w.citizen.resolve(typed)
        ref.source, ref.charId, ref.target, ref.identifier = nil, nil, nil, nil
        if who then
            ref.source = who.source
            ref.charId = CoreBridge.charIdOf(who.citizenid)
            ref.citizenid = who.citizenid
            -- the account of THAT character; the sent identifier only when the core knows none
            ref.identifier = who.license or p.identifier
            if not ref.username or ref.username == '' then ref.username = who.name end
        end
    end

    return ref
end

--- Is this reference an online player right now? Returns the live source, or nil.
---
--- The source the website holds can be stale — it was read when the page last loaded, and server
--- ids are reused. So a reference is only treated as online when the source still resolves to a
--- character with the SAME character id.
function H.liveSource(ref)
    if ref.source then
        local snap = Vorp.snapshot(ref.source)
        if snap and (not ref.charId or snap.charId == ref.charId) then return ref.source end
    end
    if ref.charId then
        local src = Vorp.sourceOfChar(ref.charId)
        if src then return src end
    end
    -- The ambiguous `target`, resolved by asking rather than assuming: try it as a server id first,
    -- and only if nothing is connected under it treat it as a character id. A server id that happens
    -- to collide with some other player's character id therefore cannot redirect the action, because
    -- the first branch only succeeds when someone is actually online under that id.
    if ref.target then
        if Vorp.snapshot(ref.target) then return ref.target end
        local src = Vorp.sourceOfChar(ref.target)
        if src then return src end
    end
    return nil
end
