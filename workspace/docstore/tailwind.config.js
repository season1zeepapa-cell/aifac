/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './src/index.html'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'card-bg': 'var(--card-bg)',
        'card-bg-hover': 'var(--card-bg-hover)',
        text: 'var(--text)',
        'text-secondary': 'var(--text-secondary)',
        primary: 'var(--primary)',
        'primary-hover': 'var(--primary-hover)',
        border: 'var(--border)',
        danger: 'var(--danger)',
        'danger-hover': 'var(--danger-hover)',
        'input-bg': 'var(--input-bg)',
        'badge-bg': 'var(--badge-bg)',
      },
      boxShadow: {
        sm: '0 1px 2px var(--shadow-color)',
        md: '0 4px 6px var(--shadow-color)',
        lg: '0 10px 15px var(--shadow-color)',
      },
    },
  },
  plugins: [],
};
