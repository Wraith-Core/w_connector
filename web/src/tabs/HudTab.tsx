/* ════════════════════════════════════════════════════════════════════════════
 * HUD: the w_hud server settings, rendered generically from the cfg object Lua sends (booleans → switches,
 * numbers → number fields, strings → text; one group per nested object), plus the per-player needs editor.
 * Labels come from ui_hud_f_<group>_<key> when the dictionary has them, otherwise the key itself.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Button, Empty, Field, Input, NumberInput, Section, Select, Slider, Tag, ToggleRow } from '../ui/controls';
import Glyph from '../ui/Glyph';
import type { HudCfg } from '../types';

type Prim = string | number | boolean;
const isPrim = (v: unknown): v is Prim => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Known ranges, so a slider-like number gets a sane step and the page never sends a value w_hud would clamp */
const RANGES: Record<string, { min?: number; max?: number; step?: number }> = {
  'logo.width': { min: 2, max: 160 }, 'logo.height': { min: 0, max: 160 },
  'identity.x': { min: -20, max: 120, step: 0.1 }, 'identity.y': { min: -20, max: 120, step: 0.1 },
  'identity.scale': { min: 0.4, max: 3, step: 0.05 }, 'identity.opacity': { min: 0.15, max: 1, step: 0.05 },
  'needs.hungerRate': { min: 0, max: 25, step: 0.1 }, 'needs.thirstRate': { min: 0, max: 25, step: 0.1 }, 'needs.interval': { min: 5, max: 1800 },
  'damage.hungerAt': { min: 0, max: 99 }, 'damage.thirstAt': { min: 0, max: 99 }, 'damage.amount': { min: 0.5, max: 25, step: 0.5 }, 'damage.interval': { min: 3, max: 600 },
};

const clone = (c: HudCfg): HudCfg => JSON.parse(JSON.stringify(c)) as HudCfg;
const same = (a: HudCfg | null, b: HudCfg | null) => JSON.stringify(a) === JSON.stringify(b);

