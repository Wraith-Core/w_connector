-- 2.2.0: the scripts hub, native (was w_admin 3.1.14 server/sv_scripts.lua; the registry is
-- core/scripts_registry.lua). Every script of the server on one page, as an EXTRA control layer: a
-- script's own interface and commands stay exactly as they are; the hub opens that interface for the
-- admin and offers some of its commands as forms.
--
--   scripts.list                        -> ModuleDescriptor[] (web/src/types.ts)
--   scripts.open { resource, link? }    -> { route } the admin's client runs after closing the console
--   scripts.run  { resource, command, args } -> the line built HERE from the registry template:
--       route 'command' -> { exec | route } the ADMIN's client runs (ExecuteCommand there reaches the
--                          script as him: the script checks his own ACE exactly as if he typed it)
--       route 'console' -> the server console runs it, only for an admin who holds that command's own
--                          ACE himself and the website's console.command (w_admin: god only)
-- The page never sends a command line: it names a script and a command id; each argument is checked
-- by its type and cleaned of separators before it enters the line. The script's own permission (the
-- probe) is asked again for this admin right before acting; a probe that passes grants nothing the
-- script would refuse. No w_lib: the probes are plain ACE (w_lib HasPermissionNode / IsAdmin did the same).
local C = WC.Console
local OWNER = 'console.command' -- the website's owner-only permission: w_admin's 'god' level and console route
local PROBE_TTL = 30            -- s a probe answer is kept for the cards (never for acting)
local RUN_GAP = 1000            -- ms between two presses of the same command by one admin

local function T(ar, en) return { ar = ar, en = en } end
local function started(res) return GetResourceState(res) == 'started' end
local function metadata(res, key)
    local ok, value = pcall(GetResourceMetadata, res, key, 0)
    return ok and type(value) == 'string' and value ~= '' and value or nil
end
local function resourceName(v) return type(v) == 'string' and #v <= 64 and v:match('^[%w_%-%.]+$') ~= nil end

local byRes, groupOrder, indexed = {}, {}, nil
local function registry()
    local r = WC.ScriptsRegistry
    if type(r) ~= 'table' or type(r.scripts) ~= 'table' then return { scripts = {}, groups = {}, pinned = {} } end
    if indexed ~= r then
        byRes, groupOrder, indexed = {}, {}, r
        for _, entry in ipairs(r.scripts) do byRes[entry.res] = entry end
        for i, g in ipairs(r.groups or {}) do groupOrder[g] = i end
    end
    return r
end
local function entryOf(res)
    registry()
    return type(res) == 'string' and byRes[res] or nil
end

local function siteHas(session, permission)
    for _, p in ipairs(session and session.permissions or {}) do if p == permission then return true end end
    return false
end

-- why a card or a command is locked, in words the admin can act on ({ ar, en }; %s = the permission)
local LOCK_TEXT = {
    need_node = T('السكربت نفسه يطلب صلاحية «%s». اطلبها من مالك السيرفر.', 'The script itself asks for the "%s" permission. Ask the server owner for it.'),
    need_admin = T('لوحة هذا السكربت للإداري والمالك فقط (مستوى admin أو أعلى)، ولا يستطيع المشرف فتحها.', 'The panel of this script is for full admins only (admin or higher); a moderator cannot open it.'),
    need_ace = T('تحتاج صلاحية الأمر «%s» في إعدادات السيرفر.', 'You need the "%s" command permission in the server config.'),
    need_site = T('رتبتك في الموقع لا تسمح بتشغيل أوامر السكربتات. اطلب الصلاحية من مالك اللوحة.', 'Your website role cannot run script commands. Ask the panel owner for it.'),
    need_owner = T('هذا الأمر لمالك اللوحة فقط (صلاحية أوامر الكونسول في الموقع).', 'This command is for the panel owner only (the website console-commands permission).'),
    need_connector = T('السيرفر لا يسمح لربط الموقع بتشغيل هذا الأمر في الكونسول. شغّله من كونسول السيرفر.', 'The server does not let the website link run this command in the console. Run it in the server console.'),
    need_settings = T('رتبتك في الموقع لا تسمح بفتح إعدادات السكربتات.', 'Your website role cannot open script settings.'),
}
local function lockText(reason, value)
    local t = LOCK_TEXT[reason]
    return { ar = t.ar:format(value or ''), en = t.en:format(value or '') }
