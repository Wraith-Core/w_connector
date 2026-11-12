/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/players/columns.tsx
 * The player table's columns. Essential: citizen id (+ #session), name, job, status, hunger, thirst,
 * ping, distance. Detailed adds gang, health, stamina, cash, gold and the staff level.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { TFn } from '../../i18n';
import { Meter, StatusChip, Tag, fmtCash, fmtDist, fmtNum, placeFar } from '../../kit';
import type { Column } from '../../kit';
import type { AdminPlayer } from '../../types';
import { displayName, groupLabel, healthPct, isStaff, rankOf, staminaOf, statusOf } from './shared';

export interface PlayerRow {
  p: AdminPlayer;
  /** metres from the admin (null = unknown, the admin's own row = 0) */
  dist: number | null;
  /** the town / district the player is in, in words; the column adds «· 1.2 كم منك» (hidden while the file is open) */
  place?: string;
  isMe: boolean;
}

/** '9' before '12'; old ids (letters) after every number */
export const cidSortKey = (cid: string | undefined): string => {
  const c = (cid ?? '').toUpperCase();
  return /^\d+$/.test(c) ? `0${c.padStart(12, '0')}` : `1${c}`;
};

const cmp = <T,>(f: (r: PlayerRow) => T) => (a: PlayerRow, b: PlayerRow) => {
  const x = f(a); const y = f(b);
  if (x === y) return a.p.id - b.p.id;
  return x < y ? -1 : 1;
};

const needOrNone = (v: number | undefined | null) => (typeof v === 'number' ? v : -1);

