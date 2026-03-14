import { useState, useRef, useEffect } from 'react';

// 멀티 선택 드롭다운 (문서 범위 필터용)
export default function MultiSelect({ label, selectedIds, onChange, options, placeholder = '전체' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(v => v !== id)
      : [...selectedIds, id];
    onChange(next);
  };

  const displayText = selectedIds.length === 0
    ? placeholder
    : selectedIds.length <= 2
      ? selectedIds.map(id => { const o = options.find(o => o.value === id); return o ? o.label : id; }).join(', ')
      : `${selectedIds.length}개 문서 선택`;

  return (
    <div className="flex flex-col gap-1.5 relative" ref={ref}>
      {label && <label className="text-sm text-text-secondary">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 bg-card-bg border border-border rounded-lg text-left text-sm text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
      >
        <span className={selectedIds.length === 0 ? 'text-text-secondary' : ''}>{displayText}</span>
        <svg className="w-3 h-3 absolute right-3 top-1/2 mt-2 -translate-y-1/2 text-text-secondary" fill="currentColor" viewBox="0 0 12 12"><path d="M6 8L1 3h10z"/></svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card-bg border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
          {selectedIds.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 border-b border-border"
            >선택 초기화</button>
          )}
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={selectedIds.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="truncate">{opt.label}</span>
            </label>
          ))}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-secondary">문서가 없습니다</p>
          )}
        </div>
      )}
    </div>
  );
}
