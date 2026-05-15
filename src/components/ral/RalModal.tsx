import { useState, useMemo } from 'react';
import { useConfigStore } from '../../store/configStore';
import { RAL_COLORS } from '../../config/ralColors';

const POPULAR = ['RAL 9005', 'RAL 7016', 'RAL 8019', 'RAL 8017', 'RAL 9007', 'RAL 9006'];
const TABS = [
  { key: 'popular', label: 'Popular' },
  { key: '1', label: 'Yellow' },
  { key: '2', label: 'Orange' },
  { key: '3', label: 'Red' },
  { key: '4', label: 'Purple' },
  { key: '5', label: 'Blue' },
  { key: '6', label: 'Green' },
  { key: '7', label: 'Grey' },
  { key: '8', label: 'Brown' },
  { key: '9', label: 'White/Black' },
];

interface Props { open: boolean; onClose: () => void; }

export function RalModal({ open, onClose }: Props) {
  const powder_coat_color = useConfigStore(s => s.powder_coat_color);
  const set = useConfigStore(s => s.set);
  const [activeTab, setActiveTab] = useState('popular');
  const [search, setSearch] = useState('');

  const colors = useMemo(() => {
    if (search.trim()) {
      const t = search.toLowerCase().trim();
      return RAL_COLORS.filter(c => c.name.toLowerCase().includes(t) || c.ral.toLowerCase().includes(t) || c.product_code.toLowerCase().includes(t));
    }
    if (activeTab === 'popular') return RAL_COLORS.filter(c => POPULAR.includes(c.ral));
    return RAL_COLORS.filter(c => c.ral.startsWith(`RAL ${activeTab}`));
  }, [activeTab, search]);

  function selectColor(hex: string) {
    set({ powder_coat_color: hex });
    onClose();
  }

  return (
    <div className={`ral-modal-overlay${open ? ' active' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ral-modal-content">
        <div className="ral-modal-header">
          <h3>Select Powder Coat Color</h3>
          <button className="ral-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="ral-search-bar">
          <svg className="ral-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            className="ral-search-input"
            type="text"
            placeholder="Search by name, code, or 'Blue', 'White'…"
            autoComplete="off"
            value={search}
            onChange={e => { setSearch(e.target.value); if (e.target.value) setActiveTab(''); }}
          />
        </div>
        <div className="ral-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`ral-tab${activeTab === tab.key && !search ? ' active' : ''}`}
              onClick={() => { setActiveTab(tab.key); setSearch(''); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ral-grid-container">
          {colors.length === 0 ? (
            <div className="ral-empty-state">No colors match your search. Try another keyword.</div>
          ) : (
            <div className="ral-grid">
              {colors.map(col => (
                <div
                  key={col.ral}
                  className={`ral-swatch-item${powder_coat_color === col.hex ? ' selected' : ''}`}
                  onClick={() => selectColor(col.hex)}
                >
                  <div className="ral-color-block" style={{ backgroundColor: col.hex }} title={col.name} />
                  <div className="ral-item-code">{col.ral}</div>
                  <div className="ral-item-name">{col.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
