--- Moving a server from w_connector (v1) to this connector (Phase 6): read v1's own tables in the game
--- database — bans, whitelist, warnings, queue priority — so the website can import them. Read-only:
--- v1's tables are never changed, so v1 keeps working until the owner removes it, and going back is
--- simply stopping this resource. Table and column names from game/w_connector/server/sv_schema.lua.

local function query(sql)
    local ok, rows = pcall(function() return MySQL.query.await(sql) end)
    return ok and rows or nil
end

local function hasV1()
    if not MySQL then return false end
    local r = query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'wc_bans'")
    return r ~= nil and r[1] ~= nil and tonumber(r[1].n) == 1
end

WC.Ops.define('migrate.legacyExport', nil, function()
    if not hasV1() then return false, 'no_v1_data' end
    local LIMIT = ' LIMIT 5000'
    return true, {
        bans = query([[SELECT id, identifier, steam_hex, discord_id, username, character_name, reason, banned_by,
            UNIX_TIMESTAMP(expiry_date) expires, ban_type FROM wc_bans WHERE is_active = 1]] .. LIMIT) or {},
        whitelist = query([[SELECT steam_hex, discord_id, username, character_name FROM wc_whitelist WHERE status = 'active']] .. LIMIT) or {},
        warnings = query([[SELECT id, player_identifier, steam_hex, reason, warned_by FROM wc_warnings WHERE is_active = 1]] .. LIMIT) or {},
        priority = query([[SELECT id, identifier, alt_ids, name, points, expires_at FROM wc_priority]] .. LIMIT) or {},
    }
end)
