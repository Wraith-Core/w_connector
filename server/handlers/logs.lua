--- The Logs tab.
---
--- Reads straight from `wc_logs` with LIMIT and OFFSET. w_admin held the entire log table in memory
--- and paged the array, which meant memory grew with history and the panel could only ever show
--- what had been loaded at boot.

local TYPES = {
    player_action = true, admin_action = true, server_event = true,
    security = true, economy = true, system = true,
}

local function rowToPanel(r)
    return {
        id = r.id,
        type = r.action_type,
        severity = r.severity,
        admin = r.admin_username,
        adminAvatar = r.avatar,
        action = r.action,
        details = r.details,
        targetPlayer = r.target_player,
        ip = r.ip_address,
        timestamp = r.timestamp,
    }
end

Registry.invoke('getAdminLogs', 'access_logs', function(actor, args)
    args = type(args) == 'table' and args or {}
    local page = math.max(H.int(args.page, 1) or 1, 1)
    local limit = H.clamp(args.limit, 1, 100, 15)
    local search = H.str(args.search, 100)
    local rtype = H.str(args.type, 32)
    local admin = H.str(args.admin, 100)

    local where, values = {}, {}
    -- Only from the fixed vocabulary. The value arrives over HTTP and ends up in a WHERE clause.
    if rtype ~= '' and rtype ~= 'all' and TYPES[rtype] then
        where[#where + 1] = '`action_type` = ?'; values[#values + 1] = rtype
    end
    if admin ~= '' and admin ~= 'all' then
        where[#where + 1] = '`admin_username` = ?'; values[#values + 1] = admin
    end
    if search ~= '' then
        where[#where + 1] = '(`action` LIKE ? OR `details` LIKE ? OR `target_player` LIKE ?)'
        local term = '%' .. search .. '%'
        values[#values + 1] = term; values[#values + 1] = term; values[#values + 1] = term
    end
    local clause = (#where > 0) and (' WHERE ' .. table.concat(where, ' AND ')) or ''

    local counted = MySQL.single.await('SELECT COUNT(*) AS n FROM `wc_logs`' .. clause, values)

    local listValues = {}
    for _, v in ipairs(values) do listValues[#listValues + 1] = v end
    listValues[#listValues + 1] = limit
    listValues[#listValues + 1] = (page - 1) * limit

    local rows = MySQL.query.await(
        'SELECT `id`, `admin_username`, `admin_identifier`, `action_type`, `action`, `details`, ' ..
        '`target_player`, `severity`, `ip_address`, `avatar`, `timestamp` FROM `wc_logs`' .. clause ..
        ' ORDER BY `timestamp` DESC LIMIT ? OFFSET ?', listValues) or {}

    local logs = {}
    for _, r in ipairs(rows) do logs[#logs + 1] = rowToPanel(r) end

    return { logs = logs, totalLogs = tonumber(counted and counted.n) or 0 }
end)

--- Everything one staff member has done. The Staff tab opens this from an admin's profile.
Registry.invoke('getAdminLogsById', 'access_logs', function(actor, args)
    args = type(args) == 'table' and args or {}
    local target = type(args.targetAdmin) == 'table' and args.targetAdmin or {}
    local identifier = H.str(target.steamHex or target.identifier or args.identifier, 100)
    if identifier == '' then return { logs = {} } end

    local rows = MySQL.query.await(
        'SELECT `id`, `admin_username`, `admin_identifier`, `action_type`, `action`, `details`, ' ..
        '`target_player`, `severity`, `ip_address`, `avatar`, `timestamp` FROM `wc_logs` ' ..
        'WHERE `admin_identifier` = ? ORDER BY `timestamp` DESC LIMIT 200', { identifier }) or {}

    local logs = {}
    for _, r in ipairs(rows) do
        local entry = rowToPanel(r)
        entry.time = r.timestamp  -- the Staff tab reads `time`; the Logs tab reads `timestamp`
        logs[#logs + 1] = entry
    end
    return { logs = logs }
end)
