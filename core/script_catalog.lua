--- The reviewed native permission vocabulary. A server rank catalogue can supply presentation text,
--- never additional authority. Only installed/running resource entries in the shipped registry leave here.
WC = WC or {}
WC.ScriptCatalog = {}

local FORBIDDEN = {
    add_ace = true, remove_ace = true, add_principal = true, remove_principal = true, exec = true,
    set = true, sets = true, setr = true, seta = true, ensure = true, start = true, stop = true,
    restart = true, refresh = true, quit = true, rcon_password = true, sv_licensekey = true,
    steam_webapikey = true, txadmin = true, addpermission = true, removepermission = true,
    setpermission = true, setgroup = true, setrank = true, wranks = true, wraith = true, profiler = true, resmon = true,
}
local ADMIN_AREAS = {
    players = true, teleport = true, revive = true, needs = true, job = true, money = true, hud = true,
    items = true, kick = true, ban = true, server = true, map = true, bans = true,
    spawn = true, vehicle = true, characters = true, scripts = true, logs = true, perms = true, news = true, reports = true,
}
-- Only these reviewed commands dispatch registration through a framework VM. Shared-library owners
-- are never accepted generically: the exact resource, command and finite dispatcher set must match.
local DISPATCHED = {
    w_weathersync = {
        owners = { w_weathersync = true, w_core = true, ['rsg-core'] = true },
        commands = { weather = true, time = true, morning = true, noon = true, evening = true, night = true,
            freezetime = true, freezeweather = true, blackout = true },
    },
    w_medic = {
        owners = { w_medic = true, w_core = true },
        commands = { medrevive = true, setpain = true, kill = true, aheal = true },
    },
}
local function resourceName(value)
    return type(value) == 'string' and #value <= 48 and value:match('^[a-z][a-z0-9_%-]+$') ~= nil
end
local function versionParts(value)
    if type(value) ~= 'string' then return nil end
    local major, minor, patch = value:match('^(%d+)%.(%d+)%.(%d+)$')
    if not major or #major > 6 or #minor > 6 or #patch > 6 then return nil end
    return { tonumber(major), tonumber(minor), tonumber(patch) }
end
local function compatible(resource, minimum)
    if minimum == nil then return true end
    if type(GetResourceMetadata) ~= 'function' then return false end
    local expected, actual = versionParts(minimum), versionParts(GetResourceMetadata(resource, 'version', 0))
    if not expected or not actual then return false end
    for i = 1, 3 do
        if actual[i] ~= expected[i] then return actual[i] > expected[i] end
    end
    return true
end

