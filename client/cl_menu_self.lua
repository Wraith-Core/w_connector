--- The in-game menu's self-administration: NoClip, God Mode, player IDs, own teleports, freeze, local
--- spectate and (FiveM) the current vehicle. Client-side by nature; each is switched on only after the
--- server confirms the permission from the website session, and each use is recorded on the website
--- (/ingame/audit). Switching something OFF never waits for anyone.
---
--- Natives, per game (see 08-ingame-menu.md for the list and where each was verified):
---   both:  PlayerPedId, GetEntityCoords, SetEntityCoordsNoOffset, SetEntityCollision, SetEntityVisible,
---          SetEntityInvincible, SetPlayerInvincible, FreezeEntityPosition, SetEntityVelocity,
---          SetEntityHeading, GetGameplayCamRot, GetDisabledControlNormal, IsControlPressed,
---          IsDisabledControlPressed, DisableControlAction, IsDisabledControlJustPressed, GetFrameTime,
---          GetActivePlayers, GetPlayerPed, GetPlayerServerId, GetPlayerName, GetPlayerFromServerId,
---          NetworkSetInSpectatorMode, SetFocusPosAndVel, ClearFocus, RequestCollisionAtCoord,
---          GetGroundZFor_3dCoord, IsWaypointActive, GetScreenCoordFromWorldCoord, SetTextScale,
---          SetTextCentre, GetVehiclePedIsIn, GetPedInVehicleSeat
---   FiveM: GetFirstBlipInfoId / GetBlipInfoIdCoord (waypoint), SetTextFont, SetTextColour,
---          SetTextOutline, BeginTextCommandDisplayText, AddTextComponentSubstringPlayerName,
---          EndTextCommandDisplayText, SetVehicleFixed, SetVehicleDeformationFixed,
---          SetVehicleEngineHealth, SetVehicleDirtLevel, NetworkRequestControlOfEntity,
---          NetworkHasControlOfEntity, SetEntityAsMissionEntity, DeleteVehicle
---   RedM:  GetWaypointCoords, SetTextColor, SetTextFontForCurrentCommand, CreateVarString, DisplayText,
---          IsPedOnMount, GetMount

local GAME = GetGameName() == 'redm' and 'redm' or 'fivem'
WMenu = WMenu or {}

