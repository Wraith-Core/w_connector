"""2.4.0: the console's map blips (ops/native_blips.lua + client/cl_blips.lua): only while w_map is not
running, a checked store kept in KVP and pushed to every client, and the console pages flipping live."""
from pathlib import Path
import json
import re
import unittest
from lupa import lua54

ROOT = Path(__file__).resolve().parents[1]


def text(rel):
    return (ROOT / rel).read_text(encoding='utf-8-sig')


def plain(v):
    """A Lua value as Python data (a table 1..n is a list, an empty table an empty list)."""
    if hasattr(v, 'items'):
        items = list(v.items())
        keys = [k for k, _ in items]
        if all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [plain(v[i]) for i in range(1, len(keys) + 1)]
        return {str(k): plain(x) for k, x in items}
    return v


SERVER = r'''
NOW=100000; STARTED={}; GAME='rdr3'; KVP={}; HANDLERS={}; NET={}; TIMERS={}; CLIENT={}; OPS={}
GlobalState={}
function GetGameTimer() return NOW end
function GetCurrentResourceName() return 'w_connector' end
function GetPlayerName(src) return src == 7 and 'Wraith' or nil end
function GetResourceState(r) return STARTED[r] and 'started' or 'stopped' end
function GetResourceKvpString(k) return KVP[k] end
function SetResourceKvp(k, v) KVP[k] = v end
function GetConvar(_, d) return d end
function AddEventHandler(name, fn) HANDLERS[name] = HANDLERS[name] or {}; table.insert(HANDLERS[name], fn) end
function RegisterNetEvent(name, fn) NET[name] = fn end
function TriggerClientEvent(name, src, payload) CLIENT[#CLIENT + 1] = { name = name, src = src, payload = payload } end
function CreateThread() end
function SetTimeout(ms, fn) TIMERS[#TIMERS + 1] = fn end
function RUN_TIMERS() local t = TIMERS; TIMERS = {}; for _, fn in ipairs(t) do fn() end end
function FIRE(name, ...) for _, fn in ipairs(HANDLERS[name] or {}) do fn(...) end end
WC = { Ops = { define = function(name) OPS[name] = true end }, Menu = { pending = {} } }
function WC.started(r) return GetResourceState(r) == 'started' end
function WC.gameName() return GAME end
function WC.linked() return true end
function WC.onlineSource(s) return s end
'''

CLIENT = r'''
STARTED={}; NATIVES={}; HANDLERS={}; NUI={}; NUI_SENT={}; TIMERS={}; BAGS={}; NEXT=100; LIVE={}
GlobalState={}
WMenu={ open=false }
function GetGameName() return 'redm' end
function GetCurrentResourceName() return 'w_connector' end
function GetResourceState(r) return STARTED[r] and 'started' or 'stopped' end
function joaat(s) return 'H:' .. s:lower() end
Citizen={ InvokeNative=function(hash, ...)
  local args={...}
  NATIVES[#NATIVES+1]={ hash=hash, args=args }
  if hash == 0x554D9D53F696D002 then NEXT=NEXT+1; LIVE[NEXT]=true; return NEXT end
end }
function DoesBlipExist(b) return LIVE[b] == true end
function RemoveBlip(b) LIVE[b]=nil end
function AddStateBagChangeHandler(key, bag, fn) BAGS[key]=fn end
function CreateThread(fn) fn() end
function SetTimeout(_, fn) TIMERS[#TIMERS+1]=fn end
function RUN_TIMERS() local t=TIMERS; TIMERS={}; for _, fn in ipairs(t) do fn() end end
function AddEventHandler(name, fn) HANDLERS[name]=HANDLERS[name] or {}; table.insert(HANDLERS[name], fn) end
function FIRE(name, ...) for _, fn in ipairs(HANDLERS[name] or {}) do fn(...) end end
function RegisterNUICallback(name, fn) NUI[name]=fn end
function SendNUIMessage(m) NUI_SENT[#NUI_SENT+1]=m end
function COUNT() local n=0; for _ in pairs(LIVE) do n=n+1 end; return n end
'''


def blip(**kw):
    b = {'name': 'مخزن الذهب', 'sprite': 'blip_shop_store', 'x': 100.5, 'y': -200.25, 'z': 50.0, 'scale': 1.0}
    b.update(kw)
    return b


