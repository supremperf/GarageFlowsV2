/**
 * CONTRAT KEYGEN (Python) ↔ API LICENCES (TypeScript).
 *
 * Le Keygen est un outil séparé, écrit dans un autre langage, non couvert par
 * `tsc`. Renommer une route ou un champ côté backend ne casse donc RIEN à la
 * compilation : la divergence n'apparaît qu'au moment où un opérateur tente
 * d'enregistrer une clé, en production.
 *
 * Ce test lit le source Python et vérifie que chaque appel qu'il contient a
 * toujours une contrepartie réelle côté API.
 *
 * Les appels HTTP du Keygen ont été CENTRALISÉS dans `scripts/keygen_server.py`
 * (une seule source : plus d'URL recopiée dans l'interface). Le contrat est donc
 * vérifié sur ce module, pas sur l'IHM.
 *
 * MATRICE VÉRIFIÉE
 * ┌──────────────────────────┬──────────────────────────────────┬────────┬──────────┬──────────────────────────────┐
 * │ ACTION                   │ ENDPOINT                         │ METHOD │ AUTH     │ REQUEST                      │
 * ├──────────────────────────┼──────────────────────────────────┼────────┼──────────┼──────────────────────────────┤
 * │ enregistrer une licence  │ /api/admin/licenses/create       │ POST   │ x-gf-key │ { token }                    │
 * │ (garage ET mécanicien)   │                                  │        │          │ → 201, 409 = déjà enregistré │
 * │ lire l'état serveur      │ /api/keygen/licenses             │ GET    │ x-gf-key │ —                            │
 * │ test de connexion        │ /api/keygen/licenses             │ GET    │ x-gf-key │ — (lecture, aucune écriture) │
 * │ changer le statut        │ /api/keygen/licenses/{lid}/status│ POST   │ x-gf-key │ { status, reason? }          │
 * │ réinitialiser le matériel│ /api/keygen/licenses/{lid}/hwid  │ POST   │ x-gf-key │ { action: reset|revoke }     │
 * └──────────────────────────┴──────────────────────────────────┴────────┴──────────┴──────────────────────────────┘
 *
 * `/api/admin/licenses/revoke-by-key` a été RETIRÉE définitivement (clé partagée
 * ≠ authentification admin forte). Le Keygen ne l'appelle PLUS : révoquer passait
 * par elle et ne faisait plus rien, le statut local divergent du statut réel en
 * silence. Les routes `/api/keygen/*`, authentifiées par le même en-tête, la
 * remplacent avec la machine à états et le `recordMac` de la route de session.
 *
 * `seats`, `hwid`, `plid` (parent mécanicien), `exp` et `typ` ne circulent PAS
 * comme champs de requête : ils sont lus du jeton SIGNÉ côté serveur, ce qui
 * rend impossible l'enregistrement d'une licence forgée. Aucun endpoint
 * d'activation/heartbeat n'est appelé par le Keygen — ils appartiennent au
 * poste, pas au générateur de clés.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')
const KEYGEN_UI = path.join(ROOT, 'scripts', 'keygen_ui.py')
const KEYGEN_SERVER = path.join(ROOT, 'scripts', 'keygen_server.py')

/** Source Python du contrat HTTP : le module centralisÉ + l'IHM qui l'utilise. */
let python = ''
/** Source de l'IHM seule : certains contrats portent sur l'interface, pas sur le client HTTP. */
let ihm = ''
beforeAll(() => {
  ihm = readFileSync(KEYGEN_UI, 'utf8')
  python = readFileSync(KEYGEN_SERVER, 'utf8') + '\n' + ihm
})

/**
 * Corps d'une fonction Python du module client, de sa signature à la suivante.
 * Permet d'exiger une propriété SUR LA BONNE fonction plutôt que sur le fichier
 * entier — un `return True` ailleurs ne doit pas valider `set_status`.
 */
function extraireFonctionPython(nom: string): string {
  const debut = python.indexOf(`def ${nom}(`)
  if (debut < 0) throw new Error(`fonction Python introuvable : ${nom}`)
  const suite = python.indexOf('\ndef ', debut + 1)
  return python.slice(debut, suite < 0 ? undefined : suite)
}

/** Chemin du fichier de route Next.js pour un endpoint `/api/...`. */
function routeFileFor(endpoint: string): string {
  return path.join(ROOT, 'src', 'app', ...endpoint.split('/').filter(Boolean), 'route.ts')
}

function routeSource(endpoint: string): string {
  const file = routeFileFor(endpoint)
  expect(existsSync(file), `route absente pour ${endpoint} (${file})`).toBe(true)
  return readFileSync(file, 'utf8')
}

