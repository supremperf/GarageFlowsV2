/**
 * INVENTAIRE des routes d'API qu'aucun code appelant ne mentionne.
 *
 * ─── Pourquoi cette garde existe ────────────────────────────────────────────
 * Ce produit a livré quatre fois la même chose : une route correcte, éprouvée,
 * qu'aucun écran n'appelait. La réception fournisseur incrémentait le stock sans
 * que personne la déclenche ; la photo de mécanicien arrivait au cloud pendant
 * que la PWA affichait les initiales ; les accès portail fonctionnaient sans
 * interface ; toute la chaîne d'émission de facture électronique — envoi,
 * relecture de statut, sortie de l'impasse « issue inconnue » — était
 * inatteignable.
 *
 * À chaque fois, le défaut avait la même signature : des tests verts, une revue
 * satisfaite, et un utilisateur qui ne peut rien en faire. Une revue de code ne
 * l'attrape pas, parce qu'il n'est visible NULLE PART dans le fichier examiné —
 * il est dans ce qui n'existe pas ailleurs.
 *
 * Ce fichier fige donc l'inventaire. Il n'exige pas que tout soit branché : il
 * exige que chaque route sans appelant soit une DÉCISION, portant un motif, et
 * qu'aucune ne s'ajoute en silence.
 *
 * ─── Comment répondre à un échec ────────────────────────────────────────────
 *   · une route apparaît dans « non déclarées » → soit on la branche, soit on
 *     la supprime, soit on l'inscrit ci-dessous avec son motif ;
 *   · une route déclarée n'est plus orpheline → l'inscription est retirée. La
 *     garde le signale, pour que l'inventaire ne se périme pas.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const API = path.join(RACINE, 'src/app/api')

/**
 * Motifs admis, par ordre de gravité décroissante pour l'utilisateur.
 *
 *  `sans-interface` — la fonction n'a AUCUN chemin utilisateur. C'est le cas qui
 *      compte : la fonctionnalité n'existe pas pour le garage ni pour son client,
 *      quoi qu'en dise la documentation.
 *  `double`        — la fonction est atteignable ailleurs ; cette route est un
 *      second point d'entrée HTTP, donc de la surface exposée sans usage.
 *  `exploitation`  — destinée à un opérateur ou à un outil externe, appelée à la
 *      main ou par une sonde ; aucune interface n'est attendue.
 *  `cadre`         — imposée par le framework, jamais appelée par notre code.
 */
type Motif = 'sans-interface' | 'double' | 'exploitation' | 'cadre'

const INVENTAIRE: Record<string, { motif: Motif; note: string }> = {
  '/api/auth/[...nextauth]': { motif: 'cadre', note: 'point d’entrée NextAuth, atteint par signIn()' },

  '/api/ping': { motif: 'exploitation', note: 'sonde de disponibilité ; Electron interroge le serveur de licences, pas celle-ci' },
  '/api/admin/backups': { motif: 'exploitation', note: 'liste et déclenche les sauvegardes ; pilotée par script d’exploitation' },
  '/api/admin/backups/[id]/download': { motif: 'exploitation', note: 'récupération d’une archive par l’exploitant, hors interface' },
  '/api/admin/backups/[id]/restore': { motif: 'exploitation', note: 'restauration : geste délibérément sans bouton, jamais à un clic' },
  '/api/admin/backups/[id]/verify': { motif: 'exploitation', note: 'contrôle d’intégrité d’une archive, lancé à la main' },

  '/api/vin': { motif: 'double', note: 'vinEngine atteint via /api/copilot, /api/ocr et /api/catalog' },
  '/api/diagnostic': { motif: 'double', note: 'diagnose() atteint via /api/copilot' },
  '/api/stock-forecast': { motif: 'double', note: 'planReorders() atteint via /api/dashboard et /api/proactive' },
  '/api/forgotten-parts': { motif: 'double', note: 'moteur atteint via /api/quotes/generate' },
  '/api/signatures': { motif: 'double', note: 'signature atteinte via /api/portal/quote/[token]' },

  // ── Ce qui n'existe pas pour l'utilisateur ────────────────────────────────
  // Le portail client, en particulier : messagerie, prise de rendez-vous,
  // double facteur et gestion des appareils sont écrits, testés, et absents des
  // cinq pages du portail.
  '/api/portal/tickets': { motif: 'sans-interface', note: 'messagerie client : liste et ouverture, aucune des cinq pages du portail ne l’appelle' },
  '/api/portal/tickets/[id]': { motif: 'sans-interface', note: 'fil d’un message client : lecture et réponse, sans écran pour l’afficher' },
  '/api/portal/tickets/[id]/close': { motif: 'sans-interface', note: 'clôture d’un fil par le client, sans bouton pour la déclencher' },
  '/api/tickets': { motif: 'sans-interface', note: 'côté garage de la messagerie : aucun panneau du poste ne la lit' },
  '/api/tickets/[id]': { motif: 'sans-interface', note: 'réponse du garage à un client, sans écran de conversation' },
  '/api/portal/appointments': { motif: 'sans-interface', note: 'prise de rendez-vous par le client : créneaux et demande, aucune page' },
  '/api/portal/appointments/[id]': { motif: 'sans-interface', note: 'report et annulation d’un rendez-vous client, sans interface' },
  '/api/portal/auth/2fa/setup': { motif: 'sans-interface', note: 'génération du secret de double facteur, sans écran de configuration' },
  '/api/portal/auth/2fa/enable': { motif: 'sans-interface', note: 'activation du double facteur : le schéma le porte, le portail ne l’offre pas' },
  '/api/portal/auth/2fa/disable': { motif: 'sans-interface', note: 'désactivation du double facteur, inatteignable comme son activation' },
  '/api/portal/auth/devices': { motif: 'sans-interface', note: 'le client ne peut ni voir ses sessions ouvertes ni en révoquer une' },

  // Cinq modules dont le cœur métier n'est appelé QUE par leur propre route :
  // ni le copilote, ni le tableau de bord, ni aucun écran ne les atteint.
  '/api/pricing': { motif: 'sans-interface', note: 'optimisation des prix : recommendPrice() n’est appelé que d’ici' },
  '/api/scheduling': { motif: 'sans-interface', note: 'planification intelligente : optimizeSchedule() n’est appelé que d’ici' },
  '/api/memory': { motif: 'sans-interface', note: 'mémoire du garage : analyzeMemory() n’est appelé que d’ici' },
  '/api/gamification': { motif: 'sans-interface', note: 'classement des mécaniciens : buildLeaderboard() n’est appelé que d’ici' },
  '/api/proactive': { motif: 'sans-interface', note: 'assistant proactif : buildAlerts() n’est appelé que d’ici' },
  '/api/analytics/health': { motif: 'sans-interface', note: 'score de santé — aucun écran ne l’affiche' },
  '/api/copilot/reports/[id]/export': { motif: 'sans-interface', note: 'export de rapport du copilote — aucun bouton' },

  '/api/parts/low-stock': { motif: 'sans-interface', note: 'alerte de stock bas — aucun écran' },
  '/api/reminders/suggestions': { motif: 'sans-interface', note: 'suggestions de rappels — aucun écran' },
  '/api/vehicles/ct-alerts': { motif: 'sans-interface', note: 'alertes de contrôle technique — aucun écran' },
  '/api/vehicles/[id]/timeline': { motif: 'sans-interface', note: 'historique véhicule — aucun écran' },

  '/api/license/devices': { motif: 'sans-interface', note: 'l’exploitant ne peut pas voir la liste de ses postes activés' },
  '/api/license/deactivate': { motif: 'sans-interface', note: 'ni libérer un poste : un ordinateur remplacé consomme une place à vie' },
  '/api/admin/licenses/[id]/devices': { motif: 'sans-interface', note: 'appareils d’une licence : absent de la zone d’administration' },
  '/api/admin/licenses/[id]/devices/[deviceId]': { motif: 'sans-interface', note: 'libération d’un poste par l’éditeur, sans écran pour le faire' },
}

