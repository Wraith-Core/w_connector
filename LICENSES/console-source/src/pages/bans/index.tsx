/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/bans  (P4)
 * Bans and blocks: two tabs over one split view.
 *   Bans                 the 'bans' push (area bans): filters, search, drawer, unban
 *   Suspended characters w_core character blocks (area characters): list, unblock, suspend by citizen id
 * Route params: view=bans|blocks (the dashboard and the palette may link straight to a tab).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import type { AppCtx } from '../../ctx';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, PageActions, Tabs } from '../../kit';
import { post } from '../../nui';
import { definePage } from '../../app/pages';
import type { PageProps } from '../../app/pages';
import type { BlockEntry } from '../../types';
import BansView from './BansView';
import BlocksView from './BlocksView';
import { banState, nowSec } from './util';
import './bans.css';

type View = 'bans' | 'blocks';

function activeBans(app: Pick<AppCtx, 'bans' | 'serverInfo'>): number | null {
  if (app.bans) {
    const now = nowSec();
    return app.bans.filter((b) => banState(b, now) !== 'expired').length;
  }
  return app.serverInfo?.bansCount ?? null;
}

function BansPage({ route }: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const canBans = app.can('bans');
  const canBlocks = app.can('characters');
  const asked = route.params.view ?? route.params.tab;
  const want: View | null = asked === 'blocks' ? 'blocks' : asked === 'bans' ? 'bans' : null;
  const [view, setView] = useState<View>(() => want ?? (canBans ? 'bans' : 'blocks'));
  useEffect(() => { if (want) setView(want); }, [want]);
  const shown: View = view === 'bans' && !canBans ? 'blocks' : view === 'blocks' && !canBlocks ? 'bans' : view;

  /* the blocks live here so the tab can show their count before it is opened */
  const [blocks, setBlocks] = useState<BlockEntry[] | null>(app.blocks);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const loadBlocks = useCallback(async () => {
    if (!canBlocks) return;
    const r = await post<BlockEntry[]>('characters', { action: 'blocks' });
    if (r.ok && Array.isArray(r.data)) { setBlocks(r.data); setBlocksError(null); }
    else if (!r.ok) setBlocksError(r.error ?? 'ui_failed');
  }, [canBlocks]);
  useEffect(() => { void loadBlocks(); }, [loadBlocks]);
  /* the 'blocks' push (refresh('blocks'), or Lua after a block elsewhere) wins over the first answer */
  useEffect(() => { if (app.blocks) { setBlocks(app.blocks); setBlocksError(null); } }, [app.blocks]);

  const refreshAll = () => {
    if (canBans) app.refresh('bans');
    if (canBlocks) { app.refresh('blocks'); void loadBlocks(); }
    app.refresh('server');
  };

  const bansBadge = activeBans(app);
  const blocksBadge = blocks ? blocks.length : app.serverInfo?.blocksCount ?? null;

  return (
    <div className="bn-page">
      <PageActions>
        <Button help="help.common.refresh" icon="refresh" kind="ghost" onClick={refreshAll}>{t('label.bans.refresh')}</Button>
      </PageActions>
      <div className="bn-tabs">
        <Tabs
          label={t('label.bans.tabs')}
          value={shown}
          onChange={setView}
          idBase="bn"
          items={[
            { id: 'bans', label: t('label.bans.tabBans'), help: 'help.bans.tabBans', badge: bansBadge || null, area: 'bans' },
            { id: 'blocks', label: t('label.bans.tabBlocks'), help: 'help.bans.tabBlocks', badge: blocksBadge || null, area: 'characters' },
          ]}
        />
      </div>
      <div className="bn-body" id="bn-panel" role="tabpanel">
        {shown === 'bans'
          ? <BansView />
          : <BlocksView rows={blocks} error={blocksError ? t(blocksError) : null} reload={() => { void loadBlocks(); }} />}
      </div>
    </div>
  );
}

export const page = definePage({
  id: 'bans',
  section: 'people',
  order: 30,
  glyph: 'ban',
  area: ['bans', 'characters'],
  layout: 'fill',
  refresh: ['bans', 'blocks'],
  component: BansPage,
  badge: (app) => (app.can('bans') ? activeBans(app) || null : null),
});
