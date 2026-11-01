--- 2.2.0: one ban list. On a Wraith Core server w_core keeps its own `bans` table too (the anti-cheat's ExploitBan,
--- BanCitizen, the in-game console). Every 5 minutes the connector sends that table's live bans to the website
--- (POST /bans/sync, the complete list), so the panel shows and lifts them like its own; a ban lifted on the panel
--- is lifted in w_core by the op bans.coreLift.
---
--- The answer carries the panel's own live bans. They are kept on disk (KVP) and checked at join while the
--- website cannot be reached, so a banned player is not let in by an outage.

WC.Bans = { cache = {}, at = 0 }
local KVP, INTERVAL, FIRST = 'w_connector:webBans', 300000, 30000
local MAX = 2000

local function loadCache()
    if type(GetResourceKvpString) ~= 'function' then return end
    local raw = GetResourceKvpString(KVP)
    if type(raw) ~= 'string' or raw == '' then return end
    local ok, list = pcall(json.decode, raw)
    if ok and type(list) == 'table' then WC.Bans.cache = list end
end
loadCache()

local function keep(list)
    local out = {}
    for _, b in ipairs(type(list) == 'table' and list or {}) do
        if #out >= MAX then break end
        if type(b) == 'table' then
            out[#out + 1] = { id = math.tointeger(tonumber(b.id)), license = b.license, discord = b.discord, steam = b.steam, fivem = b.fivem,
                reason = type(b.reason) == 'string' and b.reason:sub(1, 200) or '', ['until'] = math.tointeger(tonumber(b['until'])) }
        end
    end
    WC.Bans.cache, WC.Bans.at = out, os.time()
    if type(SetResourceKvp) == 'function' then SetResourceKvp(KVP, json.encode(out)) end
end
WC.Bans.keep = keep

--- The cached panel ban covering one of these identifiers ({ license, discord, steam, fivem }), or nil.
function WC.Bans.cached(ids)
    local now = os.time()
    for _, b in ipairs(WC.Bans.cache) do
        if not b['until'] or b['until'] > now then
            for _, k in ipairs({ 'license', 'discord', 'steam', 'fivem' }) do
                if b[k] and ids[k] and b[k] == ids[k]:lower() then return b end
            end
        end
    end
    return nil
end

--- w_core's live bans, in the website's shape; nil when they cannot be read (never send a partial list: the
--- website treats a missing ban as lifted).
local function coreBans()
    if not WC.started('w_core') then return nil end
    local ok, rows = pcall(function() return exports.w_core:GetBans(5000) end)
    if not ok or type(rows) ~= 'table' then return nil end
    local out = {}
    for _, r in ipairs(rows) do
        local id = math.tointeger(tonumber(r.id))
        if id and id > 0 then
            out[#out + 1] = { coreId = id, license = r.license, discord = r.discord, steam = r.steam, name = r.name,
                reason = type(r.reason) == 'string' and r.reason:sub(1, 600) or nil, expire = tonumber(r.expire) or 2147483647,
                bannedBy = r.bannedby }
        end
    end
    return out
end

function WC.Bans.sync()
    if not WC.linked() then return false end
    local list = coreBans()
    local body = { bans = list or {}, full = true }
    -- without w_core (or when its list cannot be read) nothing is copied, but the panel's bans still come back
    if list == nil and WC.started('w_core') then return false end
    local status, res = WC.request('POST', '/bans/sync', body, 20000)
    if status ~= 200 or type(res) ~= 'table' or res.ok ~= true then return false end
    keep(res.web)
    return true
end

CreateThread(function()
    Wait(FIRST)
    while true do
        local ok, err = pcall(WC.Bans.sync)
        if not ok then print(('^1[w_connector] ban sync failed: %s^7'):format(tostring(err))) end
        Wait(INTERVAL)
    end
end)

-- The panel lifted a ban that came from the game: lift it in w_core too (kept there as history).
WC.Ops.define('bans.coreLift', function() return WC.started('w_core') end, function(args)
    local id = math.tointeger(tonumber(args.coreId))
    if not id or id <= 0 then return false, 'invalid_args' end
    local by = tostring(args.by or 'Wraith'):sub(1, 60) .. ' (website)'
    local ok, done, why = pcall(function() return exports.w_core:UnbanId(id, by) end)
    if not ok then return false, 'failed' end
    if done ~= true then return false, tostring(why or 'not_found'):sub(1, 40) end
    return true
end)
