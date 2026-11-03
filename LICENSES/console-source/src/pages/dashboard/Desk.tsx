/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/dashboard/Desk.tsx  (2.3.0 the action desk: the home page's player list)
 * Everyone online in one list with the board's cursor rules (CLAUDE.md §4): the pointer or ↑ ↓ only move the
 * band, a click or Enter SELECTS (the shell's selectedId, shared with the Players page, the map and the
 * quick menu), a double click opens the player's file. The actions above the list act on the SELECTED player
 * only, each with one letter key (by e.code, so an Arabic keyboard layout works too):
 *   G go to · B bring · N bring back · R revive · H heal · E refill · F freeze / unfreeze · S spectate
 *   I bag · M message · O file · K kick (asks a reason: the confirm stays) · ban opens the file's moderation
 * Every action is the same post('player', { citizenid, action, args }) the file sends (players/shared.ts), with
 * the same areas, capability names and NO_SELF rule; the server re-checks all of it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useApp } from '../../ctx';
import type { HelpKey } from '../../help/types';
import { useI18n } from '../../i18n';
import { Button, EmptyState, Field, ReasonField, Section, StatusChip, Tag, TextInput, cls, isTypingTarget } from '../../kit';
import type { AdminPlayer, Area } from '../../types';
import { displayName, groupLabel, isStaff, playerPayload, selfBlocked, statusOf } from '../players/shared';
import type { PlayerAction } from '../players/shared';

type DeskRun = 'act' | 'message' | 'kick' | 'ban' | 'file';

interface DeskAct {
  id: string;
  run: DeskRun;
  /** the player action (run 'act' and 'kick') */
  action?: PlayerAction;
  /** e.code of its key, and the letter shown on the button */
  code?: string;
  cap?: string;
  area: Area;
  help: HelpKey;
  kind?: 'primary' | 'secondary' | 'danger';
  args?(p: AdminPlayer, spectating: boolean): Record<string, unknown>;
  enabled?(p: AdminPlayer): boolean;
}

const ACTS: DeskAct[] = [
  { id: 'teleportTo', run: 'act', action: 'teleportTo', code: 'KeyG', cap: 'G', area: 'teleport', help: 'help.map.player.goto', kind: 'primary' },
  { id: 'bring', run: 'act', action: 'bring', code: 'KeyB', cap: 'B', area: 'teleport', help: 'help.map.player.bring' },
  { id: 'bringBack', run: 'act', action: 'bringBack', code: 'KeyN', cap: 'N', area: 'teleport', help: 'help.map.player.bringBack', enabled: (p) => !!p.canReturn },
  { id: 'revive', run: 'act', action: 'revive', code: 'KeyR', cap: 'R', area: 'revive', help: 'help.map.player.revive' },
  { id: 'heal', run: 'act', action: 'heal', code: 'KeyH', cap: 'H', area: 'revive', help: 'help.map.player.heal' },
  { id: 'refill', run: 'act', action: 'needs', code: 'KeyE', cap: 'E', area: 'needs', help: 'help.dashboard.refill', args: () => ({ hunger: 100, thirst: 100 }) },
  { id: 'freeze', run: 'act', action: 'freeze', code: 'KeyF', cap: 'F', area: 'players', help: 'help.map.player.freeze', args: (p) => ({ state: !p.frozen }) },
  { id: 'spectate', run: 'act', action: 'spectate', code: 'KeyS', cap: 'S', area: 'players', help: 'help.map.player.spectate', args: (_p, on) => ({ state: !on }) },
  { id: 'openInventory', run: 'act', action: 'openInventory', code: 'KeyI', cap: 'I', area: 'items', help: 'help.map.player.openInventory' },
  { id: 'message', run: 'message', action: 'notify', code: 'KeyM', cap: 'M', area: 'players', help: 'help.dashboard.desk.message' },
  { id: 'file', run: 'file', code: 'KeyO', cap: 'O', area: 'players', help: 'help.dashboard.open' },
  { id: 'kick', run: 'kick', action: 'kick', code: 'KeyK', cap: 'K', area: 'kick', help: 'help.drawer.kick', kind: 'danger' },
  { id: 'ban', run: 'ban', action: 'ban', area: 'ban', help: 'help.dashboard.desk.ban', kind: 'danger' },
];

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');

