/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/settings/SettingsPage.tsx
 * "Panel settings": this viewer's own preferences. Nothing here reaches the server or other staff;
 * every change applies at once (no save bar).
 *   Language     w_lib's language: switch it for this session (post 'locale' { action: 'set' }) or open
 *                the /w_lib dialog that saves it for good (post 'locale' { action: 'dialog' })
 *   Display      row size (comfortable / compact) · player-table columns · reduced motion, with a live table sample
 *   Help         help mode (remembered)
 *   Reset        back to how it came
 *   Account      name, level, citizen id, session number → the Permissions page
 *   Keys         the keyboard shortcuts
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';
import type { PageProps } from '../../app/pages';
import { allowed, pageById } from '../../app/registry';
import { DEFAULT_PREFS, useApp } from '../../ctx';
import type { Prefs } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, ButtonRow, DataTable, HelpTip, KeyValue, KeyValueList, Meter, Section, Segmented, SettingRow, StatusChip, Switch, fmtCash, useHelp,
} from '../../kit';
import type { Column, HelpFacts } from '../../kit';
import type { AdminPlayer, Lang } from '../../types';
import './settings.css';

function SamplePreview() {
  const app = useApp();
  const { t } = useI18n();
  const rows = app.players.slice(0, 3);
  const cols = useMemo<Column<AdminPlayer>[]>(() => [
    {
      key: 'cid', label: t('label.common.citizen.label'), help: 'help.common.citizenId',
      render: (p) => <><b className="k-num">{p.citizenid}</b> <span className="k-faint k-num">#{p.id}</span></>,
    },
    {
      key: 'name', label: t('label.settings.previewName'), help: 'help.dashboard.col.player',
      render: (p) => <span className="k-cell-main">{`${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.name}</span>,
    },
    { key: 'job', label: t('label.settings.previewJob'), help: 'help.settings.tableMode', render: (p) => p.job?.label ?? '—' },
    { key: 'status', label: t('label.settings.previewStatus'), help: 'help.common.status', render: (p) => <StatusChip status={p.dead ? 'dead' : 'ok'} /> },
    { key: 'cash', label: t('label.settings.previewCash'), help: 'help.settings.tableMode', num: true, priority: 'detail', render: (p) => <span className="k-num">{fmtCash(p.money?.cash)}</span> },
    { key: 'health', label: t('label.settings.previewHealth'), help: 'help.settings.tableMode', num: true, priority: 'detail', render: (p) => <Meter value={p.maxHealth ? (p.health / p.maxHealth) * 100 : null} label={t('label.settings.previewHealth')} /> },
  ], [t]);
  return (
    <div className="cst-preview">
      <div className="cst-preview-head">
        <span>{t('label.settings.preview')}</span>
        <HelpTip help="help.settings.preview" label={t('label.settings.preview')} size="sm" />
      </div>
      <DataTable<AdminPlayer>
        columns={cols}
        rows={rows}
        rowKey={(p) => p.id}
        label={t('label.settings.preview')}
        mode={app.prefs.tableMode}
        density={app.prefs.density}
        className="cst-preview-table"
      />
    </div>
  );
}

const KEYS: { k: string; id: string }[] = [
  { k: 'PgUp', id: 'open' },
  { k: 'F10', id: 'quick' },
  { k: 'Esc', id: 'close' },
  { k: 'Ctrl K', id: 'palette' },
  { k: 'F1', id: 'help' },
  { k: 'Alt ↑ ↓', id: 'pages' },
  { k: '↑ ↓', id: 'rows' },
];

export default function SettingsPage(_: PageProps) {
  const app = useApp();
  const { t, lang } = useI18n();
  const help = useHelp();
  const { prefs, setPrefs } = app;
  const you: HelpFacts = { appliesTo: t('label.settings.appliesYou') };
  const reset = <K extends keyof Prefs>(k: K) => (prefs[k] === DEFAULT_PREFS[k] ? undefined : () => setPrefs({ [k]: DEFAULT_PREFS[k] } as Partial<Prefs>));
  const defOf = (k: 'density' | 'tableMode') => (k === 'density'
    ? t(`label.settings.${DEFAULT_PREFS.density}`)
    : t(DEFAULT_PREFS.tableMode === 'detail' ? 'label.common.detail' : 'label.common.essential'));
  const admin = app.admin;
  const rank = app.rank ?? (admin?.group as string | undefined) ?? '';
  const permsDef = pageById('perms');
  const canPerms = !!permsDef && allowed(permsDef, app);

  const setLang = (v: Lang) => {
    if (v === lang) return;
    void app.act('locale', { action: 'set', locale: v });
  };

  return (
    <div className="cst">
      <p className="cst-note">{t('label.settings.onlyYou')}</p>
      <div className="cst-grid">
        <div className="cst-col">
          <Section title={t('label.settings.language')} help="help.settings.onlyYou">
            <SettingRow
              label={t('label.settings.languageRow')}
              help="help.settings.language"
              description={t('label.settings.languageDesc')}
              facts={you}
              control={(
                <div className="cst-control">
                  <Segmented<Lang>
                    value={lang}
                    onChange={setLang}
                    options={[
                      { value: 'ar', label: t('label.settings.langAr') },
                      { value: 'en', label: t('label.settings.langEn') },
                    ]}
                  />
                </div>
              )}
            />
          </Section>

          <Section title={t('label.settings.display')} help="help.settings.onlyYou">
            <SettingRow
              label={t('label.settings.density')}
              help="help.settings.density"
              description={t('label.settings.densityDesc')}
              facts={you}
              meta={{ def: defOf('density') }}
              dirty={false}
              onReset={reset('density')}
              control={(
                <Segmented<Prefs['density']>
                  value={prefs.density}
                  onChange={(v) => setPrefs({ density: v })}
                  options={[
                    { value: 'comfortable', label: t('label.settings.comfortable') },
                    { value: 'compact', label: t('label.settings.compact') },
                  ]}
                />
              )}
            />
            <SettingRow
              label={t('label.settings.tableMode')}
              help="help.settings.tableMode"
              description={t('label.settings.tableModeDesc')}
              facts={you}
              meta={{ def: defOf('tableMode') }}
              dirty={false}
              onReset={reset('tableMode')}
              control={(
                <Segmented<Prefs['tableMode']>
                  value={prefs.tableMode}
                  onChange={(v) => setPrefs({ tableMode: v })}
                  options={[
                    { value: 'essential', label: t('label.common.essential') },
                    { value: 'detail', label: t('label.common.detail') },
                  ]}
                />
              )}
            />
            <SettingRow
              label={t('label.settings.motion')}
              help="help.settings.motion"
              description={t('label.settings.motionDesc')}
              facts={you}
              meta={{ def: DEFAULT_PREFS.reducedMotion }}
              dirty={false}
              onReset={reset('reducedMotion')}
              control={<Switch checked={prefs.reducedMotion} onChange={(v) => setPrefs({ reducedMotion: v })} />}
            />
            <div className="cst-preview-wrap">
              <SamplePreview />
            </div>
          </Section>

          <Section title={t('label.settings.help')} help="help.settings.helpMode">
            <SettingRow
              label={t('label.settings.helpMode')}
              help="help.settings.helpMode"
              description={t('label.settings.helpModeDesc')}
              facts={you}
              control={<Switch checked={help.helpMode} onChange={(v) => help.setHelpMode(v, true)} />}
            />
          </Section>

          <ButtonRow>
            <Button
              help="help.settings.reset"
              kind="ghost"
              icon="reset"
              onClick={() => {
                setPrefs(DEFAULT_PREFS);
                help.setHelpMode(false, true);
                app.toast('success', t('label.settings.resetDone'));
              }}
            >
              {t('label.settings.reset')}
            </Button>
          </ButtonRow>
        </div>

        <div className="cst-col cst-side">
          <Section title={t('label.settings.account')} help="help.settings.account">
            <KeyValueList>
              <KeyValue label={t('label.settings.accName')} help="help.settings.accName" value={admin?.name} />
              <KeyValue label={t('label.settings.accLevel')} help="help.settings.accLevel" value={rank ? t(`label.common.level.${rank}`) : '—'} />
              <KeyValue label={t('label.settings.accCid')} help="help.settings.accCid" value={admin?.citizenid} copy={admin?.citizenid || undefined} ltr />
              <KeyValue label={t('label.settings.accSession')} help="help.settings.accSession" value={app.selfId ? `#${app.selfId}` : '—'} ltr />
            </KeyValueList>
            {canPerms && (
              <ButtonRow>
                <Button help="help.settings.openPerms" kind="link" size="sm" onClick={() => app.navigate('perms')}>{t('label.settings.openPerms')}</Button>
              </ButtonRow>
            )}
          </Section>

          <Section title={t('label.settings.keys')} help="help.settings.keys">
            <dl className="cst-keys">
              {KEYS.map((x) => (
                <div className="cst-key" key={x.id}>
                  <dt><kbd>{x.k}</kbd></dt>
                  <dd>{t(`label.settings.key.${x.id}`)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
