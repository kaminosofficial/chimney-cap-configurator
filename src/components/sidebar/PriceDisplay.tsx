import { useConfigStore } from '../../store/configStore';

export function PriceDisplay() {
  const price = useConfigStore(s => s.price);
  const pricingLoaded = useConfigStore(s => s.pricingLoaded);
  return (
    <div className="price-display" style={{ marginBottom: 0 }}>
      <span className="price-label" style={{ marginRight: '8px' }}>Total</span>
      {pricingLoaded ? (
        <span className="price-value" style={{ fontSize: '18px' }}>${price.toFixed(2)}</span>
      ) : (
        // Until /api/pricing resolves, render a shimmer placeholder instead
        // of a price that would change a moment later. Prevents the flash
        // from local-fallback price -> real sheet price.
        <span className="price-value-loading-shimmer" style={{ fontSize: '18px' }} aria-label="Loading price" />
      )}
    </div>
  );
}
