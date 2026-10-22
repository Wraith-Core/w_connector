"""w_connector 1.1.4: the dispatcher's rank guard (server/sv_registry.lua) on the real Lua, with the game stubbed.

A staff member acts on players below his own rank only; the master acts on anyone; anyone acts on himself; reads
are not limited; a bare `id` (a warning, a ban, a report) never names a target.
Run from the resource folder:  py -3 -I -m unittest discover -s tests
"""
import os
import unittest

import lupa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STUBS = r'''
RANKS = {
  ranks = {
    { name = 'master', sort = 1000 }, { name = 'admin', sort = 50, permissions = { 'player.kick' } },
    { name = 'helper', sort = 10, permissions = { 'player.kick', 'get_player_warnings' } },
  },
  members = {
    { identifier = 'license:adminlic', ranks = { 'admin' } },
    { identifier = 'license:helperlic', ranks = { 'helper' } },
  },
}
function GetResourceState() return 'started' end
function GetCurrentResourceName() return 'w_connector' end
function AddEventHandler() end
function SetTimeout() end
function CreateThread() end
function Wait() end
function RegisterNetEvent() end
exports = { w_core = { RanksState = function() return RANKS end } }
-- live players: source -> identifiers; character ids -> source
IDS = { [5] = { 'license:adminlic', 'discord:111' }, [6] = { 'license:helperlic', 'discord:222' },
        [7] = { 'license:playerlic', 'discord:333' } }
CHARS = { [7] = 5 }  -- character 7 is the admin's
function GetPlayerIdentifiers(src) return IDS[src] or {} end
Vorp = {
  snapshot = function(src) if IDS[src] then return { charId = src } end end,
  sourceOfChar = function(c) return CHARS[c] end,
}
CoreBridge = { charIdOf = function() return nil end }
w = { citizen = { resolve = function() return nil end } }
'''


class RankGuard(unittest.TestCase):
    def setUp(self):
        self.L = lupa.LuaRuntime(unpack_returned_tuples=True)
        self.L.execute(STUBS)
        for f in ('server/sv_perms.lua', 'server/sv_registry.lua'):
            with open(os.path.join(ROOT, f), encoding='utf-8') as fh:
                self.L.execute(fh.read())
        self.L.execute('Perms.load()')
        self.L.execute("Registry.invoke('kick', 'player.kick', function() return { success = true } end)")
        self.L.execute("Registry.invoke('adminpanel:removeWarning', 'player.kick', function() return { success = true } end)")
        self.L.execute("Registry.invoke('adminpanel:getPlayerWarnings', 'get_player_warnings', function() return {} end)")

    def call(self, group, name, args_lua, discord=None):
        actor = "{ group = '%s', discord = %s }" % (group, ("'%s'" % discord) if discord else 'nil')
        ok, _, err = self.L.eval('function() return Registry.callInvoke(%s, %r, %s) end' % (actor, name, args_lua))()
        return ok, err

    def test_helper_cannot_kick_an_admin(self):
        self.assertEqual(self.call('helper', 'kick', '{ player = { source = 5 } }'), (False, 'target_outranks_you'))

    def test_helper_kicks_a_player_without_rank(self):
        self.assertEqual(self.call('helper', 'kick', '{ player = { source = 7 } }'), (True, None))

    def test_same_rank_is_refused(self):
        self.L.execute("IDS[8] = { 'license:helper2', 'discord:444' } RANKS.members[3] = { identifier = 'license:helper2', ranks = { 'helper' } } Perms.load()")
        self.assertEqual(self.call('helper', 'kick', '{ player = { source = 8 } }'), (False, 'target_outranks_you'))

    def test_master_acts_on_anyone(self):
        self.assertEqual(self.call('owner', 'kick', '{ player = { source = 5 } }'), (True, None))

    def test_anyone_acts_on_himself(self):
        self.assertEqual(self.call('helper', 'kick', '{ player = { source = 6 } }', discord='222'), (True, None))

    def test_an_identifier_names_the_target_offline(self):
        self.assertEqual(self.call('helper', 'kick', "{ identifier = 'license:adminlic' }"), (False, 'target_outranks_you'))

    def test_a_bare_id_is_not_a_target(self):
        # warning 7 shares its number with the admin's character 7: not a reason to refuse
        self.assertEqual(self.call('helper', 'adminpanel:removeWarning', '{ id = 7 }'), (True, None))

    def test_reads_are_not_limited(self):
        self.assertEqual(self.call('helper', 'adminpanel:getPlayerWarnings', '{ player = { source = 5 } }'), (True, None))

    def test_the_node_is_still_checked_first(self):
        self.L.execute("RANKS.ranks[4] = { name = 'viewer', sort = 5, permissions = {} } Perms.load()")
        self.assertEqual(self.call('viewer', 'kick', '{ player = { source = 7 } }'), (False, 'no_permission'))


if __name__ == '__main__':
    unittest.main()
