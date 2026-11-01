--- 2.2.0: the pause menu's news and the world's cycle, run here without w_admin (its server/sv_news.lua
--- and sv_console.lua worldCycle / SiteRun, rebuilt the same way, same keys and answers):
---
---   console  news.newsList                 -> state
---            news.newsSave { list, rev }   -> state   the whole list, in carousel order
---            news.newsReset { rev }        -> state   back to w_pausemenu's Config.News.items
---   website  admin.run { kind = 'news', payload = { action = newsList|newsSave|newsReset, list?, rev? } }
---            admin.run { kind = 'server', payload = { action = 'world' } }              -> the cycle's state
---            admin.run { kind = 'server', payload = { action = freezeTime|dynamicWeather|blackout,
---                                                     args = { state = true|false } } } -> { state }
---   state = { list, rev, plates, limits, resource }
---
--- w_pausemenu owns the news (its server/board.lua): SetNews replaces the whole list in one step, keeps it
--- in its KVP and pushes it to every pause menu open right now. This file only calls its exports.
---
--- Nothing from the page is trusted. Every item is cleaned and measured the way board.lua cleans it (the
--- chat colour codes ^0-^9 go, control characters become a space, the ends are trimmed), then:
---   title 80 · text 400 · date 60 · image 300 · id 40   in BYTES, as board.lua counts
---   at most 12 items · a title in at least one language · unique ids (a missing or repeated id gets a new
---   one here) · the image is a bundled plate ('news/<name>.<ext>') or a picture another resource serves
---   (nui://<resource>/<path> or https://cfx-nui-<resource>/<path>), webp / png / jpg / gif
--- A value over a limit is refused, never cut (board.lua cuts by bytes and could split an Arabic letter).
--- A field that did not change (same id, same value as the live list) passes as it is.
--- `rev` names the list the page last read: a save over a list someone changed meanwhile is refused
--- (err_news_changed) with the fresh state, so two admins never overwrite each other unseen.
--- The website checked the staff member's permission (news.manage / world.control) before any of this.

local RES = 'w_pausemenu'
-- the newspaper pictures w_pausemenu ships (its web/build/news), offered as thumbnails in the editor
local PLATES = { 'news/saloon.webp', 'news/wagons.webp', 'news/frontier.webp' }

-- w_pausemenu/server/board.lua's own limits (bytes) and its 12 items
local LIMITS = { title = 80, text = 400, date = 60, image = 300, id = 40, items = 12 }
local TEXTS = { 'title', 'text', 'date' }
local IMAGE_EXT = { webp = true, png = true, jpg = true, jpeg = true, gif = true }
local MAX_LANGS = 8
-- a raw value longer than this (bytes, before cleaning) is refused before any pattern runs over it: far
-- over every limit above, and it keeps the cleaning cheap
local RAW_MAX = 2048
-- one save per admin (the website panel counts as one) in this window: a double press is refused
local SAVE_GAP_MS = 400

local lastSave = {}
AddEventHandler('playerDropped', function() lastSave[source] = nil end)

local function fail(key, data) return { ok = false, error = key, data = data } end

-- ── reading w_pausemenu ───────────────────────────────────────────────────────

---The live list, or nil when w_pausemenu is not running (or has no news board).
local function liveNews()
    if not WC.started(RES) then return nil end
    local ok, list = pcall(function() return exports[RES]:GetNews() end)
    if not ok or type(list) ~= 'table' then return nil end
    return list
end

-- ── one text, as the pause menu shows it ──────────────────────────────────────

---board.lua's trim without the cut: nil when empty; nil + 'err_news_too_long' when over RAW_MAX.
local function clean(v)
    if type(v) == 'number' then v = tostring(v) end
    if type(v) ~= 'string' then return nil end
    if #v > RAW_MAX then return nil, 'err_news_too_long' end
    -- the colour codes until none is left: one pass over '^^11' leaves '^1', which board.lua's own pass
    -- then takes away (a title that passed here would reach the pause menu empty)
    local n
    repeat v, n = v:gsub('%^%d', '') until n == 0
    v = v:gsub('[%c]', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    return v
end

---A text in every language it has, as one comparable line ('ar=...\1en=...'). A plain string is the
---same text for both languages, as the pause menu reads it.
local function canonLoc(v)
    if type(v) == 'string' or type(v) == 'number' then v = { ar = tostring(v) } end
    if type(v) ~= 'table' then return '' end
    local keys = {}
    for k, s in pairs(v) do
        if type(k) == 'string' and (type(s) == 'string' or type(s) == 'number') and tostring(s) ~= '' then
            keys[#keys + 1] = k
        end
    end
    table.sort(keys)
    for i, k in ipairs(keys) do keys[i] = k .. '=' .. tostring(v[k]) end
    return table.concat(keys, '\1')
end

local function canonItem(n)
    if type(n) ~= 'table' then return '' end
    return table.concat({ canonLoc(n.title), canonLoc(n.text), canonLoc(n.date), tostring(n.image or '') }, '\2')
end

local function canonList(list)
    local parts = {}
    for i, n in ipairs(list) do parts[i] = tostring(type(n) == 'table' and n.id or '') .. '\3' .. canonItem(n) end
    return table.concat(parts, '\4')
end

---A short name for a list's content (djb2 over the canonical form): the page sends it back with a save.
local function revOf(list)
    local s = canonList(list)
    local h = 5381
    for i = 1, #s do h = (h * 33 + s:byte(i)) & 0xFFFFFFFF end
    return ('%d-%08x'):format(#list, h)
end

-- ── what the page may send ────────────────────────────────────────────────────

---A text in one or more languages, cleaned and measured: value (nil = empty), error key.
local function localized(v, max)
    if v == nil then return nil end
    if type(v) == 'string' or type(v) == 'number' then v = { ar = v } end
    if type(v) ~= 'table' then return nil, 'err_invalid_value' end
    local out, any, n = {}, false, 0
    for lang, s in pairs(v) do
        n = n + 1
        if n > MAX_LANGS then return nil, 'err_invalid_value' end
        if type(lang) == 'string' and lang:match('^%a%a$') then
            local t, terr = clean(s)
            if terr then return nil, terr end
            if t then
                if not utf8.len(t) then return nil, 'err_invalid_value' end
                if #t > max then return nil, 'err_news_too_long' end
                out[lang] = t
                any = true
            end
        end
    end
    return any and out or nil
end

---A plate the pause menu can draw: a bundled one or another resource's picture, nothing from outside.
---nil = none (the pause menu takes a bundled plate in turn), or nil + an error key.
local function imagePath(v)
    if v == nil then return nil end
    if type(v) ~= 'string' or #v > RAW_MAX then return nil, 'err_news_image' end
    v = v:gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    if #v > LIMITS.image or v:find('..', 1, true) or v:find('[^%w_%-%./:]') then return nil, 'err_news_image' end
    local shaped = v:match('^news/[%w_%-%./]+$') or v:match('^nui://[%w_%-]+/[%w_%-%./]+$')
        or v:match('^https://cfx%-nui%-[%w_%-]+/[%w_%-%./]+$')
    local ext = v:match('%.(%w+)$')
    if not shaped or not ext or not IMAGE_EXT[ext:lower()] then return nil, 'err_news_image' end
    return v
end

local function idOf(v)
    local id = clean(v)
    if not id or #id > LIMITS.id or not utf8.len(id) then return nil end
    return id
end

local idSeq = 0
---A new id no item of this save takes: not one given out already (seen), nor one another item of the
---list sends or the live list holds (reserved), so an id handed out here never renames a later item.
local function newId(seen, reserved)
    local id
    repeat
        idSeq = idSeq + 1
        id = ('n%d%02d'):format(os.time(), idSeq % 100)
    until not seen[id] and not reserved[id]
    return id
end

---One item of the page's list, as w_pausemenu will keep it: item, or nil + error key + the field at fault.
local function cleanItem(raw, liveById, seen, reserved)
    if type(raw) ~= 'table' then return nil, 'err_invalid_value' end
    local id = idOf(raw.id)
    if id and seen[id] then id = nil end
    local live = id and liveById[id] or nil
    local out = {}
    for _, field in ipairs(TEXTS) do
        if live and canonLoc(live[field]) == canonLoc(raw[field]) then
            out[field] = live[field]
        else
            local v, err = localized(raw[field], LIMITS[field])
            if err then return nil, err, field end
            out[field] = v
        end
    end
    if not out.title then return nil, 'err_news_title', 'title' end
    local rawImage = type(raw.image) == 'string' and raw.image or ''
    if live and tostring(live.image or '') == rawImage then
        out.image = live.image
    else
        local image, err = imagePath(raw.image)
        if err then return nil, err, 'image' end
        out.image = image
    end
    id = id or newId(seen, reserved)
    seen[id] = true
    out.id = id
    return out
end

---True when t is a list 1..n with nothing else in it (an empty table is an empty list).
local function isList(t)
    if type(t) ~= 'table' then return false end
    local n = #t
    for k in pairs(t) do
        if math.type(k) ~= 'integer' or k < 1 or k > n then return false end
    end
    return true
end

-- ── the news runner ───────────────────────────────────────────────────────────

local function plates()
    local out = {}
    for _, p in ipairs(PLATES) do
        if imagePath(p) then out[#out + 1] = p end
    end
    return out
end

local function state(list)
    return { list = list, rev = revOf(list), plates = plates(), limits = LIMITS, resource = RES }
end

---One news action. `who` keys the double-press guard (the admin's server id, or 'web' for the website
---panel). Answers w_admin's shape: { ok, error, msg, data }.
local function runNews(who, action, payload)
    local live = liveNews()
    if not live then return fail('err_news_missing') end
    if action == 'newsList' then return { ok = true, data = state(live) } end

    local now = GetGameTimer()
    if lastSave[who] and now - lastSave[who] < SAVE_GAP_MS then return fail('quick_cooldown') end
    lastSave[who] = now
    if payload.rev ~= revOf(live) then return fail('err_news_changed', state(live)) end

    if action == 'newsReset' then
        local ok = pcall(function() return exports[RES]:ResetNews() end)
        if not ok then return fail('err_failed') end
        return { ok = true, msg = 'toast_news_reset', data = state(liveNews() or {}) }
    end

    -- newsSave: the whole list, in carousel order
    local list = payload.list
    if not isList(list) then return fail('err_invalid_value') end
    if #list > LIMITS.items then return fail('err_news_full') end
    local liveById, reserved = {}, {}
    for _, n in ipairs(live) do
        if type(n) == 'table' and n.id ~= nil then liveById[n.id] = n reserved[n.id] = true end
    end
    for i = 1, #list do
        local id = type(list[i]) == 'table' and idOf(list[i].id) or nil
        if id then reserved[id] = true end
    end
    local cleaned, seen = {}, {}
    for i = 1, #list do
        local n, err, field = cleanItem(list[i], liveById, seen, reserved)
        if not n then return fail(err, { index = i, field = field }) end
        cleaned[i] = n
    end
    if canonList(cleaned) == canonList(live) then
        return { ok = true, msg = 'toast_news_same', data = state(live) }
    end
    local ok = pcall(function() return exports[RES]:SetNews(cleaned) end)
    if not ok then return fail('err_failed') end
    return { ok = true, msg = 'toast_news_saved', data = state(liveNews() or cleaned) }
end

-- ── the world's cycle (w_weathersync) ─────────────────────────────────────────

---w_weathersync's cycle state for the world controls: { timeFrozen, dynamicWeather, blackout }
local function worldCycle()
    if not WC.started('w_weathersync') then return nil end
    local ok, s = pcall(function()
        return {
            timeFrozen = exports.w_weathersync:getTimeFreezeState() == true,
            dynamicWeather = exports.w_weathersync:getDynamicWeather() == true,
            blackout = exports.w_weathersync:getBlackoutState() == true,
        }
    end)
    return ok and s or nil
end

local CYCLE = {
    freezeTime = { on = 'toast_time_frozen', off = 'toast_time_unfrozen' },
    dynamicWeather = { on = 'toast_weather_dynamic', off = 'toast_weather_fixed' },
    blackout = { on = 'toast_blackout_on', off = 'toast_blackout_off' },
}

---'world' reads the cycle; a switch { state = true | false } runs the console's own server.<switch>
---(console_actions.lua, w_weathersync's setTimeFreeze / setDynamicWeather / setBlackout), not a copy of it.
local function runWorld(action, args)
    if not WC.started('w_weathersync') then return fail('err_weather_missing') end
    if action == 'world' then
        local s = worldCycle()
        if not s then return fail('err_weather_missing') end
        return { ok = true, data = s }
    end
    local def = CYCLE[action]
    local handler = WC.Console.handlers['server.' .. action]
    if not def or not handler then return fail('err_unknown_action') end
    if type(args.state) ~= 'boolean' then return fail('err_invalid_value') end
    local called, ok, data = pcall(handler.run, { args = { state = args.state } }, nil)
    if not called or ok ~= true or type(data) ~= 'table' then return fail('err_failed') end
    local now = data.state == true
    return { ok = true, msg = now and def.on or def.off, data = { state = now } }
end

-- ── the console's news page ───────────────────────────────────────────────────

local function newsAvailable()
    if WC.started(RES) then return true end
    return false, 'capability_missing'
end

for _, action in ipairs({ 'newsList', 'newsSave', 'newsReset' }) do
    WC.Console.define('news.' .. action, newsAvailable, function(data, ctx)
        local r = runNews(ctx.source, action, data)
        if r.ok then return true, r.data end
        -- a refusal carries its detail (the fresh state of a conflict, the item and field at fault)
        return false, r.error, r.data
    end)
end

-- ── the website panel (gamePanel.ts /news and /world/cycle, the legacy panel's getNews / setWorldCycle) ──

local RUN = {
    news = { newsList = true, newsSave = true, newsReset = true },
    server = { freezeTime = true, dynamicWeather = true, blackout = true, world = true },
}

WC.Ops.define('admin.run', function() return WC.started(RES) or WC.started('w_weathersync') end, function(args)
    local kind = type(args.kind) == 'string' and args.kind or ''
    local payload = type(args.payload) == 'table' and args.payload or {}
    local action = type(payload.action) == 'string' and payload.action or ''
    if not RUN[kind] or not RUN[kind][action] then return false, 'invalid_args' end
    local r
    if kind == 'news' then r = runNews('web', action, payload)
    else r = runWorld(action, type(payload.args) == 'table' and payload.args or {}) end
    if not r.ok then return false, tostring(r.error or 'err_failed'):sub(1, 60) end
    return true, { message = r.msg, data = r.data }
end)
