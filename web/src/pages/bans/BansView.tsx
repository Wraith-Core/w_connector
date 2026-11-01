/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/bans/BansView.tsx
 * The ban list (the 'bans' push): filter chips (in force / permanent / temporary / ended / all),
 * search, a drawer with the full reason and the license, and unban through a ConfirmDialog.
 * B2: a permanent ban (expire 0 or 2147483647) reads "Permanent", never a 2038 date.
 * The "created" column of the old tab is gone: the server stores no creation date.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, Drawer, EmptyState, FilterChips, KeyValue, KeyValueList, Section, SplitView, Tag, TextInput, Toolbar,
  fmtAgo, fmtDate, fmtDuration,
} from '../../kit';
import type { ChipItem, Column } from '../../kit';
import type { BanEntry } from '../../types';
import { banState, nowSec, shortLicense, useNow } from './util';
import type { BanState } from './util';

type Filter = 'active' | BanState | 'all';

const endOrder = (b: BanEntry, now: number): number => {
  const s = banState(b, now);
  return s === 'permanent' ? Number.MAX_SAFE_INTEGER : b.expire;
};

export default function BansView() {
  const app = useApp();
  const { t, lang } = useI18n();
  const now = useNow();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [selId, setSelId] = useState<number | null>(null);
  const list = app.bans;

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, permanent: 0, temporary: 0, expired: 0, all: 0 };
    for (const b of list ?? []) {
      const s = banState(b, now);
      c[s] += 1;
      c.all += 1;
      if (s !== 'expired') c.active += 1;
    }
    return c;
  }, [list, now]);

  const rows = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    return list
      .filter((b) => {
        const s = banState(b, now);
        if (filter === 'active' && s === 'expired') return false;
        if (filter !== 'active' && filter !== 'all' && s !== filter) return false;
        if (!needle) return true;
        return [b.name, b.reason, b.license, b.bannedby, String(b.id)].some((v) => String(v ?? '').toLowerCase().includes(needle));
      })
      .sort((a, b) => b.id - a.id);
  }, [list, q, filter, now]);

  const nameOf = (b: BanEntry) => b.name || t('label.bans.unknownName');

  const askUnban = (b: BanEntry) => {
    const expired = banState(b, nowSec()) === 'expired';
    app.confirm({
      title: t('label.bans.unbanTitle', nameOf(b)),
      help: 'help.bans.unban',
      text: expired ? t('label.bans.unbanTextExpired') : t('label.bans.unbanText', nameOf(b)),
      confirmLabel: t('label.bans.unban'),
      onConfirm: async () => {
        const r = await app.act('bans', { action: 'unban', id: b.id });
        if (r.ok) {
          setSelId((cur) => (cur === b.id ? null : cur));
          app.refresh('bans');
          app.refresh('server');
        }
      },
    });
  };

  const ends = (b: BanEntry) => {
    const s = banState(b, now);
    if (s === 'permanent') return <Tag tone="strong">{t('label.bans.permanent')}</Tag>;
    if (s === 'expired') {
      return (
        <>
          <span className="k-cell-main bn-ended">{t('label.bans.ended')}</span>
          <span className="k-cell-sub k-num">{fmtDate(b.expire)}</span>
        </>
      );
    }
    return (
      <>
        <span className="k-cell-main">{t('label.bans.endsIn', fmtDuration(t, lang, b.expire - now, 2))}</span>
        <span className="k-cell-sub k-num">{fmtDate(b.expire)}</span>
      </>
    );
  };

  const columns: Column<BanEntry>[] = [
    {
      key: 'id', label: t('label.bans.col.id'), help: 'help.bans.col.id', num: true, sort: true, value: (b) => b.id, width: '4.5rem',
      render: (b) => <span className="k-num k-dim">{b.id}</span>,
    },
    {
      key: 'name', label: t('label.bans.col.name'), help: 'help.bans.col.name', sort: true, value: (b) => b.name ?? '',
      render: (b) => (
        <>
          <span className="k-cell-main">{nameOf(b)}</span>
          <span className="k-cell-sub bn-lic">{shortLicense(b.license)}</span>
        </>
      ),
    },
    {
      key: 'reason', label: t('label.bans.col.reason'), help: 'help.bans.col.reason', className: 'bn-wrap', priority: 'detail',
      render: (b) => (b.reason ? <span className="bn-clamp" dir="auto">{b.reason}</span> : <span className="k-faint">{t('label.bans.noReason')}</span>),
    },
    {
      key: 'by', label: t('label.bans.col.by'), help: 'help.bans.col.by', sort: true, value: (b) => b.bannedby ?? '', priority: 'detail',
      render: (b) => b.bannedby || '—',
    },
    {
      key: 'ends', label: t('label.bans.col.ends'), help: 'help.bans.col.ends', sort: (a, b) => endOrder(a, now) - endOrder(b, now),
      render: ends,
    },
    {
      key: 'actions', label: t('label.bans.col.actions'), help: 'help.bans.col.actions', className: 'bn-actions',
      render: (b) => (
        <Button help="help.bans.unban" helpQuiet kind="ghost" size="sm" area="bans" onClick={() => askUnban(b)}>{t('label.bans.unban')}</Button>
      ),
    },
  ];

  const chips: ChipItem<Filter>[] = [
    { id: 'active', label: t('label.bans.filter.active'), count: counts.active, help: 'help.bans.filter.active' },
    { id: 'permanent', label: t('label.bans.filter.permanent'), count: counts.permanent, help: 'help.bans.filter.permanent' },
    { id: 'temporary', label: t('label.bans.filter.temporary'), count: counts.temporary, help: 'help.bans.filter.temporary' },
    { id: 'expired', label: t('label.bans.filter.expired'), count: counts.expired, help: 'help.bans.filter.expired' },
    { id: 'all', label: t('label.bans.filter.all'), count: counts.all, help: 'help.bans.filter.all' },
  ];

  const selected = selId === null ? null : (list ?? []).find((b) => b.id === selId) ?? null;
  const filtered = !!q.trim() || filter !== 'all';

  const empty = list && list.length === 0
    ? (
      <EmptyState
        text={t('label.bans.none')}
        next={(
          <>
            <span className="k-faint">{t('label.bans.noneNext')}</span>
            <Button help="help.bans.openPlayers" size="sm" area="players" onClick={() => app.navigate('players')}>{t('label.bans.openPlayers')}</Button>
          </>
        )}
      />
    )
    : (
      <EmptyState
        text={t('label.bans.noMatch')}
        next={filtered && <Button help="help.common.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.bans.clear')}</Button>}
      />
    );

  return (
    <SplitView
      className="bn-split"
      list={(
        <>
          <Toolbar className="bn-toolbar">
            <TextInput
              value={q}
              onChange={setQ}
              icon="search"
              clearable
              placeholder={t('label.bans.searchBans')}
              label={t('label.bans.searchBans')}
              help="help.bans.search"
              className="bn-search"
            />
            <FilterChips label={t('label.bans.filters')} value={filter} onChange={setFilter} items={chips} />
            {list && <span className="bn-count k-push">{t('label.bans.showing', rows.length, list.length)}</span>}
          </Toolbar>
          <DataTable
            label={t('label.bans.listLabel')}
            columns={columns}
            rows={rows}
            rowKey={(b) => b.id}
            selectedKey={selId}
            onSelect={(b) => setSelId(b.id)}
            /* with the drawer open the reason and the staff member are in it */
            mode={selId !== null ? 'essential' : 'detail'}
            loading={list === null}
            empty={empty}
            rowClass={(b) => (banState(b, now) === 'expired' ? 'bn-row-dim' : undefined)}
          />
        </>
      )}
      drawer={selected && (
        <BanDrawer b={selected} now={now} onClose={() => setSelId(null)} onUnban={() => askUnban(selected)} />
      )}
    />
  );
}

