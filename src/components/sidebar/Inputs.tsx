import { useState, useEffect } from 'react';
import { useConfigStore } from '../../store/configStore';
import type { Mount, LidType } from '../../store/configStore';
import { InfoTooltip } from './InfoTooltip';

interface NumInputProps {
  configKey: keyof ReturnType<typeof useConfigStore.getState>;
  label: string;
  unit?: string;
  max?: number;
  min?: number;
  step?: number;
  tooltip?: string;
}

export function NumInput({ configKey, label, unit, max = 120, min = 1, step = 0.125, tooltip }: NumInputProps) {
  const config = useConfigStore();
  const committed = config[configKey as keyof typeof config] as number;
  const [inputVal, setInputVal] = useState(committed.toString());
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setInputVal(committed.toString());
  }, [committed, focused]);

  function commit() {
    setFocused(false);
    let raw = parseFloat(inputVal) || 0;
    raw = Math.round(raw / step) * step;
    const clamped = Math.max(min, Math.min(max, raw));
    setInputVal(clamped.toString());
    config.set({ [configKey]: clamped });
  }

  return (
    <div className="field">
      <label>
        {label} {unit && <span className="unit">({unit})</span>}
        {tooltip && <InfoTooltip text={tooltip} />}
      </label>
      <input
        type="number"
        value={inputVal}
        step={step}
        style={{ color: focused ? '#3b6dd4' : undefined }}
        onFocus={() => setFocused(true)}
        onChange={e => setInputVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
      />
    </div>
  );
}

export function ToggleRow({ id, label, tooltip }: { id: string, label: string, tooltip?: string }) {
  const config = useConfigStore(s => s);
  const checked = config[id as keyof typeof config] as boolean;

  function toggle() {
    config.set({ [id]: !checked });
  }

  return (
    <div className="toggle-row">
      <span className="toggle-label" style={{ display: 'flex', alignItems: 'center' }}>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <label className="toggle">
        <input type="checkbox" checked={checked} onChange={toggle} />
        <div className="toggle-track"></div>
        <div className="toggle-knob"></div>
      </label>
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange
}: {
  options: { label: string, value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="material-chips" style={{ marginBottom: 12, gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(opt => (
        <button
          key={opt.value}
          className={`material-chip${value === opt.value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function MountStyleSection() {
  const config = useConfigStore();
  return (
    <div className="section">
      <div className="section-title">
        <span className="section-title-label">Mount Style</span>
      </div>
      <Chips<Mount>
        options={[
          { label: 'Standard Skirt', value: 'skirt' },
          { label: 'Pitched Skirt', value: 'pitched_skirt' },
          { label: 'Top Mount', value: 'top_mount' },
        ]}
        value={config.mount}
        onChange={v => config.set({ mount: v })}
      />
    </div>
  );
}

export function LidTypeSection() {
  const config = useConfigStore();
  return (
    <div className="section">
      <div className="section-title">
        <span className="section-title-label">Lid Type</span>
      </div>
      <Chips<LidType>
        options={[
          { label: 'Flat', value: 'flat' },
          { label: 'Hip', value: 'hip' },
          { label: 'Hip & Ridge', value: 'hip_ridge' },
          { label: 'Standing Seam', value: 'standing_seam' },
        ]}
        value={config.lid_type}
        onChange={v => config.set({ lid_type: v })}
      />
    </div>
  );
}

export function ScreenSection() {
  const config = useConfigStore();
  const std = [8, 10, 12, 16];
  const isCustom = !std.includes(config.screen_height);

  return (
    <div className="section">
      <div className="section-title">
        <span className="section-title-label">Screen Height</span>
      </div>
      <div className="material-chips" style={{ marginBottom: 12 }}>
        {std.map(h => (
          <button
            key={h}
            className={`material-chip${config.screen_height === h ? ' active' : ''}`}
            onClick={() => config.set({ screen_height: h })}
          >
            {h}"
          </button>
        ))}
        <button
          className={`material-chip${isCustom ? ' active' : ''}`}
          onClick={() => { if (!isCustom) config.set({ screen_height: 20 }); }}
        >
          Other
        </button>
      </div>
      {isCustom && (
        <NumInput configKey="screen_height" label="Custom Height" unit="in" min={4} max={48} step={0.125} />
      )}
    </div>
  );
}
