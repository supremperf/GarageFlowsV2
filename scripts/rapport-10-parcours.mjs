#!/usr/bin/env node
/**
 * rapport-10-parcours.mjs — preuve EXÉCUTÉE des dix parcours métier exigés.
 *
 * Ce script ne déclare pas que les parcours fonctionnent : il lance réellement
 * les fichiers de test qui les couvrent et agrège le résultat par parcours.
 *
 * ─── Ce qu'il mesure, et ce qu'il ne mesure pas ─────────────────────────────
 * · Il n'exécute QUE des tests qui ne réclament pas de base de données. Les
 *   suites d'intégration (`src/integration/*`, sync) construisent une base
 *   SQLite via `prisma db push` : elles sortent du périmètre de CE rapport et
 *   sont listées comme NON EXÉCUTÉES ICI, avec leur nombre, jamais comptées
 *   comme vertes. Leur exécution réelle relève de la suite Vitest complète
 *   (`npm test`), qui a besoin du moteur Prisma natif.
 * · Un fichier peut illustrer plusieurs parcours : son résultat est alors
 *   compté dans chacun (le total global reste celui du run unique).
 * · Le fichier `license-devices-unit.test.ts` est lancé À PART. Historiquement,
 *   sans moteur Prisma natif, il passait ses assertions mais laissait échapper
 *   une `PrismaClientInitializationError` à l'arrêt. Les deux issues sont
 *   acceptées — arrêt PROPRE (moteur présent) ou erreur d'environnement — et
 *   distinguées dans le rapport. Seul un ÉCHEC D'ASSERTION fait échouer le
 *   rapport : exiger la présence de l'erreur revenait à exiger un
 *   environnement cassé, et faisait échouer le rapport dès sa réparation.
 *
 * Sortie : artifacts/verification/parcours-metier-10.json
 * Usage  : node scripts/rapport-10-parcours.mjs [--json-only]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = path.join(ROOT, 'artifacts/verification/parcours-metier-10.json')

const f = (rel) => path.join(ROOT, rel)

/**
 * Un parcours = des tests exécutables + les suites d'intégration qui le
 * couvrent mais qui ne peuvent pas tourner sans moteur Prisma.
 */
