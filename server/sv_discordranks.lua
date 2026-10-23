--- A rank bound to a Discord role goes to whoever holds that role in the server's Discord -- in the game too
--- (owner, 2026-10-23), so the same person has the same powers on the website and in game, and opens
--- w_admin when his rank gives the in-game panel (group.mod and up).
---
--- The roles come from the WEBSITE (GET /devadmin/member-roles, the server key), whose bot sits in the
--- panel's own Discord; this resource's bot may be another (Red River's borrows the logs bot, in the logs
--- server). Checked when a player joins, at once when the website's bot sees his roles change
--- (adminpanel:syncDiscordMember, 2026-10-23), and every 2 minutes for everyone online in case one was missed.
---
--- Only what Discord gave is taken back: a rank given here is remembered in wc_discord_ranks, and taken
--- away when its role is gone. A rank given by hand (in game or on the website) is never touched, and
--- the master is never given by a role.

DiscordRanks = {}

local ENDPOINT = Config.endpoint
local HDR = { ['x-api-key'] = Config.apiKey }
local EVERY = 2 * 60 * 1000

CreateThread(function()
    Schema.await()
    MySQL.query.await([[CREATE TABLE IF NOT EXISTS `wc_discord_ranks` (
        `identifier` VARCHAR(100) NOT NULL,
        `rank_name` VARCHAR(64) NOT NULL,
        `given_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`identifier`, `rank_name`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]])
end)

--- The member's role ids in the panel's Discord, from the website, or nil (unknown: change nothing).
local function memberRoles(discordId)
    if not ENDPOINT or ENDPOINT == '' or (Config.apiKey or '') == '' then return nil end
    local p = promise.new()
    local settled = false
    local function done(v) if not settled then settled = true; p:resolve(v) end end
    PerformHttpRequest(ENDPOINT .. '/member-roles?discord=' .. discordId, function(code, body)
        if code ~= 200 or not body or body == '' then return done(nil) end
        local ok, data = pcall(json.decode, body)
        done(ok and type(data) == 'table' and data.ok == true and type(data.roleIds) == 'table' and data.roleIds or nil)
    end, 'GET', '', HDR)
    SetTimeout(10000, function() done(nil) end)
    return Citizen.Await(p)
end

--- Make one online player's Discord-given ranks match his Discord roles. -> given, taken | nil, reason
function DiscordRanks.sync(src)
    src = tonumber(src)
    if not src or not GetPlayerName(src) then return nil, 'player_not_online' end
    local api = Perms.core()
    if not api then return nil, 'ranks_unavailable' end
    local discord = GetPlayerIdentifierByType(src, 'discord')
    local discordId = discord and discord:match('(%d+)$')
    local license = GetPlayerIdentifierByType(src, 'license')
    if not discordId or not license then return 0, 0 end
    license = license:lower()

    local roleIds = memberRoles(discordId)
    if not roleIds then return nil, 'roles_unavailable' end
    if not GetPlayerName(src) then return nil, 'player_not_online' end
    local held = {}
    for _, id in ipairs(roleIds) do held[tostring(id)] = true end

    -- the ranks his roles name (never the master)
    local wanted = {}
    for _, role in ipairs(Perms.list()) do
        if role.name ~= 'master' and role.discordRoleId and role.discordRoleId ~= '' and held[role.discordRoleId] then
            wanted[role.name] = true
        end
    end

    local okR, has = pcall(function() return api:RanksOfPlayer(src) end)
    local current = {}
    for _, r in ipairs(okR and type(has) == 'table' and has or {}) do current[r] = true end
    local given = {}
    for _, r in ipairs(MySQL.query.await('SELECT `rank_name` FROM `wc_discord_ranks` WHERE `identifier` = ?', { license }) or {}) do
        given[r.rank_name] = true
    end

    local added, removed = 0, 0
    for rank in pairs(wanted) do
        if not current[rank] then
            if api:RanksAssign(0, { source = src }, rank) then
                MySQL.insert.await('INSERT IGNORE INTO `wc_discord_ranks` (`identifier`, `rank_name`) VALUES (?, ?)', { license, rank })
                added = added + 1
            end
        end
    end
    for rank in pairs(given) do
        if not wanted[rank] then
            -- given by Discord and the role is gone: taken back (a rank given by hand is not in this table)
            if not current[rank] or api:RanksRevokePlayer(0, src, rank) then
                MySQL.update.await('DELETE FROM `wc_discord_ranks` WHERE `identifier` = ? AND `rank_name` = ?', { license, rank })
                if current[rank] then removed = removed + 1 end
            end
        end
    end
    if added > 0 or removed > 0 then
        Perms.load()
        Log.write(nil, 'admin_action', 'Discord ranks', ('%s: +%d -%d'):format(GetPlayerName(src) or '?', added, removed),
            { name = GetPlayerName(src), identifier = license })
    end
    return added, removed
end

--- The online player with this Discord account, synced now (his roles just changed). -> given, taken | nil, reason
function DiscordRanks.syncDiscord(discordId)
    discordId = tostring(discordId or ''):match('^(%d+)$')
    if not discordId then return nil, 'invalid_value' end
    for _, s in ipairs(GetPlayers()) do
        local id = GetPlayerIdentifierByType(tonumber(s), 'discord')
        if id and id:match('(%d+)$') == discordId then return DiscordRanks.sync(tonumber(s)) end
    end
    return nil, 'player_not_online'
end

--- Everyone online, spaced so a full server is not a burst of requests. -> checked, given, taken
function DiscordRanks.syncAll()
    local checked, given, taken = 0, 0, 0
    for _, s in ipairs(GetPlayers()) do
        local a, r = DiscordRanks.sync(tonumber(s))
        if a then checked = checked + 1; given = given + a; taken = taken + r end
        Wait(250)
    end
    return checked, given, taken
end

AddEventHandler('playerJoining', function()
    local src = source
    -- after the player's own join work (the queue, the character) has had its turn
    SetTimeout(15000, function() pcall(DiscordRanks.sync, src) end)
end)

CreateThread(function()
    while true do
        Wait(EVERY)
        pcall(DiscordRanks.syncAll)
    end
end)
