/* ════════════════════════════════════════════════════════════════════════════
 * Dashboard: the server's numbers on cards, and the quick actions (announce / weather / time).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Button, Field, Loading, NumberInput, Section, Select, TextArea } from '../ui/controls';
import Glyph from '../ui/Glyph';
import type { TabId } from '../types';
import type { GlyphName } from '../ui/Glyph';
import { fmtNum } from '../ui/util';

const FALLBACK_WEATHERS = [
  'SUNNY', 'CLOUDS', 'OVERCAST', 'OVERCASTDARK', 'FOG', 'MISTY', 'DRIZZLE', 'RAIN', 'SHOWER', 'THUNDER',
  'THUNDERSTORM', 'HAIL', 'HIGHPRESSURE', 'HURRICANE', 'SLEET', 'SNOWLIGHT', 'SNOW', 'GROUNDBLIZZARD', 'BLIZZARD', 'WHITEOUT', 'SANDSTORM',
];

export function weatherLabel(t: (k: string) => string, type: string | null | undefined): string {
  if (!type) return '—';
  const low = type.toLowerCase();
  const key = `weather_${low}`;
  const s = t(key);
  return s === key ? type : s;
}

/** Each "5d" pair is isolated, so a number next to an Arabic unit letter keeps its order in both directions */
function Uptime({ sec }: { sec: number }) {
  const t = useT();
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: [number, string][] = [];
  if (d > 0) parts.push([d, t('ui_uptime_d')]);
  parts.push([h, t('ui_uptime_h')]);
  parts.push([m, t('ui_uptime_m')]);
  return <span className="wa-uptime">{parts.map(([n, u], i) => <bdi key={i} dir="ltr">{n}<small>{u}</small></bdi>)}</span>;
}

function Card({ glyph, label, value, sub, tone }: { glyph: GlyphName; label: string; value: ReactNode; sub?: string; tone?: 'red' }) {
  return (
    <div className={tone === 'red' ? 'wa-card wst-plate wa-card--red' : 'wa-card wst-plate'}>
      <Glyph name={glyph} className="wa-card-glyph" />
      <div className="wa-card-k">{label}</div>
      <div className="wa-card-v"><bdi dir="ltr">{value}</bdi></div>
      {sub && <div className="wa-card-s">{sub}</div>}
    </div>
  );
}

