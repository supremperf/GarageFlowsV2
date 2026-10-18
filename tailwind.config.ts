import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // ── Contrat du design system : classes de SURFACE ─────────────────────────
  // `gf-surface-light` / `gf-surface-dark` déclarent la nature d'une surface et
  // pilotent la couleur des champs (cf. globals.css § Surfaces). Tailwind élague
  // les règles dont la classe n'apparaît pas dans le contenu scanné : sans cette
  // liste, l'échappatoire `gf-surface-dark` n'existerait pas tant qu'aucun
  // composant ne l'utilise — précisément quand on en a besoin. Elles sont donc
  // TOUJOURS émises (deux règles de quelques octets).
  safelist: ['gf-surface-light', 'gf-surface-dark'],
  theme: {
    // ── Breakpoints centralisés (alignés sur la stratégie responsive) ──────────
    //  xs  480px  → mobile large (au-dessus du portrait étroit)
    //  sm  640px  → mobile large / petit paysage
    //  md  768px  → tablette portrait
    //  lg  1024px → tablette paysage / petit ordinateur
    //  xl  1280px → desktop
    //  2xl 1536px → grand écran
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      // Espacements « safe-area » iOS réutilisables : p-safe-b, pt-safe, etc.
      spacing: {
        'safe-t': 'env(safe-area-inset-top)',
        'safe-r': 'env(safe-area-inset-right)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        }
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
export default config
