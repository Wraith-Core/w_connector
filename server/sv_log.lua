--- The audit trail.
---
--- Written straight through to `wc_logs`. w_admin loaded the entire log table into memory at boot,
--- served every read from that array, and flushed unsaved entries every ten minutes — so a crash
--- lost up to ten minutes of audit trail, and memory grew with history forever. A write per admin
--- action is not a load problem; losing the record of who banned whom is.
---
--- The Discord mirror is fire-and-forget and its URL comes from a convar. No webhook URL, token or
--- key is ever written into a file in this resource.

Log = {}

local CATEGORIES = {
    player_action = true, admin_action = true, server_event = true,
    security = true, economy = true, system = true,
}

local COLORS = {
    player_action = 3447003,  -- blue
    admin_action  = 10181046, -- purple
    server_event  = 3066993,  -- green
    security      = 15158332, -- red
    economy       = 15844367, -- gold
    system        = 9807270,  -- grey
}

local function toDiscord(entry)
    local url = Config.webhooks[entry.action_type]
    if not url or url == '' then return end
    local fields = {
        { name = 'Admin', value = entry.admin_username ~= '' and entry.admin_username or 'System', inline = true },
        { name = 'Action', value = entry.action ~= '' and entry.action or '—', inline = true },
    }
    if entry.target_player and entry.target_player ~= '' then
        fields[#fields + 1] = { name = 'Target', value = entry.target_player, inline = true }
    end
    if entry.details and entry.details ~= '' then
        fields[#fields + 1] = { name = 'Details', value = tostring(entry.details):sub(1, 1000), inline = false }
    end
    -- Only when the owner has explicitly opted in. An IP address is personal data and it does not
    -- belong in a Discord channel by default.
    if Config.showIpAddress and entry.ip_address and entry.ip_address ~= '' then
        fields[#fields + 1] = { name = 'IP', value = entry.ip_address, inline = true }
    end
    PerformHttpRequest(url, function() end, 'POST', json.encode({
        embeds = { {
            title = ('[%s] %s'):format(entry.action_type, entry.action),
            color = COLORS[entry.action_type] or COLORS.system,
            fields = fields,
            footer = { text = GetConvar('sv_hostname', 'RedM') },
            timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ'),
        } },
    }), { ['Content-Type'] = 'application/json' })
end

--- A logging fault must never break the action it was recording.
local function store(entry)
    pcall(function()
        MySQL.insert.await(
            'INSERT INTO `wc_logs` (`admin_username`,`admin_identifier`,`action_type`,`action`,`details`,' ..
            '`target_player`,`target_identifier`,`severity`,`ip_address`,`avatar`) VALUES (?,?,?,?,?,?,?,?,?,?)',
            { entry.admin_username, entry.admin_identifier, entry.action_type, entry.action, entry.details,
              entry.target_player, entry.target_identifier, entry.severity, entry.ip_address, entry.avatar })
    end)
end

--- Record an action.
---
--- `actor` is the actor the dispatcher built, or nil for anything the server did on its own.
--- Everything is optional except `action`, because a log call that throws for want of a field is
--- worse than a log line missing one.
function Log.write(actor, actionType, action, details, target)
    actionType = CATEGORIES[actionType] and actionType or 'system'
    target = target or {}
    local entry = {
        admin_username    = (actor and actor.label) or 'System',
        admin_identifier  = (actor and actor.identifier) or '',
        action_type       = actionType,
        action            = tostring(action or ''):sub(1, 200),
        details           = details and tostring(details) or '',
        target_player     = tostring(target.name or ''):sub(1, 100),
        target_identifier = tostring(target.identifier or ''):sub(1, 100),
        severity          = target.severity or 'low',
        ip_address        = (Config.showIpAddress and target.ip) or '',
        avatar            = target.avatar or '',
    }

    store(entry)
    pcall(toDiscord, entry)
    -- one log for both panels (2026-10-22): w_admin's in-game log shows what the website did
    if GetResourceState('w_admin') == 'started' then
        pcall(function()
            exports.w_admin:SiteLog({ by = entry.admin_username, action = entry.action, details = entry.details,
                target = entry.target_player, severity = entry.severity })
        end)
    end
end

--- w_admin's in-game log line, stored for the website's Logs tab. Not sent back to w_admin, and not
--- posted to Discord here (w_admin's own logger does that).
local KIND_TYPE = { server = 'server_event', scripts = 'server_event', settings = 'server_event' }

--- At most n bytes, never cut inside a letter (an Arabic name or reason would fail the insert).
local function clip(v, n)
    v = tostring(v or ''):sub(1, n)
    while #v > 0 and not utf8.len(v) do v = v:sub(1, -2) end
    return v
end
exports('GameLog', function(e)
    e = type(e) == 'table' and e or {}
    local target = type(e.target) == 'table' and e.target or {}
    local kind = tostring(e.kind or '')
    store({
        admin_username    = clip(e.by or 'console', 100),
        admin_identifier  = clip(e.byIdentifier, 100),
        action_type       = (target.name or target.citizenid) and 'player_action' or KIND_TYPE[kind] or 'admin_action',
        action            = clip(('In game: %s'):format(e.action ~= nil and e.action ~= '' and e.action or kind), 200),
        details           = tostring(e.text or ''),
        target_player     = clip(target.name or target.citizenid, 100),
        target_identifier = clip(target.citizenid, 100),
        severity          = kind == 'bans' and 'high' or (e.ok == false and 'medium' or 'low'),
        ip_address        = '',
        avatar            = '',
    })
end)
