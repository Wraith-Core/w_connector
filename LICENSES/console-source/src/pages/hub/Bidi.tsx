/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/Bidi.tsx
 * Script texts mix Arabic with Latin commands ("الأمر /stables أو زر F7"). In a right-to-left line
 * the slash of "/stables" jumps to the wrong side; this wraps every Latin run in its own
 * left-to-right island so it reads as typed.
 * ════════════════════════════════════════════════════════════════════════════ */

import { Fragment } from 'react';

const RUN = /([/#@]?[A-Za-z][A-Za-z0-9_./:-]*(?:\s+[A-Za-z0-9_./:-]+)*)/g;

export default function Bidi({ text }: { text: string }) {
  if (!text || !/[A-Za-z]/.test(text) || !/[؀-ۿ]/.test(text)) return <>{text}</>;
  const parts = text.split(RUN);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <span key={i} className="k-ltr">{p}</span>
        : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
