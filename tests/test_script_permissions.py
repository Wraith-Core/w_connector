"""Exercise the actual Lua catalogue, ACE leases and HTTP timeout without any server connection."""
from pathlib import Path
import json
import unittest
from lupa import lua54

ROOT = Path(__file__).resolve().parents[1]

HARNESS = r'''
NOW=1000; LINKED=true; ACL=true; STATUS=200; BLOCK=false; MODE='normal'; COMMANDS={}; HANDLERS={}; THREADS={}; TIMERS={}
NOTICES={}
PEOPLE={[1]={discord='discord:555555555555555555',license='license:'..string.rep('a',40),name='Player'}}
STARTED={w_farming=true,w_inventory=true,w_admin=true}
VERSIONS={}
function GetResourceMetadata(resource) if VERSIONS[resource] == false then return nil end return VERSIONS[resource] or '99.99.99' end
REGISTERED={{name='giveitem',resource='w_inventory'}}
GRANTS={'w_farming:w_farming.admin.view'}
function GetGameTimer() return NOW end
function GetCurrentResourceName() return 'w_connector' end
function GetPlayerName(src) return PEOPLE[src] and PEOPLE[src].name end
function GetPlayers() local out={} for src in pairs(PEOPLE) do out[#out+1]=tostring(src) end return out end
NATIVE_ACES={};NATIVE_PARENTS={};KVP={}
function IsPrincipalAceAllowed(principal,node)
 if principal:sub(1,9)=='resource.' then return ACL end
 local seen={}
 local function visit(p)
  if seen[p] then return false end;seen[p]=true
  for ace in pairs(NATIVE_ACES[p] or {}) do if ace=='*' or ace==node or node:sub(1,#ace+1)==ace..'.' then return true end end
  for parent in pairs(NATIVE_PARENTS[p] or {}) do if visit(parent) then return true end end
  if p ~= 'builtin.everyone' then return visit('builtin.everyone') end
  return false
 end
 return visit(principal)
end
function GetRegisteredCommands() return REGISTERED end
function GetResourceState(resource) return STARTED[resource] and 'started' or 'stopped' end
function ExecuteCommand(line)
 COMMANDS[#COMMANDS+1]=line
 local cmd,principal,value=line:match('^(%S+) (%S+) (%S+)')
 if cmd=='add_ace' or cmd=='remove_ace' then NATIVE_ACES[principal]=NATIVE_ACES[principal] or {};NATIVE_ACES[principal][value]=cmd=='add_ace' or nil
 elseif cmd=='add_principal' or cmd=='remove_principal' then NATIVE_PARENTS[principal]=NATIVE_PARENTS[principal] or {};NATIVE_PARENTS[principal][value]=cmd=='add_principal' or nil end
end
function GetResourceKvpString(key) return KVP[key] end
function SetResourceKvp(key,value) KVP[key]=value end
function TriggerClientEvent(name,src) NOTICES[#NOTICES+1]={name=name,src=src} end
function AddEventHandler(name,fn) HANDLERS[name]=fn end
function CreateThread(fn) THREADS[#THREADS+1]=fn end
function SetTimeout(ms,fn) TIMERS[#TIMERS+1]={ms=ms,fn=fn} end
function Wait() coroutine.yield() end
WC={started=function(r) return STARTED[r] == true end,linked=function() return LINKED end,log=function() end,
 identifiers=function(src) return PEOPLE[src] or {} end}
function ITEM(resource,node)
 return {id=resource..':'..node,node=node,label={ar='صلاحية',en='Permission'},description={ar='وصف واضح',en='Clear description'},danger=false}
end
function GROUP(resource,items) return {id=resource,resource=resource,label={ar='مورد',en='Resource'},permissions=items} end
WC.ScriptPermissionRegistry={version=1,groups={GROUP('w_farming',{ITEM('w_farming','w_farming.admin.view'),ITEM('w_farming','w_livestock.admin.animals')}),GROUP('w_inventory',{ITEM('w_inventory','command.giveitem')})}}
function WC.request(method,path,payload,timeout)
 METHOD=method; PATH=path; PAYLOAD=payload; TIMEOUT=timeout
 local response={ok=true,epoch=payload.epoch,leaseSeconds=45,players={}}
 for _,p in ipairs(payload.players) do
  local permissions={};for i,v in ipairs(GRANTS) do permissions[i]=v end
  response.players[#response.players+1]={source=p.source,discord=p.discord,license=p.license,session=p.session,permissions=permissions}
 end
 RESPONSE=response
 if BLOCK then coroutine.yield() end
 if MODE=='throw' then error('transport unavailable') end
 if MODE=='wrong_epoch' then response.epoch='old_boot' end
 if MODE=='wrong_lease' then response.leaseSeconds=45000 end
 if MODE=='wrong_identity' then response.players[1].discord='discord:999999999999999999' end
 if MODE=='wrong_license' then response.players[1].license='license:'..string.rep('b',40) end
 if MODE=='wrong_session' then response.players[1].session='old_session' end
 if MODE=='unknown_source' then response.players[1].source=2 end
 if MODE=='duplicate_source' then response.players[2]=response.players[1] end
 if MODE=='duplicate_permission' then response.players[1].permissions[2]=response.players[1].permissions[1] end
 if MODE=='sparse_players' then response.players[3]=response.players[1]; response.players[1]=nil end
 if MODE=='map_permissions' then response.players[1].permissions={admin=true} end
 if MODE=='empty' then response.players={} end
 if MODE=='denied' then response.ok=false end
 return STATUS,response
end
'''

