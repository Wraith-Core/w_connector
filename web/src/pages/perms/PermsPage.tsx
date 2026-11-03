/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/perms/PermsPage.tsx  (read only; 2.3.1: the website's model)
 * Your access exactly as the website's roles page models it:
 *   your base role on the website + your custom roles (and which come through a Discord role)
 *   where permissions are managed (the website panel's Roles & Permissions, and the Ranks page here)
 *   the website permissions in the website's order with its own names (ar + en), allowed or locked
 *   the in-game script permissions one script at a time, with this server's catalogue names
 * Data: the 'access' push (ops/console.lua C.access), asked when the page opens. Nothing here posts a change.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, CopyButton, DataTable, EmptyState, FilterChips, Glyph, HelpTip, InlineAlert, Loading, Section, Switch, Tag, TextInput, Toolbar, fmtNum,
} from '../../kit';
import type { ChipItem, Column } from '../../kit';
import { buildView, matches } from './model';
import type { Filter, PermRow, PermsView } from './model';

export default function PermsPage() {
  const app = useApp();
  const { t, lt, lang } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [details, setDetails] = useState(false);

  const view = useMemo<PermsView | null>(() => (app.access ? buildView(app.access) : null), [app.access]);
  if (!view) return <div className="pm-page"><Loading text={t('label.perms.loading')} /></div>;

  const keep = (r: PermRow) => matches(r, filter, q, lang);
  const web = view.web.filter(keep);
  const scripts = view.scripts.map((g) => ({ ...g, shown: g.rows.filter(keep) })).filter((g) => g.shown.length > 0);
  const every = [...view.web, ...view.scripts.flatMap((g) => g.rows)];
  const mine = every.filter((r) => r.mine).length;
  const nothing = web.length === 0 && scripts.length === 0 && (q.trim() !== '' || filter !== 'all');

  const columns: Column<PermRow>[] = [
    {
      key: 'perm', label: t('label.perms.col.perm'), help: 'help.perms.col.perm', width: '19rem', className: 'pm-wrap',
      render: (r) => (
        <span className="pm-perm">
          <span className="k-cell-main">{r.label ? lt(r.label) : t('label.perms.unnamed')}</span>
          {r.ownerOnly && <Tag tone="faint">{t('label.perms.ownerOnly')}</Tag>}
          {r.danger && <Tag tone="faint">{t('label.perms.danger')}</Tag>}
          {(details || !r.label) && <span className="k-cell-sub pm-key">{r.id}</span>}
        </span>
      ),
    },
    {
      key: 'desc', label: t('label.perms.col.desc'), help: 'help.perms.col.desc', className: 'pm-wrap',
      render: (r) => <span className="pm-allows">{r.description ? lt(r.description) : '—'}</span>,
    },
    {
      key: 'you', label: t('label.perms.col.you'), help: 'help.perms.col.you', width: '9rem',
      render: (r) => <You mine={r.mine} />,
    },
  ];

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.perms.filter.all'), count: every.length, help: 'help.perms.filter.all' },
    { id: 'mine', label: t('label.perms.filter.mine'), count: mine, help: 'help.perms.filter.mine' },
    { id: 'locked', label: t('label.perms.filter.locked'), count: every.length - mine, help: 'help.perms.filter.locked' },
  ];
  const lockClass = (r: PermRow) => (r.mine ? undefined : 'pm-row-locked');

  return (
    <div className="pm-page">
      <div className="pm-top">
        <YouCard view={view} />
        <RolesCard view={view} />
      </div>

      <InlineAlert
        tone="info"
        title={t('label.perms.manageTitle')}
        help="help.perms.manage"
        actions={app.can('ranks') ? <Button help="help.perms.openRanks" size="sm" kind="ghost" icon="arrow" onClick={() => app.navigate('ranks')}>{t('label.perms.openRanks')}</Button> : undefined}
      >
        <p>{view.manage?.where ? t('label.perms.manage', lt(view.manage.where)) : t('label.perms.manageNoWhere')}</p>
        {view.manage && (
          <p className="pm-link">
            <span className="pm-link-k">{t('label.perms.link')}</span>
            <bdi className="pm-url">{view.manage.url}</bdi>
            <CopyButton value={view.manage.url} label={t('label.perms.link')} />
          </p>
        )}
        <p className="pm-note">{t('label.perms.manageRanks')}</p>
      </InlineAlert>
      {!view.webNamed && <InlineAlert tone="info">{t('label.perms.noWebNames')}</InlineAlert>}

      <Toolbar className="pm-toolbar">
        <TextInput
          value={q}
          onChange={setQ}
          icon="search"
          clearable
          placeholder={t('label.perms.search')}
          label={t('label.perms.search')}
          help="help.perms.search"
          className="pm-search"
        />
        <FilterChips label={t('label.perms.filters')} value={filter} onChange={setFilter} items={chips} />
        <span className="k-push pm-switch">
          <span className="pm-switch-label" aria-hidden="true">{t('label.perms.details')}</span>
          <Switch checked={details} onChange={setDetails} label={t('label.perms.details')} help="help.perms.details" size="sm" />
        </span>
      </Toolbar>

      {nothing && (
        <EmptyState
          text={t('label.perms.none')}
          next={<Button help="help.common.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.perms.clear')}</Button>}
        />
      )}

      {web.length > 0 && (
        <Section className="pm-group" title={t('label.perms.web')} help="help.perms.web"
          actions={<Count n={view.counts.web} of={view.counts.webTotal} />}>
          <DataTable label={t('label.perms.web')} columns={columns} rows={web} rowKey={(r) => r.id} rowClass={lockClass} />
        </Section>
      )}

      {!nothing && (
        <Section className="pm-group pm-scripts" title={t('label.perms.scripts')} help="help.perms.scripts"
          lead={t('label.perms.scriptsLead')}
          actions={view.counts.scriptsTotal > 0 ? <Count n={view.counts.scripts} of={view.counts.scriptsTotal} /> : undefined}>
          {view.scriptsFrom === 'server' && <p className="pm-note">{t('label.perms.scriptsFromServer')}</p>}
          {view.scripts.length === 0 && <p className="pm-note">{t('label.perms.noScripts')}</p>}
          {view.scripts.length > 0 && view.counts.scripts === 0 && <p className="pm-note">{t('label.perms.noScriptsHeld')}</p>}
          {view.scriptsUnknown.length > 0 && <p className="pm-note">{t('label.perms.scriptsUnknown', fmtNum(view.scriptsUnknown.length))}</p>}
        </Section>
      )}
      {scripts.map((g) => (
        <Section key={g.id} className="pm-group pm-script" title={g.label ? lt(g.label) : g.id} help="help.perms.script"
          actions={<Count n={g.rows.filter((r) => r.mine).length} of={g.rows.length} />}>
          <DataTable label={g.label ? lt(g.label) : g.id} columns={columns} rows={g.shown} rowKey={(r) => r.id} rowClass={lockClass} />
        </Section>
      ))}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

/** "held / all", left to right in both languages as the website's roles page draws it */
function Count({ n, of }: { n: number; of: number }) {
  const { t } = useI18n();
  return <Tag><bdi dir="ltr">{t('label.perms.groupCount', fmtNum(n), fmtNum(of))}</bdi></Tag>;
}

function You({ mine }: { mine: boolean }) {
  const { t } = useI18n();
  if (mine) {
    return (
      <span className="pm-you is-yes">
        <i className="k-shape-sq" aria-hidden="true" />
        <span>{t('label.perms.allowed')}</span>
      </span>
    );
  }
  return (
    <span className="pm-you is-no">
      <Glyph name="lock" />
      <span>{t('label.perms.locked')}</span>
    </span>
  );
}

function YouCard({ view }: { view: PermsView }) {
  const { t } = useI18n();
  const { role, counts } = view;
  const line = role === 'owner' ? 'owner' : role === 'custom' ? 'custom' : 'base';
  return (
    <div className="pm-you-card">
      <div className="pm-you-head">
        <span className="pm-cap">{t('label.perms.you')}</span>
        <HelpTip help="help.perms.you" label={t('label.perms.you')} size="sm" />
      </div>
      <div className="pm-you-level">{role ? t(`label.perms.role.${role}`) : t('label.perms.unknownRole')}</div>
      <div className="pm-you-count">{t(`label.perms.roleLine.${line}`)}</div>
      <div className="pm-you-count">{t('label.perms.webCount', fmtNum(counts.web), fmtNum(counts.webTotal))}</div>
      <div className="pm-you-bar" aria-hidden="true"><span style={{ width: `${counts.webTotal ? Math.round((counts.web / counts.webTotal) * 100) : 0}%` }} /></div>
      {counts.scriptsTotal > 0 && <div className="pm-you-count">{t('label.perms.scriptCount', fmtNum(counts.scripts), fmtNum(counts.scriptsTotal))}</div>}
    </div>
  );
}

function RolesCard({ view }: { view: PermsView }) {
  const { t } = useI18n();
  return (
    <div className="pm-roles">
      <div className="pm-you-head">
        <span className="pm-cap">{t('label.perms.roles')}</span>
        <HelpTip help="help.perms.roles" label={t('label.perms.roles')} size="sm" />
      </div>
      {view.roles.length === 0
        ? <p className="pm-roles-none">{t('label.perms.noRoles')}</p>
        : (
          <ul className="pm-role-list">
            {view.roles.map((r) => (
              <li key={r.name} className="pm-role">
                <bdi className="pm-role-name">{r.name}</bdi>
                {r.discord && <Tag tone="faint">{t('label.perms.viaDiscord')}</Tag>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
