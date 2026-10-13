#!/usr/bin/env node
/**
 * Génère ENVIRONMENT-VARIABLES.md DEPUIS le manifeste.
 *
 * Le document n'est jamais écrit à la main : il divergerait dès la première
 * modification du contrat, et une documentation fausse est plus nuisible que
 * pas de documentation. `check:env-consistency` vérifie qu'il reste synchrone.
 *
 * AUCUNE VALEUR n'est lue ni écrite — uniquement des noms et des métadonnées.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const m = JSON.parse(readFileSync(path.join(RACINE, 'scripts', 'garageflow-env-manifest.json'), 'utf8'))

const SENSIBILITE = (v) => {
  if (/SECRET|KEY|TOKEN|PASSWORD|PEPPER/.test(v.name) && !v.name.startsWith('NEXT_PUBLIC_')) return 'SECRET'
  if (/URL/.test(v.name) && v.classification === 'external') return 'SENSIBLE'
  if (v.name.startsWith('NEXT_PUBLIC_')) return 'PUBLIC'
  return 'CONFIGURATION'
}

const echapper = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
const resume = (s, n = 150) => {
  const t = echapper(s)
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const groupes = new Map()
for (const v of m.variables) {
  const c = v.classification ?? 'autre'
  if (!groupes.has(c)) groupes.set(c, [])
  groupes.get(c).push(v)
}

const L = []
L.push('# Variables d’environnement — contrat canonique')
L.push('')
L.push('> **Document GÉNÉRÉ** par `npm run env:doc` depuis')
L.push('> [`scripts/garageflow-env-manifest.json`](scripts/garageflow-env-manifest.json), qui fait foi.')
L.push('> Ne pas éditer à la main : `check:env-consistency` échoue en cas de divergence.')
L.push('')
L.push('## La règle')
L.push('')
L.push('**Une configuration logique = un seul nom canonique = exactement le même nom partout** :')
L.push('`.env`, Vercel, Prisma, Next.js, Electron, PWA, scripts, CI, documentation.')
L.push('')
L.push('Aucun repli silencieux entre deux noms. Aucun alias historique conservé indéfiniment.')
L.push('Une variable manquante fait échouer le démarrage avec un message exploitable ;')
L.push('elle n’est jamais remplacée en douce par une autre.')
L.push('')
L.push('**Aucune valeur ne figure dans ce document** — uniquement des noms et des rôles.')
L.push('')

L.push('## Alias INTERDITS')
L.push('')
L.push('Ces noms ont désigné une configuration qui possède déjà un nom canonique.')
L.push('Leur réapparition — dans le code, un script, un `.env`, la documentation active')
L.push('ou chez Vercel — fait échouer `npm run check:env-consistency`.')
L.push('')
L.push('| Alias interdit | Nom canonique | Pourquoi il a existé |')
L.push('| --- | --- | --- |')
for (const [alias, spec] of Object.entries(m.forbiddenAliases ?? {})) {
  L.push(`| \`${alias}\` | \`${spec.canonical}\` | ${resume(spec.reason, 260)} |`)
}
L.push('')

const TITRES = {
  secret: 'Secrets générés par GarageFlows',
  external: 'Fournies par un service externe',
  configuration: 'Configuration fonctionnelle',
  'runtime-system': 'Fournies par le système d’exécution',
  'test-external': 'Harnais de test',
}

L.push('## Contrat par catégorie')
L.push('')
for (const [classification, vars] of [...groupes].sort()) {
  L.push(`### ${TITRES[classification] ?? classification} (${vars.length})`)
  L.push('')
  L.push('| Nom | Sensibilité | Requise en production | Portée | Rôle |')
  L.push('| --- | --- | --- | --- | --- |')
  for (const v of vars.sort((a, b) => a.name.localeCompare(b.name))) {
    const inerte = v.status === 'absent-consumer' ? ' *(aucun consommateur dans ce dépôt)*' : ''
    L.push(
      `| \`${v.name}\` | ${SENSIBILITE(v)} | ${v.requiredProduction ? '**oui**' : 'non'} ` +
      `| ${echapper(v.scope)} | ${resume(v.notes) || '—'}${inerte} |`)
  }
  L.push('')
}

L.push('## Fournies par la plateforme')
L.push('')
L.push('Node, Electron, Vercel, la CI ou les harnais de test les définissent :')
L.push('elles ne se provisionnent pas et ne figurent pas au contrat à provisionner.')
L.push('')
L.push((m.platformProvided ?? []).map((n) => `\`${n}\``).join(' · '))
L.push('')

L.push('## Contrôles')
L.push('')
L.push('| Commande | Ce qu’elle vérifie |')
L.push('| --- | --- |')
L.push('| `npm run check:env-consistency` | Alias interdit réapparu, variable lue non déclarée, variable déclarée devenue inerte, statut périmé, typo, nom non canonique dans un `.env.example`, secret exposé au navigateur. Incluse dans `check:consistency`, donc dans `release:gate`. |')
L.push('| `npm run check:env-contract` | Même analyse, en mode rapport : affiche la matrice complète sans faire échouer. |')
L.push('| `npm run check:env-vercel` | Compare les NOMS du contrat à ceux présents chez Vercel (requis manquants, alias historiques, inconnues). Nécessite le CLI et le réseau. |')
L.push('| `npm run env:doc` | Régénère ce document depuis le manifeste. |')
L.push('')
L.push('Les tests `src/lib/__tests__/env-contract.test.ts` et `env-manifest-drift.test.ts`')
L.push('verrouillent le registre et le comportement au démarrage.')
L.push('')

writeFileSync(path.join(RACINE, 'ENVIRONMENT-VARIABLES.md'), `${L.join('\n')}\n`)
console.log(`ENVIRONMENT-VARIABLES.md généré : ${m.variables.length} variables, ` +
  `${Object.keys(m.forbiddenAliases ?? {}).length} alias interdits, ` +
  `${(m.platformProvided ?? []).length} variables plateforme.`)
