#!/usr/bin/env node
/**
 * COHÉRENCE DU CONTRAT D'ENVIRONNEMENT — une configuration, UN nom canonique.
 *
 * Source de vérité : `scripts/garageflow-env-manifest.json`
 *   • `variables`        → les noms canoniques, avec rôle, portée, sensibilité ;
 *   • `platformProvided` → ce que fournit Node/Electron/Vercel/CI et les harnais
 *                          de test : jamais saisi par un exploitant ;
 *   • `forbiddenAliases` → les noms bannis, chacun vers son canonique.
 *
 * Motif (incident du 15/08/2026) : `PWA_DATABASE_URL` portait la même valeur que
 * `DATABASE_URL`, et un patch injecté au déploiement recopiait l'une dans
 * l'autre. Ce patch ne vivait pas dans le dépôt : un déploiement fait autrement
 * démarrait sans la recopie, et la PWA refusait de démarrer. Deux noms pour une
 * même donnée avaient rendu le dépôt et la production silencieusement
 * divergents.
 *
 * Cette garde échoue si :
 *   1. un alias interdit réapparaît quelque part ;
 *   2. le code lit une variable non déclarée au manifeste ;
 *   3. le manifeste déclare une variable que plus rien ne lit ni n'écrit ;
 *   4. un nom ressemble à s'y méprendre à un nom canonique (typo) ;
 *   5. un fichier d'exemple `.env*` emploie un nom non canonique ;
 *   6. une variable classée secrète est exposée au navigateur (`NEXT_PUBLIC_`).
 *
 * AUCUNE VALEUR n'est lue : uniquement des NOMS.
 *
 * Usage : node scripts/check-env-consistency.mjs [--rapport]
 *         --rapport : affiche la matrice complète sans faire échouer.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFESTE = path.join(RACINE, 'scripts', 'garageflow-env-manifest.json')
const RAPPORT = process.argv.includes('--rapport')

const manifeste = JSON.parse(readFileSync(MANIFESTE, 'utf8'))
const CANONIQUES = new Map(manifeste.variables.map((v) => [v.name, v]))
const PLATEFORME = new Set(manifeste.platformProvided ?? [])
const INTERDITS = manifeste.forbiddenAliases ?? {}

if (CANONIQUES.size < 50 || PLATEFORME.size < 20 || Object.keys(INTERDITS).length === 0) {
  console.error('❌ Manifeste incomplet (variables/platformProvided/forbiddenAliases) — contrôle impossible.')
  process.exit(1)
}

// ── Périmètre de balayage ────────────────────────────────────────────────────
const RACINES = ['src', 'electron', 'prisma', 'scripts', 'e2e', '.github', 'config']
const FICHIERS_RACINE = ['package.json', 'next.config.mjs', 'vercel.json', 'vercel.ts', 'playwright.config.ts']
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'out', 'coverage', 'artifacts', 'generated', 'server-client', '__pycache__'])
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.ps1', '.prisma', '.yml', '.yaml', '.json', '.cmd', '.bat', '.sh'])

/**
 * Documents HISTORIQUES : un rapport qui explique un incident passé cite
 * légitimement l'ancien nom. On ne réécrit pas l'histoire (§35) — mais la
 * documentation ACTIVE, elle, doit être à jour.
 */
const DOCS_HISTORIQUES = [
  // La référence du contrat DOIT nommer les alias qu'elle bannit : c'est sa
  // raison d'être. Elle est par ailleurs GÉNÉRÉE depuis le manifeste, donc
  // incapable de diverger de lui.
  /^ENVIRONMENT-VARIABLES\.md$/,
  /^AUDIT_PROGRESS\.md$/,
  /^RAPPORT-FINAL\.md$/,
  /^AUDIT_RAPPORT\.md$/,
  /^AUDIT_TRACKER\.md$/,
  /^docs\/audit\//,
]

