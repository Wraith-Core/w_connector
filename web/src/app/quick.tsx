/* The quick menu slot (PgUp): src/quick/index.tsx (default export, props { onClose, onFull }). */

import QuickMenu from '../quick';

export interface QuickProps { onClose(): void; onFull(): void }

export default function QuickSlot(props: QuickProps) {
  return <QuickMenu {...props} />;
}
