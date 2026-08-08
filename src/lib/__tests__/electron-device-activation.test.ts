import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * RÉGRESSION — boucle sans fin de réactivation d'appareil.
 *
 * Observé dans garageflow.log : 136 réactivations, une toutes les 2 minutes,
 * qui n'aboutissaient JAMAIS.
 *
 *   [license/activate] server refused — Nombre maximal d'appareils atteint (1)…
 *   [license/activate] device token obtained — deviceId: cmsjjz8f9002qak2r3ahpovij
 *   [license/check]    remote result — allowed: false | status: device_required
 *
 * Mécanisme : `activateOnServer()` interroge DEUX autorités —
 * `[LICENSE_SERVER, http://127.0.0.1:PORT]`. L'autorité distante refusait
 * (limite d'appareils), le repli LOCAL délivrait un jeton, et la fonction
 * renvoyait `true` sans distinguer les deux. Le battement suivant repartait vers
 * l'autorité distante, qui ignorait ce jeton local et redemandait un appareil :
 * boucle. Elle était même amorcée en rafale par la re-sonde à 500 ms.
 *
 * Deux invariants en découlent, verrouillés ici :
 *  1. un refus EXPLICITE de l'autorité distante est définitif — le repli local
 *     ne doit pas le contourner (sinon la limite d'appareils, décision
 *     commerciale, devient inopérante) ;
 *  2. la re-sonde immédiate n'a lieu que si le jeton vient de l'autorité qui
 *     l'a exigé.
 *
 * `electron/main.js` n'est pas importable (il charge le module `electron`) :
 * on verrouille la source, comme le fait déjà electron-loopback.test.ts.
 */
describe('electron/main — activation d\'appareil, pas de boucle sans fin', () => {
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')

  /** Corps de `activateOnServer()`, isolé du reste du fichier. */
  const activateBody = (() => {
    const start = mainSrc.indexOf('async function activateOnServer()')
    expect(start).toBeGreaterThan(-1)
    return mainSrc.slice(start, start + 2200)
  })()

  /**
   * Branche `deviceRequired` du battement périodique, bornée par la branche
   * SUIVANTE plutôt que par une longueur fixe : découper à N caractères coupait
   * la branche en deux dès qu'on y ajoutait une ligne, et le test tombait sur
   * une modification parfaitement saine.
   */
  const deviceRequiredBranch = (() => {
    const start = mainSrc.indexOf('if (result.deviceRequired)')
    expect(start).toBeGreaterThan(-1)
    const end = mainSrc.indexOf('if (result.allowed === false)', start)
    expect(end).toBeGreaterThan(start)
    return mainSrc.slice(start, end)
  })()

  it('activateOnServer distingue les deux autorités interrogées', () => {
    // Les bases ne sont plus une simple liste d'URL : chacune porte son rôle.
    expect(activateBody).toMatch(/authority:\s*'remote'/)
    expect(activateBody).toMatch(/authority:\s*'local'/)
  })

  it('activateOnServer renvoie l\'autorité émettrice, jamais un booléen nu', () => {
    expect(activateBody).toMatch(/return authority/)
    // Un `return true` rétablirait exactement l'ambiguïté d'origine.
    expect(activateBody).not.toMatch(/return true/)
  })

  it('un refus explicite de l\'autorité distante n\'est PAS contourné par le repli local', () => {
    // Dans la branche « refus », le cas 'remote' doit sortir immédiatement.
    const refusal = activateBody.slice(activateBody.indexOf('res.ok === false'))
    expect(refusal).toMatch(/authority === 'remote'/)
    expect(refusal).toMatch(/return null/)
  })

  it('la re-sonde immédiate est conditionnée à l\'autorité distante', () => {
    expect(deviceRequiredBranch).toMatch(/if \(authority === 'remote'\)/)
    // La re-sonde à 500 ms doit être DANS cette condition, pas inconditionnelle.
    const guarded = deviceRequiredBranch.slice(deviceRequiredBranch.indexOf("authority === 'remote'"))
    expect(guarded).toMatch(/setTimeout\([\s\S]{0,60}?periodicLicenseCheck/)
  })

  it('le motif de refus est remonté à l\'interface, pas seulement journalisé', () => {
    expect(deviceRequiredBranch).toMatch(/webContents\.send\(\s*'license:revoked'/)
    expect(deviceRequiredBranch).toMatch(/report\.overlay/)
  })

  it('la décision de ce qu\'il faut dire est déléguée au module testable', () => {
    // Elle vivait ici, inatteignable par un test, et mentait deux fois : elle
    // accusait le réseau d'un refus délibéré du serveur, et présentait ce refus
    // sous un statut absent de l'overlay — donc rendu « Compte révoqué ».
    // Le comportement est désormais éprouvé pour de vrai dans
    // electron-activation-report.test.ts ; on verrouille ici le câblage.
    expect(mainSrc).toMatch(/require\('\.\/activation-report'\)/)
    expect(deviceRequiredBranch).toMatch(/activationReport\(\{/)
    expect(deviceRequiredBranch).toMatch(/loggedRefusal:\s*loggedActivationRefusal/)
    // Le statut codé en dur qui provoquait le repli « révoqué » ne doit pas revenir.
    expect(deviceRequiredBranch).not.toMatch(/status:\s*'device_limit'/)
  })

  it('les échecs consécutifs sont comptés et signalés une fois', () => {
    expect(mainSrc).toMatch(/let deviceRetryStreak = 0/)
    expect(mainSrc).toMatch(/const DEVICE_RETRY_WARN_AT/)
    expect(deviceRequiredBranch).toMatch(/deviceRetryStreak\+\+/)
  })
})
