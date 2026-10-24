"""w_connector 1.1.12: staff holding manage_permissions manage ranks from the site, below their own level only.

The master manages every rank; anyone else creates, edits, deletes and gives only ranks strictly below his own
level, with only the permissions he holds, and changes or removes only staff below him (owner, 2026-10-24).
server/sv_perms.lua + sv_registry.lua + handlers/roles.lua + handlers/admins.lua run on the real Lua; w_core's
ranks API is stubbed.
Run from the resource folder:  py -3 -I -m unittest discover -s tests
"""
import os
import unittest

import lupa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STUBS = r'''
RANKS = {
  ranks = {
    { name = 'master', sort = 1000 },
    { name = 'admin', sort = 50, permissions = { 'manage_permissions', 'change.admin.role', 'access_admin_panel',
      'player.kick', 'group.admin' } },
    { name = 'peer', sort = 50, permissions = { 'player.kick' } },
    { name = 'helper', sort = 10, permissions = { 'player.kick', 'player.ban.permanent' } },
  },
  members = {
    { identifier = 'license:adminlic', ranks = { 'admin' } },
    { identifier = 'license:peerlic', ranks = { 'peer' } },
    { identifier = 'license:helperlic', ranks = { 'helper' } },
  },
}
SAVED, DELETED, ASSIGNED, REVOKED = {}, {}, {}, {}
API = {
  RanksState = function() return RANKS end,
  RanksSave = function(_, actor, data) SAVED[#SAVED + 1] = data; return true end,
  RanksDelete = function(_, actor, name) DELETED[#DELETED + 1] = name; return true end,
  RanksAssign = function(_, actor, target, rank) ASSIGNED[#ASSIGNED + 1] = rank; return true end,
  RanksRevoke = function(_, actor, identifier, rank) REVOKED[#REVOKED + 1] = rank; return true end,
}
function GetResourceState() return 'started' end
function GetCurrentResourceName() return 'w_connector' end
function AddEventHandler() end
function SetTimeout() end
function CreateThread() end
function Wait() end
function RegisterNetEvent() end
function GetPlayerName() return nil end
function GetPlayerIdentifiers() return {} end
exports = { w_core = API }
Vorp = { snapshot = function() return nil end, sourceOfChar = function() return nil end }
CoreBridge = { charIdOf = function() return nil end }
w = { citizen = { resolve = function() return nil end } }
Log = { write = function() end }
Config = { discordToken = '', discordGuild = '' }
DiscordRanks = { syncAll = function() return 0, 0, 0 end, syncDiscord = function() return 0, 0 end }
'''


class RankManagers(unittest.TestCase):
    def setUp(self):
        L = self.L = lupa.LuaRuntime(unpack_returned_tuples=True)
        L.execute(STUBS)
        L.execute("PERMISSION_NODES = { { category = 'All', nodes = { 'access_admin_panel', 'player.kick', "
                  "'player.ban.permanent', 'manage_permissions', 'change.admin.role', 'group.mod', 'group.admin', "
                  "'group.god' } } }")
        for f in ('server/sv_perms.lua', 'server/sv_registry.lua', 'server/handlers/roles.lua',
                  'server/handlers/admins.lua'):
            with open(os.path.join(ROOT, f), encoding='utf-8') as fh:
                L.execute(fh.read())
        L.execute('Perms.load()')

    def call(self, group, name, args_lua):
        ok, res, err = self.L.eval(
            "function() return Registry.callInvoke({ group = '%s' }, 'adminpanel:%s', %s) end" % (group, name, args_lua))()
        if not ok:
            return err
        return 'ok' if res['success'] else res['message']

    def saved(self):
        last = self.L.eval('SAVED[#SAVED]')
        return last and dict(sort=last['sort'], permissions=sorted(last['permissions'].values()))

    # creating / editing ranks
    def test_admin_creates_a_rank_below_him(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', label = 'x', lvl = 20, "
                                   "permissions = { 'player.kick' } }"), 'ok')
        self.assertEqual(self.saved(), {'sort': 20, 'permissions': ['player.kick']})

    def test_not_at_his_own_level(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', lvl = 50, permissions = {} }"),
                         'rank_not_below_yours')

    def test_not_his_own_rank_or_a_peer(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'admin', lvl = 10, permissions = {} }"),
                         'rank_not_below_yours')
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'peer', lvl = 10, permissions = {} }"),
                         'rank_not_below_yours')

    def test_only_what_he_holds(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', lvl = 20, "
                                   "permissions = { 'player.ban.permanent' } }"), 'permission_not_yours')
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', lvl = 20, "
                                   "permissions = { 'group.god' } }"), 'permission_not_yours')

    def test_a_lower_in_game_level_is_his_to_give(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', lvl = 20, "
                                   "permissions = { 'group.mod' } }"), 'ok')

    def test_everything_means_everything_he_holds(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'observer', lvl = 20, permissions = { '*' } }"), 'ok')
        self.assertEqual(self.saved()['permissions'],
                         sorted(['access_admin_panel', 'player.kick', 'manage_permissions', 'change.admin.role',
                                 'group.mod']))

    def test_what_the_rank_already_had_may_stay(self):
        self.assertEqual(self.call('admin', 'saveRole', "{ name = 'helper', lvl = 10, "
                                   "permissions = { 'player.kick', 'player.ban.permanent' } }"), 'ok')

    def test_master_is_unlimited(self):
        self.assertEqual(self.call('owner', 'saveRole', "{ name = 'observer', lvl = 999, "
                                   "permissions = { 'player.ban.permanent', 'group.god' } }"), 'ok')

    def test_the_node_is_still_needed(self):
        self.assertEqual(self.call('helper', 'saveRole', "{ name = 'observer', lvl = 1, permissions = {} }"),
                         'no_permission')

    # deleting ranks
    def test_delete_below_only(self):
        self.assertEqual(self.call('admin', 'deleteRole', "{ name = 'peer' }"), 'rank_not_below_yours')
        self.assertEqual(self.call('admin', 'deleteRole', "{ name = 'helper' }"), 'ok')

    # giving / changing / removing staff
    def test_give_a_rank_below_only(self):
        self.assertEqual(self.call('admin', 'setPermission', "{ identifier = 'license:new', permission = 'peer' }"),
                         'rank_not_below_yours')
        self.assertEqual(self.call('admin', 'setPermission', "{ identifier = 'license:new', permission = 'owner' }"),
                         'rank_not_below_yours')
        self.assertEqual(self.call('admin', 'setPermission', "{ identifier = 'license:new', permission = 'helper' }"),
                         'ok')

    def test_change_or_remove_staff_below_only(self):
        self.assertEqual(self.call('admin', 'changeAdminRole', "{ targetAdmin = { identifier = 'license:peerlic' }, "
                                   "role = 'helper' }"), 'target_outranks_you')
        self.assertEqual(self.call('admin', 'removeAdmin', "{ identifier = 'license:peerlic' }"), 'target_outranks_you')
        self.assertEqual(self.call('admin', 'removeAdmin', "{ identifier = 'license:adminlic' }"), 'target_outranks_you')
        self.assertEqual(self.call('admin', 'removeAdmin', "{ identifier = 'license:helperlic' }"), 'ok')


if __name__ == '__main__':
    unittest.main()
