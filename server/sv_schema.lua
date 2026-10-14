--- Every table w_connector owns, created on boot.
---
--- The `wc_` prefix is deliberate. w_admin's tables (`bans`, `admin_data`, `admin_roles`,
--- `player_warnings`, `player_reports`, `whitelist_data`, `admin_logs`) keep their own names and
--- their own data; nothing here reads or writes them. An owner switching from one to the other runs
--- sql/import_from_w_admin.sql once, by hand, and decides for themselves what carries over.
---
--- Four tables from w_admin's schema are deliberately NOT recreated: `admin_chat_messages`,
--- `permission_cooldowns`, `permission_logs` and `server_test_metrics`. All four exist in its SQL
--- file and are referenced by zero lines of its Lua.

Schema = { ready = false }

local STATEMENTS = {
    --- Bans. `identifier` is the character identifier the panel acts on; `steam_hex` is kept
    --- separately because a player's bans should follow the account, not one character.
    [[CREATE TABLE IF NOT EXISTS `wc_bans` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `steam_hex` VARCHAR(100) NOT NULL DEFAULT '',
        `discord_id` VARCHAR(32) NOT NULL DEFAULT '',
        `username` VARCHAR(100) NOT NULL DEFAULT '',
        `character_name` VARCHAR(100) NOT NULL DEFAULT '',
        `reason` TEXT,
        `banned_by` VARCHAR(100) NOT NULL DEFAULT '',
        `ban_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `duration` VARCHAR(32) NOT NULL DEFAULT 'permanent',
        `expiry_date` TIMESTAMP NULL DEFAULT NULL,
        `ban_type` ENUM('temporary','permanent') NOT NULL DEFAULT 'permanent',
        `severity` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
        `appeal_status` ENUM('none','pending','accepted','rejected') NOT NULL DEFAULT 'none',
        `previous_bans` INT NOT NULL DEFAULT 0,
        `ip_address` VARCHAR(64) NOT NULL DEFAULT '',
        `avatar` VARCHAR(255) NOT NULL DEFAULT '',
        `is_active` TINYINT(1) NOT NULL DEFAULT 1,
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX `idx_active` (`is_active`),
        INDEX `idx_identifier` (`identifier`),
        INDEX `idx_steam` (`steam_hex`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    --- The admin roster. `group` is a role name in wc_roles.
    [[CREATE TABLE IF NOT EXISTS `wc_admins` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `identifier` VARCHAR(100) NOT NULL,
        `group` VARCHAR(64) NOT NULL DEFAULT 'moderator',
        `username` VARCHAR(100) NOT NULL DEFAULT '',
        `discord_id` VARCHAR(32) NOT NULL DEFAULT '',
        `resolved_reports` INT NOT NULL DEFAULT 0,
        `assigned_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `last_updated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        `is_active` TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY `uniq_identifier` (`identifier`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    --- Roles. This table is the single source of truth for permissions in BOTH the game and the
    --- website — src/features/sites/siteRoles.ts derives every website permission from the
    --- `site.*` nodes stored here. It is seeded once on first boot and then owned entirely by the
    --- website's Roles tab.
    [[CREATE TABLE IF NOT EXISTS `wc_roles` (
        `name` VARCHAR(64) NOT NULL PRIMARY KEY,
        `label` VARCHAR(100) NOT NULL DEFAULT '',
        `color` VARCHAR(32) NOT NULL DEFAULT '',
        `lvl` INT NOT NULL DEFAULT 1,
        `permissions` LONGTEXT,
        `protected` TINYINT(1) NOT NULL DEFAULT 0,
        `discord_role_id` VARCHAR(32) NOT NULL DEFAULT '',
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_warnings` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `player_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `steam_hex` VARCHAR(100) NOT NULL DEFAULT '',
        `reason` TEXT,
        `severity` ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        `warned_by` VARCHAR(100) NOT NULL DEFAULT '',
        `warn_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `is_active` TINYINT(1) NOT NULL DEFAULT 1,
        INDEX `idx_player` (`player_identifier`, `is_active`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_reports` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `title` VARCHAR(200) NOT NULL DEFAULT '',
        `description` TEXT,
        `report_type` VARCHAR(32) NOT NULL DEFAULT 'other',
        `priority` VARCHAR(16) NOT NULL DEFAULT 'normal',
        `status` ENUM('open','claimed','resolved') NOT NULL DEFAULT 'open',
        `reporter_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `reporter_username` VARCHAR(100) NOT NULL DEFAULT '',
        `reporter_avatar` VARCHAR(255) NOT NULL DEFAULT '',
        `reported_player_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `reported_player_username` VARCHAR(100) NOT NULL DEFAULT '',
        `claimed_by` VARCHAR(100) NULL DEFAULT NULL,
        `claimed_avatar` VARCHAR(255) NULL DEFAULT NULL,
        `claimed_at` TIMESTAMP NULL DEFAULT NULL,
        `resolved_by` VARCHAR(100) NULL DEFAULT NULL,
        `resolved_at` TIMESTAMP NULL DEFAULT NULL,
        `admin_notes` TEXT,
        `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX `idx_status` (`status`),
        INDEX `idx_created` (`created_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_report_messages` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `report_id` INT NOT NULL,
        `sender_type` ENUM('player','admin','system') NOT NULL DEFAULT 'player',
        `sender_name` VARCHAR(100) NOT NULL DEFAULT '',
        `sender_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `message` TEXT,
        `image` VARCHAR(500) NULL DEFAULT NULL,
        `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX `idx_report` (`report_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_whitelist` (
        `steam_hex` VARCHAR(100) NOT NULL PRIMARY KEY,
        `username` VARCHAR(100) NOT NULL DEFAULT '',
        `character_name` VARCHAR(100) NOT NULL DEFAULT '',
        `discord_id` VARCHAR(32) NOT NULL DEFAULT '',
        `status` ENUM('active','suspended','expired','pending') NOT NULL DEFAULT 'active',
        `added_by` VARCHAR(100) NOT NULL DEFAULT '',
        `added_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `last_login` VARCHAR(64) NOT NULL DEFAULT 'never',
        `reason` TEXT,
        `avatar` VARCHAR(255) NOT NULL DEFAULT '',
        `is_online` TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    --- Logs are written through, not buffered. w_admin held the whole table in memory and flushed
    --- every ten minutes, so a crash lost up to ten minutes of audit trail and memory grew with
    --- history.
    [[CREATE TABLE IF NOT EXISTS `wc_logs` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `admin_username` VARCHAR(100) NOT NULL DEFAULT '',
        `admin_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `action_type` VARCHAR(32) NOT NULL DEFAULT 'system',
        `action` VARCHAR(200) NOT NULL DEFAULT '',
        `details` TEXT,
        `target_player` VARCHAR(100) NOT NULL DEFAULT '',
        `target_identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `severity` ENUM('low','medium','high') NOT NULL DEFAULT 'low',
        `ip_address` VARCHAR(64) NOT NULL DEFAULT '',
        `avatar` VARCHAR(255) NOT NULL DEFAULT '',
        `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX `idx_type` (`action_type`),
        INDEX `idx_time` (`timestamp`),
        INDEX `idx_admin` (`admin_identifier`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    --- Staff chat. w_admin kept this in a JSON file rewritten on every message, which does not
    --- survive two admins typing at once, and broadcast each message to every player on the server
    --- rather than to staff.
    [[CREATE TABLE IF NOT EXISTS `wc_chat` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `sender_id` VARCHAR(100) NOT NULL DEFAULT '',
        `sender_name` VARCHAR(100) NOT NULL DEFAULT '',
        `sender_avatar` VARCHAR(255) NOT NULL DEFAULT '',
        `sender_role` VARCHAR(64) NOT NULL DEFAULT '',
        `message` TEXT,
        `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX `idx_time` (`timestamp`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_avatars` (
        `identifier` VARCHAR(100) NOT NULL PRIMARY KEY,
        `steam_hex` VARCHAR(100) NOT NULL DEFAULT '',
        `discord_id` VARCHAR(32) NOT NULL DEFAULT '',
        `discord_username` VARCHAR(100) NOT NULL DEFAULT '',
        `avatar_url` VARCHAR(255) NOT NULL DEFAULT '',
        `avatar_source` ENUM('discord','steam','default') NOT NULL DEFAULT 'default',
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    --- Playtime, because VORP does not record any.
    ---
    --- w_admin read playtime through `w_lib`, and the panel sorts its leaderboard by it — but VORP's
    --- `characters` table has no such column, so on a VORP server that number was whatever the
    --- library invented, and the leaderboard's default sort ordered by nothing. A sampler adds sixty
    --- seconds per online character per minute, which is the only honest way to have the figure at
    --- all.
    [[CREATE TABLE IF NOT EXISTS `wc_playtime` (
        `char_id` INT NOT NULL PRIMARY KEY,
        `identifier` VARCHAR(100) NOT NULL DEFAULT '',
        `seconds` BIGINT NOT NULL DEFAULT 0,
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_metrics_hourly` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `bucket` DATETIME NOT NULL,
        `avg_players` FLOAT NOT NULL DEFAULT 0,
        `peak_players` INT NOT NULL DEFAULT 0,
        `samples` INT NOT NULL DEFAULT 0,
        UNIQUE KEY `uniq_bucket` (`bucket`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],

    [[CREATE TABLE IF NOT EXISTS `wc_metrics_daily` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `day` DATE NOT NULL,
        `avg_players` FLOAT NOT NULL DEFAULT 0,
        `peak_players` INT NOT NULL DEFAULT 0,
        `total_money` DOUBLE NOT NULL DEFAULT 0,
        `total_gold` DOUBLE NOT NULL DEFAULT 0,
        `total_characters` INT NOT NULL DEFAULT 0,
        UNIQUE KEY `uniq_day` (`day`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]],
}

--- The permission vocabulary. This list IS the contract with the website: the Roles tab renders it
--- verbatim, and the `Website` category is what src/features/sites/siteRoles.ts maps onto site
--- permissions. Adding a node here makes it selectable in the panel; removing one silently strips
--- it from every role that had it, so treat this as append-only.
PERMISSION_NODES = {
    { category = 'General', nodes = {
        'access_admin_panel', 'access_logs',
    } },
    { category = 'Players', nodes = {
        'players_page', 'player.kick', 'player.warn', 'player.removewarn', 'player.heal',
        'player.revive', 'player.respawn', 'player.kill', 'player.freeze', 'player.spectate',
        'player.message', 'player.troll', 'player.removeweapon',
        'player.teleport.to_player', 'player.teleport.bring',
        'player.inventory.remove_items', 'player.inventory.clear',
        'add.item.to_player', 'remove.item.from_player',
    } },
    { category = 'Bans', nodes = {
        'show_banned_players', 'ban_history', 'edit_ban', 'unban_player',
        'player.ban.temporary', 'player.ban.permanent', 'get_player_warnings',
    } },
    { category = 'Character', nodes = {
        'set.nickname', 'set.firstname', 'set.lastname', 'set.age', 'set.chardescription',
        'set.jobwithgrade', 'set.joblabel', 'set.jobgrade',
        'currency.addorremove', 'add.xp', 'remove.xp',
    } },
    { category = 'Whitelist', nodes = {
        'whitelist.view', 'whitelist.add', 'whitelist.edit',
        'whitelist.remove', 'whitelist.suspend', 'whitelist.activate', 'whitelist.approve',
    } },
    { category = 'Staff', nodes = {
        'admins.view', 'admin.action', 'change.admin.role', 'manage_permissions',
        'adminchat.view', 'adminchat.send', 'ignore_while_kicking_allplayers',
    } },
    { category = 'Reports', nodes = {
        'admin.reports.view', 'admin.reports.claim', 'admin.reports.resolve',
        'admin.reports.reopen', 'admin.reports.message',
    } },
    { category = 'Server', nodes = {
        'view.statistics', 'view.livemap', 'livemap.action',
        'resource.action', 'refresh_resources', 'schedule_restart', 'send_announcement',
        'close_server_for_players', 'admin.kickall',
        'server.time.control', 'server.weather.control', 'server.timescale.control',
        'server.wind.control', 'server.syncdelay.control',
    } },
    --- Read by the WEBSITE, not by the game. src/features/sites/siteRoles.ts maps each of these
    --- onto a site permission, which is what makes the game roles and the site roles one system
    --- rather than two.
    { category = 'Website', nodes = {
        'site.manage', 'site.rules', 'site.applications', 'site.bans',
        'site.store', 'site.shop', 'site.login',
    } },
}

--- The roles a fresh install starts with. Seeded once; after that the website's Roles tab owns the
--- table and this is never consulted again.
---
--- `helper` gets an explicit node list rather than a wildcard so the cheapest staff role is
--- genuinely limited out of the box. The other four get '*' because an owner who has just installed
--- the resource needs to be able to do everything before they have configured anything.
local SEED_ROLES = {
    { name = 'helper', label = 'Helper', color = '#22c55e', lvl = 1, protected = 0, permissions = {
        'access_admin_panel', 'players_page', 'player.kick', 'player.warn', 'player.heal',
        'player.revive', 'player.respawn', 'player.freeze', 'player.message',
        'player.teleport.to_player', 'player.teleport.bring',
        'show_banned_players', 'ban_history', 'get_player_warnings', 'player.ban.temporary',
        'whitelist.view', 'admins.view', 'adminchat.view', 'adminchat.send',
        'admin.reports.view', 'admin.reports.claim', 'admin.reports.message',
        'view.statistics', 'view.livemap', 'access_logs',
    } },
    { name = 'moderator', label = 'Moderator', color = '#3b82f6', lvl = 2, protected = 0, permissions = { '*' } },
    { name = 'admin', label = 'Admin', color = '#a855f7', lvl = 3, protected = 0, permissions = { '*' } },
    { name = 'headadmin', label = 'Head Admin', color = '#f59e0b', lvl = 4, protected = 0, permissions = { '*' } },
    { name = 'owner', label = 'Owner', color = '#ef4444', lvl = 5, protected = 1, permissions = { '*' } },
}

local function seedRoles()
    local existing = MySQL.query.await('SELECT `name` FROM `wc_roles`') or {}
    if #existing > 0 then return end
    for _, r in ipairs(SEED_ROLES) do
        MySQL.insert.await(
            'INSERT IGNORE INTO `wc_roles` (`name`,`label`,`color`,`lvl`,`permissions`,`protected`,`discord_role_id`) VALUES (?,?,?,?,?,?,?)',
            { r.name, r.label, r.color, r.lvl, json.encode(r.permissions), r.protected, '' })
    end
    -- print('^2[w_connector]^0 seeded ' .. #SEED_ROLES .. ' default roles into wc_roles.')
end

--- Without this, a fresh install has no administrators and no in-game way to create one — there is
--- no panel to open. `owner` is correct here: the identifiers come from server.cfg, which only
--- someone with server access can edit.
local function seedOwners()
    for _, ident in ipairs(Config.defaultOwners) do
        MySQL.insert.await(
            'INSERT INTO `wc_admins` (`identifier`,`group`,`username`) VALUES (?,?,?) ' ..
            'ON DUPLICATE KEY UPDATE `group` = VALUES(`group`), `is_active` = 1',
            { ident, 'owner', 'Server Owner' })
    end
    if #Config.defaultOwners > 0 then
        -- print('^2[w_connector]^0 ensured ' .. #Config.defaultOwners .. ' owner(s) from w_connector_owners.')
    end
end

-- ── one collation for the ids (utf8mb4_general_ci) ──────────────────────────
-- players.citizenid and the tables that store an id are utf8mb4_general_ci. MySQL refuses "="
-- between two columns of different implicit collations ("Illegal mix of collations"), so a table
-- left in another one breaks every JOIN or IN (SELECT ...) that meets players: w_admin's list of
-- blocked characters failed that way. The CREATE statements name the collation now; this converts
-- a table created before them, once (information_schema shows nothing left to do on the next
-- start). keep = { [table] = { [column] = 'its definition' } }: a column binary on purpose (JSON)
-- is put back after the conversion. A table is left as it is, with the reason printed, when a
-- unique key would merge two of its values under the new collation (the ALTER would stop on a
-- duplicate key, or two ids would become one) or when it holds a binary column nobody named.
local ID_COLLATION = 'utf8mb4_general_ci'
local function alignCollation(db, tag, tables, keep)
    keep = keep or {}
    for _, t in ipairs(tables) do
        local ok, err = pcall(function()
            local current = db.scalar.await('SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', { t })
            if not current then return end
            local kept, todo, binary, needed = keep[t] or {}, {}, nil, current ~= ID_COLLATION
            for _, c in ipairs(db.query.await('SELECT COLUMN_NAME AS n, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLLATION_NAME IS NOT NULL', { t }) or {}) do
                if c.k ~= ID_COLLATION and not kept[c.n] then
                    todo[c.n], needed = true, true
                    if c.k:sub(-4) == '_bin' then binary = c.n end
                end
            end
            if not needed then return end
            if binary then error(('column %s is binary and nobody said to keep it'):format(binary), 0) end
            -- every unique key holding a converted column, grouped the way the new collation compares
            local keys = {}
            for _, s in ipairs(db.query.await('SELECT INDEX_NAME AS i, COLUMN_NAME AS n, SUB_PART AS p FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 ORDER BY INDEX_NAME, SEQ_IN_INDEX', { t }) or {}) do
                local key = keys[s.i] or { by = {}, set = {} }
                keys[s.i] = key
                local e = ('`%s`'):format(s.n)
                if todo[s.n] then e, key.text = ('CONVERT(`%s` USING utf8mb4) COLLATE %s'):format(s.n, ID_COLLATION), true end
                if tonumber(s.p) then e = ('LEFT(%s, %d)'):format(e, tonumber(s.p)) end
                key.by[#key.by + 1], key.set[#key.set + 1] = e, ('`%s` IS NOT NULL'):format(s.n)
            end
            for name, key in pairs(keys) do
                if key.text and (tonumber(db.scalar.await(('SELECT COUNT(*) FROM (SELECT 1 FROM `%s` WHERE %s GROUP BY %s HAVING COUNT(*) > 1) d')
                    :format(t, table.concat(key.set, ' AND '), table.concat(key.by, ', ')))) or 0) > 0 then
                    error(('unique key %s would merge two of its values'):format(name), 0)
                end
            end
            db.query.await(('ALTER TABLE `%s` CONVERT TO CHARACTER SET utf8mb4 COLLATE %s'):format(t, ID_COLLATION))
            for _, def in pairs(kept) do db.query.await(('ALTER TABLE `%s` MODIFY %s'):format(t, def)) end
            print(('^3[%s] %s converted to %s^0'):format(tag, t, ID_COLLATION))
        end)
        if not ok then print(('^1[%s] %s keeps its collation: %s^0'):format(tag, t, tostring(err))) end
    end
end

CreateThread(function()
    for _, sql in ipairs(STATEMENTS) do
        local ok, err = pcall(function() MySQL.query.await(sql) end)
        if not ok then
            print('^1[w_connector] schema error:^0 ' .. tostring(err))
        end
    end
    -- every wc_ table was created utf8mb4_unicode_ci before; identifier / char ids are compared with
    -- players and with the other resources' tables. The names are read from the statements above.
    local owned = {}
    for _, sql in ipairs(STATEMENTS) do owned[#owned + 1] = sql:match('CREATE TABLE IF NOT EXISTS `([%w_]+)`') end
    alignCollation(MySQL, 'w_connector', owned)
    -- (2026-10-14) No more seeding: the roles and the owners are w_core's staff ranks now (the master
    -- comes from w_ranks:masters, see sv_perms.lua). wc_roles is no longer read; seedRoles/seedOwners
    -- are kept below only so an older copy of this resource reading them still finds them.
    Schema.ready = true
    -- print('^2[w_connector]^0 schema ready.')
end)

--- Block until the tables exist. Anything that queries on boot calls this first, so a slow database
--- delays startup instead of producing a table-not-found error that looks like a broken install.
function Schema.await(timeoutMs)
    local waited = 0
    local limit = timeoutMs or 30000
    while not Schema.ready and waited < limit do
        Wait(100)
        waited = waited + 100
    end
    return Schema.ready
end
