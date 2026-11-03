"""2.4.2: every console action, end to end, without a game client.

One case per thing a page, the quick menu or a chat command sends. Each case goes the whole way:

  page payload (JSON, as JSON.stringify writes it)
    -> client/cl_console.lua, the REAL NUI callback (the payload as Lua sees it: nulls gone, {} and []
       the same empty table)
    -> TriggerServerEvent('w_connector:console:request') -> ops/console.lua (session, target binding)
    -> WC.request: the body as FXServer's OWN json.encode writes it (tests/fixtures/fxserver_json.lua,
       dkjson: an empty table is [], a float 5.0 is "5.0")
    -> the website's REAL consolePolicy.ts (tests/roundtrip_bridge.mts under the website's tsx): accepted?
    -> the console.run command it queues, decoded by the same json.decode the command loop uses
    -> the Lua handler (fake w_core / w_inventory / w_hud / w_weathersync / w_map / w_pausemenu ...)
    -> the answer back on the client (and what a client tool would be asked to do).

The website copy is found at $WC_WEBSITE_ROOT, else ../website beside this clone (the stage layout). Without
it the test is skipped: the point is the real website schema, not a copy of it.
"""
from pathlib import Path
import json
import os
import subprocess
import unittest

from lupa import lua54

ROOT = Path(__file__).resolve().parents[1]
DKJSON = (ROOT / 'tests' / 'fixtures' / 'fxserver_json.lua').read_text(encoding='utf-8')


def website_root():
    for c in (os.environ.get('WC_WEBSITE_ROOT'), ROOT.parent / 'website',
              Path('F:/Server RedM/Wraith Core/ops/local/unified-admin-v3/stage/website')):
        if c and (Path(c) / 'src/features/gamePanel/consolePolicy.ts').exists() and (Path(c) / 'node_modules/tsx/dist/cli.mjs').exists():
            return Path(c)
    return None


def text(rel):
    return (ROOT / rel).read_text(encoding='utf-8-sig')


def manifest_server_scripts():
    import re
    m = re.search(r'server_scripts\s*\{([\s\S]*?)\}', text('fxmanifest.lua'))
    block = re.sub(r'--.*$', '', m.group(1), flags=re.M)
    return [f for f in re.findall(r"'([^']+)'", block) if not f.startswith('@')]


# ── the server ────────────────────────────────────────────────────────────────────────────────────
SERVER = r'''
NOW = 100000
LOG, TIMERS, CONVARS, RESOURCES, RES_LIST, PLAYERS, EXPORTS, KVP, META = {}, {}, { gamename = 'rdr3' }, {}, {}, {}, {}, {}, {}
CLIENT_EVENTS, EXECUTED, COMMANDS, STARTED, STOPPED, KICKED, EVENTS, MOVED, FROZEN = {}, {}, {}, {}, {}, {}, {}, {}, {}
function print(...) local t = {} for i = 1, select('#', ...) do t[#t+1] = tostring((select(i, ...))) end LOG[#LOG+1] = table.concat(t, ' ') end
function GetConvar(name, default) local v = CONVARS[name] if v == nil then return default end return v end
function GetConvarInt(name, default) local v = CONVARS[name] if v == nil then return default end return math.tointeger(tonumber(v)) or default end
function GetResourceState(name)
    if RESOURCES[name] then return 'started' end
    for _, r in ipairs(RES_LIST) do if r == name then return 'stopped' end end
    return 'missing'
end
function GetResourceMetadata(name, key) if META[name .. ':' .. key] ~= nil then return META[name .. ':' .. key] end if key == 'version' then return RESOURCES[name] end return nil end
function GetCurrentResourceName() return 'w_connector' end
function GetGameName() return 'fxserver' end
function GetGameTimer() return NOW end
function GetPlayers() local out = {} for src in pairs(PLAYERS) do out[#out+1] = tostring(src) end table.sort(out) return out end
function GetPlayerName(src) local p = PLAYERS[tonumber(src)] return p and p.name or nil end
function GetPlayerPing() return 40 end
function GetNumPlayerIdentifiers(src) local p = PLAYERS[tonumber(src)] return p and #p.ids or 0 end
function GetPlayerIdentifier(src, i) return PLAYERS[tonumber(src)].ids[i + 1] end
function GetPlayerEndpoint() return '127.0.0.1' end
function SetTimeout(ms, fn) TIMERS[#TIMERS+1] = fn end
ALL_HANDLERS, NET = {}, {}
function AddEventHandler(name, fn) ALL_HANDLERS[name] = ALL_HANDLERS[name] or {} table.insert(ALL_HANDLERS[name], fn) end
function RegisterNetEvent(name, fn) if fn then NET[name] = fn end end
function FIRE(name, src, ...) source = src for _, fn in ipairs(ALL_HANDLERS[name] or {}) do fn(...) end if NET[name] then NET[name](...) end end
function TriggerEvent(name, ...) EVENTS[#EVENTS+1] = { name = name, args = { ... } } end
function DropPlayer(src, reason) KICKED[#KICKED+1] = { src = src, reason = reason } end
function GetNumResources() return #RES_LIST end
function GetResourceByFindIndex(i) return RES_LIST[i + 1] end
function StartResource(n) STARTED[#STARTED+1] = n end
function StopResource(n) STOPPED[#STOPPED+1] = n end
function IsPrincipalAceAllowed() return 1 end
function IsPlayerAceAllowed() return true end
function ExecuteCommand(c) COMMANDS[#COMMANDS+1] = c end
function RegisterCommand() end
function GetPlayerPed(src) local p = PLAYERS[tonumber(src)] if not p then return 0 end return 1000 + tonumber(src) end
local function byPed(ped) return PLAYERS[ped - 1000] end
-- a world entity (not a player's ped) stands one metre beside the admin
function GetEntityCoords(e) local p = byPed(e) local c = p and p.pos or { PLAYERS[1].pos[1] + 1, PLAYERS[1].pos[2], PLAYERS[1].pos[3] } return { x = c[1], y = c[2], z = c[3] } end
function GetEntityHeading() return 90.0 end
function GetEntityHealth() return 600 end
function GetEntityMaxHealth() return 600 end
function SetEntityCoords(ped, x, y, z) MOVED[#MOVED+1] = { ped - 1000, x, y, z } end
function FreezeEntityPosition(ped, state) FROZEN[ped - 1000] = state end
function GetHashKey(s) return #tostring(s) end
function GetPlayerRoutingBucket() return 0 end
function GetEntityRoutingBucket() return 0 end
function SetPlayerRoutingBucket() end
ENTITIES = {}
function GetAllVehicles() return { 5001 } end
function GetAllPeds() return { 5002 } end
function GetAllObjects() return { 5003 } end
function DoesEntityExist(e) return ENTITIES[e] ~= false and e ~= 0 and e ~= nil end
function DeleteEntity(e) ENTITIES[e] = false end
function Entity() return { state = {} } end
function GetEntityType() return 3 end
function GetVehiclePedIsIn() return 0 end
function NetworkGetEntityFromNetworkId(n) return 6000 + n end
function GetConsoleBuffer() return '' end
GlobalState = {}
function GetResourceKvpString(k) return KVP[k] end
function GetResourceKvpInt(k) return tonumber(KVP[k]) or 0 end
function SetResourceKvp(k, v) KVP[k] = v end
function SetResourceKvpInt(k, v) KVP[k] = v end
function SaveResourceFile() return true end
function Wait() end
function CreateThread() end
promise = { new = function()
    local p = { done = false }
    function p:resolve(v) if not self.done then self.done = true; self.value = v end end
    function p:reject(v) if not self.done then self.done = true; self.value = v end end
    return p
end }
Citizen = { Await = function(p)
    while not p.done and #TIMERS > 0 do table.remove(TIMERS, 1)() end
    return p.value
end, CreateThread = function(fn) fn() end, Wait = function() end, SetTimeout = SetTimeout }
OWN_EXPORTS = {}
exports = setmetatable({}, { __index = function(_, res) return EXPORTS[res] end, __call = function(_, name, fn) OWN_EXPORTS[name] = fn end })
-- oxmysql
SQL = {}
local function sql(kind) return { await = function(q, p) SQL[#SQL+1] = { kind = kind, sql = q, p = p } return SQL_ANSWER(kind, q, p) end } end
MySQL = { query = sql('query'), single = sql('single'), insert = sql('insert'), update = sql('update'), scalar = sql('scalar'), prepare = sql('prepare') }
function SQL_ANSWER(kind, q)
    if kind == 'insert' then return 7 end
    if kind == 'update' then return 1 end
    if kind == 'single' then
        if q:find('FROM players WHERE citizenid') then
            return { citizenid = 'OMG95204', cid = 1, license = 'license:bbb', name = 'John', charinfo = '{"firstname":"John","lastname":"Marston"}',
                job = '{"name":"unemployed","label":"Unemployed","grade":{"level":0}}', gang = '{"name":"none"}', money = '{"cash":10,"bank":20,"gold":1}', last_updated = 1 }
        end
        if q:find('w_admin_settings_presets') then return { id = 3, name = 'p', data = '{"resources":{}}', created_by = 'x', created_at = 1 } end
        return nil
    end
    if kind == 'scalar' then return 0 end
    if q:find('FROM players') then
        return { { citizenid = 'OMG95204', cid = 1, license = 'license:bbb', name = 'John', charinfo = '{"firstname":"John","lastname":"Marston"}',
            job = '{"name":"unemployed","label":"Unemployed","grade":{"level":0}}', gang = '{"name":"none"}', money = '{"cash":10}', last_updated = 1 } }
    end
    return {}
end
'''

