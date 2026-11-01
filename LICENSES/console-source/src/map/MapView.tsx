import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MapEngine, type EngineTiles, type Marker } from './engine/MapEngine';
import { normaliseProjection } from './engine/coords';
import './map.css';

export interface ProjectionCfg { [k: string]: unknown }
export interface TilesCfg { [k: string]: unknown }
export interface MapCfg { tilesBase: string; theme: string; projection: ProjectionCfg; tiles: TilesCfg }
export interface MapPlayer { id: number; name: string; x: number; y: number; z?: number; job?: string; dead?: boolean }
export interface MapPlace { id: string | number; x: number; y: number; z?: number; name: string; res?: string; sprite?: string; desc?: string }
export interface MapLabel { key?: string; x: number; y: number; en: string; ar?: string; kind?: string; h?: number; hidden?: boolean }
export interface MapData { places: MapPlace[]; labels: MapLabel[]; markers: MapPlace[]; waypoint?: { x: number; y: number } | null }
export interface MapFocus { x: number; y: number; name?: string; request: number }
export interface MapViewProps {
  cfg: MapCfg;
  players: MapPlayer[];
  data: MapData;
  selfId: number;
  selfPlayer?: MapPlayer;
  selectedId: number | null;
  onSelect(id: number | null): void;
  onTeleport(world: { x: number; y: number }, target: 'self' | number): void;
  onPointAction(action: 'waypoint' | 'copyCoords' | 'clearWaypoint', point?: { x: number; y: number }): Promise<boolean>;
  canTeleport: boolean;
  locale: 'ar' | 'en';
  strings: Record<string, string>;
  showPlaces: boolean;
  showLabels: boolean;
  follow: boolean;
  onStopFollow(): void;
  focus: MapFocus | null;
  className?: string;
}

const numeric = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function tilesOf(cfg: MapCfg): EngineTiles {
  const t = cfg.tiles ?? {};
  if (t.grid === true) return { base: 'grid:', theme: 'dark', size: 512, minZoom: 1, maxZoom: 7, maxView: 7 };
  const theme = cfg.theme || 'light';
  const set = theme === 'light' ? 'clean' : theme;
  const styles = (t.styles ?? {}) as Record<string, string>;
  const root = (cfg.tilesBase || 'nui://w_map/web/tiles').replace(/\/+$/, '');
  return { base: styles[set] || `${root}/${set}/{z}/{x}/{y}.webp`, theme,
    size: numeric(t.size, 512), minZoom: numeric(t.minZoom, 2), maxZoom: numeric(t.maxZoom, 7),
    maxView: numeric(t.maxView, numeric(t.maxZoom, 7) + 0.6) };
}

