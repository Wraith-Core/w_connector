"""w_connector 1.1.5: one admin system with w_admin (2026-10-22), on the real Lua against a real MariaDB.

  * AddWarning (w_admin /warn) writes the website's wc_warnings and kicks at the threshold like the site's warn;
  * AddReport / AddReportReply (w_admin /report, /reportr) file the report and its answer in wc_reports;
    an answer written on the website reaches the reporter's chat;
  * GameLog (w_admin's log) lands in wc_logs and is not sent back; Log.write reaches w_admin's SiteLog.

Needs the local XAMPP MariaDB on 127.0.0.1:3306 (root, no password); w_connector_unify_test is made again for every
test. Run from the resource folder:  py -3 -I -m unittest discover -s tests
"""
import os
import re
import unittest

import lupa
import pymysql

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = 'w_connector_unify_test'
TABLES = ('wc_warnings', 'wc_reports', 'wc_report_messages', 'wc_logs')

STUBS = r'''
Config = { warnKickThreshold = 3, webhooks = {}, showIpAddress = false }
EXPORTS, SITE_LOG, CHAT, DROPPED, CLIENT, CONSOLE = {}, {}, {}, {}, {}, {}
exports = setmetatable({
  w_admin = {
    SiteLog = function(_, e) SITE_LOG[#SITE_LOG + 1] = e end,
    SitePlayerAction = function(_, verb, target, values)
      CONSOLE[#CONSOLE + 1] = { verb = verb, target = target, values = values }
      if verb == 'tpCoords' and not values.x then return { ok = false, error = 'err_invalid_coords' } end
      return { ok = true, msg = 'done' }
    end,
  },
}, { __call = function(_, name, fn) EXPORTS[name] = fn end })
function GetResourceState(name) return 'started' end
function GetCurrentResourceName() return 'w_connector' end
function AddEventHandler() end
function RegisterNetEvent() end
function SetTimeout() end
function CreateThread() end
function Wait() end
function PerformHttpRequest() end
function GetConvar(_, d) return d end
NAMES = { [4] = 'Saad', [9] = 'Fahad' }
LICENSES = { [4] = 'license:saad', [9] = 'license:fahad' }
function GetPlayerName(src) return NAMES[tonumber(src)] end
function GetPlayers() local out = {} for s in pairs(NAMES) do out[#out + 1] = tostring(s) end return out end
function GetPlayerIdentifierByType(src, kind) return LICENSES[tonumber(src)] end
function GetPlayerIdentifiers(src) return { LICENSES[tonumber(src)] } end
function DropPlayer(src, msg) DROPPED[#DROPPED + 1] = { src, msg } NAMES[src] = nil end
function TriggerClientEvent(name, src, data)
  if name == 'chat:addMessage' then CHAT[#CHAT + 1] = { src, data } else CLIENT[#CLIENT + 1] = { name, src, data } end
end
Vorp = { snapshot = function(src) if NAMES[src] then return { identifier = LICENSES[src], charId = src } end end,
         sourceOfChar = function() return nil end }
Players = { avatars = {}, get = function() return nil end }
H = {
  ok = function(m) return { success = true, message = m } end,
  fail = function(m) return { success = false, message = m } end,
  playerRef = function(a) local p = type(a) == 'table' and a.player or {} return { source = tonumber(p.source), username = p.username } end,
  liveSource = function(ref) if ref.source and NAMES[ref.source] then return ref.source end end,
  int = function(v, d) local n = tonumber(v) return n and math.floor(n) or d end,
  clamp = function(v, lo, hi, d) local n = tonumber(v) or d if n < lo then return lo elseif n > hi then return hi end return n end,
  str = function(v, n) if v == nil then return '' end v = tostring(v) if n and #v > n then v = v:sub(1, n) end return v end,
}
REG = {}
json = { encode = function(t) local parts = {} for k, v in pairs(t) do parts[#parts + 1] = k .. '=' .. tostring(v) end table.sort(parts) return table.concat(parts, ',') end }
Registry = setmetatable({}, { __index = function(_, kind) return function(name, node, fn) REG[name] = fn end end })
Log = Log or { write = function() end }
'''


def connect(db=None):
    return pymysql.connect(host='127.0.0.1', port=3306, user='root', password='', database=db,
                           charset='utf8mb4', autocommit=True, cursorclass=pymysql.cursors.DictCursor)


