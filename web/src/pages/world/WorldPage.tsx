/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/world/WorldPage.tsx
 * "Weather, time and notices": the world now (weather, live in-game clock, the weather script's cycle),
 * every weather by group, ready times of day, the announcement with its preview, the weather script's
 * own switches (when the server reports them) and the latest world changes from the admin log.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, Gate, InlineAlert, PageActions, Section } from '../../kit';
import type { LogEntry } from '../../types';
import LogTable from '../dashboard/LogTable';
import { useRecentLogs } from '../dashboard/recent';
import { worldCycleOf } from './state';
import { AnnounceControl, CycleControl, TimeControl, WeatherControl, WorldNow, weatherMissing } from './WorldControls';

const WORLD_ACTIONS = new Set(['weather', 'time', 'announce', 'freezeTime', 'dynamicWeather', 'blackout']);
const isWorldLine = (e: LogEntry) => WORLD_ACTIONS.has(e.action);

function History() {
  const { t } = useI18n();
  const { rows, error } = useRecentLogs({ limit: 12, kind: 'server', match: isWorldLine });
  return <LogTable rows={rows} error={error} label={t('label.world.history')} empty={t('label.world.historyEmpty')} className="wld-history" />;
}

export default function WorldPage(_: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const cycle = worldCycleOf(app.serverInfo);
  return (
    <div className="wld-page">
      <PageActions>
        <Button help="help.common.refresh" icon="refresh" onClick={() => { app.refresh('server'); app.refresh('catalog'); }}>
          {t('label.world.refresh')}
        </Button>
      </PageActions>

      <Section title={t('label.world.now')} help="help.world.now">
        <WorldNow variant="full" />
      </Section>
      {weatherMissing(app.serverInfo) && <InlineAlert tone="warn" title={t('label.world.missing')} help="help.world.missing" />}

      <div className="wld-grid">
        <div className="wld-main">
          <Gate area="server">
            <Section title={t('label.world.weather')} help="help.world.weather">
              <WeatherControl variant="full" />
            </Section>
          </Gate>
          <Gate area="server">
            <Section title={t('label.world.time')} help="help.world.time">
              <TimeControl variant="full" />
            </Section>
          </Gate>
          <Section title={t('label.world.history')} help="help.world.history" area="logs">
            <Gate area="logs">{app.can('logs') && <History />}</Gate>
          </Section>
        </div>
        <div className="wld-side">
          <Gate area="server">
            <Section title={t('label.world.announce')} help="help.world.announce">
              <AnnounceControl variant="full" />
            </Section>
          </Gate>
          {cycle && (
            <Gate area="server">
              <Section title={t('label.world.cycle')} help="help.world.cycle">
                <CycleControl />
              </Section>
            </Gate>
          )}
        </div>
      </div>
    </div>
  );
}
