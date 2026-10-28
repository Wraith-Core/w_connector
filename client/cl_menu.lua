--- The in-game Wraith menu, client half: opening, focus, and the road to the server
--- (docs/admin-platform/08-ingame-menu.md).
---
--- This file decides nothing. It asks the server (ops/ingame.lua), which asks the website, whether this
--- player may open the menu and with which permissions; the permissions it receives only shape what the
--- menu shows. Every action goes back to the server by name, and the website authorises it again.
---
--- Open with /wadmin. On FiveM the command is also a key mapping (default F10, rebindable in
--- Settings → Key Bindings → FiveM). On RedM it is command-only: RedM's settings have no key-binding page
--- for resources (ox_lib emulates one there with a per-frame raw-key listener), and this resource keeps
--- no thread running for a closed menu.
---
--- Nothing runs while the menu is closed except what the player switched on (noclip, IDs, spectate —
--- cl_menu_self.lua).

local GAME = GetGameName() == 'redm' and 'redm' or 'fivem'
local COMMAND = 'wadmin'
local REQUEST_TIMEOUT = 20000

WMenu = WMenu or {}
WMenu.game = GAME
WMenu.open = false
WMenu.session = nil -- { role, perms = { [perm] = true }, permissions = { … }, ops = { [op] = true }, self }

local opening = false
local seq = 0
local waiting = {} -- reqId -> NUI callback

local function foreign()
    local inv = GetInvokingResource()
    return inv ~= nil and inv ~= GetCurrentResourceName()
end

function WMenu.has(perm)
    return WMenu.session ~= nil and WMenu.session.perms[perm] == true
end

function WMenu.toast(kind, key, extra)
    SendNUIMessage({ action = 'menu:toast', kind = kind, key = key, extra = extra })
end

--- Ask the server; `cb` gets { ok, data | error } (always, once).
local function ask(event, action, args, cb)
    seq = seq + 1
    local id = seq
    waiting[id] = cb
    TriggerServerEvent(event, id, action, args or {})
    SetTimeout(REQUEST_TIMEOUT, function()
        local w = waiting[id]
        if w then waiting[id] = nil; w({ ok = false, error = 'timeout' }) end
    end)
end

function WMenu.act(action, args, cb) ask('w_connector:menu:act', action, args, cb) end
function WMenu.self(action, details, cb) ask('w_connector:menu:self', action, details, cb) end

RegisterNetEvent('w_connector:menu:result', function(reqId, result)
    if foreign() then return end
    local w = waiting[reqId]
    if not w then return end
    waiting[reqId] = nil
    w(type(result) == 'table' and result or { ok = false, error = 'bad_reply' })
end)

-- ── open / close ──────────────────────────────────────────────────────────────────────────────────

function WMenu.close()
    if not WMenu.open then return end
    WMenu.open = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'menu:close' })
end

local function watch()
    -- Only while open: close on death or the pause menu, so focus is never left stuck on the page.
    CreateThread(function()
        while WMenu.open do
            local ped = PlayerPedId()
            if (ped ~= 0 and IsEntityDead(ped)) or IsPauseMenuActive() then WMenu.close() break end
            Wait(500)
        end
    end)
end

local function setOf(list)
    local out = {}
    if type(list) == 'table' then for _, v in ipairs(list) do if type(v) == 'string' then out[v] = true end end end
    return out
end

RegisterNetEvent('w_connector:menu:session', function(s)
    if foreign() then return end
    opening = false
    if type(s) ~= 'table' or not s.ok then
        WMenu.session = nil
        WMenu.toast('error', 'err_' .. tostring(type(s) == 'table' and s.error or 'refused'))
        return
    end
    WMenu.session = { role = s.role, permissions = s.permissions or {}, perms = setOf(s.permissions), ops = setOf(s.ops), self = s.self }
    if IsEntityDead(PlayerPedId()) then return end
    WMenu.open = true
    SetNuiFocus(true, true)
    local frame = GetFrameTime()
    SendNUIMessage({
        action = 'menu:open', game = GAME, role = s.role, permissions = s.permissions or {}, ops = s.ops or {}, self = s.self,
        state = WMenu.selfState and WMenu.selfState() or {}, fps = frame > 0 and math.floor(1 / frame + 0.5) or nil,
    })
    watch()
end)

-- The website took this player's access away: close and forget.
RegisterNetEvent('w_connector:menu:revoked', function()
    if foreign() then return end
    WMenu.session = nil
    WMenu.close()
    if WMenu.stopAll then WMenu.stopAll() end
end)

local function toggle()
    if WMenu.spectating and WMenu.spectating() then WMenu.stopSpectate() return end
    if WMenu.open then WMenu.close() return end
    if opening or IsEntityDead(PlayerPedId()) then return end
    opening = true
    SetTimeout(8000, function() opening = false end)
    TriggerServerEvent('w_connector:menu:open')
end

RegisterCommand(COMMAND, toggle, false)
if GAME == 'fivem' and RegisterKeyMapping then
    RegisterKeyMapping(COMMAND, 'Wraith admin menu', 'keyboard', 'F10')
end

-- ── NUI callbacks: the page asks, this file forwards ──────────────────────────────────────────────

local function str(v, max) return type(v) == 'string' and #v <= (max or 40) and v or nil end

RegisterNUICallback('menuClose', function(_, cb)
    WMenu.close()
    cb('ok')
end)

RegisterNUICallback('menuAct', function(d, cb)
    local action = type(d) == 'table' and str(d.action) or nil
    if not WMenu.open or not action then cb({ ok = false, error = 'closed' }) return end
    -- Going somewhere: remember where we were, for "back".
    if action == 'player.goto' and WMenu.remember then WMenu.remember() end
    WMenu.act(action, type(d.args) == 'table' and d.args or {}, cb)
end)

RegisterNUICallback('menuSelf', function(d, cb)
    if not WMenu.open or type(d) ~= 'table' or not WMenu.runSelf then cb({ ok = false, error = 'closed' }) return end
    WMenu.runSelf(str(d.action), d, cb)
end)

RegisterNUICallback('menuSpectate', function(d, cb)
    local target = type(d) == 'table' and math.tointeger(tonumber(d.target)) or nil
    if not WMenu.open or not target or not WMenu.startSpectate then cb({ ok = false, error = 'closed' }) return end
    WMenu.act('player.spectate', { target = target }, function(r)
        if r.ok and type(r.data) == 'table' and type(r.data.coords) == 'table' then
            WMenu.close()
            WMenu.startSpectate(target, r.data.coords)
            cb({ ok = true })
        else
            cb(r.ok and { ok = false, error = 'no_ped' } or r)
        end
    end)
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if WMenu.open then SetNuiFocus(false, false) end
    WMenu.open = false
end)
