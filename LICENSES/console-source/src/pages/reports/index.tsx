/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/reports  (2026-10-22, one admin system)
 * The players' reports: the SAME list the website works (w_connector wc_reports), read and worked from
 * the game -- claim, answer (the player reads it in chat when he is on), close, reopen. A /report a
 * player files lands here too. Server side: server/sv_reports.lua -> w_connector GameReports.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, Drawer, EmptyState, Field, FilterChips, KeyValue, KeyValueList, Section, SplitView, Tag, TextArea, TextInput,
  Toolbar, fmtDate,
} from '../../kit';
import type { ChipItem, Column } from '../../kit';
import { post } from '../../nui';
import { definePage } from '../../app/pages';
import type { PageProps } from '../../app/pages';

type Status = 'open' | 'claimed' | 'resolved';
type Filter = Status | 'all';

interface ReportMsg { sender_name?: string; sender_type?: string; message?: string; timestamp?: number | string }
interface Report {
  id: number;
  title?: string;
  description?: string;
  status: Status;
  reporter_username?: string;
  reported_player_username?: string;
  claimed_by?: string | null;
  created_at?: number | string;
  admin_notes?: string | null;
  messages?: ReportMsg[];
}
interface ListAnswer { reports?: Report[]; totalReports?: number }

/** oxmysql hands a TIMESTAMP back as epoch milliseconds; fmtDate takes seconds */
const secs = (v: number | string | undefined): number | string | undefined =>
  typeof v === 'number' && v > 1e12 ? Math.floor(v / 1000) : v;

function ReportsPage(_: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const [list, setList] = useState<Report[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await post<ListAnswer>('reports', { action: 'list', status: 'all' });
    if (r.ok && r.data && Array.isArray(r.data.reports)) setList(r.data.reports);
    else if (!r.ok) setList((cur) => cur ?? []);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(id);
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, claimed: 0, resolved: 0, all: 0 };
    for (const r of list ?? []) { c[r.status] = (c[r.status] ?? 0) + 1; c.all += 1; }
    return c;
  }, [list]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list ?? []).filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!needle) return true;
      return [r.title, r.description, r.reporter_username, r.reported_player_username, r.claimed_by, String(r.id)]
        .some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [list, filter, q]);

  const statusTag = (s: Status) => (
    <Tag tone={s === 'open' ? 'strong' : s === 'resolved' ? 'faint' : 'plain'}>{t(`label.reports.status.${s}`)}</Tag>
  );

  const columns: Column<Report>[] = [
    {
      key: 'id', label: t('label.reports.col.id'), help: 'help.reports.col.id', num: true, sort: true, value: (r) => r.id, width: '4.5rem',
      render: (r) => <span className="k-num k-dim">{r.id}</span>,
    },
    {
      key: 'who', label: t('label.reports.col.who'), help: 'help.reports.col.who', sort: true, value: (r) => r.reporter_username ?? '',
      render: (r) => (
        <>
          <span className="k-cell-main">{r.reporter_username || t('label.reports.unknown')}</span>
          <span className="k-cell-sub" dir="auto">{r.title}</span>
        </>
      ),
    },
    {
      key: 'status', label: t('label.reports.col.status'), help: 'help.reports.col.status', sort: true, value: (r) => r.status,
      render: (r) => statusTag(r.status),
    },
    {
      key: 'by', label: t('label.reports.col.by'), help: 'help.reports.col.by', priority: 'detail',
      render: (r) => r.claimed_by || '—',
    },
    {
      key: 'at', label: t('label.reports.col.at'), help: 'help.reports.col.at', priority: 'detail',
      render: (r) => <span className="k-num">{fmtDate(secs(r.created_at))}</span>,
    },
  ];

  const chips: ChipItem<Filter>[] = [
    { id: 'open', label: t('label.reports.status.open'), count: counts.open, help: 'help.reports.filter.open' },
    { id: 'claimed', label: t('label.reports.status.claimed'), count: counts.claimed, help: 'help.reports.filter.claimed' },
    { id: 'resolved', label: t('label.reports.status.resolved'), count: counts.resolved, help: 'help.reports.filter.resolved' },
    { id: 'all', label: t('label.reports.filter.all'), count: counts.all, help: 'help.reports.filter.all' },
  ];

  const selected = selId === null ? null : (list ?? []).find((r) => r.id === selId) ?? null;

  return (
    <SplitView
      list={(
        <>
          <Toolbar>
            <TextInput value={q} onChange={setQ} icon="search" clearable placeholder={t('label.reports.search')}
              label={t('label.reports.search')} help="help.reports.search" />
            <FilterChips label={t('label.reports.filters')} value={filter} onChange={setFilter} items={chips} />
          </Toolbar>
          <DataTable
            label={t('label.reports.listLabel')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={selId}
            onSelect={(r) => setSelId(r.id)}
            mode={selId !== null ? 'essential' : 'detail'}
            loading={list === null}
            empty={<EmptyState text={t('label.reports.none')} />}
          />
        </>
      )}
      drawer={selected && (
        <ReportDrawer r={selected} statusTag={statusTag} onClose={() => setSelId(null)} onChanged={() => { void load(); app.refresh('server'); }} />
      )}
    />
  );
}

