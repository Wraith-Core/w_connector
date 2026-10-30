"""Run the real deferral flow locally; no website or game connection."""
from pathlib import Path
import unittest
from lupa import lua54

SOURCE = (Path(__file__).resolve().parents[1] / 'core/join.lua').read_text(encoding='utf-8-sig')

class JoinTests(unittest.TestCase):
    def run_flow(self, lang, linked=True, denied=False, full=False):
        lua = lua54.LuaRuntime()
        lua.execute('''
LANG='ar';LINKED=true;DENIED=false;FULL=false;SLOTS=32;H={};UPDATES={};source=1;DONE={}
function GetConvar(k,d) if k=='w_lib:locale' then return LANG elseif k=='wraith_join_fail_closed' then return 'true' else return d end end
function GetConvarInt() return 32 end
function GetNumPlayerIndices() return FULL and SLOTS or 0 end
function GetGameTimer() return 1000 end
function GetPlayerName() return 'test player' end
function AddEventHandler(k,f) H[k]=f end
function Wait(ms) if ms==2000 then SLOTS=31 end end
WC={linked=function() return LINKED end,identifiers=function() return {} end,request=function() return 200,{allow=not DENIED} end}
D={defer=function() end,update=function(s) UPDATES[#UPDATES+1]=s end,done=function(s) DONE[#DONE+1]=s or 'allowed' end}
''')
        lua.globals().LANG, lua.globals().LINKED, lua.globals().DENIED, lua.globals().FULL = lang, linked, denied, full
        lua.execute(SOURCE)
        lua.execute("H.playerConnecting('Player',nil,D)")
        return lua
    def test_arabic_queue_gives_position_and_next_step(self):
        lua=self.run_flow('ar',full=True)
        self.assertIn('ترتيبك 1 من 1', lua.eval('UPDATES[2]'))
        self.assertIn('تلقائيًا', lua.eval('UPDATES[2]'))
        self.assertEqual(lua.eval('DONE[1]'), 'allowed')
    def test_arabic_failure_and_refusal(self):
        self.assertIn('حاول مجددًا',self.run_flow('ar',linked=False).eval('DONE[1]'))
        self.assertIn('راجع الإدارة',self.run_flow('ar',denied=True).eval('DONE[1]'))
    def test_english_fallback(self):
        self.assertIn('automatically',self.run_flow('en',full=True).eval('UPDATES[2]'))

if __name__ == '__main__': unittest.main()
