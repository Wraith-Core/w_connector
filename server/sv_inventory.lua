--- Inventory access — vorp_inventory for online players, direct SQL for offline ones.
---
--- Every vorp_inventory export is CALLBACK based: `getUserInventoryItems(source, cb)`,
--- `canCarryItem(source, item, amount, cb)`, and so on. Treating one of them as if it returned a
--- value is how w_admin ended up with a carry check that always answered "cannot carry" — the
--- comment in its framework shim records the bug without recording the cause.
---
--- So every call here goes through `awaitCb`, which turns the callback into a value AND applies a
--- timeout. The timeout is the part that matters: this runs on the bridge thread, and an export
--- that never invokes its callback (a stopped inventory resource, an item name that trips an early
--- return) would otherwise park the poll loop forever and take the whole panel offline.

Inv = {}

--- Wait for an inventory export's answer, accepting it from EITHER delivery channel.
---
--- Stock vorp_inventory answers only through the callback. Wraith's own `w_inventory` routes every
--- export through this instead:
---
---     local function respond(cb, ...)
---         if type(cb) == 'function' then cb(...) end
---         return ...
---     end
---
--- which is the exact mirror of the cross-boundary bug this resource was itself just fixed for. A
--- callback handed to another resource arrives there as a callable REFERENCE, not a Lua function, so
--- `type(cb) == 'function'` is FALSE and the callback is NEVER invoked. Waiting only on the callback
--- therefore waits out the whole timeout and concludes the bag is empty — which is exactly what the
--- panel reported for players who were visibly carrying things.
---
--- But `respond` also RETURNS the value, so the answer is already in hand the moment the call
--- returns. Hence: ONE call, and whichever channel answers first settles it.
---
--- One call, emphatically — not a direct attempt followed by a callback retry. A retry would run the
--- export twice, and for `addItem` that means handing the player the item twice. `settled` makes the
--- first answer the only answer no matter how many channels deliver one.
--- Returns the answer AND which channel produced it, so the resource can say in the console which
--- kind of inventory it is talking to instead of leaving that to be inferred from symptoms.
local function awaitCb(timeoutMs, invoke)
    local p = promise.new()
    local settled = false
    local channel
    local function settle(via, v)
        if settled then return end
        settled, channel = true, via
        p:resolve(v)
    end
    local ok, direct = pcall(invoke, function(v) settle('callback', v) end)
    if not ok then
        settle('error', nil)
    elseif direct ~= nil then
        settle('direct', direct)  -- the export answered outright; no callback is coming
    end
    SetTimeout(timeoutMs or 5000, function() settle('timeout', nil) end)
    local value = Citizen.Await(p)
    return value, channel
end

--- Which resource actually answers the inventory API, discovered rather than assumed.
---
--- The old check was `GetResourceState('vorp_inventory') == 'started'`, and it is why the panel drew
--- an empty bag on a server that plainly had one. Wraith's own `w_inventory` declares
--- `provide 'vorp_inventory'` in its manifest — so the NAME `vorp_inventory` is virtual: nothing is
--- started under it, `GetResourceState` answers "missing", and the check concluded there was no
--- inventory at all. Meanwhile `w_inventory` exports every function this file needs
--- (getUserInventoryItems, addItem, subItem, canCarryItem, createWeapon, subWeapon, getItemDB …).
---
--- So: probe each candidate for a function that must exist, and use the first that answers. That
--- covers stock vorp_inventory, w_inventory, and anything else providing the same API — including a
--- name nobody here has heard of, via the convar.
local CANDIDATES = {
    GetConvar('w_connector_inventory', ''), -- an explicit override always wins
    'vorp_inventory',
    'w_inventory',
}

local resolved = nil   -- the resource name that answered, or false once every candidate has failed
local warned = false

--- The library's own inventory bridge (exports.w_lib:Inv*): it already speaks to w_inventory,
--- vorp_inventory, rsg-inventory and qbr-inventory, so when it is up nothing here has to know the
--- VORP callback API. On Wraith Core it is the only channel: w_inventory registers the VORP-named
--- exports only when the core itself is VORP.
local libBridge = nil
local function viaLibrary()
    if libBridge ~= nil then return libBridge end
    local ok, name = pcall(function() return exports.w_lib:InvName() end)
    libBridge = ok and type(name) == 'string' and name ~= '' and name or false
    return libBridge
end

