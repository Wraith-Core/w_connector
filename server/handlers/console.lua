--- The in-game console's own pages that need no admin in the world, from the website (2026-10-22, one
--- admin system): the pause menu's news and the world's cycle (frozen time, fixed weather, blackout).
---
--- They run w_admin's code itself (exports.w_admin:SiteRun), so both panels do exactly the same and
--- w_admin's log names the website's staff member (that line reaches wc_logs through GameLog). The
--- registry already checked the node.

local function console(kind, payload, actor)
    if GetResourceState('w_admin') ~= 'started' then return H.fail('not_supported_here') end
    local ok, res = pcall(function() return exports.w_admin:SiteRun(kind, payload, actor.label or 'Web Admin') end)
    if not ok or type(res) ~= 'table' then return H.fail('admin_console_error') end
    if not res.ok then
        local out = H.fail(res.error or 'admin_console_error')
        out.data = res.data
        return out
    end
    return { success = true, message = res.msg, data = res.data }
end

-- ── the pause menu's news (w_admin sv_news.lua: the whole list, in carousel order) ───────────────

Registry.invoke('getNews', 'console.news', function(actor)
    return console('news', { action = 'newsList' }, actor)
end)

--- { list, rev }: `rev` names the list the page read; a save over a list changed meanwhile is refused
--- (err_news_changed) with the fresh one in `data`.
Registry.invoke('saveNews', 'console.news', function(actor, args)
    args = type(args) == 'table' and args or {}
    if type(args.list) ~= 'table' then return H.fail('err_invalid_value') end
    return console('news', { action = 'newsSave', list = args.list, rev = args.rev }, actor)
end)

Registry.invoke('resetNews', 'console.news', function(actor, args)
    args = type(args) == 'table' and args or {}
    return console('news', { action = 'newsReset', rev = args.rev }, actor)
end)

-- ── the world's cycle (w_weathersync, through w_admin's world controls) ──────────────────────────

Registry.invoke('getWorldState', 'server.weather.control', function(actor)
    return console('server', { action = 'world' }, actor)
end)

local CYCLE = { freezeTime = true, dynamicWeather = true, blackout = true }

--- { what = 'freezeTime' | 'dynamicWeather' | 'blackout', state = true | false }
Registry.invoke('setWorldCycle', 'server.weather.control', function(actor, args)
    args = type(args) == 'table' and args or {}
    if not CYCLE[args.what] or type(args.state) ~= 'boolean' then return H.fail('err_invalid_value') end
    return console('server', { action = args.what, args = { state = args.state } }, actor)
end)
