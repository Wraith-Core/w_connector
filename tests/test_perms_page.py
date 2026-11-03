"""2.3.1: the permissions page shows the admin's access the way the website models it."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def text(rel):
    return (ROOT / rel).read_text(encoding='utf-8-sig')


class PermsModelTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_page_model_reads_the_push_like_the_website(self):
        """web/src/pages/perms/model.ts under Node: rows, counts, older websites and hostile shapes."""
        run = subprocess.run(['node', str(ROOT / 'tests' / 'perms_model_check.mjs')], capture_output=True, text=True, timeout=60)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('ok', run.stdout)


class PermsWiringTests(unittest.TestCase):
    def test_page_asks_for_its_data_and_lua_answers_only_the_live_session(self):
        self.assertIn("refresh: ['access']", text('web/src/pages/perms/index.tsx'))
        client = text('client/cl_console.lua')
        self.assertIn("if what == 'access' then askAccess(); return end", client)
        self.assertIn("TriggerServerEvent('w_connector:console:access', C.session.nonce)", client)
        self.assertRegex(client, r"RegisterNetEvent\('w_connector:console:access', function\(block, nonce\)\s+if foreign\(\) or not WMenu\.open or not C\.session or nonce ~= C\.session\.nonce")
        server = text('ops/console.lua')
        handler = server[server.index("RegisterNetEvent('w_connector:console:access'"):]
        handler = handler[:handler.index('end)') + 4]
        self.assertIn('limited(src)', handler)
        self.assertIn('not C.valid(s) or sessionNonce ~= s.nonce', handler)
        self.assertIn('C.access(s)', handler)

    def test_access_is_display_data_only(self):
        """The page data never feeds s.allowed: authority stays with the website's action list."""
        server = text('ops/console.lua')
        body = server[server.index('local function keepAccess'):server.index('function C.access')]
        self.assertNotIn('allowed', body)

    def test_texts_point_to_the_website_never_to_w_admin(self):
        for lang in ('ar', 'en'):
            for page in ('perms', 'ranks'):
                for base in ('locales/help', 'LICENSES/locales/help'):
                    raw = text(f'{base}/{page}.{lang}.json')
                    self.assertNotIn('w_admin', raw, f'{base}/{page}.{lang}')
                    json.loads(raw)
            perms = json.loads(text(f'locales/help/perms.{lang}.json'))['label']['perms']
            for role in ('owner', 'admin', 'moderator', 'viewer', 'custom'):
                self.assertTrue(perms['role'][role])
        self.assertIn('الموقع', json.loads(text('locales/help/perms.ar.json'))['label']['perms']['manageTitle'])
        self.assertNotIn('ماستر', text('locales/help/ranks.ar.json'))

    def test_role_names_match_the_console_header(self):
        """The page and the console header (client/cl_console.lua) call each website role the same."""
        client = text('client/cl_console.lua')
        ar = json.loads(text('locales/help/perms.ar.json'))['label']['perms']['role']
        en = json.loads(text('locales/help/perms.en.json'))['label']['perms']['role']
        for role in ('owner', 'admin', 'moderator', 'viewer', 'custom'):
            self.assertRegex(client, re.escape(f"{role} = '{ar[role]}'"))
            self.assertRegex(client, re.escape(f"{role} = '{en[role]}'"))


if __name__ == '__main__':
    unittest.main()
