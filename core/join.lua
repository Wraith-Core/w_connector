--- The join check and the entry queue.
---
--- On `playerConnecting` the player is held (deferrals) while the website decides: bans, the closed server,
--- the join mode (2.2.3: open / staff only / Discord member / Discord roles / approved players, set on the
--- panel's Entry tab), and the player's queue priority. When the server is full, players wait here in order
--- of priority, then arrival, until a slot opens.
---
--- 2.2.4: in the 'waitApproval' mode a newcomer is not refused: they wait here (request id on the card) while
--- staff approve or deny the request on the panel, at most `wraith_join_wait_minutes` (15).
---
--- When the website can't be reached the player is let in, unless `set wraith_join_fail_closed "true"`:
--- a ban list that locks everyone out whenever the internet blips would be worse than the bans.

local joinText = {
    ar = {
        unavailable = 'تعذر التحقق من صلاحية دخولك الآن. حاول مجددًا بعد قليل.',
        checking = 'جارٍ التحقق من صلاحية دخولك…',
        denied = 'لا يمكنك دخول السيرفر. راجع الإدارة لمعرفة السبب.',
        queued = 'السيرفر ممتلئ. ترتيبك %d من %d في قائمة الانتظار. انتظر؛ سيدخلك السيرفر تلقائيًا عند توفر مكان.',
        closed = 'حاول الدخول لاحقًا، وتابع الإعلانات في الديسكورد.',
        banned = 'أنت محظور من هذا السيرفر. السبب: %s (رقم الحظر %s).',
        banned_until = 'أنت محظور من هذا السيرفر حتى %s بتوقيت UTC. السبب: %s (رقم الحظر %s).',
        whitelist = 'هذا السيرفر للقائمة المسموحة فقط، واسمك ليس فيها. راجع الإدارة.',
        -- 2.2.3: the join modes
        allowlist = 'هذا السيرفر لمن وافقت عليهم الإدارة فقط، ولم تتم الموافقة عليك بعد.',
        request_id = 'رقم طلبك: %s — أعطه للإدارة لتوافق عليك.',
        admins = 'السيرفر للإدارة فقط الآن (صيانة). حاول الدخول لاحقًا.',
        discord_missing = 'هذا السيرفر يتحقق من حساب الديسكورد. اربط ديسكورد مع ريد إم: افتح تطبيق ديسكورد على الكمبيوتر، ثم أعد تشغيل ريد إم وحاول مجددًا.',
        discord_member = 'يجب أن تكون عضوًا في سيرفر الديسكورد لتدخل. انضم إليه ثم حاول مجددًا.',
        discord_roles = 'ليست لديك رتبة الديسكورد المطلوبة لدخول هذا السيرفر.',
        discord_unavailable = 'تعذر التحقق من حساب الديسكورد الآن. حاول مجددًا بعد قليل.',
        -- 2.2.4: waiting for approval on the connecting screen
        waiting = 'بانتظار موافقة الإدارة. رقم طلبك: %s\nابقَ في هذه الشاشة، وستدخل السيرفر تلقائيًا عند الموافقة. (مضى %s)',
        wait_denied = 'رفضت الإدارة طلب دخولك.',
        wait_timeout = 'لم ترد الإدارة على طلبك (رقم %s) بعد. حاول الدخول لاحقًا.',
        -- 2.4.4: the connecting screen's cards (core/joincard.lua): a title per refusal, the facts' labels
        t_unavailable = 'تعذّر التحقق الآن',
        t_denied = 'لا يمكنك الدخول',
        t_closed = 'السيرفر مغلق الآن',
        t_banned = 'أنت محظور من هذا السيرفر',
        t_whitelist = 'الدخول لقائمة خاصة',
        t_allowlist = 'لم تتم الموافقة عليك بعد',
        t_admins = 'السيرفر في صيانة',
        t_discord_missing = 'لم نجد حساب الديسكورد',
        t_discord_member = 'انضم إلى الديسكورد أولًا',
        t_discord_roles = 'تنقصك رتبة في الديسكورد',
        t_discord_unavailable = 'تعذّر التحقق من الديسكورد',
        t_wait_denied = 'رُفض طلب دخولك',
        t_wait_timeout = 'انتهى وقت الانتظار',
        t_closing = 'السيرفر يُغلق الآن',
        f_reason = 'السبب',
        f_until = 'ينتهي الحظر',
        f_forever = 'حظر دائم',
        f_ban = 'رقم الحظر',
        f_request = 'رقم طلبك',
        ban_note = 'للاعتراض، تواصل مع الإدارة في الديسكورد واذكر رقم الحظر.',
        request_note = 'أعطِ رقم طلبك للإدارة لتوافق عليك.',
    },
    en = {
        unavailable = 'Access could not be checked. Please try again shortly.',
        checking = 'Checking your access…',
        denied = 'You cannot join this server. Contact staff for the reason.',
        queued = 'The server is full. You are %d of %d in the queue. Please wait; you will join automatically when a slot opens.',
        closed = 'Please try again later, and follow the news on our Discord.',
        banned = 'You are banned from this server. Reason: %s (ban #%s).',
        banned_until = 'You are banned from this server until %s UTC. Reason: %s (ban #%s).',
        whitelist = 'This server is whitelisted, and you are not on the list. Contact staff.',
        -- 2.2.3: the join modes
        allowlist = 'This server is for approved players only, and you are not approved yet.',
        request_id = 'Your request ID: %s — give it to staff so they can approve you.',
        admins = 'The server is open to staff only right now (maintenance). Please try again later.',
        discord_missing = 'This server checks your Discord account. Link Discord with RedM: open the Discord desktop app, then restart RedM and try again.',
        discord_member = 'You must be a member of our Discord server to join. Join it, then try again.',
        discord_roles = 'You do not have the Discord role this server requires.',
        discord_unavailable = 'Your Discord account could not be checked right now. Please try again shortly.',
        -- 2.2.4: waiting for approval on the connecting screen
        waiting = 'Waiting for staff approval. Your request ID: %s\nStay on this screen; you will join automatically once approved. (%s so far)',
        wait_denied = 'Staff denied your join request.',
        wait_timeout = 'Staff have not answered your request (%s) yet. Please try again later.',
        -- 2.4.4: the connecting screen's cards (core/joincard.lua): a title per refusal, the facts' labels
        t_unavailable = 'Access could not be checked',
        t_denied = 'You cannot join',
        t_closed = 'The server is closed',
        t_banned = 'You are banned from this server',
        t_whitelist = 'Whitelisted server',
        t_allowlist = 'Not approved yet',
        t_admins = 'Maintenance',
        t_discord_missing = 'Discord account not found',
        t_discord_member = 'Join our Discord first',
        t_discord_roles = 'Discord role missing',
        t_discord_unavailable = 'Discord could not be checked',
        t_wait_denied = 'Join request denied',
        t_wait_timeout = 'The wait timed out',
        t_closing = 'The server is closing',
        f_reason = 'Reason',
        f_until = 'Ban ends',
        f_forever = 'Permanent',
        f_ban = 'Ban number',
        f_request = 'Request ID',
        ban_note = 'To appeal, contact the staff on Discord and give your ban number.',
        request_note = 'Give your request ID to the staff so they can approve you.',
    },
}
local function joinMessage(key, ...)
    local lang = GetConvar('w_lib:locale', 'ar') == 'ar' and 'ar' or 'en'
    return joinText[lang][key]:format(...)
end

-- 2.4.4: a refusal is one card on the "Connection failed" dialog (RedM draws it as HTML; the plain text read
-- scrambled: Arabic mixed with Discord / Steam in a left-to-right block). Progress lines stay text (JoinCard.line).
local TONES = { closed = 'closed', admins = 'closed', closing = 'closed', allowlist = 'info', wait_timeout = 'info',
    banned = 'ban', wait_denied = 'ban' }
local function card(key, body, facts, note)
    return JoinCard.render({ tone = TONES[key] or 'error', title = joinMessage('t_' .. key), body = body, facts = facts, note = note })
end
local function say(key, ...) return card(key, joinMessage(key, ...)) end
local function banCard(reason, untilText, id)
    return card('banned', nil, {
        { joinMessage('f_reason'), (reason and reason ~= '') and reason or '-' },
        { joinMessage('f_until'), untilText or joinMessage('f_forever') },
        { joinMessage('f_ban'), tostring(id or '-'), code = true },
    }, joinMessage('ban_note'))
end
local queue = {} -- { src, prio, at }

local function failClosed() return GetConvar('wraith_join_fail_closed', 'false') == 'true' end

-- 2.2.0: a server closed from the website or /closeserver stays closed while the website cannot be reached
-- (core/closed.lua keeps the last value); staff with the 'wraithadmin.join' ACE still come in.
local function closedLocally(src)
    return WC.Closed and WC.Closed.value == true and not IsPlayerAceAllowed(src, 'wraithadmin.join')
end

-- 2.2.0: the website's own bans, kept on disk from the last ban sync (core/bans.lua): an outage lets nobody banned in
local function bannedLocally(src)
    if not WC.Bans then return nil end
    local b = WC.Bans.cached(WC.identifiers(src))
    if not b then return nil end
    local id = tostring(b.id or '-')
    return banCard(b.reason, b['until'] and (os.date('!%Y-%m-%d %H:%M', b['until']) .. ' UTC') or nil, id)
end

-- 2.2.3: the join mode refusals; `instructions` (the panel's text, 500 characters at most) follows the reason
local MODE_REFUSALS = { allowlist = true, admins = true, discord_missing = true, discord_member = true, discord_roles = true, discord_unavailable = true }
local REQUEST_ID = '^R[1-9A-HJ-NP-Z][1-9A-HJ-NP-Z][1-9A-HJ-NP-Z][1-9A-HJ-NP-Z]$'

local function instructionsOf(body)
    local text = type(body.instructions) == 'string' and body.instructions:gsub('^%s+', ''):gsub('%s+$', '') or ''
    local ok, cut = pcall(utf8.offset, text, 501) -- by characters, so an Arabic letter is never cut in half
    if ok and cut then text = text:sub(1, cut - 1) end
    return text
end

local function modeRefusal(body)
    local lines, facts, note = { joinMessage(body.reason) }, nil, nil
    if body.reason == 'allowlist' and type(body.requestId) == 'string' and body.requestId:match(REQUEST_ID) then
        facts, note = { { joinMessage('f_request'), body.requestId, code = true } }, joinMessage('request_note')
    end
    local text = instructionsOf(body)
    if text ~= '' then lines[#lines + 1] = text end
    return card(body.reason, lines, facts, note)
end

--- The website's refusal in the player's language (2.2.0: it sends a reason code; older sites only English text).
local function refusal(body)
    if body.reason == 'banned' then
        local reason = type(body.banReason) == 'string' and body.banReason:sub(1, 200) or '-'
        local id = tostring(math.tointeger(tonumber(body.banId)) or '-')
        return banCard(reason, type(body['until']) == 'string' and (body['until']:sub(1, 20) .. ' UTC') or nil, id)
    end
    if body.reason == 'closed' then
        local text = type(body.closedMessage) == 'string' and body.closedMessage ~= '' and body.closedMessage:sub(1, 300)
        return card('closed', text or joinMessage('closed'))
    end
    if body.reason == 'whitelist' then return say('whitelist') end
    if MODE_REFUSALS[body.reason] then return modeRefusal(body) end
    return card('denied', type(body.message) == 'string' and body.message:sub(1, 500) or joinMessage('denied'))
end

-- 2.2.4: the 'waitApproval' join mode. The player stays on the connecting screen while staff decide on the panel;
-- the website is asked every few seconds. Returns the queue priority once approved, or nil when the player was sent
-- away (denied, timed out, server closing) or left. A website that cannot be reached keeps the player waiting.
local WAIT_POLL_MS = 5000

local function waitForApproval(src, deferrals, reqId, instructions)
    local limit = math.max(1, GetConvarInt('wraith_join_wait_minutes', 15)) * 60000
    local started = GetGameTimer()
    while true do
        if GetPlayerName(src) == nil then return nil end
        if WC.Host and WC.Host.shuttingDown then deferrals.done(card('closing', WC.Host.say('closing'))) return nil end
        local elapsed = GetGameTimer() - started
        if elapsed >= limit then deferrals.done(say('wait_timeout', reqId)) return nil end
        local sec = elapsed // 1000
        local text = joinMessage('waiting', reqId, ('%d:%02d'):format(sec // 60, sec % 60))
        deferrals.update(JoinCard.line(instructions ~= '' and (text .. '\n' .. instructions) or text))
        Wait(WAIT_POLL_MS)
        if GetPlayerName(src) == nil then return nil end
        local status, body = WC.request('POST', '/join/wait', { requestId = reqId, identifiers = WC.identifiers(src) })
        if status == 200 and type(body) == 'table' then
            if body.status == 'approved' then return math.tointeger(tonumber(body.priority)) or 0 end
            if body.status == 'denied' then deferrals.done(say('wait_denied')) return nil end
        end
    end
end

local function slotsFree()
    return GetNumPlayerIndices() < GetConvarInt('sv_maxclients', 32)
end

local function position(src)
    table.sort(queue, function(a, b) if a.prio ~= b.prio then return a.prio > b.prio end return a.at < b.at end)
    for i, e in ipairs(queue) do if e.src == src then return i end end
    return nil
end

local function leave(src)
    for i, e in ipairs(queue) do if e.src == src then table.remove(queue, i) return end end
end

function WC.queueSize() return #queue end

AddEventHandler('playerConnecting', function(name, _, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    -- 2.2.0: the host agent announced a shutdown (core/host.lua): nobody new comes in
    if WC.Host and WC.Host.shuttingDown then return deferrals.done(card('closing', WC.Host.say('closing'))) end
    -- (Not `a and done(x) or done()`: done returns nothing, so that form calls done twice.)
    if not WC.linked() then
        local banned = bannedLocally(src)
        if banned then return deferrals.done(banned) end
        if closedLocally(src) then return deferrals.done(say('closed')) end
        if failClosed() then return deferrals.done(say('unavailable')) end
        return deferrals.done()
    end

    deferrals.update(JoinCard.line(joinMessage('checking')))
    local status, body = WC.request('POST', '/join', { name = tostring(name or ''):sub(1, 64), identifiers = WC.identifiers(src) })
    if status ~= 200 or type(body) ~= 'table' then
        local banned = bannedLocally(src)
        if banned then return deferrals.done(banned) end
        if closedLocally(src) then return deferrals.done(say('closed')) end
        if failClosed() then return deferrals.done(say('unavailable')) end
        return deferrals.done()
    end
    local priority = math.tointeger(tonumber(body.priority)) or 0
    if body.allow == false then
        if body.reason ~= 'allowlist_wait' or type(body.requestId) ~= 'string' or not body.requestId:match(REQUEST_ID) then
            return deferrals.done(refusal(body))
        end
        local approved = waitForApproval(src, deferrals, body.requestId, instructionsOf(body))
        if not approved then return end
        priority = approved
    end

    if slotsFree() and #queue == 0 then return deferrals.done() end

    -- Full: wait in line. A player who closes the game leaves the line (GetPlayerName answers nil).
    queue[#queue + 1] = { src = src, prio = priority, at = GetGameTimer() }
    while true do
        if GetPlayerName(src) == nil then leave(src) return end
        local pos = position(src)
        if pos == 1 and slotsFree() then
            leave(src)
            return deferrals.done()
        end
        deferrals.update(JoinCard.line(joinMessage('queued', pos or 0, #queue)))
        Wait(2000)
    end
end)
