import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui'],
      },
    },
  },
  plugins: [],
};
export default config;
