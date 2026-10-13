/**
 * COMPLÉTUDE de la matrice d'isolation multi-garage (§40, §41).
 *
 * ─── Pourquoi cette garde existe ────────────────────────────────────────────
 * `tenant-isolation-matrix.test.ts` éprouve l'invariant inter-garage sur une
 * LISTE de familles écrite à la main. Une liste écrite à la main se périme : au
 * moment d'écrire ces lignes, quatorze familles y figuraient, et les routes
 * ajoutées depuis — fiche client, messagerie — n'y étaient pas. Elles avaient
 * leurs propres tests, mais rien ne garantissait qu'une PROCHAINE route en
 * aurait.
 *
 * Le défaut visé n'est donc pas « telle route n'est pas isolée » : c'est « une
 * route peut naître sans que personne ne le remarque ». Même classe que
 * l'inventaire des routes sans appelant, sur une autre surface.
 *
 * ─── Ce que la garde exige ──────────────────────────────────────────────────
 * Toute route portant un segment `[id]` — celles où un identifiant devinable
 * désigne un objet — doit être soit COUVERTE par la matrice générique, soit
 * inscrite ci-dessous avec le motif et, quand elle existe, la preuve qui la
 * couvre autrement.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const API = path.join(RACINE, 'src/app/api')
const MATRICE = fs.readFileSync(
  path.join(RACINE, 'src/integration/tenant-isolation-matrix.test.ts'), 'utf8',
)

/**
 * Routes `[id]` volontairement hors matrice générique.
 *
 * `couverture` désigne le fichier qui prouve l'isolation autrement. `motif`
 * explique pourquoi la matrice générique ne convient pas — une exemption sans
 * raison lisible finirait par servir à faire taire un constat.
 */
const HORS_MATRICE: Record<string, { motif: string; couverture?: string }> = {
  // ── Ressources imbriquées : la matrice pilote des routes `/api/<fam>/[id]`,
  // pas des sous-chemins. Chacune a sa preuve dédiée.
  '/api/clients/[id]/portal-access': {
    motif: 'sous-chemin : l’accès portail d’un client, borné via clientDuGarage()',
    couverture: 'src/integration/client-email-garage-portail.test.ts',
  },
  '/api/mechanics/[id]/avatar': {
    motif: 'sous-chemin : photo d’un mécanicien, bornée au garage de la session',
    couverture: 'src/integration/mechanic-avatar-sync.test.ts',
  },
  '/api/jobs/[id]/photos': {
    motif: 'sous-chemin : photos d’une intervention, bornées via le job du garage',
    couverture: 'src/lib/__tests__/tenant-isolation.test.ts',
  },
  '/api/jobs/[id]/parts': {
    motif: 'sous-chemin : pièces consommées, bornées via le job du garage',
    couverture: 'src/lib/__tests__/stock-parts.test.ts',
  },
  '/api/jobs/[id]/timer': {
    motif: 'sous-chemin : chronomètre d’une intervention, borné via le job du garage',
    couverture: 'src/lib/__tests__/tenant-isolation.test.ts',
  },
  '/api/purchase-orders/[id]/receive': {
    motif: 'sous-chemin : réception d’une commande, bornée via le bon du garage',
    couverture: 'src/integration/purchase-order-receive-returned.test.ts',
  },
  '/api/quotes/[id]/convert': {
    motif: 'sous-chemin : conversion devis → facture, bornée via le devis du garage',
    couverture: 'src/lib/__tests__/tenant-isolation.test.ts',
  },
  '/api/quotes/[id]/signature-token': {
    motif: 'sous-chemin : lien de signature d’un devis, borné via le devis du garage',
  },
  '/api/work-orders/[id]/sign': {
    motif: 'sous-chemin : signature d’un ordre de réparation, bornée via l’OR du garage',
    couverture: 'src/lib/signature/__tests__/signature.test.ts',
  },
  '/api/einvoicing/invoices/[id]/submit': {
    motif: 'réservée au déploiement serveur (PostgreSQL) : refuse 501 sur la base du poste',
    couverture: 'src/lib/einvoicing/__tests__/submit-replay.test.ts',
  },

  // ── PWA mécanicien : l'isolation n'est pas « par garage » mais « par
  // AFFECTATION ». Un mécanicien n'atteint que les interventions qui lui sont
  // assignées, y compris au sein de son propre garage — la matrice garage ne
  // sait pas exprimer cela.
  '/api/mechanic/jobs/[id]': {
    motif: 'isolation par AFFECTATION du mécanicien, pas par garage',
    couverture: 'src/lib/__tests__/authz-mechanic-matrix.test.ts',
  },
  '/api/mechanic/jobs/[id]/notes': {
    motif: 'isolation par AFFECTATION du mécanicien, pas par garage',
    couverture: 'src/lib/__tests__/authz-mechanic-matrix.test.ts',
  },
  '/api/mechanic/jobs/[id]/photos': {
    motif: 'isolation par AFFECTATION du mécanicien, pas par garage',
    couverture: 'src/lib/__tests__/mechanic-photo.test.ts',
  },
  '/api/mechanic/jobs/[id]/timer': {
    motif: 'isolation par AFFECTATION du mécanicien, pas par garage',
    couverture: 'src/lib/__tests__/authz-mechanic-matrix.test.ts',
  },
  '/api/mechanic/jobs/[id]/checklist/[itemId]': {
    motif: 'isolation par AFFECTATION du mécanicien, pas par garage',
    couverture: 'src/lib/__tests__/authz-mechanic-matrix.test.ts',
  },
  '/api/mechanic/photos/[...path]': {
    motif: 'service de fichiers : la garde est le chemin autorisé, pas un identifiant',
    couverture: 'src/lib/__tests__/photo-store-traversal.test.ts',
  },

  // ── Clés mécanicien : ressource de la LICENCE du garage, désignée par `lid`.
  '/api/mechanic-licenses/[lid]/assign': {
    motif: 'ressource de licence désignée par `lid`, bornée à la licence de la session',
    couverture: 'src/app/api/mechanic-licenses/__tests__/assign-route.test.ts',
  },
  '/api/mechanic-licenses/[lid]/disconnect': {
    motif: 'ressource de licence désignée par `lid`, bornée à la licence de la session',
    couverture: 'src/lib/__tests__/mechanic-device-lifecycle.test.ts',
  },
  '/api/mechanic-licenses/[lid]/status': {
    motif: 'ressource de licence désignée par `lid`, bornée à la licence de la session',
    couverture: 'src/lib/__tests__/mechanic-admin.test.ts',
  },
  '/api/mechanic-licenses/[lid]/token': {
    motif: 'ressource de licence désignée par `lid`, bornée à la licence de la session',
    couverture: 'src/lib/__tests__/mechanic-session.test.ts',
  },

  // ── Portail client : l'isolation n'y est pas « par garage » mais « par
  // COMPTE ». Un client ne doit pas atteindre le fil d'un autre, fût-il du même
  // garage — la matrice garage ne sait pas exprimer cela.
  '/api/portal/tickets/[id]': {
    motif: 'isolation par COMPTE portail, pas par garage',
    couverture: 'src/integration/messagerie-client-garage.test.ts',
  },
  '/api/portal/tickets/[id]/close': {
    motif: 'isolation par COMPTE portail, pas par garage',
    couverture: 'src/integration/messagerie-client-garage.test.ts',
  },
  '/api/portal/appointments/[id]': {
    motif: 'isolation par COMPTE portail, pas par garage',
    couverture: 'src/integration/rendez-vous-client-garage.test.ts',
  },
  '/api/portal/quote/[token]': {
    motif: 'accès par JETON opaque non devinable, pas par identifiant de ressource',
  },
  '/api/portal/[token]': {
    motif: 'accès par JETON opaque non devinable, pas par identifiant de ressource',
  },

  // ── Zone d'administration de l'éditeur : hors modèle multi-garage.
  '/api/admin/licenses/[id]': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/licenses/[id]/devices': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/licenses/[id]/devices/[deviceId]': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/backups/[id]/download': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/backups/[id]/restore': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/backups/[id]/verify': { motif: 'zone éditeur : session admin, aucun garage' },
  '/api/admin/updates/file/[name]': { motif: 'zone éditeur : fichier de publication, pas une ressource de garage' },

  // ── Divers
  '/api/auth/[...nextauth]': { motif: 'point d’entrée NextAuth, imposé par le framework' },
  '/api/photos/[...path]': {
    motif: 'service de fichiers : la garde est le chemin autorisé, pas un identifiant de garage',
    couverture: 'src/lib/__tests__/photo-store-traversal.test.ts',
  },
  '/api/copilot/reports/[id]/export': { motif: 'sous-chemin : export d’un rapport, borné via le rapport du garage' },
  '/api/vehicles/[id]/timeline': { motif: 'sous-chemin : chronologie, bornée via le véhicule du garage' },
}

