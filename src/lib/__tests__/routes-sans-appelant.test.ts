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
 *  `chemin-calcule`— ATTEINTE, mais par une URL assemblée à l'exécution que la
 *      recherche textuelle ne peut pas voir. C'est l'angle mort assumé de cette
 *      garde : la note doit alors DÉSIGNER la construction, faute de quoi
 *      l'étiquette servirait à faire taire un vrai constat.
 */
type Motif = 'sans-interface' | 'double' | 'exploitation' | 'cadre' | 'chemin-calcule'

/**
 * Classement PRODUIT d'une route `sans-interface` (§33).
 *
 * Le motif dit POURQUOI elle n'a pas d'appelant ; la classe dit CE QU'ON EN
 * FAIT. Sans elle, l'inventaire décrit un état sans jamais engager de décision,
 * et vingt routes mortes s'y installent confortablement.
 *
 *  `PRODUCT_REQUIRED` — fonction du produit : il lui faut une interface. Chaque
 *      entrée est une dette explicite, pas un constat.
 *  `INTERNAL_ONLY`    — destinée à un outil, un opérateur ou une tâche
 *      planifiée. Exige un DÉCLENCHEUR RÉEL nommé : « son code appelle une
 *      fonction interne » ne prouve que `route → service`, jamais qu'un
 *      appelant existe.
 *  `DEPRECATED`       — remplacée par une autre, encore identifiable ; à retirer
 *      une fois le dernier consommateur éteint.
 *  `ORPHANED`         — aucun appelant réel, et aucune justification produit
 *      actuelle. C'est la conclusion d'une recherche, pas un aveu d'ignorance.
 */
type Classe = 'PRODUCT_REQUIRED' | 'INTERNAL_ONLY' | 'DEPRECATED' | 'ORPHANED'