class Server(unittest.TestCase):
    def setUp(self):
        self.lua = lua54.LuaRuntime()
        self.lua.execute(SERVER)
        g = self.lua.globals()
        g.LoadResourceFile = lambda res, path: (ROOT / str(path)).read_text(encoding='utf-8-sig') if (ROOT / str(path)).is_file() else None
        g.PY_ENC = lambda v: json.dumps(plain(v), ensure_ascii=False)
        g.PY_DEC = lambda s: self.lua.table_from(json.loads(s), recursive=True)
        self.lua.execute('json={encode=function(v) return PY_ENC(v) end, decode=function(s) return PY_DEC(s) end}')

    def boot(self):
        self.lua.execute(text('ops/console.lua'))
        self.lua.execute(text('ops/native_blips.lua'))

    def run_action(self, action, data=None, src=7):
        t = self.lua.table_from(data or {}, recursive=True)
        r = self.lua.globals().WC.Blips.run(src, 'Wraith', action, t)
        return plain(r)

    def gap(self):
        self.lua.execute('NOW = NOW + 1000')

    def published(self):
        return plain(self.lua.eval("GlobalState['w_connector:blips']"))

    def stored(self):
        return json.loads(self.lua.eval("KVP['wc_blips']"))

    # ── the contract ───────────────────────────────────────────────────────

    def test_actions_are_in_the_contract_with_world_control(self):
        contract = json.loads(text('core/console_contract.json'))
        for a in ('list', 'save', 'delete'):
            self.assertEqual(contract[f'blips.{a}'], {'permission': 'world.control', 'area': 'blips'})
        self.boot()  # C.define asserts the contract has every action
        for a in ('list', 'save', 'delete'):
            self.assertTrue(self.lua.eval(f"WC.Console.handlers['blips.{a}'] ~= nil"))

    # ── w_map on / off ─────────────────────────────────────────────────────

    def test_unavailable_while_w_map_runs_with_its_reason(self):
        self.boot()
        ok, reason = self.lua.eval("WC.Console.available('blips.save', 7)")
        self.assertTrue(ok)
        self.lua.execute("STARTED.w_map = true")
        ok, reason = self.lua.eval("WC.Console.available('blips.save', 7)")
        self.assertFalse(ok)
        self.assertEqual(reason, 'w_map_running')
        r = self.run_action('save', blip())
        self.assertEqual(r, {'ok': False, 'error': 'w_map_running'})
        self.assertEqual(self.published()['list'], [])

    def test_fivem_has_no_blips_page(self):
        self.lua.execute("GAME = 'gta5'")
        self.boot()
        ok, reason = self.lua.eval("WC.Console.available('blips.list', 7)")
        self.assertFalse(ok)
        self.assertEqual(reason, 'capability_missing')

    def test_w_map_start_and_stop_repackage_every_live_lease(self):
        self.boot()
        self.lua.execute(r'''
          S = { source = 7, nonce = 'n1', allowed = { ['blips.list'] = true, ['blips.save'] = true, ['query.self'] = true }, customRoles = {}, at = NOW, refreshAt = NOW }
          WC.Console.sessions[7] = S
          WC.Console.valid = function(s) return s == S end
        ''')
        self.lua.execute("STARTED.w_map = true")
        self.lua.execute("FIRE('onResourceStart', 'w_map')")
        self.assertEqual(len(plain(self.lua.eval('CLIENT'))), 0)  # waits for w_map to settle
        self.lua.execute('RUN_TIMERS()')
        sent = plain(self.lua.eval('CLIENT'))
        self.assertEqual(sent[-1]['name'], 'w_connector:console:permissions')
        self.assertEqual(sent[-1]['src'], 7)
        pkg = sent[-1]['payload']
        self.assertNotIn('blips.save', pkg['actions'])
        self.assertEqual(pkg['unavailable']['blips.save'], 'w_map_running')
        self.assertNotIn('blips', pkg['perms'])  # the page and its palette entry are hidden
        self.lua.execute("STARTED.w_map = nil; FIRE('onResourceStop', 'w_map'); RUN_TIMERS()")
        pkg = plain(self.lua.eval('CLIENT'))[-1]['payload']
        self.assertIn('blips.save', pkg['actions'])
        self.assertTrue(pkg['perms']['blips'])
        # another resource starting does nothing
        n = len(plain(self.lua.eval('CLIENT')))
        self.lua.execute("FIRE('onResourceStart', 'w_hud'); RUN_TIMERS()")
        self.assertEqual(len(plain(self.lua.eval('CLIENT'))), n)

    def test_request_refusal_carries_the_reason(self):
        src = text('ops/console.lua')
        self.assertIn("answer({ ok = false, error = 'capability_missing', data = reason and { reason = reason } or nil })", src)
        client = text('client/cl_console.lua')
        self.assertIn("type(r.data.reason) == 'string' and strings()[r.data.reason]", client)
        for lang in ('ar', 'en'):
            self.assertIn('/mapedit', json.loads(text(f'locales/{lang}.json'))['w_map_running'])

    # ── the store ──────────────────────────────────────────────────────────

    def test_add_edit_delete_keep_kvp_and_global_state(self):
        self.boot()
        r = self.run_action('save', blip(color='BLIP_MODIFIER_MP_COLOR_8'))
        self.assertTrue(r['ok'], r)
        b = r['data']['list'][0]
        self.assertEqual(b['id'], 'b1')
        self.assertEqual(b['by'], 'Wraith')
        pub = self.published()
        self.assertEqual(pub['list'][0], {'id': 'b1', 'name': 'مخزن الذهب', 'sprite': 'blip_shop_store',
                                          'color': 'BLIP_MODIFIER_MP_COLOR_8', 'x': 100.5, 'y': -200.25, 'z': 50.0, 'scale': 1.0})
        self.assertNotIn('by', pub['list'][0])
        rev = pub['rev']
        self.assertEqual(self.stored()['list'][0]['id'], 'b1')

        self.gap()
        r = self.run_action('save', blip(id='b1', name='البنك', scale=0.5))
        self.assertTrue(r['ok'], r)
        self.assertEqual([x['name'] for x in r['data']['list']], ['البنك'])
        self.assertNotIn('color', r['data']['list'][0])  # the colour was taken off
        self.assertGreater(self.published()['rev'], rev)

        self.gap()
        self.assertTrue(self.run_action('save', blip(name='الثاني'))['ok'])
        self.gap()
        r = self.run_action('delete', {'id': 'b1'})
        self.assertEqual([x['id'] for x in r['data']['list']], ['b2'])
        self.assertEqual([x['id'] for x in self.stored()['list']], ['b2'])
        self.assertEqual([x['id'] for x in self.published()['list']], ['b2'])

    def test_a_gone_blip_answers_with_the_fresh_list(self):
        self.boot()
        for action, data in (('delete', {'id': 'b9'}), ('save', blip(id='b9'))):
            self.gap()
            r = self.run_action(action, data)
            self.assertEqual(r['error'], 'err_blip_gone')
            self.assertIn('list', r['data'])

    def test_every_value_is_checked_again(self):
        self.boot()
        cases = [
            (blip(name='   '), 'err_blip_name'), (blip(name='^1^2'), 'err_blip_name'), (blip(name=5), 'err_blip_name'),
            (blip(name='ا' * 49), 'err_blip_name_long'),
            (blip(sprite='blip_not_a_sprite'), 'err_blip_sprite'), (blip(sprite='../x'), 'err_blip_sprite'),
            (blip(color='BLIP_MODIFIER_MP_COLOR_33'), 'err_blip_color'), (blip(color='COLOR_RED'), 'err_blip_color'),
            (blip(x=10001), 'err_blip_coords'), (blip(y='1'), 'err_blip_coords'), (blip(z=5000), 'err_blip_coords'),
            (blip(scale=0.1), 'err_blip_scale'), (blip(scale=3), 'err_blip_scale'),
        ]
        for data, key in cases:
            self.gap()
            r = self.run_action('save', data)
            self.assertFalse(r['ok'], data)
            self.assertEqual(r['error'], key, data)
        self.assertNotIn('wc_blips', plain(self.lua.eval('KVP')))

    def test_names_lose_colour_codes_and_game_tokens(self):
        self.boot()
        r = self.run_action('save', blip(name='  ^1محطة~COLOR_RED~\nالقطار  ', z=None))
        b = r['data']['list'][0]
        self.assertEqual(b['name'], 'محطة COLOR_RED القطار')
        self.assertNotIn('z', b)

    def test_double_press_and_the_limit(self):
        self.boot()
        self.assertTrue(self.run_action('save', blip())['ok'])
        self.assertEqual(self.run_action('save', blip())['error'], 'quick_cooldown')
        for _ in range(199):
            self.gap()
            self.assertTrue(self.run_action('save', blip())['ok'])
        self.gap()
        r = self.run_action('save', blip())
        self.assertEqual(r['error'], 'err_blip_full')
        self.assertEqual(len(self.published()['list']), 200)

    def test_restart_reads_the_kvp_and_drops_bad_rows(self):
        self.lua.globals().KVP['wc_blips'] = json.dumps({'seq': 7, 'list': [
            dict(blip(), id='b3', by='A', at=1), dict(blip(sprite='blip_nope'), id='b4'), dict(blip(), id='x'), 'junk']})
        self.boot()
        self.assertEqual([b['id'] for b in self.published()['list']], ['b3'])
        r = self.run_action('save', blip())
        self.assertEqual(r['data']['list'][-1]['id'], 'b8')

    def test_the_sprite_list_is_the_games(self):
        data = json.loads(text('core/blip_sprites.json'))
        names = [s['name'] for s in data['sprites']]
        self.assertEqual(len(names), 627)
        self.assertEqual(len(set(names)), len(names))
        self.assertTrue(all(re.fullmatch(r'blip_[a-z0-9_]+', n) for n in names))
        self.assertIn('blip_shop_store', names)
        self.assertTrue((ROOT / 'web/public/blips/sprites.webp').is_file())
        self.assertTrue((ROOT / 'web/build/blips/sprites.webp').is_file())


