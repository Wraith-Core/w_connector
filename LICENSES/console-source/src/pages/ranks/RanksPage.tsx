/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/ranks/RanksPage.tsx
 * Loads the state once (post('ranks', { action: 'state' })), then every change goes through app.act
 * (the panel's toast) and its answer replaces the whole state. Both tabs stay mounted, so a draft in
 * the editor survives a look at the Staff tab.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, InlineAlert, Loading, PageActions, Tabs } from '../../kit';
import { post } from '../../nui';
import type { Result } from '../../types';
import RanksView from './RanksView';
import StaffView from './StaffView';
import { toState } from './model';
import type { RanksState } from './model';

type View = 'ranks' | 'staff';

export type Send = (payload: Record<string, unknown>) => Promise<Result<unknown>>;

export default function RanksPage({ route }: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const player = route.params.player && /^\d+$/.test(route.params.player) ? route.params.player : null;
  const asked: View | null = player || route.params.view === 'staff' ? 'staff' : route.params.view === 'ranks' ? 'ranks' : null;
  const [view, setView] = useState<View>(asked ?? 'ranks');
  /* every navigate() is a new route: the player file may link here again with the same player */
  useEffect(() => { if (asked) setView(asked); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = useMemo(() => (player ? { player } : null), [route]); // eslint-disable-line react-hooks/exhaustive-deps

  const [st, setSt] = useState<RanksState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await post('ranks', { action: 'state' });
    const s = r.ok ? toState(r.data) : null;
    if (s) { setSt(s); setErr(null); } else setErr(r.error ?? 'ui_failed');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** One change: the panel's toast, then the answer is the new state */
  const act = app.act;
  const send = useCallback<Send>(async (payload) => {
    const r = await act('ranks', payload);
    if (r.ok) {
      const s = toState(r.data);
      if (s) setSt(s); else void load();
    }
    return r;
  }, [act, load]);

  const header = (
    <PageActions>
      <Button help="help.common.refresh" icon="refresh" kind="ghost" busy={loading && !!st} onClick={() => { void load(); }}>{t('label.ranks.refresh')}</Button>
    </PageActions>
  );

  if (!st) {
    return (
      <div className="rk-page">
        {header}
        {err ? (
          <div className="rk-pad">
            <InlineAlert
              tone="danger"
              title={t('label.ranks.loadFailed')}
              help="help.ranks.loadFailed"
              actions={<Button help="help.common.retry" kind="ghost" icon="refresh" busy={loading} onClick={() => { void load(); }}>{t('label.ranks.retry')}</Button>}
            >
              <p>{t(err)}</p>
            </InlineAlert>
          </div>
        ) : <Loading />}
      </div>
    );
  }

  return (
    <div className="rk-page">
      {header}
      <div className="rk-tabs">
        <Tabs
          label={t('label.ranks.tabs')}
          value={view}
          onChange={setView}
          idBase="rk"
          items={[
            { id: 'ranks', label: t('label.ranks.tabRanks'), help: 'help.ranks.tabRanks', badge: st.ranks.length || null },
            { id: 'staff', label: t('label.ranks.tabStaff'), help: 'help.ranks.tabStaff', badge: st.members.length || null },
          ]}
        />
      </div>
      <div className="rk-body" id="rk-panel" role="tabpanel">
        <div className="rk-pane" hidden={view !== 'ranks'}><RanksView st={st} send={send} /></div>
        <div className="rk-pane" hidden={view !== 'staff'}><StaffView st={st} send={send} pick={pick} /></div>
      </div>
    </div>
  );
}
