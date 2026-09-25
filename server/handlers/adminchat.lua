--- Staff chat.
---
--- Three changes from w_admin, each fixing something that was actually wrong:
---
---   * Stored in `wc_chat`, not a JSON file. The original read the whole file, appended, and wrote
---     it back on every message — two admins typing at the same moment means one message survives.
---   * Permission-gated. The original's check was commented out, and because its callbacks were
---     also net events, any player could read staff chat or post into it.
---   * Not broadcast. The original sent every message to `-1` — every player on the server, not just
---     staff. With no in-game UI there is nothing to broadcast to anyway.

--- Messages older than this are dropped on read, matching the original's 48-hour window.
local RETAIN_HOURS = 48
local MAX_MESSAGES = 200

Registry.invoke('adminpanel:getAdminChatData', 'adminchat.view', function()
    MySQL.update.await('DELETE FROM `wc_chat` WHERE `timestamp` < DATE_SUB(NOW(), INTERVAL ? HOUR)',
        { RETAIN_HOURS })

    local messages = MySQL.query.await(
        'SELECT `id`, `sender_id`, `sender_name`, `sender_avatar`, `sender_role`, `message`, `timestamp` ' ..
        'FROM `wc_chat` ORDER BY `timestamp` ASC LIMIT ?', { MAX_MESSAGES }) or {}

    local today = MySQL.single.await('SELECT COUNT(*) AS n FROM `wc_chat` WHERE DATE(`timestamp`) = CURDATE()')
    local total = MySQL.single.await('SELECT COUNT(*) AS n FROM `wc_chat`')

    --- Only staff who are actually connected. Sourced from the roster joined against the live player
    --- list rather than from a cache of "who was an admin once".
    local onlineAdmins = {}
    local roster = MySQL.query.await(
        'SELECT `identifier`, `group`, `username` FROM `wc_admins` WHERE `is_active` = 1') or {}
    local byIdentifier = {}
    for _, r in ipairs(roster) do byIdentifier[r.identifier] = r end

    for _, sid in ipairs(Players.online()) do
        local p = Players.get(sid)
        local row = p and p.identifier and byIdentifier[p.identifier]
        if row then
            local av = Players.avatars[p.identifier] or {}
            onlineAdmins[#onlineAdmins + 1] = {
                id = p.identifier,
                username = row.username ~= '' and row.username or (p.characterName or p.username),
                avatar = av.avatar_url or '',
                role = row.group,
                online = true,
                lastLogin = p.lastLogin,
            }
        end
    end

    return {
        messages = messages,
        statistics = {
            todayMessages = tonumber(today and today.n) or 0,
            totalMessages = tonumber(total and total.n) or 0,
            lastMessage = messages[#messages] and messages[#messages].timestamp or nil,
        },
        onlineAdmins = onlineAdmins,
    }
end)

--- Two-second debounce per sender, carried over from the original: a double-click on Send should
--- not become two identical lines in the thread.
local lastSent = {}

Registry.invoke('adminpanel:sendAdminChatMessage', 'adminchat.send', function(actor, args)
    args = type(args) == 'table' and args or {}
    local message = H.str(args.message, 1000)
    if message == '' then return H.fail('missing_message') end

    local key = actor.identifier or actor.label or 'web'
    local now = os.time()
    local prev = lastSent[key]
    if prev and prev.message == message and (now - prev.at) < 2 then
        return H.ok('duplicate_ignored')
    end
    lastSent[key] = { message = message, at = now }

    local av = Players.avatars[actor.identifier or ''] or {}
    MySQL.insert.await(
        'INSERT INTO `wc_chat` (`sender_id`,`sender_name`,`sender_avatar`,`sender_role`,`message`) ' ..
        'VALUES (?,?,?,?,?)',
        { actor.identifier or '', actor.label or 'Web Admin', av.avatar_url or '', actor.group or '', message })
    return H.ok()
end)
