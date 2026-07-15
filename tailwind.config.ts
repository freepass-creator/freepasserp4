import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        page:     'var(--bg-page)',
        card:     'var(--bg-card)',
        header:   'var(--bg-header)',
        stripe:   'var(--bg-stripe)',
        hover:    'var(--bg-hover)',
        selected: 'var(--bg-selected)',
        disabled: 'var(--bg-disabled)',
        main:    'var(--text-main)',
        sub:     'var(--text-sub)',
        weak:    'var(--text-weak)',
        muted:   'var(--text-muted)',
        inverse: 'var(--text-inverse)',
        link:    'var(--text-link)',
        red:    { DEFAULT: 'var(--alert-red-text)',    bg: 'var(--alert-red-bg)' },
        orange: { DEFAULT: 'var(--alert-orange-text)', bg: 'var(--alert-orange-bg)' },
        green:  { DEFAULT: 'var(--alert-green-text)',  bg: 'var(--alert-green-bg)' },
        blue:   { DEFAULT: 'var(--alert-blue-text)',   bg: 'var(--alert-blue-bg)' },
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        soft:    'var(--border-soft)',
        strong:  'var(--border-strong)',
        focus:   'var(--border-focus)',
      },
      fontSize: {
        xs:   ['11px', '1.5'],
        sm:   ['12px', '1.5'],
        base: ['12px', '1.5'],
        md:   ['12px', '1.5'],
        lg:   ['13px', '1.5'],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '4px',
        xl: '4px',
        full: '999px',
      },
    },
  },
  plugins: [],
};

export default config;
