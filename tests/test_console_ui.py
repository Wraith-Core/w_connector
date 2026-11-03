"""2.3.0: the console UI ships with its corresponding GPL source, and the board look's keys stay safe."""
from pathlib import Path
import filecmp
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
GPL = ROOT / 'LICENSES' / 'console-source'


def tree(base):
    return sorted(p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file())


class ConsoleSourceTests(unittest.TestCase):
    def test_gpl_copy_matches_the_built_source(self):
        """LICENSES/console-source is the corresponding source of web/build: same files, same bytes."""
        for sub in ('src', 'scripts', 'public'):
            a, b = WEB / sub, GPL / sub
            self.assertEqual(tree(a), tree(b), sub)
            for rel in tree(a):
                self.assertTrue(filecmp.cmp(a / rel, b / rel, shallow=False), f'{sub}/{rel} differs')
        for name in ('package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'index.html', 'dev.html'):
            self.assertTrue(filecmp.cmp(WEB / name, GPL / name, shallow=False), name)

    def test_help_texts_copy_matches(self):
        a, b = ROOT / 'locales' / 'help', ROOT / 'LICENSES' / 'locales' / 'help'
        self.assertEqual(tree(a), tree(b))
        for rel in tree(a):
            self.assertTrue(filecmp.cmp(a / rel, b / rel, shallow=False), rel)

    def test_build_is_the_ui_page(self):
        manifest = (ROOT / 'fxmanifest.lua').read_text(encoding='utf-8-sig')
        self.assertIn("ui_page 'web/build/index.html'", manifest)
        for name in ('index.html', 'assets/app.js', 'assets/app.css', 'theme/tex/tear.png', 'theme/tex/selection_box_bg_1a.png'):
            self.assertTrue((WEB / 'build' / name).is_file(), name)


class ConsoleKeysTests(unittest.TestCase):
    def test_desk_letter_keys_are_unique_and_never_digits(self):
        """The home desk's letter keys: one action per key, no digit (1-9 open the menu's sections)."""
        src = (WEB / 'src/pages/dashboard/Desk.tsx').read_text(encoding='utf-8')
        codes = re.findall(r"code: '([A-Za-z0-9]+)'", src)
        self.assertGreaterEqual(len(codes), 10)
        self.assertEqual(len(codes), len(set(codes)), codes)
        self.assertTrue(all(c.startswith('Key') for c in codes), codes)

    def test_every_shortcut_skips_typing_and_dialogs(self):
        """Each window key listener added in 2.3.0 ignores text fields, open dialogs and list popups."""
        for rel in ('src/pages/dashboard/Desk.tsx', 'src/app/AppShell.tsx', 'src/quick/index.tsx'):
            src = (WEB / rel).read_text(encoding='utf-8')
            self.assertIn('isTypingTarget(e.target)', src, rel)
            self.assertRegex(src, r"querySelector\('[^']*\.k-dialog-veil[^']*\.k-pop[^']*'\)", rel)

    def test_destructive_desk_actions_still_confirm(self):
        """Kick goes through the confirm dialog with a reason; ban only opens the player's moderation tab."""
        src = (WEB / 'src/pages/dashboard/Desk.tsx').read_text(encoding='utf-8')
        kick = src[src.index("case 'kick':"):src.index('default:', src.index("case 'kick':"))]
        self.assertIn('app.confirm<string>', kick)
        self.assertIn('danger: true', kick)
        self.assertIn("canConfirm: (v) => v.trim() !== ''", kick)
        self.assertIn("case 'ban': app.navigate('players', { sel: String(p.id), view: 'moderation' })", src)


if __name__ == '__main__':
    unittest.main()