/**
 * Fichiers dont la RAISON D'ÊTRE est d'employer les formes interdites pour
 * démontrer qu'elles ne fonctionnent pas. Les y interdire reviendrait à
 * interdire de tester la garde elle-même. Exemption de fichier entier, sur le
 * modèle de `V1_FIXTURE_FILES` dans check-money-json.mjs.
 */
const FICHIERS_PREUVE = new Set(['src/lib/__tests__/env-contract.test.ts'])

/**
 * Exceptions PRÉCISES : fichier + fragment de ligne + justification.
 * Une exception non utilisée fait échouer le contrôle (exception morte).
 */
const AUTORISEES = [
  {
    file: 'scripts/compromised-secrets.json',
    needle: '"env": "DATABASE_URL_UNPOOLED",',
    reason: 'Métadonnée historique de détection de valeurs exposées : empreinte conservée, jamais lue comme variable runtime.',
  },
  {
    file: 'scripts/config-core.cjs',
    needle: "'DATABASE_URL_UNPOOLED', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',",
    reason: 'Parsing de saisie fournisseur uniquement ; pas lecture process.env ni export. Testé par tests/env-provider-contract.test.cjs.',
  },
  {
    file: 'scripts/config-rebuild.cjs',
    needle: "const DIRECT_URL_PROVIDER_ALIAS = 'DATABASE_URL_UNPOOLED'",
    reason: 'Frontière INPUT explicite : normalizeStorage refuse un conflit et SUPPRIME cette clé de sa sortie. Testé par tests/env-provider-contract.test.cjs.',
  },
  {
    file: 'scripts/reset-garageflow.ps1',
    needle: "foreach ($aliasName in @('DESKTOP_DATABASE_URL','PWA_DATABASE_URL','PWA_DIRECT_URL','DATABASE_URL_UNPOOLED'))",
    reason: "Boucle de NETTOYAGE : elle supprime ces alias de Vercel, elle ne les crée pas.",
  },
  {
    file: 'scripts/reset-garageflow.ps1',
    needle: '# UN NOM CANONIQUE, LE MÊME PARTOUT. Les doublons PWA_DATABASE_URL /',
    reason: "Commentaire expliquant pourquoi les doublons ont été retirés.",
  },
  {
    file: 'scripts/reset-garageflow.ps1',
    needle: '# PWA_DIRECT_URL ont été supprimés : ils portaient la MÊME valeur que',
    reason: "Suite du même commentaire.",
  },
  {
    file: 'src/lib/public-url.ts',
    needle: '`NEXT_PUBLIC_APP_URL` a été retirée le 15/08/2026',
    reason: "Commentaire documentant le retrait de l'alias : il doit le nommer pour être utile.",
  },
  {
    file: 'src/lib/__tests__/public-url.test.ts',
    needle: '// NEXT_PUBLIC_APP_URL reste dans la liste pour être RESTAURÉE proprement et',
    reason: "Commentaire expliquant pourquoi l'alias figure encore dans la liste de restauration.",
  },
  {
    file: 'src/lib/__tests__/public-url.test.ts',
    needle: "const KEYS = ['NEXT_PUBLIC_APP_URL', 'GF_APP_URL', 'NEXTAUTH_URL'] as const",
    reason: "Liste de sauvegarde/restauration de l'environnement de test : l'alias doit être restauré comme les autres.",
  },
  {
    file: 'src/lib/__tests__/public-url.test.ts',
    needle: "it('NEXT_PUBLIC_APP_URL, alias retiré, n’a plus AUCUN effet'",
    reason: "Titre du test qui PROUVE l'inertie de l'alias.",
  },
  {
    file: 'src/lib/__tests__/public-url.test.ts',
    // Motif volontairement AMPUTÉ du préfixe `process.env.` : écrit en entier,
    // il ferait croire au test de dérive du manifeste que cette garde consomme
    // elle-même la variable.
    needle: "NEXT_PUBLIC_APP_URL = 'https://alias-retire.example'",
    reason:
      "Le test doit DÉFINIR l'alias pour démontrer qu'il est ignoré. C'est la seule écriture autorisée de cet alias dans tout le dépôt.",
  },
  {
    file: 'scripts/reset-garageflow.ps1',
    needle: "@('DATABASE_URL','DIRECT_URL','DATABASE_URL_UNPOOLED','DESKTOP_DATABASE_URL')",
    reason:
      "Purge DÉFENSIVE des variables de PROCESSUS avant le déploiement : une valeur héritée du shell de l'opérateur ne doit pas se substituer à celle de Vercel. Nomme les alias pour les neutraliser.",
  },
]
const exceptionsUtilisees = new Set()

