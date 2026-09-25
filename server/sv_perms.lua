--- Roles and permission checks.
---
--- One system, not two. `wc_roles` is the source of truth for what a staff member may do in the
--- game AND on the website: src/features/sites/siteRoles.ts reads the `site.*` nodes out of the
--- same rows through `adminpanel:getRolesAndPermissions`. There is no second, website-only role
--- table, and adding one would guarantee the two drift.
---
--- There is also no synthetic session here. w_admin fabricated an admin at source -1000 with
--- `permissions = {'*'}` so its existing permission-checking functions could be reused unchanged —
--- which meant every web action ran with a wildcard and the real check happened somewhere else, if
--- at all. Handlers here receive the actor as an argument and the dispatcher checks the node before
--- calling them.

Perms = { roles = {}, loaded = false }

local function decode(raw)
    if type(raw) == 'table' then return raw end
    if type(raw) ~= 'string' or raw == '' then return {} end
    local ok, v = pcall(json.decode, raw)
    return (ok and type(v) == 'table') and v or {}
end

function Perms.load()
    local rows = MySQL.query.await(
        'SELECT `name`, `label`, `color`, `lvl`, `permissions`, `protected`, `discord_role_id` FROM `wc_roles`') or {}
    local out = {}
    for _, r in ipairs(rows) do
        out[r.name] = {
            name = r.name,
            label = r.label or r.name,
            color = r.color or '',
            lvl = tonumber(r.lvl) or 1,
            permissions = decode(r.permissions),
            protected = r.protected == true or tonumber(r.protected) == 1,
            discordRoleId = r.discord_role_id or '',
        }
    end
    Perms.roles = out
    Perms.loaded = true
    return out
end

function Perms.get(group)
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
--- `*` means everything. There is no other wildcard — `player.*` does NOT match `player.kick`.
--- That matches w_admin exactly, and it has to: the website already stores node lists picked
--- against this vocabulary, and quietly making prefixes match would widen every existing role the
--- moment this shipped.
function Perms.has(actor, node)
    if type(actor) ~= 'table' then return false end
    local role = Perms.get(actor.group)
    if not role then return false end
    for _, p in ipairs(role.permissions or {}) do
        if p == '*' or p == node then return true end
    end
    return false
end

function Perms.level(group)
    local r = Perms.get(group)
    return r and r.lvl or 0
end

--- Can `actor` act on someone holding `targetGroup`?
---
--- w_admin only asked this in `removeAdmin`. `setPermission` and `changeAdminRole` did not, so
--- anyone with `manage_permissions` could promote anyone — including themselves — to owner. Strictly
--- greater, so two people at the same level cannot demote each other in a loop.
function Perms.outranks(actor, targetGroup)
    if type(actor) ~= 'table' then return false end
    return Perms.level(actor.group) > Perms.level(targetGroup)
end

--- Build the actor the dispatcher passes to handlers, or nil if the website named a group this
--- server does not have.
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
        identifier = raw.identifier or raw.license,
        discord = raw.discord and tostring(raw.discord):gsub('%D', '') or nil,
    }
end

--- The admin roster row for an identifier, or nil.
function Perms.adminOf(identifier)
    if not identifier or identifier == '' then return nil end
    return MySQL.single.await(
        'SELECT `id`, `identifier`, `group`, `username`, `discord_id`, `resolved_reports`, ' ..
        '`assigned_date`, `last_updated` FROM `wc_admins` WHERE `identifier` = ? AND `is_active` = 1',
        { identifier })
end

CreateThread(function()
    Schema.await()
    Perms.load()
    -- print(('^2[w_connector]^0 loaded %d roles from wc_roles.'):format(#Perms.list()))
end)
