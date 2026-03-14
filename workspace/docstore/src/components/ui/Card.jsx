// 카드 컴포넌트
export default function Card({ children, onClick, className = '', hoverable = false }) {
  return (
    <div
      className={`bg-card-bg border border-border rounded-xl p-3 sm:p-4 shadow-sm ${hoverable ? 'cursor-pointer hover:bg-card-bg-hover hover:border-primary/30 hover:shadow-md transition-all duration-200' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
