--- A character's own record from the website (2026-10-22, one admin system): its details, block,
--- citizen id, deletion, level and XP boost, in the game or not.
---
--- Nothing here is new game logic. The character actions run w_admin's characters page itself
--- (exports.w_admin:SiteCharacterAction), which w_core trusts for them and which writes the log line
--- under the staff member's name (it reaches the website's log through GameLog). The level runs
--- w_level's admin export (AdminCitizen), the same code as /addxp, /setlevel and /xpboost.
--- The registry already checked the node and the rank guard (the panel sends the player reference).

local function admin()
    return GetResourceState('w_admin') == 'started' and exports.w_admin or nil
end

local function level()
    return GetResourceState('w_level') == 'started' and exports.w_level or nil
end

--- The citizen id of the player reference: sent by the panel, else the live character's.
local function citizenOf(args)
    local ref = H.playerRef(args)
    local p = type(args) == 'table' and type(args.player) == 'table' and args.player or {}
    local cid = p.citizenid or (type(args) == 'table' and args.citizenid) or ref.citizenid
    if cid == nil or cid == '' then
        local live = H.liveSource(ref)
        local snap = live and Vorp.snapshot(live)
        cid = snap and snap.citizenid
    end
    if cid == nil or cid == '' then return nil, ref end
    return tostring(cid), ref
end

--- w_admin's page answer ({ ok, error, msg, data }) as the registry's.
local function answer(res)
    if type(res) ~= 'table' then return H.fail('admin_console_error') end
    if not res.ok then
        local out = H.fail(res.error or 'admin_console_error')
        out.data = res.data
        return out
    end
    return { success = true, message = res.msg, data = res.data }
end

local function run(action, payload, actor)
    local api = admin()
    if not api then return H.fail('not_supported_here') end
    local ok, res = pcall(function() return api:SiteCharacterAction(action, payload, actor.label or 'Web Admin') end)
    if not ok then return H.fail('admin_console_error') end
    return answer(res)
end

--- A random-enough token for a long call (delete / transfer): the page asks for its answer with it when
--- the request timed out while w_admin kept working.
local function token(args)
    local t = type(args) == 'table' and tostring(args.token or '') or ''
    return t:match('^[%w]+$') and #t >= 6 and #t <= 40 and t or nil
end

Registry.invoke('getCharacterInfo', 'players_page', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    local out = run('get', { citizenid = cid }, actor)
    if not out.success then return out end
    local lv = level()
    if lv then
        local ok, info = pcall(function() return lv:AdminCitizen(cid, 'get') end)
        if ok and type(info) == 'table' then out.data.level = info end
    end
    return out
end)

Registry.invoke('blockCharacter', 'character.block', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    return run('block', { citizenid = cid, reason = H.str(args.reason, 255) }, actor)
end)

Registry.invoke('unblockCharacter', 'character.block', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    return run('unblock', { citizenid = cid }, actor)
end)

Registry.invoke('reassignCitizenId', 'character.reassign', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    local newId = H.str(args.newId, 32)
    if newId == '' then return H.fail('err_char_bad_id') end
    return run('reassign', { citizenid = cid, newId = newId }, actor)
end)

Registry.invoke('transferCitizenNumber', 'character.reassign', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    local target = H.str(args.target, 32)
    if target == '' then return H.fail('err_char_bad_id') end
    return run('transfer', { citizenid = cid, target = target, token = token(args) }, actor)
end)

Registry.invoke('transferStatus', 'character.reassign', function(actor, args)
    return run('transferStatus', { token = token(args) }, actor)
end)

Registry.invoke('deleteCharacter', 'character.delete', function(actor, args)
    local cid = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    return run('delete', { citizenid = cid, token = token(args) }, actor)
end)

Registry.invoke('deleteStatus', 'character.delete', function(actor, args)
    return run('deleteStatus', { token = token(args) }, actor)
end)

--- The level itself, in the game or not (w_level /setlevel).
Registry.invoke('setPlayerLevel', 'set.level', function(actor, args)
    local cid, ref = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    local lv = level()
    if not lv then return H.fail('not_supported_here') end
    local n = tonumber(args.level)
    if not n then return H.fail('err_invalid_value') end
    local ok, done, why = pcall(function() return lv:AdminCitizen(cid, 'setlevel', math.floor(n), nil, actor.label) end)
    if not ok then return H.fail('admin_console_error') end
    if done ~= true then return H.fail(why or 'err_invalid_value') end
    Log.write(actor, 'player_action', 'Set level', tostring(math.floor(n)), { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)

--- An XP boost for a while (w_level /xpboost): the player must be in the game, it is a timer there.
Registry.invoke('xpBoost', 'xp.boost', function(actor, args)
    local cid, ref = citizenOf(args)
    if not cid then return H.fail('player_not_found') end
    local lv = level()
    if not lv then return H.fail('not_supported_here') end
    local mult, minutes = tonumber(args.multiplier), tonumber(args.minutes)
    if not mult or not minutes or mult <= 1 or mult > 10 or minutes <= 0 or minutes > 1440 then return H.fail('err_invalid_value') end
    local ok, done, why = pcall(function() return lv:AdminCitizen(cid, 'boost', mult, math.floor(minutes * 60), actor.label) end)
    if not ok then return H.fail('admin_console_error') end
    if done ~= true then return H.fail(why or 'err_invalid_value') end
    Log.write(actor, 'player_action', 'XP boost', ('x%s for %d min'):format(tostring(mult), math.floor(minutes)),
        { name = ref.username, identifier = ref.identifier })
    return H.ok()
end)
