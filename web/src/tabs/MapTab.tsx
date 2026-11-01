import { useEffect, useMemo, useState } from 'react';
import MapView, { type MapFocus, type MapPlayer } from '../map/MapView';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import { Button, Empty, Field, Input, NumberInput, Select } from '../ui/controls';
import Glyph from '../ui/Glyph';
import { cls } from '../ui/util';

const THEMES = ['light', 'dark', 'ember', 'blueprint', 'bone'];
export default function MapTab() {
  const { t, lang, strings } = useI18n();
  const { mapCfg, mapData, mapPlayers, mapPlayersSeen, players, selfId, selectedId, select, act, can, refresh } = useApp();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('players');
  const [status, setStatus] = useState('all');
  const [theme, setTheme] = useState(mapCfg?.theme ?? 'light');
  const [showPlaces, setShowPlaces] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [follow, setFollow] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (mapCfg?.theme) setTheme(mapCfg.theme); }, [mapCfg?.theme]);
  useEffect(() => { setFollow(false); }, [selectedId]);

  const list = useMemo<MapPlayer[]>(() => mapPlayersSeen ? mapPlayers : players.filter((p) => p.coords).map((p) => ({
    id: p.id, name: p.name, ...p.coords, job: p.job?.label, dead: p.dead,
  })), [mapPlayers, mapPlayersSeen, players]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(() => list.filter((p) => (section !== 'players' || !needle || `${p.id} ${p.name} ${p.job ?? ''}`.toLocaleLowerCase().includes(needle))
    && (status === 'all' || (status === 'dead' ? p.dead : !p.dead))), [list, needle, section, status]);
  useEffect(() => {
    if (mapPlayersSeen && selectedId !== null && !shown.some((p) => p.id === selectedId)) select(null);
  }, [shown, mapPlayersSeen, selectedId, select]);
  const locations = useMemo(() => [
    ...mapData.places.map((p) => ({ ...p, key: `place:${p.id}`, category: t('ui_map_services') })),
    ...mapData.markers.map((p) => ({ ...p, key: `saved:${p.id}`, category: t('ui_map_saved') })),
    ...mapData.labels.filter((l) => !l.hidden).map((l, i) => ({ x: l.x, y: l.y, name: (lang === 'ar' && l.ar) || l.en, key: `name:${l.key ?? i}`, category: t('ui_map_names') })),
  ].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!needle || `${p.name} ${p.category}`.toLocaleLowerCase().includes(needle))), [mapData, lang, needle, t]);
  const selected = list.find((p) => p.id === selectedId);
  const selectedPlayer = players.find((p) => p.id === selectedId);
  const cfg = useMemo(() => mapCfg ? { ...mapCfg, theme } : null, [mapCfg, theme]);

  const run = async (action: string, args: unknown = {}) => {
    if (!selected || busy) return;
    setBusy(action);
    try { await act('player', { id: selected.id, action, args }, { okText: t('ui_done') }); }
    finally { setBusy(null); }
  };
  const teleport = (world: { x: number; y: number }, target: 'self' | number) => {
    void act('map', { action: 'teleport', ...world, target }, { okText: t('ui_done') });
  };
  const themeChange = async (value: string) => {
    const result = await act('map', { action: 'setTheme', theme: value });
    if (result.ok) setTheme(value);
  };

  return <div className="wa-mapworkspace">
    <div className="wa-maptoolbar">
      <div className="wa-row">
        <Button size="sm" kind="ghost" glyph="refresh" onClick={() => refresh('map')}>{t('ui_refresh')}</Button>
        <Button size="sm" kind={showPlaces ? 'plate' : 'ghost'} aria-pressed={showPlaces} onClick={() => setShowPlaces(!showPlaces)}>{t('ui_map_services')}</Button>
        <Button size="sm" kind={showLabels ? 'plate' : 'ghost'} aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>{t('ui_map_names')}</Button>
      </div>
      <span className="wa-dim">{shown.length} / {list.length} · {t('ui_tab_players')}</span>
    </div>
    <div className="wa-mapwrap">
      <div className="wa-mapview">
        {cfg ? <MapView cfg={cfg} players={shown} data={mapData} selfId={selfId} selfPlayer={list.find((p) => p.id === selfId)} selectedId={selectedId} onSelect={select}
          onTeleport={teleport} canTeleport={can('teleport')} locale={lang} strings={strings}
          onPointAction={async (action, world) => (await act('map', { action, ...world })).ok}
          showPlaces={showPlaces} showLabels={showLabels} follow={follow} onStopFollow={() => setFollow(false)} focus={focus}
          className="wa-mapview-engine" /> : <Empty text={t('ui_map_no_cfg')} glyph="map" />}
      </div>
      <aside className="wa-mapside">
        <div className="wa-seg" role="tablist" aria-label={t('ui_tab_map')}>
          {['players', 'places'].map((key) => <button role="tab" aria-selected={section === key} className={cls('wa-seg-btn', section === key && 'is-on')} key={key} onClick={() => { setSection(key); setQuery(''); }}>{t(`ui_map_${key}`)}</button>)}
        </div>
        <Input glyph="search" value={query} onChange={setQuery} aria-label={t('ui_map_search')} placeholder={t('ui_map_search')} />
        {section === 'players' && <Select aria-label={t('ui_map_status')} value={status} onChange={setStatus} options={['all', 'alive', 'dead'].map((s) => ({ value: s, label: t(s === 'all' ? 'ui_map_all_players' : `ui_${s}`) }))} />}
        <div className="wa-maplist">
          {section === 'players' ? (shown.length ? shown.map((p) => <button type="button" key={p.id} aria-pressed={selectedId === p.id} className={cls('wa-maprow', selectedId === p.id && 'is-on', p.dead && 'is-dead')} onClick={() => select(selectedId === p.id ? null : p.id)}>
            <b dir="ltr">{p.id}</b><span className="wa-maprow-name">{p.dead && <Glyph name="skull" />}{p.name}</span><span className="wa-maprow-job">{p.job}</span>
          </button>) : <Empty text={t('ui_map_no_players')} />) : (locations.length ? locations.map((p) => <button type="button" className="wa-location-row" key={p.key} onClick={() => { setFollow(false); setFocus({ x: p.x, y: p.y, name: p.name, request: performance.now() }); }}>
            <Glyph name="pin" /><span>{p.name}<small>{p.category}</small></span><Glyph name="arrow" />
          </button>) : <Empty text={t('ui_map_no_places')} />)}
        </div>
        {selected && section === 'players' && <div className="wa-mapsel">
          <div className="wa-mapside-head"><strong>{selected.name}</strong><button title={t('map.deselect')} onClick={() => select(null)}><Glyph name="close" /></button></div>
          <div className="wa-dim" dir="ltr">{selected.x.toFixed(1)}, {selected.y.toFixed(1)}, {(selected.z ?? 0).toFixed(1)}</div>
          <div className="wa-mapactions">
            <Button size="sm" kind={follow ? 'plate' : 'ghost'} aria-pressed={follow} onClick={() => setFollow(!follow)}>{t(follow ? 'ui_map_stop_follow' : 'ui_map_follow')}</Button>
            {can('teleport') && selected.id !== selfId && <>
              <Button size="sm" disabled={!!busy} onClick={() => void run('teleportTo')}>{t('ui_a_goto')}</Button>
              <Button size="sm" disabled={!!busy} onClick={() => void run('bring')}>{t('ui_a_bring')}</Button>
              <Button size="sm" kind="ghost" disabled={!!busy || !selectedPlayer?.canReturn} onClick={() => void run('bringBack')}>{t('ui_a_bring_back')}</Button>
            </>}
            {can('revive') && <>
              <Button size="sm" glyph="heart" disabled={!!busy} onClick={() => void run('revive')}>{t('ui_a_revive')}</Button>
              <Button size="sm" kind="ghost" disabled={!!busy} onClick={() => void run('heal')}>{t('ui_a_heal')}</Button>
            </>}
            {can('needs') && <Button size="sm" kind="ghost" disabled={!!busy} onClick={() => void run('needs', { hunger: 100, thirst: 100 })}>{t('ui_a_refill')}</Button>}
            {can('players') && selected.id !== selfId && <Button size="sm" kind="ghost" disabled={!!busy} onClick={() => void run('freeze', { state: !selectedPlayer?.frozen })}>{t(selectedPlayer?.frozen ? 'ui_a_unfreeze' : 'ui_a_freeze')}</Button>}
          </div>
        </div>}
        <details className="wa-map-coordinate-form">
          <summary>{t('ui_map_find_coords')}</summary>
          <div className="wa-row">
            <Field label="X"><NumberInput value={point.x} onChange={(x) => setPoint({ ...point, x })} min={-10000} max={10000} /></Field>
            <Field label="Y"><NumberInput value={point.y} onChange={(y) => setPoint({ ...point, y })} min={-10000} max={10000} /></Field>
            <Button size="sm" onClick={() => { setFollow(false); setFocus({ ...point, request: performance.now() }); }}>{t('ui_map_locate')}</Button>
          </div>
        </details>
        <div className="wa-mapside-foot">
          <Field label={t('ui_map_theme')}><Select value={theme} onChange={themeChange} disabled={!can('server')} options={THEMES.map((key) => ({ value: key, label: t(`ui_map_theme_${key}`) }))} /></Field>
        </div>
      </aside>
    </div>
  </div>;
}