# The live server's own stack, faked: w_core (+ its offline / character exports), w_centralbank, w_inventory,
# w_hud (WSettings), w_weathersync, w_map, w_creators, w_pausemenu, chat, w_medic.
FAKES = r'''
PLAYERS[1] = { name = 'Staff', ids = { 'license:aaa', 'discord:111111111111111111' }, pos = { 10.5, 20.25, 30.0 } }
PLAYERS[2] = { name = 'John', ids = { 'license:bbb', 'discord:222222222222222222' }, pos = { -120.75, 640.5, 112.0 } }
CHARS = { [1] = { citizenid = 'ADM00001', firstname = 'Sadie', lastname = 'Adler' }, [2] = { citizenid = 'OMG95204', firstname = 'John', lastname = 'Marston' } }
MONEY = { [1] = { cash = 100, bank = 50, gold = 2 }, [2] = { cash = 300, bank = 0, gold = 1.5 } }
JOBS = { unemployed = { label = 'Unemployed', grades = { ['0'] = { name = 'Freelancer' } } },
    sheriff = { label = 'Sheriff', grades = { ['0'] = { name = 'Deputy' }, ['1'] = { name = 'Sheriff' } } } }
GANGS = { none = { label = 'No gang', grades = { ['0'] = { name = 'None' } } }, odriscoll = { label = "O'Driscoll", grades = { ['0'] = { name = 'Member' } } } }
CALLS = {}
local function rec(name, ...) CALLS[#CALLS+1] = { name = name, args = { ... } } end
local function player(src)
    local c = CHARS[tonumber(src)]
    if not c then return nil end
    local p = { PlayerData = { citizenid = c.citizenid, charinfo = { firstname = c.firstname, lastname = c.lastname },
        job = { name = 'unemployed', label = 'Unemployed', grade = { level = 0 } }, gang = { name = 'none' },
        metadata = { hunger = 50, thirst = 60, isdead = false } }, Functions = {} }
    local m = MONEY[tonumber(src)]
    p.Functions.GetMoney = function(acc) return m[acc] end
    p.Functions.AddMoney = function(acc, n) rec('AddMoney', src, acc, n) m[acc] = m[acc] + n return true end
    p.Functions.RemoveMoney = function(acc, n) rec('RemoveMoney', src, acc, n) m[acc] = m[acc] - n return true end
    p.Functions.SetJob = function(j, g) rec('SetJob', src, j, g) return JOBS[j] ~= nil end
    p.Functions.SetGang = function(j, g) rec('SetGang', src, j, g) return GANGS[j] ~= nil end
    p.Functions.SetMetaData = function(k, v) rec('SetMetaData', src, k, v) end
    p.Functions.SetPlayerData = function() end
    p.Functions.Save = function() end
    return p
end
CORE = { Functions = { GetPlayer = player, GetOfflinePlayerByCitizenId = function(cid) return player(2) end },
    Shared = { GetJob = function(n) return JOBS[n] end, GetGang = function(n) return GANGS[n] end,
        GetJobs = function() return JOBS end, GetGangs = function() return GANGS end, GetHorses = function() return {} end, GetVehicles = function() return {} end } }
-- every other w_core export answers yes, recorded (ResolveCitizen, BlockCharacter, ReassignCitizenId ...)
local W_CORE = {
    GetCoreObject = function() return CORE end,
    ResolveCitizen = function(_, input) rec('ResolveCitizen', input) return { citizenid = 'OMG95204', online = true, source = 2 } end,
    NormalizeCitizenId = function(_, v) v = tostring(v or ''):upper() if v:match('^[%w]+$') then return v end return nil end,
    GetCharacterBlock = function() return nil end,
    CharacterDependencies = function() return {} end,
    RanksState = function() return { ranks = {}, members = {} } end,
}
EXPORTS.w_core = setmetatable(W_CORE, { __index = function(_, name) return function(_, ...) rec('w_core.' .. name, ...) return true, {} end end })
EXPORTS.w_centralbank = { IsReady = function() return true end, AdjustPlayer = function(_, ...) rec('AdjustPlayer', ...) return true end }
EXPORTS.w_inventory = setmetatable({
    GetInventoryItems = function() return {} end,
    AddItem = function(_, src, name, count) rec('AddItem', src, name, count) return true end,
    RemoveItem = function() return true end,
    CanCarryItem = function() return true end,
    Items = function() return { bread = { label = 'Bread', weight = 1 } } end,
    ClearInventory = function(_, src) rec('ClearInventory', src) end,
    forceOpenInventory = function(_, actor, kind, target) rec('forceOpenInventory', actor, kind, target) return true end,
}, { __index = function(_, name) return function(_, ...) rec('w_inventory.' .. name, ...) return true end end })
EXPORTS.w_lib = setmetatable({}, { __index = function(_, name) return function(_, ...) rec('w_lib.' .. name, ...) return true end end })
NEEDS = { [1] = { hunger = 40, thirst = 50 }, [2] = { hunger = 40, thirst = 50 } }
HUD_SCHEMA = { resource = 'w_hud', version = 1, title = { ar = 'الواجهة', en = 'HUD' }, description = { ar = '', en = '' },
  links = { { id = 'hudmenu', command = 'hudmenu' } },
  groups = { { id = 'needs', store = 'own', fields = { { key = 'needs.rate', type = 'number', min = 0, max = 25, step = 0.1 } } } } }
EXPORTS.w_hud = {
  WSettingsSchema = function() return HUD_SCHEMA end,
  WSettingsValues = function() return { values = { ['needs.rate'] = 1 }, defaults = { ['needs.rate'] = 1 }, overridden = {}, orphans = {} } end,
  WSettingsApplyConnector = function(_, changes, actor)
    rec('WSettingsApplyConnector', changes)
    local applied = {}
    for i, c in ipairs(changes) do applied[i] = { key = c.key, value = c.to, old = c.from, reset = c.reset } end
    return { ok = true, applied = applied, rejected = {}, batch = 'b1' }
  end,
  SaveServerHudCfg = function(_, cfg, src) rec('SaveServerHudCfg', cfg, src) return true, cfg end,
  GetServerHudCfg = function() return { needs = { interval = 144 } } end,
  GetNeedsPair = function(_, src) local s = NEEDS[src] if not s then return nil end return { hunger = s.hunger, thirst = s.thirst } end,
  SetNeed = function(_, src, key, v) rec('SetNeed', src, key, v) NEEDS[src][key] = v return true end,
  Announce = function(_, text, seconds, opts) rec('Announce', text, seconds, opts) return true end,
  ClearAnnouncement = function() rec('ClearAnnouncement') return true end,
  SplitDuration = function(_, msg) return 10, msg end,
}
WEATHER = { weather = 'SUNNY', frozen = false, dynamic = true, blackout = false }
EXPORTS.w_weathersync = {
  getWeatherState = function() return { weather = WEATHER.weather } end,
  setWeather = function(_, w) rec('setWeather', w) WEATHER.weather = w return true end,
  setTime = function(_, h, m) rec('setTime', h, m) return true end,
  GetTime = function() return { hour = 12, minute = 30 } end,
  getTimeFreezeState = function() return WEATHER.frozen end,
  getDynamicWeather = function() return WEATHER.dynamic end,
  getBlackoutState = function() return WEATHER.blackout end,
  setTimeFreeze = function(_, s) rec('setTimeFreeze', s) WEATHER.frozen = s return s end,
  setDynamicWeather = function(_, s) rec('setDynamicWeather', s) WEATHER.dynamic = s return s end,
  setBlackout = function(_, s) rec('setBlackout', s) WEATHER.blackout = s return s end,
  GetWeatherTypes = function() return { 'SUNNY', 'RAIN' } end,
}
EXPORTS.w_creators = { OpenWardrobe = function(_, target) rec('OpenWardrobe', target) return { ok = true } end }
NEWS = { { id = 'n1', title = { ar = 'خبر', en = 'News' }, text = { ar = 'نص' }, image = 'news/saloon.webp' } }
EXPORTS.w_pausemenu = { GetNews = function() return NEWS end, SetNews = function(_, list) rec('SetNews', list) NEWS = list return true end,
  ResetNews = function() rec('ResetNews') return true end }
EXPORTS.w_guard = { AllowFlag = function() return true end, AllowMove = function() return true end, ExpectEntity = function() return true end }
RESOURCES = { w_core = '1.0.0', w_centralbank = '2.0.0', w_inventory = '2.0.0', w_hud = '2.1.4', w_weathersync = '1.0.0',
    w_creators = '1.0.2', w_pausemenu = '2.0.3', chat = '1.0', w_medic = '1.0.3', oxmysql = '2.0', w_store = '1.1', w_shops = '1.0' }
RES_LIST = { 'w_core', 'w_centralbank', 'w_inventory', 'w_hud', 'w_weathersync', 'w_creators', 'w_pausemenu', 'chat', 'w_medic',
    'oxmysql', 'w_store', 'w_shops', 'w_map', 'w_test_plain' }
META['w_hud:w_settings'] = 'yes'
'''


