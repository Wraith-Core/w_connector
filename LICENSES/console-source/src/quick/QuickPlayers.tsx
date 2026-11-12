/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · quick/QuickPlayers.tsx  (the quick menu's "Players" section)
 * The target is a CITIZEN ID, typed ('12'), a session number ('#5'), or picked from the online list
 * (a click fills the citizen id). The page sends the text as typed and w_lib's w.citizen resolves it
 * on the server (runPlayer); only the admin himself goes by his session number, so the client knows
 * to hand the screen over for his own wardrobe.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../ctx';
import type { HelpKey } from '../help/types';
import { useI18n } from '../i18n';
import { Button, CitizenIdInput, Field, HelpTip, StatusChip, Where, cls, useWhere } from '../kit';
import type { CitizenState } from '../kit';
import type { AdminPlayer, Area } from '../types';

interface PlayerAct {
  id: string;
  area: Area;
  help: HelpKey;
  /** the server refuses it on the admin himself (NO_SELF) */
  noSelf?: boolean;
  args?(p: AdminPlayer | null): Record<string, unknown>;
  enabled?(p: AdminPlayer | null): boolean;
}

const ACTS: PlayerAct[] = [
  { id: 'teleportTo', area: 'teleport', help: 'help.map.player.goto', noSelf: true },
  { id: 'bring', area: 'teleport', help: 'help.map.player.bring', noSelf: true },
  { id: 'bringBack', area: 'teleport', help: 'help.map.player.bringBack', noSelf: true, enabled: (p) => !!p?.canReturn },
  { id: 'spectate', area: 'players', help: 'help.map.player.spectate', noSelf: true, args: () => ({ state: true }) },
  { id: 'freeze', area: 'players', help: 'help.map.player.freeze', noSelf: true, args: (p) => ({ state: !p?.frozen }) },
  { id: 'revive', area: 'revive', help: 'help.map.player.revive' },
  { id: 'heal', area: 'revive', help: 'help.map.player.heal' },
  { id: 'openInventory', area: 'items', help: 'help.map.player.openInventory' },
  { id: 'wardrobe', area: 'items', help: 'help.map.player.wardrobe' },
];

const fullName = (p: AdminPlayer) => `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.name;

/* useCitizenPreview hands back a new object on every render ({ kind: 'empty' } …); keeping the old
   one when nothing changed stops onResolved → setState → render → onResolved from looping */
const sameState = (a: CitizenState, b: CitizenState): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'found' || b.kind !== 'found') return true;
  const x = a.preview; const y = b.preview;
  return x.citizenid === y.citizenid && x.online === y.online && x.source === y.source && x.name === y.name;
};

export default function QuickPlayers({ search }: { search: string }) {
  const app = useApp();
  const { t } = useI18n();
  const [target, setTarget] = useState('');
  const [state, setState] = useState<CitizenState>({ kind: 'empty' });
  const [busy, setBusy] = useState<string | null>(null);
  const onResolved = useCallback((s: CitizenState) => setState((prev) => (sameState(prev, s) ? prev : s)), []);

  const needle = search.trim().toLocaleLowerCase();
  const list = useMemo(() => app.players.filter((p) => !needle
    || `#${p.id} ${p.citizenid ?? ''} ${p.name} ${p.firstname ?? ''} ${p.lastname ?? ''}`.toLocaleLowerCase().includes(needle)), [app.players, needle]);

  const preview = state.kind === 'found' ? state.preview : null;
  const ready = !!preview?.online;
  const player = preview?.source !== undefined ? app.players.find((p) => p.id === preview.source) ?? null : null;
  const isSelf = !!preview && preview.source === app.selfId;
  const acts = ACTS.filter((a) => app.can(a.area) && app.canAction(`player.${a.id}`));
  /* 2.8.0 where each player is, in words («فالنتاين · 1.2 كم منك»), not coordinates */
  const where = useWhere(list.map((p) => p.coords));

  const run = async (a: PlayerAct) => {
    if (busy || !ready) return;
    setBusy(a.id);
    try {
      const who = isSelf ? { id: app.selfId } : { citizenid: target.trim() };
      await app.act('player', { ...who, action: a.id, args: a.args?.(player) ?? {} }, { okText: t('label.map.done') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="q-players">
      <Field label={t('label.quick.target')} help="help.quick.target">
        <CitizenIdInput value={target} onChange={setTarget} onResolved={onResolved} needsOnline />
      </Field>

      {ready ? (
        <>
          {player && (
            <p className="q-chosen">
              <b>{fullName(player)}</b>
              <Where text={player.id === app.selfId ? t('label.place.here') : where(player.coords)} />
            </p>
          )}
          <div className="q-acts">
            {acts.map((a) => {
              const label = a.id === 'freeze' && player?.frozen ? t('label.quick.act.unfreeze') : t(`label.quick.act.${a.id}`);
              const off = (a.noSelf && isSelf) || (a.enabled ? !a.enabled(player) : false);
              return (
                <Button
                  key={a.id}
                  help={a.help}
                  helpLabel={label}
                  area={a.area}
                  size="sm"
                  block
                  className="q-act"
                  busy={busy === a.id}
                  disabled={off || (!!busy && busy !== a.id)}
                  onClick={() => { void run(a); }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {player?.frozen && <p className="q-note">{t('label.quick.frozen')}</p>}
          {isSelf && <p className="q-note">{t('label.quick.selfNote')}</p>}
        </>
      ) : (
        <p className="q-empty">{state.kind === 'found' ? t('label.quick.offline') : t('label.quick.pickPlayer')}</p>
      )}

      <div className="q-subhead">
        <span>{t('label.quick.online')}</span>
        <span className="k-num k-faint">{list.length}</span>
        <HelpTip help="help.quick.online" label={t('label.quick.online')} size="sm" />
      </div>
      <div className="q-plist">
        {list.map((p) => {
          const cid = p.citizenid || '';
          const on = !!preview && preview.source === p.id;
          return (
            <Button
              key={p.id}
              help={false}
              aria-label={`${fullName(p)} · ${t('label.common.citizen.label')} ${cid} · #${p.id}`}
              kind="ghost"
              block
              className={cls('q-prow', on && 'is-on')}
              onClick={() => setTarget(cid || `#${p.id}`)}
            >
              <span className="q-prow-main">
                <span className="q-prow-name">{fullName(p)}</span>
                <span className="q-prow-sub">{p.name}{p.job?.label ? ` · ${p.job.label}` : ''}</span>
                <Where text={p.id === app.selfId ? t('label.place.here') : where(p.coords)} className="q-prow-where" />
              </span>
              {p.dead && <StatusChip status="dead" />}
              <span className="q-prow-ids">
                <span className="k-num">{cid}</span>
                <span className="k-num k-faint">#{p.id}</span>
              </span>
            </Button>
          );
        })}
        {list.length === 0 && <p className="q-empty">{t('label.quick.noOnline')}</p>}
      </div>
    </div>
  );
}
