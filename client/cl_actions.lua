--- The client half — a headless executor, not an interface.
---
--- This file draws nothing, registers no command, binds no key and has no NUI. It exists because
--- eleven of the panel's actions are client-side effects: setting a ped on fire, ragdolling someone,
--- freezing them in place. The natives that do those things only exist on the game client, so
--- either this file exists or those eleven actions do not.
---
--- Everything here is triggered by the server and only by the server. Nothing listens to the player.
---
--- A note on the effects themselves: these are ports of w_admin's, and they are ports rather than
--- reinterpretations on purpose. Several were originally written here as approximations — lightning
--- as fire, drunkenness as a knockdown, a burning ped instead of a burning patch of ground — and each
--- approximation turned into a bug report, because an operator who knows what the button did before
--- reads a different outcome as a broken button. Where w_admin used a specific native, so does this.

local function myPed()
    return PlayerPedId()
end

local function coords()
    return GetEntityCoords(myPed())
end

--- Notifications go through w_lib's notification (the same look on every framework). If the
--- library is not up yet, the framework's own event: vorp:TipRight on VORP, RSGCore:Notify
--- on RSG / QBR.
local function notify(text, duration)
    duration = duration or 5000
    if GetResourceState('w_lib') == 'started' then
        local ok = pcall(function() exports.w_lib:Notify('', text, 'info', duration) end)
        if ok then return end
    end
    if GetResourceState('vorp_core') == 'started' then
        TriggerEvent('vorp:TipRight', text, duration)
    elseif GetResourceState('rsg-core') == 'started' then
        TriggerEvent('RSGCore:Notify', text, 'primary', duration)
    else
        TriggerEvent('QBCore:Notify', text, 'primary', duration)
    end
end

local EFFECTS = {}

EFFECTS.kill = function()
    SetEntityHealth(myPed(), 0)
end

EFFECTS.freeze = function(frozen)
    local ped = myPed()
    FreezeEntityPosition(ped, frozen and true or false)
    notify(frozen and 'You have been frozen by an administrator.'
                  or 'You have been unfrozen.')
end

--- Teleport, with the protections w_admin applied.
---
--- The server used to move the ped itself with a bare `SetEntityCoords`. That works right up until
--- the destination's collision has not streamed in yet — and then the player drops through the world
--- and takes the fall on the way down. Performing the move on the client is what makes it possible to
--- wait for the ground to exist before letting go, which the server simply cannot do.
---
--- Invincible and frozen across the move so the drop cannot kill anyone, and faded so the seam is not
--- on screen. Both are released afterwards even if the collision never loads, so a failed teleport
--- cannot leave a player permanently frozen or permanently immortal.
EFFECTS.teleport = function(data)
    data = type(data) == 'table' and data or {}
    local x, y, z = tonumber(data.x), tonumber(data.y), tonumber(data.z)
    if not (x and y and z) then return end
    local ped = myPed()

    DoScreenFadeOut(500)
    Wait(600)

    ClearPedTasks(ped)
    SetEntityInvincible(ped, true)
    FreezeEntityPosition(ped, true)

    SetEntityCoords(ped, x, y, z, false, false, false, false)
    RequestCollisionAtCoord(x, y, z)
    local timeout = 30
    while not HasCollisionLoadedAroundEntity(ped) and timeout > 0 do
        Wait(100)
        timeout = timeout - 1
    end

    local heading = tonumber(data.h)
    if heading then SetEntityHeading(ped, heading) end

    FreezeEntityPosition(ped, false)
    SetEntityInvincible(ped, false)
    DoScreenFadeIn(500)
end

--- A fire on the GROUND under the player, which puts itself out after 8 seconds.
---
--- This used to be `StartEntityFire(myPed())`, which sets the PLAYER alight — the fire follows them
--- wherever they run, and nothing in this resource ever called StopEntityFire, so a button meant as
--- a prank was very likely killing whoever it was used on. w_admin lit the world instead: a blaze
--- erupts at their feet, they can run out of it, and it ends on its own.
---
--- START_SCRIPT_FIRE / REMOVE_SCRIPT_FIRE by hash: they have no named wrapper in this build.
EFFECTS.trollSetOnFire = function()
    local c = coords()
    local fireId = Citizen.InvokeNative(0x6B83617E04503888, c.x, c.y, c.z - 0.5, 3, 1.0, true, nil, 1.0, 1)
    if not fireId then return end
    SetTimeout(8000, function()
        Citizen.InvokeNative(0x790125C36E194069, fireId)
    end)
end

EFFECTS.trollTPHeaven = function()
    local ped = myPed()
    local c = coords()
    SetEntityCoords(ped, c.x, c.y, c.z + 250.0, false, false, false, false)
end

EFFECTS.trollRagdoll = function()
    SetPedToRagdoll(myPed(), 5000, 5000, 0, false, false, false)
end

