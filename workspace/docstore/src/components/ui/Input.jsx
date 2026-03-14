// 입력 필드 컴포넌트
export default function Input({ label, type = 'text', value, onChange, placeholder, error, disabled, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label className="text-sm text-text-secondary">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 bg-card-bg border border-border rounded-lg text-text placeholder-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50"
      />
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
}