--- A dialect host (Wraith Core) keeps the catalogue in the library, not in an `items` table.
--- ! Two proofs, because the first one failing is not the same as the table existing. If w_lib is
---   a moment late, CompatStatus answers nothing and the read below would fall onto SQL that can
---   only fail on this host. The bag settles it: `items` is vorp_inventory's table and no other
---   inventory has one, so any other named bag means the catalogue is hosted. An unknown bag name
---   still falls through to the old behaviour rather than guessing.
local function hostedCatalogue()
    local ok, status = pcall(function() return exports.w_lib:CompatStatus() end)
    if ok and type(status) == 'table' and status.inboundAliases ~= nil then return true end
    local okName, bag = pcall(function() return exports.w_lib:InvName() end)
    return okName and type(bag) == 'string' and bag ~= '' and bag ~= 'vorp_inventory'
end

local function logMissing()
    if warned or viaLibrary() then return end
    warned = true
    print('^3[w_connector]^0 no inventory resource answered the VORP inventory API — inventories will '
        .. 'be read straight from the database. Giving and removing items needs a live inventory and '
        .. 'those actions will say so. Set w_connector_inventory "<resource>" if yours uses another name.')
end

--- Does this resource expose the inventory API? Non-nil, not merely reachable: indexing a missing
--- export succeeds and yields nil, so a bare pcall proves nothing.
local function answers(name)
    if not name or name == '' then return false end
    local ok, fn = pcall(function() return exports[name].getUserInventoryItems end)
    return ok and fn ~= nil
end

local function available()
    if resolved ~= nil then return resolved ~= false end
    if viaLibrary() then
        resolved = viaLibrary()
        return true
    end
    for _, name in ipairs(CANDIDATES) do
        if answers(name) then
            resolved = name
            -- print(('^2[w_connector]^0 inventory API resolved to `%s`.'):format(name))
            return true
        end
    end
    resolved = false
    logMissing()
    return false
end

--- The resolved resource, for the call sites. Falls back to the stock name so a call made before
--- resolution still targets something sensible rather than nil.
local function inv()
    return (resolved and resolved ~= false) and resolved or 'vorp_inventory'
end

Inv.available = available
Inv.resourceName = inv

-- ---------------------------------------------------------------------------
--  Online
-- ---------------------------------------------------------------------------

--- Each thunk below RETURNS the export's own return value, which is what lets `awaitCb` settle from
--- the direct channel when the inventory resource answers that way. Returning nil means "no direct
--- answer" and leaves the callback (or the timeout) to decide. The normalisation applied to a
--- direct value is deliberately identical to the one applied inside the callback, so the two
--- channels cannot disagree about what counts as success.

--- Say once, in the console, how this server's inventory actually replies.
---
--- Which channel answers is the single fact that decided whether the panel showed a bag or showed
--- nothing, and until now it was invisible — the symptom was an empty list either way. One line at
--- the first read turns the next report into an answer instead of another round of guessing.
local channelLogged = false
local function reportChannel(via)
    if channelLogged or not via then return end
    channelLogged = true
    if via == 'direct' then
        -- print(('^2[w_connector]^0 `%s` replies by returning values directly — reading bags that way.')
            -- :format(inv()))
    elseif via == 'callback' then
        -- print(('^2[w_connector]^0 `%s` replies through callbacks — reading bags that way.'):format(inv()))
    else
        print(('^3[w_connector]^0 `%s` did not answer the first inventory read (%s). Bags will be read '
            .. 'from the database instead.'):format(inv(), tostring(via)))
    end
end

