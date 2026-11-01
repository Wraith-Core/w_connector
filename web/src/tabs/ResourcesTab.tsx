/* Resources: the list from serverInfo.resources with start / stop / restart (stop and restart confirmed) */

import { useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Button, Empty, Input, Loading, Tag } from '../ui/controls';
import { cls } from '../ui/util';

/** The ones whose stop takes the console itself, or the framework, down with it */
const PROTECTED = new Set(['w_admin', 'w_lib', 'w_core', 'oxmysql', 'monitor', 'txAdmin']);

export default function ResourcesTab() {
  const t = useT();
  const { serverInfo, act, confirm, refresh, can } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const list = serverInfo?.resources ?? null;
  const rows = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    const l = needle ? list.filter((r) => r.name.toLowerCase().includes(needle) || r.state.toLowerCase().includes(needle)) : list;
    return [...l].sort((a, b) => a.name.localeCompare(b.name));
  }, [list, q]);
  const running = list ? list.filter((r) => r.state === 'started').length : 0;

  const stateLabel = (s: string) => {
    const key = `ui_res_state_${s}`;
    const v = t(key);
    return v === key ? s : v;
  };

  const run = async (name: string, action: 'startResource' | 'stopResource' | 'restartResource') => {
    setBusy(`${action}:${name}`);
    try {
      const r = await act('server', { action, args: { name } }, { okText: t('ui_done') });
      if (r.ok) window.setTimeout(() => refresh('server'), 800);
    } finally { setBusy(null); }
  };

  const askStop = (name: string) => confirm({
    title: t('ui_c_stop_title', name), text: t('ui_c_stop_text'), danger: true, confirmLabel: t('ui_res_stop'),
    onConfirm: () => run(name, 'stopResource'),
  });
  const askRestart = (name: string) => confirm({
    title: t('ui_c_restart_title', name), text: t('ui_c_restart_text'), danger: true, confirmLabel: t('ui_res_restart'),
    onConfirm: () => run(name, 'restartResource'),
  });

  return (
    <div className="wa-res">
      <div className="wa-toolbar">
        <Input glyph="search" value={q} onChange={setQ} placeholder={t('ui_search')} className="wa-toolbar-search" />
        <span className="wa-toolbar-count">{list ? t('ui_res_count', list.length, running) : ''}</span>
        <Button size="sm" kind="ghost" glyph="refresh" onClick={() => refresh('server')}>{t('ui_refresh')}</Button>
      </div>

      {list === null ? (
        <Loading text={t('ui_loading')} />
      ) : rows.length === 0 ? (
        <Empty text={t('ui_res_none')} glyph="resources" />
      ) : (
        <div className="wa-table-wrap">
          <table className="wa-table wa-table--res">
            <thead>
              <tr>
                <th>{t('ui_res_title')}</th>
                <th>{t('ui_res_state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const prot = PROTECTED.has(r.name);
                const started = r.state === 'started';
                return (
                  <tr key={r.name} className={cls(!started && 'is-dim')}>
                    <td><code dir="ltr" className="wa-res-name">{r.name}</code>{prot && <Tag tone="dim">{t('ui_res_protected')}</Tag>}</td>
                    <td><Tag tone={started ? 'ok' : r.state === 'stopped' ? 'bad' : 'plain'}>{stateLabel(r.state)}</Tag></td>
                    <td className="is-actions">
                      {can('resources') && !prot && (
                        <span className="wa-row wa-row--end">
                          {!started && <Button size="sm" busy={busy === `startResource:${r.name}`} onClick={() => void run(r.name, 'startResource')}>{t('ui_res_start')}</Button>}
                          {started && <Button size="sm" kind="ghost" onClick={() => askRestart(r.name)}>{t('ui_res_restart')}</Button>}
                          {started && <Button size="sm" kind="danger" onClick={() => askStop(r.name)}>{t('ui_res_stop')}</Button>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
