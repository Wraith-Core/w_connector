/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/world/WorldControls.tsx
 * The world controls, written once and drawn in three places:
 *   'full'     the World page (every weather by group, ready times, the big announcement preview)
 *   'card'     the dashboard card (a weather list, hour and minute, a short announcement box)
 *   'compact'  the quick menu (PgUp): same as the card, narrower
 *
 *   import { WorldControls } from '../pages/world/WorldControls';
 *   <WorldControls variant="compact" />                       ← weather + time + announce, gated by 'server'
 *   <WorldControls variant="compact" show={['weather']} />    ← only some blocks
 *
 * Also exported one by one: WorldNow, WeatherControl, TimeControl, AnnounceControl, CycleControl.
 * B12: the time boxes start from the live in-game clock (never a fixed minute 0) and the weather
 * list starts on the current weather (never a fixed SUNNY).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import type { HelpKey } from '../../help';
import { useI18n } from '../../i18n';
import {
  Button, ButtonRow, Field, Gate, HelpTip, InlineAlert, NumberInput, Segmented, Select, SettingRow, Switch, TextArea, cls, fmtNum,
} from '../../kit';
import type { ServerInfo } from '../../types';
import {
  ANNOUNCE_MAX, ANNOUNCE_MAX_S, ANNOUNCE_MIN_S, CYCLE_FIELD, announceSeconds, useAnnounceDraft, useAnnounceDuration, useGameClock,
  useWorldActions, worldCycleOf,
} from './state';
import type { AnnounceUnit, CycleAction, WorldCycle } from './state';
import {
  FALLBACK_WEATHERS, TIME_PRESETS, clockText, dayPart, groupWeathers, weatherLabel,
} from './weather';
import './world.css';

export type WorldVariant = 'full' | 'card' | 'compact';
type Block = 'weather' | 'time' | 'announce';

/** true when the server answered but could not read the weather (w_weathersync stopped) */
export const weatherMissing = (info: ServerInfo | null) => !!info && (info.weather === null || info.weather === undefined || info.weather === '');

/* ── now ─────────────────────────────────────────────────────────────────── */

