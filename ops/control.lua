--- The rest of the administration surface (Phase 3, parity with the v1 panels): clearing an inventory,
--- offline players, kick-all, refreshing resources, routing buckets, the RedM troll effects, and
--- spawning a vehicle on FiveM. Each is offered only where what it needs exists on this server.

local function fw() return WC.Adapters.get('framework') end
local function inv() return WC.Adapters.get('inventory') end
local function has(get, fn) return function() local a = get() return a ~= nil and type(a[fn]) == 'function' end end

-- ── Inventory ──────────────────────────────────────────────────────────────────────────────────
--- scope: 'all' | 'items' | 'weapons' (weapons are separate only on VORP; elsewhere they are items).
WC.Ops.define('inventory.clear', has(inv, 'clear'), function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local scope = (args.scope == 'items' or args.scope == 'weapons') and args.scope or 'all'
    return inv().clear(src, scope)
end)

-- ── Offline players ────────────────────────────────────────────────────────────────────────────
WC.Ops.define('players.search', has(fw, 'search'), function(args)
    local q = type(args.q) == 'string' and args.q:gsub('^%s+', ''):gsub('%s+$', '') or ''
    if #q < 2 or #q > 64 or q:find('[%c%%_]') then return false, 'invalid_args' end
    return true, fw().search(q)
end)

WC.Ops.define('player.offline', has(fw, 'offline'), function(args)
    local id = type(args.charId) == 'string' and args.charId or tostring(args.charId or '')
    if not id:match('^[%w:_%-]+$') or #id > 64 then return false, 'invalid_args' end
    local row = fw().offline(id)
    if not row then return false, 'not_found' end
    return true, row
end)

--- Money for a character who is not in the game. `amount` signed, as money.adjust.
WC.Ops.define('money.adjustOffline', has(fw, 'moneyOffline'), function(args)
    local id = type(args.charId) == 'string' and args.charId or ''
    local account = type(args.account) == 'string' and args.account or ''
    local amount = tonumber(args.amount)
    if not id:match('^[%w:_%-]+$') or not account:match('^[%w_]+$') or not amount or amount ~= amount
        or amount == 0 or math.abs(amount) > 1e9 then
        return false, 'invalid_args'
    end
    return fw().moneyOffline(id, account, amount)
end)

-- ── Server ─────────────────────────────────────────────────────────────────────────────────────
WC.Ops.define('players.kickAll', nil, function(args)
    local reason = type(args.reason) == 'string' and args.reason:sub(1, 200) or ''
    local n = 0
    for _, id in ipairs(GetPlayers()) do
        DropPlayer(id, reason ~= '' and reason or 'The server is restarting')
        n = n + 1
    end
    return true, { kicked = n }
end)

--- `refresh` rescans the resources folder; it is a console command, so it needs the same ACE.
WC.Ops.define('resources.refresh', function()
    local v = IsPrincipalAceAllowed('resource.' .. GetCurrentResourceName(), 'command')
    return v == true or v == 1
end, function()
    ExecuteCommand('refresh')
    return true
end)

--- Routing buckets (separate "instances" of the world). A server native on both games; whether a
--- RedM build honours every bucket feature is not verified, so the panel says so on RedM.
WC.Ops.define('player.setBucket', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local b = math.tointeger(tonumber(args.bucket))
    if not b or b < 0 or b > 65535 then return false, 'invalid_args' end
    SetPlayerRoutingBucket(tostring(src), b)
    return true, { bucket = GetPlayerRoutingBucket(tostring(src)) }
end)

-- ── RedM: the troll effects (client/cl_actions.lua, ported unchanged from v1 — live-proven on RedM) ──
local TROLLS = {
    trollSetOnFire = true, trollTPHeaven = true, trollRagdoll = true, trollWildAttack = true,
    trollDrainStamina = true, trollHandcuff = true, trollDrunk = true, trollInvisible = true,
}

WC.Ops.define('player.troll', function() return WC.gameName() == 'rdr3' end, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local effect = type(args.effect) == 'string' and args.effect or ''
    if effect == 'trollLightning' then
        -- Struck at the target's own position, seen by everyone (as v1).
        local ped = GetPlayerPed(src)
        if ped == 0 then return false, 'no_ped' end
        local c = GetEntityCoords(ped)
        TriggerClientEvent('w_connector:lightning', -1, c.x, c.y, c.z)
        return true
    end
    if not TROLLS[effect] then return false, 'invalid_args' end
    TriggerClientEvent('w_connector:effect', src, effect)
    return true
end)

-- ── FiveM: spawn a vehicle for a player (server-side, OneSync: CreateVehicleServerSetter) ──────────
WC.Ops.define('vehicle.spawn', function() return WC.gameName() == 'gta5' end, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local model = type(args.model) == 'string' and args.model or ''
    if not model:match('^[%w_]+$') or #model > 32 then return false, 'invalid_args' end
    local ped = GetPlayerPed(src)
    if ped == 0 then return false, 'no_ped' end
    local c = GetEntityCoords(ped)
    local veh = CreateVehicleServerSetter(GetHashKey(model), 'automobile', c.x, c.y, c.z + 1.0, GetEntityHeading(ped))
    if not veh or veh == 0 then return false, 'refused' end
    SetPedIntoVehicle(ped, veh, -1)
    return true, { vehicle = veh }
end)
