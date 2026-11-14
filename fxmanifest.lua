fx_version 'cerulean'
games { 'rdr3', 'gta5' }
lua54 'yes'
rdr3_warning 'I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.'

name 'w_connector'
author 'Wraith Studio'
version '2.7.6' -- 2.7.2 (2026-11-08) = website staff permissions no longer drop now and then (parent nodes removed first); 2.7.1 (2026-11-08) = the quick menu docks on the right in both languages again, as before 2.7.0
description 'Wraith Connector v2 — links a FiveM or RedM server to its Wraith control panel.'

-- The website bridge, join queue and /wadmin menu share this resource.
-- Menu actions are authorised again on the server and control panel.
--
-- server.cfg — paste the token from your panel:
--     set wraith_token "wc2.k…"
--     ensure w_connector        (after your framework and inventory)
--
-- Optional:
--     set wraith_framework "vorp"    (wcore, vorp, rsg, esx, qbcore, qbox — skips detection)
--     set wraith_inventory "ox_inventory"
--     set wraith_endpoint "https://…/api/connector/v2"   (staging only)
--     add_ace resource.w_connector command allow    (lets the panel run console commands)
--     set wraith_join_fail_closed "true"                 (refuse joins while the panel is unreachable)
--     set wraith_report_command "report"                 (the in-game report command; "off" disables it)

dependencies { 'oxmysql' }

-- The original full console (F10) and quick menu (Page Up) share NUI with the spectate streamer.
-- nui/index.html loads both (docs/admin-platform/08-ingame-menu.md). capture.html stays as the streamer alone.
ui_page 'web/build/index.html'
files { 'web/build/**/*', 'nui/capture.html', 'nui/spectate.js', 'core/console_contract.json', 'core/console_models.json', 'locales/ar.json', 'locales/en.json' }

client_scripts { 'client/cl_actions.lua', 'client/cl_death.lua', 'client/cl_spectate.lua', 'client/cl_map.lua', 'client/cl_console.lua', 'client/cl_menu_self.lua', 'client/cl_console_tools.lua', 'client/cl_blips.lua', 'client/cl_jail.lua' }

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'core/sha256.lua',
    'core/util.lua',
    'core/registry.lua',
    -- Adapters register in detection order; the first whose detect() succeeds is used.
    -- Order matters where one resource `provide`s another's name: qbx_core provides qb-core,
    -- w_core provides rsg-core and vorp_core, w_inventory provides vorp/rsg-inventory and
    -- ox_inventory answers as vorp_inventory.
    'adapters/framework/wcore.lua',
    'adapters/framework/qbox.lua',
    'adapters/framework/esx.lua',
    'adapters/framework/qbcore.lua',
    'adapters/framework/rsg.lua',
    'adapters/framework/vorp.lua',
    'adapters/inventory/w_inventory.lua',
    'adapters/inventory/ox_inventory.lua',
    'adapters/inventory/qb_inventory.lua',
    'adapters/inventory/rsg_inventory.lua',
    'adapters/inventory/vorp_inventory.lua',
    'adapters/inventory/esx_builtin.lua',
    'ops/players.lua',
    'ops/inventory.lua',
    'ops/server.lua',
    'ops/character.lua',
    'ops/world.lua',
    'ops/modules.lua',
    'ops/migrate.lua',
    'ops/control.lua',
    'ops/wraith_admin.lua',
    'ops/live.lua',
    'ops/ingame.lua',
    'ops/jail.lua',             -- 2.8.0: the admin jail (before the console: its actions read WC.Jail)
    'ops/console.lua',
    'ops/console_actions.lua',
    'ops/console_entities.lua',
    -- 2.2.0: what used to be reached through w_admin, now done here (no w_admin needed)
    'ops/native_characters.lua',
    'ops/native_settings.lua',
    'ops/native_news.lua',
    'ops/native_blips.lua',     -- 2.4.0: map blips on the game's own map, while w_map is not running
    'core/scripts_registry.lua',
    'ops/native_scripts.lua',
    'ops/native_player.lua',
    'ops/losses.lua',           -- 2.6.0: losses.list / losses.restore (before profile.lua: it reads WC.Losses)
    'ops/profile.lua',          -- 2.5.0: player.profile, a player's own account page on the server's website
    'ops/native_commands.lua',  -- 2.2.2: w_admin's chat commands, run through the console (after ops/console.lua)
    'core/script_permission_registry.lua',
    'core/script_catalog.lua',
    'core/script_permissions.lua',
    'core/transport.lua',
    'core/host.lua',
    'core/closed.lua',
    'core/bans.lua',
    'core/joincard.lua',   -- the connecting screen's refusal cards (join.lua)
    'core/join.lua',
    'core/events.lua',
    'core/main.lua',
}
