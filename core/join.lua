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
    },
    en = {
        unavailable = 'Access could not be checked. Please try again shortly.',
        checking = 'Checking your access…',
        denied = 'You cannot join this server. Contact staff for the reason.',
        queued = 'The server is full. You are %d of %d in the queue. Please wait; you will join automatically when a slot opens.',
    },
}
local function joinMessage(key, ...)
    local lang = GetConvar('w_lib:locale', 'ar') == 'ar' and 'ar' or 'en'
    return joinText[lang][key]:format(...)
end
local queue = {} -- { src, prio, at }

local function failClosed() return GetConvar('wraith_join_fail_closed', 'false') == 'true' end

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
    -- (Not `a and done(x) or done()`: done returns nothing, so that form calls done twice.)
    if not WC.linked() then
        if failClosed() then return deferrals.done(joinMessage('unavailable')) end
        return deferrals.done()
    end

    deferrals.update(joinMessage('checking'))
    local status, body = WC.request('POST', '/join', { name = tostring(name or ''):sub(1, 64), identifiers = WC.identifiers(src) })
    if status ~= 200 or type(body) ~= 'table' then
        if failClosed() then return deferrals.done(joinMessage('unavailable')) end
        return deferrals.done()
    end
    if body.allow == false then
        return deferrals.done(type(body.message) == 'string' and body.message:sub(1, 500) or joinMessage('denied'))
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
