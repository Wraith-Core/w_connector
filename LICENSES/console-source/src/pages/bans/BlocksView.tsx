/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/bans/BlocksView.tsx
 * Suspended characters (w_core character blocks): list, search, a drawer, unblock through a
 * ConfirmDialog, a link to the character, and "Suspend a character" by citizen id.
 *   post('characters', { action: 'blocks' })                       → Result<BlockEntry[]>  (the page loads it)
 *   post('characters', { action: 'unblock', citizenid })           → Result
 *   post('characters', { action: 'block', citizenid, reason })     → Result   (citizenid = the RESOLVED id)
 * The citizen id field takes '14', '#5' (session number) or an old id; w.citizen resolves it and the
 * dialog sends the resolved citizen id, so the server never has to guess.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, CitizenIdInput, DataTable, Drawer, EmptyState, Field, KeyValue, KeyValueList, ReasonField, Section, SplitView, StatusChip,
  TextInput, Toolbar, fmtAgo, fmtDate,
} from '../../kit';
import type { CitizenState, Column } from '../../kit';
import type { BlockEntry } from '../../types';
import { useNow } from './util';

interface NewBlock { input: string; cid: string | null; name: string; reason: string }

export interface BlocksViewProps {
  rows: BlockEntry[] | null;
  error: string | null;
  reload(): void;
}

