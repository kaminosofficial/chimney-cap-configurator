import { useConfigStore } from '../../store/configStore';
import { RAL_COLORS } from '../../config/ralColors';

interface Props { onOpenRal: () => void; }

export function PowderCoatSection({ onOpenRal }: Props) {
  const pcCol = useConfigStore(s => s.powder_coat_color);

  const found = RAL_COLORS.find(c => c.hex.toLowerCase() === pcCol.toLowerCase());
  const ralCode = found ? found.ral : 'Custom';
  const ralName = found ? found.name : 'Custom Color';

  return (
    <div style={{ marginTop: 12 }}>
      <button className="ral-selector-btn" onClick={onOpenRal}>
        <div className="ral-preview-swatch" style={{ backgroundColor: pcCol }} />
        <div className="ral-preview-text">
          <span className="ral-code">{ralCode}</span>
          <span className="ral-name">{ralName}</span>
        </div>
        <span className="ral-chevron">▾</span>
      </button>
    </div>
  );
}
