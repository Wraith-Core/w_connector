--- The link to the website: configuration, signed requests, hello, heartbeat and the command loop.
---
--- Outbound HTTPS only. Every request is signed (03-connector-v2.md §3); the website does all
--- authorisation and only ever sends ops this server declared.

WC = WC or {}

local PROTOCOL = 2
local DEFAULT_ENDPOINT = 'https://wraith7.com/api/connector/v2'

local cfg = nil -- { keyId, secret, origin, basePath }
local link = { up = false, pollWait = 25, heartbeat = 15, server = nil, ops = '' }

--- Read and check the convars. Returns the config, or nil and the reason (printed once at start).
function WC.loadConfig()
    local token = GetConvar('wraith_token', '')
    local keyId, secret = token:match('^wc2%.(k%x+)%.([%w_%-]+)$')
    if not keyId then return nil, 'wraith_token is missing or malformed' end

    local endpoint = GetConvar('wraith_endpoint', DEFAULT_ENDPOINT):gsub('/+$', '')
    local scheme, host, path = endpoint:match('^(https?)://([^/]+)(/.*)$')
    if not scheme then return nil, 'wraith_endpoint is not a URL' end
    local bareHost = host:gsub(':%d+$', '')
    if scheme == 'http' and bareHost ~= 'localhost' and bareHost ~= '127.0.0.1' then
        return nil, 'wraith_endpoint must use https'
    end

    cfg = { keyId = keyId, secret = secret, origin = scheme .. '://' .. host, basePath = path }
    return cfg
end

--- The game this server runs: 'rdr3' or 'gta5'. On the server GetGameName() answers 'fxserver'.
function WC.gameName()
    local g = GetGameName()
    if g == 'fxserver' then g = GetConvar('gamename', 'gta5') end
    return (g == 'rdr3' or g == 'redm') and 'rdr3' or 'gta5'
end

local function nonce()
    return ('%08x%08x%08x%08x'):format(math.random(0, 0xffffffff), math.random(0, 0xffffffff),
        math.random(0, 0xffffffff), math.random(0, 0xffffffff))
end

--- The signing string and headers for one request. Separate from sending so the tests can check it
--- against the website's verifier byte for byte.
function WC.signedHeaders(method, fullPath, body, ts, n)
    local canonical = table.concat({ method, fullPath, ts, n, WC.crypto.sha256Hex(body) }, '\n')
    return {
        ['Content-Type'] = 'application/json',
        ['x-wraith-key'] = cfg.keyId,
        ['x-wraith-ts'] = ts,
        ['x-wraith-nonce'] = n,
        ['x-wraith-sig'] = WC.crypto.hmacHex(cfg.secret, canonical),
    }
end

--- Send one signed request and wait for the answer. Returns status, decoded body (or nil).
function WC.request(method, path, payload, timeoutMs)
    local body = payload ~= nil and json.encode(payload) or ''
    local fullPath = cfg.basePath .. path
    local headers = WC.signedHeaders(method, fullPath, body, tostring(os.time() * 1000), nonce())

    local p = promise.new()
    local settled = false
    local function finish(value)
        if settled then return end
        settled = true
        p:resolve(value)
    end
    -- Native permission leases use a bounded request. Other protocol callers retain their behaviour.
    if type(timeoutMs) == 'number' and timeoutMs > 0 and timeoutMs <= 60000 then
        SetTimeout(math.floor(timeoutMs), function() finish({ status = 0, body = nil }) end)
    end
    PerformHttpRequest(cfg.origin .. fullPath, function(status, resp)
        if settled then return end
        local decoded = nil
        if type(resp) == 'string' and resp ~= '' then
            local ok, v = pcall(json.decode, resp)
            if ok then decoded = v end
        end
        finish({ status = status, body = decoded })
    end, method, body, headers)
    local r = Citizen.Await(p)
    return r.status, r.body
end

local function helloPayload()
    WC.Adapters.detect()
    local fw = WC.Adapters.get('framework')
    local accounts = nil
    if fw then
        local ok, list = pcall(fw.accounts)
        if ok then accounts = list end
    end
    local catalog = WC.ScriptPermissions and WC.ScriptPermissions.catalog() or nil
    local payload = {
        protocol = PROTOCOL,
        connector = GetResourceMetadata(GetCurrentResourceName(), 'version', 0),
        game = WC.gameName(),
        build = tonumber(GetConvar('sv_enforceGameBuild', '0')) or 0,
        framework = WC.Adapters.describe('framework'),
        inventory = WC.Adapters.describe('inventory'),
        accounts = accounts,
        ops = WC.Ops.available(),
        modules = WC.modules and WC.modules() or {},
        -- Lua's empty table can encode as {}, so omit the optional catalogue on generic servers.
        permissionCatalog = catalog and #catalog.groups > 0 and catalog or nil,
    }
    return payload, catalog
end

--- Why a refused hello was refused, in words for the server console.
local REFUSALS = {
    [401] = 'the token was rejected — mint a new one on the panel',
    [402] = 'the subscription for this product is not active',
    [404] = 'the website has the v2 connector switched off',
    [409] = 'this token belongs to the other game',
}

