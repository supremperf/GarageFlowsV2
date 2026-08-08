#!/usr/bin/env node
/**
 * Garde de cohérence — clé publique de licence.
 *
 * POURQUOI CE CONTRÔLE EXISTE
 * La clé publique ECC P-256 qui vérifie les licences est présente à DEUX endroits :
 *   1. codée en dur dans electron/main.js (`_PK`) — c'est elle qu'utilise le binaire ;
 *   2. dans keys/public.pem — c'est la clé dont keys/private.pem signe les licences.
 * Rien ne les relie à l'exécution. Quand elles divergent, `verify()` renvoie
 * simplement `false` : la licence, pourtant parfaitement valide et non expirée,
 * est refusée sans message. L'application affiche la fenêtre d'activation, la
 * ré-activation part vers le serveur, et si le quota d'appareils est atteint le
 * serveur refuse — l'utilisateur est verrouillé hors de son propre logiciel.
 *
 * Ce cas s'est réellement produit : le dépôt portait la clé d'un keygen antérieur
 * alors que les licences émises l'étaient par celle de keys/public.pem.
 *
 * keys/public.pem est gitignoré (les clés ne sont pas versionnées). Le contrôle
 * est donc CONDITIONNEL : sans le fichier, il ne peut rien comparer et le dit —
 * il ne prétend jamais avoir validé quoi que ce soit (règle « pas de fausse
 * validation »). Sur la machine qui construit les binaires distribués, le
 * fichier est présent et le contrôle mord.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createPublicKey, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = path.join(ROOT, 'electron', 'main.js')
const PEM = path.join(ROOT, 'keys', 'public.pem')

/** Empreinte canonique : SHA-256 du DER SPKI — insensible aux fins de ligne et à l'habillage PEM. */
function fingerprint(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

function fail(msg) {
  console.error(`\n❌ check:public-key — ${msg}\n`)
  process.exit(1)
}

const source = readFileSync(MAIN, 'utf8')

// Extraction du littéral `const _PK = [ … ]` puis des chaînes qu'il contient.
const block = source.match(/const\s+_PK\s*=\s*\[([\s\S]*?)\]/)
if (!block) fail(`littéral \`const _PK = [...]\` introuvable dans electron/main.js — ` +
  `la clé publique embarquée a changé de forme : METTEZ CE CONTRÔLE À JOUR, ne le supprimez pas.`)

const embeddedPem = [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n')
if (!embeddedPem.includes('BEGIN PUBLIC KEY')) fail('le littéral _PK ne contient pas de bloc PEM lisible.')

if (embeddedPem.includes('REPLACE_WITH_YOUR_PUBLIC_KEY')) {
  fail('electron/main.js contient ENCORE la clé publique de remplacement.\n' +
    '   Générez la vôtre : python scripts/keygen.py --init')
}

let embeddedFp
try { embeddedFp = fingerprint(embeddedPem) } catch (e) {
  fail(`la clé publique embarquée dans electron/main.js n'est pas une clé valide : ${e.message}`)
}

if (!existsSync(PEM)) {
  console.log('⏭️  check:public-key — NON EXÉCUTÉ : keys/public.pem absent (gitignoré).')
  console.log(`   Clé embarquée valide, empreinte ${embeddedFp.slice(0, 16)}… — mais AUCUNE`)
  console.log('   comparaison n\'a eu lieu. Sur la machine de build, placez keys/public.pem')
  console.log('   pour que la correspondance soit réellement vérifiée.')
  process.exit(0)
}

let pemFp
try { pemFp = fingerprint(readFileSync(PEM, 'utf8')) } catch (e) {
  fail(`keys/public.pem illisible ou invalide : ${e.message}`)
}

if (embeddedFp !== pemFp) {
  fail(
    'DIVERGENCE DE CLÉ PUBLIQUE — les binaires construits ici REFUSERONT toutes les licences.\n' +
    `   electron/main.js (_PK) : ${embeddedFp}\n` +
    `   keys/public.pem        : ${pemFp}\n\n` +
    '   La signature échouera silencieusement (verify → false) et l\'application\n' +
    '   redemandera une activation que le serveur peut refuser (quota d\'appareils).\n' +
    '   Recopiez les lignes de keys/public.pem dans le littéral _PK de electron/main.js.'
  )
}

console.log(`✅ check:public-key — clé embarquée et keys/public.pem identiques (${embeddedFp.slice(0, 16)}…)`)