export default function HudTab() {
  const t = useT();
  const { hudCfg, act, players, can } = useApp();
  const [draft, setDraft] = useState<HudCfg | null>(hudCfg ? clone(hudCfg) : null);
  const [base, setBase] = useState<HudCfg | null>(hudCfg);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('general');

  /* A fresh blob from the server replaces the draft unless the admin is mid-edit */
  useEffect(() => {
    if (!hudCfg) return;
    const dirty = draft !== null && !same(draft, base);
    setBase(hudCfg);
    if (!dirty) setDraft(clone(hudCfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hudCfg]);

  const dirty = draft !== null && !same(draft, base);

  const label = (path: string[]) => {
    const key = `ui_hud_f_${path.join('_')}`;
    const s = t(key);
    return s === key ? path[path.length - 1] : s;
  };

  const setAt = (path: string[], v: Prim) => {
    setDraft((d) => {
      if (!d) return d;
      const next = clone(d);
      let cur: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!isObj(cur[k])) cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
      }
      cur[path[path.length - 1]] = v;
      return next;
    });
  };

  const renderPrim = (path: string[], v: Prim) => {
    const key = path.join('.');
    if (typeof v === 'boolean') {
      return <ToggleRow key={key} label={label(path)} on={v} onChange={(b) => setAt(path, b)} labelOn={t('ui_on')} labelOff={t('ui_off')} />;
    }
    if (typeof v === 'number') {
      const r = RANGES[key] ?? {};
      const step = r.step ?? (Number.isInteger(v) ? 1 : 0.1);
      return (
        <Field key={key} label={label(path)} inline>
          <NumberInput value={v} onChange={(n) => setAt(path, n)} min={r.min} max={r.max} step={step} />
        </Field>
      );
    }
    return (
      <Field key={key} label={label(path)} inline>
        <Input value={v} onChange={(s) => setAt(path, s)} maxLength={400} />
      </Field>
    );
  };

  const groups = useMemo(() => {
    if (!draft) return null;
    const root: [string[], Prim][] = [];
    const nested: { name: string; fields: [string[], Prim][] }[] = [];
    for (const k of Object.keys(draft)) {
      const v = draft[k];
      if (isPrim(v)) root.push([[k], v]);
      else if (isObj(v)) {
        const fields: [string[], Prim][] = [];
        for (const kk of Object.keys(v)) { const vv = v[kk]; if (isPrim(vv)) fields.push([[k, kk], vv]); }
        nested.push({ name: k, fields });
      }
    }
    return { root, nested }; 
  }, [draft]);

  const categories = ['general', ...(groups?.nested.map((g) => g.name) ?? [])];
  const visibleCategory = categories.includes(category) || (category === 'playerNeeds' && can('needs')) ? category : 'general';

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await act<{ cfg: HudCfg }>('hud', { action: 'save', cfg: draft }, { okText: t('ui_saved') });
      if (r.ok) {
        const saved = r.data?.cfg ?? draft;
        setBase(clone(saved));
        setDraft(clone(saved));
      }
    } finally { setBusy(false); }
  };

  /* ── per-player needs ────────────────────────────────────────────────────── */
  const [pid, setPid] = useState('');
  const [hunger, setHunger] = useState(100);
  const [thirst, setThirst] = useState(100);
  const target = players.find((p) => String(p.id) === pid) ?? null;
  useEffect(() => {
    if (target?.needs) { setHunger(target.needs.hunger); setThirst(target.needs.thirst); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const setNeed = (need: 'hunger' | 'thirst', value: number) => {
    if (!target) return;
    void act('hud', { action: 'setNeed', id: target.id, need, value: Math.round(value) }, { okText: t('ui_done') });
  };

  return (
    <div className="wa-hud">
      <nav className="wa-settings-nav" aria-label={t('ui_hud_categories')}>
        <span className="wa-eyebrow">{t('ui_hud_categories')}</span>
        {categories.map((key) => <button className={visibleCategory === key ? 'is-active' : ''} type="button" key={key} aria-pressed={visibleCategory === key} onClick={() => setCategory(key)}><Glyph name={key === 'needs' ? 'food' : key === 'damage' ? 'heart' : 'hud'} /><span>{key === 'general' ? t('ui_general') : label([key])}</span></button>)}
        {can('needs') && <button type="button" className={visibleCategory === 'playerNeeds' ? 'is-active' : ''} aria-pressed={visibleCategory === 'playerNeeds'} onClick={() => setCategory('playerNeeds')}><Glyph name="players" /><span>{t('ui_hud_needs_editor')}</span></button>}
      </nav>
      <div className="wa-hud-form" hidden={visibleCategory === 'playerNeeds'}>
        <div className="wa-hud-top">
          <div>
            <h2 className="wa-h2">{t('ui_hud_title')}</h2>
            <p className="wa-dim">{t('ui_hud_desc')}</p>
          </div>
          <div className="wa-row">
            {dirty && <Tag tone="bad">{t('ui_hud_dirty')}</Tag>}
            <Button kind="ghost" disabled={!dirty} onClick={() => base && setDraft(clone(base))}>{t('ui_hud_reset')}</Button>
            <Button glyph="check" disabled={!dirty} busy={busy} onClick={() => void save()}>{t('ui_hud_save')}</Button>
          </div>
        </div>

        {!groups ? (
          <Empty text={t('ui_hud_no_cfg')} glyph="hud" />
        ) : (
          <div className="wa-hud-groups">
            {visibleCategory === 'general' && groups.root.length > 0 && (
              <Section title={t('ui_general')}>
                {groups.root.map(([p, v]) => renderPrim(p, v))}
              </Section>
            )}
            {groups.nested.filter((g) => g.name === visibleCategory).map((g) => (
              <Section key={g.name} title={label([g.name])}>
                {g.fields.length === 0 ? <p className="wa-dim">{t('ui_empty')}</p> : g.fields.map(([p, v]) => renderPrim(p, v))}
              </Section>
            ))}
          </div>
        )}
      </div>

      {can('needs') && visibleCategory === 'playerNeeds' && (
        <aside className="wa-hud-needs">
          <Section title={t('ui_hud_needs_editor')}>
            {players.length === 0 ? (
              <p className="wa-dim">{t('ui_hud_no_players')}</p>
            ) : (
              <>
                <Field label={t('ui_hud_pick_player')}>
                  <Select value={pid} onChange={setPid} placeholder={t('ui_hud_pick_player')} options={players.map((p) => ({ value: String(p.id), label: `${p.id} · ${p.name}` }))} />
                </Field>
                {target && (
                  target.needs ? (
                    <>
                      <Slider label={<><Glyph name="food" /> {t('ui_a_hunger')}</>} value={hunger} onChange={setHunger} unit="%" />
                      <div className="wa-row wa-row--end"><Button size="sm" onClick={() => setNeed('hunger', hunger)}>{t('ui_apply')}</Button></div>
                      <Slider label={<><Glyph name="water" /> {t('ui_a_thirst')}</>} value={thirst} onChange={setThirst} unit="%" />
                      <div className="wa-row wa-row--end"><Button size="sm" onClick={() => setNeed('thirst', thirst)}>{t('ui_apply')}</Button></div>
                      <Button kind="ghost" block onClick={() => { setHunger(100); setThirst(100); setNeed('hunger', 100); setNeed('thirst', 100); }}>{t('ui_a_refill')}</Button>
                    </>
                  ) : (
                    <p className="wa-dim">{t('ui_a_no_needs')}</p>
                  )
                )}
              </>
            )}
          </Section>
        </aside>
      )}
    </div>
  );
}
