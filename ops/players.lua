--- Players: who is online and what their character looks like, in one shape for every framework.

local function round(n) return math.floor(n * 10 + 0.5) / 10 end

local function base(src)
    local out = {
        source = src,
        name = GetPlayerName(src),
        ping = GetPlayerPing(src),
        identifiers = WC.identifiers(src),
    }
    -- Where they stand, for the live map (server-side with OneSync).
    local ped = GetPlayerPed(src)
    if ped and ped ~= 0 then
        local c = GetEntityCoords(ped)
        out.coords = { x = round(c.x), y = round(c.y), z = round(c.z), h = round(GetEntityHeading(ped)) }
    end
    return out
end

--- One player in the normalised shape (03-connector-v2.md §4). Character fields are absent until the
--- player has chosen a character, or when no framework adapter was found.
function WC.playerView(src)
    local out = base(src)
    local fw = WC.Adapters.get('framework')
    if fw then
        local ok, char = pcall(fw.player, src)
        if ok and char then
            out.charId, out.charName, out.job, out.gang, out.money = char.charId, char.charName, char.job, char.gang, char.money
        end
    end
    return out
end

function WC.onlinePlayers()
    local out = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        if src then out[#out + 1] = WC.playerView(src) end
    end
    return out
end

WC.Ops.define('players.list', nil, function()
    return true, WC.onlinePlayers()
end)

WC.Ops.define('player.get', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local view = WC.playerView(src)
    local fw = WC.Adapters.get('framework')
    if fw then view.accounts = fw.accounts(src) end
    return true, view
end)
