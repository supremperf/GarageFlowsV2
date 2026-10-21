'use strict'
/**
 * POLITIQUE DE DESTINATION — où chaque variable a le droit d'aller.
 *
 * C'est la pièce qui empêche le configurateur de faire des dégâts. Sans elle,
 * « synchroniser les variables » voudrait dire pousser tout le contenu local
 * vers les trois environnements Vercel : la clé privée de licence partirait
 * dans le binaire client, les secrets serveur dans un bundle public, et les
 * identifiants de production dans un déploiement de prévisualisation.
 *
 * Chaque variable reçoit donc :
 *   · un ensemble de FICHIERS locaux autorisés ;
 *   · un ensemble de CIBLES Vercel autorisées ;
 *   · un indicateur `valeurPartagee` : la même valeur peut-elle exister dans
 *     plusieurs environnements, ou chaque environnement doit-il avoir la sienne ?
 *
 * La dernière colonne est la plus importante en pratique. Recopier le
 * `DATABASE_URL` de production vers Preview ferait écrire les déploiements de
 * branche dans les données réelles des clients — exactement le risque que
 * `GF_PRODUCTION_DB_FINGERPRINT` sert à détecter dans `src/lib/env.ts`.
 */

const CIBLES_VERCEL = ['development', 'preview', 'production']

const FICHIERS = Object.freeze({
  desktop: '.env',
  serveur: '.env.server.local',
  development: '.env.development.local',
  preview: '.env.preview.local',
})

/**
 * Variables dont la valeur est PROPRE à chaque environnement : jamais recopiée
 * d'une cible vers une autre, même si elle est lisible.
 */
const PROPRE_A_L_ENVIRONNEMENT = new Set([
  // Base de données : une copie vers Preview ferait écrire dans la production.
  'DATABASE_URL', 'DIRECT_URL',
  // URL publique : en Preview, l'URL est dynamique (VERCEL_URL) ; une valeur
  // fixe casserait les redirections de connexion NextAuth.
  'NEXTAUTH_URL', 'GF_APP_URL',
  // Secrets de session et clés liées aux données de LA base de cet environnement.
  'NEXTAUTH_SECRET', 'DEVICE_TOKEN_PEPPER', 'GARAGEFLOW_API_KEY',
  'GF_DB_MAC_SECRET', 'GF_PORTAL_SECRET', 'GF_SIGNATURE_SECRET',
  'GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_TOTP_ENC_KEY',
  'GF_EINVOICE_CREDENTIALS_KEY', 'EINVOICING_QUEUE_TOKEN', 'CRON_SECRET',
  // Jeton de stockage : rattaché à un store et à une cible précise.
  'BLOB_READ_WRITE_TOKEN',
])

/**
 * Variables dont la valeur DOIT être identique partout.
 * `GF_PRODUCTION_DB_FINGERPRINT` est une empreinte d'hôte, pas un secret : la
 * garde d'isolation Preview ne fonctionne que si tous les environnements
 * connaissent la même valeur (voir `verifierIsolationPreview`).
 */
const VALEUR_PARTAGEE = new Set(['GF_PRODUCTION_DB_FINGERPRINT'])

/** Jamais dans un binaire client ni dans un projet PWA, quelle que soit la cible. */
const INTERDITES_COTE_CLIENT = new Set([
  'GF_PRIVATE_KEY', 'GF_UPDATE_SIGNING_KEY', 'GF_UPDATE_SIGNING_KEY_FILE',
  'GF_EINVOICE_CREDENTIALS_KEY',
])

/** Variables réservées au poste de signature des licences (keygen Python). */
const RESERVEES_KEYGEN = new Set(['GF_PRIVATE_KEY', 'GF_KEYGEN_MAX_MECHANIC'])

/**
 * Cibles Vercel par variable requise.
 *
 * `production` : l'application réelle.
 * `preview` : les déploiements de branche servent du vrai code, donc ils ont
 *   besoin des mêmes variables — avec leurs PROPRES ressources.
 * `development` : alimente `vercel env pull` sur le poste. On n'y ajoute rien
 *   d'office ; on complète seulement ce qui y est déjà amorcé, pour ne pas
 *   transformer un environnement de confort en quatrième configuration à tenir.
 */