# 2.2.3: the return shapes a REAL FXServer gives (measured on FXServer, _fwtest/aclcheck, 2026-11-02):
# ExecuteCommand is void and returns false for every line, applied or silently denied; the BOOL
# IsPrincipalAceAllowed returns the number 1 when allowed and false when not.
REAL_NATIVE_SHAPES = r'''
local ace, exec = IsPrincipalAceAllowed, ExecuteCommand
function IsPrincipalAceAllowed(principal, node) return ace(principal, node) and 1 or false end
function ExecuteCommand(line) exec(line); return false end
'''


class ScriptPermissionsTests(unittest.TestCase):
    REAL_NATIVES = False

    def setUp(self):
        self.lua = lua54.LuaRuntime()
        self.lua.execute(HARNESS)
        if self.REAL_NATIVES:
            self.lua.execute(REAL_NATIVE_SHAPES)
        def plain(value):
            if hasattr(value, 'items'):
                pairs = dict(value.items())
                if pairs and all(isinstance(k, int) for k in pairs) and set(pairs) == set(range(1, len(pairs) + 1)):
                    return [plain(pairs[i]) for i in range(1, len(pairs) + 1)]
                return {k: plain(v) for k, v in pairs.items()}
            return value
        self.lua.globals().PY_JSON_ENCODE = lambda v: json.dumps(plain(v), ensure_ascii=False, separators=(',', ':'))
        self.lua.globals().PY_JSON_DECODE = lambda s: self.lua.table_from(json.loads(s), recursive=True)
        self.lua.execute('json={encode=function(v) return PY_JSON_ENCODE(v) end,decode=function(s) return PY_JSON_DECODE(s) end}')
        self.lua.execute((ROOT / 'core/script_catalog.lua').read_text(encoding='utf-8'))
        self.lua.execute((ROOT / 'core/script_permissions.lua').read_text(encoding='utf-8'))

    def run_lua(self, code):
        self.lua.execute(code)

    def val(self, code):
        return self.lua.eval(code)

    def refresh(self):
        return self.val('WC.ScriptPermissions.refresh()')

    def bound(self):
        return bool(self.val('WC.ScriptPermissions.sessions[1] and WC.ScriptPermissions.sessions[1].bound'))

    def catalogue_ids(self):
        return set(self.val('(function() local _,a=WC.ScriptCatalog.build();local o={} for id in pairs(a) do o[#o+1]=id end return o end)()').values())

    def test_grants_only_curated_nodes_on_owned_session_principal(self):
        self.assertTrue(self.refresh())
        self.assertTrue(self.bound())
        self.assertEqual(self.val('METHOD'), 'POST')
        self.assertEqual(self.val('PATH'), '/permissions')
        self.assertEqual(self.val('TIMEOUT'), 45000)
        self.assertEqual(self.val('WC.ScriptPermissions.sessions[1].deadline'), 46000)
        commands = list(self.lua.globals().COMMANDS.values())
        self.assertEqual(len(commands), 3)
        self.assertTrue(all('wcsite.sp2_' in c for c in commands))
        self.assertTrue(any(c.startswith('add_ace ') and c.endswith(' w_farming.admin.view allow') for c in commands))
        self.assertTrue(any(c.startswith('add_principal player.1 wcsite.sp2_') for c in commands))
        self.assertRegex(self.val('PAYLOAD.epoch'), r'^[A-Za-z0-9_-]{1,96}$')
        self.assertRegex(self.val('PAYLOAD.players[1].session'), r'^[A-Za-z0-9_-]{1,96}$')

    def test_admin_ui_rechecks_on_change_and_revoke_without_refresh_noise(self):
        self.refresh()
        self.assertEqual(self.val('#NOTICES'), 1)
        self.refresh()
        self.assertEqual(self.val('#NOTICES'), 1)
        self.run_lua("MODE='empty'; WC.ScriptPermissions.refresh()")
        self.assertEqual(self.val('#NOTICES'), 2)
        self.assertEqual(self.val('NOTICES[2].name'), 'w_admin:client:recheck')

    def test_license2_is_usable_without_a_primary_license(self):
        self.run_lua("PEOPLE[1].license2=PEOPLE[1].license:gsub('^license:', 'license2:'); PEOPLE[1].license=nil")
        self.assertTrue(self.refresh())
        self.assertTrue(self.bound())

    def test_each_source_is_bound_to_its_own_identity_and_can_be_revoked_independently(self):
        self.run_lua("PEOPLE[2]={discord='discord:666666666666666666',license='license:'..string.rep('b',40),name='Other'}")
        self.assertTrue(self.refresh())
        self.run_lua('source=1; HANDLERS.playerDropped(); PEOPLE[1]=nil')
        self.assertFalse(self.bound())
        self.assertTrue(self.val('WC.ScriptPermissions.sessions[2].bound'))

    def test_compiled_curated_registry_cannot_add_nonproject_authority(self):
        self.lua.execute((ROOT / 'core/script_permission_registry.lua').read_text(encoding='utf-8'))
        self.run_lua("REGISTERED={};for _,g in ipairs(WC.ScriptPermissionRegistry.groups) do STARTED[g.resource]=true; for _,p in ipairs(g.permissions) do if p.node:sub(1,8)=='command.' then local owner=p.commandOwner or g.resource; STARTED[owner]=true; REGISTERED[#REGISTERED+1]={name=p.node:sub(9),resource=owner} end end end")
        reviewed = set(self.val('(function() local out={} for _,g in ipairs(WC.ScriptPermissionRegistry.groups) do for _,p in ipairs(g.permissions) do out[#out+1]=p.id end end return out end)()').values())
        allowed = self.catalogue_ids()
        self.assertGreater(len(reviewed), 100)
        self.assertTrue(allowed.issubset(reviewed))
        self.assertIn('w_farming:w_farming.admin', allowed)
        self.assertIn('w_medic:w_medic.admin', allowed)
        self.assertIn('w_admin:w_admin.area.players', allowed)
        self.assertTrue(all(not p.endswith(':admin') and 'group.' not in p and 'bypass' not in p for p in allowed))

    def test_new_adapter_floor_hides_old_unknown_and_prerelease_versions(self):
        self.run_lua("WC.ScriptPermissionRegistry.groups[1].minVersion='2.8.1'; VERSIONS.w_farming='2.8.0'")
        self.assertNotIn('w_farming:w_farming.admin.view', self.catalogue_ids())
        self.run_lua("VERSIONS.w_farming='2.8.1'")
        self.assertIn('w_farming:w_farming.admin.view', self.catalogue_ids())
        self.run_lua("VERSIONS.w_farming='2.10.0'")
        self.assertIn('w_farming:w_farming.admin.view', self.catalogue_ids())
        self.run_lua("VERSIONS.w_farming='2.8.1-beta'")
        self.assertNotIn('w_farming:w_farming.admin.view', self.catalogue_ids())
        self.run_lua("GetResourceMetadata=function() return nil end")
        self.assertNotIn('w_farming:w_farming.admin.view', self.catalogue_ids())

    def test_resource_version_changes_fingerprint_without_exposing_version_metadata(self):
        self.run_lua("VERSIONS.w_farming='2.8.1'; BEFORE=WC.ScriptPermissions.fingerprint(); VERSIONS.w_farming='2.8.2'; AFTER=WC.ScriptPermissions.fingerprint()")
        self.assertNotEqual(self.val('BEFORE'), self.val('AFTER'))
        self.assertIsNone(self.val('(WC.ScriptCatalog.build()).groups[1].minVersion'))

    def test_failed_cleanup_remains_debt_and_retries_after_expiry(self):
        self.refresh()
        self.run_lua("ORIG_EXEC=ExecuteCommand; FAIL=true;function ExecuteCommand(line) if FAIL and line:match('^remove_') then error('temporary native failure') end;ORIG_EXEC(line) end; NOW=46000; WC.ScriptPermissions.tick()")
        self.assertTrue(self.bound())
        self.assertTrue(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertTrue(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        prior_notifications = self.val('#NOTICES')
        self.run_lua('FAIL=false; NOW=47000; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.assertGreater(self.val('#NOTICES'), prior_notifications)

    def test_silent_native_cleanup_noop_is_not_treated_as_success(self):
        self.refresh()
        self.run_lua("ORIG_EXEC=ExecuteCommand; FAIL=true;function ExecuteCommand(line) if FAIL and line:match('^remove_') then return end;ORIG_EXEC(line) end; NOW=46000; WC.ScriptPermissions.tick()")
        self.assertTrue(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertTrue(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.run_lua('FAIL=false; WC.ScriptPermissions.tick()')
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))

    def test_catalog_or_notification_fault_cannot_disable_retirement(self):
        self.refresh()
        self.run_lua("WC.ScriptCatalog.build=function() error('catalog unavailable') end; TriggerClientEvent=function() error('notification unavailable') end; NOW=46000; WC.ScriptPermissions.tick()")
        self.assertFalse(self.bound())
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))

    def test_orphan_cleanup_survives_drop_source_reuse_and_link_reset(self):
        self.refresh()
        self.run_lua("OLD=WC.ScriptPermissions.sessions[1].principal; ORIG_EXEC=ExecuteCommand; FAIL=true;function ExecuteCommand(line) if FAIL and line:match('^remove_') then error('temporary native failure') end;ORIG_EXEC(line) end;source=1; HANDLERS.playerDropped(); PEOPLE[1].license='license:'..string.rep('b',40)")
        self.assertTrue(self.val('WC.ScriptPermissions.pending[OLD] ~= nil'))
        self.assertFalse(self.refresh())
        self.assertFalse(self.bound())
        self.run_lua('LINKED=false; WC.ScriptPermissions.reset(); FAIL=false; WC.ScriptPermissions.tick()')
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.run_lua('LINKED=true')
        self.assertTrue(self.refresh())
        self.assertNotEqual(self.val('OLD'), self.val('WC.ScriptPermissions.sessions[1].principal'))

    def test_stop_journal_replays_only_removals_after_resource_restart(self):
        self.refresh()
        self.run_lua("OLD=WC.ScriptPermissions.sessions[1].principal; ORIG_EXEC=ExecuteCommand; FAIL=true;function ExecuteCommand(line) if FAIL and line:match('^remove_') then error('temporary native failure') end;ORIG_EXEC(line) end;HANDLERS.onResourceStop('w_connector')")
        self.assertTrue(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        saved = self.val("KVP.wcsite_cleanup_v1")
        self.assertNotIn('discord:', saved)
        self.assertNotIn('license:', saved)
        self.assertNotIn('permissions', saved)
        self.run_lua('FAIL=false; COMMANDS={}')
        self.lua.execute((ROOT / 'core/script_permissions.lua').read_text(encoding='utf-8'))
        self.assertTrue(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.run_lua('WC.ScriptPermissions.tick()')
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.assertTrue(all(c.startswith('remove_') for c in self.lua.globals().COMMANDS.values()))

    def test_a_node_open_to_everyone_does_not_keep_cleanup_pending(self):
        # 2.2.5: every principal inherits builtin.everyone; a public node stays "allowed" after our ACE goes
        self.run_lua("ExecuteCommand('add_ace builtin.everyone w_farming.admin.view allow')")
        self.refresh()
        self.run_lua("MODE='empty';WC.ScriptPermissions.refresh()")
        self.assertFalse(self.bound())
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertTrue(self.val("IsPrincipalAceAllowed('builtin.everyone','w_farming.admin.view')"))

    def test_manual_wildcard_and_other_manual_principals_survive_cleanup(self):
        self.run_lua("ExecuteCommand('add_ace manual * allow');ExecuteCommand('add_principal player.1 manual')")
        self.refresh()
        self.run_lua("MODE='empty';WC.ScriptPermissions.refresh()")
        self.assertFalse(self.bound())
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertTrue(self.val("IsPrincipalAceAllowed('player.1','anything.manual')"))
        self.assertTrue(self.val('NATIVE_PARENTS["player.1"].manual'))
        self.assertFalse(self.val('(function() for _,s in pairs(WC.ScriptPermissions.owned) do if next(s.nodes) then return true end end return false end)()'))

    def test_cleanup_journal_write_or_readback_failure_blocks_native_adds(self):
        for failure in ["error('disk unavailable')", 'return']:
            with self.subTest(failure=failure):
                self.setUp()
                self.run_lua('function SetResourceKvp() ' + failure + ' end')
                self.assertFalse(self.refresh())
                self.assertFalse(self.bound())
                self.assertFalse(any(c.startswith('add_') for c in self.lua.globals().COMMANDS.values()))

    def test_journal_delay_cannot_turn_expired_snapshot_into_a_new_native_grant(self):
        self.run_lua('ORIG_SET=SetResourceKvp;function SetResourceKvp(key,value) ORIG_SET(key,value);NOW=NOW+45000 end')
        self.assertFalse(self.refresh())
        self.assertFalse(self.bound())
        self.assertFalse(any(c.startswith('add_') for c in self.lua.globals().COMMANDS.values()))

    def test_oversized_journal_is_never_written_and_cannot_precede_native_adds(self):
        self.run_lua("WRITES=0;ORIG_SET=SetResourceKvp;function SetResourceKvp(key,value) WRITES=WRITES+1;ORIG_SET(key,value) end;json.encode=function() return string.rep('x',8*1024*1024+1) end")
        self.assertFalse(self.refresh())
        self.assertEqual(self.val('WRITES'), 0)
        self.assertFalse(any(c.startswith('add_') for c in self.lua.globals().COMMANDS.values()))

    def test_malformed_cleanup_journal_cannot_target_other_principals_or_inject_commands(self):
        valid = {'source': 1, 'principal': 'wcsite.sp2_' + 'a' * 32 + '.1.1', 'nodes': ['w_farming.admin.view'], 'bound': True, 'probe': True}
        entries = [dict(valid, principal='group.admin'), dict(valid, nodes=['w_farming.admin;quit']), dict(valid, source=2)]
        for entry in entries:
            with self.subTest(entry=entry):
                self.setUp()
                raw = json.dumps({'version': 1, 'entries': [entry]})
                self.lua.globals().KVP['wcsite_cleanup_v1'] = raw
                self.lua.execute((ROOT / 'core/script_permissions.lua').read_text(encoding='utf-8'))
                self.assertFalse(self.refresh())
                self.assertEqual(self.val('#COMMANDS'), 0)
                self.assertEqual(self.val('KVP.wcsite_cleanup_v1'), raw)

    def test_watchdog_expires_at_request_start_deadline(self):
        self.run_lua('BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); NOW=44000; BLOCK=false; coroutine.resume(CO)')
        self.assertTrue(self.bound())
        self.assertEqual(self.val('WC.ScriptPermissions.sessions[1].deadline'), 46000)
        self.run_lua('NOW=46000; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())

    def test_stalled_refresh_cannot_prevent_watchdog_expiry(self):
        self.refresh()
        self.run_lua('NOW=16000; BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); NOW=46000; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())
        self.run_lua('NOW=61000; BLOCK=false; coroutine.resume(CO)')
        self.assertFalse(self.val('RESULT'))
        self.assertFalse(self.bound())

    def test_late_response_never_grants(self):
        self.run_lua('BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); NOW=46000; BLOCK=false; coroutine.resume(CO)')
        self.assertFalse(self.val('RESULT'))
        self.assertFalse(self.bound())

    def test_clock_wrap_revokes_instead_of_extending_lease(self):
        self.refresh()
        self.run_lua('NOW=-1; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())

    def test_empty_snapshot_revokes_but_preserves_manual_permissions(self):
        self.refresh()
        self.run_lua("MODE='empty'; WC.ScriptPermissions.refresh()")
        self.assertFalse(self.bound())
        removed = [c for c in self.lua.globals().COMMANDS.values() if c.startswith('remove_')]
        self.assertEqual(len(removed), 3)
        self.assertTrue(all('wcsite.sp2_' in c for c in removed))
        self.assertTrue(all('group.admin' not in c and 'identifier.' not in c for c in removed))

    def test_subject_mismatch_duplicate_and_malformed_snapshots_revoke(self):
        for mode in ['wrong_epoch', 'wrong_lease', 'wrong_identity', 'wrong_license', 'wrong_session', 'unknown_source',
                     'duplicate_source', 'duplicate_permission', 'sparse_players', 'map_permissions', 'denied', 'throw']:
            with self.subTest(mode=mode):
                self.run_lua("MODE='normal'")
                self.assertTrue(self.refresh())
                self.lua.globals().MODE = mode
                self.assertFalse(self.refresh())
                self.assertFalse(self.bound())

    def test_http_refusal_and_disconnect_revoke(self):
        self.refresh()
        self.run_lua('STATUS=403; WC.ScriptPermissions.refresh()')
        self.assertFalse(self.bound())
        self.run_lua('STATUS=200; WC.ScriptPermissions.refresh(); LINKED=false; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())

    def test_reconnect_does_not_accept_inflight_old_link_response(self):
        self.run_lua('BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); LINKED=false; WC.ScriptPermissions.tick(); LINKED=true; BLOCK=false; coroutine.resume(CO)')
        self.assertFalse(self.bound())
        self.assertTrue(self.refresh())

    def test_drop_and_same_identifier_source_reuse_requires_new_generation(self):
        self.run_lua('BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); OLD=PAYLOAD.players[1].session; source=1; HANDLERS.playerDropped(); HANDLERS.playerJoining(); BLOCK=false; coroutine.resume(CO)')
        self.assertFalse(self.bound())
        self.assertTrue(self.refresh())
        self.assertNotEqual(self.val('OLD'), self.val('PAYLOAD.players[1].session'))

    def test_changed_native_identity_revokes_and_rejects_inflight(self):
        self.refresh()
        self.run_lua("NOW=16000; BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); PEOPLE[1].license='license:'..string.rep('b',40); WC.ScriptPermissions.tick(); BLOCK=false; coroutine.resume(CO)")
        self.assertFalse(self.bound())
        self.assertTrue(self.refresh())

    def test_missing_discord_or_license_never_receives_grants(self):
        self.run_lua('PEOPLE[1].discord=nil')
        self.refresh()
        self.assertFalse(self.bound())
        self.assertEqual(self.val('#PAYLOAD.players'), 0)

    def test_resource_stop_revokes_own_grants(self):
        self.refresh()
        self.run_lua("STARTED.w_farming=false; HANDLERS.onResourceStop('w_farming')")
        self.assertFalse(self.bound())

    def test_connector_stop_revokes_and_late_response_cannot_restore(self):
        self.refresh()
        self.run_lua("BLOCK=true; CO=coroutine.create(function() RESULT=WC.ScriptPermissions.refresh() end); coroutine.resume(CO); HANDLERS.onResourceStop('w_connector'); BLOCK=false; coroutine.resume(CO)")
        self.assertFalse(self.bound())
        self.assertFalse(self.refresh())

    def test_no_catalog_or_acl_permission_means_no_native_grants(self):
        self.run_lua('WC.ScriptPermissionRegistry=nil')
        self.assertFalse(self.refresh())
        self.assertFalse(self.bound())
        self.setUp()
        self.run_lua('ACL=false')
        self.assertFalse(self.refresh())
        self.assertFalse(self.bound())

    def test_unknown_or_injected_permission_id_is_never_executed(self):
        self.run_lua("GRANTS={'w_farming:w_farming.admin.view;quit'}")
        self.assertFalse(self.refresh())
        self.assertEqual(self.val('#COMMANDS'), 0)

    def test_reserved_nodes_rejected_even_if_inserted_into_registry(self):
        for node in ['admin', 'god', 'mod', 'group.admin', 'wranks.master', 'wrank.owner', '*', 'w_farming.*',
                     'command', 'command.exec', 'command.add_ace', 'command.setr', 'command.stop', 'command.addpermission', 'command.removepermission',
                     'w_guard.bypass', 'w_guard.owner', 'w_pausemenu.console', 'w_pausemenu.console.anything', 'w_admin.area.ranks',
                     'w_admin.area.settings', 'w_admin.area.resources', 'w_farming.admin;quit']:
            with self.subTest(node=node):
                self.assertFalse(self.lua.globals().WC.ScriptCatalog.safeNode(node))

    def test_command_ownership_must_be_unique_and_available(self):
        self.assertIn('w_inventory:command.giveitem', self.catalogue_ids())
        self.run_lua("REGISTERED[2]={name='giveitem',resource='w_admin'}")
        self.assertNotIn('w_inventory:command.giveitem', self.catalogue_ids())
        self.run_lua("REGISTERED={{name='giveitem'}}")
        self.assertNotIn('w_inventory:command.giveitem', self.catalogue_ids())
        self.run_lua('GetRegisteredCommands=nil')
        self.assertNotIn('w_inventory:command.giveitem', self.catalogue_ids())

    def test_curated_command_owner_hint_is_required_to_match_runtime(self):
        self.run_lua("WC.ScriptPermissionRegistry.groups[2].permissions[1].commandOwner='w_admin'")
        self.assertNotIn('w_inventory:command.giveitem', self.catalogue_ids())

    def test_exact_reviewed_dispatcher_sets_support_weather_and_medic(self):
        self.run_lua("STARTED.w_weathersync=true;STARTED.w_medic=true;STARTED.w_core=true;STARTED['rsg-core']=true; WC.ScriptPermissionRegistry.groups[3]=GROUP('w_weathersync',{ITEM('w_weathersync','command.weather')}); WC.ScriptPermissionRegistry.groups[3].permissions[1].commandOwners={'w_weathersync','w_core','rsg-core'}; WC.ScriptPermissionRegistry.groups[4]=GROUP('w_medic',{ITEM('w_medic','command.medrevive')}); WC.ScriptPermissionRegistry.groups[4].permissions[1].commandOwners={'w_medic','w_core'}; REGISTERED={{name='weather',resource='w_core'},{name='medrevive',resource='w_core'}}")
        self.assertIn('w_weathersync:command.weather', self.catalogue_ids())
        self.assertIn('w_medic:command.medrevive', self.catalogue_ids())
        self.run_lua("REGISTERED[1].resource='rsg-core'")
        self.assertIn('w_weathersync:command.weather', self.catalogue_ids())
        self.run_lua("REGISTERED[1].resource='w_lib';STARTED.w_lib=true")
        self.assertNotIn('w_weathersync:command.weather', self.catalogue_ids())

    def test_dispatcher_hint_cannot_launder_an_unreviewed_command_or_resource(self):
        self.run_lua("STARTED.w_core=true;WC.ScriptPermissionRegistry.groups[2].permissions[1].commandOwners={'w_core'};REGISTERED={{name='giveitem',resource='w_core'}}")
        self.assertNotIn('w_inventory:command.giveitem', self.catalogue_ids())
        self.run_lua("STARTED.w_weathersync=true;WC.ScriptPermissionRegistry.groups[3]=GROUP('w_weathersync',{ITEM('w_weathersync','command.giveitem')});WC.ScriptPermissionRegistry.groups[3].permissions[1].commandOwners={'w_core'}")
        self.assertNotIn('w_weathersync:command.giveitem', self.catalogue_ids())

    def test_malformed_or_ambiguous_dispatcher_ownership_is_not_grantable(self):
        self.run_lua("STARTED.w_weathersync=true;STARTED.w_core=true;WC.ScriptPermissionRegistry.groups[3]=GROUP('w_weathersync',{ITEM('w_weathersync','command.weather')});WC.ScriptPermissionRegistry.groups[3].permissions[1].commandOwners={'w_weathersync','w_core','w_lib'};REGISTERED={{name='weather',resource='w_core'}}")
        self.assertNotIn('w_weathersync:command.weather', self.catalogue_ids())
        self.run_lua("WC.ScriptPermissionRegistry.groups[3].permissions[1].commandOwners={'w_weathersync','w_core'};REGISTERED[2]={name='weather',resource='w_weathersync'}")
        self.assertNotIn('w_weathersync:command.weather', self.catalogue_ids())

    def test_livestock_alias_is_owned_only_by_farming(self):
        self.assertIn('w_farming:w_livestock.admin.animals', self.catalogue_ids())
        self.run_lua("WC.ScriptPermissionRegistry.groups[2].permissions[2]=ITEM('w_inventory','w_livestock.admin.animals')")
        self.assertNotIn('w_inventory:w_livestock.admin.animals', self.catalogue_ids())

    def test_survival_alias_is_scoped_to_the_reviewed_resource(self):
        self.run_lua("STARTED.w_survival=true; WC.ScriptPermissionRegistry.groups[3]=GROUP('w_survival',{ITEM('w_survival','survival.view')}); WC.ScriptPermissionRegistry.groups[2].permissions[2]=ITEM('w_inventory','survival.manage')")
        self.assertIn('w_survival:survival.view', self.catalogue_ids())
        self.assertNotIn('w_inventory:survival.manage', self.catalogue_ids())

    def test_catalogue_contains_presentation_only_no_rank_members(self):
        self.run_lua("STARTED.w_core=true; WC.ScriptPermissionRegistry.groups[1].permissions[1].label=nil; WC.ScriptPermissionRegistry.groups[1].permissions[1].description=nil; exports={w_core={RanksState=function() return {catalog={{nodes={{node='w_farming.admin.view',label={ar='المزرعة',en='Farming'},desc={ar='عرض',en='View'}}}}},members=setmetatable({},{__pairs=function() error('member disclosure') end})} end}}")
        self.assertIn('w_farming:w_farming.admin.view', self.catalogue_ids())
        self.assertIsNone(self.val('(WC.ScriptCatalog.build()).members'))


class RealFxServerNativeShapesTests(ScriptPermissionsTests):
    """Every lease test again with FXServer's real return values, plus the live 2.2.2 stuck-cleanup cases."""
    REAL_NATIVES = True
    STUCK = 'wcsite.sp2_8b30d542c7dc388756563869673829cf.7.3'

    def capture_warnings(self):
        self.run_lua("LOGS={}; WC.log=function(fmt, ...) LOGS[#LOGS+1]=fmt:format(...) end")

    def warnings(self):
        return list(self.lua.globals().LOGS.values())

    def test_real_shapes_grant_then_drop_retires_without_pending_warning(self):
        self.capture_warnings()
        self.assertTrue(self.refresh())
        self.assertTrue(self.bound())
        self.assertEqual(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"), 1)
        self.run_lua('source=1; HANDLERS.playerDropped()')
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(self.val('next(WC.ScriptPermissions.owned) ~= nil'))
        self.assertFalse(json.loads(self.val('KVP.wcsite_cleanup_v1'))['entries'])  # empty (the harness encodes {} for [])
        self.assertEqual(self.warnings(), [])

    def test_real_shapes_lease_expiry_retires_without_pending_warning(self):
        self.capture_warnings()
        self.assertTrue(self.refresh())
        self.run_lua('NOW=46000; WC.ScriptPermissions.tick()')
        self.assertFalse(self.bound())
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertEqual(self.warnings(), [])

    def stuck_journal(self, live_aces):
        # The entry 2.2.2 left on Studio/Red River: a grant aborted after its probe add, for a player who is gone.
        entry = {'source': 7, 'principal': self.STUCK, 'nodes': ['w_farming.admin.view'], 'bound': True, 'probe': True}
        self.lua.globals().STUCK_JOURNAL = json.dumps({'version': 1, 'entries': [entry]})
        self.run_lua("KVP.wcsite_cleanup_v1=STUCK_JOURNAL; PEOPLE={}")
        if live_aces:  # resource restart inside the same FXServer process: the ACEs are still in memory
            self.run_lua("P='%s'; ExecuteCommand('add_ace '..P..' '..P..'.bound allow'); ExecuteCommand('add_ace '..P..' w_farming.admin.view allow'); ExecuteCommand('add_principal player.7 '..P)" % self.STUCK)
        self.capture_warnings()
        self.lua.execute((ROOT / 'core/script_permissions.lua').read_text(encoding='utf-8'))
        self.assertTrue(self.val("WC.ScriptPermissions.pending['%s'] ~= nil" % self.STUCK))
        self.run_lua('WC.ScriptPermissions.tick()')

    def test_stuck_journal_of_a_gone_player_is_retired_after_server_restart(self):
        self.stuck_journal(live_aces=False)
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(json.loads(self.val('KVP.wcsite_cleanup_v1'))['entries'])  # empty (the harness encodes {} for [])
        self.assertEqual(self.warnings(), [])

    def test_stuck_journal_with_aces_still_in_memory_is_removed_and_retired(self):
        self.stuck_journal(live_aces=True)
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.7','w_farming.admin.view')"))
        self.assertFalse(self.val("IsPrincipalAceAllowed('%s','%s.bound')" % (self.STUCK, self.STUCK)))
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertFalse(json.loads(self.val('KVP.wcsite_cleanup_v1'))['entries'])  # empty (the harness encodes {} for [])
        self.assertEqual(self.warnings(), [])

    def test_silently_denied_removal_stays_pending_until_the_acl_returns(self):
        # Without the ACL lines FXServer drops remove_ace/remove_principal silently (same false result).
        self.assertTrue(self.refresh())
        self.capture_warnings()
        self.run_lua("ORIG_EXEC=ExecuteCommand; DENY=true; function ExecuteCommand(line) if DENY and line:match('^remove_') then return false end return ORIG_EXEC(line) end; source=1; HANDLERS.playerDropped()")
        self.assertEqual(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"), 1)
        self.assertTrue(self.val('next(WC.ScriptPermissions.pending) ~= nil'))
        self.assertEqual(len(self.warnings()), 1)
        self.run_lua('DENY=false; NOW=NOW+500; WC.ScriptPermissions.tick()')
        self.assertFalse(self.val("IsPrincipalAceAllowed('player.1','w_farming.admin.view')"))
        self.assertFalse(self.val('next(WC.ScriptPermissions.pending) ~= nil'))


class TransportLeaseTimeoutTests(unittest.TestCase):
    def setUp(self):
        self.lua = lua54.LuaRuntime()
        self.lua.execute(r'''
MODE='timeout';TIMERS={};RESOLVES=0
WC={crypto={sha256Hex=function() return 'hash' end,hmacHex=function() return 'sig' end},Adapters={detect=function() end,get=function() return nil end,describe=function() return nil end},Ops={available=function() return {} end}}
function GetConvar(k,d) if k=='wraith_token' then return 'wc2.k1234567890abcdef1234.unit_test_secret' end return d end
function GetGameName() return 'fxserver' end
function GetResourceMetadata() return '2.0.2' end
function GetCurrentResourceName() return 'w_connector' end
function GetGameTimer() return 1000 end
function SetTimeout(ms,fn) TIMERS[#TIMERS+1]={ms=ms,fn=fn} end
function PerformHttpRequest(url,callback) CALLBACK=callback; if MODE=='immediate' then callback(200,'json') end end
json={encode=function(payload) ENCODED=payload;return '{}' end,decode=function() return {ok=true,server={id='unit'},pollWait=25,heartbeat=15} end}
promise={new=function() return {resolve=function(self,value) RESOLVES=RESOLVES+1;self.value=value end} end}
Citizen={Await=function(p) if not p.value then TIMERS[#TIMERS].fn() end return p.value end}
''')
        self.lua.execute((ROOT / 'core/transport.lua').read_text(encoding='utf-8'))
        self.lua.execute('WC.loadConfig()')

    def test_bounded_request_returns_without_http_and_ignores_late_callback(self):
        self.lua.execute("STATUS,ANSWER=WC.request('POST','/permissions',{},45000)")
        self.assertEqual(self.lua.eval('STATUS'), 0)
        self.assertEqual(self.lua.eval('TIMERS[1].ms'), 45000)
        self.lua.execute("CALLBACK(200,'late')")
        self.assertEqual(self.lua.eval('RESOLVES'), 1)

    def test_success_is_not_resolved_again_by_timeout(self):
        self.lua.execute("MODE='immediate';STATUS,ANSWER=WC.request('POST','/permissions',{},45000);TIMERS[1].fn()")
        self.assertEqual(self.lua.eval('STATUS'), 200)
        self.assertEqual(self.lua.eval('RESOLVES'), 1)

    def test_legacy_callers_do_not_receive_an_unsolicited_timeout(self):
        self.lua.execute("MODE='immediate';STATUS,ANSWER=WC.request('POST','/heartbeat',{})")
        self.assertEqual(self.lua.eval('STATUS'), 200)
        self.assertEqual(self.lua.eval('#TIMERS'), 0)

    def test_hello_projects_only_catalogue_and_capability_fingerprint_tracks_it(self):
        self.lua.execute("MODE='immediate';FINGERPRINT='catalog_one';WC.ScriptPermissions={catalog=function() return {version=1,groups={{id='w_farming'}}} end,fingerprint=function() return FINGERPRINT end}; WC.log=function() end; BEFORE=WC.capabilities(); WC.hello(); FINGERPRINT='catalog_two'; AFTER=WC.capabilities()")
        self.assertEqual(self.lua.eval('ENCODED.permissionCatalog.version'), 1)
        self.assertIsNone(self.lua.eval('ENCODED.permissionCatalog.members'))
        self.assertNotEqual(self.lua.eval('BEFORE'), self.lua.eval('AFTER'))

    def test_empty_catalogue_does_not_break_generic_server_hello(self):
        self.lua.execute("MODE='immediate';WC.ScriptPermissions={catalog=function() return {version=1,groups={}} end,fingerprint=function() return '1' end};WC.log=function() end;WC.hello()")
        self.assertIsNone(self.lua.eval('ENCODED.permissionCatalog'))
        self.assertTrue(self.lua.eval('WC.linked()'))

    def test_catalogue_change_during_hello_triggers_a_fresh_hello(self):
        self.lua.execute("FINGERPRINT='catalog_one';WC.ScriptPermissions={catalog=function() return {version=1,groups={}} end,fingerprint=function() return FINGERPRINT end}; WC.log=function() end; THREADS={};function CreateThread(fn) THREADS[#THREADS+1]=fn end;function Wait() coroutine.yield() end;HELLOS=0;WC.request=function() HELLOS=HELLOS+1;FINGERPRINT='catalog_two';return 200,{ok=true,server={id='unit'},pollWait=25,heartbeat=15} end;WC.start();CO=coroutine.create(THREADS[1]);coroutine.resume(CO);coroutine.resume(CO);coroutine.resume(CO)")
        self.assertEqual(self.lua.eval('HELLOS'), 2)


if __name__ == '__main__':
    unittest.main()
