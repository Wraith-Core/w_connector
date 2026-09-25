--- Roles — the single permission system, shared by the game and the website.
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

Registry.invoke('adminpanel:saveRole', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    -- Sanitised to the vocabulary the rest of the system assumes: the name is a primary key, it is
    -- interpolated into log lines, and it is compared against `actor.group` on every request.
    local name = tostring(args.name or ''):lower():gsub('[^a-z0-9_]', '')
    if name == '' then return H.fail('invalid_role_name') end

    local lvl = H.clamp(args.lvl, 1, 99, 1)
    local myLevel = Perms.level(actor.group)

    -- You cannot mint a role that outranks you and then put yourself in it. Equal is allowed —
    -- an owner needs to be able to create a second owner — but above is not.
    if lvl > myLevel then return H.fail('cannot_create_role_above_your_own') end

    -- Nor edit one that already outranks you.
    local existing = Perms.get(name)
    if existing and existing.lvl > myLevel then return H.fail('cannot_modify_role_above_your_own') end

    local permissions = type(args.permissions) == 'table' and args.permissions or {}
    -- Only an actor who already holds the wildcard may hand it out.
    for _, p in ipairs(permissions) do
        if p == '*' and not Perms.has(actor, '*') then return H.fail('cannot_grant_wildcard') end
    end

    MySQL.insert.await(
        'INSERT INTO `wc_roles` (`name`,`label`,`color`,`lvl`,`permissions`,`protected`,`discord_role_id`) ' ..
        'VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `label`=VALUES(`label`), `color`=VALUES(`color`), ' ..
        '`lvl`=VALUES(`lvl`), `permissions`=VALUES(`permissions`), `discord_role_id`=VALUES(`discord_role_id`)',
        { name, H.str(args.label, 100), H.str(args.color, 32), lvl, json.encode(permissions),
          existing and (existing.protected and 1 or 0) or 0,
          H.str(args.discordRoleId or args.discord_role_id, 32) })

    Perms.load()
    Log.write(actor, 'admin_action', existing and 'Updated role' or 'Created role', name, { severity = 'high' })
    return H.ok()
end)

Registry.invoke('adminpanel:deleteRole', 'manage_permissions', function(actor, args)
    args = type(args) == 'table' and args or {}
    local name = tostring(args.name or ''):lower():gsub('[^a-z0-9_]', '')
    if name == '' then return H.fail('invalid_role_name') end
    if name == 'owner' then return H.fail('cannot_delete_owner') end

    local role = Perms.get(name)
    if not role then return H.fail('role_not_found') end
    if role.protected then return H.fail('role_is_protected') end
    -- Equal is allowed, matching saveRole: an owner who created a second owner-level role must be
    -- able to remove it again. Above is not.
    if role.lvl > Perms.level(actor.group) then return H.fail('cannot_delete_role_above_your_own') end

    -- Anyone still holding this role would keep a group name that resolves to nothing, and every
    -- one of their requests would then be refused with `unknown_group` — which reads as "the panel
    -- is broken", not "your role was deleted". Move them somewhere real first.
    local orphaned = MySQL.update.await(
        'UPDATE `wc_admins` SET `group` = ? WHERE `group` = ?', { 'moderator', name })

    MySQL.update.await('DELETE FROM `wc_roles` WHERE `name` = ? AND `protected` = 0', { name })
    Perms.load()

    Log.write(actor, 'admin_action', 'Deleted role',
        ('%s (%d staff moved to moderator)'):format(name, tonumber(orphaned) or 0), { severity = 'high' })
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

--- The Discord role a member holds, translated into the highest-ranked matching w_connector role.
local function roleFromDiscord(discordId)
    if Config.discordToken == '' or Config.discordGuild == '' or not discordId or discordId == '' then
        return nil
    end
    local p = promise.new()
    local settled = false
    local function done(v) if not settled then settled = true; p:resolve(v) end end
    PerformHttpRequest(('%s/guilds/%s/members/%s'):format(DISCORD_API, Config.discordGuild, discordId),
        function(code, body)
            if code == 200 and body and body ~= '' then
                local ok, data = pcall(json.decode, body)
                done(ok and data or nil)
            else
                done(nil)
            end
        end, 'GET', '', { ['Authorization'] = 'Bot ' .. Config.discordToken })
    SetTimeout(8000, function() done(nil) end)

    local member = Citizen.Await(p)
    if type(member) ~= 'table' or type(member.roles) ~= 'table' then return nil end

    local held = {}
    for _, id in ipairs(member.roles) do held[tostring(id)] = true end

    local best
    for _, role in ipairs(Perms.list()) do
        if role.discordRoleId ~= '' and held[role.discordRoleId] then
            if not best or role.lvl > best.lvl then best = role end
        end
    end
    return best
end

Registry.invoke('adminpanel:syncDiscordRoles', 'manage_permissions', function(actor)
    if Config.discordToken == '' or Config.discordGuild == '' then
        return H.fail('discord_not_configured')
    end

    local changed, checked = 0, 0
    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid)
        if p and p.discordId and p.identifier then
            checked = checked + 1
            local role = roleFromDiscord(p.discordId)
            if role then
                local existing = Perms.adminOf(p.identifier)
                if not existing or existing.group ~= role.name then
                    MySQL.insert.await(
                        'INSERT INTO `wc_admins` (`identifier`,`group`,`username`,`discord_id`) VALUES (?,?,?,?) ' ..
                        'ON DUPLICATE KEY UPDATE `group` = VALUES(`group`), `is_active` = 1',
                        { p.identifier, role.name, p.username or '', p.discordId })
                    changed = changed + 1
                end
            end
            -- Spaced so a full server does not become a burst of member lookups against Discord.
            Wait(200)
        end
    end

    Log.write(actor, 'admin_action', 'Synced Discord roles',
        ('%d checked, %d updated'):format(checked, changed))
    return H.ok(('%d checked, %d updated'):format(checked, changed))
end)