const PARCOURS = [
  {
    id: 'client',
    titre: 'Client — fiche, rattachement, accès portail',
    fichiers: [
      'src/lib/__tests__/client-policy.test.ts',
      'src/lib/__tests__/portail-client-parcours.test.ts',
      'src/lib/__tests__/safe-redirect.test.ts',
      'src/lib/portal/__tests__/auth-core.test.ts',
      'src/lib/portal/__tests__/session.test.ts',
      'src/lib/portal/__tests__/garage-slug.test.ts',
    ],
    suitesBase: [
      'src/integration/client-email-garage-portail.test.ts',
      'src/integration/intervention-rattache-client-vehicule.test.ts',
      'src/integration/portal-access-lifecycle.test.ts',
    ],
  },
  {
    id: 'vehicule',
    titre: 'Véhicule — VIN, immatriculation, contrôle technique',
    fichiers: [
      'src/lib/vin/__tests__/vin.test.ts',
      'src/lib/__tests__/plate-format.test.ts',
      'src/lib/__tests__/migrations-vehicle-ctdate.test.ts',
      'src/lib/__tests__/business-logic.test.ts',
    ],
    suitesBase: ['src/integration/intervention-rattache-client-vehicule.test.ts'],
  },
  {
    id: 'devis',
    titre: 'Devis — totaux, numérotation, conversion en facture',
    fichiers: [
      'src/lib/__tests__/business-logic.test.ts',
      'src/lib/__tests__/document-numbering.test.ts',
      'src/lib/__tests__/document-status.test.ts',
      'src/lib/quote-gen/__tests__/quote-gen.test.ts',
      'src/lib/__tests__/money-document-consistency.test.ts',
      'src/lib/__tests__/tva.test.ts',
    ],
    suitesBase: [
      'src/integration/quotes-generate.test.ts',
      'src/app/api/sync/__tests__/quote-publication.test.ts',
      'src/integration/quote-acceptance-proof.test.ts',
    ],
  },
  {
    id: 'intervention',
    titre: 'Intervention (OR) — main-d’œuvre, pièces, pointage',
    fichiers: [
      'src/lib/stock/__tests__/invoice-stock-entrelacement.test.ts',
      'src/lib/__tests__/taux-horaire-main-doeuvre.test.ts',
      'src/lib/__tests__/pieces-intervention-atteignables.test.ts',
      'src/lib/__tests__/inspection-autosave.test.ts',
      'src/app/api/mechanic/__tests__/timer-route.test.ts',
      'src/app/api/mechanic/__tests__/timer-pause-resume.test.ts',
    ],
    suitesBase: [
      'src/integration/intervention-rattache-client-vehicule.test.ts',
      'src/integration/business-workflow-e2e.test.ts',
      'src/integration/scenario-maitre.test.ts',
    ],
  },
  {
    id: 'facture',
    titre: 'Facture — calculs, immutabilité, PDF, export FEC',
    fichiers: [
      'src/lib/__tests__/billing-view.test.ts',
      'src/lib/__tests__/billing-api-projection.test.ts',
      'src/lib/__tests__/money-document-consistency.test.ts',
      'src/app/api/__tests__/document-immutability.test.ts',
      'src/app/api/__tests__/fec-export.test.ts',
      'src/lib/pdf/__tests__/pdf-print-quality.test.ts',
      'src/lib/pdf/__tests__/poids-pdf.test.ts',
      'src/lib/pdf/__tests__/print-html-escaping.test.ts',
    ],
    suitesBase: [
      'src/integration/invoice-document-integrity-p3.test.ts',
      'src/integration/invoice-stock-sync.test.ts',
      'src/app/api/sync/__tests__/invoice-publication.test.ts',
    ],
  },
  {
    id: 'facturation-electronique',
    titre: 'Facturation électronique — validation, format, envoi, rejeu',
    fichiers: [
      'src/lib/einvoicing/__tests__/einvoicing-foundation.test.ts',
      'src/lib/einvoicing/__tests__/catalog-provenance.test.ts',
      'src/lib/einvoicing/__tests__/formats.test.ts',
      'src/lib/einvoicing/__tests__/generic-pa-adapter.test.ts',
      'src/lib/einvoicing/__tests__/ssrf-guard.test.ts',
      'src/lib/einvoicing/__tests__/ssrf-guard-dns.test.ts',
      'src/lib/einvoicing/__tests__/dns-deadline.test.ts',
      'src/lib/einvoicing/__tests__/submit-chain.test.ts',
      'src/lib/einvoicing/__tests__/submit-replay.test.ts',
      'src/lib/einvoicing/__tests__/bridge-response-contract.test.ts',
      'src/lib/__tests__/einvoicing-platforms-contract.test.ts',
      'src/lib/einvoicing/__tests__/webhook-signature.test.ts',
      'src/lib/einvoicing/__tests__/webhook-route.test.ts',
      'src/lib/einvoicing/__tests__/queue.test.ts',
    ],
    suitesBase: [
      'src/lib/einvoicing/__tests__/desktop-bridge.test.ts',
      'src/app/api/sync/__tests__/einvoicing-tunnel.test.ts',
    ],
  },
  {
    id: 'licence',
    titre: 'Licence — signature, HWID, activation, révocation',
    fichiers: [
      'src/lib/license/__tests__/license-keygen-e2e.test.ts',
      'src/lib/license/__tests__/forgery-resistance.test.ts',
      'src/lib/license/__tests__/hwid-v1.test.ts',
      'src/lib/license/__tests__/issuer-key.test.ts',
      'src/lib/license/__tests__/keygen-api-contract.test.ts',
      'src/lib/license/__tests__/license-crosslang-format.test.ts',
      'src/lib/license/__tests__/public-key-consistency.test.ts',
      'src/lib/license/__tests__/state-machine.test.ts',
      'src/lib/__tests__/keygen-activation-roundtrip.test.ts',
      'src/lib/__tests__/licence-emission-bornee.test.ts',
      'src/lib/__tests__/licence-changement-contrat.test.ts',
      'src/lib/__tests__/license-admin-state-machine.test.ts',
      'src/lib/__tests__/hwid-verify.test.ts',
      'src/lib/__tests__/verify.test.ts',
    ],
    suitesBase: [
      'src/lib/__tests__/license-devices.postgres.int.test.ts',
      'src/lib/__tests__/licensed-session.postgres.int.test.ts',
    ],
    horsRun: [
      {
        fichier: 'src/lib/__tests__/license-devices-unit.test.ts',
        motif: 'lancé seul : arrêt propre si le moteur Prisma natif est présent, sinon rejet Prisma non capturé',
      },
    ],
    complement: 'node scripts/campagne-100-licences.mjs (campagne 100 licences)',
  },
  {
    id: 'abonnement',
    titre: 'Abonnement / droits — aucun module de paiement récurrent dans ce dépôt',
    fichiers: [
      'src/lib/__tests__/control-plane.test.ts',
      'src/lib/__tests__/licence-changement-contrat.test.ts',
    ],
    suitesBase: [],
    constat:
      'Aucune dépendance Stripe, aucun modèle d’abonnement, aucune route de paiement récurrent. ' +
      'Le seul droit payant modélisé est la LICENCE (module « licence »). ' +
      'Ce parcours n’est donc pas simulé : il n’existe pas dans le produit à cette révision.',
  },
  {
    id: 'sauvegarde',
    titre: 'Sauvegarde / restauration — chiffrement, snapshot, scripts',
    fichiers: [
      'src/lib/backup/__tests__/crypto.test.ts',
      'src/lib/backup/__tests__/snapshot.test.ts',
      'src/lib/__tests__/restore-script.test.ts',
      'src/lib/__tests__/pre-migration-backup.test.ts',
      'src/lib/__tests__/sauvegarde-en-souffrance.test.ts',
      'src/lib/__tests__/packaging-sans-sauvegarde.test.ts',
    ],
    suitesBase: [
      'src/lib/backup/__tests__/restore-roundtrip.test.ts',
      'src/app/api/internal/__tests__/backup-coherent.test.ts',
    ],
  },
  {
    id: 'installation-windows',
    titre: 'Installation Windows — installateur, raccourcis, mises à jour, fuses',
    fichiers: [
      'src/lib/__tests__/poste-windows.test.ts',
      'src/lib/__tests__/installer-shortcuts.test.ts',
      'src/lib/__tests__/release-signing-chain.test.ts',
      'src/lib/__tests__/signature-release-coherence.test.ts',
      'src/lib/__tests__/update-verify.test.ts',
      'src/lib/__tests__/electron-fuses.test.ts',
      'src/lib/__tests__/electron-integrity.test.ts',
      'src/lib/__tests__/electron-startup-gate.test.ts',
      'src/lib/__tests__/electron-nav-guard.test.ts',
      'src/lib/__tests__/electron-loopback.test.ts',
      'src/lib/__tests__/electron-secret.test.ts',
      'src/components/__tests__/update-sources-installable.test.ts',
      'src/__tests__/toolchain-versions.test.ts',
    ],
    suitesBase: [],
    complement: 'npm run test:release-safety (contrats installateur / livraison, 155 tests)',
  },
]

