--- 2.8.0: the admin jail, on the jailed player's own screen (ops/jail.lua holds him; this only shows it).
--- The page draws «سجن إداري», the time left and the reason (web/src/app/JailBanner.tsx); it counts down by itself.
--- While jailed he can do nothing (owner 2026-11-14 «يتعطل عنده كل شي خيوله واغراضه حقيبته»): no bag, no items,
--- no weapons, no horse (whistle, mount, saddlebag), no wagon, no fighting, no looting.

local function nui(action, data) SendNUIMessage({ action = action, data = data or {} }) end

local jailedUntil = 0  -- GetGameTimer() when the stay ends; 0 = free
local lockedBag = false -- we set invBusy, so we clear it again

local function jailed() return jailedUntil > GetGameTimer() end

-- every control that reaches a horse, a wagon, the bag, an item, a weapon or a fight
local BLOCKED = {
    `INPUT_ATTACK`, `INPUT_ATTACK2`, `INPUT_AIM`, `INPUT_MELEE_ATTACK`, `INPUT_MELEE_GRAPPLE`,
    `INPUT_MELEE_GRAPPLE_ATTACK`, `INPUT_MELEE_BLOCK`, `INPUT_MELEE_GRAPPLE_CHOKE`, `INPUT_MELEE_HORSE_ATTACK_PRIMARY`,
    `INPUT_MELEE_HORSE_ATTACK_SECONDARY`, `INPUT_THROW_GRENADE`, `INPUT_RELOAD`, `INPUT_NEXT_WEAPON`, `INPUT_PREV_WEAPON`,
    `INPUT_SELECT_NEXT_WEAPON`, `INPUT_SELECT_PREV_WEAPON`, `INPUT_TWIRL_PISTOL`, `INPUT_OPEN_WHEEL_MENU`,
    `INPUT_OPEN_SATCHEL_MENU`, `INPUT_OPEN_SATCHEL_HORSE_MENU`, `INPUT_QUICK_USE_ITEM`, `INPUT_WHISTLE`,
    `INPUT_WHISTLE_HORSEBACK`, `INPUT_ENTER`, `INPUT_HORSE_AIM`, `INPUT_HORSE_ATTACK`, `INPUT_INTERACT_HORSE_BRUSH`,
    `INPUT_INTERACT_HORSE_FEED`, `INPUT_INTERACT_LOCKON_ANIMAL`, `INPUT_INTERACT_ANIMAL`, `INPUT_LOOT`, `INPUT_LOOT2`,
    `INPUT_LOOT3`, `INPUT_LOOT_VEHICLE`, `INPUT_LOOT_AMMO`, `INPUT_LOOT_ALIVE_COMPONENT`, `INPUT_PICKUP`,
    `INPUT_PICKUP_CARRIABLE`, `INPUT_PICKUP_CARRIABLE2`, `INPUT_PLACE_CARRIABLE_ONTO_PARENT`, `INPUT_LASSO_ATTACK`,
    `INPUT_HOGTIE`, `INPUT_CARRIABLE_SUICIDE`, `INPUT_JUMP`, `INPUT_DUCK`,
}

local UNARMED = `WEAPON_UNARMED`

local function lockFrame(ped, id)
    DisablePlayerFiring(id, true)
    for i = 1, #BLOCKED do DisableControlAction(0, BLOCKED[i], true) end
end

-- once a second: bag shut, hands empty, off any horse or wagon
local function lockSecond(ped)
    local st = LocalPlayer.state
    if st.invBusy ~= true then st:set('invBusy', true, false); lockedBag = true end
    if st.invHotkeys ~= false then st:set('invHotkeys', false, false) end
    local _, weapon = GetCurrentPedWeapon(ped, true, 0, false)
    if weapon and weapon ~= UNARMED then SetCurrentPedWeapon(ped, UNARMED, true, 0, false, false) end
    if IsPedOnMount(ped) or IsPedInAnyVehicle(ped, false) then
        local mount = GetMount(ped)
        if mount ~= 0 then TaskDismountAnimal(ped, 1, 0, 0, 0, 0) else TaskLeaveAnyVehicle(ped, 0, 16) end
    end
end

local function unlock()
    if not lockedBag then return end
    lockedBag = false
    LocalPlayer.state:set('invBusy', false, false)
    LocalPlayer.state:set('invHotkeys', true, false)
end

local running = false
local function hold()
    if running then return end
    running = true
    CreateThread(function()
        local nextSecond = 0
        while jailed() do
            local ped, id = PlayerPedId(), PlayerId()
            lockFrame(ped, id)
            if GetGameTimer() >= nextSecond then
                nextSecond = GetGameTimer() + 1000
                lockSecond(ped)
            end
            Wait(0)
        end
        unlock()
        running = false
    end)
end

RegisterNetEvent('w_connector:jail:state', function(state)
    local left = type(state) == 'table' and (tonumber(state.left) or 0) or 0
    if left > 0 then
        jailedUntil = GetGameTimer() + left * 1000
        nui('jail', { left = left, reason = tostring(state.reason or '') })
        hold()
    else
        jailedUntil = 0
        nui('jail', { left = 0 })
    end
end)

RegisterNetEvent('w_connector:jail:freed', function()
    jailedUntil = 0
    nui('jail', { left = 0, freed = true })
end)

-- the server put him somewhere far: load the ground there so he does not fall through it
RegisterNetEvent('w_connector:jail:moved', function(at)
    if type(at) ~= 'table' or not at.x then return end
    RequestCollisionAtCoord(at.x + 0.0, at.y + 0.0, at.z + 0.0)
end)

AddEventHandler('onResourceStop', function(name)
    if name == GetCurrentResourceName() then unlock() end
end)

-- after a restart of this resource (or a join), ask for the state once the page is up
CreateThread(function()
    Wait(5000)
    TriggerServerEvent('w_connector:jail:ask')
end)
