"""losses.list / losses.restore (2.6.0): what a character lost, and giving it back once.

Runs ops/losses.lua in Lua 5.4 (lupa) against fake w_inventory / w_centralbank exports:
  py -3 -I tests/test_losses_op.py
"""
import os
import unittest

from lupa import lua54

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STUBS = r'''
WC = { Ops = {} }
DEFINED = {}
function WC.Ops.define(name, needs, run) DEFINED[name] = { needs = needs, run = run } end
STATES = { w_inventory = 'started', w_centralbank = 'started' }
function GetResourceState(n) return STATES[n] or 'missing' end
CALLS = {}
CLIENT = {}
function TriggerClientEvent(name, src, data) CLIENT[#CLIENT + 1] = { name = name, src = src, data = data } end
ONLINE = { ['13'] = 7 }
LOSSES = {
    { id = 5, item = 'WEAPON_BOW', count = 1, how = 'taken', by_cid = '44', by_name = 'Bandit', place = '9',
      coords = '1.0,2.0,3.0', metadata = { serial = 'AB12', durability = 80, big = 'x' }, at = 1000 },
}
OUTFLOWS = {
    { id = 77, idx = 1, kind = 'cash', amount = 25.5, to = 'player:44:cash', toCid = '44', reason = 'rob', actor = 'w_policejob', at = 999, refunded = false },
}
exports = {
    w_inventory = {
        Items = function(_, name) return { label = 'L_' .. name } end,
        ListLosses = function(_, cid, limit) CALLS[#CALLS + 1] = { 'ListLosses', cid, limit } return LOSSES end,
        RestoreLoss = function(_, id, by, cid) CALLS[#CALLS + 1] = { 'RestoreLoss', id, by, cid }
            if id == 5 and cid == '13' then return true, { item = 'WEAPON_BOW', count = 1 } end
            return false, 'loss_not_found' end,
        SourceOfCitizen = function(_, cid) return ONLINE[cid] end,
    },
    w_centralbank = {
        PlayerOutflows = function(_, cid, limit) CALLS[#CALLS + 1] = { 'PlayerOutflows', cid, limit } return OUTFLOWS end,
        RefundOutflow = function(_, cid, id, idx, by) CALLS[#CALLS + 1] = { 'RefundOutflow', cid, id, idx, by }
            if id == 77 and idx == 1 then return true, { amount = 25.5, kind = 'cash' } end
            return false, 'loss_not_found' end,
    },
}
function RUN(name, args, actor) return DEFINED[name].run(args, actor) end
'''


class LossesOp(unittest.TestCase):
    def setUp(self):
        self.L = lua54.LuaRuntime(unpack_returned_tuples=True)
        self.L.execute(STUBS)
        with open(os.path.join(ROOT, 'ops', 'losses.lua'), encoding='utf-8') as fh:
            self.L.execute(fh.read())
        self.g = self.L.globals()

    def run_op(self, name, args, actor=None):
        return self.g.RUN(name, self.L.table_from(args), actor and self.L.table_from(actor))

    def calls(self, fn):
        return [list(c.values()) for c in self.g.CALLS.values() if c[1] == fn]

    def test_both_ops_are_defined(self):
        self.assertIsNotNone(self.g.DEFINED['losses.list'])
        self.assertIsNotNone(self.g.DEFINED['losses.restore'])

    def test_list_for_staff_has_who_and_where(self):
        ok, data = self.run_op('losses.list', {'charId': '13'})
        self.assertTrue(ok)
        self.assertTrue(data.online)
        item = data['items'][1]
        self.assertEqual((item.item, item.label, item.byName, item.coords), ('WEAPON_BOW', 'L_WEAPON_BOW', 'Bandit', '1.0,2.0,3.0'))
        self.assertEqual((item.meta.serial, item.meta.durability), ('AB12', 80))
        self.assertIsNone(item.meta.big)
        money = data['money'][1]
        self.assertEqual((money.amount, money.toCid, money.actor), (25.5, '44', 'w_policejob'))

    def test_player_view_hides_who_took_it(self):
        mine = self.g.WC.Losses.forPlayer('13')
        item, money = mine['items'][1], mine['money'][1]
        self.assertIsNone(item.byName)
        self.assertIsNone(item.coords)
        self.assertIsNone(money.toCid)
        self.assertIsNone(money.actor)
        self.assertEqual(item.how, 'taken')

    def test_bad_char_is_refused(self):
        ok, why = self.run_op('losses.list', {'charId': "13' OR 1=1"})
        self.assertFalse(ok)
        self.assertEqual(why, 'invalid_args')

    def test_restore_item_names_the_character_and_the_staff(self):
        ok, data = self.run_op('losses.restore', {'charId': '13', 'kind': 'item', 'id': 5}, {'id': '123', 'name': 'Mod'})
        self.assertTrue(ok)
        self.assertEqual(data.item, 'WEAPON_BOW')
        call = self.calls('RestoreLoss')[0]
        self.assertEqual((call[1], call[2], call[3]), (5, 'Mod (123)', '13'))
        ok, why = self.run_op('losses.restore', {'charId': '14', 'kind': 'item', 'id': 5})
        self.assertFalse(ok)
        self.assertEqual(why, 'loss_not_found')

    def test_restore_money_needs_the_move_and_tells_the_player(self):
        ok, why = self.run_op('losses.restore', {'charId': '13', 'kind': 'money', 'id': 77})
        self.assertFalse(ok)
        self.assertEqual(why, 'invalid_args')
        ok, data = self.run_op('losses.restore', {'charId': '13', 'kind': 'money', 'id': 77, 'idx': 1})
        self.assertTrue(ok)
        self.assertEqual(data.amount, 25.5)
        note = self.g.CLIENT[1]
        self.assertEqual((note.src, note.data.key), (7, 'loss_refunded'))

    def test_unknown_kind_is_refused(self):
        ok, why = self.run_op('losses.restore', {'charId': '13', 'kind': 'horse', 'id': 1})
        self.assertFalse(ok)
        self.assertEqual(why, 'invalid_args')


if __name__ == '__main__':
    unittest.main()