-- Controls: FiveM uses control indices, RedM control hashes (the same ones Wraith's w_admin flies with).
local KEYS = GAME == 'redm'
    and { moveX = 0x4D8FB4C1, moveY = 0xFDA83190, up = 0xDE794E3E, down = 0xCEFD9220, fast = 0x8FFC75D6, attack = 0x07CE1E61, cancel = 0x156F7119 }
    or { moveX = 30, moveY = 31, up = 44, down = 38, fast = 21, attack = 24, cancel = 177 }
local ID_DISTANCE = 150.0

local state = { noclip = false, godmode = false, frozen = false, ids = false }
local noclipSpeed = 1.0
local noclipEntity, noclipPed
local back = nil -- the last place we teleported away from
local spect = nil -- { target, ped, saved, gen }
local gen = 0

local function ped() return PlayerPedId() end
local function pressed(k) return IsControlPressed(0, k) or IsDisabledControlPressed(0, k) end

function WMenu.selfState()
    return { noclip = state.noclip, godmode = state.godmode, frozen = state.frozen, ids = state.ids, back = back ~= nil, spectating = spect ~= nil }
end
function WMenu.spectateTarget() return spect and spect.target or false end

function WMenu.remember()
    local c = GetEntityCoords(ped())
    back = { x = c.x, y = c.y, z = c.z }
end

-- ── God mode ──────────────────────────────────────────────────────────────────────────────────────
local function applyGod(on)
    SetEntityInvincible(ped(), on)
    SetPlayerInvincible(PlayerId(), on)
end

local function setGod(on)
    state.godmode = on
    applyGod(on)
    if on then
        -- The ped can change (respawn, model change): keep it applied, once a second, only while on.
        CreateThread(function()
            while state.godmode do applyGod(true) Wait(1000) end
        end)
    end
end

-- ── Freeze self ───────────────────────────────────────────────────────────────────────────────────
local function setFrozen(on)
    state.frozen = on
    FreezeEntityPosition(ped(), on)
end

-- ── NoClip: camera-relative, frame-rate independent ──────────────────────────────────────────────
local function flyingEntity()
    local p = ped()
    local veh = GetVehiclePedIsIn(p, false)
    if veh ~= 0 and GetPedInVehicleSeat(veh, -1) == p then return veh end
    if GAME == 'redm' and IsPedOnMount(p) then return GetMount(p) end
    return p
end

local function restoreEntity(e)
    if not e or not DoesEntityExist(e) then return end
    FreezeEntityPosition(e, e == ped() and state.frozen)
    SetEntityCollision(e, true, true)
    SetEntityVisible(e, true)
    SetEntityInvincible(e, e == ped() and state.godmode)
end

local function setNoclip(on)
    if on == state.noclip then return end
    state.noclip = on
    if not on then
        gen = gen + 1
        -- Restore synchronously: resource-stop handlers cannot wait for a worker's next frame.
        if not spect then restoreEntity(noclipEntity); restoreEntity(noclipPed) end
        noclipEntity, noclipPed = nil, nil
        return
    end
    gen = gen + 1
    local my = gen
    local p = ped()
    local e = flyingEntity()
    noclipEntity, noclipPed = e, p
    CreateThread(function()
        while state.noclip and gen == my and DoesEntityExist(e) do
            local rot = GetGameplayCamRot(2)
            local yaw, pitch = math.rad(rot.z), math.rad(rot.x)
            local fx, fy, fz = -math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)
            local rx, ry = math.cos(yaw), math.sin(yaw)
            local step = math.min(GetFrameTime(), 0.05) * 12.0 * noclipSpeed * (pressed(KEYS.fast) and 4 or 1)
            local lr, ud = GetDisabledControlNormal(0, KEYS.moveX), GetDisabledControlNormal(0, KEYS.moveY)
            local vz = (pressed(KEYS.up) and 1 or 0) - (pressed(KEYS.down) and 1 or 0)
            if WMenu.open then lr, ud, vz = 0, 0, 0 end
            local c = GetEntityCoords(e)
            local x = c.x + (rx * lr - fx * ud) * step
            local y = c.y + (ry * lr - fy * ud) * step
            local z = c.z + (-fz * ud + vz) * step
            FreezeEntityPosition(e, true)
            SetEntityCollision(e, false, false)
            SetEntityVisible(e, false)
            SetEntityInvincible(e, true)
            if e ~= p then SetEntityVisible(p, false) end
            SetEntityVelocity(e, 0.0, 0.0, 0.0)
            -- NoOffset: SetEntityCoords puts a ped's feet at z while GetEntityCoords answers its root.
            SetEntityCoordsNoOffset(e, x, y, z, false, false, false)
            SetEntityHeading(e, rot.z)
            DisableControlAction(0, KEYS.up, true)
            DisableControlAction(0, KEYS.down, true)
            DisableControlAction(0, KEYS.attack, true)
            Wait(0)
        end
        -- Spectate took over the ped (it hides and parks it itself): leave it alone.
        if gen == my and not spect then
            restoreEntity(e)
            if e ~= p then restoreEntity(p) end
        end
        if gen == my then state.noclip = false; noclipEntity, noclipPed = nil, nil end
    end)
end

-- ── Teleports ─────────────────────────────────────────────────────────────────────────────────────
local function groundAt(x, y)
    local e = ped()
    for h = 950.0, 0.0, -50.0 do
        RequestCollisionAtCoord(x, y, h)
        SetEntityCoordsNoOffset(e, x, y, h, false, false, false)
        Wait(50)
        local found, z = GetGroundZFor_3dCoord(x, y, h, false)
        if found then return z end
    end
    return nil
