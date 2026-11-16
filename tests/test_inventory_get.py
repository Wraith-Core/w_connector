"""Exercise the panel's inventory.get operation against the Wraith inventory adapter."""
from pathlib import Path
import unittest

from lupa import lua54


ROOT = Path(__file__).resolve().parents[1]


class InventoryGetTests(unittest.TestCase):
    def setUp(self):
        self.lua = lua54.LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute("""
            function GetResourceState() return 'started' end
            function GetResourceMetadata() return 'test' end
            function GetConvar(_, fallback) return fallback end
            function GetPlayerName(src) if src == 7 then return 'Test player' end end
            reads = 0
            exports = { w_inventory = { GetInventoryItems = function(_, src)
                assert(src == 7)
                reads = reads + 1
                return slots
            end } }
        """)
        for script in ('core/util.lua', 'core/registry.lua',
                       'adapters/inventory/w_inventory.lua', 'ops/inventory.lua'):
            self.lua.execute((ROOT / script).read_text(encoding='utf-8'))
        self.lua.execute('WC.Adapters.detect()')

    def get(self, source=7):
        args = self.lua.table_from({'source': source})
        return self.lua.globals().WC.Ops.run('inventory.get', args)

    def test_unavailable_inventory_returns_no_character(self):
        for slots in (False, None):
            with self.subTest(slots=slots):
                self.lua.globals().slots = slots
                self.assertEqual(self.get(), (False, 'no_character'))

    def test_empty_inventory_is_a_successful_read(self):
        self.lua.globals().slots = self.lua.table()
        ok, items = self.get()
        self.assertTrue(ok)
        self.assertEqual(len(items), 0)

    def test_sparse_inventory_preserves_item_details(self):
        self.lua.execute("slots = { [9] = {name='pelts', label='Pelts', count='2', metadata={stars=3}} }")
        ok, items = self.get('7')
        self.assertTrue(ok)
        self.assertEqual(len(items), 1)
        item = items[1]
        self.assertEqual((item.name, item.label, item.count, item.metadata.stars), ('pelts', 'Pelts', 2, 3))

    def test_offline_player_skips_inventory(self):
        self.assertEqual(self.get(8), (False, 'player_offline'))
        self.assertEqual(self.lua.globals().reads, 0)
