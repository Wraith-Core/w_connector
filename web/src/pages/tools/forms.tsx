/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/tools/forms.tsx
 * The pieces of tools.ts that the "My tools" page and the quick menu draw the same way:
 *   ToolRow           one tool: name, one plain line, and its control (an on / off switch or a verb
 *                     button); a locked tool stays visible with the level it needs
 *   NoclipSpeed       the flight speed (0.25× … 10×)
 *   CoordsJump        teleport to typed / pasted coordinates
 *   SpawnForm         kind → model → mount / behaviour → spawn; remove all my spawns
 *   ClearAreaForm     a radius and the red "clear" (asks first)
 * Every control carries its "؟" (help.tools.*).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, ButtonRow, Combobox, CoordsInput, Field, Glyph, NumberInput, Segmented, Switch, TextInput, cls,
  Fold, ReadyLine,
} from '../../kit';
import type { CoordsValue, Option } from '../../kit';
import type { Catalog } from '../../types';
import {
  NOCLIP_SPEEDS, SPAWN_ACTION, SPAWN_KINDS, SPAWN_LIMIT, canTool, isOn, toolById, toolHint, toolLabel, toolVerb,
} from './tools';
import type { SpawnKind, ToolDef, ToolRunner } from './tools';
import './tools.css';

/** "Needs Admin (admin)" under a locked tool (the control's own "؟" already names the level) */
export function LockNote({ tool }: { tool: ToolDef }) {
  const app = useApp();
  const { t } = useI18n();
  const level = app.levelOf(tool.area);
  return (
    <span className="tl-lock">
      <Glyph name="lock" />
      <span>{level ? t('label.common.lockedNeeds', t(`label.common.level.${level}`)) : t('label.common.locked')}</span>
    </span>
  );
}

/* ── one tool ────────────────────────────────────────────────────────────── */

