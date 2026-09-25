--- The heartbeat.
---
--- This is what the website knows a player IS, and getting it wrong is invisible: the beat still
--- posts, the panel still says "connected", and the data is quietly empty. Three fields were wrong
--- in the original and each broke something that looked like a different feature entirely:
---
---   * `discord` was sent; the site reads `discord_id`. So the one field that says which Discord
---     account a character belongs to was dropped on every beat, and the website could never
---     recognise a returning player — which is why linking needed a typed six-digit code at all.
---   * `job` was a plain string; the site reads an object (`job.name`, `job.label`, `job.grade`).
---     The job silently became NULL for every player.
---   * `license` came from the in-memory cache, which is empty for everyone already connected
---     immediately after a resource restart — and the site SKIPS any entry without a license, so
---     those players vanished from the website until they reconnected.
---
--- Identity therefore comes from the native identifier list, which exists from the moment a player
--- connects, and character fields are read through VORP with each read guarded individually.
---
--- The interval also matters beyond freshness. The website treats a guild as connected if it has a
--- parked long-poll OR a heartbeat within the last 120 seconds — and there is NO parked poll while
--- an action is executing. The ~10s beat is what keeps the panel usable during a burst of clicks.

--- A failed read must cost one field, never the whole beat: any character read can throw for a
--- player who is connected but still on the character-selection screen.
local function tryGet(fn, ...)
    if type(fn) ~= 'function' then return nil end
    local ok, v = pcall(fn, ...)
    if ok then return v end
    return nil
end

--- Playtime for everyone online, in ONE query per beat.
---
--- Reading it per player meant a query for every connected character every ten seconds — on a full
--- server that is a database round trip roughly every 150ms, for a number that changes once a
--- minute. The beat is the most frequent thing this resource does; it should be the cheapest.
local playtimes = {}

local function refreshPlaytimes()
    local ids = {}
    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid)
        if p and p.id then
            local n = tonumber(p.id)
            if n then ids[#ids + 1] = tostring(math.floor(n)) end
        end
    end
    if #ids == 0 then
        playtimes = {}
        return
    end
    local rows = MySQL.query.await(
        'SELECT `char_id`, `seconds` FROM `wc_playtime` WHERE `char_id` IN (' .. table.concat(ids, ',') .. ')') or {}
    local out = {}
    for _, r in ipairs(rows) do out[tonumber(r.char_id)] = tonumber(r.seconds) or 0 end
    playtimes = out
end

local function snapshotPlayer(sid)
    local ids = Vorp.identifiers(sid)
    local cached = Players.get(sid) or {}
    local snap = tryGet(Vorp.snapshot, sid) or {}

    -- Prefer the character identifier the panel acts on; fall back to the native license so a
    -- player is never dropped for want of a warm cache.
    local license = snap.identifier or cached.identifier or ids.license
    if not license then return nil end

    -- Digits only. The site matches on the bare id, and depending on which path filled a cache the
    -- value can arrive either bare or still carrying its `discord:` prefix.
    local discordId = ids.discord or cached.discordId
    if discordId then discordId = tostring(discordId):gsub('%D', '') end
    if discordId == '' then discordId = nil end

    local av = Players.avatars[license] or {}
    local charName = snap.characterName or cached.characterName
    local account = snap.nickname or cached.username

    local playtime = snap.charId and playtimes[snap.charId] or nil

    return {
        license = license,
        -- `discord_id` is the key the site reads; `discord` stays for anything still on the old name.
        discord_id = discordId,
        discord = discordId,
        discord_username = av.discord_username,
        discord_avatar = av.avatar_url,
        steam_id = ids.steam,
        name = charName or account or GetPlayerName(sid),
        char_name = charName,
        account_name = account,
        charinfo = { firstname = snap.firstName, lastname = snap.lastName },
        -- An OBJECT. A string here reaches the site as NULL.
        job = { name = snap.job, label = snap.jobLabel, grade = tonumber(snap.jobGrade) or 0 },
        money = { money = tonumber(snap.money) or 0, gold = tonumber(snap.gold) or 0 },
        playtime = playtime,
        description = snap.description,
        char_id = snap.charId,
        framework = 'redm',
        source = sid,
        ping = GetPlayerPing(sid),
    }
end

CreateThread(function()
    if not Config.enabled or Config.base == '' then return end
    Schema.await()
    Wait(5000)

    local headers = { ['Content-Type'] = 'application/json', ['x-api-key'] = Config.apiKey }

    while true do
        pcall(refreshPlaytimes)

        local players = {}
        for _, sid in ipairs(Players.online()) do
            local ok, snap = pcall(snapshotPlayer, sid)
            if ok and snap then players[#players + 1] = snap end
        end

        PerformHttpRequest(Config.base .. '/heartbeat', function() end, 'POST', json.encode({
            players = players,
            server_name = GetConvar('sv_hostname', 'RedM'),
            max_players = GetConvarInt('sv_maxclients', 32),
            framework = 'redm',
        }), headers)

        Wait(Config.heartbeatMs)
    end
end)
