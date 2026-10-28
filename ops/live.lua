--- What happens on a player's own screen: watching it (spectate), their deaths (the death log), and the
--- website's map blips and zones (FiveM). The client half is client/cl_spectate.lua, cl_death.lua and
--- cl_map.lua; the capture page is nui/capture.html.

-- ── Spectate ─────────────────────────────────────────────────────────────────────────────────────
-- The target's capture page is the streamer (it offers); the panel is the viewer. The website mints a
-- session and relays the viewer's answer and ICE here; the page's offer and ICE come back through
-- w_connector:spectateOut and go up to the website signed. Only the session's own target may speak for
-- it, so one player cannot inject signalling into another's session.
--
-- RedM: the connection completes, but the RedM client does not hand the game image to a browser (only
-- FiveM's does), so the picture is the page's flat placeholder. The panel detects and says so.
local sessions = {} -- sessionId -> { target, at }
local SESSION_TTL = 600

local function sid(v)
    v = tostring(v or '')
    return v:match('^%x+$') and #v == 32 and v or nil
end

local function iceList(v)
    if type(v) ~= 'table' then return {} end
    local out = {}
    for i = 1, math.min(#v, 4) do
        local s = v[i]
        if type(s) == 'table' and (type(s.urls) == 'string' or type(s.urls) == 'table') then
            out[#out + 1] = { urls = s.urls, username = type(s.username) == 'string' and s.username or nil,
                credential = type(s.credential) == 'string' and s.credential or nil }
        end
    end
    return out
end

WC.Ops.define('player.spectate', nil, function(args)
    local id = sid(args.sessionId)
    if not id then return false, 'invalid_args' end
    local phase = args.phase
    if phase == 'stop' then
        local s = sessions[id]
        sessions[id] = nil
        if s and GetPlayerName(s.target) then TriggerClientEvent('w_connector:spectateStop', s.target, id) end
        return true
    end
    if phase == 'start' then
        local src = WC.onlineSource(args.source)
        if not src then return false, 'player_offline' end
        sessions[id] = { target = src, at = os.time() }
        TriggerClientEvent('w_connector:spectateStart', src, id, iceList(args.iceServers))
        return true
    end
    if phase == 'signal' then
        local s = sessions[id]
        if not s then return false, 'no_session' end
        if args.kind ~= 'answer' and args.kind ~= 'ice' and args.kind ~= 'bye' then return false, 'invalid_args' end
        local data = args.data
        if args.kind == 'answer' and (type(data) ~= 'string' or #data > 20000) then return false, 'invalid_args' end
        if args.kind == 'ice' and type(data) ~= 'table' then return false, 'invalid_args' end
        TriggerClientEvent('w_connector:spectateSignal', s.target, id, args.kind, data)
        return true
    end
    return false, 'invalid_args'
end)

RegisterNetEvent('w_connector:spectateOut', function(sessionId, kind, data)
    local src = source
    local id = sid(sessionId)
    local s = id and sessions[id]
    if not s or s.target ~= src then return end
    if kind ~= 'offer' and kind ~= 'ice' and kind ~= 'bye' then return end
    if kind == 'offer' and (type(data) ~= 'string' or #data > 20000) then return end
    if kind == 'ice' and type(data) ~= 'table' then return end
    s.at = os.time()
    CreateThread(function()
        WC.request('POST', '/signal', { sessionId = id, kind = kind, data = data })
    end)
end)

local lastDeath = {} -- the death log's rate limit, below

AddEventHandler('playerDropped', function()
    local src = source
    lastDeath[src] = nil
    for id, s in pairs(sessions) do
        if s.target == src then
            sessions[id] = nil
            CreateThread(function() WC.request('POST', '/signal', { sessionId = id, kind = 'bye' }) end)
        end
    end
end)

CreateThread(function()
    while true do
        Wait(60000)
        local now = os.time()
        for id, s in pairs(sessions) do
            if now - s.at > SESSION_TTL then sessions[id] = nil end
        end
    end
end)

-- ── Death log ────────────────────────────────────────────────────────────────────────────────────
-- The victim's client reports its own death (who killed it and with what); the server adds the names
-- and identifiers and logs it with the joins and leaves. A client can lie about its own death, so this
-- is a log, not evidence; one report per player per 5 seconds.

RegisterNetEvent('w_connector:died', function(killer, cause, x, y, z)
    local src = source
    local now = GetGameTimer()
    if lastDeath[src] and now - lastDeath[src] < 5000 then return end
    lastDeath[src] = now
    local data = { cause = math.tointeger(tonumber(cause)) or 0 }
    local k = WC.onlineSource(killer)
    if k and k ~= src then
        local kids = WC.identifiers(k)
        data.killer = { source = k, name = GetPlayerName(k), license = kids.license, discord = kids.discord }
    elseif k == src then
        data.self = true
    end
    local px, py, pz = tonumber(x), tonumber(y), tonumber(z)
    if px and py and pz then data.coords = { x = math.floor(px), y = math.floor(py), z = math.floor(pz) } end
    WC.logEvent('death', src, data)
end)


-- ── Map blips and zones (FiveM) ──────────────────────────────────────────────────────────────────
-- The website owns the lists and sends them whole; they are replicated to every client through
-- GlobalState, where client/cl_map.lua draws the blips and tells a player which zone they are in.
local function num(v, lo, hi, def)
    v = tonumber(v)
    if not v or v ~= v then return def end
    return math.max(lo, math.min(hi, v))
end

local function str(v, max)
    return type(v) == 'string' and v:sub(1, max) or nil
end

local function cleanBlips(list)
    local out = {}
    if type(list) ~= 'table' then return out end
    for i = 1, math.min(#list, 300) do
        local b = list[i]
        if type(b) == 'table' and tonumber(b.x) and tonumber(b.y) then
            out[#out + 1] = {
                id = math.tointeger(tonumber(b.id)) or i, label = str(b.label, 64) or 'Blip',
                x = num(b.x, -20000, 20000, 0), y = num(b.y, -20000, 20000, 0), z = num(b.z, -2000, 5000, 0),
                sprite = math.floor(num(b.sprite, 0, 1000, 1)), color = math.floor(num(b.color, 0, 100, 0)),
                scale = num(b.scale, 0.1, 3, 0.8), shortRange = b.shortRange ~= false,
            }
        end
    end
    return out
end

local function cleanZones(list)
    local out = {}
    if type(list) ~= 'table' then return out end
    for i = 1, math.min(#list, 200) do
        local z = list[i]
        if type(z) == 'table' and type(z.points) == 'table' and #z.points >= 3 then
            local pts = {}
            for j = 1, math.min(#z.points, 64) do
                local p = z.points[j]
                if type(p) == 'table' and tonumber(p.x) and tonumber(p.y) then
                    pts[#pts + 1] = { x = num(p.x, -20000, 20000, 0), y = num(p.y, -20000, 20000, 0) }
                end
            end
            if #pts >= 3 then
                out[#out + 1] = {
                    id = math.tointeger(tonumber(z.id)) or i, name = str(z.name, 64) or 'Zone', points = pts,
                    minZ = num(z.minZ, -2000, 5000, -200), maxZ = num(z.maxZ, -2000, 5000, 1000),
                    debug = z.debug == true,
                }
            end
        end
    end
    return out
end

WC.Ops.define('map.sync', function() return WC.gameName() == 'gta5' end, function(args)
    local blips, zones = cleanBlips(args.blips), cleanZones(args.zones)
    GlobalState['w_connector:map'] = { blips = blips, zones = zones, at = os.time() }
    return true, { blips = #blips, zones = #zones }
end)
