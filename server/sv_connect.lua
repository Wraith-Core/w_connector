--- Join enforcement: bans, the whitelist, and the closed-server flag.
---
--- Two rules carried over from w_admin because both were right:
---
---   * Empty-string identifiers are excluded from the ban match. A row whose `steam_hex` is ''
---     would otherwise match every player who has no Steam identifier — i.e. one bad ban row bans
---     the entire server.
---   * A database error ALLOWS the join. Failing closed here means a brief database hiccup locks
---     every player out, including the owner who would have to fix it. A ban that is briefly not
---     enforced is recoverable; a server nobody can enter is not.

local WAIT_FOR_CORE_MS = 30000

local function activeBanFor(ids)
    local clauses, values = {}, {}

    -- Built one at a time rather than from a table literal: a nil `license` in the middle of an
    -- array literal truncates it, so half the identifiers would silently never be checked.
    local function matchIdentifier(id)
        if not id or id == '' then return end
        clauses[#clauses + 1] = '`identifier` = ?'
        values[#values + 1] = id
    end

    matchIdentifier(ids.license)
    matchIdentifier(ids.steam and ('steam:' .. ids.steam) or nil)
    if ids.steam and ids.steam ~= '' then
        clauses[#clauses + 1] = '`steam_hex` = ?'
        values[#values + 1] = ids.steam
    end
    if #clauses == 0 then return nil end

    return MySQL.single.await(
        'SELECT `id`, `reason`, `expiry_date`, `ban_type` FROM `wc_bans` WHERE `is_active` = 1 AND (' ..
        table.concat(clauses, ' OR ') .. ') ORDER BY `ban_date` DESC LIMIT 1', values)
end

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    deferrals.defer()

    CreateThread(function()
        Wait(0)
        deferrals.update('Checking your access…')

        -- Let vorp_core finish starting; identifiers exist before it does, but the whitelist and ban
        -- tables may not have been created yet on a very fresh install.
        local waited = 0
        while not Schema.ready and waited < WAIT_FOR_CORE_MS do
            Wait(200)
            waited = waited + 200
        end

        local ids = Vorp.identifiers(src)

        if ServerState and ServerState.closed then
            -- Staff still get in, so an owner who closed the server can still work on it.
            local admin = ids.steam and Perms.adminOf('steam:' .. ids.steam)
            if not admin and ids.license then admin = Perms.adminOf(ids.license) end
            if not admin then
                deferrals.done('The server is currently closed to new players. Please try again later.')
                return
            end
        end

        local ok, ban = pcall(activeBanFor, ids)
        if not ok then
            print('^3[w_connector]^0 ban check failed, allowing the join: ' .. tostring(ban))
        elseif ban then
            -- An expired temporary ban is lifted on contact rather than left to a sweeper, so a
            -- player whose ban ran out five minutes ago can play now.
            local expired = false
            if ban.ban_type == 'temporary' and ban.expiry_date then
                local y, m, d, hh, mm, ss = tostring(ban.expiry_date)
                    :match('(%d+)-(%d+)-(%d+)[T ](%d+):(%d+):(%d+)')
                if y then
                    local when = os.time({ year = tonumber(y), month = tonumber(m), day = tonumber(d),
                                           hour = tonumber(hh), min = tonumber(mm), sec = tonumber(ss) })
                    expired = when <= os.time()
                end
            end
            if expired then
                MySQL.update.await('UPDATE `wc_bans` SET `is_active` = 0 WHERE `id` = ?', { ban.id })
            else
                local until_ = ban.expiry_date and (' Expires: ' .. tostring(ban.expiry_date)) or ' This ban is permanent.'
                deferrals.done(('You are banned. Reason: %s.%s'):format(ban.reason or 'No reason given', until_))
                return
            end
        end

        if Config.useWhitelist and not WhitelistAllows(ids.steam) then
            deferrals.done('This server is whitelisted and your account is not on the list.')
            return
        end

        deferrals.done()
    end)
end)