def lua_value(rt, v):
    """Python data -> a Lua value of runtime `rt` (dicts keep their key types, lists are 1..n)."""
    if isinstance(v, dict):
        t = rt.table()
        for k, x in v.items():
            t[k] = lua_value(rt, x)
        return t
    if isinstance(v, list):
        t = rt.table()
        for i, x in enumerate(v):
            if x is not None:
                t[i + 1] = lua_value(rt, x)
        return t
    return v


def py_value(v):
    """A Lua value -> Python data, keeping integer / string keys and integer / float numbers apart."""
    if hasattr(v, 'items'):
        return {k: py_value(x) for k, x in v.items()}
    return v


def as_json(v):
    """A Lua table read with py_value -> plain JSON-ish data for the report (1..n tables as lists)."""
    if isinstance(v, dict):
        keys = list(v.keys())
        if keys and all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [as_json(v[i]) for i in range(1, len(keys) + 1)]
        return {str(k): as_json(x) for k, x in v.items()}
    return v


# ── the client ────────────────────────────────────────────────────────────────────────────────────
CLIENT = r'''
NOW = 100000
SERVER_EVENTS, NUI, NETC, NUI_MSGS, LOCAL_EXEC, CLIENT_COMMANDS = {}, {}, {}, {}, {}, {}
function GetGameName() return 'redm' end
function GetGameTimer() return NOW end
function GetResourceKvpString() return nil end
function SetResourceKvp() end
function GetCurrentResourceName() return 'w_connector' end
function GetInvokingResource() return nil end
function GetResourceState(name) if name == 'w_admin' then return 'missing' end return 'started' end
function IsPauseMenuActive() return false end
function IsNuiFocused() return false end
function SetTimeout() end
function CreateThread() end
function Wait() end
function PlayerId() return 0 end
function GetPlayerName() return 'Staff' end
function ExecuteCommand(c) CLIENT_COMMANDS[#CLIENT_COMMANDS+1] = c end
function TriggerServerEvent(name, ...) SERVER_EVENTS[#SERVER_EVENTS+1] = { name = name, args = table.pack(...) } end
function TriggerEvent() end
function RegisterCommand() end
function RegisterKeyMapping() end
function RegisterNetEvent(name, fn) if fn then NETC[name] = fn end end
function AddEventHandler(name, fn) NETC[name] = NETC[name] or fn end
function RegisterNUICallback(name, fn) NUI[name] = fn end
function SendNUIMessage(m) NUI_MSGS[#NUI_MSGS+1] = m end
function SetNuiFocus() end
function SetNuiFocusKeepInput() end
exports = setmetatable({}, { __call = function() end, __index = function() return setmetatable({}, { __index = function() return function() end end }) end })
WConsoleTools = { modes = {}, execute = function(name, a) LOCAL_EXEC[#LOCAL_EXEC+1] = { name = name, args = a } return { ok = true } end,
    state = function() return {} end, stop = function() end }
'''


class Bridge:
    """The website's consolePolicy.ts, one process for the whole run."""

    def __init__(self, site):
        tsx = site / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
        self.p = subprocess.Popen(['node', str(tsx), str(ROOT / 'tests' / 'roundtrip_bridge.mts'), str(site)], cwd=str(site),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, encoding='utf-8', shell=False)
        first = json.loads(self.p.stdout.readline())
        assert first.get('ready'), first
        self.actions = set(first['actions'])

    def ask(self, body):
        self.p.stdin.write(json.dumps({'body': body}) + '\n')
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(10)
        except Exception:  # noqa: BLE001
            self.p.kill()


