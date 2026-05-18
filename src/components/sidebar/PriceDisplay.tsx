import { useConfigStore } from '../../store/configStore';

export function PriceDisplay() {
  const price = useConfigStore(s => s.price);
  return (
    <div className="price-display" style={{ marginBottom: 0 }}>
      <span className="price-label" style={{ marginRight: '8px' }}>Total</span>
      <span className="price-value" style={{ fontSize: '18px' }}>${price.toFixed(2)}</span>
    </div>
  );
}
