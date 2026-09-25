--- w_connector configuration.
---
--- Every value here is either a harmless default or a convar read. There are no secrets in this
--- file and none may ever be added to it — `w_admin/config/server_config.lua` shipped a live
--- Discord bot token, a Steam API key and six webhook URLs as literals, which is how they ended up
--- in a git repository. Anything sensitive is read from server.cfg at runtime instead, so the file
--- an owner reads and the file an owner edits are not the same file.

Config = {}

--- The site endpoint is identical for every customer, so it is baked in as the default. A customer
--- sets exactly one thing: `wraith_apikey`.
local DEFAULT_ENDPOINT = 'https://wraith7.com/api/fivem/devadmin'

Config.endpoint = GetConvar('wraith_site_endpoint', DEFAULT_ENDPOINT)
Config.apiKey   = GetConvar('wraith_apikey', '')
Config.enabled  = GetConvar('wraith_bridge_enabled', 'true') == 'true'
                  and Config.apiKey ~= '' and Config.endpoint ~= ''

--- Heartbeat and ingest base — the endpoint minus the `/devadmin` suffix.
Config.base = (Config.endpoint or ''):gsub('/devadmin/?$', '')

--- How long the website is asked to hold a poll open. The site clamps this to 1–30 server-side.
Config.pollWait = 25

--- Heartbeat interval, milliseconds. The website treats a guild as connected if it has either a
--- parked long-poll OR a heartbeat inside the last 120 seconds — and there is no parked poll while
--- an action is executing. Raising this past ~30s makes the panel flicker offline during bursts.
Config.heartbeatMs = 10000

--- Optional credentials, all read from server.cfg. Every one of these is safe to leave unset:
--- avatars fall back to Discord, then Steam, then a default image, and an unset webhook simply
--- means that log category is not mirrored to Discord.
Config.discordToken  = GetConvar('w_connector_discord_token', '')
Config.discordGuild  = GetConvar('w_connector_discord_guild', '')
Config.steamKey      = GetConvar('w_connector_steam_key', '')

--- One webhook per log category. Categories match the `action_type` column of wc_logs and the
--- filter the website's Logs tab sends.
Config.webhooks = {
    player_action = GetConvar('w_connector_webhook_player', ''),
    admin_action  = GetConvar('w_connector_webhook_admin', ''),
    server_event  = GetConvar('w_connector_webhook_server', ''),
    security      = GetConvar('w_connector_webhook_security', ''),
    economy       = GetConvar('w_connector_webhook_economy', ''),
    system        = GetConvar('w_connector_webhook_system', ''),
}

--- Identifiers that are seeded into wc_admins as `owner` on first boot, comma separated, e.g.
---     set w_connector_owners "steam:110000112345678,steam:11000011999999"
--- Without at least one of these — or a row already in wc_admins — nobody can administer the
--- server, because there is no in-game way to grant the first role.
Config.defaultOwners = {}
for ident in (GetConvar('w_connector_owners', '')):gmatch('[^,%s]+') do
    Config.defaultOwners[#Config.defaultOwners + 1] = ident
end

--- Which resource answers the VORP inventory API.
---
--- Left empty, w_connector finds it: it probes `vorp_inventory`, then `w_inventory`, and uses the
--- first that responds. That covers the stock inventory and Wraith's own — `w_inventory` declares
--- `provide 'vorp_inventory'`, so the name is virtual and no resource is actually started under it.
--- Set this only if your inventory uses some other name entirely.
Config.inventoryResource = GetConvar('w_connector_inventory', '')

--- Whether joining players are checked against wc_whitelist. Off by default: turning it on by
--- accident locks every player out of a server whose owner has not populated the list yet.
Config.useWhitelist = GetConvar('w_connector_whitelist', 'false') == 'true'

--- Whether player IP addresses are included in logs and player reads. Off by default because it is
--- personal data that most owners neither need nor want mirrored into a web panel.
Config.showIpAddress = GetConvar('w_connector_show_ip', 'false') == 'true'

--- Number of warnings that triggers an automatic kick. 0 disables it.
Config.warnKickThreshold = GetConvarInt('w_connector_warn_kick_at', 3)