class Client(unittest.TestCase):
    def setUp(self):
        self.lua = lua54.LuaRuntime()
        self.lua.execute(CLIENT)

    def boot(self, state=None):
        if state is not None:
            self.lua.globals().GlobalState['w_connector:blips'] = self.lua.table_from(state, recursive=True)
        self.lua.execute(text('client/cl_blips.lua'))

    def natives(self, h):
        h = h - (1 << 64) if h >= 1 << 63 else h  # a hash over 0x7FFF... is a negative Lua integer
        return [plain(n['args']) for n in plain(self.lua.eval('NATIVES')) if n['hash'] == h]

    def change(self, state):
        self.lua.eval("BAGS['w_connector:blips']")('global', 'w_connector:blips', self.lua.table_from(state, recursive=True))

    STATE = {'rev': 1, 'list': [
        {'id': 'b1', 'name': 'البنك', 'sprite': 'blip_shop_store', 'color': 'BLIP_MODIFIER_MP_COLOR_2', 'x': 1, 'y': 2, 'z': 3, 'scale': 0.5},
        {'id': 'b2', 'name': 'Camp', 'sprite': 'blip_camp', 'x': 4, 'y': 5, 'scale': 1}]}

    def test_draws_every_blip_with_the_verified_natives(self):
        self.boot(self.STATE)
        self.assertEqual(self.lua.eval('COUNT()'), 2)
        adds = self.natives(0x554D9D53F696D002)
        self.assertEqual(adds[0], [1664425300, 1, 2, 3])
        self.assertEqual(adds[1], [1664425300, 4, 5, 0])
        self.assertEqual([a[1:] for a in self.natives(0x74F74D3207ED525C)], [['H:blip_shop_store', True], ['H:blip_camp', True]])
        self.assertEqual([a[1] for a in self.natives(0xD38744167B2FA257)], [0.5, 1])
        self.assertEqual([a[1] for a in self.natives(0x662D364ABF16DE2F)], ['H:blip_modifier_mp_color_2'])
        self.assertEqual([a[1] for a in self.natives(0x9CB1A1623062F402)], ['البنك', 'Camp'])
        # the name after the modifier (w_map's order)
        hashes = [n['hash'] % (1 << 64) for n in plain(self.lua.eval('NATIVES'))]
        self.assertLess(hashes.index(0x662D364ABF16DE2F), hashes.index(0x9CB1A1623062F402))

    def test_a_change_rebuilds_and_tells_an_open_page(self):
        self.boot(self.STATE)
        self.lua.execute('WMenu.open = true')
        self.change({'rev': 2, 'list': [self.STATE['list'][1]]})
        self.assertEqual(self.lua.eval('COUNT()'), 1)
        self.assertEqual(plain(self.lua.eval('NUI_SENT'))[-1], {'action': 'blipsRev', 'data': {'rev': 2}})

    def test_w_map_takes_them_off_and_gives_them_back(self):
        self.lua.execute("STARTED.w_map = true")
        self.boot(self.STATE)
        self.assertEqual(self.lua.eval('COUNT()'), 0)  # w_map already running: nothing drawn
        self.change(self.STATE)
        self.assertEqual(self.lua.eval('COUNT()'), 0)
        self.lua.execute("STARTED.w_map = nil; FIRE('onClientResourceStop', 'w_map'); RUN_TIMERS()")
        self.assertEqual(self.lua.eval('COUNT()'), 2)
        self.lua.execute("STARTED.w_map = true; FIRE('onClientResourceStart', 'w_map')")
        self.assertEqual(self.lua.eval('COUNT()'), 0)

    def test_own_stop_removes_them(self):
        self.boot(self.STATE)
        self.lua.execute("FIRE('onResourceStop', 'w_hud')")
        self.assertEqual(self.lua.eval('COUNT()'), 2)
        self.lua.execute("FIRE('onResourceStop', 'w_connector')")
        self.assertEqual(self.lua.eval('COUNT()'), 0)

    def test_fivem_draws_nothing(self):
        self.lua.execute("function GetGameName() return 'fivem' end")
        self.boot(self.STATE)
        self.assertEqual(self.lua.eval('COUNT()'), 0)

    def test_where_answers_only_while_the_console_is_open(self):
        self.lua.execute(r'''
          function GetEntityCoords() return { x = 1.5, y = 2.5, z = 3.5 } end
          function PlayerPedId() return 1 end
          WP = false
          function IsWaypointActive() return WP end
          function GetWaypointCoords() return { x = 10, y = 20, z = 0 } end
          function GetGroundZFor_3dCoord() return true, 44.0 end
        ''')
        self.boot()
        cb = self.lua.eval("NUI.blipsWhere")
        got = []
        cb(self.lua.table_from({'what': 'me'}), lambda r: got.append(plain(r)))
        self.assertEqual(got[-1], {'ok': False, 'errorKey': 'no_session'})
        self.lua.execute('WMenu.open = true')
        cb(self.lua.table_from({'what': 'me'}), lambda r: got.append(plain(r)))
        self.assertEqual(got[-1], {'ok': True, 'data': {'x': 1.5, 'y': 2.5, 'z': 3.5}})
        cb(self.lua.table_from({'what': 'waypoint'}), lambda r: got.append(plain(r)))
        self.assertEqual(got[-1], {'ok': False, 'errorKey': 'err_no_waypoint'})
        self.lua.execute('WP = true')
        cb(self.lua.table_from({'what': 'waypoint'}), lambda r: got.append(plain(r)))
        self.assertEqual(got[-1], {'ok': True, 'data': {'x': 10, 'y': 20, 'z': 44.0}})


class Wiring(unittest.TestCase):
    def test_manifest_loads_both_halves_after_the_console(self):
        m = text('fxmanifest.lua')
        self.assertRegex(m, r"version '2\.4\.\d+'")  # the blips arrived in 2.4.0
        self.assertLess(m.index("'ops/console.lua'"), m.index("'ops/native_blips.lua'"))
        self.assertLess(m.index("'client/cl_console.lua'"), m.index("'client/cl_blips.lua'"))

    def test_page_is_hidden_without_its_area_and_nui_routes_it(self):
        self.assertIn("area: 'blips'", text('web/src/pages/blips/index.tsx'))
        self.assertIn("'blips'", text('web/src/nui.ts'))
        self.assertIn("'bans', 'blips' }", text('client/cl_console.lua'))
        # teleport reuses the console's own self.tpCoords (self.teleport on the website), no new power
        self.assertIn("action: 'tpCoords'", text('web/src/pages/blips/BlipsPage.tsx'))


if __name__ == '__main__':
    unittest.main()
