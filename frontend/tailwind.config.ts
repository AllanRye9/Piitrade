import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      maxWidth: { '7xl': '92rem' }, // 1472px: use wide desktops like Amazon/Dubizzle instead of a 1280px column
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'Times New Roman', 'serif'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Overrides Tailwind's built-in `red` scale so every existing
        // bg-red-*/text-red-*/border-red-*/ring-red-*/from-red-*/to-red-*
        // utility across the app renders the Talabat-inspired brand orange
        // instead of red, with no per-component class-name changes required.
        red: {
          50: '#FFF4EC',
          100: '#FFE4D1',
          200: '#FFC7A3',
          300: '#FFA366',
          400: '#FF8433',
          500: '#FF6500',
          600: '#F55906',
          700: '#E94B00',
          800: '#C23F00',
          900: '#9A3300',
        },
        brand: {
          50: '#FFF4EC',
          100: '#FFE4D1',
          200: '#FFC7A3',
          300: '#FFA366',
          400: '#FF8433',
          500: '#FF6500',
          600: '#F55906',
          700: '#E94B00',
          800: '#C23F00',
          900: '#9A3300',
        },
        premium: {
          navy: '#E94B00',
          gold: '#FF6500',
          'gold-light': '#FF8433',
          'gold-dark': '#E94B00',
          red: '#F55906',
          cream: '#FFF0E8',
          charcoal: '#292929',
        },
        theme: {
          DEFAULT: '#F55906',
          light: '#FFF0E8',
          dark: '#E94B00',
        },
        success: {
          DEFAULT: '#2E9B55',
          light: '#D1FAE5',
          dark: '#237A43',
        },
        warning: {
          DEFAULT: '#F59E0B',
          light: '#FEF3C7',
          dark: '#D97706',
        },
        error: {
          DEFAULT: '#D92D20',
          light: '#FEE2E2',
          dark: '#B42318',
        },
        info: {
          DEFAULT: '#3B82F6',
          light: '#DBEAFE',
          dark: '#2563EB',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'fade-up': 'fadeUp 0.5s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 1.4s ease-in-out infinite',
        'ticker': 'ticker 30s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'bounce-subtle': 'bounceSlight 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(245 89 6 / 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgb(245 89 6 / 0)' },
        },
        bounceSlight: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgb(245 89 6 / 0.25)',
        'glow-lg': '0 0 40px rgb(245 89 6 / 0.3)',
        'card': '0 2px 10px 0 rgb(0 0 0 / 0.05)',
        'card-hover': '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)',
        'search': '0 2px 10px rgba(0,0,0,0.06)',
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(135deg, #FF6500 0%, #F55906 40%, #E94B00 100%)',
        'brand-gradient': 'linear-gradient(135deg, #FF6500, #F55906)',
        'premium-gradient': 'linear-gradient(135deg, #FF6500 0%, #F55906 50%, #E94B00 100%)',
        'theme-gradient': 'linear-gradient(135deg, #FFA366 0%, #F55906 50%, #E94B00 100%)',
        'theme-gradient-soft': 'linear-gradient(160deg, #FFFDFB 0%, #FFF4EC 40%, #FFF0E8 70%, #FFF8F3 100%)',
      },
      screens: {
        'xs': '375px',
      },
    },
  },
  plugins: [],
};
export default config;
