/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/players/PlayerDrawer.tsx
 * The selected player's file: a sticky header (name, citizen id, #session, state), six sections
 * (Profile · Travel · Health · Money & job · Items · Moderation) and a sticky footer with the three
 * most used actions (Go to · Bring · Revive). A section whose every action is above the admin's
 * level shows a lock on its tab; inside it the controls stay visible, locked, with the level they need.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, Drawer, Glyph, StatusChip, Tag } from '../../kit';
import type { TabItem } from '../../kit';
import type { AdminPlayer } from '../../types';
import { DRAWER_TABS, TAB_AREAS, TAB_HELP, displayName, groupLabel, isStaff, selfBlocked, statusOf, usePlayerAction } from './shared';
import type { DrawerTab } from './shared';
import HealthTab from './tabs/HealthTab';
import ItemsTab from './tabs/ItemsTab';
import ModerationTab from './tabs/ModerationTab';
import MoneyTab from './tabs/MoneyTab';
import ProfileTab from './tabs/ProfileTab';
import TravelTab from './tabs/TravelTab';
import type { TabProps } from './tabs/types';

export default function PlayerDrawer({ player: p, tab, onTab, onClose }: { player: AdminPlayer; tab: DrawerTab; onTab(t: DrawerTab): void; onClose(): void }) {
  const app = useApp();
  const { t } = useI18n();
  const { run, busy } = usePlayerAction(p);
  const isMe = p.id === app.selfId;
  const status = statusOf(p);
  const spectating = !!app.self?.spectating && app.self.spectating === p.id;

  const tabs: TabItem<DrawerTab>[] = DRAWER_TABS.map((id) => {
    const areas = TAB_AREAS[id];
    const locked = areas.length > 0 && areas.every((a) => !app.can(a));
    return {
      id,
      label: t(`label.drawer.tab.${id}`),
      help: TAB_HELP[id],
      badge: locked ? <Glyph name="lock" className="pl-tab-lock" /> : undefined,
    };
  });

  const props: TabProps = { p, run, busy, isMe };

  return (
    <Drawer<DrawerTab>
      className="pl-drawer"
      title={displayName(p)}
      help="help.drawer.player"
      sub={<>
        <span>{t('label.drawer.cid')} <b className="k-num">{p.citizenid || '—'}</b></span>
        <span>{t('label.drawer.session')} <b className="k-num">#{p.id}</b></span>
        {p.name && p.name !== displayName(p) && <span className="k-faint k-ellipsis pl-sub-account">{p.name}</span>}
      </>}
      chips={<>
        <StatusChip status={status} />
        {p.frozen && status !== 'frozen' && <StatusChip status="frozen" />}
        {spectating && <Tag tone="strong">{t('label.drawer.spectating')}</Tag>}
        {isMe && <Tag tone="strong">{t('label.players.you')}</Tag>}
        {isStaff(p) && <Tag>{groupLabel(t, p.group)}</Tag>}
        {p.job?.onDuty && <Tag tone="faint">{t('label.players.onDuty')}</Tag>}
      </>}
      tabs={tabs}
      tab={tab}
      onTab={onTab}
      tabsLabel={t('label.drawer.tabs')}
      onClose={onClose}
      footer={<>
        <Button help="help.drawer.goto" kind="primary" area="teleport" disabled={selfBlocked(p, app.selfId, 'teleportTo')} busy={busy === 'goto'} onClick={() => void run('goto', 'teleportTo')}>
          {t('label.drawer.goto')}
        </Button>
        <Button help="help.drawer.bring" area="teleport" disabled={selfBlocked(p, app.selfId, 'bring')} busy={busy === 'bring'} onClick={() => void run('bring', 'bring')}>
          {t('label.drawer.bring')}
        </Button>
        <Button help="help.drawer.revive" area="revive" busy={busy === 'revive'} onClick={() => void run('revive', 'revive')}>
          {t('label.drawer.revive')}
        </Button>
      </>}
      footerNote={isMe ? t('label.drawer.self') : t('label.drawer.footNote')}
    >
      {tab === 'profile' && <ProfileTab {...props} />}
      {tab === 'travel' && <TravelTab {...props} />}
      {tab === 'health' && <HealthTab {...props} />}
      {tab === 'money' && <MoneyTab {...props} />}
      {tab === 'items' && <ItemsTab {...props} />}
      {tab === 'moderation' && <ModerationTab {...props} />}
    </Drawer>
  );
}
