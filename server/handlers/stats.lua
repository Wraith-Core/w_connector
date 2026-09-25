--- Overview and Statistics.
---
--- Two things worth knowing before reading this.
---
--- `hasData` is load-bearing. `readArr()` in StatisticsTab.tsx returns an empty array whenever a
--- result carries `hasData` and it is falsy, so omitting the flag on a populated result renders an
--- empty chart. Every metric read below sets it explicitly.
---
--- CPU and memory are read cross-platform. w_admin read them with `io.popen('wmic ...')`, which
--- exists only on Windows — so on the Linux boxes most RedM servers run on, those two numbers were
--- always blank. Here Linux reads /proc, Windows keeps wmic, and anything else reports nil rather
--- than zero, because "unknown" and "idle" are very different things to show an owner.

local startTime = os.time()

-- ---------------------------------------------------------------------------
--  Host metrics
-- ---------------------------------------------------------------------------

local Host = { cpu = nil, ram = nil, lastCpu = nil }

local function readFile(path)
    local f = io.open(path, 'r')
    if not f then return nil end
    local content = f:read('*a')
    f:close()
    return content
end

local function sampleLinux()
    local stat = readFile('/proc/stat')
    if stat then
        local line = stat:match('^cpu%s+([^\n]+)')
        if line then
            local vals = {}
            for n in line:gmatch('%d+') do vals[#vals + 1] = tonumber(n) end
            if #vals >= 4 then
                local idle = vals[4] + (vals[5] or 0)
                local total = 0
                for _, v in ipairs(vals) do total = total + v end
                local prev = Host.lastCpu
                if prev and total > prev.total then
                    local busy = (total - prev.total) - (idle - prev.idle)
                    Host.cpu = math.floor((busy / (total - prev.total)) * 100 + 0.5)
                end
                Host.lastCpu = { total = total, idle = idle }
            end
        end
    end

    local mem = readFile('/proc/meminfo')
    if mem then
        local total = tonumber(mem:match('MemTotal:%s+(%d+)'))
        local avail = tonumber(mem:match('MemAvailable:%s+(%d+)'))
        if total and avail and total > 0 then
            Host.ram = math.floor(((total - avail) / total) * 100 + 0.5)
        end
    end
end

local function sampleWindows()
    local ok, pipe = pcall(io.popen, 'wmic cpu get loadpercentage /value')
    if ok and pipe then
        local out = pipe:read('*a'); pipe:close()
        Host.cpu = tonumber((out or ''):match('LoadPercentage=(%d+)'))
    end
    local ok2, pipe2 = pcall(io.popen, 'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value')
    if ok2 and pipe2 then
        local out = pipe2:read('*a'); pipe2:close()
        local free = tonumber((out or ''):match('FreePhysicalMemory=(%d+)'))
        local total = tonumber((out or ''):match('TotalVisibleMemorySize=(%d+)'))
        if free and total and total > 0 then
            Host.ram = math.floor(((total - free) / total) * 100 + 0.5)
        end
    end
end

local IS_WINDOWS = (os.getenv('OS') or ''):find('Windows') ~= nil

CreateThread(function()
    Wait(5000)
    while true do
        local ok, err = pcall(IS_WINDOWS and sampleWindows or sampleLinux)
        if not ok then
            -- One failure is enough to know this host will not answer; stop asking every 15s.
            print('^3[w_connector]^0 host metrics unavailable on this platform (' .. tostring(err) .. ').')
            return
        end
        Wait(15000)
    end
end)

-- ---------------------------------------------------------------------------
--  Player-count sampling
-- ---------------------------------------------------------------------------

local bucket = { sum = 0, samples = 0, peak = 0 }

local function flushHourly()
    if bucket.samples == 0 then return end
    local stamp = os.date('%Y-%m-%d %H:00:00')
    MySQL.insert.await(
        'INSERT INTO `wc_metrics_hourly` (`bucket`,`avg_players`,`peak_players`,`samples`) VALUES (?,?,?,?) ' ..
        'ON DUPLICATE KEY UPDATE `avg_players` = VALUES(`avg_players`), `peak_players` = ' ..
        'GREATEST(`peak_players`, VALUES(`peak_players`)), `samples` = VALUES(`samples`)',
        { stamp, bucket.sum / bucket.samples, bucket.peak, bucket.samples })
    bucket = { sum = 0, samples = 0, peak = 0 }
    MySQL.update.await('DELETE FROM `wc_metrics_hourly` WHERE `bucket` < DATE_SUB(NOW(), INTERVAL 48 HOUR)')
end

local function flushDaily()
    local day = os.date('%Y-%m-%d')
    local row = MySQL.single.await(
        'SELECT AVG(`avg_players`) AS avg_p, MAX(`peak_players`) AS peak_p FROM `wc_metrics_hourly` ' ..
        'WHERE DATE(`bucket`) = CURDATE()')
    local money, gold = Vorp.totalMoney()
    MySQL.insert.await(
        'INSERT INTO `wc_metrics_daily` (`day`,`avg_players`,`peak_players`,`total_money`,`total_gold`,`total_characters`) ' ..
        'VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `avg_players`=VALUES(`avg_players`), ' ..
        '`peak_players`=GREATEST(`peak_players`,VALUES(`peak_players`)), `total_money`=VALUES(`total_money`), ' ..
        '`total_gold`=VALUES(`total_gold`), `total_characters`=VALUES(`total_characters`)',
        { day, tonumber(row and row.avg_p) or 0, tonumber(row and row.peak_p) or 0,
          money, gold, Vorp.countCharacters() })
end

CreateThread(function()
    Schema.await()
    -- One immediate daily row so the Statistics tab is not empty on the day a server is installed.
    Wait(60000)
    pcall(flushDaily)

    local lastHour = tonumber(os.date('%H'))
    while true do
        local n = Players.onlineCount()
        bucket.sum = bucket.sum + n
        bucket.samples = bucket.samples + 1
        if n > bucket.peak then bucket.peak = n end

        local hour = tonumber(os.date('%H'))
        if hour ~= lastHour then
            lastHour = hour
            pcall(flushHourly)
            pcall(flushDaily)
        end
        Wait(60000)
    end
end)

-- ---------------------------------------------------------------------------
--  Reads
-- ---------------------------------------------------------------------------

local function uptimeString()
    local secs = os.time() - startTime
    local d = math.floor(secs / 86400)
    local h = math.floor((secs % 86400) / 3600)
    local m = math.floor((secs % 3600) / 60)
    if d > 0 then return ('%dd %dh %dm'):format(d, h, m) end
    if h > 0 then return ('%dh %dm'):format(h, m) end
    return ('%dm'):format(m)
end

local function averagePing()
    local online = Players.online()
    if #online == 0 then return 0 end
    local total = 0
    for _, sid in ipairs(online) do total = total + (GetPlayerPing(sid) or 0) end
    return math.floor(total / #online)
end

Registry.invoke('getDashboardData', Registry.OPEN, function()
    local money = Vorp.totalMoney()
    return {
        onlineUsers = Players.onlineCount(),
        totalUsers = Vorp.countAccounts(),
        totalCharacters = Vorp.countCharacters(),
        totalMoney = money,
        uptimeString = uptimeString(),
    }
end)

Registry.invoke('adminpanel:getServerStats', 'view.statistics', function()
    return {
        cpuPercent = Host.cpu,
        ramUsage = Host.ram,
        avgPing = averagePing(),
        uptime = uptimeString(),
        players = Players.onlineCount(),
        maxPlayers = GetConvarInt('sv_maxclients', 32),
    }
end)

Registry.invoke('adminpanel:getPerformanceMetrics', 'view.statistics', function()
    local rows = MySQL.query.await(
        'SELECT `bucket`, `avg_players`, `peak_players` FROM `wc_metrics_hourly` ' ..
        'WHERE `bucket` >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY `bucket` ASC') or {}
    local history = {}
    for _, r in ipairs(rows) do
        history[#history + 1] = {
            time = tostring(r.bucket):sub(12, 16),
            players = math.floor(tonumber(r.avg_players) or 0),
            peak = tonumber(r.peak_players) or 0,
        }
    end
    -- This one has no `hasData` gate in the panel, so an empty history renders an empty chart
    -- rather than a broken one.
    return { history = history, cpuPercent = Host.cpu, ramUsage = Host.ram }
end)

Registry.invoke('adminpanel:getPlayerActivityMetrics', 'view.statistics', function(actor, args)
    local days = H.clamp(type(args) == 'table' and args.days or nil, 1, 90, 14)
    local rows = MySQL.query.await(
        'SELECT `day`, `avg_players`, `peak_players` FROM `wc_metrics_daily` ' ..
        'WHERE `day` >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY `day` ASC', { days }) or {}
    local data = {}
    for _, r in ipairs(rows) do
        data[#data + 1] = {
            day = tostring(r.day),
            average = math.floor((tonumber(r.avg_players) or 0) + 0.5),
            peak = tonumber(r.peak_players) or 0,
        }
    end
    return { hasData = #data > 0, data = data }
end)

Registry.invoke('adminpanel:getEconomyMetrics', 'view.statistics', function(actor, args)
    local days = H.clamp(type(args) == 'table' and args.days or nil, 1, 90, 14)
    local rows = MySQL.query.await(
        'SELECT `day`, `total_money`, `total_gold` FROM `wc_metrics_daily` ' ..
        'WHERE `day` >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY `day` ASC', { days }) or {}
    local data = {}
    for _, r in ipairs(rows) do
        data[#data + 1] = { date = tostring(r.day), money = tonumber(r.total_money) or 0,
                            gold = tonumber(r.total_gold) or 0 }
    end
    return { hasData = #data > 0, data = data }
end)

--- A stable colour per job, so the pie chart does not reshuffle its palette on every poll.
local PALETTE = { '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
                  '#14b8a6', '#eab308', '#8b5cf6', '#06b6d4' }

Registry.invoke('adminpanel:getJobDistribution', 'view.statistics', function()
    -- ! CoreBridge.select, not `characters`. That table is VORP's; on a citizenid host this read
    --   failed outright and the chart came back empty. The projection is a whole SELECT, so it
    --   goes in parentheses under an alias — and it is framework-aware, so one query serves both.
    local rows = MySQL.query.await(
        'SELECT COALESCE(NULLIF(`joblabel`, \'\'), `job`, \'Unemployed\') AS name, COUNT(*) AS n ' ..
        'FROM (' .. CoreBridge.select .. ') c GROUP BY name ORDER BY n DESC LIMIT 10') or {}
    local total = 0
    for _, r in ipairs(rows) do total = total + (tonumber(r.n) or 0) end
    local jobs = {}
    for i, r in ipairs(rows) do
        local count = tonumber(r.n) or 0
        jobs[#jobs + 1] = {
            name = r.name,
            count = count,
            value = total > 0 and math.floor((count / total) * 100 + 0.5) or 0,
            color = PALETTE[((i - 1) % #PALETTE) + 1],
        }
    end
    return { hasData = #jobs > 0, jobs = jobs, total = total }
end)

--- The Overview leaderboard.
---
--- `playtime` comes from `wc_playtime`, which this resource fills itself — VORP records no playtime
--- at all, so before this the panel's default sort ordered by a column that did not exist.
local SORTABLE = {
    playtime = 'playtime', money = 'money', gold = 'gold', level = 'xp', xp = 'xp',
}

Registry.invoke('adminpanel:getTopPlayersLeaderboard', Registry.OPEN, function(actor, args)
    args = type(args) == 'table' and args or {}
    local limit = H.clamp(args.limit, 1, 50, 10)
    -- Whitelisted, then interpolated. The value arrives over HTTP and lands in an ORDER BY, where a
    -- bound parameter is not allowed.
    local column = SORTABLE[tostring(args.sortBy or 'playtime')] or 'playtime'

    -- ! Same substitution as the job chart. wc_playtime.char_id holds whatever charidentifier the
    --   projection exposes — players.id here, VORP's own column there — so the join keeps working.
    local rows = MySQL.query.await(
        ('SELECT c.`charidentifier`, c.`identifier`, c.`firstname`, c.`lastname`, c.`nickname`, ' ..
         'c.`job`, c.`joblabel`, c.`money`, c.`gold`, c.`xp`, COALESCE(p.`seconds`, 0) AS `playtime` ' ..
         'FROM (' .. CoreBridge.select .. ') c LEFT JOIN `wc_playtime` p ON p.`char_id` = c.`charidentifier` ' ..
         'ORDER BY `%s` DESC LIMIT ?'):format(column), { limit }) or {}

    local players = {}
    for i, r in ipairs(rows) do
        local name = ((r.firstname or '') .. ' ' .. (r.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')
        local av = Players.avatars[r.identifier or ''] or {}
        players[#players + 1] = {
            rank = i,
            characterName = (name ~= '' and name) or r.nickname or 'Unknown',
            username = r.nickname or '',
            job = r.job,
            jobLabel = r.joblabel or r.job,
            playtime = tonumber(r.playtime) or 0,
            money = tonumber(r.money) or 0,
            gold = tonumber(r.gold) or 0,
            level = tonumber(r.xp) or 0,
            avatar = av.avatar_url or '',
        }
    end
    return { hasData = #players > 0, players = players }
end)
