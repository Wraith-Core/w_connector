/* Bans: the table from the 'bans' message, with search and unban (confirmed) */

import { useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Button, Empty, Input, Loading, Tag } from '../ui/controls';
import { cls, fmtDate, nowSec } from '../ui/util';

export default function BansTab() {
  const t = useT();
  const { bans, act, confirm, refresh } = useApp();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    if (!bans) return [];
    const needle = q.trim().toLowerCase();
    const l = needle
      ? bans.filter((b) => (b.name || '').toLowerCase().includes(needle) || (b.reason || '').toLowerCase().includes(needle) || (b.license || '').toLowerCase().includes(needle) || (b.bannedby || '').toLowerCase().includes(needle) || String(b.id) === needle)
      : bans;
    return [...l].sort((a, b) => b.id - a.id);
  }, [bans, q]);

  const askUnban = (id: number, name: string) => confirm({
    title: t('ui_c_unban_title', name),
    text: t('ui_c_unban_text'),
    confirmLabel: t('ui_bans_unban'),
    onConfirm: async () => {
      const r = await act('bans', { action: 'unban', id }, { okText: t('ui_done') });
      if (r.ok) refresh('bans');
    },
  });

  const now = nowSec();

  return (
    <div className="wa-bans">
      <div className="wa-toolbar">
        <Input glyph="search" value={q} onChange={setQ} placeholder={t('ui_search')} className="wa-toolbar-search" />
        <span className="wa-toolbar-count">{t('ui_bans_count', rows.length)}</span>
        <Button size="sm" kind="ghost" glyph="refresh" onClick={() => refresh('bans')}>{t('ui_refresh')}</Button>
      </div>

      {bans === null ? (
        <Loading text={t('ui_bans_waiting')} />
      ) : rows.length === 0 ? (
        <Empty text={t('ui_bans_none')} glyph="bans" />
      ) : (
        <div className="wa-table-wrap">
          <table className="wa-table wa-table--bans">
            <thead>
              <tr>
                <th className="is-num">{t('ui_col_id')}</th>
                <th>{t('ui_bans_col_name')}</th>
                <th>{t('ui_bans_col_reason')}</th>
                <th>{t('ui_bans_col_by')}</th>
                <th>{t('ui_bans_col_created')}</th>
                <th>{t('ui_bans_col_expire')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const perm = !b.expire || b.expire === 0;
                const expired = !perm && b.expire < now;
                return (
                  <tr key={b.id} className={cls(expired && 'is-dim')}>
                    <td className="is-num"><b dir="ltr">{b.id}</b></td>
                    <td className="wa-td-name">
                      <span className="wa-td-name-main">{b.name || '—'}</span>
                      <span className="wa-td-name-sub" dir="ltr">{b.license}</span>
                    </td>
                    <td className="wa-td-wrap">{b.reason || '—'}</td>
                    <td>{b.bannedby || '—'}</td>
                    <td dir="ltr">{fmtDate(b.created)}</td>
                    <td>
                      {perm ? <Tag tone="bad">{t('ui_bans_perm')}</Tag> : expired ? <Tag tone="dim">{t('ui_bans_expired')}</Tag> : <span dir="ltr">{fmtDate(b.expire)}</span>}
                    </td>
                    <td className="is-actions">
                      <Button size="sm" kind="ghost" onClick={() => askUnban(b.id, b.name)}>{t('ui_bans_unban')}</Button>
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