--- What this server can do right now, as one comparable string: its ops and its running modules.
--- When it changes the connector says hello again at once.
local function capabilitiesOf(ops, modules, fingerprint)
    local mods = {}
    for _, m in ipairs(modules) do mods[#mods + 1] = m.id end
    return table.concat(ops, ',') .. '|' .. table.concat(mods, ',') .. '|' .. fingerprint
end
function WC.capabilities()
    return capabilitiesOf(WC.Ops.available(), WC.modules and WC.modules() or {}, WC.ScriptPermissions and WC.ScriptPermissions.fingerprint() or '')
end

function WC.linked()
    return link.up
end

function WC.hello()
    local payload, catalog = helloPayload()
    -- Remember what was sent. Changes while HTTP yields must trigger a second hello afterwards.
    local sentCapabilities = capabilitiesOf(payload.ops, payload.modules,
        WC.ScriptPermissions and WC.ScriptPermissions.fingerprint(catalog) or '')
    local status, body = WC.request('POST', '/hello', payload)
    if status == 200 and type(body) == 'table' and body.ok then
        -- Said once when the link comes up (not on every 10-minute re-hello): the owner's sign it worked.
        if not link.up then
            local fw, inv = payload.framework, payload.inventory
            WC.log('linked — framework %s, inventory %s, %d ops', fw and fw.id or 'none', inv and inv.id or 'none', #payload.ops)
        end
        link.up = true
        link.ops = sentCapabilities
        link.server = body.server
        link.pollWait = math.max(1, math.min(25, tonumber(body.pollWait) or 25))
        link.heartbeat = math.max(5, math.min(60, tonumber(body.heartbeat) or 15))
        return true
    end
    link.up = false
    WC.log('not linked: %s', REFUSALS[status] or ('website answered ' .. tostring(status)))
    return false
end

--- Anything but 200 on a running link means the website stopped accepting this server.
local function lost(status)
    if status == 401 or status == 402 or status == 404 or status == 409 then
        link.up = false
        if WC.ScriptPermissions then WC.ScriptPermissions.reset() end
    end
end

-- Commands are executed at most once. The website hands a command out once, but a poll that closed
-- mid-answer puts it back in line, so the same id can arrive twice: the second time it is not run again,
-- its first result is sent instead (a ban or a money change must never happen twice).
local done, doneOrder, DONE_MAX = {}, {}, 300

local function postResult(result)
    -- The result is the acknowledgement: a lost one leaves the caller waiting until its timeout, so a
    -- network blip is retried a few times before giving up.
    for attempt = 1, 4 do
        local status = WC.request('POST', '/result', result)
        if status == 200 then return end
        lost(status)
        if status >= 400 and status < 500 then return end -- refused, not lost: retrying cannot help
        Wait(500 * attempt)
    end
end

local function runCommand(cmd)
    local id = tostring(cmd.id or '')
    if id ~= '' and done[id] then
        -- Still running: the first copy will answer. Finished: answer again with the same result.
        if done[id] ~= true then postResult(done[id]) end
        return
    end
    if id ~= '' then done[id] = true end
    local ok, data = WC.Ops.run(cmd.op, cmd.args, cmd.actor)
    local result = { id = cmd.id, ok = ok and true or false }
    if ok then result.data = data else result.error = data end
    if id ~= '' then
        done[id] = result
        doneOrder[#doneOrder + 1] = id
        if #doneOrder > DONE_MAX then done[table.remove(doneOrder, 1)] = nil end
    end
    postResult(result)
end
WC.runCommand = runCommand

function WC.start()
    local version = GetResourceMetadata(GetCurrentResourceName(), 'version', 0)
    WC.log('w_connector v%s', type(version) == 'string' and version ~= '' and version or 'unknown')
    local _, why = WC.loadConfig()
    if not cfg then
        WC.log('not starting: %s. Put `set wraith_token "wc2.…"` from your panel in server.cfg.', why)
        return
    end

    -- Link, and re-link (re-detecting adapters) every 10 minutes, after the website dropped us, or as soon
    -- as what this server can do changes (a resource an op relies on started or stopped, an ACE was granted).
    CreateThread(function()
        Wait(2000) -- give the framework a moment to finish starting
        local lastHello = 0
        while true do
            if not link.up or GetGameTimer() - lastHello > 600000 or WC.capabilities() ~= link.ops then
                WC.hello()
                lastHello = GetGameTimer()
            end
            Wait(link.up and 5000 or 60000)
        end
    end)

    CreateThread(function()
        while true do
            if link.up then
                -- 2.8.0: jail = 1 asks for the admin jail list in the answer (ops/jail.lua)
                local status, body = WC.request('POST', '/heartbeat', { players = WC.onlinePlayers(), uptime = GetGameTimer() // 1000, queue = WC.queueSize and WC.queueSize() or 0, jail = 1 })
                lost(status)
                -- 2.2.0: the website's "server closed" switch rides on the answer (core/closed.lua)
                if status == 200 and type(body) == 'table' and WC.Closed then WC.Closed.learn(body.closed, body.closedMessage) end
                if status == 200 and type(body) == 'table' and type(body.jail) == 'table' and WC.Jail then pcall(WC.Jail.learn, body.jail) end
            end
            Wait(link.heartbeat * 1000)
        end
    end)

    CreateThread(function()
        while true do
            if link.up then
                local status, body = WC.request('GET', '/next?wait=' .. link.pollWait)
                if status == 200 and type(body) == 'table' and type(body.command) == 'table' then
                    local cmd = body.command
                    CreateThread(function() WC.runCommand(cmd) end)
                elseif status ~= 200 then
                    lost(status)
                    Wait(5000)
                end
                Wait(100)
            else
                Wait(1000)
            end
        end
    end)
end