const CIBLES_REQUISES = Object.freeze({
  DATABASE_URL: ['production', 'preview'],
  DIRECT_URL: ['production', 'preview'],
  NEXTAUTH_SECRET: ['production', 'preview'],
  NEXTAUTH_URL: ['production'],
  DEVICE_TOKEN_PEPPER: ['production', 'preview'],
  GARAGEFLOW_API_KEY: ['production', 'preview'],
  GF_DB_MAC_SECRET: ['production', 'preview'],
  UPSTASH_REDIS_REST_URL: ['production', 'preview'],
  UPSTASH_REDIS_REST_TOKEN: ['production', 'preview'],
  GF_PRODUCTION_DB_FINGERPRINT: ['production', 'preview', 'development'],
})

/**
 * Décide la destination d'une variable.
 *
 * @param {object} variable entrée fusionnée du manifeste (avec `action`, `scope`…)
 * @returns {{ fichiers: string[], cibles: string[], valeurPartagee: boolean,
 *             requise: boolean, categorieDestination: string, raison: string }}
 */
function destination(variable) {
  const nom = variable.name
  const action = variable.action
  const scope = variable.scope

  const base = {
    fichiers: [],
    cibles: [],
    valeurPartagee: VALEUR_PARTAGEE.has(nom),
    requise: !!variable.requiredProduction,
    categorieDestination: 'aucune',
    raison: '',
  }

  // 1. Noms publics : un secret préfixé NEXT_PUBLIC_ part dans le bundle
  //    navigateur. Refus catégorique, avant toute autre règle.
  if (/^NEXT_PUBLIC_/.test(nom) && /SECRET|PRIVATE|PEPPER|TOKEN|API_KEY|PASSWORD|CREDENTIAL/i.test(nom)) {
    return { ...base, categorieDestination: 'interdite', raison: 'Nom public portant un secret : exposition navigateur, aucune destination autorisée.' }
  }

  // 2. Variables fournies par la plateforme (OS, Electron, Next, Vercel, CI).
  if (action === 'platform' || scope === 'runtime-system') {
    return { ...base, categorieDestination: 'plateforme', raison: 'Injectée par la plateforme ; jamais provisionnée par le configurateur.' }
  }

  // 3. Consommateur absent du code : lui donner une valeur n'aurait aucun effet.
  if (action === 'unused' || variable.status === 'absent-consumer') {
    return { ...base, categorieDestination: 'aucune', raison: 'Aucun consommateur dans le code ; ne pas inventer un réglage.' }
  }

  // 4. Clé privée de l'autorité de licences : cas nommé, avant toute règle de
  //    portée. Elle est lue par une route serveur, donc techniquement
  //    déployable — mais la déployer transforme le projet PWA en émetteur de
  //    licences. Ce n'est pas une décision qu'un outil prend tout seul.
  if (nom === 'GF_PRIVATE_KEY') {
    return {
      ...base,
      fichiers: [FICHIERS.serveur],
      cibles: [],
      autorisationExplicite: 'cle-licence-vercel',
      categorieDestination: 'licences',
      raison: 'Clé privée de l autorité de licences : fichier serveur local et keys/ seulement. Aucun envoi automatique vers Vercel ni vers un client.',
    }
  }

  // 5. Clé de signature de publication : coffre hors dépôt uniquement.
  if (action === 'publisher' || scope === 'publisher-only' || scope === 'server-publisher') {
    return { ...base, categorieDestination: 'publication', raison: 'Clé de signature de publication : coffre hors dépôt, jamais dans le client ni dans le projet PWA.' }
  }

  // 6. Réglages propres au générateur de licences Python.
  if (action === 'keygen' || RESERVEES_KEYGEN.has(nom)) {
    return { ...base, categorieDestination: 'licences', raison: 'Poste de signature des licences (keys/server_config.json, keygen) ; jamais déployée en PWA.' }
  }

  // 7. Secret d'exécution local Electron : généré à l'exécution, pas déployé.
  if (action === 'runtime' || scope === 'desktop-runtime') {
    return { ...base, categorieDestination: 'runtime-desktop', raison: 'Secret éphémère généré par Electron dans userData ; non déployable.' }
  }

  // 8. Outils de maintenance, tests, build : hors configuration applicative.
  if (['maintenance-tool', 'test-only', 'release-tooling', 'development'].includes(scope)) {
    return { ...base, categorieDestination: 'outillage', raison: 'Développement, test ou outillage de publication : fourni ponctuellement par l opérateur.' }
  }
  if (scope === 'build-time' || scope === 'build-time-public') {
    return { ...base, categorieDestination: 'build', raison: 'Variable de build ; fixée par la chaîne de construction, pas par la configuration d exécution.' }
  }

  // 9. Configuration applicative : la seule catégorie réellement déployée.
  if (action === 'application' || action === 'manual') {
    const desktop = scope === 'desktop' || scope === 'both'
    // `server-keygen` désigne une variable lue À LA FOIS par une route serveur
    // et par le générateur Python : elle a donc deux destinations, et oublier
    // l'une des deux casse la révocation de licences (GARAGEFLOW_API_KEY).
    const serveur = scope === 'server' || scope === 'both' || scope === 'server-keygen'
    const fichiers = []
    if (desktop) fichiers.push(FICHIERS.desktop)
    if (serveur && !INTERDITES_COTE_CLIENT.has(nom)) fichiers.push(FICHIERS.serveur)
    const cibles = serveur && !INTERDITES_COTE_CLIENT.has(nom) ? (CIBLES_REQUISES[nom] || []) : []
    const secondaires = scope === 'server-keygen' ? ['keys/server_config.json (keygen)'] : []
    return {
      ...base,
      fichiers,
      cibles,
      destinationsSecondaires: secondaires,
      categorieDestination: desktop && serveur ? 'desktop+serveur' : desktop ? 'desktop' : 'serveur',
      raison: (cibles.length
        ? 'Configuration applicative requise ; cibles Vercel : ' + cibles.join(', ') + '.'
        : 'Configuration applicative ; aucune cible Vercel imposée (facultative ou propre au poste).') +
        (secondaires.length ? ' Également attendue par ' + secondaires.join(', ') + '.' : ''),
    }
  }

  return { ...base, categorieDestination: 'aucune', raison: 'Aucune règle de destination : traitée comme non déployable.' }
}

