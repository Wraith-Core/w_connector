/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/QuickCommand.tsx
 * One quick command of a script, as a form: every argument has its label and "؟"; a player argument
 * is a CitizenIdInput (the text as typed goes to the server, w.citizen resolves it; '#5' is a session
 * number); "Run" posts scripts.run and shows the script's answer. A destructive command asks once
 * more in a red dialog. Locked by level (area scriptsRun + the command's level) with the reason shown.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, CitizenIdInput, Field, HelpTip, LockLine, NumberInput, Section, Select, Switch, TextInput, inlineHelp } from '../../kit';
import type { CitizenState } from '../../kit';
import type { QuickArg, QuickCommand as Cmd } from '../../types';
import { levelOk, lockText, rankOf, sameCitizen } from './model';

type ArgValue = string | number | boolean | null;

const initial = (a: QuickArg): ArgValue => {
  if (a.default !== undefined) return a.default;
  if (a.type === 'bool') return false;
  if (a.type === 'int' || a.type === 'number') return null;
  if (a.type === 'select') return a.options?.[0]?.value ?? '';
  return '';
};

export default function QuickCommand({ resource, cmd, down }: { resource: string; cmd: Cmd; down: boolean }) {
  const app = useApp();
  const { t, lt, lang } = useI18n();
  const rank = rankOf(app);
  const [vals, setVals] = useState<Record<string, ArgValue>>(() => Object.fromEntries(cmd.args.map((a) => [a.key, initial(a)])));
  const [who, setWho] = useState<Record<string, CitizenState>>({});
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ ok: boolean; text: string } | null>(null);

  const levelBlocked = !levelOk(rank, cmd.level);
  const lockMsg = cmd.locked ? lockText(t, lt, cmd.locked) : levelBlocked ? t('label.hub.lockedLevel', t(`label.common.level.${cmd.level}`)) : null;
  const locked = !!lockMsg || !app.can('scriptsRun');
  const set = (k: string, v: ArgValue) => setVals((m) => ({ ...m, [k]: v }));

  /* every required box filled, numbers in range, a player that exists (and is online when needed) */
  const problem = useMemo(() => {
    for (const a of cmd.args) {
      const v = vals[a.key];
      const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
      if (a.required && empty) return t('label.hub.cmd.fillRequired');
      if (empty) continue;
      if ((a.type === 'int' || a.type === 'number') && typeof v === 'number') {
        if ((a.min !== undefined && v < a.min) || (a.max !== undefined && v > a.max)) return t('label.hub.invalid.range');
        if (a.type === 'int' && v % 1 !== 0) return t('label.hub.invalid.integer');
      }
      if (a.type === 'text' && typeof v === 'string' && a.maxLength !== undefined && v.length > a.maxLength) return t('label.hub.invalid.length');
      if (a.type === 'citizen') {
        const s = who[a.key];
        if (!s || s.kind === 'checking') return t('label.common.citizen.checking');
        if (s.kind === 'invalid') return t('label.common.citizen.invalid');
        if (s.kind === 'notFound') return t('label.common.citizen.notFound');
        if (s.kind === 'found' && cmd.needsOnline && !s.preview.online) return t('label.hub.cmd.offline');
      }
    }
    return null;
  }, [cmd, vals, who, t]);

  const summary = () => cmd.args.map((a) => {
    const v = vals[a.key];
    const s = who[a.key];
    const shown = a.type === 'citizen' && s?.kind === 'found' ? `${s.preview.name || s.preview.citizenid} (${s.preview.citizenid})`
      : a.type === 'bool' ? t(v ? 'label.hub.value.on' : 'label.hub.value.off')
        : a.type === 'select' ? lt(a.options?.find((o) => o.value === v)?.label) || String(v ?? '')
          : String(v ?? '—');
    return `${lt(a.label)} = ${shown}`;
  }).join(lang === 'ar' ? '، ' : ', ');

  const run = async () => {
    setBusy(true);
    try {
      const args: Record<string, ArgValue> = {};
      for (const a of cmd.args) {
        const v = vals[a.key];
        args[a.key] = typeof v === 'string' ? v.trim() : v;
      }
      const r = await app.act<{ output?: string }>('scripts', { action: 'run', resource, command: cmd.id, args });
      setOutput({ ok: r.ok, text: r.ok ? (r.data?.output ?? r.message ?? '') : t(r.error ?? 'label.hub.reject.other') });
    } finally {
      setBusy(false);
    }
  };

  const onRun = () => {
    if (problem || locked) return;
    if (cmd.danger) {
      app.confirm({
        title: t('label.hub.cmd.confirmTitle', lt(cmd.label)),
        text: t('label.hub.cmd.confirmText', summary()),
        help: 'help.hub.cmd.runDanger',
        danger: true,
        undoable: false,
        confirmLabel: t('label.hub.cmd.run'),
        onConfirm: () => { void run(); },
      });
    } else void run();
  };

  const dis = locked || down;
  return (
    <Section title={lt(cmd.label)} help={inlineHelp(cmd.help)} facts={{ level: cmd.level }} tone={cmd.danger ? 'danger' : 'default'} className="hub-cmd">
      {/* the lock line already names the level; the script's own reason (text, or the permission it
          checks) is added only when there is one, so a level-only lock is not said twice */}
      {lockMsg && (
        <p className="hub-lock">
          <LockLine level={cmd.locked?.level ?? (levelBlocked ? cmd.level : null)} />
          {(cmd.locked?.text || cmd.locked?.ace) && <span>{lockMsg}</span>}
        </p>
      )}
      <div className="hub-cmd-args">
        {cmd.args.map((a) => {
          const v = vals[a.key];
          const label = lt(a.label);
          const help = inlineHelp(a.help);
          return (
            <Field key={a.key} label={label} help={help} required={a.required} className={a.type === 'text' || a.type === 'citizen' ? 'hub-cmd-wide' : undefined}
              hint={a.type === 'citizen' && cmd.needsOnline ? <span className="hub-hintline">{t('label.hub.cmd.online')}<HelpTip help="help.hub.cmd.online" label={t('label.hub.cmd.online')} size="sm" /></span> : undefined}>
              {a.type === 'citizen' ? (
                <CitizenIdInput value={typeof v === 'string' ? v : ''} onChange={(s) => set(a.key, s)} onResolved={(s) => setWho((m) => (sameCitizen(m[a.key], s) ? m : { ...m, [a.key]: s }))} needsOnline={cmd.needsOnline} disabled={dis} />
              ) : a.type === 'int' || a.type === 'number' ? (
                <NumberInput value={typeof v === 'number' ? v : null} onChange={(n) => set(a.key, n)} min={a.min} max={a.max} step={a.step ?? (a.type === 'int' ? 1 : 0.1)} integer={a.type === 'int'} showRange={a.min !== undefined || a.max !== undefined} disabled={dis} />
              ) : a.type === 'bool' ? (
                <Switch checked={v === true} onChange={(b) => set(a.key, b)} disabled={dis} />
              ) : a.type === 'select' ? (
                <Select value={typeof v === 'string' ? v : ''} onChange={(s) => set(a.key, s)} options={(a.options ?? []).map((o) => ({ value: o.value, label: lt(o.label) }))} disabled={dis} />
              ) : (
                <TextInput value={typeof v === 'string' ? v : ''} onChange={(s) => set(a.key, s)} disabled={dis} suffix={a.maxLength ? <span className="k-num k-faint">{`${(typeof v === 'string' ? v : '').length}/${a.maxLength}`}</span> : undefined} />
              )}
            </Field>
          );
        })}
      </div>
      <div className="hub-cmd-foot">
        <Button
          help={cmd.danger ? 'help.hub.cmd.runDanger' : 'help.hub.cmd.run'}
          kind={cmd.danger ? 'danger' : 'primary'}
          area="scriptsRun"
          facts={{ level: cmd.level }}
          disabled={!!problem || dis}
          busy={busy}
          onClick={onRun}
        >
          {busy ? t('label.hub.cmd.running') : t('label.hub.cmd.run')}
        </Button>
        {problem && !locked && <span className="hub-cmd-why">{problem}</span>}
      </div>
      {output && (
        <div className={output.ok ? 'hub-output' : 'hub-output is-error'} role="status">
          <span className="hub-output-title">
            <span>{t('label.hub.cmd.output')}</span>
            <HelpTip help="help.hub.cmd.output" label={t('label.hub.cmd.output')} size="sm" />
          </span>
          <pre className="k-mono">{output.text || '—'}</pre>
        </div>
      )}
    </Section>
  );
}