class Harness:
    def __init__(self, bridge, framework=''):
        self.bridge = bridge
        self.trace = None
        # the server
        s = lua54.LuaRuntime(unpack_returned_tuples=True)
        s.execute(SERVER)
        s.execute(DKJSON)
        s.execute(FAKES)
        if framework:
            s.execute(FRAMEWORKS[framework])
        files = {}
        for rel in ('core/console_contract.json', 'core/console_models.json', 'core/blip_sprites.json', 'locales/ar.json', 'locales/en.json'):
            if (ROOT / rel).exists():
                files[rel] = text(rel)
        s.globals().LoadResourceFile = lambda _res, name: files.get(name)
        for rel in manifest_server_scripts():
            s.execute(text(rel))
        s.execute('WC.Adapters.detect()')
        s.globals().WEBSITE = self._website
        s.execute(r'''
function CreateThread(fn) fn() end
function WC.linked() return true end
WEB_SESSION = nil
function WC.request(method, route, payload)
    local body = payload ~= nil and json.encode(payload) or ''
    if route == '/ingame/console/session' then return 200, json.decode(WEB_SESSION) end
    if route == '/ingame/console' then
        local status, res = WEBSITE(body)
        return status, res and json.decode(res) or nil
    end
    return 200, { ok = true }
end
-- the admin's game: a client tool runs and answers (cl_console_tools.lua is not loaded here; what it is asked
-- is kept in EXECUTED and checked by the case)
CLIENT_REPLY = nil
function TriggerClientEvent(name, target, ...)
    local args = { ... }
    CLIENT_EVENTS[#CLIENT_EVENTS+1] = { name = name, target = target, args = args }
    if name == 'w_connector:console:execute' then
        EXECUTED[#EXECUTED+1] = { target = target, name = args[2], args = args[3], ctxTarget = args[4] }
        local reply = CLIENT_REPLY or { ok = true, active = type(args[3]) == 'table' and args[3].state == true, data = {} }
        local keep = source
        FIRE('w_connector:console:executed', target, args[1], reply)
        source = keep
    end
end
''')
        self.s = s
        self.contract = json.loads(text('core/console_contract.json'))
        session = {'ok': True, 'role': 'owner', 'customRoles': [], 'actions': sorted(self.contract),
                   # the owner: every console permission, and the owner-only console.command (hub 'god' commands)
                   'permissions': sorted({d['permission'] for d in self.contract.values()} | {'console.command'})}
        s.globals().WEB_SESSION = json.dumps(session)
        # the client
        c = lua54.LuaRuntime(unpack_returned_tuples=True)
        c.execute(CLIENT)
        c.execute(DKJSON)
        c.globals().LoadResourceFile = lambda _res, name: files.get(name)
        c.execute(text('client/cl_console.lua'))
        c.execute('''
WMenu.selfState = function() return {} end
WMenu.applySelf = function() return { ok = true } end
WMenu.stopSpectate = function() end
''')
        self.c = c

    # the website, as WC.request reaches it: (status, JSON text of the answer)
    def _website(self, body):
        self.trace['sent'] = json.loads(body)
        r = self.bridge.ask(body)
        self.trace['website'] = {k: v for k, v in r.items() if k != 'command'}
        if r['status'] != 200:
            return r['status'], json.dumps({'ok': False, 'error': r.get('error', 'invalid_args')})
        if r.get('web'):
            return 200, json.dumps({'ok': True, 'data': {}})
        cmd = r['command']
        self.trace['queued'] = json.loads(cmd)
        # the command loop: json.decode of what the website queued, then the op (ops/ingame.lua answers the waiter)
        g = self.s.globals()
        g.CMD_TEXT = cmd
        ok, err = self.s.execute('local a = json.decode(CMD_TEXT); return WC.Ops.run("console.run", a)')
        self.trace['handler'] = [ok, py_value(err) if not isinstance(err, (str, int, float, bool, type(None))) else err]
        answer = {'ok': True, 'queued': True}
        for k in ('banId', 'warningId', 'count'):
            if k in r:
                answer[k] = r[k]
        return 200, json.dumps(answer)

    def reset(self):
        self.s.execute('''
NOW = NOW + 6000
CLIENT_EVENTS, EXECUTED, COMMANDS, EVENTS, CALLS, LOG = {}, {}, {}, {}, {}, {}
CLIENT_REPLY = nil
FIRE('w_connector:console:open', 1)
''')
        nonce = self.s.eval('WC.Console.sessions[1] and WC.Console.sessions[1].nonce')
        assert nonce, 'no console session: ' + repr(list(self.s.globals().LOG.values()))
        g = self.c.globals()
        g.NOW = self.s.globals().NOW
        self.c.execute('SERVER_EVENTS, NUI_MSGS, LOCAL_EXEC, CLIENT_COMMANDS = {}, {}, {}, {}')
        actions = self.c.table()
        for name in self.contract:
            actions[name] = True
        sess = self.c.table()
        sess.actions, sess.at, sess.lease, sess.nonce = actions, g.NOW, 45000, nonce
        sess.list, sess.perms = self.c.table(), self.c.table()
        g.WConsole.session = sess
        g.WMenu.open = True
        return nonce

    def run(self, kind, payload, setup=None):
        """One page call: the NUI callback `kind` with `payload` (JSON text rules), the whole way."""
        self.trace = {}
        self.reset()
        if setup:
            self.s.execute(setup)
        c = self.c
        # NUI -> Lua: the JSON body as Lua tables (no metatables, a null is simply absent)
        c.globals().NUI_BODY = json.dumps(payload, ensure_ascii=False)
        c.execute('NUI_DATA = json.decode(NUI_BODY, 1, nil, nil, nil)')
        c.execute('UI_RESULT = nil; local fn = NUI[NUI_KIND]; fn(NUI_DATA, function(r) UI_RESULT = r end)'.replace('NUI_KIND', repr(kind)))
        return self.finish()

    def finish(self):
        c, s = self.c, self.s
        events = [py_value(e) for e in c.globals().SERVER_EVENTS.values()]
        req = [e for e in events if e['name'] == 'w_connector:console:request']
        self.trace['local'] = as_json(py_value(c.globals().LOCAL_EXEC))
        if req:
            a = req[-1]['args']
            rid, name, data, nonce = a[1], a[2], a[3], a[4]
            self.trace['action'] = name
            self.trace['lua_data'] = as_json(data)
            g = s.globals()
            g.REQ_DATA = lua_value(s, data)
            g.REQ_ID, g.REQ_NAME, g.REQ_NONCE = rid, name, nonce
            s.execute("FIRE('w_connector:console:request', 1, REQ_ID, REQ_NAME, REQ_DATA, REQ_NONCE)")
            res = [py_value(e) for e in s.globals().CLIENT_EVENTS.values() if e['name'] == 'w_connector:console:result']
            if res:
                r = res[-1]['args']
                c.globals().RES_ID, c.globals().RES_NONCE = r[1], r[3]
                c.globals().RES = lua_value(c, r[2])
                c.execute("NETC['w_connector:console:result'](RES_ID, RES, RES_NONCE)")
        result = c.globals().UI_RESULT
        self.trace['result'] = as_json(py_value(result)) if result is not None else None
        self.trace['executed'] = as_json(py_value(s.globals().EXECUTED))
        self.trace['log'] = [x for x in s.globals().LOG.values()]
        self.trace['calls'] = as_json(py_value(s.globals().CALLS))
        self.trace['nui'] = as_json(py_value(c.globals().NUI_MSGS))
        return self.trace

    def chat(self, name, data):
        """A chat command's call: C.runAs(src 1, name, data) as ops/native_commands.lua makes it."""
        self.trace = {'action': name}
        self.reset()
        g = self.s.globals()
        g.RUN_DATA = lua_value(self.s, data)
        g.RUN_NAME = name
        r = self.s.eval('WC.Console.runAs(1, RUN_NAME, RUN_DATA)')
        self.trace['result'] = as_json(py_value(r))
        self.trace['executed'] = as_json(py_value(g.EXECUTED))
        self.trace['log'] = [x for x in g.LOG.values()]
        self.trace['calls'] = as_json(py_value(g.CALLS))
        return self.trace


