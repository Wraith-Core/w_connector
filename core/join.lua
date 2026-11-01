--- The join check and the entry queue.
---
--- On `playerConnecting` the player is held (deferrals) while the website decides: bans, whitelist,
--- closed server, and the player's queue priority. When the server is full, players wait here in order
--- of priority, then arrival, until a slot opens.
---
--- When the website can't be reached the player is let in, unless `set wraith_join_fail_closed "true"`:
--- a ban list that locks everyone out whenever the internet blips would be worse than the bans.

local joinText = {
    ar = {
        unavailable = 'تعذر التحقق من صلاحية دخولك الآن. حاول مجددًا بعد قليل.',
        checking = 'جارٍ التحقق من صلاحية دخولك…',
        denied = 'لا يمكنك دخول السيرفر. راجع الإدارة لمعرفة السبب.',
        queued = 'السيرفر ممتلئ. ترتيبك %d من %d في قائمة الانتظار. انتظر؛ سيدخلك السيرفر تلقائيًا عند توفر مكان.',
        closed = 'السيرفر مغلق الآن. حاول الدخول لاحقًا.',
        banned = 'أنت محظور من هذا السيرفر. السبب: %s (رقم الحظر %s).',
        banned_until = 'أنت محظور من هذا السيرفر حتى %s بتوقيت UTC. السبب: %s (رقم الحظر %s).',
        whitelist = 'هذا السيرفر للقائمة المسموحة فقط، واسمك ليس فيها. راجع الإدارة.',
    },
    en = {
        unavailable = 'Access could not be checked. Please try again shortly.',
        checking = 'Checking your access…',
        denied = 'You cannot join this server. Contact staff for the reason.',
        queued = 'The server is full. You are %d of %d in the queue. Please wait; you will join automatically when a slot opens.',
        closed = 'The server is closed right now. Please try again later.',
        banned = 'You are banned from this server. Reason: %s (ban #%s).',
        banned_until = 'You are banned from this server until %s UTC. Reason: %s (ban #%s).',
        whitelist = 'This server is whitelisted, and you are not on the list. Contact staff.',
    },
}
local function joinMessage(key, ...)
    local lang = GetConvar('w_lib:locale', 'ar') == 'ar' and 'ar' or 'en'
    return joinText[lang][key]:format(...)
end
local queue = {} -- { src, prio, at }

local function failClosed() return GetConvar('wraith_join_fail_closed', 'false') == 'true' end

-- 2.2.0: a server closed from the website or /closeserver stays closed while the website cannot be reached
-- (core/closed.lua keeps the last value); staff with the 'wraithadmin.join' ACE still come in.
local function closedLocally(src)
    return WC.Closed and WC.Closed.value == true and not IsPlayerAceAllowed(src, 'wraithadmin.join')
end

-- 2.2.0: the website's own bans, kept on disk from the last ban sync (core/bans.lua): an outage lets nobody banned in
local function bannedLocally(src)
    if not WC.Bans then return nil end
    local b = WC.Bans.cached(WC.identifiers(src))
    if not b then return nil end
    local id = tostring(b.id or '-')
    if b['until'] then return joinMessage('banned_until', os.date('!%Y-%m-%d %H:%M', b['until']), b.reason ~= '' and b.reason or '-', id) end
    return joinMessage('banned', b.reason ~= '' and b.reason or '-', id)
end

--- The website's refusal in the player's language (2.2.0: it sends a reason code; older sites only English text).
local function refusal(body)
    if body.reason == 'banned' then
        local reason = type(body.banReason) == 'string' and body.banReason:sub(1, 200) or '-'
        local id = tostring(math.tointeger(tonumber(body.banId)) or '-')
        if type(body['until']) == 'string' then return joinMessage('banned_until', body['until']:sub(1, 20), reason, id) end
        return joinMessage('banned', reason, id)
    end
    if body.reason == 'closed' then
        return type(body.closedMessage) == 'string' and body.closedMessage ~= '' and body.closedMessage:sub(1, 300) or joinMessage('closed')
    end
    if body.reason == 'whitelist' then return joinMessage('whitelist') end
    return type(body.message) == 'string' and body.message:sub(1, 500) or joinMessage('denied')
end

local function slotsFree()
    return GetNumPlayerIndices() < GetConvarInt('sv_maxclients', 32)
end

local function position(src)
    table.sort(queue, function(a, b) if a.prio ~= b.prio then return a.prio > b.prio end return a.at < b.at end)
    for i, e in ipairs(queue) do if e.src == src then return i end end
    return nil
end

local function leave(src)
    for i, e in ipairs(queue) do if e.src == src then table.remove(queue, i) return end end
end

function WC.queueSize() return #queue end

AddEventHandler('playerConnecting', function(name, _, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    -- 2.2.0: the host agent announced a shutdown (core/host.lua): nobody new comes in
    if WC.Host and WC.Host.shuttingDown then return deferrals.done(WC.Host.say('closing')) end
    -- (Not `a and done(x) or done()`: done returns nothing, so that form calls done twice.)
    if not WC.linked() then
        local banned = bannedLocally(src)
        if banned then return deferrals.done(banned) end
        if closedLocally(src) then return deferrals.done(joinMessage('closed')) end
        if failClosed() then return deferrals.done(joinMessage('unavailable')) end
        return deferrals.done()
    end

    deferrals.update(joinMessage('checking'))
    local status, body = WC.request('POST', '/join', { name = tostring(name or ''):sub(1, 64), identifiers = WC.identifiers(src) })
    if status ~= 200 or type(body) ~= 'table' then
        local banned = bannedLocally(src)
        if banned then return deferrals.done(banned) end
        if closedLocally(src) then return deferrals.done(joinMessage('closed')) end
        if failClosed() then return deferrals.done(joinMessage('unavailable')) end
        return deferrals.done()
    end
    if body.allow == false then
        return deferrals.done(refusal(body))
    end

    if slotsFree() and #queue == 0 then return deferrals.done() end

    -- Full: wait in line. A player who closes the game leaves the line (GetPlayerName answers nil).
    queue[#queue + 1] = { src = src, prio = math.tointeger(tonumber(body.priority)) or 0, at = GetGameTimer() }
    while true do
        if GetPlayerName(src) == nil then leave(src) return end
        local pos = position(src)
        if pos == 1 and slotsFree() then
            leave(src)
            return deferrals.done()
        end
        deferrals.update(joinMessage('queued', pos or 0, #queue))
        Wait(2000)
    end
end)
