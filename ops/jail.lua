--- 2.8.0 (2026-11-14, owner: «اضف سجن اداري واضيفها في لوحة الادمن السريع والكبيره والموقع»): the admin jail.
---
--- The website keeps the record (table game_jail: who, why, until when) and the two places (settings.jail and
--- settings.jailRelease, set on the website's jail card or in game with jail.setPlace). Before 2.8.0 the website
--- only teleported the player there once and nothing held him. This file HOLDS him:
---   * every second each jailed player who is online, alive and has a character is put back at the jail place
---     when he is farther than RADIUS from it (w_guard is told first: our own teleport is not a cheat);
---   * the time runs only while he is on the server (owner 2026-11-14, choice 2): away, or the server down, it
---     stops and goes on when he is back (the website pauses its `until` the same way, jail.ts pauseOfflineJail);
---   * when it ends he is put at the release place (or where he stood before the jail); a player who is offline
---     then is moved out when he next has a character on this server;
---   * his screen shows «سجن إداري», the time left and the reason (client/cl_jail.lua -> the NUI banner).
---
--- The list lives in KVP (a restart keeps it) and is reconciled with the website on every heartbeat answer
--- (core/transport.lua -> WC.Jail.learn): a stay the website has and we do not is added, one the website ended
--- (released from the website, or its time is up) is released here. A stay added here in the last FRESH seconds is
--- never released by an answer that may have been computed before it existed.
---
--- Ops the website may run:
---   player.jail   { source, seconds|minutes, reason, by?, place?, release? }   now, the player online
---   player.unjail { source? | license? }                                        early release
---   jail.list     {}                                                            what this server holds
--- Console actions (ops/console_actions.lua): player.jail, player.unjail, jail.setPlace.

WC.Jail = WC.Jail or {}
local J = WC.Jail

local KVP = 'w_connector:jail'
local RADIUS = 13.0          -- metres from the jail place before he is brought back (MajestyRP SS-Admin JailRadius)
local FRESH = 60             -- seconds: a new stay is not released by an older heartbeat answer
local MIN_ADD = 20           -- seconds: a stay this close to its end is not started from a heartbeat answer
local MAX_SECONDS = 10080 * 60

J.stays = J.stays or {}      -- license -> { ends, reason, by, name, since, back = {x,y,z,h}? }
J.out = J.out or {}          -- license -> { at = {x,y,z}|nil }: released while offline, moved out on his next load
J.place, J.release = nil, nil
J.shown = J.shown or {}      -- src -> the signature last sent to his screen
J.moved = J.moved or {}      -- src -> os.time() of our last teleport (a short grace while he lands)

local function now() return os.time() end

local function point(v)
    if type(v) ~= 'table' then return nil end
    local x, y, z = tonumber(v.x), tonumber(v.y), tonumber(v.z)
    if not x or not y or not z or x ~= x or y ~= y or z ~= z then return nil end
    if math.abs(x) >= 100000 or math.abs(y) >= 100000 or math.abs(z) >= 100000 then return nil end
    local h = tonumber(v.h or v.heading)
    return { x = x + 0.0, y = y + 0.0, z = z + 0.0, h = h and h == h and (h % 360.0) or nil }
end

local function text(v, max)
    if type(v) ~= 'string' then return '' end
    v = v:gsub('[%c<>]', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    return v:sub(1, max or 300)
end

local function licenseOf(src)
    local ids = WC.identifiers(src)
    return ids.license or ids.license2
end
J.licenseOf = licenseOf

-- ── storage ──────────────────────────────────────────────────────────────────────────────────────────
local function save()
    if type(SetResourceKvp) ~= 'function' then return end
    local ok, raw = pcall(json.encode, { stays = J.stays, out = J.out, place = J.place, release = J.release, savedAt = now() })
    if ok and type(raw) == 'string' then SetResourceKvp(KVP, raw) end
end

local function load()
    if type(GetResourceKvpString) ~= 'function' then return end
    local raw = GetResourceKvpString(KVP)
    if type(raw) ~= 'string' or raw == '' then return end
    local ok, data = pcall(json.decode, raw)
    if not ok or type(data) ~= 'table' then return end
    -- the server was down since the last save: nobody was on it, so no stay ran
    local down = math.max(0, now() - (tonumber(data.savedAt) or now()))
    for license, s in pairs(type(data.stays) == 'table' and data.stays or {}) do
        if type(license) == 'string' and type(s) == 'table' and tonumber(s.ends) then
            J.stays[license] = { ends = math.floor(tonumber(s.ends)) + down, reason = text(s.reason), by = text(s.by, 60),
                name = text(s.name, 100), since = tonumber(s.since) or now(), back = point(s.back) }
        end
    end
    for license, o in pairs(type(data.out) == 'table' and data.out or {}) do
        if type(license) == 'string' then J.out[license] = { at = type(o) == 'table' and point(o.at) or nil } end
    end
    J.place, J.release = point(data.place), point(data.release)
end
load()

-- ── the player himself ───────────────────────────────────────────────────────────────────────────────
local function ped(src)
    local p = GetPlayerPed(src)
    return p and p ~= 0 and p or nil
end

local function position(src)
    local p = ped(src)
    if not p then return nil end
    local c = GetEntityCoords(p)
    return { x = c.x, y = c.y, z = c.z, h = GetEntityHeading(p) }
end
J.position = position

--- He has a character on this server and is up (not down, not in the creator): the moment he can be moved.
local function ready(src)
    if not ped(src) then return false end
    local fw = WC.Adapters.get('framework')
    if not fw then return true end
    local ok, char = pcall(fw.player, src)
    if not ok or not char then return false end
    return not (type(char.status) == 'table' and char.status.dead == true)
end

local function moveTo(src, at)
    local p = ped(src)
    if not p or not at then return false end
    if WC.started('w_guard') then pcall(function() exports.w_guard:AllowMove(src, 8) end) end
    SetEntityCoords(p, at.x, at.y, at.z, false, false, false, false)
    if at.h then SetEntityHeading(p, at.h) end
    J.moved[src] = now()
    TriggerClientEvent('w_connector:jail:moved', src, at)
    return true
end

local function show(src, stay)
    local sig = stay and ('%d|%s'):format(stay.ends, stay.reason) or ''
    if J.shown[src] == sig then return end
    J.shown[src] = sig
    if stay then
        TriggerClientEvent('w_connector:jail:state', src, { left = math.max(0, stay.ends - now()), reason = stay.reason })
    else
        TriggerClientEvent('w_connector:jail:state', src, false)
    end
end

local function onlineByLicense(license)
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if src and licenseOf(src) == license then return src end
    end
    return nil
end

--- Ends one stay: out now when he is online and up, or on his next load.
function J.free(license, why)
    local stay = J.stays[license]
    if not stay then return false end
    J.stays[license] = nil
    local at = J.release or stay.back
    local src = onlineByLicense(license)
    if src and ready(src) then
        if at then moveTo(src, at) end
        show(src, nil)
        TriggerClientEvent('w_connector:jail:freed', src, why or 'time')
    else
        J.out[license] = { at = at }
        if src then show(src, nil) end
    end
    save()
    return true
end

--- Starts (or replaces) one stay and puts him in at once.
function J.put(src, seconds, reason, by)
    local license = licenseOf(src)
    if not license then return false, 'no_license' end
    if not J.place then return false, 'jail_not_set' end
    seconds = math.floor(tonumber(seconds) or 0)
    if seconds < 1 or seconds > MAX_SECONDS then return false, 'invalid_args' end
    reason = text(reason)
    if reason == '' then return false, 'invalid_args' end
    local old = J.stays[license]
    local view = WC.playerView(src)
    J.stays[license] = { ends = now() + seconds, reason = reason, by = text(by, 60), name = text(view.charName or view.name, 100),
        since = now(), back = old and old.back or position(src) }
    J.out[license] = nil
    save()
    if ready(src) then moveTo(src, J.place) end
    show(src, J.stays[license])
    return true, { license = license, left = seconds }
end

--- The jail state of one online player, for the panels' player view. nil when he is not jailed.
function J.view(src)
    local license = licenseOf(src)
    local stay = license and J.stays[license]
    if not stay then return nil end
    return { left = math.max(0, stay.ends - now()), reason = stay.reason, by = stay.by }
end

--- A new place from the console (jail.setPlace): 'jail' or 'release'.
function J.setPlace(kind, at)
    at = point(at)
    if not at then return false end
    if kind == 'release' then J.release = at else J.place = at end
    save()
    return true
end

--- The website's answer on a heartbeat: { list = { { license, seconds, reason, name } }, place, release }.
function J.learn(data)
    if type(data) ~= 'table' then return end
    local changed = false
    local place, release = point(data.place), point(data.release)
    if json.encode(place or {}) ~= json.encode(J.place or {}) or json.encode(release or {}) ~= json.encode(J.release or {}) then
        J.place, J.release, changed = place, release, true
    end
    local listed = {}
    for _, row in ipairs(type(data.list) == 'table' and data.list or {}) do
        local license = type(row) == 'table' and type(row.license) == 'string' and row.license:match('^license2?:%x+$') and row.license
        local seconds = license and math.floor(tonumber(row.seconds) or 0)
        if license and seconds > 0 and seconds <= MAX_SECONDS then
            listed[license] = true
            local stay = J.stays[license]
            if stay then
                -- the website's clock decides the end; a few seconds of drift are not worth a write
                local ends = now() + seconds
                if math.abs(stay.ends - ends) > 10 then stay.ends, changed = ends, true end
                local reason = text(row.reason)
                if reason ~= '' and reason ~= stay.reason then stay.reason, changed = reason, true end
            elseif seconds >= MIN_ADD then
                local src = onlineByLicense(license)
                J.stays[license] = { ends = now() + seconds, reason = text(row.reason), by = '', name = text(row.name, 100),
                    since = now(), back = src and position(src) or nil }
                J.out[license], changed = nil, true
            end
        end
    end
    for license, stay in pairs(J.stays) do
        if not listed[license] and now() - (stay.since or 0) >= FRESH then J.free(license, 'released'); changed = true end
    end
    if changed then save() end
end

-- ── the watch: every second ─────────────────────────────────────────────────────────────────────────
CreateThread(function()
    local last, lastSave = now(), now()
    while true do
        Wait(1000)
        local t = now()
        -- away = his time stands still (pushed on by the seconds that passed)
        local step = math.max(0, t - last)
        last = t
        if step > 0 then
            for license, stay in pairs(J.stays) do
                if not onlineByLicense(license) then stay.ends = stay.ends + step end
            end
        end
        for license, stay in pairs(J.stays) do
            if stay.ends <= t then J.free(license, 'time') end
        end
        -- kept fresh so a restart knows how long the server was down
        if next(J.stays) and t - lastSave >= 30 then save(); lastSave = t end
        for _, id in ipairs(GetPlayers()) do
            local src = tonumber(id)
            local license = src and licenseOf(src)
            if license then
                local stay, out = J.stays[license], J.out[license]
                if stay then
                    if ready(src) then
                        show(src, stay)
                        local c = position(src)
                        local far = J.place and c and #(vector3(c.x, c.y, c.z) - vector3(J.place.x, J.place.y, J.place.z)) > RADIUS
                        if far and t - (J.moved[src] or 0) >= 3 then moveTo(src, J.place) end
                    end
                elseif out and ready(src) then
                    J.out[license] = nil
                    if out.at then moveTo(src, out.at) end
                    show(src, nil)
                    TriggerClientEvent('w_connector:jail:freed', src, 'time')
                    save()
                end
            end
        end
    end
end)

AddEventHandler('playerDropped', function()
    local src = tonumber(source)
    if src then J.shown[src], J.moved[src] = nil, nil end
end)

-- the screen asks once its page is up (a restart of this resource, a fresh join)
RegisterNetEvent('w_connector:jail:ask', function()
    local src = source
    J.shown[src] = nil
    local license = licenseOf(src)
    if license and J.stays[license] then show(src, J.stays[license]) end
end)

-- ── ops the website may run ─────────────────────────────────────────────────────────────────────────
WC.Ops.define('player.jail', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    if point(args.place) then J.place = point(args.place) end
    if point(args.release) then J.release = point(args.release) end
    local seconds = tonumber(args.seconds) or (tonumber(args.minutes) and tonumber(args.minutes) * 60)
    return J.put(src, seconds, args.reason, args.by)
end)

WC.Ops.define('player.unjail', nil, function(args)
    local license = type(args.license) == 'string' and args.license or nil
    if not license then
        local src = WC.onlineSource(args.source)
        if not src then return false, 'player_offline' end
        license = licenseOf(src)
    end
    if not license or not J.stays[license] then return false, 'not_jailed' end
    J.free(license, 'released')
    return true
end)

WC.Ops.define('jail.list', nil, function()
    local out, t = {}, now()
    for license, stay in pairs(J.stays) do
        out[#out + 1] = { license = license, name = stay.name, reason = stay.reason, by = stay.by, left = math.max(0, stay.ends - t),
            online = onlineByLicense(license) ~= nil }
    end
    table.sort(out, function(a, b) return a.left < b.left end)
    return true, { list = out, place = J.place, release = J.release }
end)