end

local function teleport(x, y, z)
    WMenu.remember()
    local e = flyingEntity()
    FreezeEntityPosition(e, true)
    if not z then
        z = groundAt(x, y)
        if not z then
            SetEntityCoordsNoOffset(e, back.x, back.y, back.z, false, false, false)
            FreezeEntityPosition(e, state.frozen)
            return false
        end
    end
    RequestCollisionAtCoord(x, y, z)
    SetEntityCoordsNoOffset(e, x, y, z + 1.0, false, false, false)
    FreezeEntityPosition(e, e == ped() and state.frozen or false)
    return true
end

local function waypoint()
    if not IsWaypointActive() then return nil end
    if GAME == 'redm' then
        local c = GetWaypointCoords()
        return c and c.x, c and c.y
    end
    local c = GetBlipInfoIdCoord(GetFirstBlipInfoId(8))
    return c.x, c.y
end

-- ── Player IDs over heads ─────────────────────────────────────────────────────────────────────────
local function drawText(x, y, z, text)
    if GAME == 'redm' then
        local on, sx, sy = GetScreenCoordFromWorldCoord(x, y, z)
        if not on then return end
        SetTextScale(0.0, 0.32)
        SetTextColor(255, 255, 255, 230)
        SetTextFontForCurrentCommand(1)
        SetTextCentre(true)
        DisplayText(CreateVarString(10, 'LITERAL_STRING', text), sx, sy)
    else
        local on, sx, sy = GetScreenCoordFromWorldCoord(x, y, z)
        if not on then return end
        SetTextScale(0.32, 0.32)
        SetTextFont(4)
        SetTextColour(255, 255, 255, 230)
        SetTextOutline()
        SetTextCentre(true)
        BeginTextCommandDisplayText('STRING')
        AddTextComponentSubstringPlayerName(text)
        EndTextCommandDisplayText(sx, sy)
    end
end

