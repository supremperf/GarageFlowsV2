#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadPolicy } = require('./config-policy.cjs')

function audit(root) {
  const policy = loadPolicy(root)
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const extra = ['config', 'config.cmd', 'scripts/config-policy.cjs', 'scripts/config-services.cjs', 'scripts/config-full.cjs', 'scripts/config-audit.cjs']
  const files = [...new Set([...tracked, ...extra.filter(f => fs.existsSync(path.join(root, f)))])]
  const directories = {}, extensions = {}, references = new Map(), codeFiles = []
  let textFiles = 0, binaries = 0, bytes = 0
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(root, file))
    bytes += buffer.length
    const dir = file.includes('/') ? file.split('/')[0] : '(racine)'
    directories[dir] = (directories[dir] || 0) + 1
    const ext = path.extname(file) || '(sans extension)'
    extensions[ext] = (extensions[ext] || 0) + 1
    if (buffer.includes(0)) { binaries++; continue }
    textFiles++
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|ps1|prisma|cmd|yml|yaml)$/.test(file) && file !== 'config') continue
    codeFiles.push(file)
    const text = buffer.toString('utf8')
    // Literal references only: dynamic reads cannot be proven by a regex inventory.
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|env\(['"]([A-Z][A-Z0-9_]*)['"]\)|os\.(?:getenv|environ\.get)\(['"]([A-Z][A-Z0-9_]*)['"]/g)) {
      const name = m[1] || m[2] || m[3] || m[4]
      if (!references.has(name)) references.set(name, new Set())
      references.get(name).add(file)
    }
  }
  return { policy, files: files.length, textFiles, binaries, bytes, codeFiles: codeFiles.length,
    directories, extensions, references,
    prismaModels: (fs.readFileSync(path.join(root, 'prisma/server/schema.prisma'), 'utf8').match(/^model /gm) || []).length,
    postgresMigrations: fs.readdirSync(path.join(root, 'prisma/server/migrations')).filter(f => fs.existsSync(path.join(root, 'prisma/server/migrations', f, 'migration.sql'))).length,
    apiRoutes: files.filter(f => /^src\/app\/api\/.*\/route\.ts$/.test(f)).length }
}
function render(result) {
  const { policy } = result
  const counts = policy.entries.reduce((a, e) => { a[e.action] = (a[e.action] || 0) + 1; return a }, {})
  const lines = ['# Configuration — inventaire et analyse transversale du dépôt', '',
    '> Généré par `npm run config:audit`. Inventaire statique de tous les fichiers suivis et lecture des fichiers texte ; analyse des points de configuration et des composants structurants. Ce n’est ni une preuve d’absence de bogue dans chaque fonction ni un test des comptes externes.', '',
    `- ${result.files} fichiers inventoriés, ${result.textFiles} textes lus, ${result.binaries} binaires identifiés (non interprétés).`,
    `- ${result.codeFiles} fichiers de code/configuration balayés pour les lectures littérales d’environnement.`,
    `- ${result.apiRoutes} routes API, ${result.prismaModels} modèles PostgreSQL, ${result.postgresMigrations} migrations serveur.`,
    `- ${policy.entries.length} variables canoniques : ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`, '',
    '## Architecture et conséquences pour config', '',
    '- Next.js 14 App Router : interface, API, instrumentation de validation, sessions et contrôle de licence serveur. Deux clients Prisma sont générés ; `src/lib/db.ts` choisit SQLite/PostgreSQL depuis le schéma de connexion.',
    '- Electron : serveur Next local sur loopback, SQLite dans userData, secrets par installation, photos sur disque, mise à jour vérifiée et intégrité. Les secrets d’un poste installé ne doivent pas être remplacés par ceux du serveur.',
    '- PWA/Vercel : PostgreSQL durable et Redis REST distribué obligatoires. Pas de chemin de disque local fictif pour rendre persistantes les sauvegardes. Les variables runtime Vercel restent gérées par Vercel.',
    '- Licence : P-256 privé côté émetteur/keygen ; clé publique embarquée en Electron et Next. Record-MAC HMAC et pepper distincts. Le keygen attend `keys/private.pem`, `keys/public.pem` et `keys/server_config.json`.',
    '- Portail : secrets de sessions/liens, signatures et TOTP séparés. SMTP, TOTP, sauvegardes et identifiants de facturation ont leurs propres clés ; une rotation involontaire détruit l’accès aux cryptogrammes.',
    '- Publication : Ed25519 privé hors dépôt, clés publiques historiques conservées dans le client. Le service de publication garagesite3 est un autre dépôt et ne peut pas être déployé à partir de ces seules sources.',
    '- Outillage : scripts PowerShell de configuration/reset/rotation déjà présents. Le mode complet portable ne lance pas les resets destructifs et ne réaligne pas un historique SQL au hasard.',
    '- Secrets non relisibles : une variable Sensitive déjà présente n’est retirée/recréée chez Vercel que lorsque sa valeur locale est générée (base cible confirmée puis inspectée sans données métier dans le plan complet) ou lorsque le remplacement est autorisé explicitement. Les URLs de base viennent de Neon, jamais d’une valeur inventée ; les reçus ne contiennent que des empreintes SHA-256.',
    '- Dépendances : Node 22/npm pour l’application ; Python/cryptography pour le keygen. Builds Windows, signature de code, identité légale et fournisseur de facturation exigent des ressources externes.', '',
    '## Blocages que des variables ne résolvent pas', '',
    '1. Sur Vercel, le service de sauvegarde actuel écrit des fichiers : un stockage durable + adaptation applicative sont nécessaires. Config signale cette limitation, sans déclarer le stockage opérationnel.',
    '2. Le provider LLM du Copilot n’est pas implémenté (`resolveLlmProvider()` rend null). Une clé Anthropic configure l’OCR existant, pas une intégration Copilot imaginaire.',
    `3. Les ${counts.unused || 0} entrées historiques marquées absent-consumer ne sont pas réactivées. Les variables de test/reset/debug ne sont pas déployées.`,
    '4. Clés privées perdues, secrets Vercel non relisibles, domaine/DNS, SMTP et comptes des plateformes : autorisation/valeur d’origine nécessaire, jamais inventée.',
    '5. Les migrations existantes restent la source de vérité ; un drift après déploiement bloque le plan au lieu de lancer db push/reset.', '',
    '## Répartition des fichiers', '', '| Répertoire | Fichiers |', '|---|---:|']
  for (const [dir, n] of Object.entries(result.directories).sort((a, b) => b[1] - a[1])) lines.push(`| ${dir} | ${n} |`)
  lines.push('', '## Couverture du contrat complet', '', 'Chaque ligne a une décision explicite. « manual » signifie choix/outil spécifique non activé ; « unused » signifie qu’ajouter une valeur n’aurait aucun effet. Les variables facultatives peuvent rester vides.', '',
    '| Variable canonique | Décision | Destination | Références littérales observées |', '|---|---|---|---:|')
  for (const e of policy.entries) lines.push(`| \`${e.name}\` | ${e.action} | ${e.destination} | ${result.references.get(e.name)?.size || 0} |`)
  lines.push('', 'Les recherches littérales ne prouvent pas l’absence d’un consommateur dynamique et peuvent relever des commentaires/tests. Le manifeste conserve les consommateurs déclarés ; cette matrice complète la garde `check:env-consistency`, elle ne la remplace pas.', '')
  return lines.join('\n')
}
module.exports = { audit, render }
if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  const result = audit(root)
  fs.writeFileSync(path.join(root, 'docs/CONFIG_REPOSITORY_AUDIT.md'), render(result))
  console.log(`Inventaire : ${result.files} fichiers ; ${result.policy.entries.length} variables avec décision explicite. Rapport : docs/CONFIG_REPOSITORY_AUDIT.md`)
}
