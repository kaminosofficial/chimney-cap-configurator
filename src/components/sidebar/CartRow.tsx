import { useEffect, useState } from 'react';
import { useConfigStore } from '../../store/configStore';

interface Props {
  onAddToCart: () => void;
  onBuyNow: () => void;
  isSubmitting?: boolean;
  submittingAction?: 'cart' | 'buy' | null;
  submittingStep?: string;
}

const MAX_QTY = 10;

/**
 * Official "Shop" wordmark SVG (from Shopify's shop-js CDN bundle).
 * The italic "shop" text where the "o" has the bag-handle design.
 * Only the 4 letter paths (s, h, o, p) — excludes the "Pay" box.
 */
function ShopLogo() {
  return (
    <svg className="shop-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 206 80" fill="none" aria-label="Shop">
      {/* s */}
      <path d="M23.5136 35.1798C15.5797 33.4835 12.0451 32.8197 12.0451 29.8064C12.0451 26.9722 14.4371 25.5604 19.221 25.5604C23.4282 25.5604 26.5036 27.3726 28.7674 30.9232C28.9382 31.1972 29.2906 31.292 29.5789 31.1445L38.506 26.6983C38.8263 26.5402 38.9438 26.1399 38.7623 25.8343C35.0569 19.5022 28.2121 16.0358 19.1996 16.0358C7.3574 16.0358 0 21.7885 0 30.9338C0 40.648 8.9591 43.1029 16.9038 44.7992C24.8484 46.4955 28.3936 47.1592 28.3936 50.1725C28.3936 53.1858 25.8095 54.6082 20.6518 54.6082C15.8893 54.6082 12.3548 52.4589 10.2191 48.2866C10.059 47.981 9.6852 47.8546 9.3756 48.0127L0.46985 52.364C0.16017 52.5221 0.03203 52.8908 0.19221 53.2069C3.72673 60.2134 10.9773 64.1538 20.6625 64.1538C32.996 64.1538 40.4494 58.496 40.4494 49.0663C40.4494 39.6365 31.4476 36.8972 23.5136 35.2009V35.1798Z" fill="currentColor"/>
      {/* h */}
      <path d="M71.3525 16.0358C66.291 16.0358 61.8168 17.8059 58.6026 20.9561C58.3997 21.1458 58.0687 21.0088 58.0687 20.7349V0.621625C58.0687 0.273937 57.791 0 57.4387 0H46.2692C45.9168 0 45.6391 0.273937 45.6391 0.621625V63.0476C45.6391 63.3952 45.9168 63.6692 46.2692 63.6692H57.4387C57.791 63.6692 58.0687 63.3952 58.0687 63.0476V35.6644C58.0687 30.3754 62.1798 26.319 67.7219 26.319C73.2639 26.319 77.279 30.2911 77.279 35.6644V63.0476C77.279 63.3952 77.5566 63.6692 77.909 63.6692H89.0785C89.4309 63.6692 89.7085 63.3952 89.7085 63.0476V35.6644C89.7085 24.1591 82.0628 16.0464 71.3525 16.0464V16.0358Z" fill="currentColor"/>
      {/* o (bag with handle) */}
      <path d="M112.389 14.2552C106.324 14.2552 100.622 16.0779 96.542 18.7224C96.265 18.9016 96.169 19.2703 96.34 19.5548L101.262 27.8466C101.444 28.1416 101.828 28.247 102.127 28.0679C105.224 26.2241 108.769 25.2653 112.389 25.2864C122.138 25.2864 129.303 32.0716 129.303 41.0377C129.303 48.6763 123.569 54.3342 116.297 54.3342C110.371 54.3342 106.26 50.9311 106.26 46.1266C106.26 43.3767 107.445 41.122 110.531 39.5311C110.851 39.3625 110.969 38.9727 110.777 38.6671L106.132 30.9126C105.982 30.6598 105.662 30.5439 105.373 30.6492C99.148 32.925 94.78 38.4037 94.78 45.7579C94.78 56.8839 103.761 65.1863 116.287 65.1863C130.916 65.1863 141.434 55.1876 141.434 40.8481C141.434 25.476 129.197 14.2446 112.368 14.2446L112.389 14.2552Z" fill="currentColor"/>
      {/* p */}
      <path d="M174.098 15.9515C168.449 15.9515 163.409 18.006 159.725 21.6304C159.522 21.8306 159.191 21.6831 159.191 21.4092V17.0473C159.191 16.6996 158.914 16.4256 158.561 16.4256H147.68C147.328 16.4256 147.05 16.6996 147.05 17.0473V79.3784C147.05 79.7261 147.328 80 147.68 80H158.849C159.202 80 159.48 79.7261 159.48 79.3784V58.9385C159.48 58.6645 159.811 58.5276 160.013 58.7067C163.687 62.0782 168.545 64.0485 174.109 64.0485C187.211 64.0485 197.43 53.5862 197.43 39.9947C197.43 26.4032 187.2 15.941 174.109 15.941L174.098 15.9515ZM171.995 53.4914C164.541 53.4914 158.892 47.6439 158.892 39.9104C158.892 32.177 164.53 26.3295 171.995 26.3295C179.459 26.3295 185.086 32.0822 185.086 39.9104C185.086 47.7387 179.533 53.4914 171.984 53.4914H171.995Z" fill="currentColor"/>
    </svg>
  );
}

