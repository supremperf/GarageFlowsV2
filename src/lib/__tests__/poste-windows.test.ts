/**
 * LOT 7 — ce que le poste Windows faisait EN SILENCE.
 *
 * Les défauts corrigés ici ont un point commun : l'application continuait de
 * s'afficher normalement pendant que quelque chose d'essentiel ne se faisait
 * plus. Un garagiste n'a aucun moyen de deviner qu'un service interne est mort,
 * qu'aucune sauvegarde ne passe depuis trois semaines, ou que l'export du soir
 * n'a plus lieu depuis qu'il éteint son PC en partant.
 *
 * ─── Pourquoi des gardes sur le TEXTE de main.js ────────────────────────────
 * `electron/main.js` appelle les API Electron dès son chargement : il n'est pas
 * requérable dans Vitest, et l'exécution réelle du .exe packagé reste hors de
 * portée ici (voir docs/BLOCAGES_EXTERNES.md). La logique décidable a donc été
 * SORTIE dans des modules purs, testés pour de vrai à côté
 * (`sauvegarde-en-souffrance`, `echeance-export`, `update-verify`). Ce qui reste
 * ici est le CÂBLAGE : la preuve que ces modules sont branchés, et qu'un chemin
 * de panne aboutit à quelque chose de visible.
 *
 * Ces gardes expriment une INTENTION, jamais une orthographe : geler le texte
 * exact interdirait d'ajouter une protection.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const racine = (rel: string) => path.resolve(__dirname, '../../..', rel)
const MAIN = readFileSync(racine('electron/main.js'), 'utf8')
const NSH = readFileSync(racine('scripts/installer.nsh'), 'utf8')

/** Corps d'une fonction/gestionnaire repéré par une ancre, borné en lignes. */
function extrait(source: string, ancre: string, lignes = 60): string {
  const i = source.indexOf(ancre)
  expect(i, `ancre introuvable : ${ancre}`).toBeGreaterThan(-1)
  return source.slice(i).split('\n').slice(0, lignes).join('\n')
}

/**
 * Retire les lignes de commentaire avant de chercher du CODE.
 *
 * Ces fichiers expliquent longuement ce qui a été retiré et pourquoi — c'est
 * voulu, c'est ce qui empêche de le remettre. Mais une garde qui cherche
 * « ExecWait '$R0 » ou « getDiskSerial() » trouverait alors l'explication et
 * accuserait le commentaire de faire ce qu'il décrit.
 */
function sansCommentaires(source: string, marqueur: '//' | ';'): string {
  return source
    .split('\n')
    .filter((l) => !l.trimStart().startsWith(marqueur) && !l.trimStart().startsWith('*'))
    .join('\n')
}

describe('la mort du serveur interne ne passe plus inaperçue', () => {
  const sortie = extrait(MAIN, "nextServer.on('exit'", 60)

  it('une sortie non voulue ouvre une boîte de dialogue', () => {
    // Avant : `log(...)` puis `nextServer = null`. La fenêtre restait ouverte
    // sur une application qui ne répondait plus à aucune requête.
    expect(sortie, 'la panne n’était que journalisée').toMatch(/showMessageBox/)
  })

  it('la boîte propose de RELANCER, pas seulement de fermer', () => {
    expect(sortie).toMatch(/startNextServer\(\)/)
  })

  it('une fermeture VOULUE ne déclenche pas l’annonce de panne', () => {
    // Sans cette distinction, le message apparaîtrait à chaque fermeture
    // normale — et un avertissement qui survient quand tout va bien finit par
    // être ignoré quand tout va mal.
    expect(sortie).toMatch(/arretVoulu/)
  })

  it('chaque arrêt délibéré pose le drapeau avant de tuer le processus', () => {
    const tueries = Array.from(MAIN.matchAll(/nextServer\.kill\(\)/g))
    expect(tueries.length, 'au moins un arrêt délibéré doit exister').toBeGreaterThan(0)
    for (const t of tueries) {
      const avant = MAIN.slice(Math.max(0, (t.index ?? 0) - 400), t.index)
      expect(avant, 'un kill sans drapeau ferait crier la fermeture normale').toMatch(/arretVoulu\s*=\s*true/)
    }
  })
})