export default function MapView(props: MapViewProps) {
  const { cfg, players, data, selfId, selectedId, onSelect, onTeleport, onPointAction, canTeleport,
    locale, strings, showPlaces, showLabels, follow, onStopFollow, focus, className } = props;
  const t = useCallback((key: string) => strings[key] || key, [strings]);
  const hostRef = useRef<HTMLDivElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState<{ x: number; y: number; name?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef({ selectedId, onSelect });
  live.current = { selectedId, onSelect };
  const tiles = useMemo(() => tilesOf(cfg), [cfg]);
  const projection = useMemo(() => normaliseProjection(cfg.projection), [cfg.projection]);
  const identity = `${JSON.stringify(projection)}|${tiles.size}|${tiles.minZoom}|${tiles.maxZoom}|${tiles.maxView}`;

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const eng = new MapEngine(hostRef.current, tiles, projection, {
      onHover: () => {},
      onClick: (world, marker, button) => {
        if (button === 2) { setCard(null); return; }
        if (marker?.kind === 'player') {
          setCard(null);
          live.current.onSelect(marker.id === live.current.selectedId ? null : marker.id);
        } else {
          setCard({ x: marker?.x ?? world[0], y: marker?.y ?? world[1], name: marker?.name });
        }
      },
    });
    engine.current = eng;
    eng.fitAll(false);
    setReady(true);
    return () => { eng.destroy(); engine.current = null; setReady(false); };
    // Only projection and zoom bounds change engine identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => { engine.current?.setTiles(tiles.base, tiles.theme); }, [tiles.base, tiles.theme, ready]);

  useEffect(() => {
    const markers: Marker[] = players.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({
      key: `p:${p.id}`, kind: 'player', id: p.id, x: p.x, y: p.y,
      name: `${p.name} [${p.id}]${p.dead ? ` · ${t('ui_dead')}` : ''}`,
      cls: `${p.id === selfId ? 'is-self' : ''} ${p.id === selectedId ? 'is-selected' : ''} ${p.dead ? 'is-dead' : ''}`,
      z: p.id === selectedId ? 30 : 25,
    }));
    if (showPlaces) {
      for (const [kind, places] of [['place', data.places], ['saved', data.markers]] as const) {
        places.forEach((p) => {
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) markers.push({ key: `${kind}:${p.id}`, kind: 'place', id: 0,
            x: p.x, y: p.y, name: p.name, cls: 'is-place', z: 10 });
        });
      }
    }
    if (showLabels) data.labels.forEach((l, i) => {
      if (l.hidden || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
      markers.push({ key: `label:${l.key ?? i}`, kind: 'label', id: 0, x: l.x, y: l.y,
        name: (locale === 'ar' && l.ar) || l.en, cls: 'is-label', z: 2, minZoom: (l.h ?? 24) >= 38 ? 2.5 : 4.5 });
    });
    if (data.waypoint) markers.push({ key: 'waypoint', kind: 'place', id: 0, ...data.waypoint,
      name: t('ui_map_waypoint'), cls: 'is-waypoint', z: 20 });
    engine.current?.setMarkers(markers);
  }, [players, selfId, selectedId, data, showPlaces, showLabels, locale, t, ready]);

  const selected = players.find((p) => p.id === selectedId);
  const self = props.selfPlayer;
  const lastSelection = useRef<number | null>(null);
  useEffect(() => {
    if (!engine.current || !selected) { lastSelection.current = null; return; }
    if (selected.id !== lastSelection.current || follow) {
      engine.current.centreOn(selected.x, selected.y, Math.max(engine.current.getZoom(), 5), true);
      lastSelection.current = selected.id;
    }
  }, [selected?.id, selected?.x, selected?.y, follow, ready]);

  useEffect(() => {
    if (!focus) return;
    engine.current?.centreOn(focus.x, focus.y, 5.5, true);
    setCard({ x: focus.x, y: focus.y, name: focus.name });
  }, [focus, ready]);

  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!engine.current || !coordsRef.current || !hostRef.current) return;
    const rect = hostRef.current.getBoundingClientRect();
    const [x, y] = engine.current.screenToGame(ev.clientX - rect.left, ev.clientY - rect.top);
    coordsRef.current.textContent = `X ${x.toFixed(1)}   Y ${y.toFixed(1)}`;
  };
  const panKey = (key: string) => ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[key as 'ArrowUp'];
  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('input, select, textarea, button')) return;
    if (ev.key === 'Escape' && card) { ev.stopPropagation(); setCard(null); return; }
    if (ev.key === '+' || ev.key === '=') engine.current?.zoomBy(0.5);
    else if (ev.key === '-') engine.current?.zoomBy(-0.5);
    else if (panKey(ev.key)) { onStopFollow(); engine.current?.setPanKey(panKey(ev.key), true); }
    else return;
    ev.preventDefault(); ev.stopPropagation();
  };
  const pointAction = async (action: 'waypoint' | 'copyCoords' | 'clearWaypoint') => {
    setBusy(true);
    try { await onPointAction(action, card ?? undefined); } finally { setBusy(false); }
  };

  return <div ref={hostRef} className={`wa-map theme-${cfg.theme} ${locale === 'ar' ? 'is-rtl' : ''} ${className ?? ''}`}
    dir={locale === 'ar' ? 'rtl' : 'ltr'} tabIndex={0} aria-label={t('ui_tab_map')} onPointerMove={onMove}
    onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('.wa-map-ui')) onStopFollow(); }}
    onKeyDown={onKey} onKeyUp={(e) => { if (panKey(e.key)) engine.current?.setPanKey(panKey(e.key), false); }}
    onBlur={() => engine.current?.resetInput()}>
    <div className="wa-map-ui wa-map-ctl" role="group" aria-label={t('ui_tab_map')}>
      <button className="wa-map-btn" title={t('map.zoom_in')} onClick={() => engine.current?.zoomBy(1)}>+</button>
      <button className="wa-map-btn" title={t('map.zoom_out')} onClick={() => engine.current?.zoomBy(-1)}>−</button>
      <button className="wa-map-btn wa-map-btn--text" onClick={() => { onStopFollow(); engine.current?.fitAll(true); }}>{t('map.fit')}</button>
      {self && <button className="wa-map-btn wa-map-btn--text" onClick={() => { onStopFollow(); engine.current?.centreOn(self.x, self.y, 5, true); }}>{t('map.you')}</button>}
    </div>
    <div ref={coordsRef} className="wa-map-ui wa-map-coords" dir="ltr" />
    <div className="wa-map-ui wa-map-legend"><span className="legend-player">{t('ui_tab_players')}</span><span className="legend-dead">{t('ui_dead')}</span><span className="legend-place">{t('ui_map_places')}</span></div>
    {follow && selected && <div className="wa-map-ui wa-map-tracking">{t('ui_map_following')} · {selected.name}</div>}
    {data.waypoint && <button disabled={busy} className="wa-map-ui wa-map-clear wa-map-btn wa-map-btn--text" onClick={() => void pointAction('clearWaypoint')}>{t('ui_map_clear_waypoint')}</button>}
    {card && <div className="wa-map-ui wa-map-card wa-map-card--docked">
      <div className="wa-map-card-box">
        <div className="wa-map-card-title"><span>{card.name || t('ui_map_point')}</span><button title={t('ui_close')} onClick={() => setCard(null)}>×</button></div>
        <div className="wa-map-card-head" dir="ltr">X {card.x.toFixed(2)} · Y {card.y.toFixed(2)}</div>
        <button disabled={busy} className="wa-map-btn wa-map-btn--row" onClick={() => void pointAction('waypoint')}>{t('ui_map_set_waypoint')}</button>
        <button disabled={busy} className="wa-map-btn wa-map-btn--row" onClick={() => void pointAction('copyCoords')}>{t('ui_self_copy_coords')}</button>
        {canTeleport && <button className="wa-map-btn wa-map-btn--row" onClick={() => onTeleport(card, 'self')}>{t('map.teleport_here')}</button>}
        {canTeleport && selected && selected.id !== selfId && <button className="wa-map-btn wa-map-btn--row" onClick={() => onTeleport(card, selected.id)}>{t('map.bring_here').replace('%s', selected.name)}</button>}
      </div>
    </div>}
  </div>;
}
