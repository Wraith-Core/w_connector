/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/map/MapPage.tsx  ("الخريطة" / Map)
 * w_map's paper with every player on it, live. A compact toolbar above the map (zoom, whole map,
 * my position, the services / names layers, refresh, clear destination, the cursor's coordinates),
 * the side panel beside it (players, places, tools), and the clicked-point card on the map.
 * The themes come from mapCfg (B13); picking one changes w_map's look for every player (area server).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, EmptyState, HelpTip, IconButton, Toolbar, cls } from '../../kit';
import MapCanvas from '../../map/MapCanvas';
import type { CanvasPlayer, MapFocus, MapHandle, PointAction } from '../../map/MapCanvas';
import { post } from '../../nui';
import MapSide from './MapSide';
import type { SideTab } from './MapSide';
import { mapRows, placeRows } from './model';
import type { PlaceRow } from './model';
import './map-page.css';

/** A layer switch: the word, and a filled / hollow square that says on / off (never colour alone) */
function Layer({ on, onChange, label, help }: { on: boolean; onChange(v: boolean): void; label: string; help: 'help.map.places' | 'help.map.labels' }) {
  return (
    <Button help={help} helpLabel={label} kind="ghost" size="sm" aria-pressed={on} className={cls('mp-layer', on && 'is-on')} onClick={() => onChange(!on)}>
      <i className={on ? 'k-shape-sq' : 'k-shape-hollow'} aria-hidden="true" />
      {label}
    </Button>
  );
}