function WC.ScriptCatalog.safeNode(node)
    if type(node) ~= 'string' or #node < 3 or #node > 64 or node ~= node:lower()
        or not node:match('^[a-z][a-z0-9_.%-]+$') or node:find('..', 1, true)
        or node:sub(-1) == '.' or node:find('bypass', 1, true) then return false end
    local root = node:match('^([^.]+)')
    if root == 'group' or root == 'wrank' or root == 'wranks' or root == 'identifier' or root == 'builtin'
        or root == 'player' or root == 'resource' or root == 'admin' or root == 'god'
        or root == 'mod' or root == 'master' then return false end
    if node == 'command' or node == 'w_admin' or node == 'w_core' or node == 'w_lib' or node == 'w_guard' then return false end
    if root == 'w_guard' then return node == 'w_guard.viewer' or node == 'w_guard.moderator' or node == 'w_guard.manager' end
    if node == 'w_pausemenu.console' or node:sub(1, #'w_pausemenu.console' + 1) == 'w_pausemenu.console.' then return false end
    if root == 'command' then
        local cmd = node:match('^command%.([a-z][a-z0-9_%-]*)$')
        return cmd ~= nil and not FORBIDDEN[cmd]
    end
    if root == 'w_admin' then return ADMIN_AREAS[node:match('^w_admin%.area%.([a-z]+)$')] == true end
    return true
end

local function localized(value, max)
    if type(value) ~= 'table' then return nil end
    local out = {}
    for _, lang in ipairs({ 'ar', 'en' }) do
        local text = value[lang]
        if type(text) ~= 'string' or text == '' or #text > max or text:find('[%z\1-\31\127]') then return nil end
        out[lang] = text
    end
    return out
end

local function commandOwners()
    if type(GetRegisteredCommands) ~= 'function' then return {} end
    local ok, commands = pcall(GetRegisteredCommands)
    if not ok or type(commands) ~= 'table' then return {} end
    local out = {}
    for _, entry in ipairs(commands) do
        if type(entry) == 'table' and type(entry.name) == 'string' then
            local name = entry.name:lower()
            local owner = resourceName(entry.resource) and entry.resource or false
            local old = out[name]
            if old == nil then out[name] = owner elseif old ~= owner then out[name] = false end
        end
    end
    return out
end

local function coreLabels()
    if not WC.started('w_core') then return {} end
    local ok, catalog = pcall(function() return exports.w_core:RanksState().catalog end)
    if not ok or type(catalog) ~= 'table' then return {} end
    local out = {}
    for _, group in ipairs(catalog) do
        if type(group) == 'table' and not group.web and type(group.nodes) == 'table' then
            for _, entry in ipairs(group.nodes) do
                if type(entry) == 'table' and not entry.web and WC.ScriptCatalog.safeNode(entry.node) then out[entry.node] = entry end
            end
        end
    end
    return out
end

local function ownsCommand(resource, entry, owners)
    local name = entry.node:sub(9)
    local actual = owners[name]
    if not resourceName(actual) or not WC.started(actual) then return false end
    if entry.commandOwners ~= nil then
        local rule, choices = DISPATCHED[resource], entry.commandOwners
        if not rule or not rule.commands[name] or type(choices) ~= 'table' or #choices < 1 or #choices > 3 then return false end
        local found, count = false, 0
        for index, owner in pairs(choices) do
            if type(index) ~= 'number' or not math.tointeger(index) or index < 1 or index > #choices or not rule.owners[owner] then return false end
            count = count + 1
            if owner == actual then found = true end
        end
        return found and count == #choices
    end
    local expected = entry.commandOwner or resource
    return expected == resource and actual == expected
end

function WC.ScriptCatalog.build()
    local registry = WC.ScriptPermissionRegistry
    local result, allowed = { version = 1, groups = {} }, {}
    if type(registry) ~= 'table' or registry.version ~= 1 or type(registry.groups) ~= 'table' then return result, allowed end
    local owners, labels, groupsSeen = commandOwners(), nil, {}
    for _, group in ipairs(registry.groups) do
        local resource = type(group) == 'table' and group.resource or nil
        local groupLabel = type(group) == 'table' and localized(group.label, 256) or nil
        if resourceName(resource) and group.id == resource and groupLabel and not group.web
            and not groupsSeen[resource] and WC.started(resource) and compatible(resource, group.minVersion) and type(group.permissions) == 'table' then
            groupsSeen[resource] = true
            local projected = { id = resource, resource = resource, label = groupLabel, permissions = {} }
            for _, entry in ipairs(group.permissions) do
                local node = type(entry) == 'table' and entry.node or nil
                if WC.ScriptCatalog.safeNode(node) and not entry.web and entry.id == resource .. ':' .. node and not allowed[entry.id] then
                    local own = node:sub(1, #resource + 1) == resource .. '.'
                        or (resource == 'w_farming' and node:sub(1, 12) == 'w_livestock.')
                        or (resource == 'w_survival' and node:sub(1, 9) == 'survival.')
                    if node:sub(1, 8) == 'command.' then
                        own = ownsCommand(resource, entry, owners)
                    end
                    if own then
                        local label = localized(entry.label, 256)
                        local description = localized(entry.description, 1200)
                        if not label or not description then
                            labels = labels or coreLabels()
                            local original = labels[node]
                            label = label or (original and localized(original.label, 256))
                            description = description or (original and localized(original.desc, 1200))
                        end
                        if label and description then
                            projected.permissions[#projected.permissions + 1] = {
                                id = entry.id, node = node, label = label, description = description, danger = entry.danger == true,
                            }
                            allowed[entry.id] = { node = node, resource = resource }
                        end
                    end
                end
            end
            table.sort(projected.permissions, function(a, b) return a.id < b.id end)
            if #projected.permissions > 0 then result.groups[#result.groups + 1] = projected end
        end
    end
    table.sort(result.groups, function(a, b) return a.id < b.id end)
    return result, allowed
end

function WC.ScriptCatalog.fingerprint(catalog)
    local out = { '1' }
    for _, group in ipairs(catalog.groups) do
        out[#out + 1] = group.id; out[#out + 1] = group.label.ar; out[#out + 1] = group.label.en
        local version = type(GetResourceMetadata) == 'function' and GetResourceMetadata(group.resource, 'version', 0)
        out[#out + 1] = type(version) == 'string' and version or ''
        for _, entry in ipairs(group.permissions) do
            out[#out + 1] = entry.id; out[#out + 1] = entry.label.ar; out[#out + 1] = entry.label.en
            out[#out + 1] = entry.description.ar; out[#out + 1] = entry.description.en
            out[#out + 1] = entry.danger and '1' or '0'
        end
    end
    return table.concat(out, '\0')
end