const INVENTAIRE: Record<string, { motif: Motif; note: string; classe?: Classe }> = {
  '/api/auth/[...nextauth]': { motif: 'cadre', note: 'point d’entrée NextAuth, atteint par signIn()' },

  '/api/ping': { motif: 'exploitation', note: 'sonde de disponibilité ; Electron interroge le serveur de licences, pas celle-ci' },
  '/api/admin/backups': { motif: 'exploitation', note: 'liste et déclenche les sauvegardes ; pilotée par script d’exploitation' },
  '/api/admin/backups/[id]/download': { motif: 'exploitation', note: 'récupération d’une archive par l’exploitant, hors interface' },
  '/api/admin/backups/[id]/restore': { motif: 'exploitation', note: 'restauration : geste délibérément sans bouton, jamais à un clic' },
  '/api/admin/backups/[id]/verify': { motif: 'exploitation', note: 'contrôle d’intégrité d’une archive, lancé à la main' },

  // ── Porte de vérification d'une rotation de secrets ───────────────────────
  // DÉCLENCHEUR RÉEL : `Assert-DeployedConvergence` dans
  // scripts/reset-garageflow.ps1, appelée juste après le contrôle /api/health et
  // AVANT toute promotion. Aucun écran ne l'appelle, et c'est voulu : elle
  // répond à une question que seule la fonction déployée peut trancher — « la
  // valeur que je reçois est-elle exactement celle qui a été envoyée ? ».
  // Ni `vercel env pull` (qui rend « [SENSITIVE] ») ni `vercel env run` (qui
  // charge les .env locaux) ne peuvent y répondre. Le 2026-08-16, faute de cette
  // route, treize variables Production ont porté un U+FEFF invisible pendant
  // vingt minutes sans que rien ne le signale.
  '/api/admin/diagnostics': {
    motif: 'exploitation',
    note: 'appelée par Assert-DeployedConvergence (scripts/reset-garageflow.ps1) après déploiement, et par l’exploitant lors d’un diagnostic ; ne renvoie que des empreintes, jamais une valeur',
  },

  // ── Angle mort de la recherche : URL assemblée à l'exécution ──────────────
  '/api/invoices/[id]': {
    motif: 'chemin-calcule',
    note: 'QuoteInvoiceModal : `apiBase = mode === \'quote\' ? \'/api/quotes\' : \'/api/invoices\'`, puis `${apiBase}/${id}`',
  },

  // ── Contrat avec l'outil de génération de clés (x-gf-key) ─────────────────
  // Documenté par `license/__tests__/keygen-api-contract.test.ts` : ces routes
  // servent `scripts/keygen_gui.py`, pas l'interface web.
  '/api/admin/licenses/create': { motif: 'exploitation', note: 'enregistrement d’une licence par l’outil keygen (en-tête x-gf-key)' },
  '/api/admin/licenses/revoke-by-key': { motif: 'exploitation', note: 'révocation par l’outil keygen, par clé et non par identifiant' },

  '/api/vin': { motif: 'double', note: 'vinEngine atteint via /api/copilot, /api/ocr et /api/catalog' },
  '/api/diagnostic': { motif: 'double', note: 'diagnose() atteint via /api/copilot' },
  '/api/stock-forecast': { motif: 'double', note: 'planReorders() atteint via /api/dashboard et /api/proactive' },
  '/api/forgotten-parts': { motif: 'double', note: 'moteur atteint via /api/quotes/generate' },
  '/api/signatures': { motif: 'double', note: 'signature atteinte via /api/portal/quote/[token]' },

  // ── Ce qui n'existe pas pour l'utilisateur ────────────────────────────────
  // Le portail client, en particulier : messagerie, prise de rendez-vous,
  // double facteur et gestion des appareils sont écrits, testés, et absents des
  // cinq pages du portail.
  // `/api/portal/token` a été SUPPRIMÉE le 14/08/2026 (GF-DUR-033).
  //
  // Elle signait `{ jobId, typ }` SANS `garageId`, et `/api/portal/[token]`
  // résout un tel jeton par `{ id: jobId }` seul — son chemin hérité, non
  // cloisonné par garage. Elle était le SEUL producteur de jetons empruntant ce
  // chemin. `/api/portal/generate`, qu'appelle réellement `JobQRCode`, signe
  // `{ typ, jobId, garageId }` et publie en plus l'instantané au cloud pour un
  // poste installé — ce que les jetons hérités ne savaient pas faire (la branche
  // instantané exige `payload.garageId`, donc ils échouaient déjà).
  //
  // La suppression ne repose donc PAS sur « aucun fetch trouvé » : elle a une
  // remplaçante nommée, et elle retirait la seule source de jetons plus faibles.
  // Un garde de `garage-slug.test.ts` empêche qu'un émetteur équivalent
  // réapparaisse. La branche de résolution héritée, elle, est conservée : des
  // QR codes imprimés par une version antérieure peuvent encore circuler.
  // Les trois routes de double authentification ont été RETIRÉES d'ici le
  // 14/08/2026 : `PortalTwoFactor` les appelle, et « Mon espace » le monte
  // (GF-DUR-026). C'était le cas le plus coûteux de l'inventaire — second
  // facteur complet, chiffré, testé, avec son étape de connexion déjà écrite,
  // et aucun moyen pour un client de l'activer.

  // ── Cinq moteurs que SEULE leur propre route atteint ──────────────────────
  // Vérifié le 14/08/2026 en cherchant chaque symbole hors tests : `recommendPrice`,
  // `optimizeSchedule`, `analyzeMemory`, `buildLeaderboard` et `buildAlerts`
  // n'apparaissent que dans leur module (`index`/`engine`) et dans la route.
  // C'est `route → service`, ce qui ne prouve aucun appelant.
  //
  // ─── CINQ ROUTES SUPPRIMÉES LE 14/08/2026 (GF-DUR-043) ────────────────────
  // `/api/pricing`, `/api/scheduling`, `/api/memory`, `/api/gamification` et
  // `/api/proactive` ont été retirées. Les MOTEURS restent : `src/lib/pricing/`,
  // `scheduling/`, `memory/`, `gamification/`, `proactive/` — code déterministe,
  // testé, réexposable par un seul fichier de route le jour où un écran en a
  // besoin.
  //
  // La décision ne repose PAS sur « aucun fetch trouvé aujourd'hui », motif que
  // la consigne §30 interdit d'invoquer. L'historique COMPLET a été interrogé :
  //
  //     git log --all -S"/api/<nom>" -- src/components src/app \
  //             ':(exclude)src/app/api'
  //
  // Résultat pour les cinq : 0 commit. Aucune interface ne les a appelées à
  // aucun moment de la vie du dépôt. Ce n'est pas « on ne trouve pas
  // d'appelant », c'est « il n'y en a jamais eu » : chacune est née comme
  // route + documentation + tests, sans jamais être branchée. Une route
  // authentifiée sans consommateur n'est que de la surface exposée.
  //
  // Suppression décidée par l'exploitant — elle engage le périmètre annoncé du
  // produit, ce qui ne relevait pas d'un audit. Les cinq pages de documentation
  // (docs/PRICING.md, SCHEDULING.md, MEMORY.md, GAMIFICATION.md, PROACTIVE.md)
  // disent désormais que le moteur existe et n'est pas exposé en HTTP.

  // ── Quatre RECLASSÉES le 14/08/2026 : elles n'étaient pas orphelines ──────
  // Erreur de la passe précédente. Le classement avait été fait sur « aucun
  // écran n'appelle CETTE route », alors que le critère utile est « la fonction
  // est-elle atteignable ». Les quatre le sont, par une autre route qui a, elle,
  // un écran. Ce sont donc des seconds points d'entrée — pas des fonctions
  // absentes du produit, et pas une dette produit.
  '/api/forecast': {
    motif: 'double',
    note: 'forecast() est appelé par /api/copilot (page /copilot) et par lib/stock-forecast/plan.ts, lui-même atteint via /api/dashboard',
  },
  '/api/profitability': {
    motif: 'double',
    note: 'analyze() est appelé par /api/dashboard (DecisionSection) et par /api/copilot',
  },
  '/api/suggestions': {
    motif: 'double',
    note: 'runAIEngine() est appelé par store/schedule-store.ts, donc par l’écran de planning',
  },
  '/api/analytics/health': {
    motif: 'double',
    note: 'computeHealthScore() est appelé par lib/analytics/insights.ts → rapport du copilote, affiché par /copilot',
  },

  // Reclassée après vérification : le panneau Stock calcule déjà le même
  // prédicat (`quantity <= minQuantity`) côté client depuis `/api/parts`, et
  // affiche un onglet « stock bas ». La fonction EST atteignable ; cette route
  // en est un second point d'entrée. Bâtir un écran de plus aurait été un
  // doublon, pas une correction.
  '/api/parts/low-stock': { motif: 'double', note: 'le panneau Stock calcule le même seuil depuis /api/parts' },

  // L'auto-désactivation exige le `deviceToken`, que seul l'appareil détient :
  // aucun navigateur ne peut l'appeler. Le poste se libère depuis son propre
  // logiciel, ou par l'éditeur via la zone d'administration — désormais câblée.
  '/api/license/deactivate': { motif: 'exploitation', note: 'auto-désactivation par le poste lui-même, avec un jeton qu’aucun navigateur ne détient' },
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
 * Retire les COMMENTAIRES avant la recherche.
 *
 * Sans cela, une route citée en prose comptait comme appelée. Le cas s'est
 * produit dès le premier usage : le panneau de licence explique dans son
 * en-tête pourquoi il n'appelle PAS `/api/license/deactivate` — et cette phrase
 * suffisait à la déclarer branchée. Une garde qu'un commentaire désarme ne garde
 * rien.
 *
 * Le retrait vise les blocs `/* … *\/` et les lignes entièrement commentées,
 * là où vit la prose. Un `//` en fin de ligne de code est laissé : y mentionner
 * une route est assez rare pour ne pas justifier un analyseur syntaxique, et le
 * risque restant est un faux NÉGATIF sur l'inventaire — jamais un faux positif
 * qui masquerait une route morte.
 */
/**
 * ─── L'ORDRE COMPTE (GF-DUR-046) ────────────────────────────────────────────
 * Les lignes commentées sont retirées AVANT les blocs, et non l'inverse.
 *
 * Mesuré le 14/08/2026 : un commentaire de ligne contenant `admin/licenses/*`
 * ouvre un faux bloc pour la regex, qui le referme au prochain `*` + `/` — et
 * avale tout le code intermédiaire. Sur `generate/route.ts`, 3 102 caractères
 * disparaissaient, dont l'appel à `enforceRateLimit` : un outil d'analyse
 * concluait « pas de limitation de débit » sur une route qui en portait une.
 *
 * Cinq fichiers du dépôt déclenchent ce cas. Vérifié : aucun chemin `/api/…`
 * n'était perdu ici, donc l'inventaire n'a jamais été faussé — mais il ne
 * tenait qu'à l'endroit où l'on écrit ses commentaires.
 *
 * Retirer les lignes `//` d'abord règle le cas : le faux `/*` part avec elles.
 * Un `/*` à l'intérieur d'une CHAÎNE de code reste un angle mort assumé ; il
 * faudrait un analyseur syntaxique, et le risque résiduel est un faux NÉGATIF.
 */
function sansCommentaires(src: string): string {
  return src
    // 1. Lignes ENTIÈREMENT en commentaire `//`. D'abord, pour qu'un début de
    //    bloc écrit à l'intérieur (un chemin à joker, par exemple) ne puisse
    //    pas ouvrir un faux bloc à l'étape suivante.
    .replace(/^[ \t]*\/\/.*$/gm, '')
    // 2. Blocs, retirés d'un seul tenant — leurs lignes internes préfixées de
    //    `*` partent avec, y compris le marqueur de fermeture.
    //
    //    Ne PAS filtrer les lignes commençant par `*` avant cette étape : cela
    //    supprimerait la fermeture des blocs, qui courraient alors jusqu'à la
    //    suivante en avalant le code intermédiaire. Essayé, mesuré : 26 routes
    //    bien vivantes — dont `/api/jobs/pulse` et le chrono du mécanicien —
    //    se retrouvaient déclarées orphelines.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * Fichiers susceptibles d'APPELER une route, avec leur chemin.
 *
 * Deux familles en sont exclues, et pour deux raisons distinctes.
 *
 *  · Les TESTS. Première version : ils étaient inclus, alors que le commentaire
 *    d'à côté affirmait le contraire. Conséquence exacte de l'écart :
 *    `/api/appointments` et `/api/appointments/[id]` — toute la confirmation de
 *    rendez-vous côté garage — passaient pour branchées parce que deux tests
 *    d'isolation les importaient. Une route que seul un test touche est morte
 *    pour l'utilisateur ; c'est précisément ce que cette garde doit montrer.
 *
 *  · Ce fichier : il cite toutes les routes, et se rendrait aveugle lui-même.
 *
 * ─── Les routes, elles, RESTENT dans le corpus ──────────────────────────────
 * Première version : tout `src/app/api/` en était exclu, au motif qu'« une
 * route qui s'appelle, ou qu'une route voisine appelle, n'en fait pas une
 * fonctionnalité atteignable ». C'était faux pour un cas bien réel : l'appel
 * POSTE → CLOUD. `/api/portal/generate`, exécutée sur le poste, publie
 * l'instantané au cloud par `cloudPost('/api/sync/portal', …)` — une requête
 * HTTP entre DEUX déploiements, pas un appel interne.
 *
 * `/api/sync/portal` figurait donc parmi les routes mortes, classée DEPRECATED.
 * La supprimer aurait cassé toute publication de portail depuis un poste
 * installé. C'est exactement le faux positif contre lequel il faut se garder :
 * l'absence de résultat n'est pas une preuve d'absence d'appelant.
 *
 * Le fichier de la route elle-même reste écarté, lui : une route qui cite son
 * propre chemin — dans une trace, un message — ne s'appelle pas.
 */
function fichiersAppelants(): string[] {
  return [
    ...fichiers(path.join(RACINE, 'src')),
    ...fichiers(path.join(RACINE, 'electron')),
  ]
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
    .filter((f) => !f.includes(`${path.sep}generated${path.sep}`))
    .filter((f) => !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f))
    .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => !f.includes(`${path.sep}integration${path.sep}`))
    .filter((f) => !f.includes(`${path.sep}test-utils${path.sep}`))
}