function Inv.items(src)
    if not available() then return {} end
    if viaLibrary() then
        local ok, rows = pcall(function() return exports.w_lib:InvGetItems(tonumber(src)) end)
        local out = {}
        for _, r in ipairs(ok and rows or {}) do
            if not tostring(r.name or ''):upper():find('^WEAPON_') then out[#out + 1] = r end
        end
        return out
    end
    local rows, via = awaitCb(5000, function(done)
        return exports[inv()]:getUserInventoryItems(tonumber(src), function(items) done(items) end)
    end)
    reportChannel(via)
    return type(rows) == 'table' and rows or {}
end

function Inv.weapons(src)
    if not available() then return {} end
    if viaLibrary() then
        -- weapons are items of the bag (WEAPON_*); the slot stands in for VORP's weapon id
        local ok, rows = pcall(function() return exports.w_lib:InvGetItems(tonumber(src)) end)
        local out = {}
        for _, r in ipairs(ok and rows or {}) do
            if tostring(r.name or ''):upper():find('^WEAPON_') then
                out[#out + 1] = { name = r.name, label = r.label, weight = r.weight, id = r.slot,
                    custom_label = r.metadata and r.metadata.label or nil }
            end
        end
        return out
    end
    local rows = awaitCb(5000, function(done)
        return exports[inv()]:getUserInventoryWeapons(tonumber(src), function(w) done(w) end)
    end)
    return type(rows) == 'table' and rows or {}
end

function Inv.canCarry(src, itemName, amount)
    -- No export means no carry check. Allowing the add is the right default: the alternative is
    -- refusing every give on a server whose inventory we simply cannot interrogate.
    if not available() then return true end
    if viaLibrary() then
        local ok, can = pcall(function() return exports.w_lib:InvCanCarry(tonumber(src), itemName, tonumber(amount) or 1) end)
        return ok and can == true
    end
    local ok = awaitCb(5000, function(done)
        return exports[inv()]:canCarryItem(tonumber(src), itemName, tonumber(amount) or 1, function(can) done(can) end)
    end)
    return ok == true
end

function Inv.addItem(src, itemName, amount, metadata)
    if not available() then return false, 'inventory_export_unavailable' end
    if viaLibrary() then
        local ok, done = pcall(function() return exports.w_lib:InvAddItem(tonumber(src), itemName, tonumber(amount) or 1, metadata) end)
        return ok and done == true
    end
    local res = awaitCb(5000, function(done)
        local direct = exports[inv()]:addItem(tonumber(src), itemName, tonumber(amount) or 1, metadata or {},
            function(r) done(r ~= false) end)
        if direct ~= nil then return direct ~= false end
        return nil
    end)
    -- A nil here means neither channel answered, which is not the same as a refusal — but from the
    -- caller's point of view an unconfirmed add must be reported as a failure, or the website tells
    -- a customer their purchase arrived when nobody knows whether it did.
    return res == true
end

function Inv.removeItem(src, itemName, amount, metadata)
    if not available() then return false, 'inventory_export_unavailable' end
    if viaLibrary() then
        local ok, done = pcall(function() return exports.w_lib:InvRemoveItem(tonumber(src), itemName, tonumber(amount) or 1, metadata) end)
        return ok and done == true
    end
    local res = awaitCb(5000, function(done)
        local direct = exports[inv()]:subItem(tonumber(src), itemName, tonumber(amount) or 1, metadata or {},
            function(r) done(r ~= false) end)
        if direct ~= nil then return direct ~= false end
        return nil
    end)
    return res == true
end

--- Create a NEW weapon and place it in the player's inventory.
---
--- `createWeapon`, not `giveWeapon`. They sound interchangeable and are not: `giveWeapon(source,
--- weaponId, target, callback)` TRANSFERS a weapon that already exists, identified by its numeric
--- id — passing it a weapon NAME asks it to move a weapon whose id is a string, which finds
--- nothing. `createWeapon(source, weaponName, ammo, components, comps, callback, ...)` is the one
--- that mints a weapon from a name, which is what "give this player a rifle" means.
--- See docs.vorp-core.com/api-reference/inventory.
function Inv.giveWeapon(src, weaponName)
    if not available() then return false, 'inventory_export_unavailable' end
    if viaLibrary() then
        local ok, done = pcall(function() return exports.w_lib:InvAddItem(tonumber(src), weaponName, 1) end)
        if not ok then return false, 'inventory_no_response' end
        return done == true, (done ~= true) and 'inventory_refused' or nil
    end
    local res = awaitCb(6000, function(done)
        local direct = exports[inv()]:createWeapon(tonumber(src), weaponName, '', {}, {},
            function(r) done(r ~= false) end)
        if direct ~= nil then return direct ~= false end
        return nil
    end)
    if res == nil then return false, 'inventory_no_response' end
    return res == true, (res ~= true) and 'inventory_refused' or nil
end

function Inv.removeWeapon(src, weaponId)
    if not available() then return false, 'inventory_export_unavailable' end
    if viaLibrary() then
        -- the id handed out by Inv.weapons is the bag slot
        local ok, slot = pcall(function() return exports.w_lib:InvGetSlot(tonumber(src), tonumber(weaponId)) end)
        if not ok or type(slot) ~= 'table' or not slot.name then return false end
        local ok2, done = pcall(function() return exports.w_lib:InvRemoveItem(tonumber(src), slot.name, 1, nil, tonumber(weaponId)) end)
        return ok2 and done == true
    end
    local res = awaitCb(5000, function(done)
        local direct = exports[inv()]:subWeapon(tonumber(src), tonumber(weaponId), function(r) done(r ~= false) end)
        if direct ~= nil then return direct ~= false end
        return nil
    end)
    return res == true
end

--- Everything a player is carrying, in the flat shape the Players tab renders:
--- `{ name, label, count, weight, type }`, weapons forced to a count of 1.
---
--- Falls back to reading the tables directly when the export is unavailable OR returns nothing.
--- The panel showing an empty inventory for a player who is visibly carrying things is worse than
--- useless — it looks like the player has nothing, rather than like the panel cannot see. The
--- database is the same source vorp_inventory itself persists to, so the answer is the same one;
--- only the route differs. `charId` lets that fallback work, and is why it is a parameter.
function Inv.contents(src, charId)
    local viaExport = Inv.itemsAndWeapons(src)
    if #viaExport > 0 then return viaExport end
    if charId then
        local fromDb = Inv.offlineContents(charId)
        if #fromDb > 0 then return fromDb end
    end
    return viaExport
end

--- The export-backed read, kept separate so `contents` can decide whether it produced anything.
function Inv.itemsAndWeapons(src)
    local out = {}
    for _, it in ipairs(Inv.items(src)) do
        out[#out + 1] = {
            name   = it.name or it.item,
            label  = it.label or it.name or it.item,
            count  = tonumber(it.count or it.amount) or 0,
            weight = tonumber(it.weight) or 0,
            type   = 'item',
            id     = it.id,
        }
    end
    for _, w in ipairs(Inv.weapons(src)) do
        out[#out + 1] = {
            name   = w.name or w.item,
            label  = w.custom_label or w.label or w.name,
            count  = 1,
            weight = tonumber(w.weight) or 0,
            type   = 'weapon',
            id     = w.id or w.weaponId,
        }
    end
    return out
end

-- ---------------------------------------------------------------------------
--  Offline — read the bag straight out of the database
--
--  There are TWO schemas here, because the two inventories persist completely differently:
--
--    stock vorp_inventory
--      character_inventories(character_id, item_name, amount, inventory_type, ...)
--      loadout(id, charidentifier, name, label, custom_label, ammo, ...)
--
--    w_inventory
--      the entire bag is ONE JSON blob in `characters`.`inventory` — a list of slots
--      { slot, name, count, metadata } keyed by charidentifier. Its own `w_inventory`
--      table holds stashes, trunks and containers, NOT player bags.
--
--  Reading the wrong pair is why this fallback came back as empty as the export did: a server
--  running w_inventory has no `character_inventories` table at all, so there was nothing to find.
--  Try both, and let whichever one this server actually keeps answer.
-- ---------------------------------------------------------------------------

--- Which of the two schemas is present. Cached because it cannot change while the server is up, and
--- asked rather than assumed because querying a missing table raises instead of returning nothing.
local tableSeen = {}
local function tableExists(name)
    if tableSeen[name] == nil then
        local ok, n = pcall(MySQL.scalar.await,
            'SELECT COUNT(*) FROM `information_schema`.`tables` ' ..
            'WHERE `table_schema` = DATABASE() AND `table_name` = ?', { name })
        tableSeen[name] = ok and (tonumber(n) or 0) > 0
    end
    return tableSeen[name]
end

--- A readable label for an item name, taken from the catalogue already in memory.
---
--- The JSON blob stores names and counts only, so without this every offline row would render as
--- its raw id. Built on first use and only once the catalogue is loaded — indexing it earlier would
--- cache an empty index for the rest of the session.
local labelIndex = nil
local function labelFor(name)
    if not labelIndex and Inv.catalogue.loaded then
        labelIndex = {}
        for _, c in ipairs(Inv.catalogue.items or {}) do labelIndex[c.name] = c.label end
        for _, c in ipairs(Inv.catalogue.weapons or {}) do labelIndex[c.name] = c.label end
    end
    return (labelIndex and labelIndex[name]) or name
end

--- stock vorp_inventory's two tables.
local function stockContents(charId)
    local out = {}

    local items = MySQL.query.await(
        'SELECT ci.`item_name`, ci.`amount`, i.`label`, i.`weight` ' ..
        'FROM `character_inventories` ci LEFT JOIN `items` i ON i.`item` = ci.`item_name` ' ..
        'WHERE ci.`character_id` = ? AND ci.`amount` > 0', { charId }) or {}
    for _, r in ipairs(items) do
        out[#out + 1] = {
            name   = r.item_name,
            label  = r.label or r.item_name,
            count  = tonumber(r.amount) or 0,
            weight = tonumber(r.weight) or 0,
            type   = 'item',
        }
    end

    if tableExists('loadout') then
        local weapons = MySQL.query.await(
            'SELECT `id`, `name`, `label`, `custom_label`, `ammo` FROM `loadout` WHERE `charidentifier` = ?',
            { charId }) or {}
        for _, r in ipairs(weapons) do
            out[#out + 1] = {
                name   = r.name,
                label  = r.custom_label or r.label or r.name,
                count  = 1,
                weight = 0,
                type   = 'weapon',
                id     = r.id,
            }
        end
    end

    return out
end

--- w_inventory's single JSON blob on the character row.
---
--- Weapons are not a separate store here — they are ordinary slots whose name begins with
--- `WEAPON_`, which is the same test w_inventory itself applies when VORP asks it for a weapon
--- list. They are forced to a count of 1 so the panel renders them the way it renders the online
--- list rather than showing a stack size.
local function blobContents(charId)
    -- ! `characters` is VORP's own table and a Wraith Core / RSG / QBR host has none, so this read
    --   could only ever fail there. tableExists is already cached per name (see above), so asking
    --   costs one query for the lifetime of the resource and the offline panel comes back empty
    --   instead of logging a failure every time an admin opens it.
    if not tableExists('characters') then return {} end
    local ok, raw = pcall(MySQL.scalar.await,
        'SELECT `inventory` FROM `characters` WHERE `charidentifier` = ?', { charId })
    if not ok or type(raw) ~= 'string' or raw == '' then return {} end

    local decoded
    ok, decoded = pcall(json.decode, raw)
    if not ok or type(decoded) ~= 'table' then return {} end

    local out = {}
    for _, slot in pairs(decoded) do
        if type(slot) == 'table' and type(slot.name) == 'string' then
            local isWeapon = slot.name:sub(1, 7) == 'WEAPON_'
            local count = tonumber(slot.count) or 0
            if isWeapon or count > 0 then
                out[#out + 1] = {
                    name   = slot.name,
                    label  = labelFor(slot.name),
                    count  = isWeapon and 1 or count,
                    weight = tonumber(slot.weight) or 0,
                    type   = isWeapon and 'weapon' or 'item',
                    id     = slot.slot,
                }
            end
        end
    end
    return out
end

function Inv.offlineContents(charId)
    charId = tonumber(charId)
    if not charId then return {} end

    if tableExists('character_inventories') then
        local out = stockContents(charId)
        if #out > 0 then return out end
    end

    return blobContents(charId)
end

--- Offline writes, on BOTH schemas.
---
--- These used to refuse outright unless the stock `character_inventories` table existed, on the
--- grounds that w_inventory holds the bag in memory and would overwrite anything written behind its
--- back. That reasoning is right for an ONLINE player and wrong for an offline one — and offline is
--- the only case these run in. Every caller reaches them exactly when `live` is nil (see
--- handlers/players.lua), so w_inventory is not holding that character's bag at all: it loads it
--- from this same row the next time they connect.
---
--- w_inventory stores the whole bag as one JSON array on the character row, in the shape its own
--- serialiser writes: one entry per slot, `{ name, count, slot, metadata? }`.
local function schemaIsStock()
    return tableExists('character_inventories')
end

--- Read the blob, let the caller mutate the slot list, write it back if they changed anything.
local function blobMutate(charId, mutate)
    -- ! Same gate as blobContents: no `characters` table, no blob to mutate. Returning false is
    --   what the callers already treat as "the write did not happen", so the panel says so
    --   plainly rather than reporting success over a query that never ran.
    if not tableExists('characters') then return false end
    local ok, raw = pcall(MySQL.scalar.await,
        'SELECT `inventory` FROM `characters` WHERE `charidentifier` = ?', { charId })
    if not ok then return false end

    local slots = {}
    if type(raw) == 'string' and raw ~= '' then
        local okd, decoded = pcall(json.decode, raw)
        if okd and type(decoded) == 'table' then slots = decoded end
    end

    if not mutate(slots) then return false end

    -- Re-packed into a DENSE array, dropping anything emptied. json.encode turns a table with holes
    -- into an object rather than a list, and handing w_inventory an object where it expects a list
    -- would give the player back a bag it cannot read.
    local packed, n = {}, 0
    for _, slot in pairs(slots) do
        if type(slot) == 'table' and slot.name and (tonumber(slot.count) or 0) > 0 then
            n = n + 1
            packed[n] = slot
        end
    end

    local rows = MySQL.update.await(
        'UPDATE `characters` SET `inventory` = ? WHERE `charidentifier` = ?',
        { json.encode(packed), charId })
    return (tonumber(rows) or 0) > 0
end

--- The lowest slot number nothing occupies. Reusing a taken one would silently replace an item.
local function freeSlot(slots)
    local used = {}
    for _, s in pairs(slots) do
        local n = tonumber(type(s) == 'table' and s.slot or nil)
        if n then used[n] = true end
    end
    local i = 1
    while used[i] do i = i + 1 end
    return i
end

function Inv.offlineAddItem(charId, itemName, amount)
    charId, amount = tonumber(charId), tonumber(amount) or 1
    if not charId or amount <= 0 then return false end

    if not schemaIsStock() then
        return blobMutate(charId, function(slots)
            -- Stack onto a plain slot of the same item. Slots carrying metadata are left alone: that
            -- metadata is what makes a particular one distinct (durability, a serial number), and
            -- merging into it would apply it to the new items too.
            for _, s in pairs(slots) do
                if type(s) == 'table' and s.name == itemName and s.metadata == nil then
                    s.count = (tonumber(s.count) or 0) + amount
                    return true
                end
            end
            slots[#slots + 1] = { name = itemName, count = amount, slot = freeSlot(slots) }
            return true
        end)
    end

    local existing = MySQL.single.await(
        'SELECT `id`, `amount` FROM `character_inventories` WHERE `character_id` = ? AND `item_name` = ? LIMIT 1',
        { charId, itemName })
    if existing then
        MySQL.update.await('UPDATE `character_inventories` SET `amount` = `amount` + ? WHERE `id` = ?',
            { amount, existing.id })
    else
        MySQL.insert.await(
            'INSERT INTO `character_inventories` (`character_id`,`item_name`,`amount`,`inventory_type`) VALUES (?,?,?,?)',
            { charId, itemName, amount, 'default' })
    end
    return true
end

function Inv.offlineRemoveItem(charId, itemName, amount)
    charId, amount = tonumber(charId), tonumber(amount) or 1
    if not charId or amount <= 0 then return false end

    if not schemaIsStock() then
        return blobMutate(charId, function(slots)
            local left, took = amount, 0
            for _, s in pairs(slots) do
                if left <= 0 then break end
                if type(s) == 'table' and s.name == itemName then
                    local have = tonumber(s.count) or 0
                    local take = math.min(have, left)
                    s.count = have - take  -- emptied slots are dropped when the list is re-packed
                    left, took = left - take, took + take
                end
            end
            return took > 0
        end)
    end

    -- GREATEST clamps at zero so a removal larger than the stack cannot leave a negative count
    -- that then reads back as a phantom item.
    local n = MySQL.update.await(
        'UPDATE `character_inventories` SET `amount` = GREATEST(0, `amount` - ?) ' ..
        'WHERE `character_id` = ? AND `item_name` = ?', { amount, charId, itemName })
    MySQL.update.await('DELETE FROM `character_inventories` WHERE `character_id` = ? AND `item_name` = ? AND `amount` <= 0',
        { charId, itemName })
    return (tonumber(n) or 0) > 0
end

function Inv.offlineRemoveWeapon(charId, weaponId)
    charId, weaponId = tonumber(charId), tonumber(weaponId)
    if not charId or not weaponId then return false end

    if not schemaIsStock() then
        -- w_inventory has no weapons table: a weapon IS a slot, and the id the panel holds is that
        -- slot number (its compat layer reports `id = slot.slot`).
        return blobMutate(charId, function(slots)
            for _, s in pairs(slots) do
                if type(s) == 'table' and tonumber(s.slot) == weaponId then
                    s.count = 0
                    return true
                end
            end
            return false
        end)
    end

    local n = MySQL.update.await('DELETE FROM `loadout` WHERE `id` = ? AND `charidentifier` = ?',
        { weaponId, charId })
    return (tonumber(n) or 0) > 0
end

function Inv.offlineAddWeapon(charId, identifier, weaponName, label)
    charId = tonumber(charId)
    if not charId or not weaponName or weaponName == '' then return false end

    if not schemaIsStock() then
        -- Upper-cased because w_inventory matches weapon names that way (see its createWeapon).
        local name = tostring(weaponName):upper()
        return blobMutate(charId, function(slots)
            slots[#slots + 1] = { name = name, count = 1, slot = freeSlot(slots) }
            return true
        end)
    end

    local id = MySQL.insert.await(
        'INSERT INTO `loadout` (`identifier`,`charidentifier`,`name`,`ammo`,`components`,`comps`,`label`) ' ..
        'VALUES (?,?,?,?,?,?,?)',
        { identifier or '', charId, weaponName, json.encode({}), json.encode({}), json.encode({}), label or weaponName })
    return id ~= nil
end

-- ---------------------------------------------------------------------------
--  The item catalogue
-- ---------------------------------------------------------------------------

Inv.catalogue = { items = {}, weapons = {}, loaded = false }

--- Weapon definitions, read out of the inventory resource's own data file.
---
--- Weapons are NOT rows in the `items` table on a VORP server — that table holds consumables and
--- props, which is why the catalogue reported "1076 items, 0 weapons" and the weapon picker had
--- nothing in it. The definitions live in a Lua data file inside the inventory resource.
---
--- `getWeaponsDefaultData` would be the tidy route, but that export is registered on the CLIENT, and
--- this is server code. `LoadResourceFile` reads any started resource's files from the server.
---
--- THE TWO INVENTORIES DO NOT AGREE ON THE SHAPE, and assuming one of them is what produced
--- "no weapon definitions found" on a server running stock vorp_inventory:
---
---   w_inventory     data/weapons_RDR3.lua   `return { Weapons = { WEAPON_X = { label=, weight=, desc= } } }`
---   vorp_inventory  config/weapons.lua      assigns a GLOBAL — `SHARED_DATA.WEAPONS = { WEAPON_X =
---                                           { Name=, Weight=, Desc= } }` — and returns NOTHING
---
--- The loader only ever inspected the return value, so against stock it found the file, executed it
--- without error, saw no return, and reported the catalogue empty. It now looks at what the chunk
--- LEFT BEHIND as well as what it handed back, and accepts either field casing.
local WEAPON_DATA_FILES = {
    GetConvar('w_connector_weapons_file', ''), -- an explicit override always wins
    'data/weapons_RDR3.lua',
    'data/weapons.lua',
    'config/weapons.lua',
    'shared/weapons.lua',
}

--- The sandbox these data files are executed in.
---
--- Deliberately not the real global table: a config file has no business reaching the game, the
--- database or the filesystem, and handing it a private table means it cannot. It is no longer
--- EMPTY, though — stock's file uses `pairs` and a `<const>` local, and an empty environment made it
--- fail for the wrong reason. Everything here is pure computation; none of it can cause an effect.
local function sandbox()
    return {
        pairs = pairs, ipairs = ipairs, next = next, select = select,
        type = type, tonumber = tonumber, tostring = tostring,
        string = string, table = table, math = math,
    }
end

--- Where a file might have left its weapon table: handed back, or written to a global we can see.
local function definitionsIn(env, returned)
    local roots = {}
    if type(returned) == 'table' then roots[#roots + 1] = returned end
    if type(env.SHARED_DATA) == 'table' then roots[#roots + 1] = env.SHARED_DATA end
    if type(env.Config) == 'table' then roots[#roots + 1] = env.Config end
    roots[#roots + 1] = env
    for _, root in ipairs(roots) do
        local defs = root.WEAPONS or root.Weapons or root.weapons
        if type(defs) == 'table' and next(defs) ~= nil then return defs end
    end
    return nil
end

local function loadWeaponDefinitions(resource)
    if not resource or resource == '' then return {} end
    for _, file in ipairs(WEAPON_DATA_FILES) do
        if file ~= '' then
            local raw = LoadResourceFile(resource, file)
            if raw and raw ~= '' then
                local env = sandbox()
                local chunk = load(raw, '@' .. file, 't', env)
                if chunk then
                    local ok, returned = pcall(chunk)
                    local defs = ok and definitionsIn(env, returned) or nil
                    if type(defs) == 'table' then
                        local out = {}
                        for name, def in pairs(defs) do
                            if type(def) == 'table' then
                                out[#out + 1] = {
                                    name = name, item = name,
                                    -- w_inventory spells these lowercase, stock vorp_inventory
                                    -- capitalises them. Accept both rather than pick a side.
                                    label = def.label or def.Name or def.name or name,
                                    weight = tonumber(def.weight or def.Weight) or 0,
                                    limit = -1,
                                    description = def.desc or def.description or def.Desc or '',
                                    ammoName = def.ammoname or def.AmmoName,
                                    type = 'weapon',
                                }
                            end
                        end
                        if #out > 0 then
                            table.sort(out, function(a, b) return (a.label or '') < (b.label or '') end)
                            return out, file
                        end
                    end
                end
            end
        end
    end
    return {}
end

--- Read the items table in pages.
---
--- One `SELECT * FROM items` returned 1076 rows and made oxmysql log an oversized-result warning.
--- The rows are wanted — the picker searches them — but arriving in one lump is what oxmysql
--- objects to, so they arrive in pages instead. Same data, no warning, and a server with a very
--- large catalogue no longer builds one enormous result set.
local ITEM_PAGE = 500

local function loadItemRows()
    local all, offset = {}, 0
    while true do
        local page = MySQL.query.await(
            'SELECT `item`, `label`, `weight`, `limit`, `desc` FROM `items` LIMIT ? OFFSET ?',
            { ITEM_PAGE, offset }) or {}
        for _, r in ipairs(page) do all[#all + 1] = r end
        if #page < ITEM_PAGE then break end
        offset = offset + ITEM_PAGE
        -- A malformed table should not spin here forever.
        if offset > 100000 then break end
    end
    return all
end

--- Loaded once into memory because the item picker pages through it on every keystroke, and neither
--- the items table nor the weapon definitions change while the server is up.
function Inv.loadCatalogue()
    if hostedCatalogue() then
        -- Wraith Core: the library owns the catalogue (RSG-shaped rows, weapons included)
        local items, weapons = {}, {}
        local rows = exports.w_lib:CompatItems() or {}
        for name, r in pairs(rows) do
            local row = {
                name = name, item = name, label = r.label or name,
                weight = tonumber(r.weight) or 0, limit = -1,
                description = r.description or '',
                type = r.type == 'weapon' and 'weapon' or 'item',
            }
            if row.type == 'weapon' then weapons[#weapons + 1] = row else items[#items + 1] = row end
        end
        table.sort(items, function(a, b) return a.name < b.name end)
        table.sort(weapons, function(a, b) return a.name < b.name end)
        Inv.catalogue = { items = items, weapons = weapons, loaded = true }
        return
    end

    local rows = loadItemRows()
    local items = {}
    for _, r in ipairs(rows) do
        items[#items + 1] = {
            name = r.item, item = r.item, label = r.label or r.item,
            weight = tonumber(r.weight) or 0, limit = tonumber(r.limit) or -1,
            description = r.desc or '',
            type = 'item',
        }
    end

    local weapons, fromFile = loadWeaponDefinitions(Inv.resourceName())

    Inv.catalogue = { items = items, weapons = weapons, loaded = true }
    -- print(('^2[w_connector]^0 catalogue loaded — %d items, %d weapons%s.')
        -- :format(#items, #weapons, fromFile and (' (from ' .. fromFile .. ')') or ''))
    if #weapons == 0 then
        -- Naming the resource and the paths actually tried, because the old wording told an operator
        -- what weapons are NOT (rows in `items`) without telling them anything they could act on.
        local tried = {}
        for _, f in ipairs(WEAPON_DATA_FILES) do
            if f ~= '' then tried[#tried + 1] = f end
        end
        print(('^3[w_connector]^0 no weapon definitions found in `%s` — the weapon picker will be '
            .. 'empty. Looked for: %s. If your inventory keeps them elsewhere, point at it with '
            .. 'set w_connector_weapons_file "<path inside that resource>".')
            :format(Inv.resourceName(), table.concat(tried, ', ')))
    end
end

CreateThread(function()
    Schema.await()
    -- Long enough for every inventory resource to have started and registered its exports; probing
    -- before that resolves to nothing and caches the miss for the rest of the session.
    Wait(4000)
    -- Resolve FIRST. The weapon definitions are read out of the inventory resource's own folder, and
    -- until this runs `Inv.resourceName()` answers with the stock fallback — a name that on this
    -- server is virtual and owns no files.
    Inv.available()
    local ok, err = pcall(Inv.loadCatalogue)
    if not ok then
        print('^3[w_connector]^0 could not build the item catalogue (' .. tostring(err) .. '). Pickers will be empty.')
    end
end)
