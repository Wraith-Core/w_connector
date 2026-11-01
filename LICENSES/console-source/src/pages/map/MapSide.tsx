/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/map/MapSide.tsx
 * The Map page's side panel (at the end of the reading line, beside the map):
 *   Players   search (name, citizen id, #session) · all / alive / dead · the list · the picked
 *             player's card with its actions (go to, bring, send back, revive, heal, fill needs,
 *             freeze), "follow" and "open their file"
 *   Places    towns, services and saved markers: a click flies the map there
 *   Tools     go to typed coordinates · the server map's look (every player's map)
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import type { HelpKey } from '../../help/types';
import { useI18n } from '../../i18n';
import {
  Button, CoordsInput, DataTable, EmptyState, Field, FilterChips, HelpTip, IconButton, KeyValue, KeyValueList, Section, Select,
  StatusChip, Tabs, TextInput, cls,
} from '../../kit';
import type { Column, CoordsValue } from '../../kit';
import type { Area } from '../../types';
import { matchPlace, matchRow, themesOf } from './model';
import type { MapRow, PlaceRow } from './model';

export type SideTab = 'players' | 'places' | 'tools';
type Filter = 'all' | 'alive' | 'dead';

interface Act {
  id: 'goto' | 'bring' | 'bringBack' | 'revive' | 'heal' | 'refill' | 'freeze';
  action: string;
  area: Area;
  help: HelpKey;
  noSelf?: boolean;
}
const ACTS: Act[] = [
  { id: 'goto', action: 'teleportTo', area: 'teleport', help: 'help.map.player.goto', noSelf: true },
  { id: 'bring', action: 'bring', area: 'teleport', help: 'help.map.player.bring', noSelf: true },
  { id: 'bringBack', action: 'bringBack', area: 'teleport', help: 'help.map.player.bringBack', noSelf: true },
  { id: 'revive', action: 'revive', area: 'revive', help: 'help.map.player.revive' },
  { id: 'heal', action: 'heal', area: 'revive', help: 'help.map.player.heal' },
  { id: 'refill', action: 'needs', area: 'needs', help: 'help.map.player.refill' },
  { id: 'freeze', action: 'freeze', area: 'players', help: 'help.map.player.freeze', noSelf: true },
];

export interface MapSideProps {
  tab: SideTab;
  onTab(t: SideTab): void;
  rows: MapRow[];
  places: PlaceRow[];
  selected: MapRow | null;
  follow: boolean;
  onFollow(on: boolean): void;
  onPlace(p: PlaceRow): void;
  onLocate(x: number, y: number): void;
  theme: string;
  onTheme(id: string): void;
  themeBusy: boolean;
}