# ── the cases: (id, NUI callback, payload as the page sends it, expected, check) ─────────────────
# expected: 'ok' | 'local' (answered on the client, never sent) | an error key the stubs make on purpose.
# `client`: what the admin's (or the target's) client tool must be asked, the fields it reads.
P2 = {'citizenid': 'OMG95204'}          # a player picked from the list (players/shared.ts playerPayload)
ME = {'id': 1}                           # the admin himself (tools.ts refill, quick menu)
CASES = [
    # players: the drawer, the dashboard desk, the map card, the quick menu (pages/players/tabs/*.tsx ...)
    ('player.teleportTo', 'player', {**P2, 'action': 'teleportTo', 'args': {}}, 'ok', None),
    ('player.bring', 'player', {**P2, 'action': 'bring', 'args': {}}, 'ok', None),
    ('player.bringBack', 'player', {**P2, 'action': 'bringBack', 'args': {}}, 'ok', None),   # after the bring above
    ('player.bringBack(again)', 'player', {**P2, 'action': 'bringBack', 'args': {}}, 'nothing_to_return_to', None),
    ('player.tpCoords', 'player', {**P2, 'action': 'tpCoords', 'args': {'x': -100.5, 'y': 200.25, 'z': 50}}, 'ok', None),
    ('player.tpCoords(no z)', 'player', {**P2, 'action': 'tpCoords', 'args': {'x': -100.5, 'y': 200.25}}, 'ok',
     {'self.tpCoords': ('x', 'y')}),
    ('player.revive', 'player', {**P2, 'action': 'revive', 'args': {}}, 'ok', None),
    ('player.heal', 'player', {**P2, 'action': 'heal', 'args': {}}, 'ok', None),
    ('player.needs', 'player', {**P2, 'action': 'needs', 'args': {'hunger': 80, 'thirst': 70, 'stamina': 100}}, 'ok', None),
    ('player.needs(refill self)', 'player', {**ME, 'action': 'needs', 'args': {'hunger': 100, 'thirst': 100}}, 'ok', None),
    ('player.setJob', 'player', {**P2, 'action': 'setJob', 'args': {'name': 'sheriff', 'grade': 1}}, 'ok', None),
    ('player.setGang', 'player', {**P2, 'action': 'setGang', 'args': {'name': 'odriscoll', 'grade': 0}}, 'ok', None),
    ('player.money add', 'player', {**P2, 'action': 'money', 'args': {'type': 'cash', 'op': 'add', 'amount': 50, 'reason': 'event prize'}}, 'ok', None),
    ('player.money gold cents', 'player', {**P2, 'action': 'money', 'args': {'type': 'gold', 'op': 'remove', 'amount': 0.5, 'reason': ''}}, 'ok', None),
    ('player.money set', 'player', {**P2, 'action': 'money', 'args': {'type': 'bank', 'op': 'set', 'amount': 0, 'reason': ''}}, 'ok', None),
    ('player.giveItem', 'player', {**P2, 'action': 'giveItem', 'args': {'item': 'bread', 'count': 3}}, 'ok', None),
    ('player.clearInventory', 'player', {**P2, 'action': 'clearInventory', 'args': {}}, 'ok', None),
    ('player.openInventory', 'player', {**P2, 'action': 'openInventory', 'args': {}}, 'ok', None),
    ('player.wardrobe', 'player', {**P2, 'action': 'wardrobe', 'args': {}}, 'ok', None),
    ('player.kick', 'player', {**P2, 'action': 'kick', 'args': {'reason': 'afk'}}, 'ok', None),
    ('player.ban', 'player', {**P2, 'action': 'ban', 'args': {'reason': 'cheating', 'duration': 1440}}, 'ok', None),
    ('player.ban(permanent)', 'player', {**P2, 'action': 'ban', 'args': {'reason': 'cheating', 'duration': 0}}, 'ok', None),
    ('player.freeze', 'player', {**P2, 'action': 'freeze', 'args': {'state': True}}, 'ok', None),
    ('player.unfreeze', 'player', {**P2, 'action': 'freeze', 'args': {'state': False}}, 'ok', None),
    ('player.spectate', 'player', {**P2, 'action': 'spectate', 'args': {'state': True}}, 'ok', {'player.spectate': ('state', 'coords')}),
    ('player.notify', 'player', {**P2, 'action': 'notify', 'args': {'text': 'hello'}}, 'ok', None),
    ('player.sitOnMount', 'player', {**P2, 'action': 'sitOnMount', 'args': {}}, 'ok', {'player.sitOnMount': ()}),
    ('player.by server id', 'player', {'id': 2, 'action': 'revive', 'args': {}}, 'ok', None),
    # tools page / quick menu (pages/tools/tools.ts, forms.tsx, quick/index.tsx)
    *[(f'self.{t} on', 'self', {'action': t, 'args': {'state': True}}, 'ok', {f'self.{t}': ('state',)})
      for t in ('noclip', 'invisible', 'godmode', 'names', 'boost', 'stamina', 'laser', 'showCoords', 'hashes')],
    ('self.noclip off', 'self', {'action': 'noclip', 'args': {'state': False}}, 'local', None),
    ('self.vehicleBoost', 'self', {'action': 'vehicleBoost', 'args': {}}, 'ok', {'self.vehicleBoost': ()}),
    ('self.noclipSpeed', 'self', {'action': 'noclipSpeed', 'args': {'speed': 0.25}}, 'ok', {'self.noclipSpeed': ('speed',)}),
    *[(f'self.{t}', 'self', {'action': t, 'args': {}}, 'ok', {f'self.{t}': ()})
      for t in ('cleanPed', 'tpWaypoint', 'tpBack', 'tpForward', 'stopSpectate', 'cleanupSpawned', 'repairVehicle', 'flipVehicle', 'healMount')],
    ('self.heal', 'self', {'action': 'heal', 'args': {}}, 'ok', None),
    ('self.revive', 'self', {'action': 'revive', 'args': {}}, 'ok', None),
    ('self.tpCoords', 'self', {'action': 'tpCoords', 'args': {'x': 1.5, 'y': -2.25, 'z': 3}}, 'ok', {'self.tpCoords': ('x', 'y', 'z')}),
    ('self.tpCoords(no z)', 'self', {'action': 'tpCoords', 'args': {'x': 1.5, 'y': -2.25}}, 'ok', {'self.tpCoords': ('x', 'y')}),
    ('self.spawnHorse', 'self', {'action': 'spawnHorse', 'args': {'model': 'a_c_horse_arabian_white', 'mount': True}}, 'ok', {'self.spawnHorse': ('model', 'mount')}),
    ('self.spawnWagon', 'self', {'action': 'spawnWagon', 'args': {'model': 'cart01', 'mount': False}}, 'ok', {'self.spawnWagon': ('model', 'mount')}),
    ('self.spawnAnimal', 'self', {'action': 'spawnAnimal', 'args': {'model': 'a_c_deer_01', 'behavior': 'wander'}}, 'ok', {'self.spawnAnimal': ('model', 'behavior')}),
    ('self.spawnPed', 'self', {'action': 'spawnPed', 'args': {'model': 'a_m_m_valfarmer_01', 'behavior': 'stand'}}, 'ok', {'self.spawnPed': ('model', 'behavior')}),
    ('self.deleteVehicle', 'self', {'action': 'deleteVehicle', 'args': {}}, 'ok', None),
    ('self.clearArea', 'self', {'action': 'clearArea', 'args': {'radius': 25}}, 'ok', None),
    *[(f'self.copyCoords {k}', 'self', {'action': 'copyCoords', 'args': {'type': k}}, 'ok', {'self.copyCoords': ('type',)})
      for k in ('coords3', 'coords4', 'heading')],
    # world page (pages/world/state.ts)
    ('server.weather', 'server', {'action': 'weather', 'args': {'type': 'RAIN'}}, 'ok', None),
    ('server.time', 'server', {'action': 'time', 'args': {'hour': 18, 'minute': 30}}, 'ok', None),
    ('server.announce', 'server', {'action': 'announce', 'args': {'text': 'restart soon', 'seconds': 60}}, 'ok', None),
    ('server.announceClear', 'server', {'action': 'announceClear', 'args': {}}, 'ok', None),
    *[(f'server.{a}', 'server', {'action': a, 'args': {'state': True}}, 'ok', None) for a in ('freezeTime', 'dynamicWeather', 'blackout')],
    # resources page
    *[(f'server.{a}', 'server', {'action': a, 'args': {'name': 'w_test_plain'}}, 'ok', None)
      for a in ('startResource', 'stopResource', 'restartResource')],
    ('server.stopResource(protected)', 'server', {'action': 'stopResource', 'args': {'name': 'w_core'}}, 'resource_is_protected', None),
    # bans (pages/bans/BansView.tsx) - the website answers itself
    ('bans.unban', 'bans', {'action': 'unban', 'id': 12}, 'ok', None),
    # map page (pages/map/MapPage.tsx, MapSide.tsx)
    ('map.teleport self', 'map', {'action': 'teleport', 'x': 100.5, 'y': -50.25, 'target': 'self'}, 'ok', {'self.tpCoords': ('x', 'y')}),
    ('map.teleport player', 'map', {'action': 'teleport', 'x': 100.5, 'y': -50.25, 'target': 2}, 'ok', {'self.tpCoords': ('x', 'y')}),
    ('map.waypoint', 'map', {'action': 'waypoint', 'x': 1.5, 'y': 2.5}, 'ok', {'map.waypoint': ('x', 'y')}),
    ('map.clearWaypoint', 'map', {'action': 'clearWaypoint'}, 'ok', {'map.clearWaypoint': ()}),
    ('map.copyCoords', 'map', {'action': 'copyCoords', 'x': 1.5, 'y': 2.5}, 'ok', {'map.copyCoords': ('x', 'y')}),
    ('map.setTheme', 'map', {'action': 'setTheme', 'theme': 'dark'}, 'ok', {'map.setTheme': ('theme',)}),
    ('map.players', 'map', {'action': 'players'}, 'ok', None),
    ('map.stopPlayers', 'map', {'action': 'stopPlayers'}, 'local', None),
    # the pushed reads (cl_console.lua PUSH, asked by refresh(what))
    # (the pushed message the page waits for, and the action that fills it)
    *[(f'refresh {w}', 'refresh', {'what': w}, 'ok', {'push': (push, action)}) for w, push, action in (
        ('players', 'players', 'query.players'), ('server', 'serverInfo', 'query.server'), ('catalog', 'catalog', 'query.catalog'),
        ('bans', 'bans', 'query.bans'), ('modules', 'modules', 'scripts.list'), ('blocks', 'blocks', 'characters.blocks'),
        ('map', 'mapCfg', 'query.map'), ('hud', 'hudCfg', 'query.hud'))],
    ('citizen.lookup', 'citizen', {'input': 'OMG95204'}, 'ok', None),
    ('citizen.lookup #id', 'citizen', {'input': '#2'}, 'ok', None),
    ('logs.query', 'logs', {'limit': 100, 'kind': 'player', 'admin': 'Staff', 'since': 1700000000}, 'ok', None),
    ('logs.query dashboard', 'logs', {'limit': 24}, 'ok', None),
    # characters page (pages/characters/*)
    ('characters.search', 'characters', {'action': 'search', 'q': 'john'}, 'ok', None),
    ('characters.search(latest)', 'characters', {'action': 'search', 'q': ''}, 'ok', None),
    ('characters.get', 'characters', {'action': 'get', 'citizenid': 'OMG95204'}, 'ok', None),
    ('characters.blocks', 'characters', {'action': 'blocks'}, 'ok', None),
    ('characters.block', 'characters', {'action': 'block', 'citizenid': 'OMG95204', 'reason': 'rule break'}, 'ok', None),
    ('characters.unblock', 'characters', {'action': 'unblock', 'citizenid': 'OMG95204'}, 'ok', None),
    ('characters.reassign', 'characters', {'action': 'reassign', 'citizenid': 'OMG95204', 'newId': 'JOHN1899'}, None, None),
    ('characters.delete', 'characters', {'action': 'delete', 'citizenid': 'OMG95204', 'token': 'abc123def456'}, None, None),
    ('characters.deleteStatus', 'characters', {'action': 'deleteStatus', 'token': 'abc123def456'}, None, None),
    ('characters.transfer', 'characters', {'action': 'transfer', 'citizenid': 'OMG95204', 'target': 'ADM00001', 'token': 'abc123def456'}, None, None),
    ('characters.transferStatus', 'characters', {'action': 'transferStatus', 'token': 'abc123def456'}, None, None),
    ('characters.money', 'characters', {'action': 'money', 'citizenid': 'OMG95204', 'type': 'cash', 'op': 'add', 'amount': 25, 'reason': 'refund'}, 'ok', None),
    ('characters.giveItem', 'characters', {'action': 'giveItem', 'citizenid': 'OMG95204', 'item': 'bread', 'count': 2}, None, None),
    ('characters.setJob', 'characters', {'action': 'setJob', 'citizenid': 'OMG95204', 'name': 'sheriff', 'grade': 0}, 'ok', None),
    ('characters.setGang', 'characters', {'action': 'setGang', 'citizenid': 'OMG95204', 'name': 'odriscoll', 'grade': 0}, 'ok', None),
    # scripts hub + settings (pages/hub/*)
    ('scripts.list', 'scripts', {'action': 'list'}, 'ok', None),
    ('scripts.open', 'scripts', {'action': 'open', 'resource': 'w_store'}, 'ok', None),
    ('scripts.open link', 'scripts', {'action': 'open', 'resource': 'w_hud', 'link': 'hudmenu'}, 'ok', None),
    ('scripts.run with args', 'scripts', {'action': 'run', 'resource': 'w_shops', 'command': 'restock', 'args': {'shop': 'valentine_general', 'item': 'bread', 'quantity': 50}}, 'ok', None),
    ('scripts.run no args', 'scripts', {'action': 'run', 'resource': 'w_centralbank', 'command': 'audit', 'args': {}}, 'ok', None),
    ('scripts.start', 'scripts', {'action': 'start', 'resource': 'w_test_plain'}, 'ok', None),
    ('settings.list', 'settings', {'action': 'list'}, 'ok', None),
    ('settings.schema', 'settings', {'action': 'schema', 'resource': 'w_hud'}, 'ok', None),
    ('settings.values', 'settings', {'action': 'values', 'resource': 'w_hud', 'group': 'needs'}, 'ok', None),
    ('settings.values(food editor)', 'settings', {'action': 'values', 'resource': 'w_hud'}, 'ok', None),
    ('settings.history', 'settings', {'action': 'history', 'resource': 'w_hud', 'limit': 200}, 'ok', None),
    ('settings.apply', 'settings', {'action': 'apply', 'resource': 'w_hud', 'changes': [{'key': 'needs.rate', 'from': 1, 'to': 2.5}]}, 'ok', None),
    ('settings.reset', 'settings', {'action': 'reset', 'resource': 'w_hud', 'keys': ['needs.rate']}, 'ok', None),
    ('settings.openPanel', 'settings', {'action': 'openPanel', 'resource': 'w_hud', 'link': 'hudmenu'}, 'ok', None),
    ('settings.export', 'settings', {'action': 'export', 'resource': 'w_hud'}, 'ok', None),
    ('settings.import dry', 'settings', {'action': 'import', 'data': {'format': 'w_settings/1', 'resources': {'w_hud': {'needs.rate': 3}, 'w_test_plain': {}}}, 'dryRun': True}, 'ok', None),
    ('settings.presets list', 'settings', {'action': 'presets', 'op': 'list'}, 'ok', None),
    ('settings.presets save', 'settings', {'action': 'presets', 'op': 'save', 'name': 'night'}, 'ok', None),
    ('hud.save', 'hud', {'action': 'save', 'cfg': {'needs': {'interval': 120}, 'features': {}}}, 'ok', None),
    ('hud.setNeed', 'hud', {'action': 'setNeed', 'citizenid': 'OMG95204', 'need': 'hunger', 'value': 75}, 'ok', None),
    ('hud.setNeed stamina', 'hud', {'action': 'setNeed', 'citizenid': 'OMG95204', 'need': 'stamina', 'value': 40}, 'ok', None),
    # news (pages/news/NewsPage.tsx)
    ('news.newsList', 'news', {'action': 'newsList'}, 'ok', None),
    # blips (pages/blips/BlipsPage.tsx): only while w_map is stopped
    ('blips.list', 'blips', {'action': 'list'}, 'ok', None),
    ('blips.save', 'blips', {'action': 'save', 'name': 'Doctor', 'sprite': 'blip_shop_doctor', 'x': 10.5, 'y': -20.25, 'scale': 0.8}, 'ok', None),
    # reports + ranks: the website answers itself (pages/reports, pages/ranks)
    ('reports.list', 'reports', {'action': 'list', 'status': 'all'}, 'ok', None),
    ('reports.claim', 'reports', {'action': 'claim', 'reportId': 4}, 'ok', None),
    ('reports.resolve', 'reports', {'action': 'resolve', 'reportId': 4, 'notes': ''}, 'ok', None),
    ('reports.reopen', 'reports', {'action': 'reopen', 'reportId': 4}, 'ok', None),
    ('reports.message', 'reports', {'action': 'message', 'reportId': 4, 'message': 'on my way'}, 'ok', None),
    ('ranks.state', 'ranks', {'action': 'state'}, 'ok', None),
    ('ranks.save', 'ranks', {'action': 'save', 'rank': {'name': 'helper', 'label': 'Helper', 'color': '#aa3300', 'sort': 5, 'permissions': []}}, 'ok', None),
    ('ranks.delete', 'ranks', {'action': 'delete', 'name': 'helper'}, 'ok', None),
    ('ranks.assign online', 'ranks', {'action': 'assign', 'rank': 'helper', 'target': {'source': 2}}, 'ok', None),
    ('ranks.assign discord', 'ranks', {'action': 'assign', 'rank': 'helper', 'target': {'identifier': '222222222222222222', 'name': 'John'}}, 'ok', None),
    ('ranks.revoke', 'ranks', {'action': 'revoke', 'rank': 'helper', 'identifier': 'discord:222222222222222222'}, 'ok', None),
]

