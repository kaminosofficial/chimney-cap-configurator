import { useState } from 'react';
import { useConfigStore } from '../../store/configStore';
import { NumInput, ToggleRow, Chips, MountStyleSection, LidTypeSection, ScreenSection } from './Inputs';
import { PowderCoatSection } from './PowderCoatSection';
import { PriceDisplay } from './PriceDisplay';
import { CartRow } from './CartRow';
import { NotesField } from './NotesField';

interface SidebarProps {
  descExpanded: boolean;
  setDescExpanded: (v: boolean) => void;
  onOpenRal: () => void;
  onAddToCart: () => void;
  onBuyNow: () => void;
  isSubmitting?: boolean;
  submittingAction?: 'cart' | 'buy' | null;
  submittingStep?: string;
}

export function Sidebar({ descExpanded, setDescExpanded, onOpenRal, onAddToCart, onBuyNow, isSubmitting = false, submittingAction = null, submittingStep = '' }: SidebarProps) {
  const config = useConfigStore();
  const [introExpanded, setIntroExpanded] = useState(false);

  return (
    <div className="sidebar">
      <div className={`sidebar-scroll${isSubmitting ? ' sidebar-scroll--disabled' : ''}`}>
        <h1 className="sidebar-main-title">Multi-Flue Chimney Cap Configurator</h1>

        <section className={`project-info-card${introExpanded ? ' open' : ''}`}>
          <button
            className={`project-info-toggle${introExpanded ? ' open' : ''}`}
            onClick={() => setIntroExpanded(!introExpanded)}
            aria-expanded={introExpanded}
            aria-controls="project-info-panel"
          >
            <span className="project-info-toggle-text">Project Info &amp; Instructions</span>
            <span className="project-info-toggle-icon" aria-hidden="true" />
          </button>

          {introExpanded && (
            <div id="project-info-panel" className="project-info-body">
              <div className="product-desc">
                <div className={`product-desc-text${descExpanded ? ' expanded' : ''}`}>
                  Kaminos multi-flue caps are custom-fabricated to your exact measurements. 
                  Choose from premium stainless steel or copper - each built to outlast and 
                  outperform standard covers. Backed by our lifetime warranty against rust and corrosion.
                </div>
                <button className="desc-toggle" onClick={() => setDescExpanded(!descExpanded)}>
                  {descExpanded ? 'Show Less' : 'Read More'}
                </button>
              </div>
            </div>
          )}
        </section>

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
            {config.lid_type !== 'flat' && (
              <NumInput configKey="lid_pitch" label="Lid Pitch" unit="n/12" max={10} min={1} step={1} />
            )}
            {config.lid_type === 'flat' && (
              <ToggleRow id="cross_break" label="Cross Break" tooltip="Adds a diagonal crease to slightly raise the center of the lid." />
            )}
          </div>
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

        <div className="section">
          <div className="section-title">
            <span className="section-title-label">Special Notes</span>
            <span className="section-title-meta">(optional)</span>
          </div>
          <NotesField />
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
