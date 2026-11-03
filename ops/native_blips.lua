--- 2.4.0: blips on the game's own map (RedM), made from the console's «العلامات» page and shown to everyone.
---
---   console  blips.list                                             -> state
---            blips.save { id?, name, sprite, color?, x, y, z?, scale } -> state   (no id = a new blip)
---            blips.delete { id }                                    -> state
---   state = { list, rev, max, limits }
---
--- Only while w_map is NOT running. w_map draws its own map and keeps its blips in its own editor (/mapedit):
--- then every action here is unavailable (reason 'w_map_running'), so the page and its palette entry are
--- hidden, and every client takes our blips off its map until w_map stops (client/cl_blips.lua). The
--- console's leases learn it at once when w_map starts or stops (C.repackage), not on the next refresh.
---
--- Storage: this server's resource KVP 'wc_blips' (JSON { seq, list }), which survives restarts and
--- updates of the resource. Sync: GlobalState['w_connector:blips'] = { rev, list } with only what a client
--- draws; a player who joins gets it with the rest of the global state.
---
--- Nothing from the page is trusted: the website checked world.control (and audits every save / delete)
--- before the request came back here, and every value is checked again below:
---   name 1-48 letters (128 bytes), no colour codes or control characters · sprite one of the game's blip
---   sprites (core/blip_sprites.json, the list w_map ships) · colour none or BLIP_MODIFIER_MP_COLOR_1..32 ·
---   x, y within ±10000, z within -500..3000 or none · scale 0.2-2.0 · at most 200 blips.

local KVP = 'wc_blips'
local STATE = 'w_connector:blips'
local MAX = 200
local LIMITS = { name = 48, nameBytes = 128, scaleMin = 0.2, scaleMax = 2.0, xy = 10000, zMin = -500, zMax = 3000 }
-- one save per admin in this window: a double press is refused
local SAVE_GAP_MS = 400

WC.Blips = {}
local B = WC.Blips

-- ── the game's sprites (the names the page offers) ────────────────────────────

local SPRITES = {}
do
    local raw = LoadResourceFile(GetCurrentResourceName(), 'core/blip_sprites.json')
    local ok, data = pcall(json.decode, raw or '')
    for _, s in ipairs(ok and type(data) == 'table' and type(data.sprites) == 'table' and data.sprites or {}) do
        if type(s) == 'table' and type(s.name) == 'string' and s.name:match('^blip_[a-z0-9_]+$') then SPRITES[s.name] = true end
    end
end

-- ── what may be stored ────────────────────────────────────────────────────────

local function fail(key, data) return { ok = false, error = key, data = data } end

---A name as the map shows it: nil + an error key when it is empty, too long or not text.
local function cleanName(v)
    if type(v) ~= 'string' or #v > 1024 then return nil, 'err_blip_name' end
    local n
    repeat v, n = v:gsub('%^%d', '') until n == 0
    -- '~' starts the game's text tokens (~COLOR_RED~, ~INPUT_...~): a name never carries one. ASCII classes
    -- only: %c / %s follow the C locale and may take a byte out of an Arabic letter
    v = v:gsub('[%z\1-\31\127~]', ' '):gsub('[ \t]+', ' '):gsub('^ ', ''):gsub(' $', '')
    local len = utf8.len(v)
    if v == '' or not len then return nil, 'err_blip_name' end
    if len > LIMITS.name or #v > LIMITS.nameBytes then return nil, 'err_blip_name_long' end
    return v
end

local function cleanColor(v)
    if v == nil or v == '' then return nil end
    local n = type(v) == 'string' and tonumber(v:match('^BLIP_MODIFIER_MP_COLOR_(%d+)$'))
    if not n or n < 1 or n > 32 or n % 1 ~= 0 then return nil, 'err_blip_color' end
    return ('BLIP_MODIFIER_MP_COLOR_%d'):format(n)
end

local function finite(v) return type(v) == 'number' and v == v and v > -math.huge and v < math.huge end

local function round(v, step) return math.floor(v / step + 0.5) * step end

---One blip from the page, as it is kept: blip or nil + error key + the field at fault.
local function cleanBlip(raw)
    if type(raw) ~= 'table' then return nil, 'err_invalid_value' end
    local name, err = cleanName(raw.name)
    if not name then return nil, err, 'name' end
    if type(raw.sprite) ~= 'string' or not SPRITES[raw.sprite] then return nil, 'err_blip_sprite', 'sprite' end
    local color, cerr = cleanColor(raw.color)
    if cerr then return nil, cerr, 'color' end
    local x, y, z = raw.x, raw.y, raw.z
    if not finite(x) or not finite(y) or math.abs(x) > LIMITS.xy or math.abs(y) > LIMITS.xy then return nil, 'err_blip_coords', 'coords' end
    if z ~= nil and (not finite(z) or z < LIMITS.zMin or z > LIMITS.zMax) then return nil, 'err_blip_coords', 'coords' end
    local scale = raw.scale == nil and 1.0 or raw.scale
    if not finite(scale) or scale < LIMITS.scaleMin or scale > LIMITS.scaleMax then return nil, 'err_blip_scale', 'scale' end
    return {
        name = name, sprite = raw.sprite, color = color,
        x = round(x, 0.01), y = round(y, 0.01), z = z ~= nil and round(z, 0.01) or nil,
        scale = round(scale, 0.05),
    }