# setup Lua per case (the rest of the stack as the case needs it)
SETUP = {
    'map.setTheme': "RESOURCES.w_map = '1.4.0'; EXPORTS.w_map = { GetMapConfig = function() return {} end }",
    'refresh map': "RESOURCES.w_map = '1.4.0'",
    'blips.list': 'RESOURCES.w_map = nil',
    'blips.save': 'RESOURCES.w_map = nil',
    'news.newsList': 'RESOURCES.w_map = nil',
}

# chat commands (ops/native_commands.lua), each the data its command builds
CHAT = [
    ('/warn', 'player.warn', {'citizenid': '#2', 'args': {'reason': 'language'}}, 'ok'),
    ('/warn citizen', 'player.warn', {'citizenid': 'omg95204', 'args': {'reason': 'language'}}, 'ok'),
    ('/bring', 'player.bring', {'citizenid': '#2', 'args': {}}, 'ok'),
    ('/goto', 'player.teleportTo', {'citizenid': 'OMG95204', 'args': {}}, 'ok'),
    ('/bringback', 'player.bringBack', {'citizenid': '#2', 'args': {}}, 'ok'),
    ('/reportr', 'reports.message', {'citizenid': '#2', 'message': 'we saw it'}, 'ok'),
    ('/staffchat', 'staff.chat', {'message': 'meeting at 9'}, 'ok'),
    ('/announce', 'server.announce', {'args': {'text': 'event at the saloon', 'seconds': 300}}, 'ok'),
    ('/noclip', 'self.noclip', {'args': {'state': True}}, 'ok'),
    ('/vector3', 'self.copyCoords', {'args': {'type': 'coords3'}}, 'ok'),
    ('/heading', 'self.copyCoords', {'args': {'type': 'heading'}}, 'ok'),
]



