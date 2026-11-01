/* Toasts at the bottom of the inline end: polite live region, text + shape (never colour alone),
   4.2 s, at most 5, click to dismiss. */

import type { Toast } from '../types';
import { cls } from './format';

export default function Toasts({ list, onDismiss }: { list: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="k-toasts k-layer" aria-live="polite" role="status">
      {list.map((x) => (
        <button key={x.id} type="button" className={cls('k-toast', `k-toast--${x.type}`)} onClick={() => onDismiss(x.id)}>
          <i className="k-toast-shape" aria-hidden="true" />
          <span>{x.text}</span>
        </button>
      ))}
    </div>
  );
}
