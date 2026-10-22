--- The Resources tab.

--- Stopping or restarting these takes the panel offline with them, which reads as "the button
--- broke the server". Refusing is more useful than obeying.
local PROTECTED = {
    [GetCurrentResourceName()] = true,
    oxmysql = true, vorp_core = true, sessionmanager = true,
    ['sessionmanager-rdr3'] = true, hardcap = true, spawnmanager = true,
    -- the server's own core (2026-10-22): stopping one of these from the site takes the server down
    -- with it (every script depends on w_lib / w_core / w_inventory; w_guard and w_deploy guard it)
    w_lib = true, w_core = true, w_inventory = true, w_centralbank = true, w_guard = true,
    w_deploy = true, ['pma-voice'] = true,
}

Registry.invoke('GetResourceLookupData', Registry.OPEN, function()
    local resources = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            local deps = {}
            local n = 0
            -- No count native for metadata, so walk until it runs out.
            while true do
                local dep = GetResourceMetadata(name, 'dependency', n)
                if not dep then break end
                deps[#deps + 1] = dep
                n = n + 1
            end
            resources[#resources + 1] = {
                name = name,
                displayName = GetResourceMetadata(name, 'name', 0) or name,
                status = GetResourceState(name),
                version = GetResourceMetadata(name, 'version', 0) or '',
                author = GetResourceMetadata(name, 'author', 0) or '',
                description = GetResourceMetadata(name, 'description', 0) or '',
                dependencies = deps,
                commands = {},
                protected = PROTECTED[name] or false,
            }
        end
    end
    table.sort(resources, function(a, b) return a.name < b.name end)
    return { resources = resources }
end)

local function act(actor, args)
    args = type(args) == 'table' and args or {}
    local name = H.str(args.resourceName or args.resource, 128)
    local action = H.str(args.action, 16)
    if name == '' then return H.fail('missing_resource') end
    if PROTECTED[name] then return H.fail('resource_is_protected') end
    if GetResourceState(name) == 'missing' then return H.fail('resource_not_found') end

    if action == 'start' then
        StartResource(name)
    elseif action == 'stop' then
        StopResource(name)
    elseif action == 'restart' then
        StopResource(name)
        Wait(500)
        StartResource(name)
    else
        return H.fail('invalid_action')
    end

    Log.write(actor, 'server_event', ('Resource %s'):format(action), name, { severity = 'medium' })
    return H.ok()
end

Registry.invoke('resourceAction', 'resource.action', act)

--- The panel has shipped two names for this since w_admin had two live handlers for it. Both are
--- kept so neither version of the page breaks.
Registry.invoke('adminpanel:server:resourceAction', 'resource.action', act)