/**
 * Vrai si la valeur d'une variable peut être recopiée d'un environnement vers
 * un autre. Un `false` n'interdit pas de la configurer : il interdit de la
 * DUPLIQUER, ce qui est différent.
 */
function copiableEntreEnvironnements(nom) {
  if (VALEUR_PARTAGEE.has(nom)) return true
  return !PROPRE_A_L_ENVIRONNEMENT.has(nom)
}

/** Contrôle de cohérence de la politique elle-même, exécuté par la suite de tests. */
function verifierPolitique(entrees) {
  const problemes = []
  const parNom = new Map(entrees.map((entree) => [entree.name, entree]))
  for (const nom of Object.keys(CIBLES_REQUISES)) {
    if (!parNom.has(nom)) problemes.push('CIBLES_REQUISES cite ' + nom + ', absent du manifeste.')
  }
  for (const entree of entrees) {
    if (!entree.requiredProduction) continue
    const regle = destination(entree)
    if (regle.categorieDestination === 'plateforme' || regle.categorieDestination === 'aucune') continue
    if (!regle.cibles.includes('production')) {
      problemes.push(entree.name + ' est requise en production mais la politique ne lui donne pas la cible production.')
    }
  }
  for (const nom of INTERDITES_COTE_CLIENT) {
    const entree = parNom.get(nom)
    if (!entree) continue
    const regle = destination(entree)
    if (regle.fichiers.includes(FICHIERS.desktop)) problemes.push(nom + ' ne doit jamais atteindre le fichier desktop.')
    if (regle.cibles.length) problemes.push(nom + ' ne doit jamais être synchronisée vers Vercel.')
  }
  return problemes
}

module.exports = {
  CIBLES_VERCEL, FICHIERS, CIBLES_REQUISES, PROPRE_A_L_ENVIRONNEMENT, VALEUR_PARTAGEE,
  INTERDITES_COTE_CLIENT, RESERVEES_KEYGEN, destination, copiableEntreEnvironnements, verifierPolitique,
}