function PlayerCard({ row, follow, onFollow }: { row: MapRow; follow: boolean; onFollow(on: boolean): void }) {
  const app = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const isSelf = row.id === app.selfId;
  const run = async (a: Act) => {
    if (busy) return;
    setBusy(a.id);
    const who = isSelf || !row.citizenid ? { id: row.id } : { citizenid: row.citizenid };
    const args = a.id === 'freeze' ? { state: !row.frozen } : a.id === 'refill' ? { hunger: 100, thirst: 100 } : {};
    try { await app.act('player', { ...who, action: a.action, args }, { okText: t('label.map.done') }); } finally { setBusy(null); }
  };
  const pos = `vector3(${row.x.toFixed(2)}, ${row.y.toFixed(2)}, ${(row.z ?? 0).toFixed(2)})`;
  return (
    <section className="mp-card" aria-label={t('label.map.selected')}>
      <header className="mp-card-head">
        <div className="mp-card-titles">
          <h3 className="mp-card-name">
            <span className="k-ellipsis">{row.charName}</span>
            <HelpTip help="help.map.selected" label={t('label.map.selected')} size="sm" />
          </h3>
          <div className="mp-card-ids">
            <span>{t('label.common.citizen.label')} <b className="k-num">{row.citizenid || '—'}</b></span>
            <span className="k-num">#{row.id}</span>
            {row.job && <span>{row.job}</span>}
          </div>
        </div>
        <IconButton icon="close" aria-label={t('label.map.deselect')} help="help.map.deselect" size="sm" onClick={() => app.select(null)} />
      </header>
      <div className="mp-card-chips">
        <StatusChip status={row.dead ? 'dead' : 'ok'} label={t(row.dead ? 'label.map.dead' : 'label.map.alive')} />
        {row.frozen && <StatusChip status="frozen" />}
        {isSelf && <span className="k-tag k-tag--faint">{t('label.map.selfTag')}</span>}
      </div>
      <KeyValueList>
        <KeyValue label={t('label.map.position')} help="help.map.position" value={`${row.x.toFixed(1)}, ${row.y.toFixed(1)}, ${(row.z ?? 0).toFixed(1)}`} copy={pos} ltr />
      </KeyValueList>
      <div className="mp-card-acts">
        {ACTS.map((a) => {
          const label = a.id === 'freeze' && row.frozen ? t('label.map.player.unfreeze') : t(`label.map.player.${a.id}`);
          const off = (a.noSelf && isSelf) || (a.id === 'bringBack' && !row.canReturn);
          return (
            <Button key={a.id} help={a.help} helpLabel={label} area={a.area} size="sm" block busy={busy === a.id} disabled={off || (!!busy && busy !== a.id)} onClick={() => { void run(a); }}>
              {label}
            </Button>
          );
        })}
      </div>
      <div className="mp-card-foot">
        <Button help="help.map.follow" kind={follow ? 'primary' : 'ghost'} size="sm" aria-pressed={follow} onClick={() => onFollow(!follow)}>
          {t(follow ? 'label.map.stopFollow' : 'label.map.follow')}
        </Button>
        <Button help="help.map.openPlayer" kind="link" area="players" onClick={() => app.navigate('players', { sel: String(row.id) })}>{t('label.map.openPlayer')}</Button>
      </div>
    </section>
  );
}