end

-- ── the script's own permission test ──────────────────────────────────────────

local function ace(src, object) return IsPlayerAceAllowed(src, object) and true or false end
local function frameworkAdmin(src) return ace(src, 'admin') or ace(src, 'command') end
local function hasNode(src, node)
    if type(node) ~= 'string' then return false end
    if frameworkAdmin(src) or ace(src, node) then return true end
    local parts = {}
    for part in node:gmatch('[^.]+') do parts[#parts + 1] = part end
    for i = #parts - 1, 1, -1 do
        if ace(src, table.concat(parts, '.', 1, i) .. '.*') then return true end
    end
    return ace(src, '*')
end

--- ok, lock (ModuleLock) for one probe spec
local function runProbe(src, p)
    if type(p) ~= 'table' then return true end
    if p.node then
        if hasNode(src, p.node) then return true end
        return false, { ace = p.node, text = lockText('need_node', p.node) }
    end
    if p.anyNode then
        for _, node in ipairs(p.anyNode) do if hasNode(src, node) then return true end end
        return false, { ace = p.anyNode[1], text = lockText('need_node', p.anyNode[1]) }
    end
    if p.admin then
        if frameworkAdmin(src) then return true end
        return false, { text = lockText('need_admin') }
    end
    if p.ace then
        if ace(src, p.ace) then return true end
        return false, { ace = p.ace, text = lockText('need_ace', p.ace) }
    end
    if p.anyOf then
        local first
        for _, one in ipairs(p.anyOf) do
            local ok, lock = runProbe(src, one)
            if ok then return true end
            first = first or lock
        end
        return false, first
    end
    return true
end

local probeCache = {}
--- The probe, cached per admin and key for the cards; `fresh` (right before acting) skips the cache.
local function probe(src, key, p, fresh)
    if type(p) ~= 'table' then return true end
    local now, cache = os.time(), probeCache[src]
    if not cache then cache = {} probeCache[src] = cache end
    local hit = cache[key]
    if hit and not fresh and now - hit.at < PROBE_TTL then return hit.ok, hit.lock end
    local ok, lock = runProbe(src, p)
    cache[key] = { at = now, ok = ok, lock = lock }
    return ok, lock
end

-- A console-route command: its word, which must be a plain command the catalog would ever grant.
local function consoleCommand(cmd)
    local name = type(cmd.line) == 'string' and cmd.line:match('^([%w_]+)') or nil
    if not name then return nil end
    if WC.ScriptCatalog and WC.ScriptCatalog.safeNode and not WC.ScriptCatalog.safeNode('command.' .. name:lower()) then return nil end
    return name
end
local function connectorMayRun(name)
    return IsPrincipalAceAllowed('resource.' .. GetCurrentResourceName(), 'command.' .. name) and true or false
end

--- nil, or the lock a command shows (and the refusal key when acting).
local function commandLock(src, session, entry, cmd, fresh)
    if not session.allowed['scripts.run'] then return { text = lockText('need_site') }, 'no_permission' end
    if (cmd.level == 'god' or cmd.route == 'console') and not siteHas(session, OWNER) then
        return { level = 'god', text = lockText('need_owner') }, 'err_script_owner_only'
    end
    if cmd.route == 'console' then
        local name = consoleCommand(cmd)
        if not name then return { text = lockText('need_connector') }, 'err_script_console_denied' end
        -- the admin's OWN right to that exact command: the console never runs more than he may type
        if not ace(src, 'command.' .. name) then
            return { ace = 'command.' .. name, text = lockText('need_ace', 'command.' .. name) }, 'err_script_locked'
        end
        if not connectorMayRun(name) then return { text = lockText('need_connector') }, 'err_script_console_denied' end
    end
    local ok, lock = probe(src, entry.res .. ':' .. cmd.id, cmd.probe or entry.probe, fresh)
    if not ok then return lock, 'err_script_locked' end
    return nil
end

-- ── the cards ─────────────────────────────────────────────────────────────────

local ARG_FIELDS = { 'key', 'type', 'label', 'help', 'required', 'min', 'max', 'step', 'maxLength', 'options', 'default' }

local function commandFor(src, session, entry, cmd)
    local out = {
        id = cmd.id, label = cmd.label, help = cmd.help, level = cmd.level or 'admin',
        danger = cmd.danger == true or nil, needsOnline = cmd.needsOnline == true or nil, args = {},
    }
    for i, a in ipairs(cmd.args or {}) do
        local arg = {}
        for _, f in ipairs(ARG_FIELDS) do arg[f] = a[f] end
        out.args[i] = arg
    end
    out.locked = commandLock(src, session, entry, cmd, false)
    return out
end

-- The settings summary of a script that opted in (manifest: w_settings 'yes'): its level and group count.
local LEVELS = { mod = true, admin = true, god = true }
local schemaCache = {}
local function settingsFor(session, res)
    if metadata(res, 'w_settings') ~= 'yes' then return nil end
    local out = { level = 'admin', groups = 0 }
    if started(res) then
        local hit = schemaCache[res]
        if not hit or os.time() - hit.at >= PROBE_TTL then
            local ok, schema = pcall(function() return exports[res]:WSettingsSchema() end)
            hit = { at = os.time(), groups = 0, level = 'admin' }
            if ok and type(schema) == 'table' then
                hit.groups = type(schema.groups) == 'table' and #schema.groups or 0
                hit.level = LEVELS[schema.level] and schema.level or 'admin'
            end
            schemaCache[res] = hit
        end
        out.groups, out.level = hit.groups, hit.level
    end
    if not session.allowed['settings.schema'] then out.locked = { text = lockText('need_settings') }
    elseif out.level == 'god' and not siteHas(session, OWNER) then out.locked = { level = 'god', text = lockText('need_owner') } end
    return out
end

local function describe(src, session, entry)
    local res = entry.res
    local d = {
        resource = res, label = entry.label, description = entry.description, help = entry.help,
        group = entry.group or 'system', state = GetResourceState(res), version = metadata(res, 'version') or '',
        pinned = registry().pinned and registry().pinned[res] or nil,
    }
    if entry.panel then
        d.panel = { how = entry.panel.how, note = entry.panel.note }
        local ok, lock = probe(src, res .. ':panel', entry.panel.probe or entry.probe)
        if not ok then d.panel.locked = lock end
    end
    if entry.commands and #entry.commands > 0 then
        d.commands = {}
        for i, cmd in ipairs(entry.commands) do d.commands[i] = commandFor(src, session, entry, cmd) end
    end
    d.settings = settingsFor(session, res)
    return d
end

-- a script the registry does not know: a status card from resources.list (and its settings when it opted in)
local AUTO_PREFIXES = { '^w_', '^wraith_', '^bp_' }
local function autoEntry(row)
    local description = type(row.description) == 'string' and row.description ~= '' and row.description:sub(1, 160) or nil
    return {
        res = row.name, group = 'system', label = T(row.name, row.name),
        description = T('سكربت من سكربتات السيرفر.', description or 'A server script.'),
        help = T('سكربت من سكربتات السيرفر، ليس له أدوات إدارة هنا بعد. يمكنك رؤية حالته، وتشغيله من هنا إذا كان متوقفًا ومستواك يسمح.',
            'A server script with no admin tools here yet. You can see its state, and start it from here when it is stopped and your level allows.'),
    }
end
local function autoShown(res)
    if metadata(res, 'w_settings') == 'yes' then return true end
    for _, pattern in ipairs(AUTO_PREFIXES) do if res:find(pattern) then return true end end
    return false
end

C.define('scripts.list', nil, function(_, ctx)
    local list, seen, wraith = {}, {}, false
    local self = GetCurrentResourceName()
    for _, entry in ipairs(registry().scripts) do
        seen[entry.res] = true
        -- a script that is not installed is left out (no card for what the server does not have)
        if GetResourceState(entry.res) ~= 'missing' then
            list[#list + 1] = describe(ctx.source, ctx.session, entry)
            if entry.res ~= self then wraith = true end
        end
    end
    -- every other resource, from the generic resource list: on a Wraith server only its own kind of
    -- script (w_ / wraith_ / bp_ / w_settings, as w_admin showed), on any other server all of them
    local ok, rows = WC.Ops.run('resources.list', {})
    if ok and type(rows) == 'table' then
        for _, row in ipairs(rows) do
            if type(row) == 'table' and resourceName(row.name) and not seen[row.name] and row.name ~= self
                and (not wraith or autoShown(row.name)) then
                seen[row.name] = true
                list[#list + 1] = describe(ctx.source, ctx.session, autoEntry(row))
            end
        end
    end
    table.sort(list, function(a, b)
        local ga, gb = groupOrder[a.group] or 99, groupOrder[b.group] or 99
        if ga ~= gb then return ga < gb end
        return a.resource < b.resource
    end)
    return true, list
end)

-- ── arguments ─────────────────────────────────────────────────────────────────

--- At most `n` bytes, never cut inside a multi-byte letter.
local function clip(s, n)
    s = tostring(s or ''):sub(1, n)
    while #s > 0 and not utf8.len(s) do s = s:sub(1, -2) end
    return s
end

--- A number as the command line writes it: an integer without '.0', a decimal as it is.
local function numText(n)
    if n == math.floor(n) then return ('%d'):format(n) end
    return (('%.4f'):format(n):gsub('0+$', ''):gsub('%.$', ''))
end

--- The value of one argument for the line, or nil + error key. `found` collects the player it names.
local function argValue(ctx, cmd, a, v, found)
    if v == nil or v == '' then
        if a.required then return nil, 'err_script_bad_arg' end
        return ''
    end
    local t = a.type
    if t == 'citizen' then
        if type(v) ~= 'string' and type(v) ~= 'number' then return nil, 'err_invalid_target' end
        -- the console's own citizen lookup: '#5', 'me', a citizen id; online first, then the saved characters
        local lookup = C.handlers['citizen.lookup']
        local called, ok, who = pcall(lookup.run, { input = tostring(v):sub(1, 32) }, ctx)
        if not called or not ok or type(who) ~= 'table' then
            if called and who == 'player_offline' and cmd.needsOnline then return nil, 'err_script_needs_online' end
            return nil, 'err_invalid_target'
        end
        if cmd.needsOnline and not who.online then return nil, 'err_script_needs_online' end
        local cid = tostring(who.citizenid or '')
        -- the canonical id goes into a command line: one plain word only
        if cid == '' or #cid > 32 or not cid:match('^[%w_%-]+$') then return nil, 'err_invalid_target' end
        found.target = found.target or who
        return cid
    elseif t == 'int' or t == 'number' then
        local n = tonumber(v)
        if not n or n ~= n or n == math.huge or n == -math.huge then return nil, 'err_script_bad_arg' end
        if t == 'int' and n ~= math.floor(n) then return nil, 'err_script_bad_arg' end
        if (a.min and n < a.min) or (a.max and n > a.max) then return nil, 'err_script_bad_arg' end
        return numText(n)
    elseif t == 'text' then
        if type(v) ~= 'string' then return nil, 'err_script_bad_arg' end
        -- a command line: no separators, quotes, escapes or control characters
        v = v:gsub('[%c;"\\`]', ' '):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
        if v == '' then
            if a.required then return nil, 'err_script_bad_arg' end
            return ''
        end
        if a.maxLength and utf8.len(v) and utf8.len(v) > a.maxLength then return nil, 'err_script_bad_arg' end
        v = clip(v, 400)
        if a.word and not v:match('^[%w_%-%.]+$') then return nil, 'err_script_bad_arg' end
        return v
    elseif t == 'select' then
        for _, o in ipairs(a.options or {}) do
            if tostring(o.value) == tostring(v) then return tostring(o.value) end
        end
        return nil, 'err_script_bad_arg'
    elseif t == 'bool' then
        if v == true then return a.on or 'true' end
        if v == false then return a.off or 'false' end
        return nil, 'err_script_bad_arg'
    end
    return nil, 'err_script_bad_arg'
end

--- The command line from the template, or nil + error key + the field; the player it names.
local function buildLine(ctx, cmd, args)
    args = type(args) == 'table' and args or {}
    local values, found = {}, {}
    for _, a in ipairs(cmd.args or {}) do
        local value, err = argValue(ctx, cmd, a, args[a.key], found)
        if value == nil then return nil, err, a.key end
        values[a.key] = value
    end
    local line = cmd.line:gsub('{(%w+)}', function(k) return values[k] or '' end)
    line = line:gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    return line, nil, nil, found.target
end

-- ── open and run ──────────────────────────────────────────────────────────────

-- a command a settings schema links to: a command name and plain words only, never a separator
local LINK_PATTERN = '^[%w_%-]+[%w_%- ]*$'

--- The route of one of the script's own links (`link` = a link id of its w_settings schema, or the
--- panel's own command), or nil + error key.
local function linkRoute(session, res, entry, link)
    if type(link) ~= 'string' or #link > 64 then return nil, 'err_invalid_value' end
    local panel = entry and entry.panel
    if panel and panel.route.kind == 'command' and (link == panel.route.line or link == 'panel') then return panel.route end
    if metadata(res, 'w_settings') ~= 'yes' then return nil, 'err_script_no_panel' end
    local ok, schema = pcall(function() return exports[res]:WSettingsSchema() end)
    if not ok or type(schema) ~= 'table' or type(schema.links) ~= 'table' then return nil, 'err_script_no_panel' end
    for _, l in ipairs(schema.links) do
        if type(l) == 'table' and l.id == link and type(l.command) == 'string' and #l.command <= 64 and l.command:match(LINK_PATTERN) then
            if l.level == 'god' and not siteHas(session, OWNER) then return nil, 'err_script_owner_only' end
            return { kind = 'command', line = l.command }
        end
    end
    return nil, 'err_script_no_panel'
end

C.define('scripts.open', nil, function(data, ctx)
    local res = data.resource
    if not resourceName(res) then return false, 'err_script_unknown' end
    local entry = entryOf(res)
    if not entry and metadata(res, 'w_settings') ~= 'yes' then return false, 'err_script_unknown' end
    if not started(res) then return false, 'err_script_stopped' end
    local route, err
    if data.link ~= nil then
        route, err = linkRoute(ctx.session, res, entry, data.link)
        if not route then return false, err end
    else
        if not entry or not entry.panel then return false, 'err_script_no_panel' end
        route = entry.panel.route
    end
    if route.kind == 'command' and not (type(route.line) == 'string' and route.line:match(LINK_PATTERN)) then return false, 'err_script_no_panel' end
    -- the script's own permission, when the hub knows it (the script checks it again itself)
    if entry then
        local ok, lock = probe(ctx.source, res .. ':panel', entry.panel and entry.panel.probe or entry.probe, true)
        if not ok then return false, 'err_script_locked', { ace = lock and lock.ace } end
    end
    if not ctx.valid() then return false, 'no_session' end
    -- cl_console.lua closes the console, waits a moment and runs it on the admin's own client
    return true, { route = { kind = route.kind, line = route.line, fn = route.fn, res = res } }
end)

local running, lastRun = {}, {}
C.define('scripts.run', nil, function(data, ctx)
    local src = ctx.source
    local entry = entryOf(data.resource)
    if not entry then return false, 'err_script_unknown' end
    local cmd
    for _, c in ipairs(entry.commands or {}) do
        if c.id == data.command then cmd = c break end
    end
    if not cmd then return false, 'err_script_unknown' end
    if not started(entry.res) then return false, 'err_script_stopped' end
    local key, now = entry.res .. ':' .. cmd.id, GetGameTimer()
    if running[src] or (lastRun[src] and lastRun[src].key == key and now - lastRun[src].at < RUN_GAP) then return false, 'err_script_busy' end
    local _, refused = commandLock(src, ctx.session, entry, cmd, true)
    if refused then return false, refused end
    running[src] = true
    local called, line, err, field = pcall(buildLine, ctx, cmd, data.args)
    running[src] = nil
    if not called then return false, 'failed' end
    if not line then return false, err, { field = field } end
    if not ctx.valid() then return false, 'no_session' end
    lastRun[src] = { key = key, at = GetGameTimer() }
    if cmd.route == 'console' then
        ExecuteCommand(line)
        return true, { output = line, console = true }
    end
    -- the admin's own client runs it (cl_console.lua): the script sees HIM, never this resource
    if cmd.opensUi then return true, { route = { kind = 'command', line = line }, output = '/' .. line } end
    return true, { exec = line, output = '/' .. line }
end)

AddEventHandler('playerDropped', function() probeCache[source], running[source], lastRun[source] = nil, nil, nil end)
-- a script started or stopped: every admin's probes and the settings summaries are asked again
AddEventHandler('onResourceStart', function() probeCache, schemaCache = {}, {} end)
AddEventHandler('onResourceStop', function() probeCache, schemaCache = {}, {} end)