end

-- ── the store ─────────────────────────────────────────────────────────────────

local store = { seq = 0, list = {} }
local rev = 0

local function load()
    local raw = type(GetResourceKvpString) == 'function' and GetResourceKvpString(KVP) or nil
    local ok, data = pcall(json.decode, raw or '')
    if not ok or type(data) ~= 'table' then return end
    store.seq = math.tointeger(tonumber(data.seq)) or 0
    for _, row in ipairs(type(data.list) == 'table' and data.list or {}) do
        local b = type(row) == 'table' and cleanBlip(row) or nil
        local id = type(row) == 'table' and type(row.id) == 'string' and row.id:match('^b%d+$') and row.id or nil
        if b and id and #store.list < MAX then
            b.id, b.by, b.at = id, type(row.by) == 'string' and row.by:sub(1, 64) or nil, math.tointeger(tonumber(row.at))
            store.list[#store.list + 1] = b
            store.seq = math.max(store.seq, tonumber(id:sub(2)) or 0)
        end
    end
end

local function save()
    if type(SetResourceKvp) == 'function' then SetResourceKvp(KVP, json.encode({ seq = store.seq, list = store.list })) end
end

---What every client draws (no author, no time).
local function publish()
    rev = rev + 1
    local list = {}
    for i, b in ipairs(store.list) do
        list[i] = { id = b.id, name = b.name, sprite = b.sprite, color = b.color, x = b.x, y = b.y, z = b.z, scale = b.scale }
    end
    GlobalState[STATE] = { rev = rev, list = list }
end

local function state()
    return { list = store.list, rev = rev, max = MAX, limits = LIMITS }
end

local function indexOf(id)
    for i, b in ipairs(store.list) do if b.id == id then return i end end
end

-- ── w_map ─────────────────────────────────────────────────────────────────────

function B.wmap() return WC.started('w_map') end

function B.available()
    if WC.gameName() ~= 'rdr3' then return false, 'capability_missing' end
    if B.wmap() then return false, 'w_map_running' end
    return true
end

-- the console's open leases learn it now: the page and its palette entry go or come back at once
AddEventHandler('onResourceStart', function(res)
    if res == 'w_map' then SetTimeout(1000, function() if WC.Console and WC.Console.repackage then WC.Console.repackage() end end) end
end)
AddEventHandler('onResourceStop', function(res)
    if res == 'w_map' then SetTimeout(1000, function() if WC.Console and WC.Console.repackage then WC.Console.repackage() end end) end
end)

-- ── the actions ───────────────────────────────────────────────────────────────

local lastSave = {}
AddEventHandler('playerDropped', function() lastSave[source] = nil end)

---One action. `who` keys the double-press guard (the admin's server id); `by` is his name for the list.
function B.run(who, by, action, payload)
    local capable, reason = B.available()
    if not capable then return fail(reason) end
    if action == 'list' then return { ok = true, data = state() } end

    local now = GetGameTimer()
    if lastSave[who] and now - lastSave[who] < SAVE_GAP_MS then return fail('quick_cooldown') end
    lastSave[who] = now

    if action == 'delete' then
        local at = type(payload.id) == 'string' and indexOf(payload.id) or nil
        if not at then return fail('err_blip_gone', state()) end
        table.remove(store.list, at)
        save(); publish()
        return { ok = true, data = state() }
    end

    -- save: a new blip without an id, an edit with one
    local b, err, field = cleanBlip(payload)
    if not b then return fail(err, { field = field }) end
    local at
    if payload.id ~= nil then
        at = type(payload.id) == 'string' and indexOf(payload.id) or nil
        if not at then return fail('err_blip_gone', state()) end
        b.id = store.list[at].id
    else
        if #store.list >= MAX then return fail('err_blip_full', state()) end
        store.seq = store.seq + 1
        b.id = 'b' .. store.seq
    end
    b.by, b.at = type(by) == 'string' and by:sub(1, 64) or nil, os.time()
    if at then store.list[at] = b else store.list[#store.list + 1] = b end
    save(); publish()
    return { ok = true, data = state() }
end

for _, action in ipairs({ 'list', 'save', 'delete' }) do
    WC.Console.define('blips.' .. action, B.available, function(data, ctx)
        local r = B.run(ctx.source, GetPlayerName(ctx.source), action, type(data) == 'table' and data or {})
        if r.ok then return true, r.data end
        -- a refusal carries its detail (the fresh state when the blip is gone, the field at fault)
        return false, r.error, r.data
    end)
end

load()
publish()
