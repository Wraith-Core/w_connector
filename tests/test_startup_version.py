"""Actual startup emits its real manifest version for automatic delivery verification."""
from pathlib import Path
import re
import unittest

from lupa import lua54

ROOT=Path(__file__).resolve().parents[1]
VERSION_RE=re.compile(r'\bw_connector\s+v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b')


class StartupVersionTests(unittest.TestCase):
    def runtime(self, version='2.0.3', configured=True):
        lua=lua54.LuaRuntime()
        lua.execute('''
LOGS={};THREADS={};CONVARS={};META='2.0.3';META_READS={}
function print(line) LOGS[#LOGS+1]=line end
function GetCurrentResourceName() return 'w_connector' end
function GetGameName() return 'rdr3' end
function GetResourceMetadata(resource,key,index)
 META_READS[#META_READS+1]={resource=resource,key=key,index=index};return META
end
function GetConvar(key,default) return CONVARS[key] or default end
function GetGameTimer() return 1000 end
function CreateThread(fn) THREADS[#THREADS+1]=fn end
function Wait() coroutine.yield() end
''')
        lua.globals().META=version
        if configured:
            lua.execute("CONVARS.wraith_token='wc2.kabcdef.unit_test_only_token'")
        lua.execute((ROOT/'core/util.lua').read_text(encoding='utf-8-sig'))
        lua.execute((ROOT/'core/transport.lua').read_text(encoding='utf-8-sig'))
        lua.execute((ROOT/'core/main.lua').read_text(encoding='utf-8-sig'))
        return lua

    def lines(self,lua):
        return [lua.globals().LOGS[i] for i in range(1,len(lua.globals().LOGS)+1)]

    def test_configured_start_has_one_delivery_readable_actual_version(self):
        lua=self.runtime()
        self.assertEqual(self.lines(lua),['[w_connector] w_connector v2.0.3'])
        self.assertEqual(VERSION_RE.search(self.lines(lua)[0]).group(1),'2.0.3')
        self.assertEqual(lua.eval('#THREADS'),3)
        self.assertEqual(lua.eval('META_READS[1].resource'),'w_connector')
        self.assertEqual(lua.eval('META_READS[1].key'),'version')
        self.assertEqual(lua.eval('META_READS[1].index'),0)

    def test_missing_config_still_logs_version_before_refusal_and_starts_no_threads(self):
        lua=self.runtime(configured=False)
        self.assertEqual(self.lines(lua)[0],'[w_connector] w_connector v2.0.3')
        self.assertIn('not starting:',self.lines(lua)[1])
        self.assertEqual(len(self.lines(lua)),2)
        self.assertEqual(lua.eval('#THREADS'),0)

    def test_version_is_metadata_not_a_hardcoded_release(self):
        for version in ('7.8.9','7.8.9-rc.2+build.4'):
            with self.subTest(version=version):
                lua=self.runtime(version)
                self.assertEqual(self.lines(lua)[0],'[w_connector] w_connector v'+version)
                self.assertEqual(VERSION_RE.search(self.lines(lua)[0]).group(1),version)

    def test_absent_empty_or_non_string_metadata_cannot_confirm_delivery(self):
        for version in (None,'',False,203):
            with self.subTest(version=version):
                lua=self.runtime(version,configured=False)
                self.assertEqual(self.lines(lua)[0],'[w_connector] w_connector vunknown')
                self.assertIsNone(VERSION_RE.search('\n'.join(self.lines(lua))))
                self.assertEqual(lua.eval('#THREADS'),0)

    def test_background_threads_do_not_repeat_startup_version(self):
        lua=self.runtime()
        lua.execute('''
WC.ScriptPermissions=nil;WC.Ops={available=function()return{}end};WC.Adapters={detect=function()end,get=function()return nil end,describe=function()return nil end}
WC.modules=function()return{}end;WC.request=function()return 200,{ok=true,server={},pollWait=25,heartbeat=15}end
WC.onlinePlayers=function()return{}end
for _,fn in ipairs(THREADS)do local co=coroutine.create(fn);for i=1,6 do assert(coroutine.resume(co)) end end
''')
        self.assertEqual(sum(VERSION_RE.search(line) is not None for line in self.lines(lua)),1)


if __name__=='__main__':unittest.main()
