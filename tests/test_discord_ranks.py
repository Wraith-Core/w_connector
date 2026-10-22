"""w_connector 1.1.9: a rank bound to a Discord role goes to its holder in game too (server/sv_discordranks.lua).

The roles come from the website (stubbed here); w_core's ranks API is stubbed; the bookkeeping table runs on a real
MariaDB (local XAMPP, 127.0.0.1:3306 root; w_connector_dranks_test is made again for every test).
Run from the resource folder:  py -3 -I -m unittest discover -s tests
"""
import os
import unittest

import lupa
import pymysql

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = 'w_connector_dranks_test'

STUBS = r'''
Config = { endpoint = 'https://site/api/fivem/devadmin', apiKey = 'k' }
Schema = { await = function() end }
function CreateThread(fn) if not SKIP_THREADS then fn() end end
function SetTimeout() end
function Wait() end
function AddEventHandler() end
NAMES = { [4] = 'Saad' }
IDS = { [4] = { license = 'license:saad', discord = 'discord:111' } }
function GetPlayerName(src) return NAMES[src] end
function GetPlayers() return { '4' } end
function GetPlayerIdentifierByType(src, kind) return (IDS[src] or {})[kind] end
SITE_ROLES = { '900', '901' }
SITE_OK = true
function PerformHttpRequest(url, cb)
  LAST_URL = url
  if SITE_OK then cb(200, json.encode({ ok = true, roleIds = SITE_ROLES })) else cb(500, '') end
end
promise = { new = function()
  local p = {}
  function p:resolve(v) self.v = v end
  return p
end }
Citizen = { Await = function(p) return p.v end }
HELD = { 'helper' }            -- ranks the player holds now (helper was given by hand)
ASSIGNED, REVOKED = {}, {}
RANKS_API = {
  RanksOfPlayer = function(_, src) return HELD end,
  RanksAssign = function(_, actor, target, rank) ASSIGNED[#ASSIGNED + 1] = rank; HELD[#HELD + 1] = rank; return true end,
  RanksRevokePlayer = function(_, actor, src, rank)
    REVOKED[#REVOKED + 1] = rank
    for i, r in ipairs(HELD) do if r == rank then table.remove(HELD, i) break end end
    return true
  end,
}
ROLES = {
  { name = 'master', discordRoleId = '900' },
  { name = 'mod', discordRoleId = '901' },
  { name = 'helper', discordRoleId = '902' },
  { name = 'vip', discordRoleId = '' },
}
Perms = { core = function() return RANKS_API end, list = function() return ROLES end, load = function() end }
LOGS = {}
Log = { write = function(_, _, action, details) LOGS[#LOGS + 1] = details end }
'''


def connect(db=None):
    return pymysql.connect(host='127.0.0.1', port=3306, user='root', password='', database=db,
                           charset='utf8mb4', autocommit=True, cursorclass=pymysql.cursors.DictCursor)


class DiscordRanks(unittest.TestCase):
    def setUp(self):
        c = connect()
        with c.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS {DB}')
            cur.execute(f'CREATE DATABASE {DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci')
        c.close()
        self.db = connect(DB)
        L = self.L = lupa.LuaRuntime(unpack_returned_tuples=True)

        def params(p):
            return [p[i] for i in range(1, len(p) + 1)] if p is not None else []

        def run(sql, p=None):
            cur = self.db.cursor()
            cur.execute(sql.replace('?', '%s'), params(p))
            return cur

        g = L.globals()
        g.py_query = lambda s, p=None: L.table_from([L.table_from(r) for r in (run(s, p).fetchall() or [])])
        g.py_insert = lambda s, p=None: run(s, p).lastrowid
        g.py_update = lambda s, p=None: run(s, p).rowcount
        L.execute('''
            json = { encode = function(t)
              local ids = {}
              for _, v in ipairs(t.roleIds or {}) do ids[#ids + 1] = '"' .. v .. '"' end
              return '{"ok":true,"roleIds":[' .. table.concat(ids, ',') .. ']}'
            end, decode = function(s)
              local out = { ok = s:find('"ok":true') ~= nil, roleIds = {} }
              for id in s:gmatch('"(%d+)"') do out.roleIds[#out.roleIds + 1] = id end
              return out
            end }
            MySQL = {
              query = { await = function(s, p) return py_query(s, p) end },
              insert = { await = function(s, p) return py_insert(s, p) end },
              update = { await = function(s, p) return py_update(s, p) end },
            }
        ''')
        L.execute(STUBS)
        with open(os.path.join(ROOT, 'server', 'sv_discordranks.lua'), encoding='utf-8') as fh:
            L.execute(fh.read())

    def tearDown(self):
        self.db.close()

    def given(self):
        with self.db.cursor() as cur:
            cur.execute('SELECT rank_name FROM wc_discord_ranks ORDER BY rank_name')
            return [r['rank_name'] for r in cur.fetchall()]

    def test_a_role_gives_its_rank_never_the_master(self):
        added, removed = self.L.eval('DiscordRanks.sync(4)')
        self.assertEqual((added, removed), (1, 0))
        self.assertEqual(list(self.L.eval('ASSIGNED').values()), ['mod'], 'the master is never given by a role')
        self.assertEqual(self.given(), ['mod'])
        self.assertIn('discord=111', self.L.eval('LAST_URL'))

    def test_the_rank_goes_when_the_role_goes_and_a_hand_given_rank_stays(self):
        self.L.eval('DiscordRanks.sync(4)')
        self.L.execute("SITE_ROLES = { '902' }")  # lost 901 (mod); holds 902 (helper), which he has by hand
        added, removed = self.L.eval('DiscordRanks.sync(4)')
        self.assertEqual((added, removed), (0, 1))
        self.assertEqual(list(self.L.eval('REVOKED').values()), ['mod'])
        self.assertEqual(self.given(), [], 'helper was given by hand: not recorded, not taken')
        self.L.execute('SITE_ROLES = {}')
        self.L.eval('DiscordRanks.sync(4)')
        self.assertEqual(list(self.L.eval('REVOKED').values()), ['mod'], 'a rank given by hand is never taken')

    def test_unknown_roles_change_nothing(self):
        self.L.execute('SITE_OK = false')
        added, reason = self.L.eval('DiscordRanks.sync(4)')
        self.assertIsNone(added)
        self.assertEqual(reason, 'roles_unavailable')
        self.assertEqual(len(self.L.eval('ASSIGNED')), 0)


if __name__ == '__main__':
    unittest.main()