/** Un fichier n'est admissible au run que s'il n'exige pas de base réelle. */
function estDbDependant(rel) {
  const texte = fs.readFileSync(f(rel), 'utf8')
  return /prepareTestDb|prepare-test-db/.test(texte)
}

const union = [...new Set(PARCOURS.flatMap((p) => p.fichiers))]
const manquants = union.filter((rel) => !fs.existsSync(f(rel)))
if (manquants.length) {
  console.error('Fichiers de test introuvables :\n' + manquants.map((m) => ' - ' + m).join('\n'))
  process.exit(1)
}
const dbDansRun = union.filter(estDbDependant)
if (dbDansRun.length) {
  console.error('Refus : des fichiers du run exigent une base réelle :\n' + dbDansRun.map((m) => ' - ' + m).join('\n'))
  process.exit(1)
}

const tmpJson = path.join(os.tmpdir(), `gf-parcours-${process.pid}.json`)
const args = [
  'node_modules/vitest/vitest.mjs', 'run', ...union,
  '--reporter=json', `--outputFile=${tmpJson}`,
]
const started = Date.now()
const run = spawnSync(process.execPath, args, {
  cwd: ROOT, encoding: 'utf8', timeout: 30 * 60_000,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const dureeMs = Date.now() - started

if (!fs.existsSync(tmpJson)) {
  console.error('Vitest n’a produit aucun rapport JSON.\n' + (run.stdout || '').slice(-4000) + '\n' + (run.stderr || '').slice(-4000))
  process.exit(1)
}
const rapportVitest = JSON.parse(fs.readFileSync(tmpJson, 'utf8'))
fs.rmSync(tmpJson, { force: true })

const parFichier = new Map()
for (const fichier of rapportVitest.testResults ?? []) {
  const rel = path.relative(ROOT, fichier.name).split(path.sep).join('/')
  const assertions = fichier.assertionResults ?? []
  parFichier.set(rel, {
    fichiers: 1,
    tests: assertions.length,
    passes: assertions.filter((a) => a.status === 'passed').length,
    echoues: assertions.filter((a) => a.status === 'failed').length,
    ignores: assertions.filter((a) => a.status === 'skipped' || a.status === 'pending' || a.status === 'todo').length,
    dureeMs: Math.max(0, (fichier.endTime ?? 0) - (fichier.startTime ?? 0)),
  })
}

/** Lancé seul : ses assertions doivent passer ; l'arrêt peut être propre ou laisser échapper une erreur Prisma. */
const horsRun = []
for (const parcours of PARCOURS) {
  for (const cas of parcours.horsRun ?? []) {
    const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', cas.fichier], {
      cwd: ROOT, encoding: 'utf8', timeout: 5 * 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const sortie = `${r.stdout || ''}\n${r.stderr || ''}`.replace(/\u001b\[[0-9;]*m/g, '')
    const mPasses = sortie.match(/Tests\s+(\d+) passed/)
    const mEchoues = sortie.match(/(\d+) failed/)
    const prismaEchappe = /PrismaClientInitializationError/.test(sortie)
    // Ce qui est EXIGÉ : des assertions vertes et aucun échec. L'erreur Prisma
    // à l'arrêt est un SYMPTÔME d'environnement, pas un critère de réussite —
    // elle est enregistrée quand elle survient, jamais réclamée.
    const ok = Boolean(mPasses) && !mEchoues
    horsRun.push({
      parcours: parcours.id,
      fichier: cas.fichier,
      assertionsPasses: mPasses ? Number(mPasses[1]) : 0,
      assertionsEchouees: mEchoues ? Number(mEchoues[1]) : null,
      codeSortie: r.status,
      erreurEnvironnementale: prismaEchappe ? 'PrismaClientInitializationError (moteur natif absent)' : null,
      verdict: !ok ? 'A_CONTROLER' : (prismaEchappe ? 'ASSERTIONS_VERTES_ERREUR_ENV' : 'ASSERTIONS_VERTES_ARRET_PROPRE'),
    })
    if (!ok) {
      console.error(`✗ ${cas.fichier} : sortie inattendue\n${sortie.slice(-3000)}`)
      process.exitCode = 1
    }
  }
}

const resultats = PARCOURS.map((parcours) => {
  const cumul = { fichiers: 0, tests: 0, passes: 0, echoues: 0, ignores: 0, dureeMs: 0 }
  for (const rel of parcours.fichiers) {
    const r = parFichier.get(rel)
    if (!r) {
      cumul.echoues += 1
      continue
    }
    for (const k of Object.keys(cumul)) cumul[k] += r[k]
  }
  const suitesBase = parcours.suitesBase.map((rel) => ({
    fichier: rel,
    existe: fs.existsSync(f(rel)),
    dbDependante: fs.existsSync(f(rel)) ? estDbDependant(rel) : null,
  }))
  return {
    id: parcours.id,
    titre: parcours.titre,
    ...cumul,
    fichiersExecutes: parcours.fichiers.length,
    suitesBaseNonExecutees: suitesBase.filter((s) => s.existe).length,
    suitesBase,
    horsRun: horsRun.filter((h) => h.parcours === parcours.id),
    constat: parcours.constat ?? null,
    complement: parcours.complement ?? null,
    verdict: cumul.echoues === 0 && cumul.tests > 0 ? 'VERT_EXECUTE' : 'ECHEC_OU_VIDE',
  }
})

const total = {
  fichiers: union.length,
  tests: rapportVitest.numTotalTests ?? 0,
  passes: rapportVitest.numPassedTests ?? 0,
  echoues: rapportVitest.numFailedTests ?? 0,
  ignores: (rapportVitest.numPendingTests ?? 0) + (rapportVitest.numTodoTests ?? 0),
  dureeMs,
  codeSortieVitest: run.status,
}
const toutVert = total.echoues === 0 && resultats.every((r) => r.verdict === 'VERT_EXECUTE') && (process.exitCode ?? 0) === 0

const rapport = {
  generatedAt: new Date().toISOString(),
  environnement: {
    node: process.version,
    plateforme: `${process.platform}-${process.arch}`,
    vitest: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/vitest/package.json'), 'utf8')).version,
    moteurPrisma: 'indisponible (aucun binaire natif) — suites à base réelle NON exécutées',
  },
  methode:
    'Un seul run Vitest sur l’union des fichiers non dépendants d’une base ; ' +
    'agrégation par parcours. Les suites d’intégration à base réelle sont listées séparément et ne comptent pas comme vertes.',
  total,
  parcours: resultats,
  toutVert,
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(rapport, null, 2) + '\n')

if (!process.argv.includes('--json-only')) {
  console.log('Parcours métier — tests réellement exécutés\n')
  console.log('parcours'.padEnd(26), 'fich.', 'tests', 'ok', 'ko', 'base non exécutée')
  for (const r of resultats) {
    console.log(
      r.id.padEnd(26),
      String(r.fichiersExecutes).padStart(5),
      String(r.tests).padStart(5),
      String(r.passes).padStart(3),
      String(r.echoues).padStart(2),
      String(r.suitesBaseNonExecutees).padStart(3),
    )
  }
  console.log(`\nTotal du run : ${total.passes}/${total.tests} assertions, ${total.echoues} échec(s), ${total.fichiers} fichiers, ${(dureeMs / 1000).toFixed(1)} s`)
  console.log(`Rapport : ${path.relative(ROOT, OUT_FILE)}`)
  console.log(toutVert ? '\n✅ 10 parcours : assertions vertes (périmètre exécutable)' : '\n❌ Rapport en échec')
}
process.exitCode = toutVert ? 0 : 1