export function WorldNow({ variant = 'full' }: { variant?: WorldVariant }) {
  const app = useApp();
  const { t } = useI18n();
  const info = app.serverInfo;
  const cycle = worldCycleOf(info);
  const frozen = !!cycle?.timeFrozen;
  const clock = useGameClock(info, frozen);
  const weather = info?.weather ? String(info.weather).toUpperCase() : '';
  const wText = weather ? weatherLabel(t, weather) : t('label.world.unknown');
  const cText = clock ? clockText(clock.hour, clock.minute) : '—';
  const part = clock ? t(`label.world.part.${dayPart(clock.hour)}`) : '';

  if (variant !== 'full') {
    return (
      <div className="wld-nowline" role="status">
        <span className="wld-nowitem">
          <span className="k-faint">{t('label.world.nowWeather')}</span>
          <b>{wText}</b>
        </span>
        <span className="wld-nowitem">
          <span className="k-faint">{t('label.world.nowClock')}</span>
          <b className="k-num">{cText}</b>
          {part && <span className="k-faint">{frozen ? t('label.world.clockStopped') : part}</span>}
        </span>
        <HelpTip help="help.world.now" label={t('label.world.now')} size="sm" />
      </div>
    );
  }

  return (
    <div className="wld-now" role="status">
      <div className="wld-now-cell">
        <span className="wld-now-label">
          <span>{t('label.world.nowWeather')}</span>
          <HelpTip help="help.world.nowWeather" label={t('label.world.nowWeather')} size="sm" />
        </span>
        <span className="wld-now-value">{wText}</span>
        <span className="wld-now-sub k-ltr">{weather || '—'}</span>
      </div>
      <div className="wld-now-cell">
        <span className="wld-now-label">
          <span>{t('label.world.nowClock')}</span>
          <HelpTip help="help.world.nowClock" label={t('label.world.nowClock')} size="sm" />
        </span>
        <span className="wld-now-value is-kpi k-num">{cText}</span>
        <span className="wld-now-sub">{frozen ? t('label.world.clockStopped') : part}</span>
      </div>
      {cycle && (
        <div className="wld-now-cell">
          <span className="wld-now-label">
            <span>{t('label.world.nowCycle')}</span>
            <HelpTip help="help.world.nowCycle" label={t('label.world.nowCycle')} size="sm" />
          </span>
          <span className="wld-now-value">{cycle.dynamicWeather ? t('label.world.cycleAuto') : t('label.world.cycleFixed')}</span>
          <span className="wld-now-sub">
            {[cycle.timeFrozen && t('label.world.clockStopped'), cycle.blackout && t('label.world.blackout')].filter(Boolean).join(' · ') || ' '}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── weather ─────────────────────────────────────────────────────────────── */

function WeatherOption({ name, now, nowText }: { name: string; now: boolean; nowText: string }) {
  return (
    <span className="wld-wopt">
      <span className="wld-wopt-name">{name}</span>
      {now && <span className="wld-wopt-now">{nowText}</span>}
    </span>
  );
}

export function WeatherControl({ variant = 'full' }: { variant?: WorldVariant }) {
  const app = useApp();
  const { t } = useI18n();
  const { busy, setWeather } = useWorldActions();
  const list = useMemo(
    () => (app.catalog?.weathers?.length ? app.catalog.weathers : FALLBACK_WEATHERS).map((w) => String(w).toUpperCase()),
    [app.catalog],
  );
  const current = app.serverInfo?.weather ? String(app.serverInfo.weather).toUpperCase() : '';
  const [sel, setSel] = useState<string>(current);
  /* the first known weather becomes the starting choice (B12) */
  useEffect(() => { if (!sel && current) setSel(current); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (
    <Button
      help="help.world.applyWeather"
      kind={variant === 'full' ? 'primary' : 'secondary'}
      area="server"
      busy={busy === 'weather'}
      disabled={!sel || sel === current}
      onClick={() => { if (sel) void setWeather(sel); }}
    >
      {sel && sel !== current && variant === 'full' ? t('label.world.applyWeatherTo', weatherLabel(t, sel)) : t('label.world.applyWeather')}
    </Button>
  );

  if (variant !== 'full') {
    const options = list.map((w) => ({
      value: w,
      label: weatherLabel(t, w),
      sub: w === current ? t('label.world.current') : undefined,
    }));
    return (
      <div className="wld-inline">
        <Field label={t('label.world.weather')} help="help.world.weather" className="wld-grow">
          <Select value={sel} onChange={setSel} options={options} placeholder={t('label.world.weatherPick')} />
        </Field>
        {apply}
      </div>
    );
  }

  const groups = groupWeathers(list);
  return (
    <div className="wld-weather">
      {groups.map(({ group, codes }) => {
        const label = t(`label.world.group.${group}`);
        return (
          <div className="wld-wrow" key={group}>
            <div className="wld-wrow-head">
              <span>{label}</span>
              <HelpTip help={`help.world.group.${group}` as HelpKey} label={label} size="sm" />
            </div>
            <Segmented<string>
              value={codes.includes(sel) ? sel : ''}
              onChange={setSel}
              options={codes.map((c) => ({ value: c, label: <WeatherOption name={weatherLabel(t, c)} now={c === current} nowText={t('label.world.current')} /> }))}
              label={label}
              help={false}
              area="server"
              className="wld-wseg"
            />
          </div>
        );
      })}
      <div className="wld-apply">{apply}</div>
    </div>
  );
}

/* ── time ────────────────────────────────────────────────────────────────── */

export function TimeControl({ variant = 'full' }: { variant?: WorldVariant }) {
  const app = useApp();
  const { t } = useI18n();
  const { busy, setTime } = useWorldActions();
  const cycle = worldCycleOf(app.serverInfo);
  const clock = useGameClock(app.serverInfo, !!cycle?.timeFrozen);
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  /* the first known clock fills the boxes (B12: never a fixed 0 minute) */
  const clockKnown = clock !== null;
  useEffect(() => {
    if (clock && hour === null && minute === null) { setHour(clock.hour); setMinute(clock.minute); }
  }, [clockKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = hour !== null && minute !== null && Number.isInteger(hour) && Number.isInteger(minute)
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  const preset = TIME_PRESETS.find((p) => p.hour === hour && p.minute === minute)?.id ?? '';

  const applyBtn = (
    <Button
      help="help.world.applyTime"
      kind={variant === 'full' ? 'primary' : 'secondary'}
      area="server"
      busy={busy === 'time'}
      disabled={!valid}
      onClick={() => { if (valid) void setTime(hour as number, minute as number); }}
    >
      {t('label.world.applyTime')}
    </Button>
  );
  const fields = (
    <>
      <Field label={t('label.world.hour')} help="help.world.hour" className="wld-num">
        <NumberInput value={hour} onChange={setHour} min={0} max={23} integer />
      </Field>
      <Field label={t('label.world.minute')} help="help.world.minute" className="wld-num">
        <NumberInput value={minute} onChange={setMinute} min={0} max={59} integer />
      </Field>
    </>
  );

  if (variant !== 'full') return <div className="wld-inline">{fields}{applyBtn}</div>;

  const presetsLabel = t('label.world.presets');
  return (
    <div className="wld-time">
      <div className="wld-wrow">
        <div className="wld-wrow-head">
          <span>{presetsLabel}</span>
          <HelpTip help="help.world.presets" label={presetsLabel} size="sm" />
        </div>
        <Segmented<string>
          value={preset}
          onChange={(id) => { const p = TIME_PRESETS.find((x) => x.id === id); if (p) { setHour(p.hour); setMinute(p.minute); } }}
          options={TIME_PRESETS.map((p) => ({
            value: p.id,
            label: (
              <span className="wld-wopt">
                <span className="wld-wopt-name">{t(`label.world.preset.${p.id}`)}</span>
                <span className="wld-wopt-now k-num">{clockText(p.hour, p.minute)}</span>
              </span>
            ),
          }))}
          label={presetsLabel}
          help={false}
          area="server"
          className="wld-wseg"
        />
      </div>
      <div className="wld-wrow">
        <div className="wld-wrow-head" aria-hidden="true" />
        <div className="wld-inline wld-inline--start">{fields}</div>
      </div>
      <div className="wld-apply">
        {applyBtn}
        {valid && (
          <span className="wld-result" role="status">
            {t('label.world.timeResult', clockText(hour as number, minute as number), t(`label.world.part.${dayPart(hour as number)}`))}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── announcement ────────────────────────────────────────────────────────── */

const TEMPLATES = ['restart5', 'restart15', 'maintenance', 'event'] as const;

/**
 * "45 seconds" / "5 minutes": whole minutes read as minutes, anything else as seconds. Arabic counts
 * change the noun (دقيقة واحدة · دقيقتان · 3-10 دقائق · 11+ دقيقة), so each count has its own key.
 */
export function durationText(t: (key: string, ...args: (string | number)[]) => string, seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    if (m === 1) return t('label.world.durationMinutesOne');
    if (m === 2) return t('label.world.durationMinutesTwo');
    return t(m <= 10 ? 'label.world.durationMinutesFew' : 'label.world.durationMinutes', fmtNum(m));
  }
  return t(seconds <= 10 ? 'label.world.durationSecondsFew' : 'label.world.durationSeconds', fmtNum(seconds));
}

/**
 * How players get it (3.1.0): w_hud's shard -- white text at the top centre under the compass for
 * `seconds` (exports.w_hud:Announce, sv_console.lua adminAnnounce) -- and a chat line.
 */
export function AnnouncePreview({ text, seconds, className }: { text: string; seconds: number | null; className?: string }) {
  const { t } = useI18n();
  const empty = !text.trim();
  return (
    <div className={cls('wld-pv', className)}>
      <div className="wld-pv-part">
        <span className="wld-pv-cap">{t('label.world.previewScreen', seconds === null ? '—' : durationText(t, seconds))}</span>
        <div className="wld-pv-shard">
          <b className="wld-pv-title">{t('announce_title')}</b>
          <span className="wld-pv-rule" aria-hidden="true" />
          <p className={cls('wld-pv-text', empty && 'is-empty')} dir="auto">{empty ? t('label.world.previewEmpty') : text}</p>
        </div>
      </div>
      <div className="wld-pv-part">
        <span className="wld-pv-cap">{t('label.world.previewChat')}</span>
        <p className="wld-pv-chat" dir="auto">
          <b>{t('chat_announcement')}</b> <span className={empty ? 'k-faint' : undefined}>{empty ? '…' : text}</span>
        </p>
      </div>
    </div>
  );
}

export function AnnounceControl({ variant = 'full' }: { variant?: WorldVariant }) {
  const app = useApp();
  const { t } = useI18n();
  const { busy, announce, announceClear } = useWorldActions();
  const [text, setText] = useAnnounceDraft();
  const [dur, setDur] = useAnnounceDuration();
  const seconds = announceSeconds(dur);
  const count = app.serverInfo?.playersOnline ?? app.players.length;
  const clean = text.trim();

  const send = () => {
    if (!clean || seconds === null) return;
    app.confirm({
      title: t('label.world.confirmTitle'),
      help: 'help.world.send',
      text: (
        <div className="wld-confirm">
          <p>{t('label.world.confirmText', fmtNum(count), durationText(t, seconds))}</p>
          <AnnouncePreview text={clean} seconds={seconds} />
        </div>
      ),
      confirmLabel: t('label.world.send'),
      onConfirm: async () => {
        const r = await announce(clean, seconds);
        if (r.ok) setText('');
      },
    });
  };

  /* 3.1.0: how long it stays -- a number and its unit; the range check is on the seconds they make */
  const unitMax = dur.unit === 'minutes' ? ANNOUNCE_MAX_S / 60 : ANNOUNCE_MAX_S;
  const unitMin = dur.unit === 'minutes' ? 1 : ANNOUNCE_MIN_S;
  const durationField = (
    <div className="wld-dur">
      <Field label={t('label.world.duration')} help="help.world.duration" className="wld-num" error={seconds === null ? t('label.world.durationRange') : undefined}>
        <NumberInput
          value={dur.amount}
          onChange={(v) => setDur({ ...dur, amount: v })}
          min={unitMin}
          max={unitMax}
          integer
        />
      </Field>
      <Segmented<AnnounceUnit>
        value={dur.unit}
        onChange={(unit) => setDur({ ...dur, unit })}
        options={[
          { value: 'seconds', label: t('label.world.unit.seconds') },
          { value: 'minutes', label: t('label.world.unit.minutes') },
        ]}
        size="sm"
        label={t('label.world.duration')}
        help={false}
        area="server"
      />
    </div>
  );

  return (
    <div className={cls('wld-announce', `wld-announce--${variant}`)}>
      <Field
        label={t('label.world.announceText')}
        help="help.world.announceText"
        aside={<span className="k-num">{text.length} / {ANNOUNCE_MAX}</span>}
      >
        <TextArea
          value={text}
          onChange={setText}
          rows={variant === 'full' ? 4 : 2}
          maxLength={ANNOUNCE_MAX}
          placeholder={t('label.world.announcePh')}
        />
      </Field>
      {durationField}
      {variant === 'full' && (
        <div className="wld-tpl">
          <span className="wld-tpl-label">{t('label.world.templates')}</span>
          <ButtonRow>
            {TEMPLATES.map((id) => (
              <Button key={id} help="help.world.template" helpLabel={t(`label.world.tpl.${id}`)} kind="ghost" size="sm" area="server" onClick={() => setText(t(`label.world.tpl.${id}`))}>
                {t(`label.world.tplShort.${id}`)}
              </Button>
            ))}
          </ButtonRow>
        </div>
      )}
      {(variant === 'full' || clean) && (
        <div className="wld-pvwrap">
          <div className="wld-pvhead">
            <span>{t('label.world.preview')}</span>
            <HelpTip help="help.world.preview" label={t('label.world.preview')} size="sm" />
          </div>
          <AnnouncePreview text={text} seconds={seconds} className={variant !== 'full' ? 'is-compact' : undefined} />
        </div>
      )}
      <div className="wld-apply">
        <Button help="help.world.send" kind={variant === 'full' ? 'primary' : 'secondary'} area="server" busy={busy === 'announce'} disabled={!clean || seconds === null} onClick={send}>
          {t('label.world.send')}
        </Button>
        <Button help="help.world.clear" kind="ghost" size="sm" area="server" busy={busy === 'announceClear'} onClick={() => void announceClear()}>
          {t('label.world.clear')}
        </Button>
        <span className="wld-result">{t('label.world.sendCount', fmtNum(count))}</span>
      </div>
    </div>
  );
}

/* ── the weather script's own cycle (L1: serverInfo.world + three server actions) ─ */

const CYCLE_ROWS: CycleAction[] = ['dynamicWeather', 'freezeTime', 'blackout'];

export function CycleControl() {
  const app = useApp();
  const { t } = useI18n();
  const { busy, setCycle } = useWorldActions();
  const base = worldCycleOf(app.serverInfo);
  const real = (app.serverInfo as (ServerInfo & { world?: WorldCycle }) | null)?.world;
  const [local, setLocal] = useState<WorldCycle>({});
  /* a new state from the server replaces what was set here */
  useEffect(() => { setLocal({}); }, [real]);
  if (!base) return null;
  const state: WorldCycle = { ...base, ...local };
  return (
    <div className="wld-cycle">
      {CYCLE_ROWS.map((action) => {
        const field = CYCLE_FIELD[action];
        const on = !!state[field];
        return (
          <SettingRow
            key={action}
            label={t(`label.world.${action}`)}
            help={`help.world.${action}` as HelpKey}
            description={t(`label.world.cycleDesc.${action}`)}
            area="server"
            control={(
              <Switch
                checked={on}
                disabled={busy === action}
                onChange={async (v) => {
                  const r = await setCycle(action, v);
                  if (r.ok) setLocal((l) => ({ ...l, [field]: v }));
                }}
              />
            )}
          />
        );
      })}
    </div>
  );
}

/* ── all of it ───────────────────────────────────────────────────────────── */

export interface WorldControlsProps {
  /** 'card' (dashboard, default) · 'compact' (quick menu) · 'full' (the World page draws its own sections) */
  variant?: WorldVariant;
  /** which blocks to draw (default all three) */
  show?: Block[];
  /** hide the "now" line */
  noNow?: boolean;
  className?: string;
}

export function WorldControls({ variant = 'card', show = ['weather', 'time', 'announce'], noNow, className }: WorldControlsProps) {
  const app = useApp();
  const { t } = useI18n();
  return (
    <Gate area="server">
      <div className={cls('wld-controls', `wld-controls--${variant}`, className)}>
        {!noNow && <WorldNow variant={variant} />}
        {weatherMissing(app.serverInfo) && (
          <InlineAlert tone="warn" title={t('label.world.missing')} help="help.world.missing" />
        )}
        {show.includes('weather') && <WeatherControl variant={variant} />}
        {show.includes('time') && <TimeControl variant={variant} />}
        {show.includes('announce') && <AnnounceControl variant={variant} />}
      </div>
    </Gate>
  );
}
