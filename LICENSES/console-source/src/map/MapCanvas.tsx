/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · map/MapCanvas.tsx
 * The live map of the Map page: w_map's engine (engine/*, unchanged) with the markers, and three
 * small overlays on the paper: the "following" tag, the shapes legend and the clicked-point card.
 * The zoom / fit / "me" buttons live in the page's toolbar and reach the engine through the ref:
 *   const map = useRef<MapHandle>(null);  map.current?.zoomBy(1)
 * Every overlay carries .wa-map-ui so the engine leaves its clicks alone.
 * (map/MapView.tsx + map.css are the old tab's copy; the Integrate step deletes them.)
 * ════════════════════════════════════════════════════════════════════════════ */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useI18n } from '../i18n';
import { Button, HelpTip, IconButton, cls } from '../kit';
import type { MapCfg, MapData } from '../types';
import { MapEngine, paperOf } from './engine/MapEngine';
import type { EngineTiles, Marker } from './engine/MapEngine';
import { normaliseProjection } from './engine/coords';
import './canvas.css';

export interface CanvasPlayer {
  id: number;
  x: number;
  y: number;
  z?: number;
  dead?: boolean;
  /** the marker's name plate ("سالم الحربي · 5") */
  label: string;
}

export interface MapFocus { x: number; y: number; name?: string; request: number }

export interface MapHandle {
  zoomBy(delta: number): void;
  fitAll(): void;
  centreOn(x: number, y: number, zoom?: number): void;
}

export type PointAction = 'waypoint' | 'copyCoords' | 'clearWaypoint';