describe('le démarrage attend le vrai serveur avant de migrer', () => {
  const demarrage = extrait(MAIN, 'function startNextServer()', 150)

  it('une sonde en échec rejette le démarrage au lieu de continuer vers la migration', () => {
    const readiness = demarrage.slice(demarrage.lastIndexOf('waitForServer(35_000)')).split('\n').slice(0, 18).join('\n')
    expect(readiness).toMatch(/\.catch\(err\s*=>/)
    expect(readiness).toMatch(/reject\(err\)/)
    expect(readiness).not.toMatch(/resolve\(\)\s*\/\/ fail-open/)
  })

  it('en mode développement, attend aussi Next.js au lieu de supposer qu’il tourne', () => {
    expect(demarrage).toMatch(/Dev: waiting for the separately started Next\.js dev server/)
    expect(demarrage).toMatch(/waitForServer\(35_000\)[\s\S]*?\.catch\(reject\)/)
  })
})

describe('l’échec des sauvegardes est dit à quelqu’un', () => {
  it('le module de décision est branché', () => {
    expect(MAIN).toMatch(/require\(['"]\.\/sauvegarde-en-souffrance['"]\)/)
  })

  it('la boucle horaire passe par la fonction qui AVERTIT', () => {
    // `setInterval(runBackup, …)` jetait le `false` de retour : l'échec
    // n'existait que dans garageflow.log, un fichier que personne n'ouvre.
    const boucle = extrait(MAIN, 'backupTimer = setInterval', 6)
    expect(boucle).toMatch(/sauvegardePeriodique/)
  })

  it('l’avertissement aboutit à une boîte de dialogue', () => {
    expect(extrait(MAIN, 'async function signalerSauvegardesEnSouffrance', 45)).toMatch(/showMessageBox/)
  })
})

describe('l’export du soir ne dépend plus d’un compte à rebours', () => {
  const planif = extrait(MAIN, 'function scheduleDailyDesktopExport', 40)

  it('le module d’échéance est branché', () => {
    expect(MAIN).toMatch(/require\(['"]\.\/echeance-export['"]\)/)
  })

  it('la vérification est périodique, pas un unique délai de dix heures', () => {
    // Un `setTimeout` de dix heures suppose une machine allumée et éveillée :
    // deux suppositions fausses dans un garage.
    expect(planif).toMatch(/setInterval/)
    expect(planif).not.toMatch(/msUntil20h/)
  })

  it('seul un export RÉUSSI est mémorisé', () => {
    // Mémoriser un échec ferait sauter la journée entière.
    expect(planif).toMatch(/ok.*ecrireDernierExport|ecrireDernierExport/)
    expect(planif).toMatch(/r\s*&&\s*r\.ok/)
  })

  it('le minuteur est bien annulé comme un intervalle', () => {
    const arret = extrait(MAIN, 'app.on(\'window-all-closed\'', 20)
    expect(arret, 'clearTimeout sur un setInterval laisserait la boucle tourner').toMatch(
      /clearInterval\(desktopExportTimer\)/,
    )
  })
})

describe('les sondes matérielles ne gèlent plus le processus principal', () => {
  it('le numéro de série du disque n’est lu qu’une fois', () => {
    // `wmic diskdrive` : 63 ms mesurés, en synchrone, à chaque empreinte — et
    // l'empreinte est recalculée toutes les 2 minutes (20 s si l'accès est
    // bloqué). Au-delà du gel, une sonde qui hoquette CHANGE l'empreinte, donc
    // fait refuser la licence et rend le stockage chiffré illisible.
    const f = extrait(MAIN, 'function getDiskSerial', 8)
    expect(f).toMatch(/sondeDisque/)
  })

  it('l’identifiant machine n’est lu qu’une fois', () => {
    expect(extrait(MAIN, 'function getMachineId', 8)).toMatch(/sondeMachineId/)
  })

  it('les deux empreintes sont calculées une seule fois par exécution', () => {
    expect(extrait(MAIN, 'function getHwid()', 8)).toMatch(/empreinteV0/)
    expect(extrait(MAIN, 'function getHwidV1()', 8)).toMatch(/empreinteV1/)
  })

  it('la collecte V1 ne sonde plus le disque deux fois dans la même expression', () => {
    const c = sansCommentaires(extrait(MAIN, 'function collectHwidFieldsV1', 30), '//')
    expect(Array.from(c.matchAll(/getDiskSerial\(\)/g)).length).toBe(1)
  })
})

describe('le journal a une borne, et on ne le charge plus en entier', () => {
  it('une taille maximale est définie et la rotation existe', () => {
    expect(MAIN).toMatch(/LOG_MAX_OCTETS/)
    expect(MAIN).toMatch(/function faireTournerJournal/)
  })

  it('la rotation conserve la génération précédente', () => {
    // Basculer sans conserver reviendrait à effacer les traces de l'incident
    // qu'on cherche justement à comprendre.
    expect(extrait(MAIN, 'function faireTournerJournal', 12)).toMatch(/renameSync/)
  })

  it('le rapport d’incident ne lit que la QUEUE du journal', () => {
    // `readFileSync(LOG_PATH).slice(-4000)` chargeait des centaines de Mo pour
    // n'en garder que quatre kilo-octets — au moment précis où la mémoire est
    // déjà le problème.
    expect(MAIN).toMatch(/function lireQueueJournal/)
    expect(MAIN, 'la lecture intégrale du journal est revenue').not.toMatch(
      /readFileSync\(LOG_PATH[^)]*\)\s*\.slice/,
    )
  })
})

describe('un double-clic pendant le démarrage fait quelque chose', () => {
  const si = extrait(MAIN, "app.on('second-instance'", 30)

  it('le splash sert RÉELLEMENT de repli, pas seulement de variable examinée', () => {
    // Le démarrage attend le serveur Next : jusqu'à 35 s sur une machine lente.
    // Pendant ce temps, relancer l'application ne produisait STRICTEMENT rien.
    // On regarde l'expression qui CHOISIT la fenêtre, pas le fichier entier :
    // juger le splash « utilisable » sans jamais le retenir laisserait la garde
    // verte sur un repli mort.
    const choix = extrait(si, 'const fenetre =', 4)
    expect(choix, 'à défaut de fenêtre principale, c’est le splash qu’on ramène').toMatch(/splash/i)
  })

  it('un splash volontairement masqué n’est pas ramené devant', () => {
    // Il a été écarté pour laisser lire une boîte de dialogue : lui rendre le
    // focus masquerait le message qu'on veut faire lire.
    expect(si).toMatch(/isVisible\(\)/)
  })
})

describe('le cycle de mise à jour', () => {
  it('une redirection ne peut pas faire passer la métadonnée en clair', () => {
    const h = extrait(MAIN, 'function httpGetJson', 40)
    expect(h, 'l’en-tête Location était suivi tel quel').toMatch(/https:/)
    expect(h).toMatch(/new URL\(res\.headers\.location, url\)/)
  })

  it('le nom de fichier vient de l’assainisseur, des DEUX côtés', () => {
    const dl = extrait(MAIN, 'const fileName =', 12)
    expect(Array.from(dl.matchAll(/nomFichierSur\(/g)).length).toBeGreaterThanOrEqual(2)
  })

  it('une tentative d’installation est mémorisée pour ne pas boucler', () => {
    expect(MAIN).toMatch(/function ecrireTentativeMaj/)
    expect(MAIN).toMatch(/function tentativeRecente/)
  })

  it('une mise à jour OBLIGATOIRE n’est jamais tue par cette mémoire', () => {
    expect(extrait(MAIN, 'function tentativeRecente', 14)).toMatch(/mandatory/)
  })

  it('les installateurs abandonnés sont purgés au démarrage', () => {
    // Chaque tentative laissait plusieurs centaines de Mo dans %TEMP% — et un
    // disque plein est précisément ce qui fait échouer la mise à jour suivante.
    expect(MAIN).toMatch(/function purgerTelechargementsMaj/)
  })

  it('l’application ne se ferme pas quand l’installateur n’a pas démarré', () => {
    const l = extrait(MAIN, 'const launchInstaller', 90)
    expect(l, 'fermer laisserait le poste sans logiciel ET sans mise à jour').toMatch(/showMessageBox/)
  })
})

describe('l’installateur ne désinstalle plus avant confirmation', () => {
  it('aucune macro ne lance l’ancien désinstalleur depuis customInit', () => {
    // `customInit` est inséré dans `.onInit`, AVANT la première page de
    // l'assistant : la version installée disparaissait avant que l'utilisateur
    // ait confirmé quoi que ce soit. electron-builder fait déjà ce travail au
    // bon moment, dans la section d'installation, avec `--keep-shortcuts`.
    const code = sansCommentaires(NSH, ';')
    expect(code).not.toMatch(/!macro\s+customInit/)
    expect(code, 'plus aucun appel manuel à un désinstalleur').not.toMatch(/ExecWait\s+'\$R0/)
  })

  it('la raison du retrait est écrite, pour qu’on ne le remette pas', () => {
    expect(NSH).toMatch(/customInit/)
  })
})
