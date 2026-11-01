/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · dev/KitGallery.tsx: every kit component on one page (browser mock only: ?page=kit).
 * It doubles as the usage reference for page authors: copy from here.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import {
  Button, ButtonRow, CitizenIdInput, Combobox, CoordsInput, DataTable, Drawer, DurationPicker, EmptyState, Field, FilterChips,
  Gate, IconButton, InlineAlert, KeyValue, KeyValueList, Meter, NumberInput, PageActions, ReasonField, Section, Segmented,
  Select, SettingRow, SaveBar, SliderNumber, SplitView, StatTile, StatusChip, Switch, Tabs, Tag, TextInput, fmtCash, fmtDuration,
} from '../kit';
import type { Column, CoordsValue, HelpInline } from '../kit';
import type { AdminPlayer } from '../types';

/* inline help (the shape module data arrives in); real pages use keys from locales/help/<page>.*.json */
const H = (ar: string, en: string, extra?: Partial<HelpInline>): HelpInline => ({ text: { ar, en }, ...extra });

export default function KitGallery() {
  const app = useApp();
  const { t, lang, lt } = useI18n();
  const [name, setName] = useState('');
  const [num, setNum] = useState<number | null>(1.2);
  const [pick, setPick] = useState('police');
  const [item, setItem] = useState('');
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<'essential' | 'detail'>('essential');
  const [slider, setSlider] = useState(40);
  const [cid, setCid] = useState('5');
  const [coords, setCoords] = useState<CoordsValue>({ x: -175.3, y: 626.8, z: 113.2 });
  const [dur, setDur] = useState(1440);
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState('profile');
  const [chip, setChip] = useState('all');
  const [draft, setDraft] = useState<number | null>(1.4);
  const [sel, setSel] = useState<number | null>(2);

  const cols = useMemo<Column<AdminPlayer>[]>(() => [
    { key: 'cid', label: t('label.common.citizen.label'), help: 'help.common.citizenId', sort: true, value: (p) => Number(p.citizenid) || 0,
      render: (p) => <><b className="k-num">{p.citizenid}</b> <span className="k-faint k-num">#{p.id}</span></> },
    { key: 'name', label: lt({ ar: 'الاسم', en: 'Name' }), help: H('اسم الشخصية وتحته اسم الحساب.', 'The character name, with the account name under it.'), sort: true, value: (p) => p.name,
      render: (p) => <><span className="k-cell-main">{`${p.firstname} ${p.lastname}`}</span><span className="k-cell-sub">{p.name}</span></> },
    { key: 'status', label: lt({ ar: 'الحالة', en: 'Status' }), help: 'help.common.status',
      render: (p) => <StatusChip status={p.dead ? 'dead' : p.needs && (p.needs.hunger < 20 || p.needs.thirst < 20) ? 'low' : p.frozen ? 'frozen' : 'ok'} /> },
    { key: 'hunger', label: lt({ ar: 'الجوع', en: 'Hunger' }), help: H('كم باقي في شريط الجوع من 100. تحت 20 يصير أحمر.', 'What is left of the hunger bar, out of 100. Under 20 it turns red.'), num: true,
      render: (p) => <Meter value={p.needs?.hunger} label="hunger" /> },
    { key: 'cash', label: lt({ ar: 'النقد', en: 'Cash' }), help: H('النقد اللي معه الآن.', 'The cash they carry now.'), num: true, priority: 'detail', sort: true, value: (p) => p.money.cash,
      render: (p) => <span className="k-num">{fmtCash(p.money.cash)}</span> },
  ], [t, lt]);

  const selected = app.players.find((p) => p.id === sel) ?? null;

  return (
    <div className="k-stack" style={{ gap: '1.25rem' }}>
      <PageActions>
        <Button help="help.common.refresh" icon="refresh" onClick={() => app.refresh('players')}>{lt({ ar: 'تحديث', en: 'Refresh' })}</Button>
      </PageActions>

      <InlineAlert tone="info" title={lt({ ar: 'صفحة للمطوّرين', en: 'Developer page' })} help="help.shell.page.kit">
        {lt({ ar: 'كل مكوّن هنا بجانبه ؟ يشرحه. انسخ الاستخدام من src/dev/KitGallery.tsx.', en: 'Every component here has a ? that explains it. Copy the usage from src/dev/KitGallery.tsx.' })}
      </InlineAlert>

      <div className="k-grid-3">
        <StatTile label={lt({ ar: 'متصلون', en: 'Online' })} help="help.shell.online" value={`${app.players.length}/64`} sub={lt({ ar: 'الحد 64', en: 'limit 64' })} />
        <StatTile label={lt({ ar: 'مدة التشغيل', en: 'Uptime' })} help={H('كم صار للسيرفر شغال من آخر تشغيل.', 'How long the server has run since its last start.')} value={fmtDuration(t, lang, app.serverInfo?.uptime ?? 0)} numeric={false} />
        <StatTile label={lt({ ar: 'محظورون', en: 'Banned' })} help={H('عدد الحظر الساري الآن.', 'How many bans are active now.')} value={app.serverInfo?.bansCount ?? 0} onClick={() => app.navigate('bans')} />
      </div>

      <Section title={lt({ ar: 'الحقول', en: 'Fields' })} help={H('كل حقل له عنوان وعلامة ؟ وسطر مساعدة.', 'Every field has a label, a ? and a hint line.')} lead={lt({ ar: 'الحقول داخل Field تأخذ عنوانه وشرحه.', en: 'Controls inside a Field take its label and help.' })}>
        <div className="k-grid-2">
          <Field label={lt({ ar: 'نص', en: 'Text' })} help="help.common.search" hint={lt({ ar: 'اكتب أي شيء', en: 'Type anything' })}>
            <TextInput value={name} onChange={setName} placeholder={t('label.common.search')} icon="search" clearable />
          </Field>
          <Field label={lt({ ar: 'رقم بحدود', en: 'Number with limits' })} help={H('رقم بين 0 و25. خارج الحدود يظهر خطأ ولا يتغيّر لحاله.', 'A number from 0 to 25. Outside the limits it shows an error; it is never changed by itself.')}>
            <NumberInput value={num} onChange={setNum} min={0} max={25} step={0.1} unit={lt({ ar: 'نقطة', en: 'points' })} showRange />
          </Field>
          <Field label={lt({ ar: 'قائمة', en: 'List' })} help={H('يختار من قائمة قصيرة.', 'Picks from a short list.')}>
            <Select value={pick} onChange={setPick} options={(app.catalog?.jobs ?? []).map((j) => ({ value: j.name, label: j.label }))} />
          </Field>
          <Field label={lt({ ar: 'بحث في قائمة', en: 'Searchable list' })} help={H('قائمة طويلة تبحث فيها بالكتابة.', 'A long list you search by typing.')}>
            <Combobox value={item} onChange={setItem} options={(app.catalog?.items ?? []).map((i) => ({ value: i.name, label: i.label, sub: i.name }))} />
          </Field>
          <Field label={lt({ ar: 'تشغيل وإيقاف', en: 'On and off' })} help={H('يظهر الحالة بالكلمة، مو باللون.', 'Shows the state as a word, not a colour.')}>
            <Switch checked={on} onChange={setOn} />
          </Field>
          <Field label={lt({ ar: 'اختيار واحد', en: 'One of a few' })} help="help.common.density">
            <Segmented value={seg} onChange={setSeg} options={[{ value: 'essential', label: t('label.common.essential') }, { value: 'detail', label: t('label.common.detail') }]} />
          </Field>
          <Field label={lt({ ar: 'منزلق', en: 'Slider' })} help={H('يحرّك القيمة بين حدين، ويظهر الرقم بجانبه.', 'Moves a value between two limits, with the number beside it.')}>
            <SliderNumber value={slider} onChange={setSlider} min={0} max={100} unit="%" />
          </Field>
          <Field label={t('label.common.citizen.label')} help="help.common.citizenId">
            <CitizenIdInput value={cid} onChange={setCid} />
          </Field>
          <Field label={lt({ ar: 'إحداثيات', en: 'Coordinates' })} help="help.common.coords">
            <CoordsInput value={coords} onChange={setCoords} />
          </Field>
          <Field label={lt({ ar: 'المدة', en: 'Length' })} help="help.common.duration">
            <DurationPicker value={dur} onChange={setDur} />
          </Field>
        </div>
        <Field label={lt({ ar: 'السبب', en: 'Reason' })} help="help.common.reason">
          <ReasonField value={reason} onChange={setReason} templates={[lt({ ar: 'تخريب', en: 'Griefing' }), lt({ ar: 'غش', en: 'Cheating' }), lt({ ar: 'إساءة', en: 'Abuse' })]} />
        </Field>
      </Section>

      <Section title={lt({ ar: 'الأزرار', en: 'Buttons' })} help={H('زر رئيسي واحد في كل مكان، والأحمر للخطر فقط.', 'One primary button per view; red only for danger.')}>
        <ButtonRow>
          <Button help="help.common.save" kind="primary">{t('label.common.save')}</Button>
          <Button help="help.common.refresh">{lt({ ar: 'عادي', en: 'Secondary' })}</Button>
          <Button help="help.common.discard" kind="ghost">{t('label.common.discard')}</Button>
          <Button help={H('يطرد اللاعب من السيرفر الآن.', 'Removes the player from the server now.')} kind="danger" area="kick">{lt({ ar: 'طرد', en: 'Kick' })}</Button>
          <Button help={H('يغيّر رقم المواطن لشخصية.', 'Changes a character citizen ID.')} area="citizenId">{lt({ ar: 'مقفول حسب المستوى', en: 'Locked by level' })}</Button>
          <IconButton icon="copy" aria-label={t('label.common.copy')} help="help.common.copy" />
        </ButtonRow>
        <div style={{ marginTop: '.75rem' }}>
          <ButtonRow>
            <Button help="help.common.confirm" data-k="dlg-confirm" onClick={() => app.confirm({ title: lt({ ar: 'إرجاع اللاعب؟', en: 'Send the player back?' }), text: lt({ ar: 'يرجع لمكانه القديم.', en: 'They return to their old spot.' }), onConfirm: () => app.toast('success', t('label.common.confirm')) })}>{lt({ ar: 'نافذة تأكيد', en: 'Confirm dialog' })}</Button>
            <Button help="help.common.reason" data-k="dlg-reason" onClick={() => app.confirm<string>({
              title: lt({ ar: 'طرد اللاعب', en: 'Kick the player' }), danger: true, initial: '', help: 'help.common.reason',
              render: ({ value, set }) => <Field label={lt({ ar: 'السبب', en: 'Reason' })} help="help.common.reason"><ReasonField value={value} onChange={set} /></Field>,
              canConfirm: (v) => v.trim().length > 2,
              onConfirm: (v) => app.toast('success', v),
            })}>{lt({ ar: 'نافذة بسبب', en: 'Dialog with a reason' })}</Button>
            <Button help="help.common.typeToConfirm" kind="danger" data-k="dlg-phrase" onClick={() => app.confirm({
              title: lt({ ar: 'حذف الشخصية 14', en: 'Delete character 14' }), danger: true, phrase: '14',
              text: lt({ ar: 'تُحذف الشخصية وبياناتها نهائيًا.', en: 'The character and its data are deleted for good.' }),
              onConfirm: () => app.toast('success', 'ok'),
            })}>{lt({ ar: 'تأكيد بالكتابة', en: 'Type to confirm' })}</Button>
          </ButtonRow>
        </div>
      </Section>

      <Section title={lt({ ar: 'الحالة والوسوم', en: 'Status and tags' })} help="help.common.status">
        <ButtonRow>
          <StatusChip status="ok" /><StatusChip status="low" /><StatusChip status="dead" /><StatusChip status="frozen" />
          <StatusChip status="blocked" /><StatusChip status="offline" /><StatusChip status="stopped" />
          <Tag>mod</Tag><Tag tone="strong">god</Tag><Tag tone="danger">{t('label.common.noUndo')}</Tag>
          <Meter value={72} label="72" /><Meter value={12} label="12" />
        </ButtonRow>
        <Gate area="charDelete">
          <div style={{ marginTop: '.75rem' }}>
            <Button help={H('يحذف الشخصية نهائيًا.', 'Deletes the character for good.')} kind="danger">{lt({ ar: 'داخل Gate', en: 'Inside a Gate' })}</Button>
          </div>
        </Gate>
      </Section>

      <Section title={lt({ ar: 'جدول مع لوحة جانبية', en: 'Table with a drawer' })} help={H('القائمة في جهة والتفاصيل في جهة، وكل وحدة تنزل لحالها.', 'The list on one side, the details on the other; each scrolls on its own.')}>
        <FilterChips label="filter" value={chip} onChange={setChip} items={[
          { id: 'all', label: lt({ ar: 'الكل', en: 'All' }), count: app.players.length, help: H('كل المتصلين.', 'Everyone online.') },
          { id: 'help', label: lt({ ar: 'يحتاجون مساعدة', en: 'Need help' }), count: 3, help: H('الموتى وأصحاب الاحتياجات المنخفضة.', 'The dead and those with low needs.') },
        ]} />
        <div style={{ height: '26rem', border: '1px solid var(--rule)', marginTop: '.75rem' }}>
          <SplitView
            list={<DataTable label="players" columns={cols} rows={app.players} rowKey={(p) => p.id} selectedKey={sel} onSelect={(p) => setSel(p.id)} mode={seg} />}
            drawer={selected && (
              <Drawer
                title={`${selected.firstname} ${selected.lastname}`}
                help={H('ملف اللاعب المختار.', 'The selected player file.')}
                sub={<><span>{t('label.common.citizen.label')} <b className="k-num">{selected.citizenid}</b></span><span className="k-num">#{selected.id}</span></>}
                chips={<StatusChip status={selected.dead ? 'dead' : 'ok'} />}
                tabs={[
                  { id: 'profile', label: lt({ ar: 'الملف', en: 'Profile' }), help: H('بيانات اللاعب.', 'The player data.') },
                  { id: 'travel', label: lt({ ar: 'التنقل', en: 'Travel' }), help: H('الذهاب إليه أو إحضاره.', 'Go to them or bring them.') },
                ]}
                tab={tab}
                onTab={setTab}
                onClose={() => setSel(null)}
                footer={<>
                  <Button help={H('ينقلك إلى مكان اللاعب.', 'Takes you to the player.')} kind="primary" area="teleport">{lt({ ar: 'الذهاب إليه', en: 'Go to' })}</Button>
                  <Button help={H('ينقل اللاعب إلى مكانك.', 'Moves the player to you.')} area="teleport">{lt({ ar: 'إحضاره', en: 'Bring' })}</Button>
                </>}
              >
                <KeyValueList>
                  <KeyValue label={t('label.common.citizen.label')} help="help.common.citizenId" value={selected.citizenid} copy={selected.citizenid} ltr />
                  <KeyValue label={lt({ ar: 'رقم الجلسة', en: 'Session' })} help="help.common.serverId" value={`#${selected.id}`} ltr />
                  <KeyValue label={lt({ ar: 'النقد', en: 'Cash' })} help={H('النقد اللي معه الآن.', 'The cash they carry now.')} value={fmtCash(selected.money.cash)} ltr />
                </KeyValueList>
              </Drawer>
            )}
          />
        </div>
      </Section>

      <Section title={lt({ ar: 'صف إعداد', en: 'Setting row' })} help={H('صف إعدادات: العنوان والشرح في جهة، والقيمة والحدود في جهة.', 'A settings row: label and description on one side, value and limits on the other.')}>
        <Tabs label="tabs" value={tab} onChange={setTab} items={[
          { id: 'profile', label: lt({ ar: 'الأول', en: 'First' }), help: H('التبويب الأول.', 'The first tab.') },
          { id: 'travel', label: lt({ ar: 'الثاني', en: 'Second' }), help: H('التبويب الثاني.', 'The second tab.') },
        ]} />
        <SettingRow
          label={lt({ ar: 'سرعة نقص العطش', en: 'Thirst drop per cycle' })}
          help={H('كم ينقص شريط العطش في كل دورة.', 'How much the thirst bar drops each cycle.', { example: { ar: '1.4 كل 90 ثانية = يعطش في ساعة و47 دقيقة', en: '1.4 every 90 s = parched in 1 h 47 min' } })}
          description={lt({ ar: 'رقم أكبر = يعطش أسرع.', en: 'Higher = thirstier faster.' })}
          control={<NumberInput value={draft} onChange={setDraft} min={0} max={25} step={0.1} />}
          meta={{ range: { min: 0, max: 25 }, def: 1.4 }}
          dirty={draft !== 1.4}
          onReset={() => setDraft(1.4)}
          preview={lt({ ar: 'بهذه الأرقام: العطش يخلص في ساعة و47 دقيقة تقريبًا', en: 'With these numbers thirst empties in about 1 h 47 min' })}
        />
        <SaveBar count={draft !== 1.4 ? 1 : 0} onDiscard={() => setDraft(1.4)} onSave={() => app.toast('success', t('label.common.save'))} />
      </Section>

      <EmptyState text={t('label.common.empty')} next={<Button help="help.common.refresh" size="sm">{lt({ ar: 'تحديث', en: 'Refresh' })}</Button>} />
    </div>
  );
}
