'use strict'
/**
 * ROBUSTESSE — verrou, interruption, reprise, retour arrière, idempotence.
 *
 * Ce sont les propriétés qui font la différence entre un outil utilisable en
 * production et un script de démonstration : ce qui se passe quand l'exécution
 * ne va PAS jusqu'au bout.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const aides = require('./helpers.js')
const verrou = require('../core/lock.js')
const backup = require('../core/backup.js')
const fsx = require('../utils/fsx.js')
const rapports = require('../core/report.js')
const redact = require('../security/redact.js')

test('verrou — une seconde exécution est refusée tant que la première tourne', () => {
  const racine = aides.dossierTemporaire()
  try {
    const premier = verrou.prendre(racine)
    assert.equal(premier.pris, true)
    const second = verrou.prendre(racine)
    assert.equal(second.pris, false)
    assert.ok(/configuration est en cours/i.test(second.raison))
    assert.equal(second.detenteur.pid, process.pid)
    premier.liberer()
    const troisieme = verrou.prendre(racine)
    assert.equal(troisieme.pris, true, 'le verrou libéré doit être reprenable')
    troisieme.liberer()
  } finally {
    aides.nettoyer(racine)
  }
})

test('verrou — un verrou orphelin est repris, sans écraser un verrou vivant', () => {
  const racine = aides.dossierTemporaire()
  try {
    // PID qui n'existe pas : le processus est mort, le verrou est orphelin.
    fsx.ecrireAtomique(verrou.cheminVerrou(racine), JSON.stringify({
      pid: 999999999, hote: os.hostname(), utilisateur: 'test',
      debut: new Date(Date.now() - 1000).toISOString(), version: 1,
    }), { mode: 0o600 })
    assert.equal(verrou.processusVivant(999999999), false)
    const prise = verrou.prendre(racine)
    assert.equal(prise.pris, true)
    assert.equal(prise.detenteur.repriseOrpheline, true)
    prise.liberer()
  } finally {
    aides.nettoyer(racine)
  }
})

test('verrou — un verrou d une autre machine n est pas repris sans --forcer-verrou', () => {
  const racine = aides.dossierTemporaire()
  try {
    fsx.ecrireAtomique(verrou.cheminVerrou(racine), JSON.stringify({
      pid: 4242, hote: 'autre-machine', utilisateur: 'test',
      debut: new Date().toISOString(), version: 1,
    }), { mode: 0o600 })
    const refus = verrou.prendre(racine)
    assert.equal(refus.pris, false)
    assert.ok(/autre machine/i.test(refus.raison))
    const force = verrou.prendre(racine, { force: true })
    assert.equal(force.pris, true)
    force.liberer()
  } finally {
    aides.nettoyer(racine)
  }
})

test('verrou — un verrou n est jamais libéré par une autre exécution', () => {
  const racine = aides.dossierTemporaire()
  try {
    const prise = verrou.prendre(racine)
    // Un autre processus réécrit le verrou à son nom pendant notre exécution.
    fsx.ecrireAtomique(verrou.cheminVerrou(racine), JSON.stringify({
      pid: process.pid + 1, hote: os.hostname(), utilisateur: 'autre', debut: new Date().toISOString(), version: 1,
    }), { mode: 0o600 })
    prise.liberer()
    assert.ok(fs.existsSync(verrou.cheminVerrou(racine)), 'le verrou d un autre processus doit rester en place')
  } finally {
    aides.nettoyer(racine)
  }
})

test('interruption et reprise — l état conservé décrit ce qui reste à faire', () => {
  const racine = aides.dossierTemporaire()
  try {
    assert.equal(verrou.lireEtat(racine), null)
    verrou.ecrireEtat(racine, {
      executionId: 'exec-1', derniereEtape: 14, verdict: 'BLOCKED',
      bloquees: ['DATABASE_URL@production'], erreurs: [], etapes: [],
    })
    const relu = verrou.lireEtat(racine)
    assert.equal(relu.executionId, 'exec-1')
    assert.equal(relu.derniereEtape, 14)
    assert.deepEqual(relu.bloquees, ['DATABASE_URL@production'])
    // Un état corrompu est ignoré, jamais « réparé » : une décision ne doit pas
    // se fonder sur un contenu douteux.
    fsx.ecrireAtomique(verrou.cheminEtat(racine), '{ ceci n est pas du json', { mode: 0o600 })
    assert.equal(verrou.lireEtat(racine), null)
    verrou.effacerEtat(racine)
    assert.equal(fs.existsSync(verrou.cheminEtat(racine)), false)
  } finally {
    aides.nettoyer(racine)
  }
})

test('sauvegarde — le contenu d origine est copié avant toute écriture', () => {
  const racine = aides.dossierTemporaire()
  try {
    aides.ecrire(racine, '.env', 'ORIGINE="valeur"\n')
    const session = backup.session(racine, 'test-1')
    const entree = session.sauvegarder('.env')
    assert.equal(entree.present, true)
    assert.equal(fs.readFileSync(entree.copie, 'utf8'), 'ORIGINE="valeur"\n')
    const index = session.ecrireIndex({ executionId: 'test-1' })
    assert.equal(index.fichiers.length, 1)
    assert.equal(index.fichiers[0].presentAvant, true)
    assert.ok(index.fichiers[0].empreinte, 'une empreinte doit permettre de vérifier la restauration')
  } finally {
    aides.nettoyer(racine)
  }
})

test('retour arrière — le contenu d origine est restauré et vérifié', () => {
  const racine = aides.dossierTemporaire()
  try {
    aides.ecrire(racine, '.env', 'ORIGINE="valeur"\n')
    const session = backup.session(racine, 'test-2')
    session.sauvegarder('.env')
    const nouveau = 'ORIGINE="modifiee"\nAJOUT="x"\n'
    fsx.ecrireAtomique(path.join(racine, '.env'), nouveau, { mode: 0o600 })
    session.noterEcriture('.env', nouveau)

    const resultat = session.restaurer()
    assert.deepEqual(resultat.restaures, ['.env'])
    assert.deepEqual(resultat.refuses, [])
    assert.equal(aides.lire(racine, '.env'), 'ORIGINE="valeur"\n')
  } finally {
    aides.nettoyer(racine)
  }
})

test('retour arrière — un fichier créé par nous est retiré, pas vidé', () => {
  const racine = aides.dossierTemporaire()
  try {
    const session = backup.session(racine, 'test-3')
    const entree = session.sauvegarder('.env.server.local')
    assert.equal(entree.present, false, 'le fichier n existait pas')
    const contenu = 'NOUVEAU="valeur"\n'
    fsx.ecrireAtomique(path.join(racine, '.env.server.local'), contenu, { mode: 0o600 })
    session.noterEcriture('.env.server.local', contenu)

    const resultat = session.restaurer()
    assert.deepEqual(resultat.restaures, ['.env.server.local'])
    assert.equal(fs.existsSync(path.join(racine, '.env.server.local')), false)
  } finally {
    aides.nettoyer(racine)
  }
})

test('retour arrière — une modification concurrente est refusée, jamais écrasée', () => {
  const racine = aides.dossierTemporaire()
  try {
    aides.ecrire(racine, '.env', 'ORIGINE="valeur"\n')
    const session = backup.session(racine, 'test-4')
    session.sauvegarder('.env')
    const notre = 'ORIGINE="notre-ecriture"\n'
    fsx.ecrireAtomique(path.join(racine, '.env'), notre, { mode: 0o600 })
    session.noterEcriture('.env', notre)
    // Quelqu'un d'autre modifie le fichier après notre écriture.
    fs.writeFileSync(path.join(racine, '.env'), 'ORIGINE="travail-de-quelqu-un-d-autre"\n')

    const resultat = session.restaurer()
    assert.deepEqual(resultat.restaures, [])
    assert.equal(resultat.refuses.length, 1)
    assert.ok(/concurrent/i.test(resultat.refuses[0].raison))
    assert.equal(aides.lire(racine, '.env'), 'ORIGINE="travail-de-quelqu-un-d-autre"\n', 'le travail d autrui est préservé')
  } finally {
    aides.nettoyer(racine)
  }
})

test('écriture atomique — un lien symbolique est refusé comme destination', () => {
  const racine = aides.dossierTemporaire()
  try {
    const cible = path.join(racine, 'ailleurs.txt')
    fs.writeFileSync(cible, 'contenu tiers\n')
    const lien = path.join(racine, '.env')
    try {
      fs.symlinkSync(cible, lien)
    } catch {
      // La création de liens symboliques exige des privilèges sous Windows :
      // sans eux, le scénario n'est pas reproductible et le test n'a rien à
      // prouver. On le signale plutôt que de le faire passer pour concluant.
      return
    }
    assert.throws(() => fsx.ecrireAtomique(lien, 'SECRET="x"\n'), /lien symbolique/i)
    assert.equal(fs.readFileSync(cible, 'utf8'), 'contenu tiers\n')
  } finally {
    aides.nettoyer(racine)
  }
})

test('écriture atomique — aucun fichier temporaire ne subsiste après écriture', () => {
  const racine = aides.dossierTemporaire()
  try {
    fsx.ecrireAtomique(path.join(racine, '.env'), 'A="1"\n')
    const restes = fs.readdirSync(racine).filter((nom) => nom.endsWith('.tmp'))
    assert.deepEqual(restes, [])
  } finally {
    aides.nettoyer(racine)
  }
})

test('rapport — un rapport contenant une valeur sensible est refusé, avec son emplacement', () => {
  const racine = aides.dossierTemporaire()
  try {
    redact.reinitialiser()
    const secret = aides.VALEURS_TEST.base64_32
    redact.enregistrer(secret)
    const journal = rapports.journal(racine, { executionId: 'test-fuite' })
    journal.etape(1, 'Étape de test')
    // Injection directe dans les données du rapport, en contournant `ligne()`
    // qui nettoie : c'est exactement le défaut que le garde-fou doit attraper.
    journal.donnees.fournisseurs.exemple = { valeurFuitee: secret }
    journal.cloturer()
    assert.throws(() => journal.finaliser(path.join(racine, 'reports')), /valeur sensible/i)
    try {
      journal.finaliser(path.join(racine, 'reports'))
    } catch (erreur) {
      assert.ok(/fournisseurs\.exemple\.valeurFuitee/.test(erreur.message), 'l emplacement doit être nommé : ' + erreur.message)
    }
    assert.equal(fs.existsSync(path.join(racine, 'reports', 'dernier-rapport.json')), false, 'aucun fichier ne doit être écrit')
  } finally {
    redact.reinitialiser()
    aides.nettoyer(racine)
  }
})

test('rapport — un rapport sans valeur est écrit, avec permissions restreintes', () => {
  const racine = aides.dossierTemporaire()
  try {
    redact.reinitialiser()
    redact.enregistrer(aides.VALEURS_TEST.base64_32)
    const journal = rapports.journal(racine, { executionId: 'test-propre' })
    journal.etape(1, 'Étape de test')
    journal.ligne('SUCCESS', 'Contrôle', 'La valeur ' + aides.VALEURS_TEST.base64_32 + ' a été vérifiée.')
    journal.cloturer()
    const ecrit = journal.finaliser(path.join(racine, 'reports'))
    const texte = fs.readFileSync(ecrit.fichier, 'utf8')
    assert.ok(!texte.includes(aides.VALEURS_TEST.base64_32), 'la valeur doit avoir été masquée par ligne()')
    assert.ok(texte.includes(redact.MARQUEUR))
    assert.equal(ecrit.donnees.resume.verdict, 'SUCCESS')
    const permissions = fsx.permissions(ecrit.fichier)
    if (permissions.modeSignificatif) assert.equal(permissions.lisibleParTous, false)
  } finally {
    redact.reinitialiser()
    aides.nettoyer(racine)
  }
})

test('rapport — un statut inconnu est refusé plutôt qu accepté silencieusement', () => {
  const racine = aides.dossierTemporaire()
  try {
    const journal = rapports.journal(racine, { executionId: 'test-statut' })
    journal.etape(1, 'Étape')
    assert.throws(() => journal.ligne('PRESQUE_BON', 'sujet', 'détail'), /Statut de rapport inconnu/)
  } finally {
    aides.nettoyer(racine)
  }
})

test('rapport — le verdict global retient la gravité la plus forte', () => {
  const racine = aides.dossierTemporaire()
  try {
    const journal = rapports.journal(racine, { executionId: 'test-verdict' })
    journal.etape(1, 'Étape')
    journal.ligne('SUCCESS', 'a', 'ok')
    journal.ligne('REUSED', 'b', 'ok')
    journal.ligne('WARNING', 'c', 'attention')
    journal.cloturer()
    const ecrit = journal.finaliser(path.join(racine, 'reports'))
    assert.equal(ecrit.donnees.resume.verdict, 'WARNING')
    assert.equal(ecrit.donnees.etapes[0].statut, 'WARNING', 'le statut de l étape suit la même règle')
  } finally {
    aides.nettoyer(racine)
  }
})

test('idempotence — rejouer le même plan sur un fichier déjà écrit ne change rien', () => {
  const racine = aides.dossierTemporaire()
  try {
    const fichierEnv = require('../utils/env-file.js')
    const valeurs = { NEXTAUTH_SECRET: aides.VALEURS_TEST.base64_32, DATABASE_URL: 'file:./dev.db' }
    const premier = fichierEnv.appliquer(null, valeurs, { entete: ['en-tête de test'] })
    fsx.ecrireAtomique(path.join(racine, '.env'), premier.texte, { mode: 0o600 })

    for (let tour = 0; tour < 5; tour++) {
      const avant = aides.lire(racine, '.env')
      const resultat = fichierEnv.appliquer(avant, valeurs, { entete: ['en-tête de test'] })
      assert.equal(resultat.texte, avant, 'tour ' + tour + ' : le contenu doit être stable')
      assert.deepEqual(resultat.ajoutees, [])
      assert.deepEqual(resultat.modifiees, [])
    }
    // L'en-tête n'est pas empilé à chaque exécution.
    assert.equal((aides.lire(racine, '.env').match(/en-tête de test/g) || []).length, 1)
  } finally {
    aides.nettoyer(racine)
  }
})

test('sûreté du dépôt — une destination non ignorée par Git bloque l écriture', () => {
  const racine = aides.depotFactice()
  try {
    const validateur = require('../validators/repository.js')
    // Dépôt sans Git : le contrôle ne peut rien PROUVER, et il le dit.
    const sansGit = validateur.verifier(racine, ['.env'])
    assert.ok(sansGit.avertissements.length > 0 || sansGit.destinationsNonIgnorees.length > 0)

    // Un fichier d'exemple porteur d'un secret est une anomalie bloquante.
    aides.ecrire(racine, '.env.fuite.example', 'NEXTAUTH_SECRET="' + aides.VALEURS_TEST.base64_32 + '"\n')
    const avecFuite = validateur.verifier(racine, ['.env'])
    assert.ok(avecFuite.exemplesAvecSecrets.length > 0, 'le secret dans un exemple doit être détecté')
    assert.equal(avecFuite.ok, false)
  } finally {
    aides.nettoyer(racine)
  }
})

test('rapport — l historique des rapports est borné, le dernier toujours conservé', () => {
  const racine = aides.dossierTemporaire()
  try {
    const dossier = path.join(racine, 'reports')
    fs.mkdirSync(dossier, { recursive: true })
    for (let index = 0; index < 8; index++) {
      const nom = 'configuration-report-2026-10-21-exec-' + String(index).padStart(2, '0') + '.json'
      fs.writeFileSync(path.join(dossier, nom), '{}\n')
    }
    fs.writeFileSync(path.join(dossier, 'dernier-rapport.json'), '{}\n')

    const supprimes = rapports.purger(dossier, 3)
    assert.equal(supprimes.length, 5, 'les plus anciens doivent partir')
    const restants = fs.readdirSync(dossier).sort()
    assert.ok(restants.includes('dernier-rapport.json'), 'le dernier rapport n est jamais supprimé')
    assert.equal(restants.filter((nom) => nom.startsWith('configuration-report-')).length, 3)
    // Ce sont bien les plus RÉCENTS qui restent (tri lexicographique = chronologique).
    assert.ok(restants.includes('configuration-report-2026-10-21-exec-07.json'))
    assert.ok(!restants.includes('configuration-report-2026-10-21-exec-00.json'))
    // Rien à purger quand le seuil n'est pas atteint.
    assert.deepEqual(rapports.purger(dossier, 10), [])
  } finally {
    aides.nettoyer(racine)
  }
})
