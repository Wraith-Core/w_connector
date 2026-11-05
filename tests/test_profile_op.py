"""player.profile (2.5.0): a player's own account page on the server's website.

Runs ops/profile.lua in Lua 5.4 (lupa) against a fake MySQL/exports layer:
  py -3 -I tests/test_profile_op.py
"""
import json
import os
import sys
import unittest

from lupa import lua54

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LICENSE = 'license:' + 'a' * 40

STUBS = r'''
WC = { Ops = {}, Adapters = {} }
local defined = {}
function WC.Ops.define(name, needs, run) defined[name] = { needs = needs, run = run } end
function WC.opsDefined() return defined end
function WC.Adapters.describe(kind) return { id = FW_ID, version = '1' } end
STARTED = {}
function WC.started(res) return STARTED[res] == true end
function WC.itemName(v)
    if type(v) ~= 'string' or #v == 0 or #v > 64 then return nil end
    if not v:match('^[%w_%-%.]+$') then return nil end
    return v
end
function GetResourceState() return 'started' end
json = { decode = function(s) return JSON_DECODE(s) end }
'''


class ProfileOp(unittest.TestCase):
    def setUp(self):
        L = self.L = lua54.LuaRuntime(unpack_returned_tuples=True)
        g = L.globals()
        g.FW_ID = 'wcore'
        L.execute(STUBS)
        g.JSON_DECODE = lambda s: self.to_lua(json.loads(s))
        self.queries = []
        self.tables = {}
        fake = self

        class MySQL:  # the oxmysql surface ops/profile.lua uses
            pass

        def q(sql, params=None):
            fake.queries.append(sql)
            return fake.to_lua(fake.answer(sql, list(params.values()) if params else []))

        def single(sql, params=None):
            rows = fake.answer(sql, list(params.values()) if params else [])
            return fake.to_lua(rows[0]) if rows else None

        def scalar(sql, params=None):
            rows = fake.answer(sql, list(params.values()) if params else [])
            return rows[0] if rows else None

        g.MySQL = L.table_from({
            'query': L.table_from({'await': q}),
            'single': L.table_from({'await': single}),
            'scalar': L.table_from({'await': scalar}),
        })
        g.exports = L.table_from({
            'w_inventory': L.table_from({
                'GetNativeOfflineInventory': lambda _, cid: (
                    self.to_lua([{'name': 'bread', 'count': 3, 'label': 'Bread'},
                                 {'name': 'bread', 'count': 2, 'label': 'Bread'},
                                 {'name': 'bad name!', 'count': 1}]),
                    self.to_lua([{'name': 'WEAPON_REVOLVER_CATTLEMAN', 'count': 1, 'label': 'Cattleman'}])),
                'Items': lambda _, name: self.to_lua(
                    {'label': 'Bread', 'i18n': {'label': {'ar': 'خبز', 'en': 'Bread'}}} if name == 'bread' else None),
            }),
            'w_vip': L.table_from({'TierOfCitizen': lambda _, cid: 'gold'}),
        })
        with open(os.path.join(ROOT, 'ops', 'profile.lua'), encoding='utf-8') as f:
            L.execute(f.read())
        self.op = L.eval('WC.opsDefined()')['player.profile']

    def to_lua(self, v):
        if isinstance(v, dict):
            return self.L.table_from({k: self.to_lua(x) for k, x in v.items()})
        if isinstance(v, list):
            return self.L.table_from([self.to_lua(x) for x in v])
        return v

    def to_py(self, v):
        if v is None or isinstance(v, (int, float, str, bool)):
            return v
        keys = list(v.keys())
        if keys and all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [self.to_py(v[k]) for k in sorted(keys)]
        return {k: self.to_py(v[k]) for k in keys}

    def answer(self, sql, params):
        s = ' '.join(sql.split())
        if s.startswith('SELECT citizenid, cid, license'):
            if params[0] != LICENSE:
                return []
            return [
                {'citizenid': 'ABC123', 'cid': 1, 'license': LICENSE, 'name': 'acct',
                 'charinfo': json.dumps({'firstname': 'Mansour', 'lastname': 'Salmi', 'gender': 0}),
                 'job': json.dumps({'name': 'sheriff', 'label': 'Law', 'label_ar': 'الشريف', 'grade': {'level': 4, 'name': 'Captain'}}),
                 'money': json.dumps({'cash': 5, 'bank': 7, 'gold': 1}), 'last_updated': '2026-11-05 20:00:00'},
                {'citizenid': 'XYZ9', 'cid': 2, 'license': LICENSE, 'name': 'acct',
                 'charinfo': json.dumps({'firstname': 'Other', 'lastname': 'One'}), 'job': '{}', 'money': '{}',
                 'last_updated': '2026-11-01 10:00:00'},
            ]
        if 'FROM cb_accounts' in s:
            return [{'id': 'player:ABC123:cash', 'kind': 'player', 'balance': 58300},
                    {'id': 'player:ABC123:gold', 'kind': 'player', 'balance': 96900},
                    {'id': 'player:ABC123:bank', 'kind': 'player', 'balance': 1000},
                    {'id': 'banklegacy:4', 'kind': 'legacy_bank', 'balance': 250}]
        if 'FROM w_housing_houses WHERE owner' in s:
            return [{'id': 3, 'label_ar': 'بيت فالنتاين', 'label_en': 'Valentine house', 'price_paid': 1200, 'price': 1500, 'locked': 1}]
        if 'FROM w_housing_taxes' in s:
            return [{'house_id': 3, 'due': 15}]
        if 'FROM w_housing_keys' in s:
            return [2]
        if 'FROM stables s WHERE' in s:
            return [{'id': 1, 'type': 'horse', 'name': 'Shadow', 'modelname': 'a_c_horse_arabian_black', 'breed': 'Arabian',
                     'sex': 'male', 'level': 5, 'isDefault': 1, 'is_dead': 0},
                    {'id': 2, 'type': 'wagon', 'name': 'Cart', 'modelname': 'cart01', 'wagon_type': 'cart', 'condition_pct': 80, 'isDefault': 0}]
        if 'FROM w_stables_horses' in s:
            return [{'horse_id': 1, 'rarity': 'rare'}]
        if 'FROM player_levels' in s:
            return [{'level': 12, 'xp': 340, 'total_xp': 9000}] if params[0] == LICENSE else []
        if 'FROM tribe_members' in s:
            raise Exception("Table 'tribe_members' doesn't exist")
        return []

    def run_op(self, args):
        ok, data = self.op['run'](self.to_lua(args), None)
        return ok, self.to_py(data) if ok else data

    def test_needs_w_core(self):
        g = self.L.globals()
        g.STARTED = self.to_lua({'w_core': True})
        self.assertTrue(self.op['needs']())
        g.FW_ID = 'vorp'
        self.assertFalse(self.op['needs']())

    def test_refuses_bad_license_and_unknown_account(self):
        self.assertEqual(self.run_op({'license': "x' OR 1=1"}), (False, 'invalid_args'))
        self.assertEqual(self.run_op({'license': 'license:' + 'b' * 40}), (False, 'not_found'))

    def test_full_profile(self):
        self.L.globals().STARTED = self.to_lua({k: True for k in (
            'w_core', 'w_inventory', 'w_housing', 'w_stables', 'w_level', 'w_vip', 'w_tribes')})
        ok, d = self.run_op({'license': LICENSE})
        self.assertTrue(ok)
        self.assertEqual(d['charId'], 'ABC123')
        self.assertEqual([c['name'] for c in d['characters']], ['Mansour Salmi', 'Other One'])
        self.assertEqual(d['character']['job']['labelAr'], 'الشريف')
        self.assertEqual(d['character']['job']['grade'], 4)
        # the central bank ledger wins over the players.money copy; cents -> dollars
        self.assertEqual(d['money'], {'cash': 583, 'gold': 969, 'bank': 10, 'savings': 2.5})
        self.assertEqual(d['level'], {'level': 12, 'xp': 340, 'total': 9000})
        self.assertEqual(d['vip'], 'gold')
        inv = d['inventory']
        self.assertEqual(inv['kinds'], 2)  # the bad item name is dropped, the two bread rows merged
        self.assertEqual(inv['items'][0], {'name': 'bread', 'labelAr': 'خبز', 'labelEn': 'Bread', 'count': 5})
        self.assertTrue(inv['items'][1]['weapon'])
        self.assertEqual(d['houses']['owned'][0]['taxDue'], 15)
        self.assertEqual(d['houses']['keys'], 2)
        self.assertEqual(d['stables']['horses'][0]['rarity'], 'rare')
        self.assertTrue(d['stables']['horses'][0]['active'])
        self.assertEqual(d['stables']['wagons'][0]['condition'], 80)
        self.assertNotIn('tribe', d)  # its table failed: left out, the rest still answered
        self.assertNotIn('pets', d)   # w_pets not running: left out

    def test_other_character_by_id_only_within_the_account(self):
        self.L.globals().STARTED = self.to_lua({'w_core': True})
        ok, d = self.run_op({'license': LICENSE, 'charId': 'XYZ9'})
        self.assertEqual(d['charId'], 'XYZ9')
        ok, d = self.run_op({'license': LICENSE, 'charId': 'SOMEONE_ELSE'})
        self.assertEqual(d['charId'], 'ABC123')  # a char id outside the account is ignored

    def test_read_only(self):
        self.L.globals().STARTED = self.to_lua({k: True for k in ('w_core', 'w_inventory', 'w_housing', 'w_stables')})
        self.run_op({'license': LICENSE})
        for sql in self.queries:
            self.assertTrue(' '.join(sql.split()).upper().startswith('SELECT'), sql)


if __name__ == '__main__':
    sys.exit(unittest.main())
