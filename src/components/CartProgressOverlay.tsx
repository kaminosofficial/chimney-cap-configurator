// ─────────────────────────────────────────────────────────────────────────────
// CartProgressOverlay
//
// Semi-transparent overlay shown over the configurator while Add to Cart /
// Buy with Shop is in flight (the wait is dominated by Shopify variant
// propagation — typically 5–12s for a brand-new configuration).
//
// Driven entirely by App.tsx's existing `submittingAction` + `submittingStep`
// state (steps fired by onAddToCart / onBuyNow / addToCartWithRetry), so the
// checklist reflects REAL progress — no fake timers.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  action: 'cart' | 'buy';
  /** e.g. "cart:building" | "cart:adding" | "cart:syncing" | "buy:redirecting" */
  step: string;
}

const CART_STEPS = [
  { key: 'building', label: 'Saving your configuration' },
  { key: 'adding', label: 'Creating your custom cap' },
  { key: 'syncing', label: 'Adding to your cart' },
  { key: 'opening', label: 'Opening your cart' },
];

const BUY_STEPS = [
  { key: 'building', label: 'Saving your configuration' },
  { key: 'adding', label: 'Creating your custom cap' },
  { key: 'syncing', label: 'Preparing secure checkout' },
  { key: 'redirecting', label: 'Taking you to checkout' },
];

function IconCheck() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.2 4.8 9 10 3.4" />
    </svg>
  );
}

export function CartProgressOverlay({ action, step }: Props) {
  const steps = action === 'buy' ? BUY_STEPS : CART_STEPS;
  const stepKey = step.includes(':') ? step.split(':')[1] : '';
  const found = steps.findIndex(s => s.key === stepKey);
  const active = found >= 0 ? found : 0;

  return (
    <div className="cart-progress-overlay" role="status" aria-live="polite">
      <div className="cart-progress-card">
        <div className="cart-progress-title">
          {action === 'buy' ? 'Preparing your checkout' : 'Adding to your cart'}
        </div>
        <ul className="cart-progress-steplist">
          {steps.map((s, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'pending';
            return (
              <li key={s.key} className={`cart-progress-item is-${state}`}>
                <span className="cart-progress-dot" aria-hidden="true">
                  {state === 'done' && <IconCheck />}
                  {state === 'active' && <span className="cart-progress-spin" />}
                </span>
                <span className="cart-progress-text">{s.label}</span>
              </li>
            );
          })}
        </ul>
        <div className="cart-progress-note">
          Hand-built to your exact specs — this takes just a few seconds.
        </div>
      </div>
    </div>
  );
}