function fichiers(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) fichiers(p, acc)
    else acc.push(p)
  }
  return acc
}

/**
 * Corpus appelant : tout le code SAUF les routes elles-mêmes.
 *
 * Les tests en font partie à dessein — une route dont seul un test parle reste
 * orpheline pour l'utilisateur, et c'est exactement ce qu'il faut voir. Les
 * routes sont exclues pour la raison inverse : une route qui s'appelle
 * elle-même, ou qu'une route voisine appelle, ne fait pas d'elle une
 * fonctionnalité atteignable.
 */
function corpusAppelant(): string {
  const sources = [
    ...fichiers(path.join(RACINE, 'src')),
    ...fichiers(path.join(RACINE, 'electron')),
  ]
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
    .filter((f) => !f.includes(`${path.sep}app${path.sep}api${path.sep}`))
    .filter((f) => !f.includes(`${path.sep}generated${path.sep}`))
    // Ce fichier cite toutes les routes : il se rendrait aveugle lui-même.
    .filter((f) => !f.endsWith('routes-sans-appelant.test.ts'))
  return sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
}

function orphelines(): string[] {
  const corpus = corpusAppelant()
  const trouvees: string[] = []
  for (const f of fichiers(API).filter((x) => /route\.ts$/.test(x))) {
    const chemin = '/api/' + f.slice(API.length + 1).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
    // Un segment dynamique devient un joker : `/api/clients/[id]/portal-access`
    // s'écrit `/api/clients/${id}/portal-access` chez l'appelant.
    const motif = chemin
      .split('/')
      .map((s) => (s.startsWith('[') ? '[^/`\'"]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    if (!new RegExp(motif).test(corpus)) trouvees.push(chemin)
  }
  return trouvees.sort()
}

describe('routes d\'API sans appelant — inventaire figé', () => {
  const constatees = orphelines()

  it('aucune route orpheline ne s\'ajoute en silence', () => {
    const nonDeclarees = constatees.filter((r) => !(r in INVENTAIRE))
    expect(
      nonDeclarees,
      'Route sans appelant non déclarée. Branchez-la, supprimez-la, ou inscrivez-la dans INVENTAIRE avec son motif.',
    ).toEqual([])
  })

  it('l\'inventaire ne conserve pas d\'entrée périmée', () => {
    // Une route rebranchée doit sortir de la liste, sinon l'inventaire cesse de
    // décrire la réalité et l'on recommence à se fier à un document.
    const perimees = Object.keys(INVENTAIRE).filter((r) => !constatees.includes(r))
    expect(perimees, 'Ces routes ont un appelant : retirez-les de INVENTAIRE.').toEqual([])
  })

  it('chaque entrée porte un motif et une note utile', () => {
    for (const [route, e] of Object.entries(INVENTAIRE)) {
      expect(e.note.length, `${route} : note trop courte pour être une décision`).toBeGreaterThan(15)
    }
  })

  it('les chaînes récemment rebranchées ne retombent pas dans l\'inventaire', () => {
    // Anti-régression directe sur les quatre défauts déjà corrigés.
    for (const r of [
      '/api/clients',
      '/api/clients/[id]',
      '/api/clients/[id]/portal-access',
      '/api/purchase-orders/[id]/receive',
      '/api/mechanics/[id]/avatar',
      '/api/einvoicing/invoices/[id]/submit',
    ]) {
      expect(constatees, `${r} est redevenue inatteignable`).not.toContain(r)
    }
  })
})
