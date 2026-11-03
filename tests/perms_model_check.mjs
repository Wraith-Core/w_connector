// 2.3.1: web/src/pages/perms/model.ts under Node (type stripping): the 'access' push read defensively and
// laid out like the website's roles page. Run by tests/test_perms_page.py; prints "ok" or throws.
import assert from 'node:assert/strict';
import { buildView, matches, toAccess } from '../web/src/pages/perms/model.ts';

const label = (ar, en) => ({ ar, en });
const push = {
  rev: 3, role: 'admin',
  roles: [{ name: 'Economy', direct: true, discord: false }, { name: 'Sheriffs', direct: false, discord: true }, { name: '' }, 7],
  web: {
    held: ['players.view', 'players.money', 'future.perm'],
    catalog: [
      { id: 'players.view', label: label('عرض اللاعبين', 'View players'), description: label('عرض قائمة اللاعبين.', 'View players.') },
      { id: 'players.money', label: label('تعديل أموال اللاعبين', 'Adjust player money'), description: label('إضافة الأموال.', 'Add money.') },
      { id: 'console.command', ownerOnly: true, label: label('تنفيذ أوامر الكونسول', 'Run console commands'), description: label('للمالك فقط.', 'Owner only.') },
      { id: 'broken', label: 'not a text' },
    ],
  },
  scripts: {
    held: ['w_farming:w_farming.admin', 'w_gone:w_gone.admin'], from: 'website',
    groups: [
      { id: 'w_farming', label: label('المزرعة', 'Farming'), permissions: [
        { id: 'w_farming:w_farming.admin', node: 'w_farming.admin', label: label('إدارة المزارع', 'Farm admin'), description: label('كل شيء.', 'Everything.'), danger: true },
        { id: 'w_farming:w_farming.view', node: 'w_farming.view', label: label('عرض المزارع', 'View farms'), description: label('عرض.', 'View.') },
      ] },
      { id: 'w_empty', label: label('فارغ', 'Empty'), permissions: {} },
    ],
  },
  manage: { url: 'https://wraith7.com/redm/dashboard', where: label('الإعدادات ← الرتب والصلاحيات', 'Settings → Roles & Permissions') },
};

const a = toAccess(push);
assert.ok(a);
assert.deepEqual(a.roles, [{ name: 'Economy', direct: true, discord: false }, { name: 'Sheriffs', direct: false, discord: true }]);
assert.deepEqual(a.web.catalog.map((p) => p.id), ['players.view', 'players.money', 'console.command']);
const v = buildView(a);
assert.equal(v.role, 'admin');
assert.deepEqual(v.web.map((r) => [r.id, r.mine, r.ownerOnly]), [
  ['players.view', true, false], ['players.money', true, false], ['console.command', false, true], ['future.perm', true, false],
]);
assert.equal(v.web[3].label, null); // a permission newer than the names: shown by its id
assert.deepEqual(v.counts, { web: 3, webTotal: 4, scripts: 1, scriptsTotal: 2 });
assert.deepEqual(v.scripts.map((g) => g.id), ['w_farming']); // an empty group is not drawn
assert.equal(v.scripts[0].rows[0].danger, true);
assert.deepEqual(v.scriptsUnknown, ['w_gone:w_gone.admin']);
assert.equal(v.manage.url, 'https://wraith7.com/redm/dashboard');

// search and filters, in either language, the description or the id
assert.equal(matches(v.web[1], 'all', 'money', 'ar'), true);
assert.equal(matches(v.web[1], 'all', 'أموال', 'en'), true);
assert.equal(matches(v.web[1], 'locked', '', 'ar'), false);
assert.equal(matches(v.web[2], 'locked', 'console.command', 'ar'), true);
assert.equal(matches(v.web[2], 'mine', '', 'ar'), false);

// an older website: no names, no role sources, scripts as the server applies them
const old = buildView(toAccess({ rev: 1, role: 'custom', roles: [{ name: 'Helpers' }], web: { held: ['reports.view'] }, scripts: { held: [], from: 'server', groups: [] } }));
assert.equal(old.webNamed, false);
assert.deepEqual(old.web.map((r) => [r.id, r.mine, r.label]), [['reports.view', true, null]]);
assert.equal(old.scriptsFrom, 'server');
assert.equal(old.manage, null);

// FXServer's empty tables ({} for []), unknown roles and hostile shapes never throw
const empty = buildView(toAccess({ rev: 'x', role: 'god', roles: {}, web: { held: {}, catalog: {} }, scripts: { held: {}, groups: {} }, manage: { url: 'javascript:alert(1)' } }));
assert.equal(empty.role, null);
assert.equal(empty.webNamed, true);
assert.deepEqual(empty.web, []);
assert.equal(empty.manage, null);
assert.equal(toAccess(null), null);
assert.equal(toAccess([]), null);
assert.ok(buildView(toAccess({})));

console.log('ok');
