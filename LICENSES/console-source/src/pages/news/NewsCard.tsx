/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/news/NewsCard.tsx
 * The pause menu's news card, drawn the way w_pausemenu draws it (web/src/App.tsx + menu.css "The news"):
 * the newspaper plate in black and white under the torn sheet, the kicker "أخبار البلدة", the headline,
 * the text (four lines at most), the date line, the paper icon and the carousel dots. Its sizes are the
 * pause menu's in em, on a 20 px em at 1080p: the card is the size players see it.
 * Read only: it posts nothing.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useI18n } from '../../i18n';
import { cls } from '../../kit';
import type { Lang } from '../../types';
import { imageUrl, pick } from './model';
import type { NewsItem } from './model';

const AR_RE = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Text from the server keeps its own direction; Arabic never takes the Latin spacing or slant */
function Txt({ s }: { s: string }) {
  return AR_RE.test(s) ? <bdi lang="ar" className="nw-ar">{s}</bdi> : <bdi>{s}</bdi>;
}

/** w_pausemenu's IconNews (ui/icons.tsx): a folded newspaper, drawn by hand */
function PaperIcon() {
  return (
    <svg className="nw-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.1 5.7c3.2-.35 9.3-.3 12.7.05l.25 12.95c-3.3.35-9.4.3-12.85.1L4.1 5.7Z" />
      <path d="M17.05 8.5l2.65.05.2 9.2c.02 1.05-.75 1.6-1.55 1.5" />
      <path d="M6.5 8.7c2.6-.1 5.3-.08 7.95.02" />
      <path d="M6.55 11.3l3.5-.04M6.5 13.7l3.6.02M6.7 16.1c2.5-.1 5.1-.06 7.6.04" />
      <path d="M11.85 10.95l2.75-.08.1 3.05-2.8.08-.05-3.05Z" />
    </svg>
  );
}

export interface NewsCardProps {
  /** null: the card with no news ("لا أخبار الآن") */
  item: NewsItem | null;
  /** its place in the carousel (the automatic plate and the lit dot) */
  index: number;
  count: number;
  /** the pause menu's language to draw */
  lang: Lang;
  resource: string;
  /** no picture (a typed path that is not accepted yet): the bare sheet */
  blank?: boolean;
  className?: string;
}

export default function NewsCard({ item, index, count, lang, resource, blank, className }: NewsCardProps) {
  const { t } = useI18n();
  const title = item ? pick(item.title, lang) : '';
  const text = item ? pick(item.text, lang) : '';
  const date = item ? pick(item.date, lang) : '';
  const kicker = t(lang === 'ar' ? 'label.news.card.kickerAr' : 'label.news.card.kickerEn');
  return (
    <div className={cls('nw-card-wrap', className)} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <div className="nw-card">
        <div className="nw-plate" style={blank ? undefined : { backgroundImage: `url("${imageUrl(item?.image, index, resource)}")` }} aria-hidden="true" />
        <div className="nw-scrim" aria-hidden="true" />
        <div className="nw-body">
          <div className="nw-head">
            <div className="nw-heads">
              {item && <div className="nw-kicker">{kicker}</div>}
              <p className={cls('nw-title', item && !title && 'is-empty')}>
                {item ? (title ? <Txt s={title} /> : t('label.news.card.noTitle')) : kicker}
              </p>
            </div>
            <PaperIcon />
          </div>
          <p className={cls('nw-text', item && !text && 'is-empty')}>
            {item ? (text ? <Txt s={text} /> : t('label.news.card.noText')) : t(lang === 'ar' ? 'label.news.card.emptyAr' : 'label.news.card.emptyEn')}
          </p>
          {item && date && <p className="nw-date"><Txt s={date} /></p>}
        </div>
        {count > 1 && (
          <div className="nw-dots" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => <span key={i} className={cls('nw-dot', i === index && 'is-on')} />)}
          </div>
        )}
      </div>
    </div>
  );
}