function orphelines(): string[] {
  // Lus une seule fois : le corpus varie d'une route à l'autre — on en retire
  // toujours le fichier de la route examinée — mais son contenu, non.
  const sources = fichiersAppelants()
    .filter((f) => !f.endsWith('routes-sans-appelant.test.ts'))
    .map((f) => ({ f, texte: sansCommentaires(fs.readFileSync(f, 'utf8')) }))

  const trouvees: string[] = []
  for (const fichierRoute of fichiers(API).filter((x) => /route\.ts$/.test(x))) {
    const chemin = '/api/' + fichierRoute.slice(API.length + 1).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
    // Un segment dynamique devient un joker : `/api/clients/[id]/portal-access`
    // s'écrit `/api/clients/${id}/portal-access` chez l'appelant.
    const motif = chemin
      .split('/')
      .map((s) => (s.startsWith('[') ? '[^/`\'"]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    const rx = new RegExp(motif)
    // Le fichier de la route est retiré du corpus : y citer son propre chemin —
    // dans une trace, un message d'erreur — ne fait pas d'elle une route
    // appelée.
    const appelee = sources.some(({ f, texte }) => f !== fichierRoute && rx.test(texte))
    if (!appelee) trouvees.push(chemin)
  }
  return trouvees.sort()
}

/**
 * ─── Portée de cet inventaire : il raisonne par ROUTE, pas par VERBE ────────
 *
 * Limite constatée, et non théorique. `/api/copilot/reports` exporte `GET`
 * (lister l''historique) et `POST` (historiser). La page du copilote n''appelait
 * que le `POST`. La route avait donc « un appelant », paraissait branchée, et
 * son `GET` restait mort — si bien que le bouton « Historiser » écrivait dans un
 * tiroir sans poignée : l''exploitant accumulait des instantanés qu''il ne
 * pourrait jamais relire (GF-DUR-032, corrigé).
 *
 * ─── Pourquoi il n''y a PAS de garde automatique sur les verbes ─────────────
 * Une version par verbe a été écrite, exécutée, et RETIRÉE : elle accusait à
 * tort. Deux motifs, tous deux courants ici, la mettent en échec :
 *
 *   · le verbe en variable — `ClientsPanel` fait `method: methode`, où `methode`
 *     vaut POST, PUT ou DELETE selon l''action ; la lecture statique concluait
 *     que trois verbes vivants de `/api/clients/[id]/portal-access` étaient
 *     morts ;
 *   · l''URL en variable — `QuoteInvoiceModal` fait
 *     `const apiBase = mode === ''quote'' ? ''/api/quotes'' : ''/api/invoices''`, puis
 *     appelle `${apiBase}/${id}`. Le chemin complet n''apparaît nulle part : ni
 *     le verbe ni la route ne sont lisibles au même endroit.
 *
 * Rendre le garde prudent au point de se taire dans ces cas revenait à ne plus
 * rien couvrir d''utile. On préfère une limite ÉCRITE à un garde qui ferait
 * supprimer du code vivant — c''est déjà arrivé trois fois dans ce fichier, et
 * chaque fois le garde avait l''air juste.
 *
 * Conséquence pratique pour qui relit : une route à plusieurs verbes peut être
 * à moitié morte sans que rien ici ne le signale. La vérification reste
 * manuelle, et le cas du copilote montre par où commencer — une écriture sans
 * lecture correspondante.
 */
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

  it('toute route sans interface porte une DÉCISION produit (§33)', () => {
    // Le motif décrit un état ; la classe engage. Sans elle, l'inventaire
    // documenterait confortablement vingt routes mortes sans que personne
    // n'ait jamais à trancher.
    const sansClasse = Object.entries(INVENTAIRE)
      .filter(([, e]) => e.motif === 'sans-interface' && !e.classe)
      .map(([r]) => r)
    expect(sansClasse, 'Classez ces routes : PRODUCT_REQUIRED, INTERNAL_ONLY ou DEPRECATED.').toEqual([])
  })

  it('toute route ORPHANED porte une DÉCISION écrite, pas un simple constat', () => {
    // §21 : LOT 5 ne se ferme que si chaque orpheline a une décision finale.
    // Sans cette exigence, `ORPHANED` deviendrait le tiroir où l'on range ce
    // qu'on n'a pas voulu trancher — une dette cachée derrière une étiquette.
    const sansDecision = Object.entries(INVENTAIRE)
      .filter(([, e]) => e.classe === 'ORPHANED' && !e.note.includes('DÉCISION :'))
      .map(([r]) => r)
    expect(
      sansDecision,
      'Écrivez la décision dans la note, préfixée « DÉCISION : » (conservée / à supprimer, et pourquoi).',
    ).toEqual([])
  })

  it('plus aucune route DEPRECATED ne traîne dans l\'inventaire', () => {
    // `DEPRECATED` désigne une route remplacée dont le dernier consommateur doit
    // s'éteindre. Ce n'est pas un état stable : une entrée qui y reste est une
    // suppression qu'on repousse. La seule qu'il y ait eu — `/api/portal/token` —
    // a été supprimée le 14/08/2026 (GF-DUR-033).
    const restantes = Object.entries(INVENTAIRE)
      .filter(([, e]) => e.classe === 'DEPRECATED')
      .map(([r]) => r)
    expect(restantes, 'Terminez la dépréciation : supprimez la route ou justifiez son maintien.').toEqual([])
  })

  it('la classe ne s\'applique qu\'aux routes sans interface', () => {
    // Une route « double » ou « exploitation » n'a pas de dette produit : lui
    // coller une classe brouillerait la lecture du reste à faire.
    const malPlacees = Object.entries(INVENTAIRE)
      .filter(([, e]) => e.motif !== 'sans-interface' && e.classe)
      .map(([r]) => r)
    expect(malPlacees).toEqual([])
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
      '/api/license/devices',
      '/api/admin/licenses/[id]/devices',
      '/api/admin/licenses/[id]/devices/[deviceId]',
      '/api/portal/auth/devices',
      '/api/portal/tickets',
      '/api/portal/tickets/[id]',
      '/api/portal/tickets/[id]/close',
      '/api/tickets',
      '/api/tickets/[id]',
      '/api/portal/appointments',
      '/api/portal/appointments/[id]',
      '/api/appointments',
      '/api/appointments/[id]',
      '/api/users',
      '/api/quotes/[id]/signature-token',
    ]) {
      expect(constatees, `${r} est redevenue inatteignable`).not.toContain(r)
    }
  })
})
