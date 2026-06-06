import { useConfigStore } from '../../store/configStore';
import { NumInput, ToggleRow, Chips, MountStyleSection, LidTypeSection, ScreenSection } from './Inputs';
import { PowderCoatSection } from './PowderCoatSection';
import { PriceDisplay } from './PriceDisplay';
import { CartRow } from './CartRow';

interface SidebarProps {
  onOpenRal: () => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  isSubmitting?: boolean;
  submittingAction?: 'cart' | 'buy' | null;
  submittingStep?: string;
}

export function Sidebar({ onOpenRal, onAddToCart, onBuyNow, isSubmitting = false, submittingAction = null, submittingStep = '' }: SidebarProps) {
  const config = useConfigStore();

  return (
    <div className="sidebar">
      <div className={`sidebar-scroll${isSubmitting ? ' sidebar-scroll--disabled' : ''}`}>
        <h1 className="sidebar-main-title">Multi-Flue Chimney Cap Configurator</h1>

        <MountStyleSection />
        <LidTypeSection />

        <div className="section">
          <div className="section-title">
            <span className="section-title-label">Dimensions</span>
          </div>
          <div className="field-row-3">
            <NumInput configKey="length" label="Length" unit="in" max={150} min={10} step={0.125} />
            <NumInput configKey="width" label="Width" unit="in" max={150} min={10} step={0.125} />
          </div>
        </div>

        {config.mount !== 'top_mount' && (
          <div className="section">
            <div className="section-title">
              <span className="section-title-label">Skirt</span>
            </div>
            <div className="field-row-3">
              <NumInput configKey="vertical_skirt" label="Vertical Skirt" unit="in" max={9} min={1} step={0.25} />
              <NumInput configKey="horizontal_skirt" label="Horizontal Skirt" unit="in" max={9} min={1} step={0.25} />
            </div>
            <ToggleRow id="drip_edge" label="Drip Edge" tooltip="A drip edge extends beyond the skirt to direct rainwater away." />
          </div>
        )}

        {config.mount === 'top_mount' && (
          <div className="section">
            <div className="section-title">
              <span className="section-title-label">Top-Mount Flange</span>
            </div>
            <div className="field-row-3">
              <NumInput configKey="flange_width" label="Flange Width" unit="in" max={6} min={1} step={0.25} />
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-title">
            <span className="section-title-label">Lid Settings</span>
          </div>
          <div className="field-row-3">
            <NumInput configKey="lid_overhang" label="Lid Overhang" unit="in" max={6} min={2} step={0.5} />
            {config.lid_type !== 'flat' ? (
              <NumInput configKey="lid_pitch" label="Lid Pitch" unit="n/12" max={10} min={1} step={1} />
            ) : (
              // Spacer: keeps Lid Overhang at 50% width so it visually matches the
              // half-width Screen Height buttons below instead of stretching to full width.
              <div className="field" aria-hidden="true" />
            )}
          </div>
          {config.lid_type === 'flat' && (
            <ToggleRow id="cross_break" label="Cross Break" tooltip="Adds a diagonal crease to slightly raise the center of the lid." />
          )}
        </div>

        <ScreenSection />

        <div className="section">
          <div className="section-title">
            <span className="section-title-label">Material & Finish</span>
          </div>
          <Chips<'stainless' | 'copper'>
            options={[
              { label: 'Stainless Steel', value: 'stainless' },
              { label: 'Copper', value: 'copper' },
            ]}
            value={config.material}
            onChange={v => config.set({ material: v })}
          />
          {config.material === 'stainless' && (
            <>
              <ToggleRow id="powder_coat" label="Powder Coating" tooltip="Add a baked-on color finish." />
              {config.powder_coat && <PowderCoatSection onOpenRal={onOpenRal} />}
            </>
          )}
        </div>

      </div>

      <div className="price-bar">
        <div className="price-header">
          <PriceDisplay />
        </div>
        <CartRow onAddToCart={onAddToCart} onBuyNow={onBuyNow} isSubmitting={isSubmitting} submittingAction={submittingAction} submittingStep={submittingStep} />
      </div>
    </div>
  );
}