export interface MapCanvasProps {
  cfg: MapCfg;
  /** the tile set shown (mapCfg.theme, or the one just picked) */
  theme: string;
  players: CanvasPlayer[];
  data: MapData;
  selfId: number;
  selectedId: number | null;
  onSelect(id: number | null): void;
  showPlaces: boolean;
  showLabels: boolean;
  follow: boolean;
  onStopFollow(): void;
  /** the name in the "following" tag */
  followName?: string;
  focus: MapFocus | null;
  /** written on every pointer move without a re-render: "X -175.3 · Y 626.8" */
  cursorRef?: RefObject<HTMLElement>;
  canTeleport: boolean;
  /** the picked player's name for "Move … here" (none: the button is hidden) */
  bringName?: string;
  onTeleport(world: { x: number; y: number }, target: 'self' | 'selected'): void;
  onPointAction(action: PointAction, point?: { x: number; y: number }): Promise<boolean>;
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function tilesOf(cfg: MapCfg, theme: string): EngineTiles {
  const t = (cfg.tiles ?? {}) as Record<string, unknown>;
  const set = theme === 'light' ? 'clean' : theme;
  const styles = (t.styles ?? {}) as Record<string, string>;
  const root = (cfg.tilesBase || 'nui://w_map/web/tiles').replace(/\/+$/, '');
  return {
    base: styles[set] || `${root}/${set}/{z}/{x}/{y}.webp`,
    theme,
    size: num(t.size, 512),
    minZoom: num(t.minZoom, 2),
    maxZoom: num(t.maxZoom, 7),
    maxView: num(t.maxView, num(t.maxZoom, 7) + 0.6),
  };
}

const PAN: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas(props, ref) {
  const {
    cfg, theme, players, data, selfId, selectedId, onSelect, showPlaces, showLabels, follow, onStopFollow, followName,
    focus, cursorRef, canTeleport, bringName, onTeleport, onPointAction,
  } = props;
  const { t, lang, rtl } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState<{ x: number; y: number; name?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef({ selectedId, onSelect });
  live.current = { selectedId, onSelect };

  const tiles = useMemo(() => tilesOf(cfg, theme), [cfg, theme]);
  const projection = useMemo(() => normaliseProjection(cfg.projection), [cfg.projection]);
  const identity = `${JSON.stringify(projection)}|${tiles.size}|${tiles.minZoom}|${tiles.maxZoom}|${tiles.maxView}`;

  useImperativeHandle(ref, () => ({
    zoomBy: (d) => engine.current?.zoomBy(d),
    fitAll: () => { onStopFollow(); engine.current?.fitAll(true); },
    centreOn: (x, y, zoom) => { onStopFollow(); engine.current?.centreOn(x, y, zoom ?? Math.max(engine.current.getZoom(), 5), true); },
  }), [onStopFollow]);

  useLayoutEffect(() => {
    if (!hostRef.current) return undefined;
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
    // only the projection and the zoom bounds rebuild the engine; a theme swaps its tiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => { engine.current?.setTiles(tiles.base, tiles.theme); }, [tiles.base, tiles.theme, ready]);

  useEffect(() => {
    const markers: Marker[] = [];
    for (const p of players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const self = p.id === selfId;
      const sel = p.id === selectedId;
      markers.push({
        key: `p:${p.id}`, kind: 'player', id: p.id, x: p.x, y: p.y,
        name: `${p.label}${p.dead ? ` · ${t('label.map.dead')}` : ''}`,
        cls: cls(self && 'is-self', sel && 'is-selected', p.dead && 'is-dead') || '',
        z: sel ? 30 : self ? 26 : p.dead ? 8 : 25,
      });
    }
    if (showPlaces) {
      for (const [kind, places] of [['place', data.places], ['saved', data.markers]] as const) {
        for (const p of places) {
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
            markers.push({ key: `${kind}:${p.id}`, kind: 'place', id: 0, x: p.x, y: p.y, name: p.name, cls: kind === 'saved' ? 'is-place is-saved' : 'is-place', z: 10 });
          }
        }
      }
    }
    if (showLabels) {
      data.labels.forEach((l, i) => {
        if (l.hidden || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
        markers.push({
          key: `label:${l.key ?? i}`, kind: 'label', id: 0, x: l.x, y: l.y,
          name: (lang === 'ar' && l.ar) || l.en, cls: 'is-label', z: 2, minZoom: (l.h ?? 24) >= 38 ? 2.5 : 4.5,
        });
      });
    }
    if (data.waypoint) {
      markers.push({ key: 'waypoint', kind: 'place', id: 0, x: data.waypoint.x, y: data.waypoint.y, name: t('label.map.destination'), cls: 'is-waypoint', z: 20 });
    }
    engine.current?.setMarkers(markers);
  }, [players, selfId, selectedId, data, showPlaces, showLabels, lang, t, ready]);

  /* the picked player: centre once when picked, and keep centring while following */
  const selected = players.find((p) => p.id === selectedId);
  const lastPick = useRef<number | null>(null);
  useEffect(() => {
    const eng = engine.current;
    if (!eng || !selected) { lastPick.current = null; return; }
    if (selected.id !== lastPick.current || follow) {
      eng.centreOn(selected.x, selected.y, Math.max(eng.getZoom(), 5), true);
      lastPick.current = selected.id;
    }
  }, [selected?.id, selected?.x, selected?.y, follow, ready]);

  useEffect(() => {
    if (!focus) return;
    engine.current?.centreOn(focus.x, focus.y, 5.5, true);
    setCard({ x: focus.x, y: focus.y, name: focus.name });
  }, [focus, ready]);

  const onMove = (ev: PointerEvent<HTMLDivElement>) => {
    const out = cursorRef?.current;
    if (!engine.current || !out || !hostRef.current) return;
    const r = hostRef.current.getBoundingClientRect();
    const [x, y] = engine.current.screenToGame(ev.clientX - r.left, ev.clientY - r.top);
    out.textContent = `X ${x.toFixed(1)} · Y ${y.toFixed(1)}`;
  };

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('input, select, textarea, button')) return;
    if (ev.key === 'Escape' && card) { ev.stopPropagation(); ev.preventDefault(); setCard(null); return; }
    if (ev.key === '+' || ev.key === '=') engine.current?.zoomBy(0.5);
    else if (ev.key === '-') engine.current?.zoomBy(-0.5);
    else if (PAN[ev.key]) { onStopFollow(); engine.current?.setPanKey(PAN[ev.key], true); }
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  const point = async (action: PointAction) => {
    if (!card) return;
    setBusy(action);
    try { await onPointAction(action, card); } finally { setBusy(null); }
  };

  return (
    <div
      ref={hostRef}
      className={cls('mc-map', `theme-${theme}`, rtl && 'is-rtl')}
      style={{ background: paperOf(theme) }}
      dir={rtl ? 'rtl' : 'ltr'}
      tabIndex={0}
      aria-label={t('label.shell.page.map')}
      onPointerMove={onMove}
      onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('.wa-map-ui')) onStopFollow(); }}
      onKeyDown={onKey}
      onKeyUp={(e) => { if (PAN[e.key]) engine.current?.setPanKey(PAN[e.key], false); }}
      onBlur={() => engine.current?.resetInput()}
    >
      {follow && selected && (
        <div className="wa-map-ui mc-follow" role="status">
          <span>{t('label.map.following', followName ?? '')}</span>
          <HelpTip help="help.map.following" label={t('label.map.follow')} size="sm" />
        </div>
      )}

      <div className="wa-map-ui mc-legend">
        <span className="mc-legend-title">{t('label.map.legend.title')}</span>
        <span className="mc-lg mc-lg--player">{t('label.map.legend.player')}</span>
        <span className="mc-lg mc-lg--self">{t('label.map.legend.self')}</span>
        <span className="mc-lg mc-lg--dead">{t('label.map.legend.dead')}</span>
        <span className="mc-lg mc-lg--place">{t('label.map.legend.place')}</span>
        <HelpTip help="help.map.legend" label={t('label.map.legend.title')} size="sm" />
      </div>

      {card && (
        <div className="wa-map-ui mc-card k-layer" role="dialog" aria-label={card.name || t('label.map.point')}>
          <div className="mc-card-head">
            <span className="mc-card-title">
              <span className="k-ellipsis">{card.name || t('label.map.point')}</span>
              <HelpTip help="help.map.point" label={t('label.map.point')} size="sm" />
            </span>
            <IconButton icon="close" aria-label={t('label.common.close')} help="help.common.close" size="sm" onClick={() => setCard(null)} />
          </div>
          <div className="mc-card-xy k-num">X {card.x.toFixed(2)} · Y {card.y.toFixed(2)}</div>
          <div className="mc-card-acts">
            <Button help="help.map.waypoint" size="sm" block busy={busy === 'waypoint'} disabled={!!busy} onClick={() => { void point('waypoint'); }}>{t('label.map.waypoint')}</Button>
            <Button help="help.map.copyPoint" size="sm" block busy={busy === 'copyCoords'} disabled={!!busy} onClick={() => { void point('copyCoords'); }}>{t('label.map.copyPoint')}</Button>
            <Button help="help.map.tpHere" size="sm" block area="teleport" disabled={!canTeleport} onClick={() => onTeleport(card, 'self')}>{t('label.map.tpHere')}</Button>
            {bringName && (
              <Button help="help.map.bringHere" size="sm" block area="teleport" disabled={!canTeleport} onClick={() => onTeleport(card, 'selected')}>{t('label.map.bringHere', bringName)}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MapCanvas;
