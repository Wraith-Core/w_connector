/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/players/PlayerList.tsx
 * The toolbar (search · filter chips · count · essential/detailed columns) and the table.
 * The search understands the citizen id first: '12' finds citizen 12 exactly, '#5' the session
 * number 5, anything else matches names, ids, jobs and gangs. A citizen id that is not online
 * offers its offline path: the Characters page.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { pluralForm, useI18n } from '../../i18n';
import { Button, DataTable, EmptyState, FilterChips, Segmented, TextInput, distance, parseCitizen } from '../../kit';
import type { ChipItem } from '../../kit';
import type { AdminPlayer } from '../../types';
import { playerColumns } from './columns';
import type { PlayerRow } from './columns';
import { fullName, isStaff, needsHelp } from './shared';

type Filter = 'all' | 'needHelp' | 'staff' | 'frozen';

const FILTERS: Record<Filter, (p: AdminPlayer) => boolean> = {
  all: () => true,
  needHelp: needsHelp,
  staff: isStaff,
  frozen: (p) => p.frozen === true,
};

const norm = (s: string) => s.toLocaleLowerCase().replace(/[ً-ٰٟ]/g, '');

export default function PlayerList({ selectedId, onSelect }: { selectedId: number | null; onSelect(p: AdminPlayer): void }) {
  const app = useApp();
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const mode = app.prefs.tableMode === 'detail' ? 'detail' : 'essential';

  const me = app.players.find((p) => p.id === app.selfId)?.coords ?? app.self?.coords ?? null;
  const all = useMemo<PlayerRow[]>(() => app.players.map((p) => {
    const isMe = p.id === app.selfId;
    return { p, isMe, dist: isMe ? 0 : distance(me, p.coords) };
  }), [app.players, app.selfId, me]);

  const parsed = useMemo(() => parseCitizen(q), [q]);
  const searched = useMemo<PlayerRow[]>(() => {
    const s = norm(q.trim());
    if (!s) return all;
    if (parsed?.kind === 'server') return all.filter((r) => r.p.id === parsed.id);
    if (parsed?.kind === 'self') return all.filter((r) => r.isMe);
    if (parsed?.kind === 'citizen') {
      const exact = all.filter((r) => (r.p.citizenid || '').toUpperCase() === parsed.id);
      if (exact.length) return exact;
    }
    return all.filter((r) => norm(`${r.p.name} ${fullName(r.p)} ${r.p.citizenid} ${r.p.job?.label ?? ''} ${r.p.gang?.label ?? ''} ${r.p.group ?? ''}`).includes(s));
  }, [all, q, parsed]);

  const rows = useMemo(() => searched.filter((r) => FILTERS[filter](r.p)), [searched, filter]);
  const count = (f: Filter) => searched.reduce((n, r) => n + (FILTERS[f](r.p) ? 1 : 0), 0);

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.players.filter.all'), count: count('all'), help: 'help.players.filter.all' },
    { id: 'needHelp', label: t('label.players.filter.needHelp'), count: count('needHelp'), help: 'help.players.filter.needHelp' },
    { id: 'staff', label: t('label.players.filter.staff'), count: count('staff'), help: 'help.players.filter.staff' },
    { id: 'frozen', label: t('label.players.filter.frozen'), count: count('frozen'), help: 'help.players.filter.frozen' },
  ];

  const columns = useMemo(() => playerColumns(t, mode), [t, mode]);
  const clear = () => { setQ(''); setFilter('all'); };

  /* a typed citizen id that nobody online holds: offer the Characters page */
  const offlineCid = parsed?.kind === 'citizen' && rows.length === 0 && !all.some((r) => (r.p.citizenid || '').toUpperCase() === parsed.id) ? parsed.id : null;

  let empty;
  if (app.players.length === 0) {
    empty = <EmptyState text={t('label.players.emptyNone')} />;
  } else if (offlineCid) {
    empty = (
      <EmptyState
        text={t('label.players.emptyOffline', offlineCid)}
        next={<>
          <Button help="help.players.openCharacter" kind="primary" area="characters" onClick={() => app.navigate('characters', { cid: offlineCid })}>
            {t('label.players.openCharacter', offlineCid)}
          </Button>
          <Button help="help.players.clearFilter" kind="ghost" onClick={clear}>{t('label.players.clearFilter')}</Button>
        </>}
      />
    );
  } else {
    empty = <EmptyState text={t('label.players.emptyFilter')} next={<Button help="help.players.clearFilter" onClick={clear}>{t('label.players.clearFilter')}</Button>} />;
  }

  const n = rows.length;
  const countText = t(`label.players.count.${pluralForm(n, lang)}`, n);

  return (
    <div className="pl-list">
      <div className="pl-toolbar">
        <TextInput
          className="pl-search"
          value={q}
          onChange={setQ}
          icon="search"
          clearable
          placeholder={t('label.players.search')}
          label={t('label.players.search')}
          help="help.players.search"
          onEnter={() => { if (rows.length === 1) onSelect(rows[0].p); }}
        />
        <FilterChips<Filter> items={chips} value={filter} onChange={setFilter} label={t('label.players.filterLabel')} className="pl-chips" />
        <span className="pl-toolbar-end">
          <span className="pl-count k-num" aria-live="polite">{countText}</span>
          <Segmented<'essential' | 'detail'>
            className="pl-mode"
            value={mode}
            onChange={(v) => app.setPrefs({ tableMode: v })}
            options={[
              { value: 'essential', label: t('label.common.essential'), help: 'help.players.modeEssential' },
              { value: 'detail', label: t('label.common.detail'), help: 'help.players.modeDetail' },
            ]}
            size="sm"
            label={t('label.players.columns')}
            help="help.players.columns"
          />
        </span>
      </div>
      <DataTable<PlayerRow>
        className={mode === 'essential' ? 'pl-table pl-table-essential' : 'pl-table'}
        label={t('label.players.table')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.p.id}
        selectedKey={selectedId}
        onSelect={(r) => onSelect(r.p)}
        mode={mode}
        density={app.prefs.density}
        defaultSort={{ key: 'cid', dir: 'asc' }}
        loading={!app.playersSeen}
        empty={empty}
        rowClass={(r) => (r.isMe ? 'pl-row-me' : r.p.dead ? 'pl-row-dead' : undefined)}
      />
    </div>
  );
}
