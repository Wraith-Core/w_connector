-- 2.2.0: two player tools that used to go through w_admin (sv_console.lua playerActions.wardrobe and
-- sitOnMount, cl_admin.lua), now native. ctx.target is the player the console resolved and bound.
local C = WC.Console

-- Open w_creators' wardrobe on the target's own screen. Its server export runs every check itself
-- (the wardrobe service is on, a character is loaded, no other menu is open, remote wardrobes are
-- allowed: Config.Wardrobe.allowRemote) and answers why it refused; any resource may call it.
local WARDROBE = {
    WARDROBE_DISABLED = 'err_wardrobe_disabled', SERVICE_DISABLED = 'err_wardrobe_disabled',
    NO_CHARACTER = 'err_wardrobe_no_character', BUSY = 'err_wardrobe_busy',
    LOCATION_NOT_FOUND = 'err_wardrobe_remote_off',
}
C.define('player.wardrobe', function()
    if not WC.started('w_creators') then return false, 'err_creators_missing' end
    return true
end, function(_, ctx)
    if not ctx.valid() then return false, 'target_changed' end
    local called, r = pcall(function() return exports.w_creators:OpenWardrobe(ctx.target) end)
    if not called or type(r) ~= 'table' then return false, 'err_creators_missing' end
    if r.ok ~= true then
        local code = type(r.code) == 'string' and r.code:sub(1, 40) or ''
        return false, WARDROBE[code] or 'err_wardrobe_refused', { code = code }
    end
    return true
end)

-- Seat the target on the closest live horse nobody rides, within 8 m. It runs on HIS client
-- (client/cl_console_tools.lua 'player.sitOnMount'), which answers no_mount_nearby when there is none.
local seating = {}
C.define('player.sitOnMount', function()
    if WC.gameName() ~= 'rdr3' then return false, 'capability_missing' end
    return true
end, function(_, ctx)
    local target = ctx.target
    if not ctx.valid() then return false, 'target_changed' end
    if seating[target] then return false, 'err_target_busy' end
    seating[target] = true
    local called, ok, result = pcall(C.client, 'player.sitOnMount', {}, { source = target, session = ctx.session, valid = ctx.valid })
    seating[target] = nil
    if not called then return false, 'failed' end
    if not ok then return false, result == 'no_mount_nearby' and 'err_no_mount_near_player' or result end
    return true
end)
AddEventHandler('playerDropped', function() seating[source] = nil end)
