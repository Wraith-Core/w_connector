/* ════════════════════════════════════════════════════════════════════════════
 * CraftingFrame.tsx
 * Authentic 8-piece Red Dead crafting highlight frame matching w_creators
 * ════════════════════════════════════════════════════════════════════════════ */

export function CraftingFrame({ className = '' }: { className?: string }) {
  return (
    <div className={`wc-frame wst-frame ${className}`} aria-hidden="true">
      <span className="wc-fr-t wst-fr-t" />
      <span className="wc-fr-b wst-fr-b" />
      <span className="wc-fr-l wst-fr-l" />
      <span className="wc-fr-r wst-fr-r" />
      <span className="wc-fr-tl wst-fr-tl" />
      <span className="wc-fr-tr wst-fr-tr" />
      <span className="wc-fr-bl wst-fr-bl" />
      <span className="wc-fr-br wst-fr-br" />
    </div>
  );
}

export default CraftingFrame;
