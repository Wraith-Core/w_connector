"""2.4.1 (owner 2026-11-03): Page Up opens the quick menu, F10 the full console, under new command names."""
from pathlib import Path
import unittest

from lupa import lua54

ROOT = Path(__file__).resolve().parents[1]


def load_console(started_w_admin=False):
    lua = lua54.LuaRuntime()
    lua.execute('''
COMMANDS, MAPPINGS, TOGGLED, SERVER = {}, {}, {}, {}
function GetGameName() return 'redm' end
function GetResourceKvpString() return nil end
function GetCurrentResourceName() return 'w_connector' end
function GetInvokingResource() return nil end
function GetResourceState(name) return name == 'w_admin' and (W_ADMIN and 'started' or 'missing') or 'started' end
function IsPauseMenuActive() return false end
function IsNuiFocused() return false end
function SetTimeout() end
function CreateThread() end
function Wait() end
function TriggerServerEvent(name) SERVER[#SERVER + 1] = name end
function RegisterCommand(name, fn) COMMANDS[name] = fn end
function RegisterKeyMapping(cmd, desc, kind, key) MAPPINGS[#MAPPINGS + 1] = { cmd = cmd, desc = desc, kind = kind, key = key } end
local noop = function() end
RegisterNetEvent, AddEventHandler, RegisterNUICallback, SendNUIMessage, SetNuiFocus = noop, noop, noop, noop, noop
SetNuiFocusKeepInput, SetResourceKvp, LoadResourceFile = noop, noop, function() return nil end
exports = setmetatable({}, { __call = noop, __index = function() return setmetatable({}, { __index = function() return noop end }) end })
json = { decode = function() return {} end, encode = function() return '{}' end }
''')
    lua.globals().W_ADMIN = started_w_admin
    lua.execute((ROOT / 'client' / 'cl_console.lua').read_text(encoding='utf-8-sig'))
    return lua


class ConsoleKeyMappingTests(unittest.TestCase):
    def setUp(self):
        self.lua = load_console()
        g = self.lua.globals()
        self.maps = {m.cmd: m for m in (g.MAPPINGS[i] for i in range(1, len(g.MAPPINGS) + 1))}

    def test_page_up_is_the_quick_menu_and_f10_the_full_console(self):
        self.assertEqual(self.maps['+wc_quick_menu'].key, 'PAGEUP')
        self.assertEqual(self.maps['+wc_admin_console'].key, 'F10')
        for m in self.maps.values():
            self.assertEqual(m.kind, 'keyboard')

    def test_old_names_stay_commands_without_a_key(self):
        """A saved binding beats a mapping default, so the 2.4.0 names must not be mapped again."""
        g = self.lua.globals()
        for name in ('+wc_console_quick', '-wc_console_quick', '+wc_console_full', '-wc_console_full',
                     '+wc_quick_menu', '-wc_quick_menu', '+wc_admin_console', '-wc_admin_console',
                     'wadmin', 'wquickadmin'):
            self.assertIsNotNone(g.COMMANDS[name], name)
        self.assertNotIn('+wc_console_quick', self.maps)
        self.assertNotIn('+wc_console_full', self.maps)
        self.assertEqual(sorted(k for k in self.maps if k in ('+wc_quick_menu', '+wc_admin_console')),
                         ['+wc_admin_console', '+wc_quick_menu'])

    def test_each_key_opens_its_own_mode(self):
        for cmd, mode in (('+wc_quick_menu', 'quick'), ('+wc_admin_console', 'full'),
                          ('+wc_console_quick', 'quick'), ('+wc_console_full', 'full')):
            lua = load_console()
            g = lua.globals()
            g.COMMANDS[cmd]()
            self.assertEqual(g.WConsole.mode, mode, cmd)
            self.assertEqual(g.SERVER[1], 'w_connector:console:open', cmd)

    def test_an_old_w_admin_still_owns_its_keys(self):
        lua = load_console(started_w_admin=True)
        g = lua.globals()
        g.COMMANDS['+wc_admin_console']()
        self.assertIsNone(g.SERVER[1])


class ConsoleKeyLabelTests(unittest.TestCase):
    def test_nui_keys_match_the_mappings(self):
        """Inside the page the other mode's key switches: F10 from quick, Page Up from full."""
        src = (ROOT / 'web/src/app/App.tsx').read_text(encoding='utf-8')
        self.assertIn("(e.key === 'F10' && mode === 'quick') || (e.key === 'PageUp' && mode === 'full')", src)
        shell = (ROOT / 'web/src/app/AppShell.tsx').read_text(encoding='utf-8')
        self.assertIn('kbd="PgUp" className="sh-pill" onClick={() => app.setMode(\'quick\')}', shell)
        quick = (ROOT / 'web/src/quick/index.tsx').read_text(encoding='utf-8')
        self.assertIn('kbd="F10" onClick={onFull}', quick)
        settings = (ROOT / 'web/src/pages/settings/SettingsPage.tsx').read_text(encoding='utf-8')
        self.assertIn("{ k: 'F10', id: 'open' }", settings)
        self.assertIn("{ k: 'PgUp', id: 'quick' }", settings)


if __name__ == '__main__':
    unittest.main()
