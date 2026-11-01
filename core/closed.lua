--- 2.2.0: the "server closed" switch, answered here again (v1 had these exports; 2.0-2.1 dropped them, so w_core's
--- /closeserver and /openserver silently did nothing while the connector ran).
---
--- The website keeps the switch (settings.closed, shown on the panel). The connector learns it from every heartbeat
--- answer and remembers the last value on disk (KVP), so a closed server stays closed while the website is down: the
--- join gate (core/join.lua) then refuses everyone without the 'wraithadmin.join' ACE.
---   exports.w_connector:IsServerClosed()                 -> boolean
---   exports.w_connector:SetServerClosed(closed, by[, message]) -> true | false, reason   (w_core or the console only)

local KVP = 'w_connector:serverClosed'

local function load()
    if type(GetResourceKvpString) ~= 'function' then return false end
    local raw = GetResourceKvpString(KVP)
    if raw == 'true' then return true end
    return false
end

WC.Closed = { value = load(), message = nil }

--- A new value from the website (a heartbeat answer or the reply to SetServerClosed).
function WC.Closed.learn(value, message)
    if type(value) ~= 'boolean' then return end
    if value ~= WC.Closed.value and type(SetResourceKvp) == 'function' then SetResourceKvp(KVP, value and 'true' or 'false') end
    WC.Closed.value = value
    if type(message) == 'string' then WC.Closed.message = message:sub(1, 300) end
end

exports('IsServerClosed', function() return WC.Closed.value == true end)

exports('SetServerClosed', function(closed, by, message)
    local caller = GetInvokingResource()
    if caller ~= nil and caller ~= 'w_core' then return false, 'forbidden' end
    if type(closed) ~= 'boolean' then return false, 'invalid_args' end
    local who = tostring(by or 'console'):sub(1, 64)
    -- the switch takes effect here at once; the website is told (and keeps it) when it can be reached
    WC.Closed.learn(closed, type(message) == 'string' and message or nil)
    if not WC.linked() then return true, 'saved_locally' end
    local status, body = WC.request('POST', '/closed', { closed = closed, by = who, message = type(message) == 'string' and message:sub(1, 300) or nil }, 8000)
    if status ~= 200 or type(body) ~= 'table' or body.ok ~= true then return true, 'saved_locally' end
    WC.Closed.learn(body.closed, body.message)
    return true
end)
