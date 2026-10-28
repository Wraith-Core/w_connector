--- The join check and the entry queue.
---
--- On `playerConnecting` the player is held (deferrals) while the website decides: bans, whitelist,
--- closed server, and the player's queue priority. When the server is full, players wait here in order
--- of priority, then arrival, until a slot opens.
---
--- When the website can't be reached the player is let in, unless `set wraith_join_fail_closed "true"`:
--- a ban list that locks everyone out whenever the internet blips would be worse than the bans.

local FAIL = 'This server cannot check your access right now. Please try again shortly.'
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
        if failClosed() then return deferrals.done(FAIL) end
        return deferrals.done()
    end

    deferrals.update('Checking your access…')
    local status, body = WC.request('POST', '/join', { name = tostring(name or ''):sub(1, 64), identifiers = WC.identifiers(src) })
    if status ~= 200 or type(body) ~= 'table' then
        if failClosed() then return deferrals.done(FAIL) end
        return deferrals.done()
    end
    if body.allow == false then
        return deferrals.done(type(body.message) == 'string' and body.message:sub(1, 500) or 'You may not join this server.')
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
        deferrals.update(('The server is full. You are %d of %d in the queue.'):format(pos or 0, #queue))
        Wait(2000)
    end
end)
