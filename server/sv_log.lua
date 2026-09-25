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

    -- A logging fault must never break the action it was recording.
    pcall(function()
        MySQL.insert.await(
            'INSERT INTO `wc_logs` (`admin_username`,`admin_identifier`,`action_type`,`action`,`details`,' ..
            '`target_player`,`target_identifier`,`severity`,`ip_address`,`avatar`) VALUES (?,?,?,?,?,?,?,?,?,?)',
            { entry.admin_username, entry.admin_identifier, entry.action_type, entry.action, entry.details,
              entry.target_player, entry.target_identifier, entry.severity, entry.ip_address, entry.avatar })
    end)
    pcall(toDiscord, entry)
end