local function setIds(on)
    if on == state.ids then return end
    state.ids = on
    if not on then return end
    CreateThread(function()
        local rows, nextScan = {}, 0
        while state.ids do
            local now = GetGameTimer()
            if now >= nextScan then
                rows = {}
                local me = GetEntityCoords(ped())
                for _, idx in ipairs(GetActivePlayers()) do
                    local p = GetPlayerPed(idx)
                    if p ~= 0 and DoesEntityExist(p) and #(GetEntityCoords(p) - me) <= ID_DISTANCE then
                        rows[#rows + 1] = { ped = p, text = ('[%d] %s'):format(GetPlayerServerId(idx), GetPlayerName(idx)) }
                    end
                end
                nextScan = now + 500
            end
            for _, r in ipairs(rows) do
                if DoesEntityExist(r.ped) then
                    local c = GetEntityCoords(r.ped)
                    drawText(c.x, c.y, c.z + 1.1, r.text)
                end
            end
            Wait(0)
        end
    end)
end

-- ── Spectate: the local camera follows the target; safe exit restores everything ────────────────
function WMenu.spectating() return spect ~= nil end

function WMenu.stopSpectate()
    if not spect then return end
    local s = spect
    spect = nil
    local p = ped()
    NetworkSetInSpectatorMode(false, (s.ped and s.ped ~= 0) and s.ped or p)
    ClearFocus()
    RequestCollisionAtCoord(s.saved.x, s.saved.y, s.saved.z)
    SetEntityCoordsNoOffset(p, s.saved.x, s.saved.y, s.saved.z, false, false, false)
    FreezeEntityPosition(p, state.frozen)
    SetEntityCollision(p, true, true)
    SetEntityVisible(p, true)
    SetEntityInvincible(p, state.godmode)
    TriggerServerEvent('w_connector:console:modeOff', 'player.spectate')
end

local function near(c)
    local p = ped()
    SetFocusPosAndVel(c.x, c.y, c.z, 0.0, 0.0, 0.0)
    RequestCollisionAtCoord(c.x, c.y, c.z)
    if #(GetEntityCoords(p) - vector3(c.x, c.y, c.z)) > 40.0 then
        SetEntityCoordsNoOffset(p, c.x, c.y, c.z - 10.0, false, false, false)
    end
end

function WMenu.startSpectate(target, coords)
    if spect then WMenu.stopSpectate() end
    local p = ped()
    local c = GetEntityCoords(p)
    spect = { target = target, ped = 0, saved = { x = c.x, y = c.y, z = c.z } }
    local s = spect
    if state.noclip then setNoclip(false) end -- its thread sees `spect` and leaves the ped to us
    SetEntityVisible(p, false)
    SetEntityCollision(p, false, false)
    SetEntityInvincible(p, true)
    FreezeEntityPosition(p, true)
    local tc = { x = tonumber(coords.x) or c.x, y = tonumber(coords.y) or c.y, z = tonumber(coords.z) or c.z }
    near(tc)
    CreateThread(function()
        local deadline = GetGameTimer() + 8000
        while spect == s and s.ped == 0 and GetGameTimer() < deadline do
            local idx = GetPlayerFromServerId(target)
            local tp = idx ~= -1 and GetPlayerPed(idx) or 0
            if tp ~= 0 and DoesEntityExist(tp) then s.ped = tp end
            Wait(100)
        end
        if spect ~= s then return end
        if s.ped == 0 then WMenu.toast('error', 'err_spectate_failed') WMenu.stopSpectate() return end
        NetworkSetInSpectatorMode(true, s.ped)
        WMenu.toast('info', 'spectate_hint')
        local nextFollow = 0
        while spect == s do
            local idx = GetPlayerFromServerId(target)
            local tp = idx ~= -1 and GetPlayerPed(idx) or 0
            if tp == 0 or not DoesEntityExist(tp) then WMenu.toast('info', 'spectate_lost') WMenu.stopSpectate() break end
            if tp ~= s.ped then s.ped = tp NetworkSetInSpectatorMode(true, tp) end
            if GetGameTimer() >= nextFollow then
                local t = GetEntityCoords(tp)
                near({ x = t.x, y = t.y, z = t.z })
                nextFollow = GetGameTimer() + 500
            end
            DisableControlAction(0, KEYS.cancel, true)
            if IsDisabledControlJustPressed(0, KEYS.cancel) or IsEntityDead(ped()) then WMenu.stopSpectate() break end
            Wait(0)
        end
    end)
end

-- ── FiveM: the current vehicle ────────────────────────────────────────────────────────────────────
local function currentVehicle()
    local v = GetVehiclePedIsIn(ped(), false)
    return v ~= 0 and v or nil
end

local function control(e)
    local deadline = GetGameTimer() + 1500
    while not NetworkHasControlOfEntity(e) and GetGameTimer() < deadline do
        NetworkRequestControlOfEntity(e)
        Wait(0)
    end
    return NetworkHasControlOfEntity(e)
end

-- ── The menu's self actions ───────────────────────────────────────────────────────────────────────
local TOGGLES = { ['self.noclip'] = setNoclip, ['self.godmode'] = setGod, ['self.freeze'] = setFrozen, ['self.viewids'] = setIds }

-- Called by the signed console execution reply. The legacy menu still uses runSelf below;
-- both paths share these implementations instead of maintaining two flight/spectate systems.
function WMenu.applySelf(action, d)
    d = d or {}
    local toggle = TOGGLES[action]
    if toggle then toggle(d.on == true); return { ok = true, active = d.on == true } end
    if action == 'self.noclipSpeed' then noclipSpeed = tonumber(d.speed) or 1; return { ok = true } end
    if action == 'self.tpWaypoint' then
        local x, y = waypoint()
        if not x then return { ok = false, error = 'no_waypoint' } end
        return { ok = teleport(x, y, nil), error = 'no_ground' }
    elseif action == 'self.tpCoords' then
        return { ok = teleport(d.x, d.y, d.z), error = 'no_ground' }
    elseif action == 'self.tpBack' then
        if not back then return { ok = false, error = 'nothing_to_return_to' } end
        local saved = back
        return { ok = teleport(saved.x, saved.y, saved.z), error = 'no_ground' }
    elseif action == 'self.stopSpectate' then WMenu.stopSpectate(); return { ok = true }
    end
    return { ok = false, error = 'unknown_action' }
end
WMenu.drawWorldText = drawText
WMenu.entityControl = control

--- Run one self action for the page: OFF at once, anything else after the server says yes.
function WMenu.runSelf(action, d, cb)
    local toggle = action and TOGGLES[action]
    if toggle and d.on ~= true then
        toggle(false)
        WMenu.self(action, { on = false }, function() end)
        return cb({ ok = true, state = WMenu.selfState() })
    end
    local details = { on = toggle and true or nil }
    if action == 'self.tpCoords' then
        details.x, details.y, details.z = tonumber(d.x), tonumber(d.y), tonumber(d.z)
        if not details.x or not details.y or math.abs(details.x) > 100000 or math.abs(details.y) > 100000 then return cb({ ok = false, error = 'invalid_args' }) end
    end
    WMenu.self(action or '', details, function(r)
        if not r.ok then return cb(r) end
        local ok, err = true, nil
        if toggle then
            toggle(true)
        elseif action == 'self.tpWaypoint' then
            local x, y = waypoint()
            if not x then ok, err = false, 'no_waypoint' else ok = teleport(x, y, nil) err = not ok and 'no_ground' or nil end
        elseif action == 'self.tpCoords' then
            ok = teleport(details.x, details.y, details.z) err = not ok and 'no_ground' or nil
        elseif action == 'self.tpBack' then
            if not back then ok, err = false, 'nothing_to_return_to' else
                local b = back
                ok = teleport(b.x, b.y, b.z)
            end
        elseif action == 'vehicle.repair' or action == 'vehicle.delete' then
            local v = GAME == 'fivem' and currentVehicle() or nil
            if not v then ok, err = false, 'no_vehicle'
            elseif not control(v) then ok, err = false, 'no_control'
            elseif action == 'vehicle.repair' then
                SetVehicleFixed(v) SetVehicleDeformationFixed(v) SetVehicleEngineHealth(v, 1000.0) SetVehicleDirtLevel(v, 0.0)
            else
                SetEntityAsMissionEntity(v, true, true) DeleteVehicle(v)
            end
        end
        cb({ ok = ok, error = err, state = WMenu.selfState() })
    end)
end

--- Everything off: access revoked or the resource stopping.
function WMenu.stopAll()
    if spect then WMenu.stopSpectate() end
    setNoclip(false)
    setIds(false)
    if state.godmode then state.godmode = false applyGod(false) end
    if state.frozen then setFrozen(false) end
end

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if spect then
        local s = spect
        spect = nil
        local p = ped()
        NetworkSetInSpectatorMode(false, p)
        ClearFocus()
        SetEntityCoordsNoOffset(p, s.saved.x, s.saved.y, s.saved.z, false, false, false)
        SetEntityVisible(p, true)
        SetEntityCollision(p, true, true)
        FreezeEntityPosition(p, false)
    end
    -- This resource's threads die with it: undo what they were holding.
    if state.noclip then
        local p = ped()
        local veh = GetVehiclePedIsIn(p, false)
        for _, e in ipairs({ p, veh }) do
            if e ~= 0 and DoesEntityExist(e) then
                FreezeEntityPosition(e, false) SetEntityCollision(e, true, true) SetEntityVisible(e, true) SetEntityInvincible(e, false)
            end
        end
    end
    state.noclip, state.ids = false, false
    if state.godmode then applyGod(false) end
    if state.frozen then FreezeEntityPosition(ped(), false) end
end)
