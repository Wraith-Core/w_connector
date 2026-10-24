--- Roles — the single permission system, shared by the game and the website.
---
--- (2026-10-14) The roles ARE the game's staff ranks now: w_core server/ranks.lua keeps them
--- (w_ranks), the in-game Ranks page and this file both edit them. The master -- the website's `owner` --
--- manages every rank; since 2026-10-24 (owner) staff holding `manage_permissions` manage the ranks below
--- their own level from the site too, with only the permissions they hold (Perms.managesLevel/mayGive).
--- A rank's website permissions (PERMISSION_NODES) sit beside its
--- in-game ones: saving from here replaces the website ones and keeps the in-game ones untouched.
---
--- `adminpanel:getRolesAndPermissions` is the most load-bearing call in the whole resource. It is
--- invoked by src/features/redm/redmActor.ts BEFORE EVERY PANEL ACTION to decide which role a staff
--- member is acting as, by matching their Discord roles against `discordRoleId`. If its shape
--- changes, every action in the panel starts returning `roles_unavailable`.
---
--- The `Website` node category is equally load-bearing in the other direction:
--- src/features/sites/siteRoles.ts maps `site.manage`, `site.rules`, `site.applications`,
--- `site.bans`, `site.store`, `site.shop` and `site.login` onto website permissions. That mapping is
--- what makes the game roles and the site roles ONE system instead of two that drift apart.

local DISCORD_API = 'https://discord.com/api/v10'

--- Reading the list is a lower bar than editing it: the Players and Staff tabs both call this just
--- to populate a role dropdown, and gating that behind `manage_permissions` — as w_admin did —
--- leaves a moderator staring at an empty picker with no explanation.
Registry.invoke('adminpanel:getRolesAndPermissions', 'admins.view', function()
    return { roles = Perms.list(), nodes = PERMISSION_NODES }
end)

--- Every node of the website's vocabulary, as a set (a rank's other nodes are the game's)
local function webNodeSet()
    local set = {}
    for _, cat in ipairs(PERMISSION_NODES) do
        for _, node in ipairs(cat.nodes) do set[node] = true end
    end
    return set
end

