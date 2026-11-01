/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/Gate.tsx
 * Pages the admin cannot open are hidden by the shell. INSIDE a page a forbidden action stays
 * visible, disabled, with a lock and a line that says which level it needs, so staff learn the rules.
 * The server re-checks every action anyway.
 *   <Gate area="ban"> …controls… </Gate>          every kit control inside is disabled when locked
 *   <Button area="kick" help="help.drawer.kick">   one control
 *   const { can, levelOf, rank } = useLevel();
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import type { Area, Level, Rank } from '../types';
import Glyph from './Glyph';
import HelpTip from '../help/HelpTip';

export interface GateState { locked: boolean; area?: Area; level?: Level | null }
const GateCtx = createContext<GateState>({ locked: false });
export const useGate = () => useContext(GateCtx);

export function useLevel() {
  const app = useApp();
  return {
    rank: app.rank as Rank | null,
    can: (area: Area) => app.can(area),
    levelOf: (area: Area) => app.levelOf(area),
  };
}

/** The lock state of one area, merged with an enclosing Gate */
export function useLock(area?: Area): GateState {
  const outer = useGate();
  const app = useApp();
  if (outer.locked) return outer;
  if (!area) return { locked: false };
  return { locked: !app.can(area), area, level: app.levelOf(area) };
}

export function LockLine({ level }: { level?: Level | null }) {
  const { t } = useI18n();
  return (
    <span className="k-lockline">
      <Glyph name="lock" />
      <span>{level ? t('label.common.lockedNeeds', t(`label.common.level.${level}`)) : t('label.common.locked')}</span>
      <HelpTip help="help.common.locked" size="sm" facts={{ level: level ?? undefined }} />
    </span>
  );
}

export function Gate({ area, children, hide, showLine = true }: { area: Area; children: ReactNode; hide?: boolean; showLine?: boolean }) {
  const app = useApp();
  const outer = useGate();
  const locked = outer.locked || !app.can(area);
  if (locked && hide) return null;
  const level = outer.locked ? outer.level : app.levelOf(area);
  const state: GateState = { locked, area, level };
  return (
    <GateCtx.Provider value={state}>
      {locked ? (
        <div className="k-gate is-locked">
          {showLine && <LockLine level={level} />}
          {/* not a disabled <fieldset>: that would also disable the "؟" buttons inside; every kit
              control reads useGate() and disables itself instead */}
          <div className="k-gate-body">{children}</div>
        </div>
      ) : children}
    </GateCtx.Provider>
  );
}
