--- The online player cache, and avatar resolution.
---
--- Two rules this file exists to keep.
---
--- 1. The cache is a convenience, never the source of truth for who is online. It is empty for
---    every already-connected player immediately after `restart w_connector`, so anything that must
---    be right — the heartbeat, the live map, the online count — reads native `GetPlayers()` and
---    treats the cache as enrichment. w_admin read the cache instead, which is why its web live map
---    showed zero players after every restart.
---
--- 2. Avatars are resolved in the BACKGROUND. w_admin resolved them inside the request: its players
---    page fetched up to fifteen avatars per call at 100ms intervals, and its admins page walked the
---    roster one at a time with `Citizen.Await`. Both turn a page load into a multi-second stall
---    against two third-party APIs. Here the request reads whatever `wc_avatars` holds and a thread
---    fills the gaps.

Players = { cache = {}, avatars = {} }

local DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png'

--- Three consecutive Discord failures and we stop asking for five minutes. Without this, a Discord
--- outage turns every avatar refresh into a rate-limited retry storm.
local DiscordHealth = { failures = 0, blockedUntil = 0 }

local function discordDown()
    return DiscordHealth.blockedUntil > os.time()
end

local function noteDiscord(ok)
    if ok then
        DiscordHealth.failures = 0
    else
        DiscordHealth.failures = DiscordHealth.failures + 1
        if DiscordHealth.failures >= 3 then
            DiscordHealth.blockedUntil = os.time() + 300
            DiscordHealth.failures = 0
            print('^3[w_connector]^0 Discord API failing — pausing avatar lookups for 5 minutes.')
        end
    end
end

local function httpJson(url, headers, timeoutMs)
    local p = promise.new()
    local settled = false
    local function done(v) if not settled then settled = true; p:resolve(v) end end
    PerformHttpRequest(url, function(code, body)
        if code == 200 and body and body ~= '' then
            local ok, data = pcall(json.decode, body)
            done(ok and data or nil)
        else
            done(nil)
        end
    end, 'GET', '', headers or {})
    SetTimeout(timeoutMs or 6000, function() done(nil) end)
    return Citizen.Await(p)
end

local function discordAvatar(discordId)
    if Config.discordToken == '' or not discordId or discordId == '' or discordDown() then return nil end
    local data = httpJson('https://discord.com/api/v10/users/' .. discordId,
        { ['Authorization'] = 'Bot ' .. Config.discordToken })
    noteDiscord(data ~= nil)
    if type(data) ~= 'table' or not data.id then return nil end
    local url
    if data.avatar then
        local ext = tostring(data.avatar):sub(1, 2) == 'a_' and 'gif' or 'png'
        url = ('https://cdn.discordapp.com/avatars/%s/%s.%s?size=128'):format(data.id, data.avatar, ext)
    end
    return url, data.username or data.global_name
end

local function steamAvatar(steamHex)
    if Config.steamKey == '' or not steamHex or steamHex == '' then return nil end
    -- Steam wants the 64-bit decimal id; the identifier arrives as hex.
    local dec = tonumber(steamHex, 16)
    if not dec then return nil end
    local data = httpJson(('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=%s&steamids=%d')
        :format(Config.steamKey, dec))
    local player = data and data.response and data.response.players and data.response.players[1]
    if type(player) ~= 'table' then return nil end
    return player.avatarfull or player.avatarmedium, player.personaname
end

--- Whatever we already know about this identifier, without asking anyone.
function Players.avatarOf(identifier)
    if not identifier then return DEFAULT_AVATAR end
    local cached = Players.avatars[identifier]
    if cached then return cached.avatar_url or DEFAULT_AVATAR end
    return DEFAULT_AVATAR
end

function Players.loadAvatars()
    local rows = MySQL.query.await(
        'SELECT `identifier`, `steam_hex`, `discord_id`, `discord_username`, `avatar_url`, `avatar_source` FROM `wc_avatars`') or {}
    local out = {}
    for _, r in ipairs(rows) do out[r.identifier] = r end
    Players.avatars = out
    return out
end

--- Resolve and store one identifier's avatar. Runs on the background thread only.
function Players.resolveAvatar(identifier, steamHex, discordId)
    if not identifier or identifier == '' then return end
    local url, name, source = discordAvatar(discordId)
    source = url and 'discord' or nil
    if not url then
        url, name = steamAvatar(steamHex)
        source = url and 'steam' or nil
    end
    if not url then
        url, source = DEFAULT_AVATAR, 'default'
    end
    local row = {
        identifier = identifier, steam_hex = steamHex or '', discord_id = discordId or '',
        discord_username = name or '', avatar_url = url, avatar_source = source,
    }
    Players.avatars[identifier] = row
    pcall(function()
        MySQL.insert.await(
            'INSERT INTO `wc_avatars` (`identifier`,`steam_hex`,`discord_id`,`discord_username`,`avatar_url`,`avatar_source`) ' ..
            'VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `steam_hex`=VALUES(`steam_hex`), ' ..
            '`discord_id`=VALUES(`discord_id`), `discord_username`=VALUES(`discord_username`), ' ..
            '`avatar_url`=VALUES(`avatar_url`), `avatar_source`=VALUES(`avatar_source`)',
            { row.identifier, row.steam_hex, row.discord_id, row.discord_username, row.avatar_url, row.avatar_source })
    end)