# ── the same console on RSG and on VORP (their own core + inventory instead of w_core / w_inventory) ─────
FRAMEWORKS = {
    'rsg': r"""
RESOURCES = { ['rsg-core'] = '2.0.0', ['rsg-inventory'] = '2.0.0', ['rsg-medic'] = '1.0', w_weathersync = '1.0.0', chat = '1.0', oxmysql = '2.0' }
RES_LIST = { 'rsg-core', 'rsg-inventory', 'rsg-medic', 'w_weathersync', 'chat', 'oxmysql', 'w_test_plain' }
EXPORTS.w_core, EXPORTS.w_inventory, EXPORTS.w_hud = nil, nil, nil
local function rec(name, ...) CALLS[#CALLS+1] = { name = name, args = { ... } } end
RMONEY = { [1] = { cash = 100, bank = 50, bloodmoney = 0 }, [2] = { cash = 300, bank = 10, bloodmoney = 0 } }
local function player(src)
    local c = CHARS[tonumber(src)]
    if not c then return nil end
    local m = RMONEY[tonumber(src)]
    return { PlayerData = { citizenid = c.citizenid, charinfo = { firstname = c.firstname, lastname = c.lastname },
        job = { name = 'unemployed', label = 'Unemployed', grade = { level = 0 } }, gang = { name = 'none' }, money = m, items = {},
        metadata = { hunger = 50, thirst = 60, isdead = false } },
        Functions = {
            AddMoney = function(acc, n) rec('AddMoney', src, acc, n) m[acc] = m[acc] + n return true end,
            RemoveMoney = function(acc, n) rec('RemoveMoney', src, acc, n) m[acc] = m[acc] - n return true end,
            SetJob = function(j, g) rec('SetJob', src, j, g) return JOBS[j] ~= nil end,
            SetGang = function(j, g) rec('SetGang', src, j, g) return GANGS[j] ~= nil end,
            SetMetaData = function(k, v) rec('SetMetaData', src, k, v) end, SetPlayerData = function() end } }
end
RSG = { Functions = { GetPlayer = player }, Config = { Money = { MoneyTypes = { cash = 0, bank = 0, bloodmoney = 0 } } },
    Shared = { Jobs = JOBS, Gangs = GANGS, Vehicles = {}, Items = { bread = { label = 'Bread', weight = 1 } } } }
EXPORTS['rsg-core'] = { GetCoreObject = function() return RSG end }
EXPORTS['rsg-inventory'] = { AddItem = function(_, src, name, count) rec('AddItem', src, name, count) return true end,
    RemoveItem = function() return true end, CanAddItem = function() return true end,
    ClearInventory = function(_, src) rec('ClearInventory', src) end, OpenInventoryById = function(_, a, t) rec('OpenInventoryById', a, t) return true end }
-- (WC.Adapters.detect() runs once the connector is loaded)
""",
    'vorp': r"""
RESOURCES = { vorp_core = '3.0', vorp_inventory = '4.0', w_weathersync = '1.0.0', chat = '1.0', oxmysql = '2.0' }
RES_LIST = { 'vorp_core', 'vorp_inventory', 'w_weathersync', 'chat', 'oxmysql', 'w_test_plain' }
EXPORTS.w_core, EXPORTS.w_inventory, EXPORTS.w_hud = nil, nil, nil
local function rec(name, ...) CALLS[#CALLS+1] = { name = name, args = { ... } } end
VCHAR = {}
for src, c in pairs(CHARS) do
    local me = { charIdentifier = src * 11, firstname = c.firstname, lastname = c.lastname, job = 'unemployed', jobLabel = 'Unemployed',
        jobGrade = 0, money = 100, gold = 2, rol = 0 }
    me.addCurrency = function(kind, n) rec('addCurrency', src, kind, n) end
    me.removeCurrency = function(kind, n) rec('removeCurrency', src, kind, n) end
    me.setJob = function(j) rec('setJob', src, j) end
    me.setJobGrade = function(g) rec('setJobGrade', src, g) end
    VCHAR[src] = me
end
VORP = { getUser = function(src) local c = VCHAR[tonumber(src)] return c and { getUsedCharacter = c } or nil end,
    GetRegisteredJobs = function() return JOBS end,
    Player = { Revive = function(src) rec('Revive', src) end, Heal = function(src) rec('Heal', src) end } }
EXPORTS.vorp_core = { GetCore = function() return VORP end }
EXPORTS.vorp_inventory = {
    addItem = function(_, src, name, count, meta, cb) rec('addItem', src, name, count) cb(true) end,
    subItem = function(_, src, name, count, meta, cb) cb(true) end,
    canCarryItem = function(_, src, name, count, cb) cb(true) end,
    subAllItems = function(_, src, cb) rec('subAllItems', src) cb(true) end,
    subAllWeapons = function(_, src, cb) rec('subAllWeapons', src) cb(true) end,
    getUserInventoryItems = function(_, src, cb) cb({}) end }
-- (WC.Adapters.detect() runs once the connector is loaded)
""",
}
# (case, NUI kind, payload, the answers this framework may give: 'ok', or the feature it really lacks)
BY_ID = {'id': 2}
FRAMEWORK_CASES = [
    ('player.teleportTo', 'player', {**BY_ID, 'action': 'teleportTo', 'args': {}}),
    ('player.bring', 'player', {**BY_ID, 'action': 'bring', 'args': {}}),
    ('player.revive', 'player', {**BY_ID, 'action': 'revive', 'args': {}}),
    ('player.heal', 'player', {**BY_ID, 'action': 'heal', 'args': {}}),
    ('player.needs', 'player', {**BY_ID, 'action': 'needs', 'args': {'hunger': 80, 'thirst': 70}}),
    ('player.setJob', 'player', {**BY_ID, 'action': 'setJob', 'args': {'name': 'sheriff', 'grade': 1}}),
    ('player.setGang', 'player', {**BY_ID, 'action': 'setGang', 'args': {'name': 'odriscoll', 'grade': 0}}),
    ('player.money cash', 'player', {**BY_ID, 'action': 'money', 'args': {'type': 'cash', 'op': 'add', 'amount': 50, 'reason': 'event prize'}}),
    ('player.giveItem', 'player', {**BY_ID, 'action': 'giveItem', 'args': {'item': 'bread', 'count': 3}}),
    ('player.clearInventory', 'player', {**BY_ID, 'action': 'clearInventory', 'args': {}}),
    ('player.openInventory', 'player', {**BY_ID, 'action': 'openInventory', 'args': {}}),
    ('player.freeze', 'player', {**BY_ID, 'action': 'freeze', 'args': {'state': True}}),
    ('player.kick', 'player', {**BY_ID, 'action': 'kick', 'args': {'reason': 'afk'}}),
    ('player.notify', 'player', {**BY_ID, 'action': 'notify', 'args': {'text': 'hello'}}),
    ('self.revive', 'self', {'action': 'revive', 'args': {}}),
    ('self.spawnHorse', 'self', {'action': 'spawnHorse', 'args': {'model': 'a_c_horse_arabian_white'}}),
    ('server.weather', 'server', {'action': 'weather', 'args': {'type': 'RAIN'}}),
    ('refresh players', 'refresh', {'what': 'players'}),
    ('refresh catalog', 'refresh', {'what': 'catalog'}),
    ('characters.search', 'characters', {'action': 'search', 'q': 'john'}),
]
# what each framework does not have, so the console answers capability_missing (never a crash)
LACKS = {
    'rsg': {'player.needs': 'no needs owner without w_hud'},
    'vorp': {'player.needs': 'no needs owner without w_hud', 'player.setGang': 'VORP has no gangs',
             'player.openInventory': 'vorp_inventory has no open-other export in the adapter'},
}


SITE = website_root()


