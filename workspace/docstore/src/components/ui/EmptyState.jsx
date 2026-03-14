// 빈 상태 컴포넌트
export default function EmptyState({ icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4 opacity-30">{icon}</div>
      <h3 className="text-lg font-medium text-text-secondary mb-2">{title}</h3>
      {description && <p className="text-sm text-text-secondary/70">{description}</p>}
    </div>
  );
}