Registry.invoke('adminpanel:saveRole', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local api = Perms.core()
    if not api then return H.fail('ranks_unavailable') end
    local master = Perms.isMaster(actor)

    -- Sanitised to the vocabulary the rest of the system assumes: the name is a primary key, it is
    -- interpolated into log lines, and it is compared against `actor.group` on every request.
    local name = tostring(args.name or ''):lower():gsub('[^a-z0-9_]', '')
    if name == '' then return H.fail('invalid_role_name') end
    if Perms.canon(name) == 'master' then return H.fail('role_is_protected') end

    local existing = Perms.get(name)
    -- below the master: a rank under one's own level, before and after the change
    if existing and not Perms.managesLevel(actor, existing.lvl) then return H.fail('rank_not_below_yours') end
    local lvl = H.clamp(args.lvl, 0, 999, existing and existing.lvl or 1)
    if not Perms.managesLevel(actor, lvl) then return H.fail('rank_not_below_yours') end
    -- and only the permissions one holds (those the rank already had may stay)
    local had = {}
    for _, node in ipairs(existing and existing.permissions or {}) do had[node] = true end
    local function mayGive(node) return master or had[node] or Perms.mayGive(actor, node) end

    local web = webNodeSet()
    -- the rank's in-game permissions stay as they are; the website's are the list the site sent
    local permissions, seen = {}, {}
    local function add(node)
        if type(node) == 'string' and not seen[node] then seen[node] = true; permissions[#permissions + 1] = node end
    end
    for _, node in ipairs(existing and existing.permissions or {}) do
        if not web[node] then add(node) end
    end
    local sent = type(args.permissions) == 'table' and args.permissions or {}
    for _, node in ipairs(sent) do
        if node == '*' then
            -- the website's "everything": every website node and the in-game panel (group.mod); the in-game
            -- admin and god levels are given only when ticked one by one
            for _, cat in ipairs(PERMISSION_NODES) do
                for _, n in ipairs(cat.nodes) do
                    if n ~= 'group.admin' and n ~= 'group.god' and mayGive(n) then add(n) end
                end
            end
        elseif web[node] then
            if not mayGive(node) then return H.fail('permission_not_yours') end
            add(node)
        end
    end
    -- staff who may use the website panel open the in-game one too (owner, 2026-10-23)
    if seen['access_admin_panel'] and not seen['group.admin'] and not seen['group.god'] and mayGive('group.mod') then
        add('group.mod')
    end
    -- and without it the in-game panel goes too: no in-game admin level is left ticked on its own
    if not seen['access_admin_panel'] then
        local kept = {}
        for _, node in ipairs(permissions) do
            if node ~= 'group.mod' and node ~= 'group.admin' and node ~= 'group.god' then kept[#kept + 1] = node end
        end
        permissions = kept
    end

    local ok, err = api:RanksSave(0, {
        name = name,
        label = H.str(args.label, 400),
        color = H.str(args.color, 16),
        sort = lvl,
        permissions = permissions,
        discord_role_id = H.str(args.discordRoleId or args.discord_role_id, 32),
    })
    if not ok then return H.fail(Perms.rankError(err)) end

    Perms.load()
    Log.write(actor, 'admin_action', existing and 'Updated role' or 'Created role', name, { severity = 'high' })
    return H.ok()
end)

Registry.invoke('adminpanel:deleteRole', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local api = Perms.core()
    if not api then return H.fail('ranks_unavailable') end
    local name = tostring(args.name or ''):lower():gsub('[^a-z0-9_]', '')
    if name == '' then return H.fail('invalid_role_name') end
    if Perms.canon(name) == 'master' then return H.fail('cannot_delete_owner') end

    local role = Perms.get(name)
    if not role then return H.fail('role_not_found') end
    if role.protected then return H.fail('role_is_protected') end
    if not Perms.managesLevel(actor, role.lvl) then return H.fail('rank_not_below_yours') end

    -- w_core takes the rank from every member with it (their other ranks stay)
    local ok, err = api:RanksDelete(0, name)
    if not ok then return H.fail(Perms.rankError(err)) end
    Perms.load()

    Log.write(actor, 'admin_action', 'Deleted role', name, { severity = 'high' })
    return H.ok()
end)

Registry.invoke('adminpanel:getDiscordRoles', 'manage_permissions', function()
    if Config.discordToken == '' or Config.discordGuild == '' then
        return { roles = {}, message = 'discord_not_configured' }
    end
    local p = promise.new()
    local settled = false
    local function done(v) if not settled then settled = true; p:resolve(v) end end
    PerformHttpRequest(('%s/guilds/%s/roles'):format(DISCORD_API, Config.discordGuild), function(code, body)
        if code == 200 and body and body ~= '' then
            local ok, data = pcall(json.decode, body)
            done(ok and data or nil)
        else
            done(nil)
        end
    end, 'GET', '', { ['Authorization'] = 'Bot ' .. Config.discordToken })
    SetTimeout(8000, function() done(nil) end)

    local data = Citizen.Await(p)
    if type(data) ~= 'table' then return { roles = {}, message = 'discord_unreachable' } end
    local roles = {}
    for _, r in ipairs(data) do
        if type(r) == 'table' and r.id then roles[#roles + 1] = { id = r.id, name = r.name } end
    end
    return { roles = roles }
end)

--- One member's roles just changed in Discord (the website's bot saw it): his ranks follow at once, so taking
--- the role takes the rank and the in-game admin with it (owner, 2026-10-23).
Registry.invoke('adminpanel:syncDiscordMember', 'manage_permissions', function(actor, args)
    if not Perms.isMaster(actor) then return H.fail('only_the_master_manages_ranks') end
    if not Perms.core() then return H.fail('ranks_unavailable') end
    local given, taken = DiscordRanks.syncDiscord(type(args) == 'table' and args.discord or nil)
    if not given then return H.fail(taken or 'error') end
    return H.ok(('+%d -%d'):format(given, taken))
end)

Registry.invoke('adminpanel:syncDiscordRoles', 'manage_permissions', function(actor)
    if not Perms.core() then return H.fail('ranks_unavailable') end
    -- the same sync as on join and every 10 minutes (sv_discordranks.lua): the roles come from the website,
    -- whose bot is in the panel's Discord; a rank a role gave is taken back when the role is gone
    local checked, given, taken = DiscordRanks.syncAll()
    Log.write(actor, 'admin_action', 'Synced Discord roles', ('%d checked, +%d -%d'):format(checked, given, taken))
    return H.ok(('%d checked, +%d -%d'):format(checked, given, taken))
end)
