"""Run the real deferral flow locally; no website or game connection."""
from pathlib import Path
import unittest
from lupa import lua54

ROOT = Path(__file__).resolve().parents[1]
# join.lua draws its refusals with core/joincard.lua (2.4.4), loaded before it as in fxmanifest.lua
SOURCE = '\n'.join((ROOT / f).read_text(encoding='utf-8-sig') for f in ('core/joincard.lua', 'core/join.lua'))

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


class WaitApprovalTests(unittest.TestCase):
    """2.2.4: the waitApproval mode holds the player on the connecting screen until /join/wait answers."""
    def run_wait(self, answers, lang='ar', leave_after=None, timer_step=0):
        lua = lua54.LuaRuntime(unpack_returned_tuples=True)
        lua.execute("""
LANG='ar';H={};UPDATES={};DONE={};CALLS={};source=1;T=1000;STEP=0;LEFT=false;LEAVE_AFTER=nil
function GetConvar(k,d) if k=='w_lib:locale' then return LANG else return d end end
function GetConvarInt(k,d) if k=='wraith_join_wait_minutes' then return 1 end return 32 end
function GetNumPlayerIndices() return 0 end
function GetGameTimer() T=T+STEP return T end
function GetPlayerName() if LEFT then return nil end return 'p' end
function AddEventHandler(k,f) H[k]=f end
function Wait(ms) end
D={defer=function() end,update=function(s) UPDATES[#UPDATES+1]=s end,done=function(s) DONE[#DONE+1]=s or 'allowed' end}
""")
        g = lua.globals()
        g.LANG, g.STEP = lang, timer_step
        state = {'n': 0}
        def request(method, path, body):
            calls = g.CALLS
            calls[len(calls) + 1] = path
            if path == '/join':
                return 200, lua.table_from({'allow': False, 'reason': 'allowlist_wait', 'requestId': 'R2345', 'instructions': '  Apply on Discord  '})
            state['n'] += 1
            if leave_after is not None and state['n'] >= leave_after:
                g.LEFT = True
            a = answers[min(state['n'], len(answers)) - 1]
            if a is None:
                return 0, None
            return 200, lua.table_from(a)
        lua.execute("WC={linked=function() return true end,identifiers=function() return {discord='discord:1'} end}")
        g.WC.request = request
        lua.execute(SOURCE)
        lua.execute("H.playerConnecting('Player',nil,D)")
        return lua

    def test_waits_then_joins_when_approved(self):
        lua = self.run_wait([{'status': 'pending'}, None, {'status': 'approved', 'priority': 2}])
        self.assertEqual(lua.eval('DONE[1]'), 'allowed')
        self.assertEqual(lua.eval('#DONE'), 1)
        self.assertEqual(lua.eval('#CALLS'), 4)  # /join, then three polls (one network error kept the player waiting)
        card = lua.eval('UPDATES[2]')
        self.assertIn('بانتظار موافقة الإدارة', card)
        self.assertIn('R2345', card)
        self.assertIn('Apply on Discord', card)
        self.assertNotIn('  Apply', card)

    def test_denied_sends_the_player_away(self):
        lua = self.run_wait([{'status': 'denied'}])
        self.assertIn('رفضت الإدارة', lua.eval('DONE[1]'))
        self.assertEqual(lua.eval('#DONE'), 1)

    def test_times_out(self):
        lua = self.run_wait([{'status': 'pending'}], lang='en', timer_step=20000)
        self.assertIn('R2345', lua.eval('DONE[1]'))
        self.assertIn('try again later', lua.eval('DONE[1]'))

    def test_player_who_leaves_is_not_answered(self):
        lua = self.run_wait([{'status': 'pending'}], leave_after=1)
        self.assertEqual(lua.eval('#DONE'), 0)


class JoinCardTests(unittest.TestCase):
    """2.4.4: refusals are one right-to-left HTML card (RedM's dialog renders HTML, turns each newline into <br>)."""
    def setUp(self):
        self.lua = lua54.LuaRuntime()
        self.lua.execute((ROOT / 'core/joincard.lua').read_text(encoding='utf-8-sig'))

    def test_card_is_one_line_rtl_and_escaped(self):
        html = self.lua.eval("JoinCard.render({ tone = 'ban', title = 'أنت محظور', facts = { { 'السبب', '<b>x</b>\\nسطر' }, { 'رقم', '7', code = true } } })")
        self.assertNotIn('\n', html)
        self.assertIn('direction:rtl', html)
        self.assertIn('&lt;b&gt;x&lt;/b&gt;<br>سطر', html)
        self.assertNotIn('<b>x', html)

    def test_english_card_is_left_to_right(self):
        self.assertIn('direction:ltr', self.lua.eval("JoinCard.render({ title = 'Closed', body = 'Try later.' })"))

    def test_progress_line_isolates_arabic_only(self):
        self.assertEqual(self.lua.eval("JoinCard.line('Checking…')"), 'Checking…')
        self.assertEqual(self.lua.eval("JoinCard.line('أ\\nب')"), '⁧أ⁩\n⁧ب⁩')

    def test_the_three_copies_are_equal(self):
        here = (ROOT / 'core/joincard.lua').read_bytes()
        for other in ('w_core/server/joincard.lua', 'w_guard/server/joincard.lua'):
            path = ROOT.parent / other
            if path.exists():
                self.assertEqual(path.read_bytes(), here, other)


if __name__ == '__main__': unittest.main()
