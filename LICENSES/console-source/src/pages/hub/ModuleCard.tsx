/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/ModuleCard.tsx
 * One script on the hub: its name + "؟", technical name, version and state (text + shape; red only
 * when stopped), one plain line, and its buttons: open its own interface · quick commands (n) ·
 * settings · details. A locked button stays visible with the reason written under it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { memo } from 'react';
import type { MouseEvent } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, Glyph, HelpTip, Tag, cls, inlineHelp } from '../../kit';
import type { ModuleDescriptor } from '../../types';
import { isDown, lockText } from './model';
import { settingsAccess } from './access';
import { StateChip } from './ScriptDrawer';
import Bidi from './Bidi';

export interface ModuleCardProps {
  mod: ModuleDescriptor;
  hasSettings: boolean;
  selected: boolean;
  opening: string | null;
  onOpen(resource: string): void;
  onSelect(resource: string, focus?: 'commands'): void;
  onSettings(resource: string): void;
  onStart(resource: string): void;
}

function ModuleCardImpl({ mod, hasSettings, selected, opening, onOpen, onSelect, onSettings, onStart }: ModuleCardProps) {
  const app = useApp();
  const { t, lt } = useI18n();
  const down = isDown(mod);
  const panelLock = mod.panel?.locked ? lockText(t, lt, mod.panel.locked) : null;
  const sa = settingsAccess(app, mod, t, lt);
  const settingsLock = sa.hard;
  const n = mod.commands?.length ?? 0;
  const label = lt(mod.label);

  /* a click on the card's empty space opens the details (the buttons keep their own action) */
  const onCard = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, [role="switch"]')) return;
    onSelect(mod.resource);
  };

  return (
    <article className={cls('hub-card', selected && 'is-selected', down && 'is-down')} onClick={onCard} aria-label={label} data-res={mod.resource}>
      <header className="hub-card-head">
        <h3 className="hub-card-title">
          <span className="k-ellipsis">{label}</span>
          <HelpTip help={inlineHelp(mod.help)} label={label} size="sm" />
        </h3>
        <StateChip mod={mod} />
      </header>
      <div className="hub-card-meta">
        <span className="k-mono">{mod.resource}</span>
        <span className="hub-dot" aria-hidden="true">·</span>
        <span className="k-num">{mod.version ? t('label.hub.version', mod.version) : t('label.hub.noVersion')}</span>
        {mod.settings?.overridden ? <span className="hub-tagwrap"><Tag tone="faint">{t('label.hub.overridden', mod.settings.overridden)}</Tag><HelpTip help="help.hub.overridden" label={t('label.hub.overridden', mod.settings.overridden)} size="sm" /></span> : null}
      </div>
      <p className="hub-card-desc"><Bidi text={lt(mod.description)} /></p>
      {mod.panel && <p className="hub-card-how"><span className="k-faint">{t('label.hub.howPrefix')}</span> <Bidi text={lt(mod.panel.how)} /></p>}
      <div className="hub-card-actions">
        {mod.panel && (
          <Button
            help={panelLock ? 'help.hub.openLocked' : 'help.hub.open'}
            size="sm"
            icon="external"
            area="scripts"
            locked={!!panelLock}
            lockReason={panelLock ?? undefined}
            disabled={down}
            busy={opening === mod.resource}
            onClick={() => onOpen(mod.resource)}
          >
            {opening === mod.resource ? t('label.hub.opening') : t('label.hub.open')}
          </Button>
        )}
        {n > 0 && (
          <Button help="help.hub.commandsBtn" size="sm" onClick={() => onSelect(mod.resource, 'commands')}>{t('label.hub.commands', n)}</Button>
        )}
        {hasSettings && (
          <Button help="help.hub.settingsBtn" size="sm" icon="sliders" locked={!!settingsLock} lockReason={settingsLock ?? undefined} onClick={() => onSettings(mod.resource)}>{t('label.hub.settings')}</Button>
        )}
        {down && <Button help="help.hub.start" size="sm" area="resources" onClick={() => onStart(mod.resource)}>{t('label.hub.start')}</Button>}
        <Button help="help.hub.details" size="sm" kind="link" className="hub-card-more" onClick={() => onSelect(mod.resource)}>{t('label.hub.details')}</Button>
      </div>
      {(panelLock || (hasSettings && (settingsLock || sa.soft))) && <p className="hub-lock hub-lock--text"><Glyph name="lock" /><span>{panelLock ?? settingsLock ?? sa.soft}</span></p>}
    </article>
  );
}

const ModuleCard = memo(ModuleCardImpl);
export default ModuleCard;
