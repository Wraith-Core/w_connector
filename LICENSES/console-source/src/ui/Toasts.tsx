/* Toasts at the bottom corner (bottom-right in English, bottom-left in Arabic through the flex direction) */

import type { Toast } from '../types';
import Glyph from './Glyph';
import { cls } from './util';

export default function Toasts({ list, onDismiss }: { list: Toast[]; onDismiss(id: number): void }) {
  if (list.length === 0) return null;
  return (
    <div className="wa-toasts" aria-live="polite">
      {list.map((tst) => (
        <button key={tst.id} type="button" className={cls('wa-toast', `wa-toast--${tst.type}`)} onClick={() => onDismiss(tst.id)}>
          <Glyph name={tst.type === 'success' ? 'check' : tst.type === 'error' ? 'warn' : 'info'} />
          <span>{tst.text}</span>
        </button>
      ))}
    </div>
  );
}
