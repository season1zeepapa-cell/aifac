// 프로그레스 바 컴포넌트
export default function ProgressBar({ value, className = '' }) {
  return (
    <div className={`w-full bg-border rounded-full h-2 overflow-hidden ${className}`}>
      <div
        className="bg-primary h-full rounded-full transition-all duration-300 progress-animate"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
