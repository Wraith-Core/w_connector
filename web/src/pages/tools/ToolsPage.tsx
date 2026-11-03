/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/tools/ToolsPage.tsx  ("أدواتي" / My tools)
 * The admin's own tools as a real page: a status band (what is on, where you are, how many spawns),
 * then one section per kind of tool in balanced columns. Toggles say "مفعّل / متوقف" as text;
 * actions are verb buttons; a tool above the admin's level stays visible, locked, with the level.
 * The same tools.ts feeds the PgUp quick menu and the command palette.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, InlineAlert, KeyValue, KeyValueList, PageActions, Section, Tag, cls, fmtCoords, vec3,
} from '../../kit';
import { ClearAreaForm, CoordsJump, NoclipSpeed, SpawnForm, ToolRow } from './forms';
import { SECTION_HELP, SPAWN_LIMIT, TOOLS, activeTools, toolLabel, useToolRunner } from './tools';
import type { ToolRunner, ToolSection } from './tools';

const LEADS: Partial<Record<ToolSection, string>> = {
  me: 'label.tools.lead.me', travel: 'label.tools.lead.travel', spawn: 'label.tools.lead.spawn', dev: 'label.tools.lead.dev',
};

function ToolSectionView({ id, runner, focus }: { id: ToolSection; runner: ToolRunner; focus: boolean }) {
  const { t } = useI18n();
  const rows = TOOLS.filter((x) => x.section === id && x.kind !== 'form');
  const lead = LEADS[id];
  return (
    <Section
      id={`tl-sec-${id}`}
      title={t(`label.tools.section.${id}`)}
      help={SECTION_HELP[id]}
      lead={lead ? t(lead) : undefined}
      className={cls('tl-sec', focus && 'is-focus')}
    >
      {id === 'spawn' ? <SpawnForm runner={runner} /> : (
        <div className="tl-rows">
          {rows.map((tool) => <ToolRow key={tool.id} tool={tool} runner={runner} />)}
          {id === 'me' && <NoclipSpeed runner={runner} stacked />}
          {id === 'travel' && <CoordsJump runner={runner} />}
          {id === 'dev' && <ClearAreaForm runner={runner} />}
        </div>
      )}
    </Section>
  );
}

export default function ToolsPage({ route }: PageProps) {
  const app = useApp();
  const { t, rtl } = useI18n();
  const runner = useToolRunner();
  const self = app.self;
  const active = activeTools(self);
  const focus = route.params.focus ?? '';
  const focusSection = TOOLS.find((x) => x.id === focus)?.section ?? (['me', 'health', 'travel', 'spawn', 'vehicle', 'dev'].includes(focus) ? focus : '');
  const root = useRef<HTMLDivElement>(null);

  /* the command palette opens a form tool here: bring its section into view */
  useEffect(() => {
    if (!focusSection) return;
    const el = root.current?.querySelector<HTMLElement>(`#tl-sec-${focusSection}`);
    el?.scrollIntoView({ block: 'start' });
    /* the tool's first real control (never its "؟") */
    const tool = el?.querySelector<HTMLElement>(`[data-tool="${focus}"]`);
    tool?.querySelector<HTMLElement>('input, [role="radio"][aria-checked="true"], [role="switch"], .k-select, .k-btn:not(:disabled)')?.focus();
  }, [focus, focusSection]);

  const sep = rtl ? '، ' : ', ';
  const spectating = self?.spectating ? self.spectating : 0;
  return (
    <div className="tl-page" ref={root}>
      <PageActions>
        <Button help="help.tools.openQuick" kind="ghost" kbd="PgUp" onClick={() => app.setMode('quick')}>{t('label.tools.openQuick')}</Button>
      </PageActions>

      {spectating > 0 && (
        <InlineAlert
          tone="warn"
          className="tl-watch"
          title={t('label.tools.watching', `#${spectating}`)}
          help="help.tools.stopSpectate"
          actions={(
            <Button help="help.tools.stopSpectate" size="sm" area="players" busy={runner.busy === 'stopSpectate'} onClick={() => { void runner.self('stopSpectate', 'stopSpectate'); }}>
              {t('label.tools.do.stopSpectate')}
            </Button>
          )}
        />
      )}

      <Section title={t('label.tools.section.status')} help="help.tools.section.status" className="tl-status">
        <KeyValueList columns={3}>
          <KeyValue
            label={t('label.tools.active')}
            help="help.tools.active"
            value={active.length ? (
              <span className="tl-active" title={active.map((x) => toolLabel(t, x.id)).join(sep)}>
                {active.map((x) => <Tag key={x.id} tone="strong">{toolLabel(t, x.id)}</Tag>)}
              </span>
            ) : <span className="k-faint">{t('label.tools.activeNone')}</span>}
          />
          <KeyValue
            label={t('label.tools.position')}
            help="help.tools.position"
            value={self?.coords ? fmtCoords(self.coords) : null}
            copy={self?.coords ? vec3(self.coords) : undefined}
            ltr
          />
          <KeyValue
            label={t('label.tools.spawned')}
            help="help.tools.spawned"
            value={t('label.tools.spawnedOf', self?.spawnedCount ?? 0, SPAWN_LIMIT)}
          />
        </KeyValueList>
      </Section>

      <div className="tl-grid">
        {(['me', 'health', 'travel', 'vehicle', 'spawn', 'dev'] as const).map((id) => (
          <ToolSectionView key={id} id={id} runner={runner} focus={focusSection === id} />
        ))}
      </div>
    </div>
  );
}