export default function Desk() {
  const app = useApp();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const needle = norm(q.trim().replace(/^#/, ''));
  const rows = useMemo(() => {
    const list = [...app.players].sort((a, b) => a.id - b.id);
    if (!needle) return list;
    return list.filter((p) => norm(`${p.id} ${p.citizenid ?? ''} ${p.name} ${displayName(p)} ${p.job?.label ?? ''}`).includes(needle));
  }, [app.players, needle]);

  const sel = app.selectedId !== null ? app.players.find((p) => p.id === app.selectedId) ?? null : null;
  const spectating = !!sel && !!app.self?.spectating && app.self.spectating === sel.id;

  /* the cursor stays on the list when it shrinks */
  useEffect(() => { if (cursor !== null && cursor >= rows.length) setCursor(rows.length ? rows.length - 1 : null); }, [rows.length, cursor]);

  const label = (a: DeskAct, p: AdminPlayer | null): string => {
    if (a.id === 'freeze' && p?.frozen) return t('label.quick.act.unfreeze');
    if (a.id === 'spectate' && spectating) return t('label.drawer.unspectate');
    if (a.id === 'refill') return t('label.dashboard.act.refill');
    if (a.id === 'message') return t('label.dashboard.desk.message');
    if (a.id === 'file') return t('label.dashboard.desk.file');
    if (a.id === 'kick') return t('label.dashboard.desk.kick');
    if (a.id === 'ban') return t('label.dashboard.desk.ban');
    return t(`label.quick.act.${a.id}`);
  };

  const canRun = (a: DeskAct, p: AdminPlayer | null): boolean => {
    if (!p || !app.can(a.area)) return false;
    if (a.action && !app.canAction(`player.${a.action}`)) return false;
    if (a.action && selfBlocked(p, app.selfId, a.action)) return false;
    if (a.enabled && !a.enabled(p)) return false;
    return true;
  };

  const act = async (key: string, p: AdminPlayer, action: PlayerAction, args: Record<string, unknown> = {}) => {
    setBusy(key);
    try { return await app.act('player', playerPayload(p, app.selfId, action, args), { okText: t('label.drawer.done') }); } finally { setBusy(null); }
  };

  const fire = (a: DeskAct) => {
    const p = sel;
    if (!p || busy || !canRun(a, p)) return;
    const name = displayName(p);
    switch (a.run) {
      case 'file': app.navigate('players', { sel: String(p.id) }); return;
      case 'ban': app.navigate('players', { sel: String(p.id), view: 'moderation' }); return;
      case 'message':
        app.confirm<string>({
          title: t('label.dashboard.desk.messageTitle', name),
          help: 'help.dashboard.desk.message',
          confirmLabel: t('label.drawer.send'),
          initial: '',
          render: ({ value, set }) => (
            <Field label={t('label.drawer.message')} help="help.drawer.message">
              <TextInput value={value} onChange={set} maxLength={300} placeholder={t('label.drawer.messagePh')} autoFocus />
            </Field>
          ),
          canConfirm: (v) => v.trim() !== '',
          onConfirm: async (v) => (await act('message', p, 'notify', { text: v.trim() })).ok,
        });
        return;
      case 'kick': {
        const tpl = ['a', 'b', 'c', 'd'].map((k) => t(`label.drawer.kickTpl.${k}`));
        app.confirm<string>({
          title: t('label.drawer.kickTitle', name),
          help: 'help.drawer.kick',
          danger: true,
          confirmLabel: t('label.drawer.kick'),
          initial: '',
          render: ({ value, set }) => (
            <Field label={t('label.drawer.kickReason')} help="help.drawer.kickReason" required>
              <ReasonField value={value} onChange={set} templates={tpl} maxLength={200} />
            </Field>
          ),
          canConfirm: (v) => v.trim() !== '',
          onConfirm: async (v) => {
            const r = await act('kick', p, 'kick', { reason: v.trim() });
            if (r.ok) app.select(null);
            return r.ok;
          },
        });
        return;
      }
      default:
        if (a.action) void act(a.id, p, a.action, a.args?.(p, spectating) ?? {});
    }
  };

  /* the letter keys: never while typing, never with a modifier, never over a dialog or the palette */
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      /* an open list popup (a Select) keeps its own letter keys */
      if (isTypingTarget(e.target) || document.querySelector('.k-dialog-veil, .sh-pal-veil, .k-pop')) return;
      const a = ACTS.find((x) => x.code === e.code);
      if (!a) return;
      e.preventDefault();
      fireRef.current(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (p: AdminPlayer) => app.select(p.id);
  const moveTo = (i: number) => {
    setCursor(i);
    listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const i = cursor ?? Math.max(0, rows.findIndex((p) => p.id === app.selectedId));
    if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(Math.min(rows.length - 1, cursor === null ? i : i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(Math.max(0, cursor === null ? i : i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); moveTo(0); }
    else if (e.key === 'End') { e.preventDefault(); moveTo(rows.length - 1); }
    else if (e.key === 'Enter' && cursor !== null && rows[cursor]) { e.preventDefault(); pick(rows[cursor]); }
  };
  /* ↓ from the search box goes into the list */
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); listRef.current?.focus(); moveTo(0); }
    else if (e.key === 'Enter' && rows.length === 1) { e.preventDefault(); pick(rows[0]); }
  };

  const shown = ACTS.filter((a) => app.can(a.area));

  return (
    <Section
      title={t('label.dashboard.desk.title')}
      help="help.dashboard.desk.list"
      area="players"
      className="dsh-desk"
      actions={<span className="dsh-desk-count k-num">{rows.length}</span>}
    >
      <div className={cls('dsh-desk-target', !sel && 'is-empty')}>
        {sel ? (
          <>
            <div className="dsh-desk-who">
              <span className="dsh-desk-name k-ellipsis">{displayName(sel)}</span>
              <span className="dsh-desk-ids">
                <span>{t('label.common.citizen.label')} <b className="k-num">{sel.citizenid || '—'}</b></span>
                <span className="k-num">#{sel.id}</span>
                {sel.job?.label && <span className="k-ellipsis">{sel.job.label}</span>}
              </span>
              <span className="dsh-desk-chips">
                <StatusChip status={statusOf(sel)} />
                {sel.frozen && statusOf(sel) !== 'frozen' && <StatusChip status="frozen" />}
                {spectating && <Tag tone="strong">{t('label.drawer.spectating')}</Tag>}
                {sel.id === app.selfId && <Tag tone="strong">{t('label.players.you')}</Tag>}
                {isStaff(sel) && <Tag>{groupLabel(t, sel.group)}</Tag>}
              </span>
            </div>
            <div className="dsh-desk-acts">
              {shown.map((a) => (
                <Button
                  key={a.id}
                  help={a.help}
                  helpLabel={label(a, sel)}
                  area={a.area}
                  actionName={a.action ? `player.${a.action}` : undefined}
                  kind={a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : 'secondary'}
                  helpDanger={false}
                  size="sm"
                  kbd={a.cap}
                  className="dsh-desk-act"
                  busy={busy === a.id}
                  disabled={!canRun(a, sel) || (!!busy && busy !== a.id)}
                  onClick={() => fire(a)}
                >
                  {label(a, sel)}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <p className="dsh-desk-none">{t('label.dashboard.desk.none')}</p>
        )}
      </div>

      <TextInput
        icon="search"
        value={q}
        onChange={setQ}
        clearable
        placeholder={t('label.dashboard.desk.search')}
        label={t('label.dashboard.desk.search')}
        help="help.dashboard.desk.search"
        onKeyDown={onSearchKey}
        className="dsh-desk-search"
      />

      <div
        ref={listRef}
        className="dsh-rows"
        role="listbox"
        tabIndex={0}
        aria-label={t('label.dashboard.desk.title')}
        aria-activedescendant={cursor !== null && rows[cursor] ? `dsh-p-${rows[cursor].id}` : undefined}
        onKeyDown={onListKey}
        onMouseLeave={() => setCursor(null)}
      >
        {rows.map((p, i) => {
          const st = statusOf(p);
          return (
            <div
              key={p.id}
              id={`dsh-p-${p.id}`}
              data-i={i}
              role="option"
              aria-selected={p.id === app.selectedId}
              className={cls('dsh-row', i === cursor && 'is-here', p.id === app.selectedId && 'is-picked')}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(p)}
              onDoubleClick={() => app.navigate('players', { sel: String(p.id) })}
            >
              <span className="dsh-row-main">
                <span className="dsh-row-name">{displayName(p)}</span>
                <span className="dsh-row-meta">
                  <span>{t('label.common.citizen.label')} <span className="k-num">{p.citizenid || '—'}</span></span>
                  <span className="k-num">#{p.id}</span>
                  {p.job?.label && <span>{p.job.label}</span>}
                </span>
              </span>
              <span className="dsh-row-end">
                {st !== 'ok' && <StatusChip status={st} />}
                {p.id === app.selfId && <Tag tone="faint">{t('label.players.you')}</Tag>}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <EmptyState text={app.players.length === 0 ? t('label.dashboard.desk.noPlayers') : t('label.dashboard.desk.empty')} />
        )}
      </div>
      <p className="dsh-desk-hint">{t('label.dashboard.desk.hint')}</p>
    </Section>
  );
}