function fichiers(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) fichiers(p, acc)
    else acc.push(p)
  }
  return acc
}

/** Toutes les routes portant au moins un segment dynamique. */
function routesAvecIdentifiant(): string[] {
  return fichiers(API)
    .filter((f) => /route\.ts$/.test(f))
    .map((f) => '/api/' + f.slice(API.length + 1).replace(/\\/g, '/').replace(/\/route\.ts$/, ''))
    .filter((r) => r.includes('['))
    .sort()
}

/** La matrice pilote-t-elle cette route ? (son chemin y est cité tel quel) */
function couverteParLaMatrice(route: string): boolean {
  return MATRICE.includes(`'@${route.replace('/api/', '/app/api/')}/route'`)
}

describe('matrice d\'isolation — complétude', () => {
  const routes = routesAvecIdentifiant()

  it('la recherche trouve bien des routes à identifiant', () => {
    // Garde-fou : une expression cassée rendrait la liste vide, et la garde
    // passerait en ne contrôlant rien.
    expect(routes.length).toBeGreaterThan(20)
  })

  it('aucune route à identifiant n\'échappe à la fois à la matrice et à l\'inventaire', () => {
    const orphelines = routes.filter((r) => !couverteParLaMatrice(r) && !(r in HORS_MATRICE))
    expect(
      orphelines,
      'Route à identifiant non couverte. Ajoutez-la à tenant-isolation-matrix.test.ts, '
      + 'ou inscrivez-la dans HORS_MATRICE avec son motif et sa preuve.',
    ).toEqual([])
  })

  it('l\'inventaire ne conserve pas d\'entrée périmée', () => {
    const perimees = Object.keys(HORS_MATRICE).filter(
      (r) => !routes.includes(r) || couverteParLaMatrice(r),
    )
    expect(perimees, 'Ces routes n’existent plus ou sont désormais dans la matrice.').toEqual([])
  })

  it('chaque exemption porte un motif lisible', () => {
    for (const [route, e] of Object.entries(HORS_MATRICE)) {
      expect(e.motif.length, `${route} : motif trop court pour être une décision`).toBeGreaterThan(20)
    }
  })

  it('les preuves citées existent réellement', () => {
    // Une exemption qui renvoie à un fichier disparu ne couvre plus rien.
    for (const [route, e] of Object.entries(HORS_MATRICE)) {
      if (!e.couverture) continue
      expect(fs.existsSync(path.join(RACINE, e.couverture)), `${route} → ${e.couverture} introuvable`).toBe(true)
    }
  })
})