export function playerColumns(t: TFn, mode: 'essential' | 'detail'): Column<PlayerRow>[] {
  const detail = mode === 'detail';
  return [
    {
      key: 'cid', label: t('label.players.col.citizenId'), help: 'help.players.col.citizenId', sort: cmp((r) => cidSortKey(r.p.citizenid)),
      className: 'pl-col-cid',
      render: ({ p }) => (
        <span className="pl-cid">
          <b className="k-num">{p.citizenid || '—'}</b>
          <span className="pl-sid k-num">#{p.id}</span>
        </span>
      ),
    },
    {
      key: 'name', label: t('label.players.col.name'), help: 'help.players.col.name', sort: cmp((r) => displayName(r.p).toLowerCase()),
      className: 'pl-col-name',
      render: ({ p, isMe }) => (
        <span className="pl-name">
          <span className="k-cell-main pl-name-main">
            <span className="pl-name-text" dir="auto">{displayName(p)}</span>
            {isMe && <Tag tone="strong" className="pl-tag">{t('label.players.you')}</Tag>}
            {!detail && isStaff(p) && <Tag className="pl-tag">{p.group}</Tag>}
          </span>
          <span className="k-cell-sub pl-name-sub"><bdi>{p.name}</bdi></span>
        </span>
      ),
    },
    {
      key: 'job', label: t('label.players.col.job'), help: 'help.players.col.job', sort: cmp((r) => `${r.p.job?.label ?? ''} ${r.p.job?.grade ?? 0}`.toLowerCase()),
      className: 'pl-col-job',
      render: ({ p }) => (
        <span className="pl-job">
          <span className="k-cell-main pl-job-text">{p.job?.label || '—'}</span>
          <span className="k-cell-sub k-ellipsis">
            {p.job?.gradeName || ''}
            {p.job?.onDuty && <>{p.job?.gradeName ? ' · ' : ''}{t('label.players.onDuty')}</>}
          </span>
        </span>
      ),
    },
    {
      key: 'gang', label: t('label.players.col.gang'), help: 'help.players.col.gang', priority: 'detail',
      sort: cmp((r) => (r.p.gang?.name && r.p.gang.name !== 'none' ? r.p.gang.label : '~').toLowerCase()),
      render: ({ p }) => (p.gang?.name && p.gang.name !== 'none'
        ? <span className="pl-job"><span className="k-cell-main k-ellipsis">{p.gang.label}</span><span className="k-cell-sub k-ellipsis">{p.gang.gradeName}</span></span>
        : <span className="k-faint">—</span>),
    },
    {
      key: 'status', label: t('label.players.col.status'), help: 'help.players.col.status',
      sort: cmp((r) => ['dead', 'low', 'frozen', 'ok'].indexOf(statusOf(r.p))),
      render: ({ p }) => {
        const s = statusOf(p);
        return (
          <span className="pl-status">
            <StatusChip status={s} />
            {p.frozen && s !== 'frozen' && <StatusChip status="frozen" />}
          </span>
        );
      },
    },
    {
      key: 'health', label: t('label.players.col.health'), help: 'help.players.col.health', num: true, priority: 'detail',
      sort: cmp((r) => healthPct(r.p) ?? -1),
      render: ({ p }) => <Meter value={healthPct(p)} label={t('label.players.col.health')} />,
    },
    {
      key: 'hunger', label: t('label.players.col.hunger'), help: 'help.players.col.hunger', num: true,
      sort: cmp((r) => needOrNone(r.p.needs?.hunger)),
      render: ({ p }) => <Meter value={p.needs?.hunger} label={t('label.players.col.hunger')} />,
    },
    {
      key: 'thirst', label: t('label.players.col.thirst'), help: 'help.players.col.thirst', num: true,
      sort: cmp((r) => needOrNone(r.p.needs?.thirst)),
      render: ({ p }) => <Meter value={p.needs?.thirst} label={t('label.players.col.thirst')} />,
    },
    {
      key: 'stamina', label: t('label.players.col.stamina'), help: 'help.players.col.stamina', num: true, priority: 'detail',
      sort: cmp((r) => staminaOf(r.p) ?? -1),
      render: ({ p }) => <Meter value={staminaOf(p)} label={t('label.players.col.stamina')} />,
    },
    {
      key: 'cash', label: t('label.players.col.cash'), help: 'help.players.col.cash', num: true, priority: 'detail',
      sort: cmp((r) => r.p.money?.cash ?? 0),
      render: ({ p }) => <span className="k-num">{fmtCash(p.money?.cash ?? 0)}</span>,
    },
    {
      key: 'gold', label: t('label.players.col.gold'), help: 'help.players.col.gold', num: true, priority: 'detail',
      sort: cmp((r) => r.p.money?.gold ?? 0),
      render: ({ p }) => <span className="k-num">{fmtNum(p.money?.gold ?? 0, 2)}</span>,
    },
    {
      key: 'ping', label: t('label.players.col.ping'), help: 'help.players.col.ping', num: true, className: 'pl-col-ping',
      sort: cmp((r) => r.p.ping ?? 0),
      render: ({ p }) => <span className={(p.ping ?? 0) > 150 ? 'k-num pl-ping-bad' : 'k-num'}>{fmtNum(p.ping ?? 0)}</span>,
    },
    {
      key: 'dist', label: t('label.players.col.distance'), help: 'help.players.col.distance', className: 'pl-col-dist',
      sort: cmp((r) => (r.isMe ? -1 : r.dist ?? Number.MAX_SAFE_INTEGER)),
      render: ({ dist, isMe, place }) => (isMe ? <span className="k-faint">{t('label.place.here')}</span>
        : place ? <span className="pl-place">{place}{dist !== null && dist !== undefined && <span className="pl-place-far">{t('label.place.sep')}{placeFar(t, dist)}</span>}</span>
          : <span className="k-num">{fmtDist(dist)}</span>),
    },
    {
      key: 'group', label: t('label.players.col.group'), help: 'help.players.col.group', priority: 'detail',
      sort: cmp((r) => rankOf(r.p.group)),
      render: ({ p }) => (isStaff(p) ? <Tag>{groupLabel(t, p.group)}</Tag> : <span className="k-faint">{groupLabel(t, p.group)}</span>),
    },
  ];
}