// ── Motifs de lecture d'une variable ─────────────────────────────────────────
const MOTIFS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /\benv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g,
  /os\.environ\.get\(\s*['"]([^'"]+)['"]/g,
  /os\.environ\[\s*['"]([^'"]+)['"]\s*\]/g,
  /os\.getenv\(\s*['"]([^'"]+)['"]/g,
  /\$env:([A-Za-z_][A-Za-z0-9_]*)/g,
  /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
  /\$\{\{\s*(?:secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
  /\[Environment\]::(?:Get|Set)EnvironmentVariable\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g,
  // Lecture INDIRECTE par un utilitaire du dépôt : ces trois fonctions font
  // `process.env[name]` sur leur premier argument. Sans ce motif, onze
  // variables bel et bien lues étaient déclarées « inertes » — angle mort que
  // partage le test de dérive historique. La liste est NOMMÉE plutôt que
  // générique : un motif « tout appel avec un littéral majuscule » attrapait les
  // codes d'erreur (`MECHANIC_KEY_UNKNOWN`) et les clés de message
  // (`SKIP_WAITING`), qui ne sont pas des variables d'environnement.
  /\b(?:envInt|boolEnv|checkPresent)\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
]

/**
 * Motifs de MENTION uniquement : ils prouvent qu'un nom déjà déclaré n'est pas
 * oublié, mais ne servent jamais à découvrir une variable non déclarée — ils
 * seraient bien trop larges pour cela.
 */
const MOTIFS_MENTION = [
  /\b[A-Za-z_$][\w$]*\s*\(\s*['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g,
]

const estNomVariable = (n) => /^[A-Z][A-Z0-9_]{2,}$/.test(n)

function* parcourir(dir) {
  let entrees
  try { entrees = readdirSync(dir) } catch { return }
  for (const e of entrees) {
    if (IGNORE_DIRS.has(e)) continue
    const p = path.join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { yield* parcourir(p); continue }
    if (EXT.has(path.extname(e))) yield p
  }
}

/** nom → Set(fichiers) pour les LECTURES par du code. */
const lectures = new Map()
/** nom → Set(fichiers) pour toute MENTION (y compris listes, écritures). */
const mentions = new Map()
const ajouter = (carte, nom, rel) => {
  if (!carte.has(nom)) carte.set(nom, new Set())
  carte.get(nom).add(rel)
}

const fichiers = []
for (const r of RACINES) {
  const d = path.join(RACINE, r)
  if (existsSync(d)) fichiers.push(...parcourir(d))
}
for (const f of FICHIERS_RACINE) {
  const p = path.join(RACINE, f)
  if (existsSync(p)) fichiers.push(p)
}

const erreurs = []
const avertissements = []

for (const f of fichiers) {
  const rel = path.relative(RACINE, f).replace(/\\/g, '/')
  if (rel === 'scripts/check-env-consistency.mjs') continue
  let texte
  try { texte = readFileSync(f, 'utf8') } catch { continue }

  // Outil de charge lancé À LA MAIN par un développeur : ses variables ne font
  // pas partie de la configuration livrée à un garage. Même exclusion que
  // env-manifest-drift.test.ts, pour que les deux contrôles voient le même
  // périmètre.
  if (rel === 'scripts/loadtest.mjs') continue

  const estTest = /\.(test|spec)\.[tj]sx?$/.test(rel) || rel.includes('/__tests__/') || rel.startsWith('e2e/')

  for (const re of MOTIFS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(texte))) {
      const nom = m[1]
      if (!estNomVariable(nom)) continue
      ajouter(mentions, nom, rel)
      if (!estTest) ajouter(lectures, nom, rel)
    }
  }

  for (const re of MOTIFS_MENTION) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(texte))) if (estNomVariable(m[1])) ajouter(mentions, m[1], rel)
  }

  // Un nom CANONIQUE cité en chaîne littérale (tableau de noms à purger, liste
  // de rotation, jeu de tests…) prouve que la variable n'est pas oubliée. Ce
  // balayage ne peut pas DÉCOUVRIR de nouveaux noms — il ne cherche que ceux
  // déjà déclarés — il ne sert donc qu'à ne pas déclarer inerte ce qui ne l'est
  // pas.
  for (const nom of CANONIQUES.keys()) {
    if (new RegExp(`['"\`]${nom}['"\`]`).test(texte)) ajouter(mentions, nom, rel)
  }

  // ── 1. Alias interdit ────────────────────────────────────────────────────
  // Le manifeste EST le registre : il doit nommer les alias qu'il bannit.
  if (rel !== 'scripts/garageflow-env-manifest.json' && !FICHIERS_PREUVE.has(rel)) {
    for (const alias of Object.keys(INTERDITS)) {
      // Limites sur les caractères d'IDENTIFIANT, pas sur les mots : sans cela,
      // la constante JS `CORRECT_DB_URL` de setup-dev.js déclenchait l'alias
      // « DB_URL ». Un nom de variable n'est jamais collé à un autre identifiant.
      const motif = new RegExp(`(?<![A-Za-z0-9_])${alias}(?![A-Za-z0-9_])`)
      if (!motif.test(texte)) continue
      texte.split(/\r?\n/).forEach((ligne, i) => {
        if (!motif.test(ligne)) return
        // NEUTRALISATION explicite : purger une variable de processus, c'est
        // empêcher un alias hérité du shell de se substituer à la valeur
        // canonique. C'est l'inverse d'un usage.
        if (new RegExp(`SetEnvironmentVariable\\(\\s*'${alias}'\\s*,\\s*\\$null`).test(ligne)) return
        const exception = AUTORISEES.find((a) => a.file === rel && ligne.includes(a.needle))
        if (exception) { exceptionsUtilisees.add(exception); return }
        erreurs.push(
          `${rel}:${i + 1} : alias INTERDIT « ${alias} » — utiliser « ${INTERDITS[alias].canonical} » ` +
          `(un nom canonique par configuration)`)
      })
    }
  }
}

// ── Fichiers .env* : les NOMS déclarés doivent être canoniques ───────────────
const fichiersEnv = readdirSync(RACINE).filter((f) => /^\.env/.test(f))
const declaresEnv = new Map()
for (const f of fichiersEnv) {
  const texte = readFileSync(path.join(RACINE, f), 'utf8')
  for (const m of texte.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
    ajouter(declaresEnv, m[1], f)
    ajouter(mentions, m[1], f)
  }
  for (const alias of Object.keys(INTERDITS)) {
    if (new RegExp(`^\\s*(?:export\\s+)?${alias}\\s*=`, 'm').test(texte)) {
      erreurs.push(`${f} : alias INTERDIT « ${alias} » déclaré — renommer en « ${INTERDITS[alias].canonical} »`)
    }
  }
}

// ── Documentation ACTIVE : pas d'alias interdit (l'historique est préservé) ──
const docs = []
for (const d of ['docs', '.']) {
  const dir = path.join(RACINE, d)
  if (!existsSync(dir)) continue
  const collecte = (rep) => {
    let entrees
    try { entrees = readdirSync(rep) } catch { return }
    for (const e of entrees) {
      if (IGNORE_DIRS.has(e)) continue
      const p = path.join(rep, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (d === 'docs') collecte(p); continue }
      if (path.extname(e) === '.md') docs.push(p)
    }
  }
  collecte(dir)
}
for (const f of docs) {
  const rel = path.relative(RACINE, f).replace(/\\/g, '/')
  if (DOCS_HISTORIQUES.some((re) => re.test(rel))) continue
  const texte = readFileSync(f, 'utf8')
  for (const alias of Object.keys(INTERDITS)) {
    if (!texte.includes(alias)) continue
    const ligne = texte.split(/\r?\n/).findIndex((l) => l.includes(alias)) + 1
    erreurs.push(`${rel}:${ligne} : documentation ACTIVE citant l'alias « ${alias} » — utiliser « ${INTERDITS[alias].canonical} »`)
  }
}

// ── 2. Lue par le code mais NON déclarée ────────────────────────────────────
const nonDeclarees = []
for (const [nom, fics] of lectures) {
  if (CANONIQUES.has(nom) || PLATEFORME.has(nom) || INTERDITS[nom]) continue
  nonDeclarees.push([nom, [...fics]])
  erreurs.push(`variable LUE mais non déclarée au manifeste : « ${nom} » (${[...fics].slice(0, 3).join(', ')})`)
}

// ── 3. Inertie : contrôle dans LES DEUX SENS ────────────────────────────────
// Le manifeste possède déjà le vocabulaire : `status: "absent-consumer"` marque
// une variable déclarée dont aucun consommateur n'existe dans ce dépôt (la
// configuration de marque blanche, par exemple). Une telle variable n'est donc
// pas une anomalie — c'est un état ASSUMÉ et documenté.
//
// L'anomalie, c'est l'écart entre l'état déclaré et l'état réel, dans un sens
// comme dans l'autre : une variable devenue muette sans être marquée, ou une
// variable marquée absente qui a retrouvé un lecteur (le marquage devient un
// mensonge, et la garde qui s'y fie ne protège plus rien).
const inertes = []
const statutsPerimes = []
for (const [nom, v] of CANONIQUES) {
  const utilisee = mentions.has(nom) || declaresEnv.has(nom)
  const marqueeAbsente = v.status === 'absent-consumer'
  if (!utilisee && !marqueeAbsente) {
    inertes.push(nom)
    erreurs.push(
      `variable DÉCLARÉE mais inerte : « ${nom} » — plus aucun fichier ne la lit ni ne l'écrit ` +
      `(la retirer, ou la marquer status="absent-consumer" si l'absence est assumée)`)
  }
  if (utilisee && marqueeAbsente && lectures.has(nom)) {
    statutsPerimes.push(nom)
    erreurs.push(
      `statut PÉRIMÉ : « ${nom} » est marquée status="absent-consumer" mais elle est LUE par ` +
      `${[...lectures.get(nom)].slice(0, 2).join(', ')} — corriger status et consumers`)
  }
}

// ── 4. Typos : très proche d'un nom canonique sans l'être ───────────────────
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const typos = []
for (const [nom, fics] of mentions) {
  if (CANONIQUES.has(nom) || PLATEFORME.has(nom) || INTERDITS[nom]) continue
  // Une typo n'existant QUE dans le fichier qui prouve son rejet n'en est pas une.
  if ([...fics].every((f) => FICHIERS_PREUVE.has(f))) continue
  for (const canon of CANONIQUES.keys()) {
    if (Math.abs(nom.length - canon.length) > 2) continue
    const d = distance(nom, canon)
    if (d > 0 && d <= 2) {
      typos.push([nom, canon, [...fics]])
      erreurs.push(`typo probable : « ${nom} » à ${d} caractère(s) de « ${canon} » (${[...fics].slice(0, 2).join(', ')})`)
      break
    }
  }
}

// ── 5. Fichiers d'exemple : noms canoniques uniquement ──────────────────────
for (const [nom, fics] of declaresEnv) {
  if (CANONIQUES.has(nom) || PLATEFORME.has(nom)) continue
  const exemples = [...fics].filter((f) => f.includes('example'))
  if (exemples.length) erreurs.push(`${exemples.join(', ')} : nom non canonique « ${nom} »`)
}

// ── 6. Aucun secret exposé au navigateur ────────────────────────────────────
for (const v of manifeste.variables) {
  const secret = v.classification === 'secret' || /secret|key|token|password|pepper/i.test(v.name)
  if (secret && v.name.startsWith('NEXT_PUBLIC_')) {
    erreurs.push(`FUITE : « ${v.name} » est exposée au navigateur alors qu'elle est sensible`)
  }
}

// ── 7. La référence lisible reste synchrone avec le registre ────────────────
// Une documentation d'environnement périmée est plus nuisible qu'absente : elle
// fait chercher une variable sous un nom qui n'existe plus.
const CHEMIN_DOC = path.join(RACINE, 'ENVIRONMENT-VARIABLES.md')
if (!existsSync(CHEMIN_DOC)) {
  erreurs.push('ENVIRONMENT-VARIABLES.md est absent — le régénérer avec `npm run env:doc`')
} else {
  const doc = readFileSync(CHEMIN_DOC, 'utf8')
  const absentesDoc = [...CANONIQUES.keys()].filter((n) => !new RegExp(`\`${n}\``).test(doc))
  if (absentesDoc.length) {
    erreurs.push(
      `ENVIRONMENT-VARIABLES.md ne documente pas ${absentesDoc.length} variable(s) ` +
      `(${absentesDoc.slice(0, 4).join(', ')}${absentesDoc.length > 4 ? '…' : ''}) — ` +
      `régénérer avec \`npm run env:doc\``)
  }
  for (const [alias, spec] of Object.entries(INTERDITS)) {
    if (!new RegExp(`\`${alias}\``).test(doc)) {
      erreurs.push(`ENVIRONMENT-VARIABLES.md ne mentionne pas l'alias interdit « ${alias} » (→ ${spec.canonical}) — régénérer avec \`npm run env:doc\``)
    }
  }
}

// ── Exceptions mortes ───────────────────────────────────────────────────────
for (const a of AUTORISEES) {
  if (!exceptionsUtilisees.has(a)) {
    erreurs.push(`exception MORTE : ${a.file} — « ${a.needle.slice(0, 60)} » introuvable (retirer ou corriger AUTORISEES)`)
  }
}

// ── Sortie ──────────────────────────────────────────────────────────────────
if (RAPPORT) {
  console.log(`\n══ CONTRAT D'ENVIRONNEMENT — ${CANONIQUES.size} variables canoniques\n`)
  console.log('NOM'.padEnd(38) + 'classification'.padEnd(16) + 'portée'.padEnd(18) + 'prod'.padEnd(6) + 'lue par')
  console.log('─'.repeat(100))
  for (const [nom, v] of [...CANONIQUES].sort()) {
    const lue = lectures.get(nom)?.size ?? 0
    console.log(
      nom.padEnd(38) + String(v.classification).padEnd(16) + String(v.scope).padEnd(18) +
      (v.requiredProduction ? 'oui' : 'non').padEnd(6) + `${lue} fichier(s)`)
  }
  console.log(`\n── ${PLATEFORME.size} variables fournies par la plateforme (hors contrat)`)
  console.log(`── ${Object.keys(INTERDITS).length} alias interdits`)
  for (const [a, spec] of Object.entries(INTERDITS)) console.log(`     ${a.padEnd(26)} → ${spec.canonical}`)
  console.log(`\n── ${fichiers.length} fichiers balayés · ${lectures.size} noms lus par du code`)
}

if (erreurs.length) {
  console.error(`\n❌ Cohérence des variables d'environnement : ${erreurs.length} problème(s) :`)
  for (const e of erreurs) console.error(`   • ${e}`)
  console.error(
    `\n   Source de vérité : scripts/garageflow-env-manifest.json` +
    `\n   Référence lisible : ENVIRONMENT-VARIABLES.md`)
  process.exit(1)
}
if (avertissements.length) for (const a of avertissements) console.warn(`   ⚠ ${a}`)
console.log(
  `✅ Contrat d'environnement : ${CANONIQUES.size} variables canoniques, ` +
  `${Object.keys(INTERDITS).length} alias interdits absents du code actif, ` +
  `${PLATEFORME.size} variables plateforme, ${fichiers.length} fichiers balayés.`)