@unittest.skipIf(SITE is None, 'the website copy (stage/website or $WC_WEBSITE_ROOT) is not here')
class ConsoleRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = Bridge(SITE)
        cls.h = Harness(cls.bridge)
        cls.report = []

    @classmethod
    def tearDownClass(cls):
        cls.bridge.close()
        out = os.environ.get('WC_ROUNDTRIP_REPORT')
        if out:
            Path(out).write_text(json.dumps(cls.report, indent=1, ensure_ascii=False, default=str), encoding='utf-8')

    def check(self, label, trace, expected, client):
        self.report.append({'case': label, **trace})
        r = trace.get('result') or {}
        site = trace.get('website') or {}
        self.assertNotEqual(site.get('status'), 400, f'{label}: the website refused what Lua sent: {site} sent={trace.get("sent", {}).get("data")}')
        bad_log = [x for x in trace.get('log', []) if 'failed' in x or 'error' in x.lower()]
        self.assertEqual(bad_log, [], f'{label}: a Lua error was logged')
        if expected == 'local':
            self.assertIsNone(trace.get('action'), f'{label}: should be answered on the client')
            return
        self.assertIsNotNone(trace.get('result'), f'{label}: no answer reached the page')
        if expected == 'ok':
            self.assertTrue(r.get('ok'), f'{label}: {r} handler={trace.get("handler")}')
        elif expected is not None:
            self.assertEqual(r.get('errorKey') or r.get('error'), expected, f'{label}: {r}')
        else:
            self.assertNotIn(r.get('errorKey'), ('invalid_args', 'failed', 'exception', 'err_failed', 'timeout', 'no_session'), f'{label}: {r}')
        client = dict(client or {})
        push = client.pop('push', None)
        if push:
            self.assertEqual(trace.get('action'), push[1], f'{label}: the page asked, but {push[1]} was never requested')
            sent = [m for m in (trace.get('nui') or []) if isinstance(m, dict) and m.get('action') == push[0]]
            self.assertTrue(sent, f'{label}: the page never got its {push[0]!r} push: {[m.get("action") for m in trace.get("nui") or []]}')
            if push[0] == 'catalog':
                items = sent[-1]['data'].get('items')
                self.assertIsInstance(items, list, f'{label}: catalog.items must be a list (App.tsx arr()), got {items!r}')
                self.assertTrue(items and items[0].get('name') == 'bread', f'{label}: {items!r}')
            if push[0] == 'hudCfg':
                self.assertEqual(sent[-1]['data'].get('cfg'), {'needs': {'interval': 144}})
        for name, fields in client.items():
            asked = [e for e in (trace.get('executed') or []) if e.get('name') == name]
            self.assertTrue(asked, f'{label}: the client was never asked to run {name}: {trace.get("executed")}')
            args = asked[-1].get('args') or {}
            for f in fields:
                self.assertIn(f, args, f'{label}: {name} reached the client without {f!r}: {args}')

    def test_every_page_call_round_trips(self):
        for label, kind, payload, expected, client in CASES:
            with self.subTest(case=label):
                self.check(label, self.h.run(kind, payload, SETUP.get(label)), expected, client)

    def test_every_chat_command_round_trips(self):
        for label, name, data, expected in CHAT:
            with self.subTest(case=label):
                self.check(label, self.h.chat(name, data), expected, None)

    def test_every_contract_action_is_covered(self):
        """A new console action needs a case here (or is named below with why it has none)."""
        covered = set()
        for label, kind, payload, _e, _c in CASES:
            if kind in ('citizen', 'logs'):
                covered.add('citizen.lookup' if kind == 'citizen' else 'logs.query')
            elif kind == 'refresh':
                covered.add({'players': 'query.players', 'server': 'query.server', 'catalog': 'query.catalog', 'bans': 'query.bans',
                             'modules': 'scripts.list', 'blocks': 'characters.blocks', 'map': 'query.map', 'hud': 'query.hud'}[payload['what']])
            elif 'action' in payload:
                covered.add(f"{kind}.{payload['action']}")
        covered |= {n for _l, n, _d, _e in CHAT}
        # no page or command sends these: the website's own panel or another script does
        NOT_FROM_THE_CONSOLE = {
            'query.self', 'query.resources',            # the server info push carries both
            'self.deleteEntity',                        # the laser tool's J key (client/cl_console_tools.lua), case below
            'news.newsSave', 'news.newsReset', 'blips.delete', 'reports.stats', 'settings.presets',
        }
        missing = sorted(set(self.h.contract) - covered - NOT_FROM_THE_CONSOLE)
        self.assertEqual(missing, [])

    def test_laser_delete_round_trips(self):
        """The laser tool's J key asks self.deleteEntity from the client (cl_console_tools.lua)."""
        self.h.trace = {}
        self.h.reset()
        self.h.c.execute("UI_RESULT = nil; WConsole.ask('self.deleteEntity', { args = { netId = 77 } }, function(r) UI_RESULT = r end)")
        self.check('self.deleteEntity', self.h.finish(), 'ok', None)

    def test_news_save_and_blip_delete_round_trip(self):
        h = self.h
        st = h.run('news', {'action': 'newsList'}, 'RESOURCES.w_map = nil')
        rev = (st['result'] or {}).get('data', {}).get('rev')
        self.assertTrue(rev, st['result'])
        item = {'id': 'n1', 'title': {'ar': 'خبر جديد', 'en': 'New'}, 'text': {'ar': 'نص'}, 'image': 'news/saloon.webp'}
        self.check('news.newsSave', h.run('news', {'action': 'newsSave', 'list': [item], 'rev': rev}), 'ok', None)
        st = h.run('news', {'action': 'newsList'})
        self.check('news.newsReset', h.run('news', {'action': 'newsReset', 'rev': st['result']['data']['rev']}), 'ok', None)
        saved = h.run('blips', {'action': 'save', 'name': 'Doctor', 'sprite': 'blip_shop_doctor', 'x': 10.5, 'y': -20.25, 'scale': 0.8}, 'RESOURCES.w_map = nil')
        bid = (saved['result'] or {}).get('data', {})
        bid = bid.get('id') or (bid.get('blip') or {}).get('id') or next((b['id'] for b in bid.get('list', []) if isinstance(b, dict)), None)
        self.assertTrue(bid, saved['result'])
        self.check('blips.delete', h.run('blips', {'action': 'delete', 'id': bid}, 'RESOURCES.w_map = nil'), 'ok', None)
        self.check('reports.stats', h.run('reports', {'action': 'stats'}), 'ok', None)
        self.check('settings.presets get', h.run('settings', {'action': 'presets', 'op': 'get', 'id': 3}), 'ok', None)


    def test_rsg_and_vorp_adapter_paths(self):
        """The same page calls on an RSG and a VORP server: each works or is refused as missing, never fails."""
        for fw in ('rsg', 'vorp'):
            h = Harness(self.bridge, fw)
            self.assertEqual(h.s.eval("WC.Adapters.describe('framework').id"), fw)
            for label, kind, payload in FRAMEWORK_CASES:
                with self.subTest(framework=fw, case=label):
                    t = h.run(kind, payload)
                    self.report.append({'case': f'{fw}:{label}', **t})
                    r = t.get('result') or {}
                    self.assertNotEqual((t.get('website') or {}).get('status'), 400, f'{fw} {label}: {t.get("website")}')
                    self.assertEqual([x for x in t.get('log', []) if 'failed' in x], [], f'{fw} {label}')
                    if label in LACKS[fw]:
                        self.assertEqual(r.get('errorKey') or (None if r.get('ok') else r.get('error')), 'capability_missing', f'{fw} {label}: {r}')
                    else:
                        self.assertTrue(r.get('ok'), f'{fw} {label}: {r} {t.get("handler")}')


class ErrorTextTests(unittest.TestCase):
    """Every error key a console handler, adapter or client tool answers has a text in both languages
    (cl_console.lua finish(): without one the page shows only the general "did not complete" line)."""
    FILES = ['ops/console.lua', 'ops/console_actions.lua', 'ops/console_entities.lua', 'ops/native_characters.lua',
             'ops/native_settings.lua', 'ops/native_news.lua', 'ops/native_blips.lua', 'ops/native_scripts.lua',
             'ops/native_player.lua', 'ops/native_commands.lua', 'ops/players.lua', 'ops/inventory.lua', 'ops/character.lua',
             'ops/server.lua', 'ops/world.lua', 'ops/control.lua', 'client/cl_console_tools.lua', 'client/cl_menu_self.lua',
             'adapters/framework/wcore.lua', 'adapters/framework/rsg.lua', 'adapters/framework/vorp.lua',
             'adapters/inventory/w_inventory.lua', 'adapters/inventory/rsg_inventory.lua', 'adapters/inventory/vorp_inventory.lua']
    # not answers a page shows: field reasons inside a settings refusal, a replayed ticket, false matches
    NOT_SHOWN = {'out_of_range', 'stopped', 'no_request', 'unknown_action', 'unknown_op', 'ar', 'redm', 'no_adapter'}

    def test_every_error_key_has_a_text(self):
        import re
        ar = json.loads(text('locales/ar.json'))
        en = json.loads(text('locales/en.json'))
        cl = text('client/cl_console.lua')
        block = re.search(r"ar = \{(.*?)\},\s*en = \{(.*?)\},\s*\}", cl, re.S)
        built_ar = set(re.findall(r"(\w+) = '", block.group(1)))
        built_en = set(re.findall(r"(\w+) = '", block.group(2)))
        missing = {}
        for rel in self.FILES:
            t = text(rel)
            keys = set(re.findall(r"return false, '([a-z_]+)'", t)) | set(re.findall(r"fail\('([a-z_]+)'\)", t)) \
                | set(re.findall(r"error = '([a-z_]+)'", t))
            for k in keys - self.NOT_SHOWN:
                if not ((k in built_ar or k in ar) and (k in built_en or k in en)):
                    missing.setdefault(k, []).append(rel)
        self.assertEqual(missing, {})


if __name__ == '__main__':
    unittest.main()
