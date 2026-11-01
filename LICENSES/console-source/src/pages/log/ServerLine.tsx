/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/log/ServerLine.tsx
 * A log line as the server wrote it ("Wraith brought سالم الحربي (5)"). The line keeps its own
 * direction (dir=auto), and every Arabic name inside an English line is an island of its own, so the
 * citizen id after it stays after it: without this the line reads "Wraith brought (5) سالم الحربي".
 * ════════════════════════════════════════════════════════════════════════════ */

import { Fragment } from 'react';

const ARABIC_RUN = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+(?:[\s_\-ـ]+[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+)*)/;
const LATIN = /[A-Za-z]/;

export default function ServerLine({ text, className }: { text: string; className?: string }) {
  /* a line with no Latin letters is plain Arabic: nothing to isolate */
  const parts = LATIN.test(text) ? text.split(ARABIC_RUN) : [text];
  return (
    <span className={className} dir="auto">
      {parts.length === 1
        ? text
        : parts.map((p, i) => (i % 2 === 1 ? <bdi key={i}>{p}</bdi> : <Fragment key={i}>{p}</Fragment>))}
    </span>
  );
}