export default function BlocksView({ rows: list, error, reload }: BlocksViewProps) {
  const app = useApp();
  const { t, lang } = useI18n();
  const now = useNow();
  const [q, setQ] = useState('');
  const [selCid, setSelCid] = useState<string | null>(null);

  /* the live list knows who is online right now; the block row carries the server's answer from when it was read */
  const sessionOf = (b: BlockEntry): number | null => {
    const p = app.players.find((x) => (x.citizenid || '').toUpperCase() === b.citizenid.toUpperCase());
    return p ? p.id : app.playersSeen ? null : b.online ?? null;
  };

  const rows = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    return list
      .filter((b) => !needle || [b.citizenid, b.name, b.reason, b.blocked_by].some((v) => String(v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => (b.blocked_at || 0) - (a.blocked_at || 0));
  }, [list, q]);

  const blockedIds = useMemo(() => new Set((list ?? []).map((b) => b.citizenid.toUpperCase())), [list]);

  const askUnblock = (b: BlockEntry) => app.confirm({
    title: t('label.bans.blocks.unblockTitle', b.name || b.citizenid),
    help: 'help.bans.blocks.unblock',
    text: t('label.bans.blocks.unblockText'),
    confirmLabel: t('label.bans.blocks.unblock'),
    onConfirm: async () => {
      const r = await app.act('characters', { action: 'unblock', citizenid: b.citizenid });
      if (r.ok) {
        setSelCid((cur) => (cur === b.citizenid ? null : cur));
        reload();
      }
    },
  });

  const askBlock = () => app.confirm<NewBlock>({
    title: t('label.bans.blocks.newTitle'),
    help: 'help.bans.blocks.new',
    text: t('label.bans.blocks.newText'),
    danger: true,
    undoable: true,
    initial: { input: '', cid: null, name: '', reason: '' },
    confirmLabel: t('label.bans.blocks.confirm'),
    canConfirm: (v) => !!v.cid && v.reason.trim() !== '',
    render: ({ value, set }) => <NewBlockForm value={value} set={set} blocked={blockedIds} />,
    onConfirm: async (v) => {
      if (!v.cid) return false;
      const r = await app.act('characters', { action: 'block', citizenid: v.cid, reason: v.reason.trim() });
      if (!r.ok) return false;
      reload();
      return undefined;
    },
  });

  const openChar = (cid: string) => app.navigate('characters', { cid });

  const columns: Column<BlockEntry>[] = [
    {
      key: 'cid', label: t('label.bans.blocks.col.cid'), help: 'help.bans.blocks.col.cid', sort: true,
      value: (b) => (/^\d+$/.test(b.citizenid) ? Number(b.citizenid) : b.citizenid), width: '8.5rem',
      render: (b) => {
        const sid = sessionOf(b);
        return (
          <span className="bn-cid">
            <b className="k-num">{b.citizenid}</b>
            {sid !== null && <span className="k-faint k-num">#{sid}</span>}
          </span>
        );
      },
    },
    {
      key: 'name', label: t('label.bans.blocks.col.name'), help: 'help.bans.blocks.col.name', sort: true, value: (b) => b.name ?? '',
      render: (b) => {
        const sid = sessionOf(b);
        return (
          <>
            <span className="k-cell-main">{b.name || '—'}</span>
            <span className="k-cell-sub">{sid !== null ? t('label.bans.blocks.online', String(sid)) : t('label.bans.blocks.offline')}</span>
          </>
        );
      },
    },
    {
      key: 'reason', label: t('label.bans.blocks.col.reason'), help: 'help.bans.blocks.col.reason', className: 'bn-wrap', priority: 'detail',
      render: (b) => (b.reason ? <span className="bn-clamp" dir="auto">{b.reason}</span> : <span className="k-faint">{t('label.bans.noReason')}</span>),
    },
    {
      key: 'by', label: t('label.bans.blocks.col.by'), help: 'help.bans.blocks.col.by', sort: true, value: (b) => b.blocked_by ?? '', priority: 'detail',
      render: (b) => b.blocked_by || '—',
    },
    {
      key: 'since', label: t('label.bans.blocks.col.since'), help: 'help.bans.blocks.col.since', sort: true, value: (b) => b.blocked_at || 0,
      render: (b) => (
        <>
          <span className="k-cell-main">{b.blocked_at ? fmtAgo(t, lang, b.blocked_at, now) : '—'}</span>
          <span className="k-cell-sub k-num">{fmtDate(b.blocked_at)}</span>
        </>
      ),
    },
    {
      key: 'actions', label: t('label.bans.col.actions'), help: 'help.bans.col.actions', className: 'bn-actions',
      render: (b) => (
        <span className="bn-rowbtns">
          <Button help="help.bans.blocks.unblock" helpQuiet kind="ghost" size="sm" area="characters" onClick={() => askUnblock(b)}>{t('label.bans.blocks.unblock')}</Button>
          <Button help="help.bans.blocks.open" helpQuiet kind="ghost" size="sm" area="characters" onClick={() => openChar(b.citizenid)}>{t('label.bans.blocks.open')}</Button>
        </span>
      ),
    },
  ];

  const selected = selCid === null ? null : (list ?? []).find((b) => b.citizenid === selCid) ?? null;

  const empty = list && list.length === 0
    ? <EmptyState text={t('label.bans.blocks.none')} next={<span className="k-faint">{t('label.bans.blocks.noneNext')}</span>} />
    : <EmptyState text={t('label.bans.noMatch')} next={q.trim() && <Button help="help.common.search" size="sm" onClick={() => setQ('')}>{t('label.bans.clear')}</Button>} />;

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
              placeholder={t('label.bans.searchBlocks')}
              label={t('label.bans.searchBlocks')}
              help="help.bans.blocks.search"
              className="bn-search"
            />
            {list && <span className="bn-count">{t('label.bans.showing', rows.length, list.length)}</span>}
            <span className="k-push">
              <Button help="help.bans.blocks.new" icon="plus" area="characters" onClick={askBlock}>{t('label.bans.blocks.new')}</Button>
            </span>
          </Toolbar>
          <DataTable
            label={t('label.bans.blocks.listLabel')}
            columns={columns}
            rows={rows}
            rowKey={(b) => b.citizenid}
            selectedKey={selCid}
            onSelect={(b) => setSelCid(b.citizenid)}
            mode={selCid !== null ? 'essential' : 'detail'}
            loading={list === null && !error}
            error={list === null ? error : null}
            onRetry={reload}
            empty={empty}
          />
        </>
      )}
      drawer={selected && (
        <BlockDrawer
          b={selected}
          session={sessionOf(selected)}
          onClose={() => setSelCid(null)}
          onUnblock={() => askUnblock(selected)}
          onOpen={() => openChar(selected.citizenid)}
        />
      )}
    />
  );
}