function BanDrawer({ b, now, onClose, onUnban }: { b: BanEntry; now: number; onClose(): void; onUnban(): void }) {
  const app = useApp();
  const { t, lang } = useI18n();
  const s = banState(b, now);
  const state = s === 'temporary' ? 'active' : s;
  return (
    <Drawer
      title={b.name || t('label.bans.unknownName')}
      help="help.bans.drawer"
      sub={(
        <>
          <span>{t('label.bans.d.id')} <b className="k-num">{b.id}</b></span>
          {b.bannedby && <span>{t('label.bans.d.by')} <b>{b.bannedby}</b></span>}
        </>
      )}
      chips={<Tag tone={s === 'permanent' ? 'strong' : s === 'expired' ? 'faint' : 'plain'}>{t(`label.bans.state.${state}`)}</Tag>}
      onClose={onClose}
      footer={<Button help="help.bans.unban" kind="primary" area="bans" onClick={onUnban}>{t('label.bans.unban')}</Button>}
    >
      <KeyValueList>
        <KeyValue label={t('label.bans.d.license')} help="help.bans.license" value={b.license} copy={b.license || undefined} ltr />
        <KeyValue label={t('label.bans.d.by')} help="help.bans.col.by" value={b.bannedby} />
        <KeyValue
          label={t('label.bans.d.ends')}
          help="help.bans.col.ends"
          value={s === 'permanent' ? t('label.bans.permanent') : fmtDate(b.expire)}
          ltr={s !== 'permanent'}
        />
        {s === 'temporary' && (
          <KeyValue label={t('label.bans.d.remaining')} help="help.bans.remaining" value={fmtDuration(t, lang, b.expire - now, 3)} />
        )}
        {s === 'expired' && (
          <KeyValue label={t('label.bans.d.state')} help="help.bans.filter.expired" value={t('label.bans.endedAgo', fmtAgo(t, lang, b.expire, now))} />
        )}
      </KeyValueList>
      <Section title={t('label.bans.d.reason')} help="help.bans.col.reason" tone="plain">
        <p className="bn-reason-full" dir="auto">{b.reason || t('label.bans.noReason')}</p>
      </Section>
      {b.license && (
        <Button help="help.bans.findChars" kind="link" area="characters" onClick={() => app.navigate('characters', { q: b.license })}>
          {t('label.bans.d.findChars')}
        </Button>
      )}
    </Drawer>
  );
}
