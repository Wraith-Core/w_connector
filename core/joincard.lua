-- ════════════════════════════════════════════════════════════════════════════
-- The connecting screen's messages (2026-11-04, the owner: "make them look good").
--
-- RedM's "Connection failed" dialog renders a deferral's final reason as HTML: tags DIV SPAN STRONG EM B P UL OL LI
-- BR H1-H6 IMG, attributes class/title/alt/src/href/style (citizen/ui.zip, ALLOWED_TAGS + ATTRIBUTE_MAPPER), and
-- every "\n" becomes <br> first. Its block is left-to-right, so Arabic mixed with Latin words (Discord, Steam)
-- came out scrambled. JoinCard.render draws one right-to-left card for a refusal; JoinCard.line keeps a progress
-- line (deferrals.update, shown as plain text) in reading order with Unicode isolates.
-- The same file lives in w_core, w_connector and w_guard (none of them depends on another): keep them equal.
-- ════════════════════════════════════════════════════════════════════════════

JoinCard = {}

local RLI, PDI = '\u{2067}', '\u{2069}'
local TONES = { error = '#e0564a', ban = '#d13b3b', closed = '#e0a23a', info = '#5aa9e6' }
local ICONS = { error = '⚠️', ban = '⛔', closed = '🔒', info = 'ℹ️' }

local function isArabic(s)
    return type(s) == 'string' and s:find('[\216-\219][\128-\191]') ~= nil
end

local function esc(s)
    s = tostring(s or '')
    return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;'))
end

--- A progress line (plain text on the connecting screen): each Arabic line isolated right-to-left.
function JoinCard.line(text)
    text = tostring(text or '')
    if not isArabic(text) then return text end
    local out = {}
    for part in (text .. '\n'):gmatch('(.-)\n') do out[#out + 1] = part ~= '' and (RLI .. part .. PDI) or '' end
    return table.concat(out, '\n')
end

--- A refusal card. c = { tone = 'error'|'ban'|'closed'|'info', title, body = { text, ... } | text,
---   facts = { { label, value, code = bool }, ... }, stepsTitle, steps = { text, ... }, note }
--- -> one line of HTML (no "\n" of its own: the dialog turns each into <br>)
function JoinCard.render(c)
    c = type(c) == 'table' and c or { body = c }
    local rtl = c.rtl
    if rtl == nil then rtl = isArabic(c.title) or isArabic(type(c.body) == 'table' and c.body[1] or c.body) end
    local side = rtl and 'right' or 'left'
    local accent = TONES[c.tone] or TONES.error
    local h = {}
    h[#h + 1] = ('<div style="direction:%s;text-align:%s;margin:18px 0 8px;padding:16px 20px 14px;border-radius:10px;'
        .. 'background:rgba(255,255,255,0.05);border-%s:4px solid %s;line-height:1.85;font-size:16px;color:#e6e6e6">')
        :format(rtl and 'rtl' or 'ltr', side, side, accent)
    if c.title and c.title ~= '' then
        h[#h + 1] = ('<div style="font-size:21px;font-weight:700;color:#ffffff;margin-bottom:6px">%s %s</div>')
            :format(ICONS[c.tone] or ICONS.error, esc(c.title))
    end
    local body = type(c.body) == 'table' and c.body or { c.body }
    for _, text in ipairs(body) do
        if text and text ~= '' then h[#h + 1] = ('<div style="color:#d2d2d2">%s</div>'):format(esc(text)) end
    end
    if type(c.facts) == 'table' and #c.facts > 0 then
        h[#h + 1] = '<div style="margin-top:10px">'
        for _, f in ipairs(c.facts) do
            local value = f.code
                and ('<span style="direction:ltr;unicode-bidi:isolate;font-family:Consolas,monospace;background:rgba(255,255,255,0.10);'
                    .. 'padding:1px 8px;border-radius:5px;color:#ffffff">%s</span>'):format(esc(f[2]))
                -- plaintext: a date reads left to right, an Arabic reason right to left
                or ('<strong style="color:#ffffff;unicode-bidi:plaintext">%s</strong>'):format(esc(f[2]))
            h[#h + 1] = ('<div><span style="color:#9c9c9c">%s:</span> %s</div>'):format(esc(f[1]), value)
        end
        h[#h + 1] = '</div>'
    end
    if type(c.steps) == 'table' and #c.steps > 0 then
        if c.stepsTitle then
            h[#h + 1] = ('<div style="margin-top:12px;font-weight:700;color:%s">%s</div>'):format(accent, esc(c.stepsTitle))
        end
        h[#h + 1] = ('<ol style="margin:4px 0 0;padding-%s:24px;padding-%s:0">'):format(side, rtl and 'left' or 'right')
        for _, s in ipairs(c.steps) do h[#h + 1] = ('<li style="margin:2px 0">%s</li>'):format(esc(s)) end
        h[#h + 1] = '</ol>'
    end
    if c.note and c.note ~= '' then
        h[#h + 1] = ('<div style="margin-top:12px;font-size:13px;color:#9c9c9c">%s</div>'):format(esc(c.note))
    end
    h[#h + 1] = '</div>'
    return (table.concat(h):gsub('\r?\n', '<br>'))
end
