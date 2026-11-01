/* Where the character's data lives, grouped in plain words by what a deletion does to it. The raw table
   names stay behind "Technical details". Nothing here blocks a deletion any more. */

import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button, EmptyState, InlineAlert, Section, Tag, fmtNum } from '../../../kit';
import type { HelpKey } from '../../../kit';
import { KINDS, kindOf } from '../model';
import type { Dep, DepKind } from '../model';
import type { TabProps } from '../shared';

const KIND_HELP: Record<DepKind, HelpKey> = {
  core: 'help.characters.kindCore',
  data: 'help.characters.kindData',
  asset: 'help.characters.kindAsset',
  history: 'help.characters.kindHistory',
  other: 'help.characters.kindOther',
};

export interface DepGroup { kind: DepKind; deps: Dep[]; rows: number }

/** The dependencies by kind, in the fixed order core · data · asset · history · other */
export function groupDeps(deps: Dep[]): DepGroup[] {
  const by = new Map<DepKind, Dep[]>();
  for (const d of deps) {
    const k = kindOf(d.kind);
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  return [...KINDS, 'other' as const]
    .filter((k) => (by.get(k)?.length ?? 0) > 0)
    .map((k) => {
      const list = by.get(k) ?? [];
      return { kind: k, deps: list, rows: list.reduce((s, d) => s + (Number(d.rows) || 0), 0) };
    });
}

export default function Links({ detail }: TabProps) {
  const { t } = useI18n();
  const [tech, setTech] = useState(false);
  const groups = useMemo(() => groupDeps(detail.dependencies), [detail.dependencies]);
  return (
    <div className="ch-tab">
      <Section
        tone="plain"
        className="ch-links-head"
        title={t('ui_ch_links')}
        help="help.characters.links"
        actions={(
          <Button kind="link" size="sm" help="help.characters.techDetails" aria-expanded={tech} onClick={() => setTech((v) => !v)}>
            {tech ? t('label.characters.techHide') : t('label.characters.techShow')}
          </Button>
        )}
      />

      {groups.length === 0 && <EmptyState text={t('label.characters.noLinks')} />}

      {groups.map((g) => (
        <Section
          key={g.kind}
          className={`ch-kind ch-kind--${g.kind}`}
          title={t(`ui_ch_kind_${g.kind}`)}
          help={KIND_HELP[g.kind]}
          lead={t(`ui_ch_what_${g.kind}`)}
          actions={<Tag>{t('label.characters.records', fmtNum(g.rows), g.deps.length)}</Tag>}
        >
          {tech ? (
            <ul className="ch-tech" dir="ltr">
              {g.deps.map((d) => (
                <li key={`${d.table}.${d.column}.${d.kind}`}>
                  <span className="k-mono">{d.table}.{d.column}</span>
                  <span className="k-num">{t('ui_ch_rows', fmtNum(d.rows))}</span>
                </li>
              ))}
            </ul>
          ) : undefined}
        </Section>
      ))}

      <InlineAlert tone="info" title={t('label.characters.moneySafe')} help="help.characters.moneySafe">
        {t('ui_ch_what_money')}
      </InlineAlert>
    </div>
  );
}
