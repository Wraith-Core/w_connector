--- Roles and permission checks.
---
--- ONE rank system for the game and the website (2026-10-14). The ranks live in w_core
--- (server/ranks.lua: w_ranks + w_rank_members), managed from the in-game admin panel's Ranks page
--- and from the website's Roles tab, which reads and writes them through the handlers here. A rank
--- holds its in-game permissions (ACE, applied by w_core) and its website permissions (the
--- PERMISSION_NODES of sv_schema.lua, checked here by name) side by side. wc_roles / wc_admins are
--- no longer read: wc_admins only keeps each staff member's resolved-report count.
---
--- The website's top role was `owner`; the rank system's is `master` (every permission, the only one
--- who manages the ranks). The site still sends `owner` for its owner, and that IS the master here.
---
--- There is also no synthetic session here. w_admin fabricated an admin at source -1000 with
--- `permissions = {'*'}` so its existing permission-checking functions could be reused unchanged —
--- which meant every web action ran with a wildcard and the real check happened somewhere else, if
--- at all. Handlers here receive the actor as an argument and the dispatcher checks the node before
--- calling them.

Perms = { roles = {}, members = {}, loaded = false }

local MASTER = 'master'
local ALIASES = { owner = MASTER }

local function core()
    return GetResourceState('w_core') == 'started' and exports.w_core or nil
end
Perms.core = core

--- The rank name the website means: its `owner` is the master.
function Perms.canon(group)
    if type(group) ~= 'string' then return nil end
    group = group:lower()
    return ALIASES[group] or group
end

--- An identifier as w_core keys it: lowercase, and a bare steam hex gets its prefix back.
function Perms.normalizeIdentifier(identifier)
    if type(identifier) ~= 'string' or identifier == '' then return nil end
    identifier = identifier:lower():gsub('%s', '')
    if not identifier:find(':') and identifier:match('^1[01]0000[%x]+$') then identifier = 'steam:' .. identifier end
    return identifier
end

function Perms.load()
    local api = core()
    if not api then return Perms.roles end
    local ok, st = pcall(function() return api:RanksState() end)
    if not ok or type(st) ~= 'table' then return Perms.roles end

    local roles = {}
    for _, r in ipairs(st.ranks or {}) do
        roles[r.name] = {
            name = r.name,
            label = r.label or r.name,
            color = r.color or '',
            lvl = tonumber(r.sort) or 0,
            -- the master holds everything on the website too
            permissions = r.name == MASTER and { '*' } or (r.permissions or {}),
            protected = r.protected == true,
            discordRoleId = r.discord or '',
        }
    end
    local members = {}
    for _, m in ipairs(st.members or {}) do
        if type(m.identifier) == 'string' then members[m.identifier] = m end
    end
    Perms.roles, Perms.members, Perms.loaded = roles, members, true
    return roles
end

function Perms.get(group)
    group = Perms.canon(group)
    if not group then return nil end
    return Perms.roles[group]
end

--- The list every consumer of the role table wants, in the shape the website's Roles tab expects.
function Perms.list()
    local out = {}
    for _, r in pairs(Perms.roles) do
        out[#out + 1] = {
            name = r.name, label = r.label, color = r.color, lvl = r.lvl,
            permissions = r.permissions, discordRoleId = r.discordRoleId, protected = r.protected,
        }
    end
    table.sort(out, function(a, b) return (a.lvl or 0) < (b.lvl or 0) end)
    return out
end

--- Does this actor hold this node?
---
--- `*` means everything (the master). There is no other wildcard — `player.*` does NOT match
--- `player.kick`: the website stores node lists picked against this vocabulary, and quietly making
--- prefixes match would widen every existing rank the moment this shipped.
function Perms.has(actor, node)
    if type(actor) ~= 'table' then return false end
    local role = Perms.get(actor.group)
    if not role then return false end
    for _, p in ipairs(role.permissions or {}) do
        if p == '*' or p == node then return true end
    end
    return false
end

--- Is this actor the master? (every rank is his to manage; others manage only the ranks below them)
function Perms.isMaster(actor)
    return type(actor) == 'table' and Perms.canon(actor.group) == MASTER
end

function Perms.level(group)
    local r = Perms.get(group)
    return r and r.lvl or 0
end

