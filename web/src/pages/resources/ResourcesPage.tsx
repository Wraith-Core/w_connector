/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/resources/ResourcesPage.tsx
 * Every script on the server (serverInfo.resources), grouped:
 *   Wraith scripts (w_*)  stop / restart through TypeToConfirm (type the script name)
 *   Other scripts         stop / restart through a danger ConfirmDialog
 *   Protected             Config.ProtectedResources (sent as protectedResources): no buttons (B4)
 * Row buttons are ghost; red only inside the confirm dialog. Start needs no confirm.
 *   post('server', { action: 'startResource' | 'stopResource' | 'restartResource', args: { name } })
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, EmptyState, FilterChips, Glyph, PageActions, Section, StatTile, StatusChip, Tag, TextInput, Toolbar, fmtNum,
} from '../../kit';
import type { ChipItem, Column } from '../../kit';
import type { ResourceInfo } from '../../types';

type Filter = 'all' | 'running' | 'stopped' | 'protected';
type Group = 'ours' | 'others' | 'protected';
type Verb = 'startResource' | 'stopResource' | 'restartResource';

/* Used only until the server sends protectedResources (L1): the keys of Config.ProtectedResources */
const FALLBACK_PROTECTED = [
  'w_admin', 'w_lib', 'w_core', 'oxmysql', 'monitor', 'txAdmin', 'hardcap', 'rdr3_universal',
  'sessionmanager', 'sessionmanager-rdr3', 'webpack', 'yarn',
];

const isOurs = (name: string) => /^w_/i.test(name);
const isRunning = (r: ResourceInfo) => r.state === 'started';
const isBusyState = (r: ResourceInfo) => r.state === 'starting' || r.state === 'stopping';