function getCartLabel(step: string): string {
  if (step === 'cart:building') return 'Preparing...';
  if (step === 'cart:adding')   return 'Adding...';
  if (step === 'cart:pending')  return 'Finalizing...';
  if (step === 'cart:syncing')  return 'Almost there...';
  return 'Processing...';
}

function getBuyLabel(step: string): string {
  if (step === 'buy:building')    return 'Preparing...';
  if (step === 'buy:adding')      return 'Preparing checkout...';
  if (step === 'buy:pending')     return 'Finalizing...';
  if (step === 'buy:syncing')     return 'Almost there...';
  if (step === 'buy:redirecting') return 'Off we go!';
  return 'Processing...';
}

export function CartRow({ onAddToCart, onBuyNow, isSubmitting = false, submittingAction = null, submittingStep = '' }: Props) {
  const quantity = useConfigStore(s => s.quantity);
  const price = useConfigStore(s => s.price);
  const set = useConfigStore(s => s.set);
  const [quantityText, setQuantityText] = useState(String(quantity));

  useEffect(() => {
    setQuantityText(String(quantity));
  }, [quantity]);

  function commitQuantity(raw: string) {
    const digitsOnly = raw.replace(/\D+/g, '');
    const parsed = parseInt(digitsOnly, 10);
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_QTY, parsed)) : 1;
    set({ quantity: next });
    setQuantityText(String(next));
  }

  function increment() {
    const next = Math.min(MAX_QTY, quantity + 1);
    set({ quantity: next });
    setQuantityText(String(next));
  }

  function decrement() {
    const next = Math.max(1, quantity - 1);
    set({ quantity: next });
    setQuantityText(String(next));
  }

  const cartBusy = isSubmitting && submittingAction === 'cart';
  const buyBusy  = isSubmitting && submittingAction === 'buy';

  const cartLabel = cartBusy ? getCartLabel(submittingStep) : 'Add to cart';
  const buyLabelText = buyBusy ? getBuyLabel(submittingStep) : null;

  return (
    <>
      <div className="cart-row">
        {/* Quantity selector — matches Shopify Dawn theme style */}
        <div className="qty-selector">
          <label className="qty-label">Quantity</label>
          <div className="qty-input-wrap">
            <button
              type="button"
              className="qty-btn qty-btn-minus"
              onClick={decrement}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantityText}
              onChange={e => {
                const nextText = e.target.value.replace(/[^\d]/g, '');
                setQuantityText(nextText);
              }}
              onFocus={e => e.currentTarget.select()}
              onBlur={e => commitQuantity(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitQuantity((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <button
              type="button"
              className="qty-btn qty-btn-plus"
              onClick={increment}
              disabled={quantity >= MAX_QTY}
              aria-label="Increase quantity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 6L5 3L8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {price === 0 ? (
          <button
            className="add-to-cart request-quote-btn"
            style={{ flex: 1 }}
            onClick={() => window.location.href = 'tel:+18887779789'}
          >
            <span>Request Quote</span>
          </button>
        ) : (
          <>
            <button
              className="add-to-cart"
              onClick={onAddToCart}
              disabled={isSubmitting}
              aria-busy={cartBusy}
            >
              <span key={cartLabel} className={cartBusy ? 'cart-btn-step' : undefined}>
                {cartLabel}
              </span>
            </button>

            <button
              className="buy-now-btn"
              onClick={onBuyNow}
              disabled={isSubmitting}
              aria-busy={buyBusy}
            >
              {buyLabelText ? (
                <span key={buyLabelText} className="cart-btn-step">
                  {buyLabelText}
                </span>
              ) : (
                <>
                  <span className="buy-with-text">Buy with</span>
                  <ShopLogo />
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Thin progress bar — brand-colored, slides continuously while busy */}
      {isSubmitting && (
        <div className="cart-progress-track">
          <div className="cart-progress-fill" />
        </div>
      )}
    </>
  );
}
