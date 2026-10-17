fx_version 'cerulean'
game 'rdr3'
lua54 'yes'
rdr3_warning 'I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.'

name 'w_connector'
author 'Wraith Studio'
version '1.1.1'
description 'Red River Connector — executes what the Red River website asks, and reports what it needs. No in-game interface.'

-- There is deliberately no `ui_page` and no `files {}` here.
--
-- This resource is handed to customers. Anything shipped inside it can be extracted, so nothing
-- worth extracting is shipped: no panel, no menus, no NUI bundle, no keybinds, no commands. The
-- entire product surface lives on the website, on our servers, where it cannot be copied.
--
-- server.cfg — paste the key from your RedM panel and nothing else:
--     set wraith_apikey "fvm_....."
--
-- Optional, only for self-hosting or testing:
--     set wraith_site_endpoint "https://.../api/fivem/devadmin"
--     set wraith_bridge_enabled "false"

server_scripts {
    -- sv_framework.lua reads the database through w.database.*, so the library loads first.
    -- Nothing client-side needs it: cl_actions.lua talks to w_lib by export, inside w_lib's own VM.
    '@w_lib/init.lua',
    '@oxmysql/lib/MySQL.lua',
    'config.lua',
    'server/sv_schema.lua',    -- tables first: everything below assumes they exist
    'server/sv_vorp.lua',
    -- AFTER sv_vorp.lua and before every consumer: it defines CoreBridge, and its tail repoints
    -- the Vorp.* functions that speak VORP's own tables at the citizenid schema when the host is
    -- not VORP. Load it earlier and there is no Vorp table yet to repoint.
    'server/sv_framework.lua',
    'server/sv_inventory.lua',
    'server/sv_perms.lua',
    'server/sv_log.lua',
    'server/sv_players.lua',
    'server/sv_registry.lua',  -- the handler table, before anything registers into it
    'server/handlers/admins.lua',
    'server/handlers/adminchat.lua',
    'server/handlers/bans.lua',
    'server/handlers/livemap.lua',
    'server/handlers/logs.lua',
    'server/handlers/players.lua',
    'server/handlers/reports.lua',
    'server/handlers/resources.lua',
    'server/handlers/roles.lua',
    'server/handlers/server.lua',
    'server/handlers/stats.lua',
    'server/handlers/whitelist.lua',
    'server/handlers/entry.lua',
    -- the way in: closed, bans, whitelist, priority and the join queue (replaces connectqueue)
    'server/sv_queue.lua',
    'server/sv_heartbeat.lua',
    'server/sv_bridge.lua',    -- LAST: dispatches into everything above
}

-- Two client files, both headless. cl_actions.lua receives commands from the server and runs the
-- natives that only exist on a game client (freeze, ragdoll, the troll effects). cl_webrtc.lua is
-- the spectate relay. Neither draws anything, listens for a key, or registers a command.
client_scripts {
    'client/cl_actions.lua',
    'client/cl_webrtc.lua',
}

dependencies {
    'oxmysql',
    'vorp_core',
}