function ReportDrawer({ r, statusTag, onClose, onChanged }: {
  r: Report; statusTag: (s: Status) => JSX.Element; onClose(): void; onChanged(): void;
}) {
  const app = useApp();
  const { t } = useI18n();
  const [reply, setReply] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (action: 'claim' | 'resolve' | 'reopen' | 'message', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const res = await app.act('reports', { action, reportId: r.id, ...extra });
    setBusy(false);
    if (res.ok) {
      if (action === 'message') setReply('');
      if (action === 'resolve') setNotes('');
      onChanged();
    }
  };

  return (
    <Drawer
      title={r.title || t('label.reports.untitled')}
      help="help.reports.drawer"
      sub={(
        <>
          <span>{t('label.reports.col.id')} <b className="k-num">{r.id}</b></span>
          {r.reporter_username && <span>{t('label.reports.col.who')} <b>{r.reporter_username}</b></span>}
        </>
      )}
      chips={statusTag(r.status)}
      onClose={onClose}
      footer={(
        <>
          {r.status === 'open' && <Button help="help.reports.claim" kind="primary" area="reports" busy={busy} onClick={() => act('claim')}>{t('label.reports.claim')}</Button>}
          {r.status !== 'resolved' && <Button help="help.reports.resolve" kind="secondary" area="reports" busy={busy} onClick={() => act('resolve', { notes })}>{t('label.reports.resolve')}</Button>}
          {r.status === 'resolved' && <Button help="help.reports.reopen" kind="secondary" area="reports" busy={busy} onClick={() => act('reopen')}>{t('label.reports.reopen')}</Button>}
        </>
      )}
    >
      <KeyValueList>
        <KeyValue label={t('label.reports.col.by')} help="help.reports.col.by" value={r.claimed_by || '—'} />
        <KeyValue label={t('label.reports.col.at')} help="help.reports.col.at" value={fmtDate(secs(r.created_at))} ltr />
        {r.reported_player_username && <KeyValue label={t('label.reports.against')} help="help.reports.against" value={r.reported_player_username} />}
      </KeyValueList>
      <Section title={t('label.reports.thread')} help="help.reports.thread" tone="plain">
        {(r.messages?.length ? r.messages : [{ sender_name: r.reporter_username, sender_type: 'player', message: r.description }]).map((m, i) => (
          <p key={i} dir="auto" style={{ margin: '0 0 calc(8 * var(--ws-px))' }}>
            <b>{m.sender_type === 'system' ? t('label.reports.system') : (m.sender_name || '—')}</b>{' '}
            <span className="k-dim k-num">{fmtDate(secs(m.timestamp))}</span><br />
            {m.message}
          </p>
        ))}
      </Section>
      {r.status !== 'resolved' && (
        <Section title={t('label.reports.reply')} help="help.reports.reply" tone="plain">
          <TextArea value={reply} onChange={setReply} rows={3} maxLength={2000} label={t('label.reports.reply')} help="help.reports.reply" />
          <Button help="help.reports.send" kind="primary" area="reports" busy={busy} disabled={!reply.trim()} onClick={() => act('message', { message: reply.trim() })}>{t('label.reports.send')}</Button>
          <Field label={t('label.reports.notes')} help="help.reports.notes">
            <TextArea value={notes} onChange={setNotes} rows={2} maxLength={1000} />
          </Field>
        </Section>
      )}
      {r.status === 'resolved' && r.admin_notes && (
        <Section title={t('label.reports.notes')} help="help.reports.notes" tone="plain">
          <p dir="auto">{r.admin_notes}</p>
        </Section>
      )}
    </Drawer>
  );
}

export const page = definePage({
  id: 'reports', section: 'people', order: 35, glyph: 'list', area: 'reports', layout: 'fill',
  component: ReportsPage,
});
