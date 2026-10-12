import type { Config } from 'tailwindcss'

// Spec §3: near-black, white and neutral greys; one muted accent used sparingly;
// red / amber / green reserved for status and severity only.
// Colour values live as CSS variables in src/index.css.
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        surface: token('surface'),
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        border: token('border'),
        ring: token('ring'),
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        status: {
          danger: token('status-danger'),
          'danger-bg': token('status-danger-bg'),
          warning: token('status-warning'),
          'warning-bg': token('status-warning-bg'),
          success: token('status-success'),
          'success-bg': token('status-success-bg'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
} satisfies Config
