--- Server operations: kick, resources, console, announcements. Natives verified against this FXServer
--- build's citizen/scripting/lua/natives_server.lua and, for resources and announcements, the live
--- w_connector handlers they replace.

-- Stopping these takes the server or this link down with them; refusing is more useful than obeying.
local PROTECTED = {
    [GetCurrentResourceName()] = true,
    oxmysql = true, sessionmanager = true, ['sessionmanager-rdr3'] = true, hardcap = true, spawnmanager = true,
    mapmanager = true, vorp_core = true, ['rsg-core'] = true, w_core = true, w_lib = true, w_centralbank = true,
    es_extended = true, ['qb-core'] = true, qbx_core = true,
}

WC.Ops.define('players.kick', nil, function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local reason = type(args.reason) == 'string' and args.reason:sub(1, 200) or ''
    DropPlayer(tostring(src), reason ~= '' and reason or 'Kicked by staff')
    return true
end)

WC.Ops.define('resources.list', nil, function()
    local out = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            out[#out + 1] = {
                name = name,
                state = GetResourceState(name),
                version = GetResourceMetadata(name, 'version', 0) or '',
                author = GetResourceMetadata(name, 'author', 0) or '',
                description = (GetResourceMetadata(name, 'description', 0) or ''):sub(1, 200),
                protected = PROTECTED[name] == true,
            }
        end
    end
    table.sort(out, function(a, b) return a.name < b.name end)
    return true, out
end)

WC.Ops.define('resources.control', nil, function(args)
    local name = type(args.name) == 'string' and args.name or ''
    if not name:match('^[%w_%-%.%[%]]+$') or #name > 128 then return false, 'invalid_args' end
    if PROTECTED[name] then return false, 'resource_is_protected' end
    if GetResourceState(name) == 'missing' then return false, 'resource_not_found' end
    local action = args.action
    if action == 'start' then
        StartResource(name)
    elseif action == 'stop' then
        StopResource(name)
    elseif action == 'restart' then
        StopResource(name)
        Wait(500)
        StartResource(name)
    else
        return false, 'invalid_args'
    end
    return true, { state = GetResourceState(name) }
end)

-- ── Console ────────────────────────────────────────────────────────────────────────────────────
-- The last lines of the server console, numbered, so the panel can ask for what came after the last
-- line it has. RegisterConsoleListener exists in the FXServer builds we support; without it the op is
-- simply not offered.

local LINES, MAX_LINES, MAX_LEN = {}, 500, 600
local seq = 0
local partial = ''

local function push(channel, text)
    seq = seq + 1
    LINES[#LINES + 1] = { n = seq, c = channel, t = text:sub(1, MAX_LEN) }
    if #LINES > MAX_LINES then table.remove(LINES, 1) end
end

local consoleOk = false
if RegisterConsoleListener then
    consoleOk = pcall(RegisterConsoleListener, function(channel, message)
        -- A message may hold several lines, or end mid-line; keep the tail for the next one.
        local text = partial .. tostring(message or ''):gsub('\27%[[%d;]*m', '')
        partial = ''
        for line, nl in text:gmatch('([^\n]*)(\n?)') do
            if nl == '' then partial = line break end
            if line ~= '' then push(tostring(channel or ''), line) end
        end
    end)
end

WC.Ops.define('console.tail', function() return consoleOk end, function(args)
    local after = math.tointeger(tonumber(args.after)) or 0
    local out = {}
    for _, l in ipairs(LINES) do
        if l.n > after then out[#out + 1] = l end
    end
    return true, { lines = out, last = seq }
end)

-- A console command, run as this resource. Offered only when server.cfg grants it:
--     add_ace resource.w_connector command allow
-- IsPrincipalAceAllowed answers the NUMBER 1 (not true) on the FXServer builds we run, despite its own
-- documentation — seen on a staging server, 2026-10-28 — so both are accepted.
WC.Ops.define('server.command', function()
    local v = IsPrincipalAceAllowed('resource.' .. GetCurrentResourceName(), 'command')
    return v == true or v == 1
end, function(args)
    local cmd = type(args.command) == 'string' and args.command or ''
    if cmd == '' or #cmd > 400 or cmd:find('[\r\n]') then return false, 'invalid_args' end
    ExecuteCommand(cmd)
    return true
end)

-- ── Announcements ──────────────────────────────────────────────────────────────────────────────
-- Shown through the cfx `chat` resource, the one display both games share; offered only while it runs.
-- txAdmin's broadcast event is raised too, for servers that run it.
WC.Ops.define('server.announce', function() return WC.started('chat') end, function(args)
    local msg = type(args.message) == 'string' and args.message:sub(1, 500) or ''
    if msg == '' then return false, 'invalid_args' end
    local by = type(args.by) == 'string' and args.by:sub(1, 60) or 'Staff'
    TriggerClientEvent('chat:addMessage', -1, { color = { 34, 185, 129 }, multiline = true, args = { by, msg } })
    TriggerEvent('txaBroadcast', { message = msg, author = by })
    return true
end)
