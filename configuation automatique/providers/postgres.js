'use strict'
/**
 * FOURNISSEUR POSTGRESQL / NEON.
 *
 * La règle du cahier des charges est appliquée littéralement : on ne déclare
 * `SUCCESS` que lorsqu'une connexion a réellement été ouverte. Un contrôle de
 * format d'URL vaut `WARNING` au mieux — une URL parfaitement formée vers une
 * base supprimée a exactement la même apparence qu'une URL valide.
 *
 * Trois contrôles sont menés, dans cet ordre :
 *   1. forme de l'URL et cohérence du couple poolée / directe
 *      (`scripts/lib/config-credentials.cjs` porte déjà ces règles) ;
 *   2. connexion effective sur LES DEUX URL — la poolée sert l'exécution, la
 *      directe sert les migrations : n'en tester qu'une laisse passer la moitié
 *      des pannes ;
 *   3. présence de données métier, via `scripts/config-services.cjs`, ce qui
 *      décide si une génération de clé est tolérable ou destructrice.
 *
 * Aucune migration, aucun `db push`, aucune création de base n'est déclenchée.
 */

const crypto = require('node:crypto')
const path = require('node:path')

const exec = require('../utils/exec.js')
const redact = require('../security/redact.js')
const discovery = require('../core/discovery.js')

/**
 * Empreinte de la CIBLE d'une base : hôte + chemin, sans identifiants.
 * Reproduit `empreinteCibleBase()` de `src/lib/env.ts` — c'est la valeur
 * attendue par `GF_PRODUCTION_DB_FINGERPRINT`, et la garde d'isolation Preview
 * ne fonctionne que si les deux calculs coïncident exactement.
 */
function empreinteCible(url) {
  if (!url || !String(url).trim()) return null
  try {
    const analysee = new URL(String(url).trim())
    if (!analysee.host) return null
    return crypto.createHash('sha256').update(analysee.host + analysee.pathname).digest('hex')
  } catch {
    return null
  }
}

