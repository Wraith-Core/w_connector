--- Player reports / tickets.
---
--- Read-only from the game's point of view: there is no in-game form to submit one, because there
--- is no in-game UI at all. Reports arrive from the website and staff work them from the website;
--- this file is what makes that possible against the server's own database.
---
--- The list result MUST embed each report's messages. The panel's detail modal has no per-report
--- read — it re-runs `adminpanel:getReports` every 8 seconds and finds its report by id — so a
--- thread that is not in the list result is a thread nobody can read.

local PAGE_SIZE = 20

local function messagesFor(reportIds)
    local out = {}
    if #reportIds == 0 then return out end
    local nums = {}
    for _, id in ipairs(reportIds) do
        local n = tonumber(id)
        if n then nums[#nums + 1] = tostring(math.floor(n)) end
    end
    if #nums == 0 then return out end
    -- One query for the whole page rather than one per report.
    local rows = MySQL.query.await(
        'SELECT `report_id`, `sender_type`, `sender_name`, `message`, `image`, `timestamp` ' ..
        'FROM `wc_report_messages` WHERE `report_id` IN (' .. table.concat(nums, ',') .. ') ' ..
        'ORDER BY `timestamp` ASC') or {}
    for _, m in ipairs(rows) do
        local id = tonumber(m.report_id)
        out[id] = out[id] or {}
        table.insert(out[id], {
            sender_name = m.sender_name, sender_type = m.sender_type,
            message = m.message, image = m.image, timestamp = m.timestamp,
        })
    end
    return out
end

Registry.invoke('adminpanel:getReports', 'admin.reports.view', function(actor, args)
    args = type(args) == 'table' and args or {}
    local page = math.max(H.int(args.page, 1) or 1, 1)
    local limit = H.clamp(args.limit, 1, 100, PAGE_SIZE)
    local status = H.str(args.status, 16)
    local rtype = H.str(args.type, 32)
    local search = H.str(args.search, 100)

    local where, values = {}, {}
    if status ~= '' and status ~= 'all' then
        where[#where + 1] = '`status` = ?'; values[#values + 1] = status
    end
    if rtype ~= '' and rtype ~= 'all' then
        where[#where + 1] = '`report_type` = ?'; values[#values + 1] = rtype
    end
    if search ~= '' then
        where[#where + 1] = '(`title` LIKE ? OR `description` LIKE ? OR `reporter_username` LIKE ?)'
        local term = '%' .. search .. '%'
        values[#values + 1] = term; values[#values + 1] = term; values[#values + 1] = term
    end
    local clause = (#where > 0) and (' WHERE ' .. table.concat(where, ' AND ')) or ''

    local counted = MySQL.single.await('SELECT COUNT(*) AS n FROM `wc_reports`' .. clause, values)
    local total = tonumber(counted and counted.n) or 0

    local listValues = {}
    for _, v in ipairs(values) do listValues[#listValues + 1] = v end
    listValues[#listValues + 1] = limit
    listValues[#listValues + 1] = (page - 1) * limit

    local rows = MySQL.query.await(
        'SELECT `id`, `title`, `description`, `report_type`, `priority`, `status`, `reporter_username`, ' ..
        '`reporter_avatar`, `reported_player_username`, `claimed_by`, `created_at`, `updated_at`, ' ..
        '`admin_notes` FROM `wc_reports`' .. clause ..
        ' ORDER BY `created_at` DESC LIMIT ? OFFSET ?', listValues) or {}

    local ids = {}
    for _, r in ipairs(rows) do ids[#ids + 1] = r.id end
    local byReport = messagesFor(ids)
    for _, r in ipairs(rows) do r.messages = byReport[tonumber(r.id)] or {} end

    return {
        reports = rows,
        totalReports = total,
        totalPages = math.max(math.ceil(total / limit), 1),
    }
end)

Registry.invoke('adminpanel:getReportStatistics', 'admin.reports.view', function()
    local rows = MySQL.query.await(
        'SELECT `status`, COUNT(*) AS n FROM `wc_reports` GROUP BY `status`') or {}
    local byStatus = { open = 0, claimed = 0, resolved = 0 }
    local total = 0
    for _, r in ipairs(rows) do
        local n = tonumber(r.n) or 0
        byStatus[r.status] = n
        total = total + n
    end
    return { statistics = { byStatus = byStatus, totalReports = total } }
end)

local function addSystemMessage(reportId, text)
    MySQL.insert.await(
        'INSERT INTO `wc_report_messages` (`report_id`,`sender_type`,`sender_name`,`message`) VALUES (?,?,?,?)',
        { reportId, 'system', 'System', text })
end

Registry.invoke('adminpanel:claimReport', 'admin.reports.claim', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.reportId or args.id)
    if not id then return H.fail('missing_report_id') end

    local report = MySQL.single.await('SELECT `status`, `claimed_by` FROM `wc_reports` WHERE `id` = ?', { id })
    if not report then return H.fail('report_not_found') end
    if report.status == 'resolved' then return H.fail('report_already_resolved') end
    -- Two admins opening the queue at the same moment both see it unclaimed; without this the
    -- second click silently steals the first one's ticket.
    if report.status == 'claimed' and report.claimed_by and report.claimed_by ~= (actor.label or '') then
        return H.fail('already_claimed_by_' .. tostring(report.claimed_by))
    end

    local av = Players.avatars[actor.identifier or ''] or {}
    MySQL.update.await(
        'UPDATE `wc_reports` SET `status` = \'claimed\', `claimed_by` = ?, `claimed_avatar` = ?, ' ..
        '`claimed_at` = NOW() WHERE `id` = ?',
        { actor.label or 'Web Admin', av.avatar_url or '', id })
    addSystemMessage(id, ('Claimed by %s'):format(actor.label or 'Web Admin'))
    Log.write(actor, 'admin_action', 'Claimed report', '#' .. id)
    return H.ok()
end)

Registry.invoke('adminpanel:resolveReport', 'admin.reports.resolve', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.reportId or args.id)
    if not id then return H.fail('missing_report_id') end

    local n = MySQL.update.await(
        'UPDATE `wc_reports` SET `status` = \'resolved\', `resolved_by` = ?, `resolved_at` = NOW(), ' ..
        '`admin_notes` = ? WHERE `id` = ?',
        { actor.label or 'Web Admin', H.str(args.notes, 1000), id })
    if (tonumber(n) or 0) == 0 then return H.fail('report_not_found') end

    addSystemMessage(id, ('Resolved by %s'):format(actor.label or 'Web Admin'))
    if actor.identifier then
        -- wc_admins only keeps this count now (the ranks are w_core's): a row is made for it when missing
        MySQL.insert.await(
            'INSERT INTO `wc_admins` (`identifier`, `group`, `username`, `resolved_reports`) VALUES (?, ?, ?, 1) ' ..
            'ON DUPLICATE KEY UPDATE `resolved_reports` = `resolved_reports` + 1',
            { tostring(actor.identifier):lower(), actor.group or 'staff', actor.label or '' })
    end
    Log.write(actor, 'admin_action', 'Resolved report', '#' .. id)
    return H.ok()
end)

Registry.invoke('adminpanel:reopenReport', 'admin.reports.reopen', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.reportId or args.id)
    if not id then return H.fail('missing_report_id') end
    local n = MySQL.update.await(
        'UPDATE `wc_reports` SET `status` = \'open\', `claimed_by` = NULL, `claimed_at` = NULL, ' ..
        '`claimed_avatar` = NULL, `resolved_by` = NULL, `resolved_at` = NULL WHERE `id` = ?', { id })
    if (tonumber(n) or 0) == 0 then return H.fail('report_not_found') end
    addSystemMessage(id, ('Reopened by %s'):format(actor.label or 'Web Admin'))
    Log.write(actor, 'admin_action', 'Reopened report', '#' .. id)
    return H.ok()
end)

Registry.invoke('adminpanel:addReportMessage', 'admin.reports.message', function(actor, args)
    args = type(args) == 'table' and args or {}
    local id = tonumber(args.reportId or args.id)
    if not id then return H.fail('missing_report_id') end
    local message = H.str(args.message, 2000)
    if message == '' then return H.fail('missing_message') end

    local report = MySQL.single.await('SELECT `status` FROM `wc_reports` WHERE `id` = ?', { id })
    if not report then return H.fail('report_not_found') end
    if report.status == 'resolved' then return H.fail('report_is_resolved') end

    -- A message that is nothing but an image URL becomes an attachment rather than a line of text,
    -- which is what the panel's thread view renders.
    local image
    if message:match('^https?://%S+%.[Pp][Nn][Gg]$') or message:match('^https?://%S+%.[Jj][Pp][Gg]$')
        or message:match('^https?://%S+%.[Jj][Pp][Ee][Gg]$') or message:match('^https?://%S+%.[Gg][Ii][Ff]$') then
        image = message
    end

    MySQL.insert.await(
        'INSERT INTO `wc_report_messages` (`report_id`,`sender_type`,`sender_name`,`sender_identifier`,' ..
        '`message`,`image`) VALUES (?,?,?,?,?,?)',
        { id, 'admin', actor.label or 'Web Admin', actor.identifier or '', message, image })
    MySQL.update.await('UPDATE `wc_reports` SET `updated_at` = NOW() WHERE `id` = ?', { id })
    return H.ok()
end)