/**
 * Tous les endpoints /api/... littéraux présents dans le source Python.
 *
 * Une route paramétrée (`/api/keygen/licenses/{lid}/status`) n'est pas un
 * littéral complet : on la normalise en remplaçant le segment substitué par le
 * joker Next.js `[lid]`, pour la comparer à un chemin de route réel.
 */
function endpointsUsedByKeygen(): string[] {
  const found = new Set<string>()
  const add = (raw: string) => {
    const normalized = raw
      .split('/')
      .map((s) => (/^\{.+\}$/.test(s) ? '[lid]' : s))
      .join('/')
    found.add(normalized)
  }
  Array.from(python.matchAll(/["'](\/api\/[A-Za-z0-9/{}_-]+)["']/g)).forEach(m => add(m[1]))
  return Array.from(found).sort()
}

describe('Endpoints appelés par le Keygen', () => {
  it('n’appelle que des routes qui existent réellement', () => {
    const endpoints = endpointsUsedByKeygen()
    // Garde-fou : si l'extraction ne trouve plus rien, le test ne vérifie plus
    // rien — on échoue plutôt que de devenir silencieusement inutile.
    expect(endpoints.length).toBeGreaterThan(0)
    for (const endpoint of endpoints) {
      expect(existsSync(routeFileFor(endpoint)), `endpoint obsolète : ${endpoint}`).toBe(true)
    }
  })

  it('correspond exactement à la matrice documentée', () => {
    expect(endpointsUsedByKeygen()).toEqual([
      '/api/admin/licenses/create',
      '/api/keygen/licenses',
      '/api/keygen/licenses/[lid]/hwid',
      '/api/keygen/licenses/[lid]/status',
    ])
  })

  it('n’appelle plus la route retirée revoke-by-key', () => {
    // Elle répond 404 définitivement : l'appeler ferait croire à une révocation
    // appliquée alors que le serveur n'a rien changé.
    expect(endpointsUsedByKeygen()).not.toContain('/api/admin/licenses/revoke-by-key')
  })

  it('chaque route ciblée est authentifiée par x-gf-key', () => {
    for (const endpoint of endpointsUsedByKeygen()) {
      const src = routeSource(endpoint)
      const verbe = endpoint === '/api/keygen/licenses' ? 'GET' : 'POST'
      expect(src, `${endpoint} doit exposer ${verbe}`).toMatch(
        new RegExp(`export (async )?function ${verbe}`),
      )
      expect(src, `${endpoint} doit authentifier par x-gf-key`).toContain('x-gf-key')
      expect(src, `${endpoint} doit limiter le débit`).toContain('enforceRateLimit')
    }
  })

  it('le Keygen envoie bien l’en-tête d’authentification attendu', () => {
    expect(python).toContain('"x-gf-key"')
  })
})

describe('POST /api/admin/licenses/create', () => {
  it('reçoit le champ `token` que le Keygen envoie', () => {
    // Le corps est construit dans keygen_server.py (module centralisé) : un seul
    // point d'émission, donc un seul endroit à vérifier.
    expect(python).toMatch(/"token":\s*token/)
    expect(routeSource('/api/admin/licenses/create')).toMatch(/body\.token/)
  })

  it('vérifie le jeton cryptographiquement (licence forgée impossible)', () => {
    expect(routeSource('/api/admin/licenses/create')).toContain('verifyLicenseToken')
  })

  it('409 = déjà enregistrée, traité comme un succès par le Keygen', () => {
    expect(routeSource('/api/admin/licenses/create')).toMatch(/alreadyRegistered/)
    // Le code HTTP est lu sur la réponse (`code`), plus sur `e.code` : la
    // plomberie réseau est centralisée depuis la refonte.
    expect(python).toMatch(/code == 409[\s\S]{0,160}return True/)
  })
})

describe('POST /api/keygen/licenses/[lid]/status', () => {
  it('applique la machine à états et recalcule le recordMac', () => {
    const src = routeSource('/api/keygen/licenses/[lid]/status')
    expect(src).toContain('canTransitionLicense')
    expect(src).toContain('computeRecordMac')
    expect(src).toContain('prisma.$transaction')
  })

  it('traduit un 409 en refus explicite côté Keygen (jamais un faux succès)', () => {
    // Le classement par code HTTP est CENTRALISÉ dans `_http_message` : la
    // branche 409 n'est plus recopiée chez chaque appelant, mais l'exigence
    // reste la même — un 409 est un refus, et le motif du serveur (machine à
    // états) est préféré au message générique.
    expect(python).toMatch(/code == 409[\s\S]{0,200}Conflit \(409\)/)
    expect(python).toMatch(/if code == 409:\s*\n\s*return serveur or/)
    // Et aucun chemin de `set_status` ne renvoie un succès hors d'un 200.
    const corpsSetStatus = extraireFonctionPython('set_status')
    expect(corpsSetStatus).toMatch(/if resp\.code == 200:/)
    const lignesSucces = corpsSetStatus.split('\n').filter((l) => l.includes('return True'))
    expect(lignesSucces.length).toBeGreaterThan(0)
    for (const ligne of lignesSucces) expect(ligne).not.toMatch(/40\d|50\d/)
  })

  it('un 404 porteur d’un corps JSON applicatif désigne la LICENCE, pas la route', () => {
    // RÉGRESSION DU 2026-10-21. `_request` calculait un message pour TOUTE
    // réponse d'erreur, et chaque appelant faisait `if err: return False, err`
    // AVANT ses propres branches : un 404 « licence introuvable » s'affichait
    // « Route absente sur ce serveur » — un défaut de routage imaginaire, sur
    // une route qui venait de répondre correctement. L'erreur de TRANSPORT et
    // le classement par CODE doivent rester séparés.
    expect(python).toMatch(/erreur_transport/)
    expect(python).not.toMatch(/if err:\s*\n\s*return False, err/)
    // La route répond en JSON avec un code applicatif : son message est repris
    // tel quel, et « Route absente » reste réservé à l'absence de corps JSON
    // (page d'erreur HTML d'une instance qui ignore réellement la route).
    expect(routeSource('/api/keygen/licenses/[lid]/status')).toMatch(/code: 'NOT_FOUND'/)
    expect(python).toMatch(/Route absente sur ce serveur \(404\)/)
    const corpsMessage = extraireFonctionPython('_http_message')
    const indexRoute = corpsMessage.indexOf('Route absente')
    const indexServeur = corpsMessage.indexOf('if serveur:')
    expect(indexServeur).toBeGreaterThanOrEqual(0)
    expect(indexServeur).toBeLessThan(indexRoute)
  })
})

describe('Enregistrement serveur après génération', () => {
  it('une licence garage générée est enregistrée sur le serveur, pas seulement en local', () => {
    // Sans cet appel, le serveur ignore la licence : son activation et son
    // changement de statut répondent 404, et aucun geste du Keygen n'y
    // remédiait — seul le récapitulatif des clés MÉCANICIEN offrait un bouton
    // d'enregistrement, jamais le parcours d'une licence GARAGE.
    expect(ihm).toMatch(/server\.register_license\(srv_url, srv_key, info\["token"\]\)/)
    expect(ihm).toMatch(/def _register_on_server/)
    expect(ihm).toMatch(/db\.mark_server_synced/)
  })

  it('l’absence de serveur configuré est dite, pas masquée', () => {
    expect(ihm).toMatch(/Serveur non configuré[\s\S]{0,160}activables/)
  })
})

describe('POST /api/keygen/licenses/[lid]/hwid', () => {
  it('constate la liaison signée au lieu de la contourner', () => {
    const src = routeSource('/api/keygen/licenses/[lid]/hwid')
    expect(src).toContain('verifyLicenseToken')
    expect(src).toContain('tokenBound')
  })
})

describe('URL du serveur', () => {
  it('est centralisée et préremplie, jamais recopiée dans l’IHM', () => {
    const server = readFileSync(KEYGEN_SERVER, 'utf8')
    expect(server).toContain('GARAGEFLOW_API_KEY'.replace('GARAGEFLOW_API_KEY', 'x-gf-key'))
    // Une seule définition de l'adresse par défaut, dans keygen_db.
    const db = readFileSync(path.join(ROOT, 'scripts', 'keygen_db.py'), 'utf8')
    expect(db).toContain('DEFAULT_SERVER_URL = "https://app.garageflows.fr"')
    expect(readFileSync(KEYGEN_UI, 'utf8')).not.toMatch(/https:\/\/app\.garageflows\.fr/)
  })
})

describe('Périmètre du Keygen', () => {
  it('n’appelle aucun endpoint d’exécution du poste (activate/check/heartbeat)', () => {
    // Ces routes appartiennent au poste licencié, pas au générateur de clés :
    // les appeler depuis le Keygen signalerait une confusion de rôles.
    for (const forbidden of ['/api/license/activate', '/api/license/check', '/api/license/status']) {
      expect(endpointsUsedByKeygen()).not.toContain(forbidden)
    }
  })
})