export default function Dashboard({ onTab }: { onTab(tab: TabId): void }) {
  const t = useT();
  const { serverInfo: info, catalog, can, act, players, admin, select } = useApp();

  const [announce, setAnnounce] = useState('');
  const [weather, setWeather] = useState('');
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (info?.weather && !weather) setWeather(info.weather);
    if (info?.time) { setHour(info.time.hour); setMinute(info.time.minute); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.weather, info?.time?.hour, info?.time?.minute]);

  const weathers = useMemo(() => {
    const list = catalog?.weathers?.length ? catalog.weathers : FALLBACK_WEATHERS;
    return list.map((w) => ({ value: w, label: weatherLabel(t, w) }));
  }, [catalog, t]);

  const running = info ? info.resources.filter((r) => r.state === 'started').length : 0;

  const run = async (key: string, name: string, data: unknown, okText: string) => {
    setBusy(key);
    try { await act(name, data, { okText }); } finally { setBusy(null); }
  };

  return (
    <div className="wa-dash">
      <section className="wa-welcome wst-header">
        <div><span className="wa-eyebrow">{t('ui_command_center')}</span><h2>{t('ui_welcome_admin', admin?.name ?? '')}</h2><p>{t('ui_overview_desc')}</p></div>
        <div className="wa-welcome-seal" aria-hidden="true"><Glyph name="self" /><span>WRAITH<br/>CORE</span></div>
      </section>
      {!info ? (
        <Loading text={t('ui_dash_no_info')} />
      ) : (
        <div className="wa-cards">
          <Card glyph="players" label={t('ui_dash_online')} value={`${info.playersOnline} / ${info.maxPlayers}`} sub={players.length !== info.playersOnline ? `${fmtNum(players.length)}` : undefined} />
          <Card glyph="refresh" label={t('ui_dash_uptime')} value={<Uptime sec={info.uptime} />} />
          <Card glyph="bans" label={t('ui_dash_bans')} value={fmtNum(info.bansCount)} tone={info.bansCount > 0 ? 'red' : undefined} />
          <Card glyph="resources" label={t('ui_dash_resources')} value={`${running} / ${info.resources.length}`} sub={t('ui_dash_running')} />
        </div>
      )}

      <div className="wa-dash-middle">
        <Section title={t('ui_quick_access')}>
          <div className="wa-quick-grid">{([
            { id: 'players', glyph: 'players', perm: 'players' }, { id: 'map', glyph: 'map', perm: 'map' },
            { id: 'hud', glyph: 'hud', perm: 'hud' }, { id: 'self', glyph: 'self' },
          ] as const).filter((entry) => !('perm' in entry) || can(entry.perm)).map((entry) => <button className="wa-quick wst-card" type="button" key={entry.id} onClick={() => onTab(entry.id)}><Glyph name={entry.glyph} /><span><strong>{t(`ui_tab_${entry.id}`)}</strong><small>{t(`ui_quick_${entry.id}`)}</small></span><Glyph name="arrow" /></button>)}</div>
        </Section>
        {can('players') && <Section title={t('ui_attention')} aside={<span className="wa-dim">{players.filter((p) => p.dead || (p.needs && (p.needs.hunger < 20 || p.needs.thirst < 20))).length}</span>}>
          <div className="wa-attention">{players.filter((p) => p.dead || (p.needs && (p.needs.hunger < 20 || p.needs.thirst < 20))).slice(0, 4).map((p) => <button type="button" className="wa-attention-row wst-row clickable" key={p.id} onClick={() => { select(p.id); onTab('players'); }}><span className="wa-avatar">{p.id}</span><span><strong>{p.name}</strong><small>{p.dead ? t('ui_dead') : t('ui_low_needs')}</small></span><Glyph name="arrow" /></button>)}
          {!players.some((p) => p.dead || (p.needs && (p.needs.hunger < 20 || p.needs.thirst < 20))) && <div className="wa-all-clear"><Glyph name="check" />{t('ui_all_clear')}</div>}</div>
        </Section>}
      </div>
      {can('server') && (
        <details className="wa-server-controls"><summary><Glyph name="resources" /><span>{t('ui_server_controls')}</span><small>{t('ui_server_controls_desc')}</small><Glyph name="sortDown" /></summary><div className="wa-dash-actions">
          <Section title={t('ui_dash_announce')}>
            <TextArea value={announce} onChange={setAnnounce} rows={3} maxLength={400} placeholder={t('ui_dash_announce_ph')} />
            <div className="wa-row wa-row--end">
              <Button
                glyph="arrow"
                disabled={!announce.trim()}
                busy={busy === 'announce'}
                onClick={() => void run('announce', 'server', { action: 'announce', args: { text: announce.trim() } }, t('ui_sent')).then(() => setAnnounce(''))}
              >
                {t('ui_dash_send')}
              </Button>
            </div>
          </Section>

          <Section title={t('ui_dash_set_weather')}>
            <Field label={t('ui_dash_weather')}>
              <Select value={weather} onChange={setWeather} options={weathers} placeholder="—" />
            </Field>
            <div className="wa-row wa-row--end">
              <Button disabled={!weather} busy={busy === 'weather'} onClick={() => void run('weather', 'server', { action: 'weather', args: { type: weather } }, t('ui_done'))}>
                {t('ui_apply')}
              </Button>
            </div>
          </Section>

          <Section title={t('ui_dash_set_time')}>
            <div className="wa-row">
              <Field label={t('ui_dash_hour')}><NumberInput value={hour} onChange={setHour} min={0} max={23} /></Field>
              <Field label={t('ui_dash_minute')}><NumberInput value={minute} onChange={setMinute} min={0} max={59} /></Field>
            </div>
            <div className="wa-row wa-row--end">
              <Button busy={busy === 'time'} onClick={() => void run('time', 'server', { action: 'time', args: { hour: Math.round(hour), minute: Math.round(minute) } }, t('ui_done'))}>
                {t('ui_apply')}
              </Button>
            </div>
          </Section>
        </div></details>
      )}
    </div>
  );
}