--- Can `actor` act on someone holding `targetGroup`? Strictly greater, so two people at the same
--- level cannot act on each other in a loop. (The master's order is 1000: above every other rank.)
function Perms.outranks(actor, targetGroup)
    if type(actor) ~= 'table' then return false end
    return Perms.level(actor.group) > Perms.level(targetGroup)
end

--- The master manages every rank. Staff holding `manage_permissions` manage the ranks strictly below their
--- own level, and give only what they hold themselves (owner, 2026-10-24: an admin with every permission
--- could not make a rank from the site).
function Perms.managesLevel(actor, lvl)
    if Perms.isMaster(actor) then return true end
    if type(actor) ~= 'table' then return false end
    return (tonumber(lvl) or 0) < Perms.level(actor.group)
end

-- the in-game admin levels: god holds admin, admin holds mod (permissions.cfg add_principal)
local GAME_LEVELS = { ['group.mod'] = 1, ['group.admin'] = 2, ['group.god'] = 3 }

--- May `actor` put this node into a rank? Only a node he holds (an in-game level covers the ones below it).
function Perms.mayGive(actor, node)
    if Perms.has(actor, node) then return true end
    local want = GAME_LEVELS[node]
    if not want then return false end
    for other, lv in pairs(GAME_LEVELS) do
        if lv > want and Perms.has(actor, other) then return true end
    end
    return false
end

--- Build the actor the dispatcher passes to handlers, or nil if the website named a rank this server
--- does not have.
---
--- Failing closed here is deliberate. The old bridge fell back to `owner` for an unrecognised
--- group, so an unknown role became the MOST privileged role on the server — the exact inversion of
--- what a fallback should do, and it fires on ordinary drift: rename a role in the panel while an
--- action is queued, or point a server at a site whose role names have moved on.
function Perms.actorFrom(raw)
    if type(raw) ~= 'table' then return nil end
    local role = Perms.get(raw.group)
    if not role then return nil end
    return {
        group = role.name,
        level = role.lvl,
        label = raw.label or raw.name or 'Web Admin',
        -- the site sends no license: its Discord id names the staff member in wc_logs (2026-10-22, web
        -- actions had an empty admin_identifier, so per-admin logs never found them)
        identifier = raw.identifier or raw.license
            or (raw.discord and ('discord:' .. tostring(raw.discord):gsub('%D', ''))) or nil,
        discord = raw.discord and tostring(raw.discord):gsub('%D', '') or nil,
    }
end

--- The staff entry of an identifier, or nil: { identifier, group (his highest rank), groups, username,
--- locked }. An identifier held under several forms (license / steam) is the w_core member it names.
function Perms.adminOf(identifier)
    identifier = Perms.normalizeIdentifier(identifier)
    local m = identifier and Perms.members[identifier]
    if not m or type(m.ranks) ~= 'table' or #m.ranks == 0 then return nil end
    local best
    for _, rank in ipairs(m.ranks) do
        local r = Perms.roles[rank]
        if r and (not best or r.lvl > best.lvl) then best = r end
    end
    if not best then return nil end
    return {
        identifier = m.identifier, group = best.name, groups = m.ranks, username = m.name or '',
        locked = m.locked or {}, online = m.online,
    }
end

-- w_core's answers in the website's vocabulary (the panel shows the message as it comes)
local RANK_ERRORS = {
    no_access = 'only_the_master_manages_ranks', err_rank_name = 'invalid_role_name',
    err_rank_label = 'invalid_role_label', err_rank_node = 'invalid_permission',
    err_rank_too_many = 'too_many_permissions', err_rank_protected = 'role_is_protected',
    err_rank_unknown = 'role_not_found', err_rank_identifier = 'invalid_identifier',
    err_player_offline = 'player_not_online', err_rank_not_held = 'not_an_admin',
    err_rank_locked = 'owner_from_server_config', err_rank_discord = 'invalid_discord_role',
    err_ranks_loading = 'ranks_loading', err_db = 'database_error',
}
function Perms.rankError(key) return RANK_ERRORS[key] or tostring(key or 'failed') end

-- the ranks change in game (the Ranks page), from here, or at w_core's boot: read them again
AddEventHandler('w_core:ranks:changed', function() Perms.load() end)
AddEventHandler('onResourceStart', function(res)
    if res == 'w_core' then SetTimeout(3000, Perms.load) end
end)

CreateThread(function()
    Schema.await()
    -- w_core reads the ranks from the database at its own boot: until then only the master is known
    while true do
        Perms.load()
        Wait(60000)
    end
end)
