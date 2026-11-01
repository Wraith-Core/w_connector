/* ════════════════════════════════════════════════════════════════════════════
 * Players: the searchable, sortable table (sticky header) and, beside it, the selected player's panel.
 * ↑ ↓ move the selection while the table has the focus, Enter opens the panel, the header cells sort.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Empty, Input, Loading, Meter, Tag } from '../ui/controls';
import Glyph from '../ui/Glyph';
import { cls, distance, fmtDist, fmtNum } from '../ui/util';
import type { AdminPlayer } from '../types';
import PlayerPanel from './PlayerPanel';

type SortKey = 'id' | 'cid' | 'name' | 'job' | 'gang' | 'cash' | 'gold' | 'ping' | 'health' | 'stamina' | 'hunger' | 'thirst' | 'dist';

interface Row { p: AdminPlayer; dist: number | null }

const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'id', label: 'ui_col_id', num: true },
  // staff name players by citizen id (commands, forms): it sits beside the server id
  { key: 'cid', label: 'ui_citizenid', num: true },
  { key: 'name', label: 'ui_col_name' },
  { key: 'job', label: 'ui_col_job' },
  { key: 'gang', label: 'ui_col_gang' },
  { key: 'cash', label: 'ui_col_cash', num: true },
  { key: 'gold', label: 'ui_col_gold', num: true },
  { key: 'ping', label: 'ui_col_ping', num: true },
  { key: 'health', label: 'ui_col_health', num: true },
  { key: 'stamina', label: 'ui_col_stamina', num: true },
  { key: 'hunger', label: 'ui_col_hunger', num: true },
  { key: 'thirst', label: 'ui_col_thirst', num: true },
  { key: 'dist', label: 'ui_col_dist', num: true },
];

const val = (r: Row, k: SortKey): number | string => {
  const p = r.p;
  switch (k) {
    case 'id': return p.id;
    // digits padded so '9' sorts before '12'; an old id (letters) sorts after every number
    case 'cid': { const c = p.citizenid || ''; return /^\d+$/.test(c) ? c.padStart(12, '0') : c.toLowerCase(); }
    case 'name': return (p.name || '').toLowerCase();
    case 'job': return `${p.job?.label ?? ''} ${p.job?.grade ?? 0}`.toLowerCase();
    case 'gang': return (p.gang?.label ?? '').toLowerCase();
    case 'cash': return p.money?.cash ?? 0;
    case 'gold': return p.money?.gold ?? 0;
    case 'ping': return p.ping ?? 0;
    case 'health': return p.maxHealth ? (p.health / p.maxHealth) : 0;
    case 'stamina': return p.stamina ?? p.needs?.stamina ?? -1;
    case 'hunger': return p.needs?.hunger ?? -1;
    case 'thirst': return p.needs?.thirst ?? -1;
    case 'dist': return r.dist ?? Number.POSITIVE_INFINITY;
    default: return 0;
  }
};

export default function Players() {
  const t = useT();
  const { players, playersSeen, selfId, selectedId, select, self } = useApp();
  const [q, setQ] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const tableRef = useRef<HTMLDivElement>(null);

  const me = players.find((p) => p.id === selfId)?.coords ?? self?.coords;

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const list = players
      .filter((p) => {
        if (!needle) return true;
        return (
          String(p.id) === needle || `#${p.id}` === needle ||
          (p.name || '').toLowerCase().includes(needle) ||
          (p.citizenid || '').toLowerCase().includes(needle) ||
          `${p.firstname ?? ''} ${p.lastname ?? ''}`.toLowerCase().includes(needle) ||
          (p.job?.label ?? '').toLowerCase().includes(needle) ||
          (p.gang?.label ?? '').toLowerCase().includes(needle) ||
          (p.group ?? '').toLowerCase().includes(needle)
        );
      })
      .map((p) => ({ p, dist: p.id === selfId ? 0 : distance(me, p.coords) }));
    list.sort((a, b) => {
      const x = val(a, sortKey);
      const y = val(b, sortKey);
      if (x < y) return -sortDir;
      if (x > y) return sortDir;
      return a.p.id - b.p.id;
    });
    return list;
  }, [players, q, sortKey, sortDir, me, selfId]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === 'name' || k === 'job' || k === 'gang' || k === 'id' || k === 'cid' || k === 'dist' || k === 'ping' ? 1 : -1); }
  };

  const moveSel = useCallback((delta: number) => {
    if (rows.length === 0) return;
    const i = rows.findIndex((r) => r.p.id === selectedId);
    const next = i < 0 ? (delta > 0 ? 0 : rows.length - 1) : (i + delta + rows.length) % rows.length;
    select(rows[next].p.id);
  }, [rows, selectedId, select]);

  /* Keep the selected row in view */
  useEffect(() => {
    if (selectedId === null) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': moveSel(1); break;
      case 'ArrowUp': moveSel(-1); break;
      case 'Home': if (rows[0]) select(rows[0].p.id); break;
      case 'End': if (rows.length) select(rows[rows.length - 1].p.id); break;
      case 'Enter': if (selectedId === null && rows[0]) select(rows[0].p.id); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const selected = selectedId !== null ? players.find((p) => p.id === selectedId) ?? null : null;

  return (
    <div className={cls('wa-players', selected && 'has-panel')}>
      <div className="wa-players-list">
        <div className="wa-toolbar"><button type="button" className="wa-subtab" aria-pressed={detailed} onClick={() => setDetailed(!detailed)}>{t(detailed ? 'ui_compact_view' : 'ui_detailed_view')}</button>
          <Input glyph="search" value={q} onChange={setQ} placeholder={t('ui_search')} className="wa-toolbar-search" />
          <span className="wa-toolbar-count">{t('ui_players_count', rows.length)}</span>
        </div>

        {!playersSeen ? (
          <Loading text={t('ui_players_waiting')} />
        ) : rows.length === 0 ? (
          <Empty text={q ? t('ui_players_none') : t('ui_empty')} glyph="players" />
        ) : (
          <div ref={tableRef} className="wa-table-wrap" tabIndex={0} onKeyDown={onKey} role="grid">
            <table className={cls('wa-table', !detailed && 'wa-table--compact')}>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={cls(c.num && 'is-num', sortKey === c.key && 'is-sorted')} onClick={() => sortBy(c.key)}>
                      <span>{t(c.label)}</span>
                      {sortKey === c.key && <Glyph name={sortDir === 1 ? 'sortUp' : 'sortDown'} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, dist }) => {
                  const isMe = p.id === selfId;
                  return (
                    <tr
                      key={p.id}
                      data-id={p.id}
                      className={cls(selectedId === p.id && 'is-selected', p.dead && 'is-dead', isMe && 'is-me')}
                      onClick={() => select(p.id)}
                      onDoubleClick={() => select(p.id)}
                    >
                      <td className="is-num"><b dir="ltr">#{p.id}</b></td>
                      <td className="is-num"><b dir="ltr">{p.citizenid || '—'}</b></td>
                      <td className="wa-td-name">
                        {p.dead && <Glyph name="skull" className="wa-td-skull" />}
                        <span className="wa-td-name-main">{p.name || '—'}</span>
                        <span className="wa-td-name-sub">
                          {`${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.citizenid}
                          {isMe && <Tag tone="dim">{t('ui_you')}</Tag>}
                          {p.group && p.group !== 'user' && <Tag tone="ok">{p.group}</Tag>}
                        </span>
                      </td>
                      <td>
                        <span className={cls('wa-duty', p.job?.onDuty && 'is-on')} title={p.job?.onDuty ? t('ui_duty') : t('ui_offduty')} />
                        {p.job?.label ?? '—'}
                        {p.job?.gradeName && <span className="wa-td-sub"> · {p.job.gradeName}</span>}
                      </td>
                      <td>{p.gang?.label && p.gang.name !== 'none' ? p.gang.label : <span className="wa-dim">—</span>}</td>
                      <td className="is-num"><span className="wa-money" dir="ltr">$<b>{fmtNum(p.money?.cash ?? 0)}</b></span></td>
                      <td className="is-num"><span className="wa-money wa-money--gold" dir="ltr"><b>{fmtNum(p.money?.gold ?? 0, 2)}</b></span></td>
                      <td className={cls('is-num', (p.ping ?? 0) > 150 && 'is-bad')}><b dir="ltr">{p.ping ?? 0}</b></td>
                      <td className="is-num"><Meter value={p.health} max={p.maxHealth || 100} tone="health" /></td>
                      <td className="is-num">{(p.stamina !== undefined || p.needs?.stamina !== undefined) ? <Meter value={p.stamina ?? p.needs?.stamina ?? 100} tone="stamina" /> : <span className="wa-dim">—</span>}</td>
                      <td className="is-num">{p.needs ? <Meter value={p.needs.hunger} tone="hunger" /> : <span className="wa-dim">—</span>}</td>
                      <td className="is-num">{p.needs ? <Meter value={p.needs.thirst} tone="thirst" /> : <span className="wa-dim">—</span>}</td>
                      <td className="is-num"><b dir="ltr">{isMe ? '—' : fmtDist(dist)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <PlayerPanel player={selected} onClose={() => select(null)} />
      ) : (
        playersSeen && rows.length > 0 && (
          <div className="wa-panel wa-panel--hint">
            <Empty text={t('ui_players_select')} glyph="arrow" />
          </div>
        )
      )}
    </div>
  );
}