function NewBlockForm({ value, set, blocked }: { value: NewBlock; set(v: NewBlock): void; blocked: Set<string> }) {
  const { t } = useI18n();
  /* only store a change: the preview hands a fresh object on every render while the box is empty */
  const onResolved = (s: CitizenState) => {
    const cid = s.kind === 'found' ? s.preview.citizenid : null;
    const name = s.kind === 'found' ? s.preview.name : '';
    if (cid !== value.cid || name !== value.name) set({ ...value, cid, name });
  };
  const already = !!value.cid && blocked.has(value.cid.toUpperCase());
  return (
    <div className="k-stack">
      <Field label={t('label.bans.blocks.who')} help="help.bans.blocks.who" hint={already ? t('label.bans.blocks.already') : undefined} required>
        <CitizenIdInput value={value.input} onChange={(input) => set({ ...value, input })} onResolved={onResolved} autoFocus />
      </Field>
      <Field label={t('label.bans.blocks.reason')} help="help.bans.blocks.reason" required>
        <ReasonField
          value={value.reason}
          onChange={(reason) => set({ ...value, reason })}
          templates={[t('label.bans.blocks.reasons.cheat'), t('label.bans.blocks.reasons.exploit'), t('label.bans.blocks.reasons.rules')]}
          maxLength={255}
        />
      </Field>
    </div>
  );
}

function BlockDrawer({ b, session, onClose, onUnblock, onOpen }: { b: BlockEntry; session: number | null; onClose(): void; onUnblock(): void; onOpen(): void }) {
  const { t } = useI18n();
  return (
    <Drawer
      title={b.name || b.citizenid}
      helpLabel={b.name || b.citizenid}
      help="help.bans.blocks.drawer"
      sub={(
        <>
          <span>{t('label.bans.blocks.d.cid')} <b className="k-num">{b.citizenid}</b></span>
          {session !== null && <span className="k-num">#{session}</span>}
        </>
      )}
      chips={(
        <>
          <StatusChip status="blocked" label={t('label.bans.blocks.chip')} />
          <StatusChip status={session !== null ? 'online' : 'offline'} label={session !== null ? t('label.bans.blocks.online', String(session)) : undefined} />
        </>
      )}
      onClose={onClose}
      footer={(
        <>
          <Button help="help.bans.blocks.unblock" kind="primary" area="characters" onClick={onUnblock}>{t('label.bans.blocks.unblock')}</Button>
          <Button help="help.bans.blocks.open" area="characters" onClick={onOpen}>{t('label.bans.blocks.open')}</Button>
        </>
      )}
    >
      <KeyValueList>
        <KeyValue label={t('label.bans.blocks.d.cid')} help="help.common.citizenId" value={b.citizenid} copy={b.citizenid} ltr />
        <KeyValue label={t('label.bans.blocks.d.by')} help="help.bans.blocks.col.by" value={b.blocked_by} />
        <KeyValue label={t('label.bans.blocks.d.at')} help="help.bans.blocks.col.since" value={fmtDate(b.blocked_at)} ltr />
        <KeyValue
          label={t('label.bans.blocks.d.state')}
          help="help.bans.blocks.col.name"
          value={session !== null ? t('label.bans.blocks.online', String(session)) : t('label.bans.blocks.offline')}
        />
      </KeyValueList>
      <Section title={t('label.bans.blocks.d.reason')} help="help.bans.blocks.col.reason" tone="plain">
        <p className="bn-reason-full" dir="auto">{b.reason || t('label.bans.noReason')}</p>
      </Section>
    </Drawer>
  );
}
