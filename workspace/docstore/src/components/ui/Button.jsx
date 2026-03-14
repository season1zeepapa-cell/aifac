// 버튼 컴포넌트
export default function Button({ children, variant = 'primary', size = 'md', disabled, onClick, className = '', type = 'button' }) {
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white';
  const variants = {
    primary: 'bg-primary hover:bg-primary-hover text-white focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed',
    secondary: 'bg-border hover:bg-card-bg-hover text-text focus:ring-border',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
    ghost: 'bg-transparent hover:bg-border text-text-secondary hover:text-text focus:ring-border',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
