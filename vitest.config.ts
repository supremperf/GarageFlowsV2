import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include:     ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Les suites d'intégration amorcent une base SQLite dans beforeAll via
    // `npx prisma db push` (~5 s à froid). Exécutées en parallèle avec le reste
    // de la suite, elles dépassaient le hookTimeout par défaut (10 s) — d'où des
    // échecs NON déterministes. On accorde une marge franche au démarrage sans
    // rien mocker ni désactiver ; les tests eux-mêmes gardent le timeout normal.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