/** Résumé publiable d'une URL : hôte et nom de base, sans identifiants. */
function resume(url) {
  try {
    const analysee = new URL(String(url).trim())
    return {
      hote: analysee.hostname,
      base: analysee.pathname.replace(/^\//, '') || null,
      poolee: /-pooler\./i.test(analysee.hostname),
      sslmode: analysee.searchParams.get('sslmode'),
      fournisseur: /\.neon\.tech$/i.test(analysee.hostname) ? 'neon' : 'postgresql',
    }
  } catch {
    return null
  }
}

/** Contrôles de forme, délégués aux règles du dépôt. */
function controlerForme(racine, valeurs) {
  const credentials = require(path.join(racine, 'scripts/lib/config-credentials.cjs'))
  const problemes = []
  for (const nom of ['DATABASE_URL', 'DIRECT_URL']) {
    const valeur = valeurs[nom]
    if (!valeur) {
      problemes.push(nom + ' : absente.')
      continue
    }
    if (!/^postgres(?:ql)?:\/\//i.test(valeur)) {
      problemes.push(nom + ' : URL PostgreSQL attendue.')
    }
  }
  if (valeurs.DIRECT_URL && /-pooler\./i.test(String(valeurs.DIRECT_URL))) {
    problemes.push('DIRECT_URL : une URL directe ne passe pas par le pooler (migrations).')
  }
  if (!problemes.length) problemes.push(...credentials.postgresIssues(valeurs))
  return problemes
}

/**
 * Ouvre réellement les deux connexions et inspecte la base.
 *
 * @returns {{ poolee: boolean, directe: boolean, vide: boolean|null,
 *             tables: number|null, empreinte: string|null, erreur: string|null }}
 */
async function sonder(racine, valeurs, options = {}) {
  const resultat = {
    forme: controlerForme(racine, valeurs),
    poolee: false,
    directe: false,
    vide: null,
    tables: null,
    empreinte: empreinteCible(valeurs.DATABASE_URL),
    resumePoolee: resume(valeurs.DATABASE_URL),
    resumeDirecte: resume(valeurs.DIRECT_URL),
    erreur: null,
  }
  if (!valeurs.DATABASE_URL || !valeurs.DIRECT_URL) {
    resultat.erreur = 'URL poolée et directe nécessaires : aucune connexion tentée.'
    return resultat
  }
  // Une variable Vercel marquée Sensitive revient sous la forme du littéral
  // `[SENSITIVE]` : ce n'est pas une URL, c'est l'aveu qu'on ne peut PAS la
  // lire. S'en servir comme chaîne de connexion produisait un « connexion
  // refusée » qui ressemblait à une panne d'infrastructure, alors que la base
  // n'avait même pas été contactée. La non-lisibilité est un BLOCAGE, pas un
  // échec : le dire ainsi est la seule information vraie.
  const nonRelisibles = ['DATABASE_URL', 'DIRECT_URL'].filter((nom) => discovery.estRedaction(valeurs[nom]))
  if (nonRelisibles.length) {
    resultat.nonRelisible = nonRelisibles
    resultat.erreur = nonRelisibles.join(' et ') + ' : valeur protégée en lecture chez Vercel '
      + '(« [SENSITIVE] »). Aucune connexion tentée — la destination n est pas vérifiable '
      + 'depuis ce poste. Lancez le contrôle DANS l environnement cible (/api/health authentifié).'
    return resultat
  }
  // Prisma journalise les requêtes quand DEBUG est actif, et une URL de
  // connexion porte le mot de passe. On refuse la sonde plutôt que de risquer
  // une trace contenant un identifiant.
  if (process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG) {
    resultat.erreur = 'DEBUG actif : sonde PostgreSQL refusée pour éviter une trace contenant des identifiants.'
    return resultat
  }

  let PrismaClient
  try {
    PrismaClient = (options.chargerClient
      ? options.chargerClient()
      : require(path.join(racine, 'src/generated/server-client'))).PrismaClient
  } catch {
    resultat.erreur = 'Client Prisma PostgreSQL absent : exécuter npm run db:server:generate, puis relancer.'
    return resultat
  }

  for (const [nom, champ] of [['DATABASE_URL', 'poolee'], ['DIRECT_URL', 'directe']]) {
    const client = new PrismaClient({ datasourceUrl: valeurs[nom], log: [] })
    try {
      const lignes = await client.$queryRawUnsafe('SELECT 1 AS sonde')
      resultat[champ] = Array.isArray(lignes) && lignes.length === 1
    } catch (erreur) {
      // Un motif VIDE rend le rapport inexploitable : « connexion refusée () »
      // ne dit ni pourquoi, ni quoi corriger. Les messages Prisma commencent
      // souvent par une ligne vide (bannière), et la rédaction peut tout
      // retirer : on cherche donc la première ligne qui porte du texte, et à
      // défaut on nomme explicitement l'absence de motif.
      const motif = String(erreur && erreur.message || '')
        .split('\n')
        .map((ligne) => redact.nettoyer(ligne).trim())
        .find((ligne) => ligne.length > 0)
      const code = erreur && (erreur.code || erreur.errorCode)
      resultat.erreur = nom + ' : connexion refusée ('
        + (motif ? motif.slice(0, 160) : (code ? 'code ' + code : 'aucun motif renvoyé par le pilote'))
        + ')'
    } finally {
      await client.$disconnect().catch(() => {})
    }
  }

  if (resultat.directe) {
    try {
      const services = require(path.join(racine, 'scripts/config-services.cjs'))
      const inspection = await services.inspectDatabase(racine, valeurs.DIRECT_URL)
      resultat.vide = inspection.empty
      resultat.tables = inspection.tableCount
    } catch (erreur) {
      resultat.inspection = 'indisponible : ' + redact.nettoyer(erreur.message).slice(0, 160)
    }
  }
  return resultat
}

/**
 * Inventaire Neon, uniquement si le CLI officiel est présent ET authentifié.
 * Aucune création : la découverte sert à retrouver une ressource existante.
 */
async function inventaireNeon(racine, options = {}) {
  const etat = { cli: false, authentifie: false, projets: [], erreur: null }
  const npm = exec.npmCli()
  const lancer = (args) => exec.lancer(process.execPath,
    [npm, 'exec', '--no', '--package=neonctl@8.4.4', '--', 'neonctl', ...args],
    { cwd: racine, delaiMs: options.delaiMs || 120000, captureStderr: true, libelle: 'neonctl' })
  let sortie
  try {
    sortie = await lancer(['projects', 'list', '--output', 'json'])
  } catch {
    etat.erreur = 'neonctl indisponible localement (non installé) : inventaire Neon non effectué.'
    return etat
  }
  etat.cli = true
  if (sortie.code !== 0) {
    // `--no` empêche tout téléchargement : un code non nul signifie « CLI
    // absent du cache » ou « session absente ». On ne lance jamais `neonctl
    // auth`, qui ouvrirait un navigateur et bloquerait l'exécution.
    etat.erreur = 'neonctl présent mais non authentifié ou injoignable : aucune ressource listée, aucune création.'
    return etat
  }
  try {
    const donnees = JSON.parse(sortie.stdout)
    const liste = Array.isArray(donnees) ? donnees : donnees.projects
    if (!Array.isArray(liste)) throw new Error()
    etat.authentifie = true
    etat.projets = liste.map((projet) => ({ id: projet.id, nom: projet.name, region: projet.region_id || null }))
  } catch {
    // `npm exec --no` rend 0 sans exécuter quand le paquet manque du cache :
    // la sortie n'est alors pas du JSON. Ce n'est pas un format inattendu du
    // CLI, c'est l'absence du CLI — et dire l'un pour l'autre envoie chercher
    // un bogue de compatibilité au lieu d'installer l'outil.
    etat.cli = false
    etat.erreur = 'CLI Neon absent du cache local ou sans session : inventaire non effectué. '
      + 'Aucune base n est créée ni devinée ; les URL Neon proviennent exclusivement du projet Vercel ou du fichier local.'
  }
  return etat
}

module.exports = { empreinteCible, resume, controlerForme, sonder, inventaireNeon }
