/**
 * GF-FINAL-024 — un rappel marqué « Envoyé » alors que rien n'est parti.
 *
 * `ReminderPanel.handleSendEmail` posait `onStatusChange(id, 'sent')` sur DEUX
 * chemins :
 *   1. `data.sent === true` — légitime, un message est réellement parti ;
 *   2. `data.reason === 'no_smtp'` — après un simple `window.open('mailto:…')`,
 *      c'est-à-dire l'OUVERTURE d'un brouillon. Personne ne peut savoir à cet
 *      instant si l'utilisateur cliquera « Envoyer ».
 *
 * Sous l'application packagée, le second chemin était pire encore :
 * `setWindowOpenHandler` n'autorisait que `https:` vers quatre domaines, donc
 * `mailto:` était refusé et seulement journalisé — le brouillon ne s'ouvrait
 * JAMAIS, et le rappel passait quand même à « Envoyé ». Le garage lisait
 * « Envoyé » sur des rappels qu'aucun client n'a reçus.
 *
 * Troisième défaut du même bloc : aucune branche `else`. Un échec SMTP, une
 * adresse invalide ou une panne serveur ne produisaient AUCUN retour — le clic
 * ne faisait visiblement rien.
 *
 * Le rendu React n'est pas exerçable ici (`environment: 'node'`, aucune
 * bibliothèque de rendu) : on verrouille la source, comme le font déjà les tests
 * `electron-*` pour `main.js`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => readFileSync(path.join(RACINE, rel), 'utf8')

/** Corps de `handleSendEmail`, isolé par équilibrage d'accolades. */
function corpsHandleSendEmail(src: string): string {
  const debut = src.indexOf('async function handleSendEmail()')
  expect(debut).toBeGreaterThan(-1)
  const ouvrante = src.indexOf('{', debut)
  let profondeur = 0
  for (let i = ouvrante; i < src.length; i++) {
    if (src[i] === '{') profondeur++
    else if (src[i] === '}') {
      profondeur--
      if (profondeur === 0) return src.slice(debut, i + 1)
    }
  }
  throw new Error('corps de handleSendEmail introuvable')
}

describe('l\'état « envoyé » n\'est posé que si un message est parti', () => {
  const corps = corpsHandleSendEmail(lire('src/components/ReminderPanel.tsx'))

  it('un seul chemin marque le rappel « sent »', () => {
    const marquages = corps.match(/onStatusChange\([^)]*'sent'\)/g) ?? []
    expect(marquages).toHaveLength(1)
  })

  it('ce chemin est celui où le serveur confirme l\'envoi', () => {
    const confirme = corps.slice(corps.indexOf('if (data.sent)'))
    expect(confirme.slice(0, 200)).toMatch(/onStatusChange\([^)]*'sent'\)/)
  })

  it('l\'ouverture d\'un BROUILLON ne marque rien', () => {
    const brouillon = corps.slice(corps.indexOf("data.reason === 'no_smtp'"))
    // La branche va jusqu'à son `return` : elle ne doit contenir aucun marquage.
    const branche = brouillon.slice(0, brouillon.indexOf('return') + 6)
    expect(branche).toContain('mailto:')
    expect(branche).not.toMatch(/onStatusChange/)
  })

  it('un échec est signalé à l\'utilisateur, pas avalé', () => {
    expect(corps).toMatch(/toast\.error\(/)
    // …y compris quand la requête elle-même échoue.
    expect(corps).toMatch(/catch\s*\{[\s\S]{0,120}toast\.error/)
  })
})

describe('les protocoles réellement utilisés par le produit sont autorisés', () => {
  const main = lire('electron/main.js')

  it('`mailto:` et `sms:` passent par shell.openExternal', () => {
    // Sans cela, les deux boutons de rappel ne font RIEN dans l'application
    // packagée — ils sont refusés puis seulement journalisés.
    expect(main).toContain("ALLOWED_EXTERNAL_PROTOCOLS = new Set(['mailto:', 'sms:'])")
    const bloc = main.slice(main.indexOf('setWindowOpenHandler'))
    expect(bloc.slice(0, 700)).toMatch(/ALLOWED_EXTERNAL_PROTOCOLS\.has\(u\.protocol\)/)
  })

  it('le refus par défaut est conservé pour tout le reste', () => {
    const bloc = main.slice(main.indexOf('setWindowOpenHandler'))
    const handler = bloc.slice(0, 900)
    // La liste blanche de domaines HTTPS reste en place…
    expect(handler).toMatch(/u\.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS\.has\(u\.hostname\)/)
    // …et la fonction refuse toujours d'ouvrir une fenêtre elle-même.
    expect(handler).toMatch(/return \{ action: 'deny' \}/)
  })
})