export default function MapPage(_: PageProps) {
  const app = useApp();
  const { t, lang } = useI18n();
  const map = useRef<MapHandle>(null);
  const cursor = useRef<HTMLSpanElement>(null);
  const [tab, setTab] = useState<SideTab>('players');
  const [showPlaces, setShowPlaces] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [follow, setFollow] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [theme, setTheme] = useState(app.mapCfg?.theme || 'light');
  const [themeBusy, setThemeBusy] = useState(false);

  useEffect(() => { if (app.mapCfg?.theme) setTheme(app.mapCfg.theme); }, [app.mapCfg?.theme]);
  useEffect(() => { setFollow(false); }, [app.selectedId]);

  const rows = useMemo(() => mapRows(app.mapPlayers, app.mapPlayersSeen, app.players), [app.mapPlayers, app.mapPlayersSeen, app.players]);
  const places = useMemo(() => placeRows(app.mapData, lang), [app.mapData, lang]);
  const selected = rows.find((r) => r.id === app.selectedId) ?? null;
  const me = rows.find((r) => r.id === app.selfId) ?? null;

  /* a player the list no longer has (left, or not on the map) drops the selection */
  useEffect(() => {
    if (app.mapPlayersSeen && app.selectedId !== null && !rows.some((r) => r.id === app.selectedId)) app.select(null);
  }, [rows, app.mapPlayersSeen, app.selectedId, app.select]);

  const markers = useMemo<CanvasPlayer[]>(() => rows.map((r) => ({
    id: r.id, x: r.x, y: r.y, z: r.z, dead: r.dead,
    label: r.citizenid ? `${r.charName} · ${r.citizenid}` : `${r.charName} · #${r.id}`,
  })), [rows]);

  const stopFollow = useCallback(() => setFollow(false), []);
  const onTeleport = (world: { x: number; y: number }, target: 'self' | 'selected') => {
    const to = target === 'self' ? 'self' : selected?.id;
    if (to === undefined) return;
    void app.act('map', { action: 'teleport', x: world.x, y: world.y, target: to }, { okText: t('label.map.done') });
  };
  const onPoint = async (action: PointAction, pt?: { x: number; y: number }) =>
    (await app.act('map', { action, ...(pt ?? {}) }, { okText: t('label.map.done') })).ok;
  const onPlace = (p: PlaceRow) => { setFollow(false); setFocus({ x: p.x, y: p.y, name: p.name, request: performance.now() }); };
  const onLocate = (x: number, y: number) => { setFollow(false); setFocus({ x, y, request: performance.now() }); };
  const onTheme = async (id: string) => {
    if (id === theme || themeBusy) return;
    setThemeBusy(true);
    /* w_map saves the look and Lua answers with its own toast (no second one here) */
    try { if ((await app.act('map', { action: 'setTheme', theme: id })).ok) setTheme(id); } finally { setThemeBusy(false); }
  };
  const refresh = () => { app.refresh('map'); void post('map', { action: 'players' }); };

  const cfg = app.mapCfg;
  return (
    <div className="mp-root">
      <div className="mp-main">
        <Toolbar className="mp-toolbar">
          <span className="mp-group">
            <IconButton icon="plus" kind="secondary" aria-label={t('label.map.zoomIn')} help="help.map.zoomIn" onClick={() => map.current?.zoomBy(1)} disabled={!cfg} />
            <IconButton icon="minus" kind="secondary" aria-label={t('label.map.zoomOut')} help="help.map.zoomOut" onClick={() => map.current?.zoomBy(-1)} disabled={!cfg} />
          </span>
          <Button help="help.map.fit" kind="ghost" size="sm" onClick={() => map.current?.fitAll()} disabled={!cfg}>{t('label.map.fit')}</Button>
          <Button help="help.map.me" kind="ghost" size="sm" onClick={() => { if (me) map.current?.centreOn(me.x, me.y, 5); }} disabled={!cfg || !me}>{t('label.map.me')}</Button>
          <span className="mp-sep" aria-hidden="true" />
          <Layer on={showPlaces} onChange={setShowPlaces} label={t('label.map.places')} help="help.map.places" />
          <Layer on={showLabels} onChange={setShowLabels} label={t('label.map.labels')} help="help.map.labels" />
          <span className="mp-sep" aria-hidden="true" />
          <Button help="help.map.refresh" kind="ghost" size="sm" icon="refresh" onClick={refresh}>{t('label.map.refresh')}</Button>
          {app.mapData.waypoint && (
            <Button help="help.map.clearWaypoint" kind="ghost" size="sm" onClick={() => { void onPoint('clearWaypoint'); }}>{t('label.map.clearWaypoint')}</Button>
          )}
          <span className="mp-cursor">
            <span ref={cursor} className="k-num">X — · Y —</span>
            <HelpTip help="help.map.cursor" label={t('label.map.position')} size="sm" />
          </span>
        </Toolbar>
        <div className="mp-canvas">
          {cfg ? (
            <MapCanvas
              ref={map}
              cfg={cfg}
              theme={theme}
              players={markers}
              data={app.mapData}
              selfId={app.selfId}
              selectedId={app.selectedId}
              onSelect={(id) => { app.select(id); if (id !== null) setTab('players'); }}
              showPlaces={showPlaces}
              showLabels={showLabels}
              follow={follow}
              onStopFollow={stopFollow}
              followName={selected?.charName}
              focus={focus}
              cursorRef={cursor}
              canTeleport={app.can('teleport')}
              bringName={selected && selected.id !== app.selfId ? selected.charName : undefined}
              onTeleport={onTeleport}
              onPointAction={onPoint}
            />
          ) : (
            <EmptyState
              text={t('label.map.noCfg')}
              next={<Button help="help.map.refresh" size="sm" icon="refresh" onClick={refresh}>{t('label.map.refresh')}</Button>}
            />
          )}
        </div>
      </div>
      <MapSide
        tab={tab}
        onTab={setTab}
        rows={rows}
        places={places}
        selected={selected}
        follow={follow}
        onFollow={setFollow}
        onPlace={onPlace}
        onLocate={onLocate}
        theme={theme}
        onTheme={(id) => { void onTheme(id); }}
        themeBusy={themeBusy}
      />
    </div>
  );
}
