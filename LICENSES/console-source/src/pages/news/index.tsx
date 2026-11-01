/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/news  ("الأخبار" / News)
 * The pause menu's news card ("أخبار البلدة", w_pausemenu): list, add, edit, order, delete and back to
 * the default list, with the card's own preview. Area news (admin by default, Config.PagePerms.news);
 * the server checks the level and every value again (server/sv_news.lua).
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import NewsPage from './NewsPage';
import './news.css';

export const page = definePage({
  id: 'news',
  section: 'world',
  order: 25,
  glyph: 'news',
  area: 'news',
  component: NewsPage,
});
