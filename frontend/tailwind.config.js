/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'pop-in': 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up': 'slideUp 0.25s ease-out forwards',
        'slide-in-right': 'slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'content-switch': 'contentSwitch 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-subtle': 'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'anchor-flash': 'anchorFlash 1.4s ease',
      },
      keyframes: {
        anchorFlash: {
          '0%, 100%': { backgroundColor: 'transparent' },
          '15%, 55%': { backgroundColor: 'rgba(251, 191, 36, 0.55)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(40px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        contentSwitch: {
          '0%': { opacity: '0.65', transform: 'translateX(6px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgba(28, 25, 23, 0.06), 0 4px 16px -4px rgba(28, 25, 23, 0.06)',
        'pop': '0 4px 12px -2px rgba(28, 25, 23, 0.08), 0 12px 32px -8px rgba(28, 25, 23, 0.12)',
      },
    },
  },
  plugins: [],
};
