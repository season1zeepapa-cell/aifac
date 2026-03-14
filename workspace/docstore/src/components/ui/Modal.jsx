// 모달 컴포넌트
export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-2xl', lg: 'max-w-4xl', full: 'max-w-full mx-4' };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 sm:pt-10 px-2 sm:px-4 pb-4 overflow-y-auto" onClick={onClose}>
      {/* 배경 오버레이 */}
      <div className="fixed inset-0 bg-black/30" />
      {/* 모달 본체 */}
      <div
        className={`relative bg-card-bg border border-border rounded-xl w-full ${sizes[size]} fade-in`}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-text truncate min-w-0">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text transition-colors shrink-0" aria-label="닫기">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {/* 내용 */}
        <div className="p-3 sm:p-4 max-h-[75vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