class OnePanel(unittest.TestCase):
    def setUp(self):
        c = connect()
        with c.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS {DB}')
            cur.execute(f'CREATE DATABASE {DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci')
        c.close()
        self.db = connect(DB)
        with open(os.path.join(ROOT, 'server', 'sv_schema.lua'), encoding='utf-8') as fh:
            schema = fh.read()
        with self.db.cursor() as cur:
            for sql in re.findall(r'\[\[(CREATE TABLE IF NOT EXISTS `(\w+)`.*?)\]\]', schema, re.S):
                if sql[1] in TABLES:
                    cur.execute(sql[0])
        L = self.L = lupa.LuaRuntime(unpack_returned_tuples=True)

        def params(p):
            return [p[i] for i in range(1, len(p) + 1)] if p is not None else []

        def run(sql, p):
            # oxmysql sends a missing trailing value (a nil at the end of the list) as NULL
            values = params(p)
            values += [None] * (sql.count('?') - len(values))
            cur = self.db.cursor()
            cur.execute(sql.replace('?', '%s'), values)
            return cur

        def rows(sql, p=None):
            return run(sql, p).fetchall() or []

        g = L.globals()
        g.py_query = lambda s, p=None: L.table_from([L.table_from(r) for r in rows(s, p)])
        g.py_single = lambda s, p=None: (lambda r: L.table_from(r[0]) if r else None)(rows(s, p))
        g.py_scalar = lambda s, p=None: (lambda r: list(r[0].values())[0] if r else None)(rows(s, p))
        g.py_insert = lambda s, p=None: run(s, p).lastrowid
        g.py_update = lambda s, p=None: run(s, p).rowcount
        L.execute(STUBS)
        L.execute('''
            MySQL = {
              query = { await = function(s, p) return py_query(s, p) end },
              single = { await = function(s, p) return py_single(s, p) end },
              scalar = { await = function(s, p) return py_scalar(s, p) end },
              insert = { await = function(s, p) return py_insert(s, p) end },
              update = { await = function(s, p) return py_update(s, p) end },
            }
        ''')
        for f in ('server/sv_log.lua', 'server/handlers/reports.lua', 'server/handlers/players.lua'):
            with open(os.path.join(ROOT, f), encoding='utf-8') as fh:
                L.execute(fh.read())

    def tearDown(self):
        self.db.close()

    def sql(self, q, *p):
        with self.db.cursor() as cur:
            cur.execute(q, p)
            return cur.fetchall()

    # -- warnings -----------------------------------------------------------------------------------------

    def test_an_in_game_warning_is_counted_with_the_site_ones(self):
        total, kicked = self.L.eval("EXPORTS.AddWarning(4, 'سب لاعب', 'Admin1')")
        self.assertEqual((total, kicked), (1, False))
        row = self.sql('SELECT player_identifier, reason, warned_by, severity FROM wc_warnings')[0]
        self.assertEqual(row, {'player_identifier': 'license:saad', 'reason': 'سب لاعب', 'warned_by': 'Admin1',
                               'severity': 'medium'})

    def test_the_third_warning_kicks_with_an_arabic_text(self):
        for _ in range(2):
            self.L.eval("EXPORTS.AddWarning(4, 'x', 'Admin1')")
        total, kicked = self.L.eval("EXPORTS.AddWarning(4, 'آخر تحذير', 'Admin1')")
        self.assertEqual((total, kicked), (3, True))
        dropped = self.L.eval('DROPPED[1]')
        self.assertEqual(dropped[1], 4)
        self.assertIn('آخر تحذير', dropped[2])
        self.assertIn('طُردت', dropped[2])

    def test_a_warning_needs_a_player_in_game_and_a_reason(self):
        self.assertEqual(self.L.eval("select(2, EXPORTS.AddWarning(77, 'x'))"), 'player_not_online')
        self.assertEqual(self.L.eval("select(2, EXPORTS.AddWarning(4, ''))"), 'missing_reason')

    # -- reports ------------------------------------------------------------------------------------------

    def test_an_in_game_report_reaches_the_site_list(self):
        rid = self.L.eval("EXPORTS.AddReport(4, 'لاعب يرمي الناس من الجسر')")
        self.assertTrue(rid)
        row = self.sql('SELECT title, report_type, status, reporter_identifier, reporter_username FROM wc_reports')[0]
        self.assertEqual(row['report_type'], 'player')
        self.assertEqual(row['status'], 'open')
        self.assertEqual(row['reporter_identifier'], 'license:saad')
        msgs = self.sql('SELECT sender_type, message FROM wc_report_messages WHERE report_id = %s', rid)
        self.assertEqual(msgs, [{'sender_type': 'player', 'message': 'لاعب يرمي الناس من الجسر'}])
        listed = self.L.eval("REG['adminpanel:getReports'](nil, {})")
        self.assertEqual(listed['totalReports'], 1)

    def test_a_long_report_title_is_cut_on_a_letter(self):
        self.L.eval("EXPORTS.AddReport(4, string.rep('ب', 80))")
        title = self.sql('SELECT title FROM wc_reports')[0]['title']
        self.assertEqual(title, 'ب' * 60 + '…')

    def test_the_in_game_answer_joins_the_open_report(self):
        rid = self.L.eval("EXPORTS.AddReport(4, 'help')")
        self.assertEqual(self.L.eval("EXPORTS.AddReportReply(4, 'جاي لك', 'Admin1')"), rid)
        msgs = self.sql('SELECT sender_type, sender_name, message FROM wc_report_messages ORDER BY id')
        self.assertEqual(msgs[-1], {'sender_type': 'admin', 'sender_name': 'Admin1', 'message': 'جاي لك'})
        # no open report: nothing is filed
        self.assertIsNone(self.L.eval("EXPORTS.AddReportReply(9, 'x', 'Admin1')"))

    def test_a_site_answer_reaches_the_reporter_chat(self):
        rid = self.L.eval("EXPORTS.AddReport(4, 'help')")
        out = self.L.eval("REG['adminpanel:addReportMessage']({ label = 'Web' }, { reportId = %d, message = 'تم' })" % rid)
        self.assertTrue(out['success'])
        self.assertEqual(self.L.eval('CHAT[1][1]'), 4)
        self.assertEqual(self.L.eval('CHAT[1][2].args[2]'), 'تم')

    # -- the website runs w_admin's own player actions -------------------------------------------------

    def test_teleport_and_needs_run_the_console_code(self):
        out = self.L.eval("REG.teleportCoords({ label = 'Web' }, { player = { source = 4 }, x = 2645.11, y = -1214.66 })")
        self.assertTrue(out['success'])
        self.assertEqual(self.L.eval('CONSOLE[1].verb'), 'tpCoords')
        self.assertEqual(self.L.eval('CONSOLE[1].target'), 4)
        self.assertIsNone(self.L.eval('CONSOLE[1].values.z'))
        out = self.L.eval("REG.setNeeds({ label = 'Web' }, { player = { source = 4 }, hunger = 100, thirst = 100 })")
        self.assertTrue(out['success'])
        self.assertEqual(self.L.eval('CONSOLE[2].verb'), 'needs')
        self.assertEqual(len(self.sql("SELECT id FROM wc_logs WHERE action = 'Set food and water'")), 1)

    def test_a_console_action_needs_the_player_in_game_and_good_values(self):
        out = self.L.eval("REG.teleportCoords({ label = 'Web' }, { player = { source = 77 }, x = 1, y = 2 })")
        self.assertEqual(out['message'], 'player_not_online')
        out = self.L.eval("REG.teleportCoords({ label = 'Web' }, { player = { source = 4 }, x = 'a' })")
        self.assertEqual(out['message'], 'err_invalid_coords')
        out = self.L.eval("REG.setNeeds({ label = 'Web' }, { player = { source = 4 } })")
        self.assertEqual(out['message'], 'err_invalid_value')
        self.assertEqual(self.L.eval('#CONSOLE'), 0)

    # -- one log ------------------------------------------------------------------------------------------

    def test_a_game_log_line_lands_in_the_site_log_and_is_not_sent_back(self):
        self.L.eval("EXPORTS.GameLog({ by = 'Admin1', kind = 'bans', action = 'ban', text = 'banned X', "
                    "target = { citizenid = '12', name = 'سعد' } })")
        row = self.sql('SELECT admin_username, action_type, action, details, target_player, severity FROM wc_logs')[0]
        self.assertEqual(row, {'admin_username': 'Admin1', 'action_type': 'player_action', 'action': 'In game: ban',
                               'details': 'banned X', 'target_player': 'سعد', 'severity': 'high'})
        self.assertEqual(self.L.eval('#SITE_LOG'), 0)

    def test_a_site_action_reaches_the_in_game_log(self):
        self.L.eval("Log.write({ label = 'Web' }, 'player_action', 'Kicked player', 'afk', { name = 'Saad' })")
        self.assertEqual(len(self.sql('SELECT id FROM wc_logs')), 1)
        self.assertEqual(self.L.eval('SITE_LOG[1].by'), 'Web')
        self.assertEqual(self.L.eval('SITE_LOG[1].target'), 'Saad')


if __name__ == '__main__':
    unittest.main()