export default function ResourcesPage() {
  const app = useApp();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<Record<string, Verb>>({});

  const list = app.serverInfo?.resources ?? null;
  const prot = useMemo(
    () => new Set((app.protectedResources.length ? app.protectedResources : FALLBACK_PROTECTED).map((n) => n.toLowerCase())),
    [app.protectedResources],
  );
  const isProtected = (name: string) => prot.has(name.toLowerCase());
  const groupOf = (r: ResourceInfo): Group => (isProtected(r.name) ? 'protected' : isOurs(r.name) ? 'ours' : 'others');

  const stats = useMemo(() => {
    const s = { total: 0, running: 0, stopped: 0, protected: 0 };
    for (const r of list ?? []) {
      s.total += 1;
      if (isRunning(r)) s.running += 1; else s.stopped += 1;
      if (prot.has(r.name.toLowerCase())) s.protected += 1;
    }
    return s;
  }, [list, prot]);

  const stateText = (s: string) => {
    const k = `label.resources.state.${s}`;
    const v = t(k);
    return v === k ? s : v;
  };

  const visible = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === 'running' && !isRunning(r)) return false;
      if (filter === 'stopped' && isRunning(r)) return false;
      if (filter === 'protected' && !prot.has(r.name.toLowerCase())) return false;
      if (!needle) return true;
      return [r.name, r.state, stateText(r.state), r.description ?? '', r.version ?? ''].some((v) => v.toLowerCase().includes(needle));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, filter, prot, t]);

  const run = async (name: string, verb: Verb) => {
    setBusy((b) => ({ ...b, [name]: verb }));
    try {
      const r = await app.act('server', { action: verb, args: { name } });
      if (r.ok) window.setTimeout(() => app.refresh('server'), 800);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[name]; return n; });
    }
  };

  const ask = (name: string, verb: 'stopResource' | 'restartResource') => {
    const core = isOurs(name);
    const stop = verb === 'stopResource';
    app.confirm({
      title: t(stop ? 'label.resources.stopTitle' : 'label.resources.restartTitle', name),
      help: core ? 'help.resources.confirmCore' : stop ? 'help.resources.stop' : 'help.resources.restart',
      text: (
        <>
          <p>{t(stop ? 'label.resources.stopText' : 'label.resources.restartText', name)}</p>
          {core && <p className="rs-core-note">{t('label.resources.coreNote')}</p>}
        </>
      ),
      danger: true,
      phrase: core ? name : undefined,
      /* a stopped script starts again with Start: the "cannot be undone" band would be wrong here */
      undoable: true,
      confirmLabel: t(stop ? 'label.resources.stop' : 'label.resources.restart'),
      onConfirm: () => run(name, verb),
    });
  };

  const nameCol: Column<ResourceInfo> = {
    key: 'name', label: t('label.resources.col.name'), help: 'help.resources.col.name', sort: true, value: (r) => r.name,
    className: 'rs-namecol',
    render: (r) => (
      <>
        <span className="k-cell-main rs-name">{r.name}</span>
        {r.description ? <span className="k-cell-sub rs-desc">{r.description}</span> : null}
      </>
    ),
  };
  const versionCol: Column<ResourceInfo> = {
    key: 'version', label: t('label.resources.col.version'), help: 'help.resources.col.version', width: '7rem',
    render: (r) => (r.version ? <span className="k-num k-dim">{r.version}</span> : <span className="k-faint">—</span>),
  };
  const stateCol: Column<ResourceInfo> = {
    key: 'state', label: t('label.resources.col.state'), help: 'help.resources.col.state', sort: true, value: (r) => (isRunning(r) ? 0 : 1),
    width: '9rem',
    render: (r) => {
      if (isRunning(r)) return <StatusChip status="running" label={stateText(r.state)} />;
      if (r.state === 'stopped') return <StatusChip status="stopped" label={stateText(r.state)} />;
      return <StatusChip status={isBusyState(r) ? 'low' : 'offline'} label={stateText(r.state)} />;
    },
  };
  const actionsCol: Column<ResourceInfo> = {
    key: 'actions', label: t('label.resources.col.actions'), help: 'help.resources.col.actions', className: 'rs-actions',
    render: (r) => {
      const b = busy[r.name];
      const moving = isBusyState(r) || !!b;
      if (!isRunning(r)) {
        return (
          <span className="rs-btns">
            <Button
              help="help.resources.start"
              helpQuiet
              kind="ghost"
              size="sm"
              area="resources"
              busy={b === 'startResource'}
              disabled={moving || r.state === 'missing'}
              onClick={() => void run(r.name, 'startResource')}
            >
              {t('label.resources.start')}
            </Button>
          </span>
        );
      }
      return (
        <span className="rs-btns">
          <Button help="help.resources.restart" helpQuiet kind="ghost" size="sm" area="resources" busy={b === 'restartResource'} disabled={moving} onClick={() => ask(r.name, 'restartResource')}>
            {t('label.resources.restart')}
          </Button>
          <Button help="help.resources.stop" helpQuiet kind="ghost" size="sm" area="resources" busy={b === 'stopResource'} disabled={moving} onClick={() => ask(r.name, 'stopResource')}>
            {t('label.resources.stop')}
          </Button>
        </span>
      );
    },
  };
  const lockCol: Column<ResourceInfo> = {
    key: 'lock', label: t('label.resources.col.actions'), help: 'help.resources.protected', className: 'rs-actions',
    render: () => (
      <span className="rs-lock">
        <Glyph name="lock" />
        <span>{t('label.resources.protectedNote')}</span>
      </span>
    ),
  };

  const groups: { id: Group; rows: ResourceInfo[]; columns: Column<ResourceInfo>[] }[] = (['ours', 'others', 'protected'] as Group[]).map((g) => ({
    id: g,
    rows: visible.filter((r) => groupOf(r) === g),
    columns: g === 'protected' ? [nameCol, versionCol, stateCol, lockCol] : [nameCol, versionCol, stateCol, actionsCol],
  }));

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.resources.filter.all'), count: stats.total, help: 'help.resources.filter.all' },
    { id: 'running', label: t('label.resources.filter.running'), count: stats.running, help: 'help.resources.filter.running' },
    { id: 'stopped', label: t('label.resources.filter.stopped'), count: stats.stopped, help: 'help.resources.filter.stopped' },
    { id: 'protected', label: t('label.resources.filter.protected'), count: stats.protected, help: 'help.resources.filter.protected' },
  ];

  return (
    <div className="rs-page">
      <PageActions>
        <Button help="help.common.refresh" icon="refresh" kind="ghost" onClick={() => app.refresh('server')}>{t('label.resources.refresh')}</Button>
      </PageActions>

      <div className="rs-stats">
        <StatTile
          label={t('label.resources.stat.running')}
          help="help.resources.stat.running"
          value={list ? fmtNum(stats.running) : '—'}
          sub={list ? t('label.resources.stat.ofTotal', fmtNum(stats.total)) : undefined}
          onClick={() => setFilter('running')}
        />
        <StatTile
          label={t('label.resources.stat.stopped')}
          help="help.resources.stat.stopped"
          value={list ? fmtNum(stats.stopped) : '—'}
          onClick={() => setFilter('stopped')}
        />
        <StatTile
          label={t('label.resources.stat.protected')}
          help="help.resources.stat.protected"
          value={list ? fmtNum(stats.protected) : '—'}
          onClick={() => setFilter('protected')}
        />
      </div>

      <Toolbar className="rs-toolbar">
        <TextInput
          value={q}
          onChange={setQ}
          icon="search"
          clearable
          placeholder={t('label.resources.search')}
          label={t('label.resources.search')}
          help="help.resources.search"
          className="rs-search"
        />
        <FilterChips label={t('label.resources.filters')} value={filter} onChange={setFilter} items={chips} />
        {list && <span className="rs-count k-push">{t('label.resources.showing', visible.length, list.length)}</span>}
      </Toolbar>

      {list === null && (
        <DataTable label={t('label.resources.listLabel')} columns={[nameCol, versionCol, stateCol, actionsCol]} rows={[]} rowKey={(r) => r.name} loading />
      )}

      {list !== null && visible.length === 0 && (
        <EmptyState
          text={t('label.resources.none')}
          next={<Button help="help.common.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.resources.clear')}</Button>}
        />
      )}

      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <Section
          key={g.id}
          className="rs-group"
          title={t(`label.resources.group.${g.id}`)}
          help={g.id === 'ours' ? 'help.resources.group.ours' : g.id === 'others' ? 'help.resources.group.others' : 'help.resources.group.protected'}
          lead={t(`label.resources.lead.${g.id}`)}
          area="resources"
          actions={<Tag tone="faint">{fmtNum(g.rows.length)}</Tag>}
        >
          <DataTable
            label={t(`label.resources.group.${g.id}`)}
            columns={g.columns}
            rows={g.rows}
            rowKey={(r) => r.name}
            defaultSort={{ key: 'name', dir: 'asc' }}
            rowClass={(r) => (isRunning(r) ? undefined : 'rs-row-off')}
          />
        </Section>
      ))}
    </div>
  );
}
