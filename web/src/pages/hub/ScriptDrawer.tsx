/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/ScriptDrawer.tsx
 * The side panel of one script: what it does, how players open its own interface (and the button
 * that opens it for you), its quick commands as forms, its settings, and the script itself (state,
 * technical name, version, "start it" when stopped).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, Drawer, Glyph, HelpTip, KeyValue, KeyValueList, Section, StatusChip, Tag, inlineHelp } from '../../kit';
import type { ModuleDescriptor } from '../../types';
import { isDown, lockText, stateOf } from './model';
import { settingsAccess } from './access';
import QuickCommand from './QuickCommand';
import Bidi from './Bidi';

export interface ScriptDrawerProps {
  mod: ModuleDescriptor;
  hasSettings: boolean;
  /** scroll to the quick commands when the drawer opens from "Quick commands" */
  focus?: 'commands';
  opening: string | null;
  onOpen(resource: string): void;
  onSettings(resource: string): void;
  onStart(resource: string): void;
  onClose(): void;
}

export function StateChip({ mod }: { mod: ModuleDescriptor }) {
  const { t } = useI18n();
  const s = stateOf(mod);
  const label = t(`label.hub.state.${s}`);
  if (s === 'started') return <StatusChip status="running" label={label} />;
  if (s === 'stopped' || s === 'missing') return <StatusChip status="stopped" label={label} />;
  return <StatusChip status="offline" label={label} />;
}

export default function ScriptDrawer({ mod, hasSettings, focus, opening, onOpen, onSettings, onStart, onClose }: ScriptDrawerProps) {
  const app = useApp();
  const { t, lt } = useI18n();
  const cmdRef = useRef<HTMLDivElement>(null);
  const down = isDown(mod);
  const panelLock = mod.panel?.locked ? lockText(t, lt, mod.panel.locked) : null;
  const sa = settingsAccess(app, mod, t, lt);
  const settingsLock = sa.hard ?? sa.soft;
  const commands = mod.commands ?? [];

  useEffect(() => {
    if (focus === 'commands') cmdRef.current?.scrollIntoView({ block: 'start' });
  }, [focus, mod.resource]);

  return (
    <Drawer
      title={lt(mod.label)}
      help={inlineHelp(mod.help)}
      sub={(
        <>
          <span className="k-mono">{mod.resource}</span>
          <span className="k-num">{mod.version ? t('label.hub.version', mod.version) : t('label.hub.noVersion')}</span>
        </>
      )}
      chips={(
        <>
          <StateChip mod={mod} />
          {mod.settings?.overridden ? <span className="hub-tagwrap"><Tag>{t('label.hub.overridden', mod.settings.overridden)}</Tag><HelpTip help="help.hub.overridden" label={t('label.hub.overridden', mod.settings.overridden)} size="sm" /></span> : null}
        </>
      )}
      onClose={onClose}
      className="hub-drawer"
      footer={(
        <>
          {mod.panel && (
            <Button help={panelLock ? 'help.hub.openLocked' : 'help.hub.open'} kind={panelLock ? 'secondary' : 'primary'} icon="external" area="scripts" locked={!!panelLock} lockReason={panelLock ?? undefined} disabled={down} busy={opening === mod.resource} onClick={() => onOpen(mod.resource)}>
              {opening === mod.resource ? t('label.hub.opening') : t('label.hub.open')}
            </Button>
          )}
          {hasSettings && (
            <Button help="help.hub.settingsBtn" icon="sliders" locked={!!sa.hard} lockReason={sa.hard ?? undefined} onClick={() => onSettings(mod.resource)}>{t('label.hub.settings')}</Button>
          )}
          {down && (
            <Button help="help.hub.start" area="resources" onClick={() => onStart(mod.resource)}>{t('label.hub.start')}</Button>
          )}
        </>
      )}
    >
      <Section title={t('label.hub.drawer.about')} help="help.hub.drawer.about" tone="plain">
        <p className="hub-about"><Bidi text={lt(mod.description)} /></p>
        {mod.help && <p className="hub-about k-dim"><Bidi text={lt(mod.help)} /></p>}
      </Section>

      <Section title={t('label.hub.drawer.own')} help="help.hub.drawer.own" tone="plain">
        {mod.panel ? (
          <div className="k-stack k-stack--tight">
            <KeyValueList>
              <KeyValue label={t('label.hub.how')} help="help.hub.how" value={<Bidi text={lt(mod.panel.how)} />} />
            </KeyValueList>
            {mod.panel.note && <p className="hub-note"><Bidi text={lt(mod.panel.note)} /></p>}
            {panelLock && <p className="hub-lock hub-lock--text"><Glyph name="lock" /><span>{panelLock}</span></p>}
          </div>
        ) : <p className="k-faint">{t('label.hub.drawer.noPanel')}</p>}
      </Section>

      <div ref={cmdRef} className="hub-drawer-cmds">
        <Section title={t('label.hub.drawer.commands')} help="help.hub.drawer.commands" tone="plain">
          {commands.length === 0 ? <p className="k-faint">{t('label.hub.drawer.noCommands')}</p>
            : commands.map((c) => <QuickCommand key={c.id} resource={mod.resource} cmd={c} down={down} />)}
        </Section>
      </div>

      <Section title={t('label.hub.drawer.settings')} help="help.hub.drawer.settings" tone="plain">
        {hasSettings ? (
          <div className="k-stack k-stack--tight">
            {mod.settings && <p className="k-dim">{t('label.hub.drawer.settingsInfo', mod.settings.groups, mod.settings.overridden ?? 0)}</p>}
            {settingsLock && <p className="hub-lock hub-lock--text"><Glyph name="lock" /><span>{settingsLock}</span></p>}
          </div>
        ) : <p className="k-faint">{t('label.hub.drawer.noSettings')}</p>}
      </Section>

      <Section title={t('label.hub.drawer.resource')} help="help.hub.drawer.resource" tone="plain">
        <KeyValueList>
          <KeyValue label={t('label.hub.drawer.state')} help="help.hub.state" value={<StateChip mod={mod} />} />
          <KeyValue label={t('label.hub.drawer.name')} help="help.hub.drawer.name" value={mod.resource} copy={mod.resource} ltr />
          <KeyValue label={t('label.hub.drawer.version')} help="help.hub.version" value={mod.version || t('label.hub.noVersion')} ltr={!!mod.version} />
        </KeyValueList>
      </Section>
    </Drawer>
  );
}