export function ToolRow({ tool, runner }: { tool: ToolDef; runner: ToolRunner }) {
  const app = useApp();
  const { t } = useI18n();
  const locked = !canTool(app, tool);
  const on = isOn(tool, app.self);
  const unavailable = tool.unavailable?.(app.self) ?? false;
  const label = toolLabel(t, tool.id);
  const hint = unavailable ? t('label.tools.unavailableBack') : toolHint(t, tool.id);
  return (
    <div className={cls('tl-row', on && 'is-on', locked && 'is-locked')} data-tool={tool.id}>
      <div className="tl-row-text">
        <span className="tl-row-label">{label}</span>
        {hint && <span className="tl-row-hint">{hint}</span>}
        {locked && <LockNote tool={tool} />}
      </div>
      <div className="tl-row-ctl">
        {tool.kind === 'toggle' ? (
          <Switch
            checked={on}
            onChange={() => runner.run(tool)}
            help={tool.help}
            label={label}
            area={tool.area}
            size="sm"
            disabled={locked || !!runner.busy}
          />
        ) : (
          <Button
            help={tool.help}
            helpLabel={label}
            area={tool.area}
            kind={tool.confirm === 'danger' ? 'danger' : 'secondary'}
            size="sm"
            busy={runner.busy === tool.id}
            disabled={locked || (!!runner.busy && runner.busy !== tool.id) || unavailable}
            onClick={() => runner.run(tool)}
          >
            {toolVerb(t, tool.id)}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── flight speed ────────────────────────────────────────────────────────── */

export function NoclipSpeed({ runner, stacked }: { runner: ToolRunner; stacked?: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  const tool = toolById('noclipSpeed')!;
  const value = app.self?.noclipSpeed ?? 1;
  const locked = !canTool(app, tool);
  const label = toolLabel(t, tool.id);
  return (
    <div className={cls('tl-row', stacked && 'is-stacked', locked && 'is-locked')} data-tool={tool.id}>
      <div className="tl-row-text">
        <span className="tl-row-label">{label}</span>
        <span className="tl-row-hint">{toolHint(t, tool.id)}</span>
        {locked && <LockNote tool={tool} />}
      </div>
      <div className="tl-row-ctl">
        <Segmented
          value={value}
          onChange={(v) => { void runner.self('noclipSpeed', 'noclipSpeed', { speed: v }); }}
          options={NOCLIP_SPEEDS.map((n) => ({ value: n, label: <span className="k-num">{t('label.tools.speed', n)}</span> }))}
          size="sm"
          label={label}
          help={tool.help}
          area={tool.area}
          disabled={locked || !!runner.busy}
        />
      </div>
    </div>
  );
}

/* ── teleport to coordinates ─────────────────────────────────────────────── */

export function CoordsJump({ runner }: { runner: ToolRunner }) {
  const app = useApp();
  const { t } = useI18n();
  const tool = toolById('tpCoords')!;
  const [c, setC] = useState<CoordsValue>({ x: null, y: null, z: null });
  const ready = c.x !== null && c.y !== null;
  const locked = !canTool(app, tool);
  const go = () => {
    if (!ready) return;
    void runner.self('tpCoords', 'tpCoords', { x: c.x, y: c.y, ...(c.z !== null ? { z: c.z } : {}) }, t('label.tools.done'));
  };
  return (
    <div className={cls('tl-form', locked && 'is-locked')} data-tool={tool.id}>
      <div className="tl-row-text">
        <span className="tl-row-label">{toolLabel(t, tool.id)}</span>
        <span className="tl-row-hint">{toolHint(t, tool.id)}</span>
        {locked && <LockNote tool={tool} />}
      </div>
      <CoordsInput value={c} onChange={setC} label={t('label.tools.coords')} help="help.common.coords" area={tool.area} />
      {/* 2.8.0 the readiness line: what the jump still needs, in words */}
      {!locked && <ReadyLine missing={[c.x === null && 'X', c.y === null && 'Y'].filter((x): x is string => !!x)} />}
      <ButtonRow>
        <Button help={tool.help} helpLabel={toolLabel(t, tool.id)} area={tool.area} size="sm" busy={runner.busy === 'tpCoords'} disabled={locked || !ready || (!!runner.busy && runner.busy !== 'tpCoords')} onClick={go}>
          {toolVerb(t, tool.id)}
        </Button>
      </ButtonRow>
    </div>
  );
}

/* ── spawn ───────────────────────────────────────────────────────────────── */

export function SpawnForm({ runner, compact }: { runner: ToolRunner; compact?: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  const tool = toolById('spawn')!;
  const cleanup = toolById('cleanupSpawned')!;
  const [kind, setKind] = useState<SpawnKind>('horses');
  const [model, setModel] = useState('');
  const [mount, setMount] = useState(true);
  const [behavior, setBehavior] = useState<'stand' | 'wander'>('stand');
  const locked = !canTool(app, tool);
  const rows = ((app.catalog?.[kind] ?? []) as Catalog['horses']);
  const options = useMemo<Option[]>(() => rows.map((r) => ({ value: r.model, label: r.label || r.model, sub: r.label && r.label !== r.model ? r.model : undefined })), [rows]);
  useEffect(() => { setModel(''); }, [kind]);
  const availableKinds = SPAWN_KINDS.filter((k) => app.canAction(`self.${SPAWN_ACTION[k]}`)).join(',');
  useEffect(() => { if (!availableKinds.split(',').includes(kind) && availableKinds) setKind(availableKinds.split(',')[0] as SpawnKind); }, [availableKinds, kind]);
  const count = app.self?.spawnedCount ?? 0;
  const mountable = kind === 'horses' || kind === 'wagons';
  const spawn = () => {
    if (!model) return;
    void runner.self('spawn', SPAWN_ACTION[kind], { model, mount, behavior }, t('label.tools.done'));
  };
  return (
    <div className={cls('tl-spawn', compact && 'is-compact', locked && 'is-locked')} data-tool={tool.id}>
      {locked && <LockNote tool={tool} />}
      <Field label={t('label.tools.kind.label')} help="help.tools.spawnKind" area={tool.area}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={SPAWN_KINDS.filter((k) => app.canAction(`self.${SPAWN_ACTION[k]}`)).map((k) => ({ value: k, label: t(`label.tools.kind.${k}`) }))}
          size="sm"
        />
      </Field>
      <Field label={t('label.tools.model')} help="help.tools.spawnModel" area={tool.area} aside={t('label.tools.modelCount', options.length)}>
        <Combobox value={model} onChange={setModel} options={options} placeholder={t('label.tools.pickModel')} searchPlaceholder={t('label.tools.searchModel')} />
      </Field>
      {/* 2.8.0: picking by name is the way; typing a game model name is for experienced staff */}
      <Fold className="tl-fold">
        <Field label={t('label.tools.modelTyped')} help="help.tools.spawnModelTyped" area={tool.area}>
          <TextInput value={model} onChange={setModel} maxLength={64} placeholder={t('label.tools.searchModel')} />
        </Field>
      </Fold>
      {mountable ? (
        <Field label={t('label.tools.mount')} help="help.tools.mount" area={tool.area} layout="inline">
          <Switch checked={mount} onChange={setMount} size="sm" />
        </Field>
      ) : (
        <Field label={t('label.tools.behavior.label')} help="help.tools.behavior" area={tool.area} layout="inline">
          <Segmented
            value={behavior}
            onChange={setBehavior}
            options={[{ value: 'stand', label: t('label.tools.behavior.stand') }, { value: 'wander', label: t('label.tools.behavior.wander') }]}
            size="sm"
          />
        </Field>
      )}
      {!locked && <ReadyLine missing={model ? [] : [t('label.tools.model')]} />}
      <div className="tl-spawn-foot">
        <ButtonRow>
          <Button help={tool.help} helpLabel={toolLabel(t, tool.id)} area={tool.area} kind="primary" size="sm" busy={runner.busy === 'spawn'} disabled={locked || !app.canAction(`self.${SPAWN_ACTION[kind]}`) || !model || (!!runner.busy && runner.busy !== 'spawn')} onClick={spawn}>
            {toolVerb(t, 'spawn')}
          </Button>
          <Button help={cleanup.help} helpLabel={toolLabel(t, cleanup.id)} area={cleanup.area} kind="ghost" size="sm" busy={runner.busy === cleanup.id} disabled={!canTool(app, cleanup) || count <= 0 || (!!runner.busy && runner.busy !== cleanup.id)} onClick={() => runner.run(cleanup)}>
            {toolLabel(t, cleanup.id)}
          </Button>
        </ButtonRow>
        <span className="tl-spawn-count">
          {t('label.tools.spawned')} <b>{t('label.tools.spawnedOf', count, SPAWN_LIMIT)}</b>
        </span>
      </div>
    </div>
  );
}

/* ── clear the area ──────────────────────────────────────────────────────── */

export function ClearAreaForm({ runner }: { runner: ToolRunner }) {
  const app = useApp();
  const { t } = useI18n();
  const tool = toolById('clearArea')!;
  const [radius, setRadius] = useState<number | null>(30);
  const ok = radius !== null && radius >= 5 && radius <= 100 && radius % 1 === 0;
  const locked = !canTool(app, tool);
  return (
    <div className={cls('tl-form', locked && 'is-locked')} data-tool={tool.id}>
      <div className="tl-row-text">
        <span className="tl-row-label">{toolLabel(t, tool.id)}</span>
        <span className="tl-row-hint">{toolHint(t, tool.id)}</span>
        {locked && <LockNote tool={tool} />}
      </div>
      <div className="tl-form-line">
        <Field label={t('label.tools.radius')} help="help.tools.radius" area={tool.area} layout="inline" className="tl-radius">
          <NumberInput value={radius} onChange={setRadius} min={5} max={100} step={5} integer unit={t('label.tools.metres')} />
        </Field>
        <Button
          help={tool.help}
          helpLabel={toolLabel(t, tool.id)}
          area={tool.area}
          kind="danger"
          size="sm"
          busy={runner.busy === tool.id}
          disabled={locked || !ok || (!!runner.busy && runner.busy !== tool.id)}
          onClick={() => runner.run(tool, { args: { radius }, confirmText: t('label.tools.confirm.clearArea', radius ?? 0) })}
        >
          {toolVerb(t, tool.id)}
        </Button>
      </div>
    </div>
  );
}
