--- 2.2.0: the live settings of other scripts, the HUD's server settings and a player's needs, run here
--- without w_admin (a port of w_admin server/sv_settings.lua, sv_console.lua runHud and playerActions.needs).
---
--- Live settings (the w_settings protocol of w_lib's w.settings module): a resource opts in with the manifest
--- line  w_settings 'yes'  and then answers three exports of its own:
---   WSettingsSchema()                 the fields, their ranges and texts in both languages
---   WSettingsValues(group?)           { values, defaults, overridden, rows?, orphans }
---   WSettingsApply(changes, actor)    { ok, applied, rejected, batch? } -- the RESOURCE validates again, saves,
---                                     writes its Config, writes the audit row, pushes to its clients
--- w_lib's WSettingsApply answers only w_admin, w_lib or the resource itself, so a resource that wants this
--- console exports WSettingsApplyConnector (the same apply, behind a GetInvokingResource() == 'w_connector'
--- check; w_hud 2.1.4). Without it WSettingsApply is asked and refuses until w_lib accepts w_connector.
---
--- The website decides who may run each action (consolePolicy.ts); on top of that this file keeps w_admin's
--- levels: a script or a group may need a higher level (SETTINGS_LEVELS, a group's own `level`), and import /
--- presets need the top level. The panel owner holds the top level ('god'); every other role that the website
--- lets in holds 'admin'. The resource's own admin test (spec.access, w_hud.admin) still applies to the actor.
---
--- Needs: w_hud owns hunger and thirst while it runs (exports SetNeed / GetNeedsPair); without it the framework
--- does (WCore: the core metadata, which w_core then decays itself). Stamina lives only on the target's client.

local C = WC.Console
local function fw() return WC.Adapters.get('framework') end

-- ── levels (w_admin Config.Levels / Config.SettingsPerms) ───────────────────────────────────────────────────

local LEVEL_RANK = { mod = 1, admin = 2, god = 3 }
local TOP = 'god'
-- '<resource>.<group>' wins over '<resource>', which wins over `default`; a group may ask more itself.
-- Economy settings (store margins, house prices, market fees) are the owner's.
local SETTINGS_LEVELS = { default = 'admin', w_store = 'god', w_marketplace = 'god', w_logs = 'god', ['w_housing.prices'] = 'god' }

local function higher(a, b)
    if not a then return b end
    if not b then return a end
    return (LEVEL_RANK[a] or 0) >= (LEVEL_RANK[b] or 0) and a or b
end

--- The level a resource (or one of its groups) needs. A misspelled level closes it to all but the top.
local function levelFor(res, group, declared)
    local level = (group and SETTINGS_LEVELS[res .. '.' .. group]) or SETTINGS_LEVELS[res] or SETTINGS_LEVELS.default
    if not LEVEL_RANK[level] then level = TOP end
    if declared ~= nil and not LEVEL_RANK[declared] then declared = TOP end
    return higher(level, declared)
end

--- The admin's level from the website session: the panel owner is the top level, every other role 'admin'.
local function levelOf(session)
    if type(session) ~= 'table' then return nil end
    if session.role == 'owner' then return TOP end
    for _, p in ipairs(type(session.permissions) == 'table' and session.permissions or {}) do
        if p == 'connector.manage' then return TOP end
    end
    return 'admin'
end

local function hasLevel(ctx, level)
    local mine = LEVEL_RANK[levelOf(ctx and ctx.session)] or 0
    return mine >= (LEVEL_RANK[level] or math.huge)
end

-- ── the protocol's validator (a port of w_lib modules/settings/shared.lua: index, locate, check) ───────────

local KEY_PATTERN, ID_PATTERN, MAX_KEY, MAX_CHANGES, MAX_TEXT = '^[%w_%-%.]+$', '^[%w_%-]+$', 191, 500, 2000

local function copy(v)
    if type(v) ~= 'table' then return v end
    local out = {}
    for k, x in pairs(v) do out[k] = copy(x) end
    return out
end

local function equal(a, b)
    if a == b then return true end
    local ta, tb = type(a), type(b)
    if ta == 'number' and tb == 'number' then return math.abs(a - b) < 1e-9 end
    if ta ~= 'table' or tb ~= 'table' then return false end
    for k, v in pairs(a) do if not equal(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end

local function finite(n) return type(n) == 'number' and n == n and n ~= math.huge and n ~= -math.huge end

--- Why `value` cannot be stored in `field` ('bad_type' | 'out_of_range'), or nil. Never clamped.
local function check(field, value)
    local kind = field and field.type
    if kind == 'number' then
        if not finite(value) then return 'bad_type' end
        if field.integer and value % 1 ~= 0 then return 'bad_type' end
        if field.min and value < field.min - 1e-9 then return 'out_of_range' end
        if field.max and value > field.max + 1e-9 then return 'out_of_range' end
        local step = tonumber(field.step)
        if step and step > 0 then
            local n = (value - (field.min or 0)) / step
            if math.abs(n - math.floor(n + 0.5)) > 1e-6 then return 'out_of_range' end
        end
        return nil
    elseif kind == 'bool' then
        if type(value) == 'boolean' then return nil end
        return 'bad_type'
    elseif kind == 'enum' then
        for _, option in ipairs(field.options or {}) do if option.value == value then return nil end end
        return (type(value) == 'string' or type(value) == 'number') and 'out_of_range' or 'bad_type'
    elseif kind == 'text' then
        if type(value) ~= 'string' or value:find('\0', 1, true) then return 'bad_type' end
        local length = utf8.len(value)
        if not length then return 'bad_type' end
        if length > (field.maxLength or MAX_TEXT) then return 'out_of_range' end
        if field.pattern and value ~= '' and not value:match(field.pattern) then return 'out_of_range' end
        return nil
    elseif kind == 'list' then
        if type(value) ~= 'table' then return 'bad_type' end
        local n = #value
        for k in pairs(value) do if math.type(k) ~= 'integer' or k < 1 or k > n then return 'bad_type' end end
        if field.maxItems and n > field.maxItems then return 'out_of_range' end
        if type(field.item) == 'table' then
            for i = 1, n do local reason = check(field.item, value[i]); if reason then return reason end end
        end
        return nil
    end
    return 'bad_type'
end

--- { fields = { [key] = field }, groupOf = { [key] = group }, tables = { [groupId] = { group, columns } } }
local function indexOf(groups)
    local index = { fields = {}, groupOf = {}, tables = {}, groups = {} }
    for _, group in ipairs(groups) do
        index.groups[group.id] = group
        local fields = type(group.fields) == 'table' and group.fields or {}
        -- the schema shape of a table group: one field of type 'table' that carries the columns
        local columns = fields[1] and fields[1].type == 'table' and fields[1].columns or nil
        if columns then
            local cols = {}
            for _, column in ipairs(columns) do cols[column.key] = column end
            index.tables[group.id] = { group = group, columns = cols }
        else
            for _, field in ipairs(fields) do
                if type(field) ~= 'table' or type(field.key) ~= 'string' then error('a field without a key') end
                index.fields[field.key] = field
                index.groupOf[field.key] = group
            end
        end
    end
    return index
end

--- A key names a field ('field', field, group) or a table cell '<group>.<row>.<column>' ('cell', column, group, row).
local function locate(index, key)
    if type(key) ~= 'string' or #key > MAX_KEY or not key:match(KEY_PATTERN) then return nil end
    local field = index.fields[key]
    if field then return 'field', field, index.groupOf[key] end
    local groupId, rest = key:match('^([^%.]+)%.(.+)$')
    local tbl = groupId and index.tables[groupId]
    if not tbl then return nil end
    local row, col = rest:match('^(.+)%.([^%.]+)$')
    if not row or row:find('.', 1, true) then return nil end
    local column = tbl.columns[col]
    if not column then return nil end
    return 'cell', column, tbl.group, row
end

--- The SHAPE of a batch: { key, from, to } or { key, from, reset = true }. -> list, rejected
local function checkChanges(index, changes)
    local list, rejected = {}, {}
    if type(changes) ~= 'table' then return list, { { key = '', reason = 'bad_type' } } end
    local n = #changes
    if n == 0 then return list, rejected end
    if n > MAX_CHANGES then return list, { { key = '', reason = 'too_many' } } end
    for k in pairs(changes) do
        if math.type(k) ~= 'integer' or k < 1 or k > n then return list, { { key = '', reason = 'bad_type' } } end
    end
    local seen = {}
    for i = 1, n do
        local change = changes[i]
        local key = type(change) == 'table' and change.key or nil
        local function reject(reason) rejected[#rejected + 1] = { key = type(key) == 'string' and key or '', reason = reason } end
        if type(change) ~= 'table' or type(key) ~= 'string' then reject('bad_type')
        elseif seen[key] then reject('duplicate')
        else
            seen[key] = true
            local kind, field, group, row = locate(index, key)
            local reset = change.reset == true
            if not kind or field.readOnly == true then reject('unknown_key')
            else
                local reason = not reset and check(field, change.to) or nil
                if reason then reject(reason)
                else list[#list + 1] = { key = key, kind = kind, field = field, group = group, row = row, from = change.from, to = copy(change.to), reset = reset } end
            end
        end
    end
    return list, rejected
end

-- ── which resources opted in ─────────────────────────────────────────────────────────────────────────────

local opted, schemas, busy = nil, {}, {}
AddEventHandler('onResourceStart', function(res) opted = nil; schemas[res] = nil end)
AddEventHandler('onResourceStop', function(res) opted = nil; schemas[res] = nil end)

local function validName(res) return type(res) == 'string' and #res <= 64 and res:match('^[%w_%-%.]+$') ~= nil end

local function isOptedIn(res)
    return validName(res) and GetResourceMetadata(res, 'w_settings', 0) == 'yes'
end

local function optedIn()
    if opted then return opted end
    local list = {}
    for i = 0, GetNumResources() - 1 do
        local res = GetResourceByFindIndex(i)
        if res and isOptedIn(res) then list[#list + 1] = res end
    end
    table.sort(list)
    opted = list
    return list
end

local function anyStarted()
    for _, res in ipairs(optedIn()) do if GetResourceState(res) == 'started' then return true end end
    return false, 'capability_missing'
end

local function call(res, name, ...)
    if GetResourceState(res) ~= 'started' then return nil, 'err_settings_stopped' end
    local args = table.pack(...)
    local ok, result = pcall(function() return exports[res][name](nil, table.unpack(args, 1, args.n)) end)
    if not ok then
        WC.log('settings: %s:%s failed: %s', res, name, tostring(result))
        return nil, 'err_settings_failed'
    end
    return result
end

--- The schema with the level of the resource and of each group, and its index; cached until a restart.
local function schemaOf(res)
    if schemas[res] then return schemas[res] end
    local schema, err = call(res, 'WSettingsSchema')
    if type(schema) ~= 'table' or type(schema.groups) ~= 'table' then return nil, err or 'err_settings_failed' end
    -- a schema the validator cannot read is refused once, here, never on every later call
    for _, group in ipairs(schema.groups) do
        if type(group) ~= 'table' or type(group.id) ~= 'string' or not group.id:match(ID_PATTERN) then
            WC.log('settings: %s answered a schema with a group that has no valid id (failed)', res)
            return nil, 'err_settings_failed'
        end
    end
    local indexed, index = pcall(indexOf, schema.groups)
    if not indexed then
        WC.log('settings: %s answered a schema the validator cannot read (failed): %s', res, tostring(index))
        return nil, 'err_settings_failed'
    end
    schema.level = levelFor(res)
    for _, group in ipairs(schema.groups) do group.level = higher(schema.level, levelFor(res, group.id, group.level)) end
    schemas[res] = { schema = schema, index = index }
    return schemas[res]
end

-- ── helpers over the values ──────────────────────────────────────────────────────────────────────────────

--- every key's value in effect, or only the changed ones: { [key] = value } (form fields and table cells)
local function valuesOf(res, entry, onlyChanged)
    local out = {}
    local form = call(res, 'WSettingsValues')
    if type(form) == 'table' then
        if onlyChanged then
            for key in pairs(form.overridden or {}) do out[key] = (form.values or {})[key] end
        else
            for key, value in pairs(form.values or {}) do out[key] = value end
        end
    end
    for _, group in ipairs(entry.schema.groups) do
        if group.type == 'table' then
            local v = call(res, 'WSettingsValues', group.id)
            for _, row in ipairs(type(v) == 'table' and type(v.rows) == 'table' and v.rows or {}) do
                if onlyChanged then
                    for _, col in ipairs(row.overridden or {}) do out[('%s.%s.%s'):format(group.id, row.id, col)] = (row.cells or {})[col] end
                else
                    for col, value in pairs(row.cells or {}) do out[('%s.%s.%s'):format(group.id, row.id, col)] = value end
                end
            end
        end
    end
    return out
end

--- How many values of each group an admin changed (form overrides + the stored rows of table groups)
local function changedCounts(res, entry)
    local counts = {}
    local form = call(res, 'WSettingsValues')
    if type(form) == 'table' then
        for key in pairs(form.overridden or {}) do
            local g = entry.index.groupOf[key]
            if g then counts[g.id] = (counts[g.id] or 0) + 1 end
        end
    end
    local ok, rows = pcall(MySQL.query.await, 'SELECT skey FROM w_admin_settings WHERE resource = ?', { res })
    for _, r in ipairs(ok and type(rows) == 'table' and rows or {}) do
        local prefix = tostring(r.skey):match('^([^%.]+)')
        if prefix and entry.index.tables[prefix] then counts[prefix] = (counts[prefix] or 0) + 1 end
    end
    return counts
end

-- ── apply ────────────────────────────────────────────────────────────────────────────────────────────────

local function actorOf(ctx, note)
    local src, cid = ctx.source, nil
    local f = fw()
    if f then
        local ok, p = pcall(f.player, src)
        if ok and type(p) == 'table' and p.charId then cid = tostring(p.charId) end
    end
    return { src = src, cid = cid, name = GetPlayerName(src) or ('#' .. tostring(src)), via = 'w_connector',
        note = type(note) == 'string' and note:sub(1, 200) or nil }
end

--- The console's own gate (shape + levels); nil when the batch may go to the resource
local function precheck(ctx, entry, changes)
    local list, rejected = checkChanges(entry.index, changes)
    if #rejected > 0 then return { ok = false, applied = {}, rejected = rejected } end
    local refused = {}
    for _, c in ipairs(list) do
        local level = c.group.level or entry.schema.level
        if not hasLevel(ctx, level) then refused[#refused + 1] = { key = c.key, reason = 'no_access', level = level } end
    end
    if #refused > 0 then return { ok = false, applied = {}, rejected = refused } end
    if #list == 0 then return { ok = false, applied = {}, rejected = { { key = '', reason = 'bad_type' } } } end
    return nil
end

--- The resource's apply: its connector door first (w_hud 2.1.4), else the plain export.
local function resourceApply(res, changes, actor)
    if GetResourceState(res) ~= 'started' then return nil, 'err_settings_stopped' end
    local ok, result = pcall(function() return exports[res].WSettingsApplyConnector(nil, changes, actor) end)
    if ok and type(result) == 'table' then return result end
    return call(res, 'WSettingsApply', changes, actor)
end

local function applyTo(ctx, res, entry, changes, note)
    local refusal = precheck(ctx, entry, changes)
    if refusal then return refusal end
    if not ctx.valid() then return nil, 'no_session' end
    local result, err = resourceApply(res, changes, actorOf(ctx, note))
    if type(result) ~= 'table' then
        return { ok = false, applied = {}, rejected = { { key = '', reason = err == 'err_settings_stopped' and 'stopped' or 'no_answer' } } }
    end
    if not result.ok then
        local first = type(result.rejected) == 'table' and result.rejected[1] or nil
        if first and first.reason == 'no_access' and not first.ace then
            -- the resource refused the caller itself (no admin test named): an older resource whose w_lib
            -- accepts only w_admin; say why in the server log
            WC.log('settings: %s blocked the change (no_access): it needs WSettingsApplyConnector or a w_lib that accepts w_connector', res)
        end
    end
    return result
end

--- One apply / reset / import at a time per resource: a double press waits for nothing and changes nothing.
local function locked(res, fn)
    if busy[res] then return false, 'err_settings_busy' end
    busy[res] = true
    local called, ok, a, b = pcall(fn)
    busy[res] = nil
    if not called then
        WC.log('settings: %s failed: %s', res, tostring(ok))
        return false, 'failed'
    end
    return ok, a, b
end

-- ── the actions ──────────────────────────────────────────────────────────────────────────────────────────

local function decodeJson(s)
    if type(s) == 'table' then return s end
    if type(s) ~= 'string' or #s > 1048576 then return nil end
    local ok, v = pcall(json.decode, s)
    return ok and type(v) == 'table' and v or nil
end

local function decodeValue(s)
    if type(s) ~= 'string' then return nil end
    local ok, v = pcall(json.decode, s)
    if ok then return v end
    return nil
end

--- An opted-in resource the admin may open: entry | nil, reason
local function resourceFor(ctx, res)
    if not isOptedIn(res) then return nil, 'err_settings_missing' end
    if not hasLevel(ctx, levelFor(res)) then return nil, 'no_access' end
    local entry, err = schemaOf(res)
    if not entry then return nil, err end
    if not ctx.valid() then return nil, 'no_session' end
    return entry
end

local actions = {}

function actions.list(_, ctx)
    local out = {}
    for _, res in ipairs(optedIn()) do
        local state = GetResourceState(res)
        local item = { resource = res, state = state, level = levelFor(res), title = { ar = res, en = res },
            description = { ar = '', en = '' }, groups = {} }
        local entry = state == 'started' and schemaOf(res) or nil
        if entry then
            item.title, item.description = entry.schema.title or item.title, entry.schema.description or item.description
            -- one script's odd answer costs only its own counts, never the whole list
            local okCounts, counts = pcall(changedCounts, res, entry)
            if not okCounts then
                WC.log('settings: counting the changed values of %s failed: %s', res, tostring(counts))
                counts = {}
            end
            for _, g in ipairs(entry.schema.groups) do
                item.groups[#item.groups + 1] = { id = g.id, label = g.label, level = g.level, overridden = counts[g.id] or 0 }
            end
        end
        out[#out + 1] = item
    end
    if not ctx.valid() then return false, 'no_session' end
    return true, out
end

function actions.schema(data, ctx)
    local entry, err = resourceFor(ctx, data.resource)
    if not entry then return false, err end
    return true, entry.schema
end

function actions.values(data, ctx)
    local group = data.group
    if group ~= nil and (type(group) ~= 'string' or not group:match(ID_PATTERN)) then return false, 'err_invalid_value' end
    local entry, err = resourceFor(ctx, data.resource)
    if not entry then return false, err end
    local v, verr = call(data.resource, 'WSettingsValues', group)
    if not ctx.valid() then return false, 'no_session' end
    if type(v) ~= 'table' then return false, verr or 'err_settings_not_ready' end
    return true, v
end

function actions.apply(data, ctx)
    local res = data.resource
    local entry, err = resourceFor(ctx, res)
    if not entry then return false, err end
    return locked(res, function()
        local result, why = applyTo(ctx, res, entry, data.changes, data.note)
        if not result then return false, why end
        if result.ok then return true, result end
        return false, 'err_settings_rejected', result
    end)
end

function actions.reset(data, ctx)
    local res = data.resource
    local keys = data.keys
    if type(keys) ~= 'table' or #keys == 0 or #keys > MAX_CHANGES then return false, 'err_invalid_value' end
    for _, key in ipairs(keys) do if type(key) ~= 'string' then return false, 'err_invalid_value' end end
    local entry, err = resourceFor(ctx, res)
    if not entry then return false, err end
    return locked(res, function()
        local now = valuesOf(res, entry, false)
        local changes = {}
        for i, key in ipairs(keys) do changes[i] = { key = key, from = now[key], reset = true } end
        local result, why = applyTo(ctx, res, entry, changes, data.note)
        if not result then return false, why end
        if result.ok then return true, result end
        return false, 'err_settings_rejected', result
    end)
end

function actions.history(data, ctx)
    local res = data.resource
    if not isOptedIn(res) then return false, 'err_settings_missing' end
    if not hasLevel(ctx, levelFor(res)) then return false, 'no_access' end
    local limit = math.floor(tonumber(data.limit) or 50)
    if limit < 1 then limit = 1 elseif limit > 200 then limit = 200 end
    local sql = 'SELECT batch, skey, old_value, new_value, actor_cid, actor_name, via, created_at FROM w_admin_settings_audit WHERE resource = ?'
    local params = { res }
    if type(data.key) == 'string' and data.key:match(KEY_PATTERN) and #data.key <= MAX_KEY then
        sql = sql .. ' AND skey = ?'
        params[#params + 1] = data.key
    elseif type(data.prefix) == 'string' and data.prefix:match(ID_PATTERN) then
        sql = sql .. ' AND skey LIKE ?'
        params[#params + 1] = data.prefix .. '.%'
    end
    sql = sql .. (' ORDER BY id DESC LIMIT %d'):format(limit)
    local ok, rows = pcall(MySQL.query.await, sql, params)
    if not ctx.valid() then return false, 'no_session' end
    if not ok then return false, 'err_db' end
    local out = {}
    for _, r in ipairs(type(rows) == 'table' and rows or {}) do
        out[#out + 1] = { batch = r.batch, resource = res, key = r.skey, old = decodeValue(r.old_value), new = decodeValue(r.new_value),
            by = r.actor_name or '', cid = r.actor_cid, at = tonumber(r.created_at) or 0, via = r.via or 'w_admin' }
    end
    return true, out
end

--- { format = 'w_settings/1', at, resources = { [res] = { [key] = value } } }: the changed values only.
--- Without `resource`, every opted-in script the admin may read (w_admin refused that case).
local function exportOf(ctx, resource)
    local list = resource ~= nil and { resource } or optedIn()
    local out = { format = 'w_settings/1', at = os.time(), resources = {} }
    for _, res in ipairs(list) do
        if isOptedIn(res) and hasLevel(ctx, levelFor(res)) and GetResourceState(res) == 'started' then
            local entry = schemaOf(res)
            if entry then out.resources[res] = valuesOf(res, entry, true) end
        end
    end
    return out
end

function actions.export(data, ctx)
    if data.resource ~= nil then
        if not isOptedIn(data.resource) then return false, 'err_settings_missing' end
        if not hasLevel(ctx, levelFor(data.resource)) then return false, 'no_access' end
    end
    local out = exportOf(ctx, data.resource)
    if not ctx.valid() then return false, 'no_session' end
    return true, out
end

function actions.import(data, ctx)
    if not hasLevel(ctx, TOP) then return false, 'no_access' end
    local doc = decodeJson(data.data)
    if not doc or doc.format ~= 'w_settings/1' or type(doc.resources) ~= 'table' then return false, 'err_settings_import_format' end
    local planned = {}
    for res, values in pairs(doc.resources) do
        if isOptedIn(res) and type(values) == 'table' and GetResourceState(res) == 'started' then
            local entry = schemaOf(res)
            if entry then
                local now = valuesOf(res, entry, false)
                local changes = {}
                for key, value in pairs(values) do
                    if type(key) == 'string' and not equal(now[key], value) then changes[#changes + 1] = { key = key, from = now[key], to = value } end
                end
                table.sort(changes, function(a, b) return a.key < b.key end)
                planned[#planned + 1] = { resource = res, entry = entry, changes = changes }
            end
        end
    end
    table.sort(planned, function(a, b) return a.resource < b.resource end)
    if not ctx.valid() then return false, 'no_session' end
    if data.dryRun ~= false then
        local diff = {}
        for _, p in ipairs(planned) do
            local refusal = #p.changes > 0 and precheck(ctx, p.entry, p.changes) or nil
            local bad = {}
            for _, r in ipairs(refusal and refusal.rejected or {}) do bad[r.key] = r.reason end
            for _, c in ipairs(p.changes) do diff[#diff + 1] = { resource = p.resource, key = c.key, from = c.from, to = c.to, refused = bad[c.key] } end
        end
        return true, { changes = diff }
    end
    local results = {}
    for _, p in ipairs(planned) do
        if #p.changes > 0 then
            local done, r, why = locked(p.resource, function()
                local result, err = applyTo(ctx, p.resource, p.entry, p.changes, 'import')
                if not result then return false, err end
                return true, result
            end)
            if done then results[#results + 1] = { resource = p.resource, ok = r.ok == true, applied = #(r.applied or {}), rejected = r.rejected }
            elseif r == 'no_session' then return false, 'no_session'
            else results[#results + 1] = { resource = p.resource, ok = false, applied = 0, rejected = { { key = '', reason = r == 'err_settings_busy' and 'busy' or tostring(why or r) } } } end
        end
    end
    return true, { results = results }
end

local presetsTable = false
local function ensurePresets()
    if presetsTable then return true end
    local ok = pcall(MySQL.query.await, [[CREATE TABLE IF NOT EXISTS `w_admin_settings_presets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(80) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `created_by` VARCHAR(64) NULL,
    `created_at` INT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci]])
    presetsTable = ok
    return ok
end

function actions.presets(data, ctx)
    if not hasLevel(ctx, TOP) then return false, 'no_access' end
    if not ensurePresets() then return false, 'err_db' end
    local op = data.op
    if op == 'list' then
        local ok, rows = pcall(MySQL.query.await, 'SELECT id, name, created_by, created_at FROM w_admin_settings_presets ORDER BY id DESC LIMIT 100')
        if not ok then return false, 'err_db' end
        return true, type(rows) == 'table' and rows or {}
    elseif op == 'get' then
        local id = math.tointeger(tonumber(data.id))
        if not id or id < 1 then return false, 'err_invalid_value' end
        local ok, row = pcall(MySQL.single.await, 'SELECT id, name, data, created_by, created_at FROM w_admin_settings_presets WHERE id = ?', { id })
        if not ok or type(row) ~= 'table' then return false, 'err_settings_preset_missing' end
        row.data = decodeJson(row.data)
        return true, row
    elseif op == 'save' then
        local name = type(data.name) == 'string' and data.name:gsub('^%s+', ''):gsub('%s+$', '') or ''
        local length = utf8.len(name)
        if name == '' or not length or length > 80 then return false, 'err_invalid_value' end
        local doc = data.data ~= nil and decodeJson(data.data) or exportOf(ctx, nil)
        if not doc then return false, 'err_invalid_value' end
        local okEncode, text = pcall(json.encode, doc)
        if not okEncode or type(text) ~= 'string' or #text > 1048576 then return false, 'err_invalid_value' end
        local by = actorOf(ctx).cid or GetPlayerName(ctx.source) or ('#' .. tostring(ctx.source))
        if not ctx.valid() then return false, 'no_session' end
        local ok, id = pcall(MySQL.insert.await, 'INSERT INTO w_admin_settings_presets (name, data, created_by, created_at) VALUES (?, ?, ?, ?)',
            { name, text, tostring(by):sub(1, 64), os.time() })
        if not ok or not id then return false, 'err_db' end
        return true, { id = id }
    elseif op == 'delete' then
        local id = math.tointeger(tonumber(data.id))
        if not id or id < 1 then return false, 'err_invalid_value' end
        local ok, changed = pcall(MySQL.update.await, 'DELETE FROM w_admin_settings_presets WHERE id = ?', { id })
        if not ok then return false, 'err_db' end
        if tonumber(changed) == 0 then return false, 'err_settings_preset_missing' end
        return true, { id = id }
    end
    return false, 'err_unknown_action'
end

-- a link's command: a command name and plain words only, never a separator (w_admin sv_scripts.lua's rule)
local LINK_PATTERN = '^[%w_%-]+[%w_%- ]*$'

function actions.openPanel(data, ctx)
    local res = data.resource
    local entry, err = resourceFor(ctx, res)
    if not entry then return false, err end
    for _, l in ipairs(type(entry.schema.links) == 'table' and entry.schema.links or {}) do
        if type(l) == 'table' and l.id == data.link and type(l.command) == 'string' and #l.command <= 120 and l.command:match(LINK_PATTERN) then
            if l.level and not hasLevel(ctx, levelFor(res, nil, l.level)) then return false, 'no_access' end
            -- the admin's client closes the console, then runs the script's own command (cl_console.lua forward)
            return true, { route = { kind = 'command', line = l.command, res = res } }
        end
    end
    return false, 'err_script_no_panel'
end

for name, run in pairs(actions) do
    C.define('settings.' .. name, anyStarted, function(data, ctx) return run(type(data) == 'table' and data or {}, ctx) end)
end

--- For the scripts hub (scripts.list): a script's settings badge { level, groups, locked? }, or nil.
WC.Settings = { optedIn = optedIn }
function WC.Settings.summary(res, session)
    if not isOptedIn(res) then return nil end
    local out = { level = levelFor(res), groups = 0 }
    if GetResourceState(res) == 'started' then
        local entry = schemaOf(res)
        if entry then out.groups = #entry.schema.groups end
    end
    local ctx = { session = session }
    if type(session) ~= 'table' or type(session.allowed) ~= 'table' or not session.allowed['settings.apply'] then
        out.locked = { level = 'admin' }
    elseif not hasLevel(ctx, out.level) then
        out.locked = { level = out.level }
    end
    return out
end

-- ── needs: hunger and thirst through their owner, stamina on the target's client ─────────────────────────

local NEEDS = { hunger = true, thirst = true, stamina = true }

--- Who owns hunger and thirst here: w_hud, else the framework adapter (WCore.setNeeds), else nobody.
local function needsOwner()
    if WC.started('w_hud') then return 'w_hud' end
    local f = fw()
    if f and type(f.setNeeds) == 'function' then return 'framework' end
    return nil
end
local function needsAvailable()
    if needsOwner() then return true end
    return false, 'capability_missing'
end

--- needs = { hunger?, thirst?, stamina? }, each 0-100. -> true, { message, needs? } | false, reason
local function setNeeds(target, needs)
    if not WC.onlineSource(target) then return false, 'player_offline' end
    if type(needs) ~= 'table' then return false, 'invalid_args' end
    local clean, any = {}, false
    for key, value in pairs(needs) do
        if not NEEDS[key] then return false, 'invalid_args' end
        local n = tonumber(value)
        if not finite(n) or n < 0 or n > 100 then return false, 'err_invalid_value' end
        clean[key], any = n, true
    end
    if not any then return false, 'err_invalid_value' end
    local owner, after = needsOwner(), nil
    if clean.hunger or clean.thirst then
        if owner == 'w_hud' then
            -- GetNeedsPair loads the state when the character has none in memory yet; nil = no character
            local okPair, pair = pcall(function() return exports.w_hud:GetNeedsPair(target) end)
            if not okPair or type(pair) ~= 'table' then return false, 'err_needs_no_character' end
            for _, key in ipairs({ 'hunger', 'thirst' }) do
                if clean[key] then
                    local okSet = pcall(function() return exports.w_hud:SetNeed(target, key, clean[key]) end)
                    if not okSet then return false, 'failed' end
                end
            end
            local okAfter, pairAfter = pcall(function() return exports.w_hud:GetNeedsPair(target) end)
            after = okAfter and type(pairAfter) == 'table' and pairAfter or nil
        elseif owner == 'framework' then
            local okSet, done, why = pcall(fw().setNeeds, target, { hunger = clean.hunger, thirst = clean.thirst })
            if not okSet then return false, 'failed' end
            if done ~= true then return false, why == 'no_character' and 'err_needs_no_character' or tostring(why or 'failed') end
        else
            return false, 'capability_missing'
        end
    end
    -- stamina exists only on the client (cl_actions.lua EFFECTS.setStamina: cores, ped, player, mount)
    if clean.stamina then TriggerClientEvent('w_connector:effect', target, 'setStamina', clean.stamina) end
    return true, { message = 'toast_needs_set', needs = after }
end

--- The website panel's op (gamePanel.ts /players/:source/needs, the legacy panel, and the console's player.needs).
WC.Ops.define('player.setNeeds', function() return needsOwner() ~= nil end, function(args)
    return setNeeds(WC.onlineSource(args.source), args.needs)
end)

C.define('hud.setNeed', needsAvailable, function(data, ctx)
    if not ctx.valid() then return false, 'target_changed' end
    if not NEEDS[data.need] then return false, 'err_invalid_value' end
    return setNeeds(ctx.target, { [data.need] = data.value })
end)

-- ── the HUD's server settings (w_hud's own blob: needs decay, damage, features, identity) ─────────────────

local hudBusy = false
C.define('hud.save', function() if WC.started('w_hud') then return true end return false, 'capability_missing' end, function(data, ctx)
    if type(data.cfg) ~= 'table' then return false, 'err_invalid_value' end
    if hudBusy then return false, 'err_settings_busy' end
    if not ctx.valid() then return false, 'no_session' end
    hudBusy = true
    -- w_hud checks the admin again (IsHudAdmin: ACE w_hud.admin), clamps every value, stores, pushes to everyone
    local called, saved, cfg = pcall(function() return exports.w_hud:SaveServerHudCfg(data.cfg, ctx.source) end)
    hudBusy = false
    if not called then return false, 'failed' end
    if not saved then
        if cfg == 'not_admin' then return false, 'no_access' end
        if cfg == 'invalid_cfg' then return false, 'err_invalid_value' end
        return false, cfg == 'db_error' and 'err_db' or 'err_failed'
    end
    return true, { cfg = cfg }
end)
