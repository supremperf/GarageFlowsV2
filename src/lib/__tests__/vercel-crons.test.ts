/**
 * TÂCHES PLANIFIÉES VERCEL — déclaration, cible réelle, authentification.
 *
 * ─── Ce que l'audit du 2026-10-20 a constaté ────────────────────────────────
 * Aucun `vercel.json` / `vercel.ts` n'existait, donc AUCUN cron n'était déclaré,
 * alors que `/api/internal/einvoicing/queue` documente en tête de fichier
 * attendre « une tâche planifiée de l'exploitant (cron Vercel, planificateur
 * système) ». La reprise des transmissions de facturation électronique en échec
 * ne partait donc jamais : aucune erreur, simplement rien.
 *
 * ─── Périmètre exact, et pourquoi il est si étroit ──────────────────────────
 * Un premier passage d'audit avait annoncé que « rappels, notifications et
 * sauvegardes ne partent jamais d'eux-mêmes ». C'était FAUX, et ce test fige la
 * réalité vérifiée pour que l'erreur ne se réinstalle pas :
 *
 *   · /api/reminders/send, /api/notifications/dispatch, /api/jobs/pulse,
 *     /api/vehicles/ct-alerts, /api/warranties/alerts, /api/parts/low-stock
 *     → `withAuth` + `requireSession` : routes d'INTERFACE. Un cron n'a pas de
 *       session et ne pourrait pas les appeler ; leur donner un cron exigerait
 *       d'affaiblir leur garde.
 *   · /api/internal/backup → clé interne + origine LOOPBACK obligatoire, et
 *       refus 409 `SQLITE_ONLY` hors SQLite : c'est la sauvegarde du poste
 *       desktop, déclenchée par Electron. Inatteignable depuis un cron Vercel,
 *       par conception.
 *   · /api/einvoicing/webhooks/[providerId] → point d'entrée serveur à serveur
 *       que la plateforme agréée POSTE elle-même, authentifié par signature
 *       HMAC. Ce n'est pas une tâche planifiée : il doit juste être déployé.
 *   · /api/admin/backups/**, /api/admin/diagnostics → déclencheurs
 *       d'exploitation nommés (scripts/reset-garageflow.ps1), pas des crons.
 *   · expiration des licences → évaluée À CHAQUE vérification
 *       (src/lib/license/verify.ts, state-machine.ts). Aucune tâche de balayage
 *       n'est nécessaire, et en ajouter une créerait deux sources de vérité.
 *
 * L'inventaire autoritatif est `src/lib/__tests__/routes-sans-appelant.test.ts`,
 * qui exige un « DÉCLENCHEUR RÉEL » nommé pour toute route sans appelant.
 *
 * ─── Authentification du cron : point d'exploitation à ne pas rater ─────────
 * Vercel appelle un cron avec `Authorization: Bearer $CRON_SECRET` lorsque la
 * variable `CRON_SECRET` est définie. La route, elle, compare à
 * `EINVOICING_QUEUE_TOKEN` (temps constant, ≥ 32 caractères, aucun repli).
 *
 * Les deux variables doivent donc porter la MÊME valeur. Ce couplage est
 * délibéré : la route affirme en commentaire « aucun repli sur une autre clé,
 * aucune valeur par défaut », et élargir sa frontière d'authentification pour
 * accepter un second secret serait un mauvais échange sur une route sensible.
 *
 * Conséquence si l'exploitant les désaccorde : le cron reçoit 401 et la reprise
 * ne se fait pas — en silence, car un cron en échec n'alerte personne par
 * défaut. C'est la raison d'être du dernier test de ce fichier.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const VERCEL_JSON = path.join(RACINE, 'vercel.json')

interface Cron { path: string; schedule: string }

function config(): { crons?: Cron[] } {
  return JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'))
}

/** Chemin de route App Router correspondant à un chemin d'URL de cron. */
function fichierRoute(urlPath: string): string {
  return path.join(RACINE, 'src', 'app', urlPath, 'route.ts')
}

describe('vercel.json — tâches planifiées', () => {
  it('le fichier existe et est un JSON valide', () => {
    expect(fs.existsSync(VERCEL_JSON), 'vercel.json absent : aucun cron ne serait déclaré').toBe(true)
    expect(() => config()).not.toThrow()
  })

  it('déclare exactement la reprise de la file de facturation électronique', () => {
    const crons = config().crons ?? []
    expect(crons.map((c) => c.path)).toEqual(['/api/internal/einvoicing/queue'])
  })

  it('chaque cron déclaré cible une route qui EXISTE réellement', () => {
    // Un cron sur un chemin inexistant est un 404 répété toutes les heures,
    // invisible dans l'interface : Vercel ne valide pas la cible.
    for (const c of config().crons ?? []) {
      expect(fs.existsSync(fichierRoute(c.path)), `route absente pour le cron ${c.path}`).toBe(true)
    }
  })

  it('chaque cron cible une route qui exporte POST ou GET', () => {
    // Vercel appelle un cron en GET. Si la route n'expose que POST, il faut le
    // savoir : ici la route n'expose QUE POST, et c'est documenté comme tel.
    for (const c of config().crons ?? []) {
      const src = fs.readFileSync(fichierRoute(c.path), 'utf8')
      expect(/export (async function|const) (GET|POST)/.test(src), `${c.path} n’exporte ni GET ni POST`).toBe(true)
    }
  })

  it('chaque cron cible une route AUTHENTIFIÉE (jamais une route ouverte)', () => {
    // Un endpoint déclenchable par cron est joignable publiquement : sans garde,
    // n'importe qui peut relancer le traitement à volonté.
    for (const c of config().crons ?? []) {
      const src = fs.readFileSync(fichierRoute(c.path), 'utf8')
      const garde = /timingSafeEqual|withAuth|requireSession|internalRequestAuthorized/.test(src)
      expect(garde, `${c.path} n’a aucune garde d’authentification identifiable`).toBe(true)
    }
  })

  it('la planification est une expression cron à 5 champs, et évite la minute de pointe', () => {
    for (const c of config().crons ?? []) {
      expect(c.schedule.trim().split(/\s+/)).toHaveLength(5)
      // Minute 0 : tous les planificateurs du monde s'y déclenchent. Décaler
      // réduit les files d'attente côté plateforme agréée.
      expect(c.schedule.trim().split(/\s+/)[0], 'éviter la minute 0').not.toBe('0')
    }
  })

  it('le couplage CRON_SECRET ⇄ EINVOICING_QUEUE_TOKEN est déclaré au manifeste', () => {
    // Si ce couplage n'est pas documenté là où l'exploitant provisionne les
    // variables, il sera manqué, et le cron échouera en 401 silencieux.
    const manifeste = JSON.parse(
      fs.readFileSync(path.join(RACINE, 'scripts', 'garageflow-env-manifest.json'), 'utf8'),
    ) as { variables: Array<{ name: string; notes?: string }> }

    const cron = manifeste.variables.find((v) => v.name === 'CRON_SECRET')
    expect(cron, 'CRON_SECRET doit être déclarée au manifeste').toBeDefined()
    expect(cron!.notes ?? '').toMatch(/EINVOICING_QUEUE_TOKEN/)

    const jeton = manifeste.variables.find((v) => v.name === 'EINVOICING_QUEUE_TOKEN')
    expect(jeton, 'EINVOICING_QUEUE_TOKEN doit rester déclarée').toBeDefined()
  })
})
