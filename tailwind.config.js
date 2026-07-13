/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        ink: '#111827',
        mist: '#F5F7FB',
        line: '#E5E7EB',
        cobalt: '#2563EB',
        amber: '#D97706',
        rose: '#DB2777',
        mint: '#059669',
      },
      boxShadow: {
        panel: '0 18px 50px rgba(17, 24, 39, 0.08)',
        lift: '0 12px 30px rgba(37, 99, 235, 0.16)',
      },
      keyframes: {
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 80%, 100%': { opacity: '0.3', transform: 'scale(0.9)' },
          '40%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        reveal: 'reveal 220ms ease-out both',
        'pulse-dot': 'pulseDot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
