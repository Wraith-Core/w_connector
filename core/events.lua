--- Game events the website keeps: joins and leaves (for the logs and statistics) and in-game reports.
---
--- Events are buffered and sent in one signed batch every 10 seconds while linked; a batch that fails
--- stays in the buffer (capped) and goes with the next one.

local buffer, MAX = {}, 500

function WC.logEvent(kind, src, data)
    local ids = src and WC.identifiers(src) or nil
    buffer[#buffer + 1] = {
        kind = kind,
        at = os.time(),
        source = src,
        name = src and GetPlayerName(src) or nil,
        license = ids and ids.license or nil,
        discord = ids and ids.discord or nil,
        data = data,
    }
    if #buffer > MAX then table.remove(buffer, 1) end
end

AddEventHandler('playerJoining', function()
    WC.logEvent('join', source)
end)

AddEventHandler('playerDropped', function(reason)
    WC.logEvent('leave', source, { reason = tostring(reason or ''):sub(1, 200) })
end)

CreateThread(function()
    while true do
        Wait(10000)
        if WC.linked() and #buffer > 0 then
            local batch = buffer
            buffer = {}
            local status = WC.request('POST', '/events', { events = batch })
            if status ~= 200 then
                for i = #batch, 1, -1 do table.insert(buffer, 1, batch[i]) end
                while #buffer > MAX do table.remove(buffer, 1) end
            end
        end
    end
end)

-- ── In-game reports: /report <text> (rename with `set wraith_report_command "…"`, "off" to disable) ──
local cmd = GetConvar('wraith_report_command', 'report')
if cmd ~= 'off' and cmd:match('^[%w_]+$') then
    local last = {}
    RegisterCommand(cmd, function(src, args)
        if src <= 0 then return end
        local text = table.concat(args, ' '):sub(1, 500)
        local function reply(msg)
            if WC.started('chat') then TriggerClientEvent('chat:addMessage', src, { args = { 'Report', msg } }) end
        end
        if text == '' then return reply('/' .. cmd .. ' <message>') end
        if last[src] and os.time() - last[src] < 60 then return reply('Please wait a minute between reports.') end
        if not WC.linked() then return reply('Reports are unavailable right now.') end
        last[src] = os.time()
        CreateThread(function()
            local ids = WC.identifiers(src)
            local status = WC.request('POST', '/report', { source = src, name = GetPlayerName(src), text = text, identifiers = ids })
            reply(status == 200 and 'Your report was sent to the staff.' or 'Your report could not be sent.')
        end)
    end, false)
end