end

-- ---------------------------------------------------------------------------
--  The cache
-- ---------------------------------------------------------------------------

--- Build (or rebuild) the cache entry for one connected source.
function Players.register(src)
    src = tonumber(src)
    if not src then return nil end
    local ids = Vorp.identifiers(src)
    local snap = Vorp.snapshot(src) or {}
    local identifier = snap.identifier or ids.license
    local entry = {
        source = src,
        id = snap.charId,
        identifier = identifier,
        steamHex = ids.steam,
        discordId = ids.discord,
        license = ids.license,
        endPoint = ids.ip or GetPlayerEndpoint(src),
        firstName = snap.firstName,
        lastName = snap.lastName,
        characterName = snap.characterName,
        username = snap.nickname or snap.steamName or GetPlayerName(src),
        job = snap.job,
        jobLabel = snap.jobLabel,
        jobGrade = snap.jobGrade,
        description = snap.description,
        lastLogin = os.date('%Y-%m-%d %H:%M:%S'),
    }
    Players.cache[src] = entry

    -- Whitelist bookkeeping, if the owner uses it.
    if identifier and ids.steam then
        pcall(function()
            MySQL.update.await(
                'UPDATE `wc_whitelist` SET `character_name` = ?, `last_login` = ?, `is_online` = 1 WHERE `steam_hex` = ?',
                { entry.characterName or '', entry.lastLogin, ids.steam })
        end)
    end

    -- Fill the avatar out of band; the request path never waits for this.
    if identifier and not Players.avatars[identifier] then
        CreateThread(function() Players.resolveAvatar(identifier, ids.steam, ids.discord) end)
    end

    return entry
end

function Players.get(src)
    return Players.cache[tonumber(src)]
end

function Players.drop(src)
    src = tonumber(src)
    local entry = Players.cache[src]
    if entry and entry.steamHex then
        pcall(function()
            MySQL.update.await('UPDATE `wc_whitelist` SET `is_online` = 0 WHERE `steam_hex` = ?', { entry.steamHex })
        end)
    end
    Players.cache[src] = nil
end

--- Every connected source, from the native list. This is the authoritative answer.
function Players.online()
    local out = {}
    for _, raw in ipairs(GetPlayers()) do
        local sid = tonumber(raw)
        if sid then out[#out + 1] = sid end
    end
    return out
end

function Players.onlineCount()
    return #Players.online()
end

AddEventHandler('vorp:SelectedCharacter', function(source)
    local src = source
    CreateThread(function()
        -- VORP fires this before the character object is fully attached to the user.
        Wait(500)
        pcall(Players.register, src)
    end)
end)

AddEventHandler('playerDropped', function()
    Players.drop(source)
end)

AddEventHandler('onResourceStart', function(name)
    if name ~= GetCurrentResourceName() then return end
    CreateThread(function()
        Schema.await()
        Players.loadAvatars()

        -- Wait for VORP before re-registering. Registering first would cache an entry with no
        -- character id for everyone already connected, and nothing would ever fill it in: this
        -- runs once, so those players would accrue no playtime until they reconnected.
        local waited = 0
        while not Vorp.ready and waited < 30000 do
            Wait(250)
            waited = waited + 250
        end
        Wait(1500)

        for _, sid in ipairs(Players.online()) do
            pcall(Players.register, sid)
        end
        -- print(('^2[w_connector]^0 registered %d already-connected player(s).'):format(Players.onlineCount()))
    end)
end)

--- Top up anything the cache is still missing.
---
--- A player who was mid character-selection when they were registered has no character id yet, and
--- a job changed by another resource never reaches this cache at all. Re-registering only the
--- incomplete entries keeps it honest without re-reading every player every minute.
CreateThread(function()
    Schema.await()
    while true do
        Wait(30000)
        if Vorp.ready then
            for _, sid in ipairs(Players.online()) do
                local p = Players.cache[sid]
                if not p or not p.id then pcall(Players.register, sid) end
            end
        end
    end
end)

--- Background avatar top-up: anyone online whose avatar we still do not have.
CreateThread(function()
    Schema.await()
    while true do
        Wait(60000)
        for _, sid in ipairs(Players.online()) do
            local p = Players.cache[sid]
            if p and p.identifier and not Players.avatars[p.identifier] then
                pcall(Players.resolveAvatar, p.identifier, p.steamHex, p.discordId)
                Wait(250) -- spaced so a full server does not become a burst against Discord
            end
        end
    end
end)