export default function MapSide(p: MapSideProps) {
  const app = useApp();
  const { t, lt } = useI18n();
  const [q, setQ] = useState('');
  const [qPlace, setQPlace] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [coords, setCoords] = useState<CoordsValue>({ x: null, y: null, z: null });

  const alive = p.rows.filter((r) => !r.dead).length;
  const shown = useMemo(() => p.rows.filter((r) => matchRow(r, q) && (filter === 'all' || (filter === 'dead' ? r.dead : !r.dead))), [p.rows, q, filter]);
  const placesShown = useMemo(() => p.places.filter((x) => matchPlace(x, qPlace)), [p.places, qPlace]);

  const columns = useMemo<Column<MapRow>[]>(() => [
    {
      key: 'cid', label: t('label.map.col.citizen'), help: 'help.map.colCitizen', sort: true, width: '6.5rem',
      value: (r) => (Number.isFinite(Number(r.citizenid)) ? Number(r.citizenid) : r.citizenid),
      render: (r) => (
        <>
          <span className="k-cell-main k-num">{r.citizenid || '—'}</span>
          <span className="k-cell-sub k-num">#{r.id}</span>
        </>
      ),
    },
    {
      key: 'name', label: t('label.map.col.name'), help: 'help.map.colName', sort: true, value: (r) => r.charName,
      render: (r) => (
        <>
          <span className="k-cell-main k-ellipsis">{r.charName}</span>
          <span className="k-cell-sub k-ellipsis">{r.job || r.account}</span>
        </>
      ),
    },
    {
      key: 'state', label: t('label.map.col.status'), help: 'help.map.colStatus', sort: true, value: (r) => (r.dead ? 0 : 1),
      render: (r) => <StatusChip status={r.dead ? 'dead' : 'ok'} label={t(r.dead ? 'label.map.dead' : 'label.map.alive')} />,
    },
  ], [t]);

  const placeCols = useMemo<Column<PlaceRow>[]>(() => [
    {
      key: 'place', label: t('label.map.col.place'), help: 'help.map.colPlace', sort: true, value: (r) => r.name,
      render: (r) => (
        <>
          <span className="k-cell-main k-ellipsis">{r.name}</span>
          <span className="k-cell-sub">{t(`label.map.kind.${r.kind}`)}</span>
        </>
      ),
    },
  ], [t]);

  const themes = themesOf(app.mapCfg);
  const themeLabel = (id: string, label?: { ar: string; en: string }) => {
    if (label) return lt(label);
    const k = `label.map.themeNames.${id}`;
    const s = t(k);
    return s === k ? id : s;
  };

  return (
    <aside className="mp-side" aria-label={t('label.map.tabs.label')}>
      <Tabs
        items={[
          { id: 'players', label: t('label.map.tabs.players'), help: 'help.map.tabPlayers', badge: p.rows.length },
          { id: 'places', label: t('label.map.tabs.places'), help: 'help.map.tabPlaces' },
          { id: 'tools', label: t('label.map.tabs.tools'), help: 'help.map.tabTools' },
        ]}
        value={p.tab}
        onChange={p.onTab}
        label={t('label.map.tabs.label')}
        className="mp-tabs"
      />

      {p.tab === 'players' && (
        <>
          <div className="mp-filters">
            <TextInput icon="search" value={q} onChange={setQ} clearable placeholder={t('label.map.search')} label={t('label.map.search')} help="help.map.search" />
            <FilterChips
              items={[
                { id: 'all', label: t('label.map.filter.all'), count: p.rows.length, help: 'help.map.filterAll' },
                { id: 'alive', label: t('label.map.filter.alive'), count: alive, help: 'help.map.filterAlive' },
                { id: 'dead', label: t('label.map.filter.dead'), count: p.rows.length - alive, help: 'help.map.filterDead' },
              ]}
              value={filter}
              onChange={setFilter}
              label={t('label.map.filter.label')}
            />
          </div>
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            label={t('label.map.tabs.players')}
            selectedKey={app.selectedId}
            onSelect={(r) => app.select(r.id === app.selectedId ? null : r.id)}
            density="compact"
            className="mp-table"
            rowClass={(r) => cls(r.dead && 'is-dead', r.id === app.selfId && 'is-self') || undefined}
            empty={<EmptyState text={t('label.map.noPlayers')} />}
          />
          {p.selected
            ? <PlayerCard row={p.selected} follow={p.follow} onFollow={p.onFollow} />
            : <p className="mp-hint">{t('label.map.pickHint')}</p>}
        </>
      )}

      {p.tab === 'places' && (
        <>
          <div className="mp-filters">
            <TextInput icon="search" value={qPlace} onChange={setQPlace} clearable placeholder={t('label.map.searchPlaces')} label={t('label.map.searchPlaces')} help="help.map.search" />
          </div>
          <DataTable
            columns={placeCols}
            rows={placesShown}
            rowKey={(r) => r.key}
            label={t('label.map.tabs.places')}
            onSelect={p.onPlace}
            density="compact"
            className="mp-table"
            empty={<EmptyState text={t('label.map.noPlaces')} />}
          />
        </>
      )}

      {p.tab === 'tools' && (
        <div className="mp-tools">
          <Section title={t('label.map.findCoords')} help="help.map.findCoords" tone="plain">
            <CoordsInput value={coords} onChange={setCoords} label={t('label.map.findCoords')} help="help.common.coords" />
            <Button
              help="help.map.locate"
              size="sm"
              disabled={coords.x === null || coords.y === null}
              onClick={() => { if (coords.x !== null && coords.y !== null) p.onLocate(coords.x, coords.y); }}
            >
              {t('label.map.locate')}
            </Button>
          </Section>
          <div className="mp-tools-block">
            <Field label={t('label.map.theme')} help="help.map.theme" area="server">
              <Select
                value={p.theme}
                onChange={p.onTheme}
                disabled={p.themeBusy}
                options={themes.map((x) => ({ value: x.id, label: themeLabel(x.id, x.label) }))}
              />
            </Field>
          </div>
        </div>
      )}
    </aside>
  );
}
