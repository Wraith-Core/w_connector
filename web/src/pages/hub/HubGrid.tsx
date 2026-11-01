/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/HubGrid.tsx
 * The Scripts hub: search + filter chips (all · own interface · quick commands · settings · stopped),
 * the scripts in sections (economy, horses and animals, world, tribes, player, entertainment,
 * system), a card each, and the details drawer of the selected one at the reading end.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  Button, EmptyState, FilterChips, HelpTip, InlineAlert, PageHeader, Skeleton, SplitView, TextInput, Toolbar,
} from '../../kit';
import type { ChipItem } from '../../kit';
import type { ModuleDescriptor } from '../../types';
import ModuleCard from './ModuleCard';
import { FILTERS, GROUP_ORDER, groupOf, isDown, matchesFilter, matchesSearch } from './model';
import type { FilterId } from './model';
import ScriptDrawer from './ScriptDrawer';

export interface HubGridProps {
  list: ModuleDescriptor[] | null;
  loading: boolean;
  error: string | null;
  hasSettings(m: ModuleDescriptor): boolean;
  selected: string | null;
  focus?: 'commands';
  opening: string | null;
  onSelect(resource: string | null, focus?: 'commands'): void;
  onOpen(resource: string): void;
  onSettings(resource: string): void;
  onStart(resource: string): void;
  onReload(): void;
}

const FILTER_HELP = {
  all: 'help.hub.filter.all', panel: 'help.hub.filter.panel', commands: 'help.hub.filter.commands',
  settings: 'help.hub.filter.settings', stopped: 'help.hub.filter.stopped',
} as const;

const GROUP_HELP = {
  economy: 'help.hub.group.economy', animals: 'help.hub.group.animals', world: 'help.hub.group.world', tribes: 'help.hub.group.tribes',
  player: 'help.hub.group.player', fun: 'help.hub.group.fun', system: 'help.hub.group.system', other: 'help.hub.group.other',
} as const;

export default function HubGrid(p: HubGridProps) {
  const { t, lt } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const list = p.list ?? [];

  const chips = useMemo<ChipItem<FilterId>[]>(() => FILTERS.map((f) => ({
    id: f,
    label: t(`label.hub.filter.${f}`),
    count: list.filter((m) => matchesFilter(m, f, p.hasSettings)).length,
    help: FILTER_HELP[f],
  })), [list, t, p.hasSettings]);

  const groups = useMemo(() => {
    const shown = list.filter((m) => matchesFilter(m, filter, p.hasSettings) && matchesSearch(m, q));
    return GROUP_ORDER
      .map((g) => ({
        id: g,
        mods: shown.filter((m) => groupOf(m) === g).sort((a, b) => Number(isDown(b)) - Number(isDown(a)) || lt(a.label).localeCompare(lt(b.label))),
      }))
      .filter((g) => g.mods.length > 0);
  }, [list, filter, q, p.hasSettings, lt]);

  const sel = p.selected ? list.find((m) => m.resource === p.selected) ?? null : null;

  const header = (
    <PageHeader
      title={t('label.shell.page.hub')}
      help="help.shell.page.hub"
      description={t('label.shell.desc.hub')}
      className="hub-head"
      actions={<Button help="help.common.refresh" kind="ghost" icon="refresh" onClick={p.onReload}>{t('label.hub.refresh')}</Button>}
    />
  );

  const cards = (
    <div className="hub-list">
      <Toolbar>
        <TextInput value={q} onChange={setQ} icon="search" clearable placeholder={t('label.hub.search')} label={t('label.hub.search')} help="help.hub.search" className="hub-search" />
        <FilterChips label={t('label.hub.filterLabel')} value={filter} onChange={setFilter} items={chips} />
      </Toolbar>
      {p.error && (
        <InlineAlert tone="warn" title={t('label.hub.loadError')} actions={<Button help="help.common.retry" size="sm" onClick={p.onReload}>{t('label.hub.retry')}</Button>}>
          {p.error}
        </InlineAlert>
      )}
      {p.loading && list.length === 0 && <Skeleton rows={8} />}
      {!p.loading && list.length > 0 && groups.length === 0 && (
        <EmptyState
          text={t('label.hub.empty')}
          next={<Button help="help.hub.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.hub.clear')}</Button>}
        />
      )}
      {!p.loading && list.length === 0 && !p.error && (
        <EmptyState text={t('label.hub.emptyNone')} next={<Button help="help.common.retry" size="sm" onClick={p.onReload}>{t('label.hub.retry')}</Button>} />
      )}
      {groups.map((g) => (
        <section className="hub-group-sec" key={g.id} aria-label={t(`label.hub.group.${g.id}`)}>
          <h2 className="hub-sec-title">
            <span>{t(`label.hub.group.${g.id}`)}</span>
            <HelpTip help={GROUP_HELP[g.id]} label={t(`label.hub.group.${g.id}`)} size="sm" />
            <span className="hub-sec-count"><span className="k-num">{g.mods.length}</span></span>
          </h2>
          <div className="hub-cards">
            {g.mods.map((m) => (
              <ModuleCard
                key={m.resource}
                mod={m}
                hasSettings={p.hasSettings(m)}
                selected={m.resource === p.selected}
                opening={p.opening}
                onOpen={p.onOpen}
                onSelect={p.onSelect}
                onSettings={p.onSettings}
                onStart={p.onStart}
              />
            ))}
          </div>
        </section>
      ))}
      {/* the built-in w_hud card shows at once; the rest of the list is still on its way */}
      {p.loading && list.length > 0 && <Skeleton rows={4} />}
    </div>
  );

  return (
    <div className="hub-root">
      {header}
      <SplitView
        className="hub-split"
        list={cards}
        drawer={sel && (
          <ScriptDrawer
            key={sel.resource}
            mod={sel}
            hasSettings={p.hasSettings(sel)}
            focus={p.focus}
            opening={p.opening}
            onOpen={p.onOpen}
            onSettings={p.onSettings}
            onStart={p.onStart}
            onClose={() => p.onSelect(null)}
          />
        )}
      />
    </div>
  );
}
