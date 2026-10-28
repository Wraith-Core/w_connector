--- Inventory and money: everything here goes through the adapters picked for this server.

WC.Ops.define('inventory.get', 'inventory', function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local items, err = WC.Adapters.get('inventory').items(src)
    if not items then return false, err or 'no_character' end
    return true, items
end)

WC.Ops.define('inventory.add', 'inventory', function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local name, count = WC.itemName(args.item), WC.count(args.count, 10000)
    if not name or not count then return false, 'invalid_args' end
    local metadata = type(args.metadata) == 'table' and args.metadata or nil
    local inv = WC.Adapters.get('inventory')
    if not inv.canCarry(src, name, count) then return false, 'cannot_carry' end
    return inv.add(src, name, count, metadata)
end)

WC.Ops.define('inventory.remove', 'inventory', function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local name, count = WC.itemName(args.item), WC.count(args.count, 10000)
    if not name or not count then return false, 'invalid_args' end
    return WC.Adapters.get('inventory').remove(src, name, count)
end)

WC.Ops.define('items.catalog', 'inventory', function()
    return true, WC.Adapters.get('inventory').catalog()
end)

--- `amount` is signed: positive adds, negative removes. Removal never takes a balance below zero.
WC.Ops.define('money.adjust', 'framework', function(args)
    local src = WC.onlineSource(args.source)
    if not src then return false, 'player_offline' end
    local account = type(args.account) == 'string' and args.account or nil
    local amount = tonumber(args.amount)
    if not account or not account:match('^[%w_]+$') or not amount or amount ~= amount
        or amount == 0 or math.abs(amount) > 1e9 then
        return false, 'invalid_args'
    end
    local fw = WC.Adapters.get('framework')
    if amount > 0 then return fw.addMoney(src, account, amount) end
    return fw.removeMoney(src, account, -amount)
end)