--- Spawns a hostile animal that charges the target, and cleans itself up after 30 seconds.
---
--- Matched to w_admin: one of THREE animals picked at random rather than always the same wolf, spawned
--- out at a distance and behind them so it arrives as a charge instead of appearing on top of them,
--- placed on the actual ground, and set hostile to players through the relationship groups so it
--- commits to the attack rather than wandering off.
---
--- `GetHashKey('a_c_wolf_small')` rather than a backtick hash literal on purpose: backtick literals
--- are a CFX extension that stock Lua tooling cannot parse, and keeping them out means `luac -p` over
--- this folder is a valid syntax check.
local ATTACK_ANIMALS = { 'a_c_wolf_small', 'a_c_bearblack_01', 'a_c_dogrufus_01' }

EFFECTS.trollWildAttack = function()
    local ped = myPed()
    if not DoesEntityExist(ped) then return end

    local model = GetHashKey(ATTACK_ANIMALS[math.random(#ATTACK_ANIMALS)])
    local animalGroup, playerGroup = GetHashKey('Animal'), GetHashKey('PLAYER')

    local spawn = GetOffsetFromEntityInWorldCoords(ped, 100.0, -15.0, 0.0)
    local heading = GetEntityHeading(ped)

    RequestModel(model)
    local waited = 0
    while not HasModelLoaded(model) and waited < 5000 do
        Wait(50)
        waited = waited + 50
    end
    if not HasModelLoaded(model) then return end

    local _, groundZ = GetGroundZAndNormalFor_3dCoord(spawn.x, spawn.y, spawn.z)
    local animal = CreatePed(model, spawn.x, spawn.y, groundZ or spawn.z, heading, true, false)
    if not animal or animal == 0 or not DoesEntityExist(animal) then
        SetModelAsNoLongerNeeded(model)
        return
    end

    -- A ped created in RedM has no variation applied yet, and an unvaried ped RENDERS AS NOTHING:
    -- it is solid, it attacks, it can kill you, and you cannot see it. `EquipMetaPedOutfitPreset` is
    -- what w_admin called and it is not enough for animals, which use the outfit-variation system
    -- rather than metaped outfits — which is why the wolf arrived invisible.
    Citizen.InvokeNative(0x283978A15512B2FE, animal, true) -- SET_RANDOM_OUTFIT_VARIATION
    EquipMetaPedOutfitPreset(animal, 0, 0)
    SetPedFleeAttributes(animal, 0, 0)
    SetPedRelationshipGroupHash(animal, animalGroup)
    TaskSetBlockingOfNonTemporaryEvents(animal, true)
    TaskCombatHatedTargetsAroundPed(animal, 30.0, 0)
    ClearPedTasks(animal)
    TaskPutPedDirectlyIntoMelee(animal, ped, 0.0, -1.0, 0.0, 0)
    -- RDR2 relation values are not GTA V's: 5 = WANTED, 6 = HATE (femga/rdr3_discoveries AI/RELATIONSHIP;
    -- Rockstar's 1491.50 native3.ysc.c:32367-32368 sets 6 both ways with PLAYER). The animal attacks the player.
    SetRelationshipBetweenGroups(6, animalGroup, playerGroup)
    SetRelationshipBetweenGroups(6, playerGroup, animalGroup)
    SetModelAsNoLongerNeeded(model)

    -- Cleaned up so a prank does not leave a permanent animal on the map.
    SetTimeout(30000, function()
        if DoesEntityExist(animal) then DeleteEntity(animal) end
    end)
end

--- Drain the stamina the way w_admin did.
---
--- The previous call was SET_ATTRIBUTE_CORE_VALUE(ped, 1, 0), which WRITES the stamina core outright.
--- A troll button should not be authoring a player's attribute cores; w_admin subtracted from the
--- stamina instead, which is the same visible outcome without seizing the value.
EFFECTS.trollDrainStamina = function()
    Citizen.InvokeNative(0xC3D4B754C0E86B9E, myPed(), -1000.0)
end

--- A TOGGLE, not a timed effect. Press once to cuff, press again to release.
---
--- This used to apply the cuffs and schedule `SetTimeout(30000, ...)` to take them off, so pressing
--- the button a second time to free someone did not free them — it cuffed them again and started a
--- second timer. Worse, the first timer was still running: it would fire and release the player
--- early, so the cuffs came off at a moment nobody chose. w_admin, which this resource replaces,
--- toggled, and that is the behaviour operators are used to.
---
--- The current state is read from the GAME (`IsPedCuffed`) rather than from a flag kept in this
--- file. A flag drifts: a respawn, a resource restart, or another script cuffing the player would
--- leave the two disagreeing, and the failure that produces is a player stuck in cuffs with a button
--- that insists they are already free. The game's own answer cannot drift.
EFFECTS.trollHandcuff = function()
    local ped = myPed()
    local cuffed = IsPedCuffed(ped)
    SetEnableHandcuffs(ped, not cuffed, false)
    -- Gestures come back exactly when the cuffs come off.
    SetPedCanPlayGestureAnims(ped, cuffed)
end

--- A screen effect for 15 seconds — the player's vision swims, and they keep control.
---
--- This used to shake the camera AND ragdoll them for 30 seconds, which knocks a player flat on
--- their back: a different and much harsher thing than being drunk, and twice as long. w_admin used
--- a post-effect and nothing else.
EFFECTS.trollDrunk = function()
    AnimpostfxPlay('MP_BountyLagrasSwamp')
    SetTimeout(15000, function() AnimpostfxStop('MP_BountyLagrasSwamp') end)
end

--- A TOGGLE, for the same reason as the cuffs above: pressing it again must reveal the player, and
--- a 30-second timer meant the second press only re-hid them. Visibility is read from the game.
EFFECTS.trollInvisible = function()
    local ped = myPed()
    SetEntityVisible(ped, not IsEntityVisible(ped), false)
end

--- The dispatcher, which now SAYS when something goes wrong.
---
--- It used to be `pcall(fn, arg)` with the result discarded. That makes the two failures an operator
--- actually hits indistinguishable from each other and from success: an effect that threw halfway
--- through and an event that never arrived both look like "I pressed the button and nothing
--- happened", with an empty console either way. Several of these effects call natives that do not
--- exist on every RedM build, and every one of those failures was being swallowed here.
---
--- The pcall stays — one bad effect must not take down the handler — but the error is printed.
RegisterNetEvent('w_connector:effect', function(verb, arg)
    local fn = EFFECTS[verb]
    if type(fn) ~= 'function' then
        print(('^3[w_connector]^0 received unknown effect `%s` — nothing to run.'):format(tostring(verb)))
        return
    end
    local ok, err = pcall(fn, arg)
    if not ok then
        print(('^1[w_connector]^0 effect `%s` failed: %s'):format(tostring(verb), tostring(err)))
    end
end)

--- Lightning — the one effect that is not done TO a ped.
---
--- The previous version claimed in a comment that RedM has no lightning native and approximated one
--- with fire, a ragdoll and 120 damage. That comment was simply wrong: `ForceLightningFlashAtCoords`
--- exists and is what w_admin used. The approximation also made "صاعقة" and "حرق" produce the same
--- thing on screen, so two different buttons did one job and the lightning button appeared broken.
---
--- It lights the sky at a POSITION, which is why it arrives here as coordinates and why the server
--- sends it to EVERY client rather than to the target alone: a strike only the victim can see is not
--- much of a strike. The coordinates are resolved on the server from the target's own ped.
RegisterNetEvent('w_connector:lightning', function(x, y, z)
    x, y, z = tonumber(x), tonumber(y), tonumber(z)
    if not (x and y and z) then return end
    ForceLightningFlashAtCoords(x, y, z, -1.0)
end)

--- A private message from an admin: a toast AND a chat line.
---
--- The toast alone disappears after ten seconds; if the player was looking away they never knew an
--- admin spoke to them. w_admin also wrote it into chat so it could be scrolled back to.
RegisterNetEvent('w_connector:message', function(from, message)
    from, message = tostring(from or 'Admin'), tostring(message or '')
    notify(('[%s] %s'):format(from, message), 10000)
    pcall(function()
        TriggerEvent('chat:addMessage', {
            color = { 255, 165, 0 },
            multiline = true,
            args = { ('Admin (%s)'):format(from), message },
        })
    end)
end)

--- A warning is not a generic tip.
---
--- It used to arrive through `w_connector:message` as "[Warning] <reason>" — no severity, no running
--- total, and nothing left in chat to read again. w_admin raised a coloured multi-line chat entry and
--- a notification stating how many warnings the player now holds, which is the part that lands.
RegisterNetEvent('w_connector:warning', function(data)
    data = type(data) == 'table' and data or {}
    local reason = tostring(data.reason or '')
    local by = tostring(data.warnedBy or 'Admin')
    local severity = tostring(data.severity or 'medium')
    local total = tonumber(data.total) or 1
    local threshold = tonumber(data.threshold) or 0

    notify(('You have been warned by %s: %s (warning %d)'):format(by, reason, total), 8000)
    pcall(function()
        TriggerEvent('chat:addMessage', {
            color = { 255, 255, 0 },
            multiline = true,
            args = {
                'WARNING',
                ('From: %s  |  Severity: %s  |  Warnings on record: %d'):format(by, severity, total),
                ('Reason: %s'):format(reason),
            },
        })
    end)
    if threshold > 0 and total >= threshold then
        notify(('That was warning %d of %d — you are being removed from the server.'):format(total, threshold), 8000)
    end
end)

RegisterNetEvent('w_connector:announce', function(message)
    notify(tostring(message or ''), 10000)
    -- Also into chat, when the server runs a chat resource. Harmless if it does not.
    pcall(function()
        TriggerEvent('chat:addMessage', { color = { 255, 180, 0 }, args = { 'Server', tostring(message or '') } })
    end)
end)
