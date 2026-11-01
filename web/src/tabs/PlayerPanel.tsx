/* ════════════════════════════════════════════════════════════════════════════
 * The selected player's panel: every action grouped, each group hidden when the permission is missing.
 * Every call goes through post('player', { id, action, args }); the server re-checks every one of them.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { Button, Field, Input, NumberInput, Section, Select, Slider, Tag, TextArea } from '../ui/controls';
import Glyph from '../ui/Glyph';
import { cls, fmtCoords, fmtNum } from '../ui/util';
import type { AdminPlayer } from '../types';

const DURATIONS: { key: string; minutes: number }[] = [
  { key: 'ui_dur_1h', minutes: 60 },
  { key: 'ui_dur_6h', minutes: 360 },
  { key: 'ui_dur_1d', minutes: 1440 },
  { key: 'ui_dur_3d', minutes: 4320 },
  { key: 'ui_dur_1w', minutes: 10080 },
  { key: 'ui_dur_1m', minutes: 43200 },
  { key: 'ui_dur_perm', minutes: 0 },
];

export default function PlayerPanel({ player: p, onClose }: { player: AdminPlayer; onClose(): void }) {
  const t = useT();
  const { act, confirm, can, catalog, selfId, self } = useApp();
  const isMe = p.id === selfId;
  const [page, setPage] = useState('overview');
  const pages = ['overview', ...(can('teleport') ? ['travel'] : []), ...(can('revive') || can('needs') ? ['vitals'] : []), ...(can('job') || can('money') ? ['economy'] : []), ...(can('items') ? ['inventory'] : []), 'moderation'];
  useEffect(() => { setPage('overview'); }, [p.id]);
  useEffect(() => { if (!pages.includes(page)) setPage('overview'); }, [pages.join('|'), page]);

  /* Local form state, reset when another player is picked */
  const [tp, setTp] = useState({ x: 0, y: 0, z: 0 });
  const [hunger, setHunger] = useState(p.needs?.hunger ?? 100);
  const [thirst, setThirst] = useState(p.needs?.thirst ?? 100);
  const [stamina, setStamina] = useState(p.stamina ?? p.needs?.stamina ?? 100);
  const [job, setJob] = useState(p.job?.name ?? '');
  const [jobGrade, setJobGrade] = useState(String(p.job?.grade ?? 0));
  const [gang, setGang] = useState(p.gang?.name ?? '');
  const [gangGrade, setGangGrade] = useState(String(p.gang?.grade ?? 0));
  const [moneyType, setMoneyType] = useState<'cash' | 'gold' | 'bank'>('cash');
  const [moneyOp, setMoneyOp] = useState<'add' | 'remove' | 'set'>('add');
  const [amount, setAmount] = useState(100);
  const [itemQ, setItemQ] = useState('');
  const [item, setItem] = useState('');
  const [count, setCount] = useState(1);
  const [notify, setNotify] = useState('');
  const frozen = p.frozen === true;
  const spectating = self?.spectating === p.id;
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(1440);
  const [customDur, setCustomDur] = useState(false);
  const [group, setGroup] = useState(p.group ?? 'user');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setTp({ x: Math.round(p.coords?.x ?? 0), y: Math.round(p.coords?.y ?? 0), z: Math.round(p.coords?.z ?? 0) });
    setHunger(p.needs?.hunger ?? 100);
    setThirst(p.needs?.thirst ?? 100);
    setStamina(p.stamina ?? p.needs?.stamina ?? 100);
    setJob(p.job?.name ?? ''); setJobGrade(String(p.job?.grade ?? 0));
    setGang(p.gang?.name ?? ''); setGangGrade(String(p.gang?.grade ?? 0));
    setGroup(p.group ?? 'user');
    setReason(''); setNotify(''); setItem(''); setItemQ('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const run = async (key: string, action: string, args: unknown = {}, okText?: string) => {
    setBusy(key);
    try { return await act('player', { id: p.id, action, args }, { okText }); } finally { setBusy(null); }
  };

  const jobs = catalog?.jobs ?? [];
  const gangs = catalog?.gangs ?? [];
  const jobGrades = useMemo(() => jobs.find((j) => j.name === job)?.grades ?? [], [jobs, job]);
  const gangGrades = useMemo(() => gangs.find((g) => g.name === gang)?.grades ?? [], [gangs, gang]);

  const items = useMemo(() => {
    const all = catalog?.items ?? [];
    const needle = itemQ.trim().toLowerCase();
    const list = needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || (i.label || '').toLowerCase().includes(needle)) : all;
    return list.slice(0, 100);
  }, [catalog, itemQ]);

  const durLabel = (m: number) => (m === 0 ? t('ui_dur_perm') : DURATIONS.find((d) => d.minutes === m) ? t(DURATIONS.find((d) => d.minutes === m)!.key) : t('ui_dur_minutes', m));

  const askKick = () => {
    const r = reason.trim();
    if (!r) return;
    confirm({
      title: t('ui_c_kick_title', p.name),
      text: t('ui_c_kick_text'),
      danger: true,
      confirmLabel: t('ui_a_kick'),
      onConfirm: async () => { await run('kick', 'kick', { reason: r }, t('ui_done')); onClose(); },
    });
  };

  const askBan = () => {
    const r = reason.trim();
    if (!r) return;
    confirm({
      title: t('ui_c_ban_title', p.name),
      text: t('ui_c_ban_text', r, durLabel(duration)),
      danger: true,
      confirmLabel: t('ui_a_ban'),
      onConfirm: async () => { await run('ban', 'ban', { reason: r, duration: Math.max(0, Math.round(duration)) }, t('ui_done')); onClose(); },
    });
  };

  const askClearInv = () => confirm({
    title: t('ui_c_clear_inv_title', p.name),
    text: t('ui_c_clear_inv_text'),
    danger: true,
    confirmLabel: t('ui_a_clear_inv'),
    onConfirm: async () => { await run('clearInventory', 'clearInventory', {}, t('ui_done')); },
  });

  const reasonOk = reason.trim().length > 0;

  return (
    <aside className="wa-panel">
      <header className="wa-panel-head">
        <div className="wa-panel-id" dir="ltr">#{p.id}</div>
        <div className="wa-panel-who">
          <div className="wa-panel-name">{p.name}</div>
          <div className="wa-panel-sub">
            {`${p.firstname ?? ''} ${p.lastname ?? ''}`.trim()}
            {p.dead ? <Tag tone="bad">{t('ui_dead')}</Tag> : <Tag tone="ok">{t('ui_alive')}</Tag>}
            {p.group && <Tag tone="dim">{p.group}</Tag>}
          </div>
        </div>
        <button type="button" className="wa-panel-close" onClick={onClose} title={t('ui_close_panel')}><Glyph name="close" /></button>
      </header>

      <div className="wa-subnav" aria-label={t('ui_player_sections')}>{pages.map((key) => <button type="button" key={key} aria-pressed={page === key} className={cls('wa-subtab', page === key && 'is-active')} onClick={() => setPage(key)}>{t(`ui_player_${key}`)}</button>)}</div>
      <div className="wa-panel-body">
      {page === 'overview' && <dl className="wa-kv">
        <dt>{t('ui_citizenid')}</dt><dd><bdi dir="ltr">{p.citizenid || '—'}</bdi></dd>
        <dt>{t('ui_col_job')}</dt><dd>{p.job?.label ?? '—'} · {p.job?.gradeName ?? p.job?.grade ?? ''} <span className={cls('wa-duty', p.job?.onDuty && 'is-on')} /></dd>
        <dt>{t('ui_col_gang')}</dt><dd>{p.gang?.label ?? '—'}{p.gang?.gradeName ? ` · ${p.gang.gradeName}` : ''}</dd>
        <dt>{t('ui_col_cash')} / {t('ui_col_gold')}</dt><dd><bdi dir="ltr">${fmtNum(p.money?.cash ?? 0)} · {fmtNum(p.money?.gold ?? 0, 2)}</bdi></dd>
        <dt>{t('ui_col_health')}</dt><dd><bdi dir="ltr">{Math.round(p.health)} / {p.maxHealth}</bdi></dd>
        <dt>{t('ui_col_stamina')}</dt><dd><bdi dir="ltr">{Math.round(p.stamina ?? p.needs?.stamina ?? 100)}%</bdi></dd>
        <dt>{t('ui_col_ping')}</dt><dd><bdi dir="ltr">{p.ping} ms</bdi></dd>
        <dt>{t('ui_coords')}</dt><dd><bdi dir="ltr">{fmtCoords(p.coords)}</bdi></dd>
        {p.discord && <><dt>{t('ui_discord')}</dt><dd><bdi dir="ltr">{p.discord}</bdi></dd></>}
      </dl>}
        {page === 'travel' && can('teleport') && (
          <Section title={t('ui_g_teleport')}>
            <div className="wa-row">
              <Button glyph="arrow" disabled={isMe} busy={busy === 'teleportTo'} onClick={() => void run('teleportTo', 'teleportTo', {}, t('ui_done'))}>{t('ui_a_goto')}</Button>
              <Button glyph="pin" disabled={isMe} busy={busy === 'bring'} onClick={() => void run('bring', 'bring', {}, t('ui_done'))}>{t('ui_a_bring')}</Button>
              <Button kind="ghost" disabled={isMe || !p.canReturn} busy={busy === 'bringBack'} onClick={() => void run('bringBack', 'bringBack', {}, t('ui_done'))}>{t('ui_a_bring_back')}</Button>
            </div>
            <div className="wa-row wa-row--coords">
              <Field label={t('ui_a_x')}><NumberInput value={tp.x} onChange={(x) => setTp({ ...tp, x })} step={0.1} /></Field>
              <Field label={t('ui_a_y')}><NumberInput value={tp.y} onChange={(y) => setTp({ ...tp, y })} step={0.1} /></Field>
              <Field label={t('ui_a_z')}><NumberInput value={tp.z} onChange={(z) => setTp({ ...tp, z })} step={0.1} /></Field>
              <Button kind="ghost" busy={busy === 'tpCoords'} onClick={() => void run('tpCoords', 'tpCoords', tp, t('ui_done'))}>{t('ui_a_tp_coords')}</Button>
            </div>
          </Section>
        )}

        {page === 'vitals' && can('revive') && (
          <Section title={t('ui_g_health')}>
            <div className="wa-row">
              <Button glyph="heart" busy={busy === 'revive'} onClick={() => { setHunger(100); setThirst(100); setStamina(100); void run('revive', 'revive', {}, t('ui_done')); }}>{t('ui_a_revive')}</Button>
              <Button glyph="check" busy={busy === 'heal'} onClick={() => { setHunger(100); setThirst(100); setStamina(100); void run('heal', 'heal', {}, t('ui_done')); }}>{t('ui_a_heal')}</Button>
            </div>
          </Section>
        )}

        {page === 'vitals' && can('needs') && (
          <Section title={t('ui_g_needs')}>
            {p.needs ? (
              <>
                <Slider label={<><Glyph name="food" /> {t('ui_a_hunger')}</>} value={hunger} onChange={setHunger} unit="%" />
                <Slider label={<><Glyph name="water" /> {t('ui_a_thirst')}</>} value={thirst} onChange={setThirst} unit="%" />
                <Slider label={<><Glyph name="bolt" /> {t('ui_a_stamina')}</>} value={stamina} onChange={setStamina} unit="%" />
                <div className="wa-row">
                  <Button busy={busy === 'needs'} onClick={() => void run('needs', 'needs', { hunger: Math.round(hunger), thirst: Math.round(thirst), stamina: Math.round(stamina) }, t('ui_done'))}>{t('ui_a_apply_needs')}</Button>
                  <Button kind="ghost" busy={busy === 'refill'} onClick={() => { setHunger(100); setThirst(100); setStamina(100); void run('refill', 'needs', { hunger: 100, thirst: 100, stamina: 100 }, t('ui_done')); }}>{t('ui_a_refill')}</Button>
                </div>
              </>
            ) : (
              <p className="wa-dim">{t('ui_a_no_needs')}</p>
            )}
          </Section>
        )}

        {page === 'economy' && can('job') && (
          <Section title={t('ui_g_job')}>
            <div className="wa-row">
              <Field label={t('ui_a_job')}>
                <Select value={job} onChange={(v) => { setJob(v); setJobGrade('0'); }} options={jobs.map((j) => ({ value: j.name, label: j.label || j.name }))} placeholder="—" />
              </Field>
              <Field label={t('ui_a_grade')}>
                <Select value={jobGrade} onChange={setJobGrade} options={jobGrades.map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }))} />
              </Field>
              <Button disabled={!job} busy={busy === 'setJob'} onClick={() => void run('setJob', 'setJob', { name: job, grade: Number(jobGrade) || 0 }, t('ui_done'))}>{t('ui_a_set_job')}</Button>
            </div>
            <div className="wa-row">
              <Field label={t('ui_a_gang')}>
                <Select value={gang} onChange={(v) => { setGang(v); setGangGrade('0'); }} options={gangs.map((g) => ({ value: g.name, label: g.label || g.name }))} placeholder="—" />
              </Field>
              <Field label={t('ui_a_grade')}>
                <Select value={gangGrade} onChange={setGangGrade} options={gangGrades.map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }))} />
              </Field>
              <Button disabled={!gang} busy={busy === 'setGang'} onClick={() => void run('setGang', 'setGang', { name: gang, grade: Number(gangGrade) || 0 }, t('ui_done'))}>{t('ui_a_set_gang')}</Button>
            </div>
          </Section>
        )}

        {page === 'economy' && can('money') && (
          <Section title={t('ui_g_money')}>
            <div className="wa-row">
              <div className="wa-seg" role="radiogroup">
                {(['cash', 'gold', 'bank'] as const).map((k) => (
                  <button key={k} type="button" className={cls('wa-seg-btn', moneyType === k && 'is-on')} onClick={() => setMoneyType(k)}>{t(`ui_a_${k}`)}</button>
                ))}
              </div>
              <div className="wa-seg" role="radiogroup">
                {(['add', 'remove', 'set'] as const).map((k) => (
                  <button key={k} type="button" className={cls('wa-seg-btn', moneyOp === k && 'is-on')} onClick={() => setMoneyOp(k)}>{t(`ui_a_${k}`)}</button>
                ))}
              </div>
            </div>
            <div className="wa-row">
              <Field label={t('ui_a_amount')}><NumberInput value={amount} onChange={setAmount} min={0} step={moneyType === 'gold' ? 0.01 : 1} /></Field>
              <Button glyph="coin" disabled={amount < 0} busy={busy === 'money'} onClick={() => void run('money', 'money', { type: moneyType, op: moneyOp, amount }, t('ui_done'))}>{t('ui_apply')}</Button>
            </div>
          </Section>
        )}

        {page === 'inventory' && can('items') && (
          <Section title={t('ui_g_items')}>
            <Input glyph="search" value={itemQ} onChange={setItemQ} placeholder={t('ui_a_item_search')} />
            <div className="wa-picklist" role="listbox">
              {items.length === 0 ? (
                <div className="wa-dim wa-picklist-empty">{t('ui_a_item_none')}</div>
              ) : items.map((i) => (
                <button
                  key={i.name}
                  type="button"
                  role="option"
                  aria-selected={item === i.name}
                  className={cls('wa-pick', item === i.name && 'is-on')}
                  onClick={() => setItem(i.name)}
                >
                  <span className="wa-pick-label">{i.label || i.name}</span>
                  <code dir="ltr" className="wa-pick-code">{i.name}</code>
                </button>
              ))}
            </div>
            <div className="wa-row">
              <Field label={t('ui_a_count')}><NumberInput value={count} onChange={setCount} min={1} max={1000} /></Field>
              <Button
                disabled={!item || count < 1}
                busy={busy === 'giveItem'}
                onClick={() => void run('giveItem', 'giveItem', { item, count: Math.round(count) }, t('ui_done'))}
              >
                <span>{t('ui_a_give')}</span>
                {item && <code dir="ltr" className="wa-btn-item-code">{item}</code>}
              </Button>
            </div>
          </Section>
        )}

        {page === 'moderation' && <Section title={t('ui_g_mod')}>
          <Button glyph="horse" kind="ghost" busy={busy === 'sitOnMount'} onClick={() => void run('sitOnMount', 'sitOnMount', {}, t('ui_done'))}>{t('ui_a_sit_mount')}</Button>
          <div className="wa-row wa-row--stretch">
            <Input value={notify} onChange={setNotify} placeholder={t('ui_a_notify_ph')} maxLength={200} onKeyDown={(e) => { if (e.key === 'Enter' && notify.trim()) { void run('notify', 'notify', { text: notify.trim() }, t('ui_sent')).then(() => setNotify('')); } }} />
            <Button disabled={!notify.trim()} busy={busy === 'notify'} onClick={() => void run('notify', 'notify', { text: notify.trim() }, t('ui_sent')).then(() => setNotify(''))}>{t('ui_a_notify')}</Button>
          </div>
          <div className="wa-row">
            <Button kind={frozen ? 'danger' : 'ghost'} disabled={isMe} busy={busy === 'freeze'} onClick={() => void run('freeze', 'freeze', { state: !frozen }, t('ui_done'))}>
              {frozen ? t('ui_a_unfreeze') : t('ui_a_freeze')}
            </Button>
            <Button kind={spectating ? 'danger' : 'ghost'} disabled={isMe} busy={busy === 'spectate'} onClick={() => void run('spectate', 'spectate', { state: !spectating }, t('ui_done'))}>
              {spectating ? t('ui_a_unspectate') : t('ui_a_spectate')}
            </Button>
          </div>

          {(can('kick') || can('ban')) && !isMe && (
            <div className="wa-mod-box">
              <Field label={t('ui_a_reason')}>
                <TextArea value={reason} onChange={setReason} rows={2} maxLength={200} placeholder={t('ui_a_reason_ph')} />
              </Field>
              {can('ban') && (
                <>
                  <div className="wa-field-label">{t('ui_a_duration')}</div>
                  <div className="wa-chips">
                    {DURATIONS.map((d) => (
                      <button key={d.key} type="button" className={cls('wa-chip', !customDur && duration === d.minutes && 'is-on')} onClick={() => { setCustomDur(false); setDuration(d.minutes); }}>{t(d.key)}</button>
                    ))}
                    <button type="button" className={cls('wa-chip', customDur && 'is-on')} onClick={() => setCustomDur(true)}>{t('ui_dur_custom')}</button>
                  </div>
                  {customDur && <NumberInput value={duration} onChange={setDuration} min={1} max={5256000} />}
                </>
              )}
              <div className="wa-row wa-row--end">
                {!reasonOk && <span className="wa-dim wa-hint-req">{t('ui_c_reason_required')}</span>}
                {can('kick') && <Button kind="danger" disabled={!reasonOk} onClick={askKick}>{t('ui_a_kick')}</Button>}
                {can('ban') && <Button kind="danger" disabled={!reasonOk} onClick={askBan}>{t('ui_a_ban')}</Button>}
              </div>
            </div>
          )}

          {can('dev') && (catalog?.groups?.length ?? 0) > 0 && (
            <div className="wa-row">
              <Field label={t('ui_a_set_group')}>
                <Select value={group} onChange={setGroup} options={(catalog?.groups ?? []).map((g) => ({ value: g, label: g }))} />
              </Field>
              <Button disabled={!group || group === p.group} busy={busy === 'setGroup'} onClick={() => void run('setGroup', 'setGroup', { group }, t('ui_done'))}>{t('ui_apply')}</Button>
            </div>
          )}
        </Section>}

        {page === 'inventory' && can('items') && (
          <Section title={t('ui_g_inv')}>
            <div className="wa-row">
              <Button busy={busy === 'openInventory'} onClick={() => void run('openInventory', 'openInventory', {})}>{t('ui_a_open_inv')}</Button>
              <Button kind="ghost" busy={busy === 'wardrobe'} onClick={() => void run('wardrobe', 'wardrobe', {}, t('ui_done'))}>{t('ui_a_wardrobe')}</Button>
              <Button kind="danger" onClick={askClearInv}>{t('ui_a_clear_inv')}</Button>
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}
