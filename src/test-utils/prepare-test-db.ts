/**
 * Amorçage d'une base SQLite de test — GF31-AUD-024.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Chaque suite d'intégration créait son schéma en lançant le CLI Prisma :
 *
 *   execSync('npx prisma db push --skip-generate --accept-data-loss', …)
 *
 * Vingt-quatre fichiers, donc vingt-quatre démarrages du CLI, exécutés en
 * parallèle par vitest. Mesuré sur cette machine : ~8 s à vide pour un fichier
 * seul, mais au-delà du `hookTimeout` de 30 s dès que la machine est chargée —
 * `suppliers.test.ts` a échoué ainsi le 2026-08-13, puis passé SEUL en 11,3 s.
 *
 * Le dépôt avait déjà relevé ce délai de 10 à 30 s pour ce motif exact. Relever
 * un délai ne corrige rien : cela déplace le seuil (§151). Le coût d'amorçage
 * était le vrai problème.
 *
 * ─── La correction ──────────────────────────────────────────────────────────
 * Le schéma est construit UNE fois par empreinte de `schema.prisma`, puis
 * simplement COPIÉ pour chaque suite. Un fichier SQLite vide de quelques
 * centaines de kilo-octets se copie en quelques millisecondes.
 *
 * L'empreinte garantit qu'une modification du schéma invalide le modèle : on ne
 * peut pas tester contre une structure périmée. Le modèle vit sous
 * `node_modules/.cache`, donc hors du dépôt et effacé par un `npm ci`.
 *
 * Concurrence : plusieurs processus de test peuvent démarrer en même temps.
 * Chacun construit dans un fichier temporaire qui lui est propre, puis tente de
 * le renommer sur le nom définitif ; le perdant jette son travail et utilise le
 * modèle du gagnant. Aucun verrou, aucune attente.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'gf-test-db')

/** Le CLI Prisma DU PROJET, lancé par le Node courant (jamais via `npx`). */
function prismaCli(): string {
  return createRequire(__filename).resolve('prisma/build/index.js')
}

function empreinteSchema(): string {
  return createHash('sha256').update(fs.readFileSync(SCHEMA)).digest('hex').slice(0, 16)
}

function construireModele(cible: string): void {
  execFileSync(
    process.execPath,
    [prismaCli(), 'db', 'push', '--skip-generate', '--accept-data-loss'],
    // Keep successful setup quiet, but retain stderr in a thrown ExecFileSyncError.
    // Discarding it hid the actual engine/download failure behind « Command failed ».
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${cible}` }, stdio: 'pipe' },
  )
}

/**
 * Rend `dbPath` prêt à l'emploi : base vide au schéma courant.
 * Remplace l'appel direct au CLI Prisma dans les `beforeAll` des suites.
 */
export function prepareTestDb(dbPath: string): void {
  const modele = path.join(CACHE, `${empreinteSchema()}.db`)

  if (!fs.existsSync(modele)) {
    fs.mkdirSync(CACHE, { recursive: true })
    const provisoire = path.join(CACHE, `build-${process.pid}-${Date.now()}.db`)
    try {
      construireModele(provisoire)
      try {
        fs.renameSync(provisoire, modele)
      } catch {
        // Un autre processus a publié le modèle avant nous : le sien fait foi.
        fs.rmSync(provisoire, { force: true })
      }
    } catch (err) {
      fs.rmSync(provisoire, { force: true })
      throw err
    }
  }

  fs.rmSync(dbPath, { force: true })
  // `-journal` / `-wal` d'une exécution précédente rendraient la copie incohérente.
  for (const suffixe of ['-journal', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffixe}`, { force: true })
  }
  fs.copyFileSync(modele, dbPath)
}
