/**
 * Le parcours du client — un homme qui reçoit un lien par SMS et ne connaît pas
 * le logiciel.
 *
 * ─── Les défauts ────────────────────────────────────────────────────────────
 *
 * 1. Un accès COUPÉ par le garage : la connexion RÉUSSISSAIT. Le client
 *    recevait un cookie, puis chaque route protégée le rejetait
 *    (`auth-helpers.ts` refuse un compte désactivé). Il tournait indéfiniment
 *    entre le formulaire et un espace vide, sans jamais lire une phrase
 *    expliquant pourquoi — et en concluait que le logiciel est cassé.
 *
 * 2. L'inscription annonçait « Compte créé » à qui possédait déjà un compte.
 *    La réponse du serveur est volontairement indifférenciable — pour ne pas
 *    révéler qui possède un compte — mais l'écran trahissait cette prudence
 *    dans l'autre sens : le client repartait persuadé d'avoir créé un second
 *    compte, et attendait un courriel de vérification qui ne viendrait jamais.
 *
 * 3. Le mot de passe oublié — le scénario le plus banal — n'avait AUCUNE issue
 *    à l'écran.
 *
 * 4. Accepter un devis était irréversible, sans confirmation, et sans dire que
 *    le clic vaut engagement. Sur un téléphone, les deux boutons se touchent.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('un accès coupé est DIT, pas subi', () => {
  const route = lire('src/app/api/portal/auth/login/route.ts')

  it('la connexion refuse un compte désactivé', () => {
    expect(route).toContain('if (user.disabledAt) {')
    expect(route).toContain("code: 'ACCESS_DISABLED'")
  })

  it('le refus arrive AVANT toute émission de session', () => {
    const refus = route.indexOf('if (user.disabledAt)')
    // L'APPEL, pas l'import : celui-ci figure en tête de fichier.
    const session = route.indexOf('await issuePortalSession(')
    expect(refus).toBeGreaterThan(-1)
    expect(refus, 'un cookie émis puis rejeté partout, c’est la boucle qu’on corrige')
      .toBeLessThan(session)
  })

  it('le message dit quoi faire, pas seulement que c’est refusé', () => {
    expect(route).toMatch(/Contactez-le pour le rétablir/)
  })
})

describe('l’écran ne dit pas ce que le serveur a soigneusement tu', () => {
  it('l’inscription n’annonce plus « Compte créé »', () => {
    const page = lire('src/app/clients/register/page.tsx')
    // On vise ce qui est RENDU, pas le commentaire qui explique le défaut.
    expect(page, 'la réponse serveur est indifférenciable : l’écran doit l’être aussi')
      .not.toMatch(/<p className="text-sm">Compte créé/)
  })

  it('elle dit ce qui est vrai dans les deux cas', () => {
    expect(lire('src/app/clients/register/page.tsx')).toContain('Vérifiez votre boîte mail')
  })

  it('la réponse du serveur reste, elle, indifférenciable', () => {
    // Garde de non-régression sur la prudence existante : un compte déjà
    // inscrit doit continuer de recevoir la MÊME réponse qu'une inscription.
    const route = lire('src/app/api/portal/auth/register/route.ts')
    expect(route).toContain('verificationEmailSent: true')
    expect(route).toMatch(/Indifférenciable d'une vraie inscription/)
  })
})

describe('le mot de passe oublié a enfin une issue', () => {
  it('la page de connexion indique le chemin qui EXISTE', () => {
    // Il n'y a pas de réinitialisation autonome dans ce produit ; le garage,
    // lui, peut remettre un mot de passe. Inventer un parcours aurait été pire
    // que de dire la vérité.
    const page = lire('src/app/clients/login/page.tsx')
    expect(page).toMatch(/Mot de passe oublié/)
    expect(page).toMatch(/Votre garage peut vous en remettre un nouveau/)
  })
})

describe('accepter un devis engage — et se confirme', () => {
  const page = lire('src/app/clients/quote/[token]/page.tsx')

  it('les deux boutons demandent confirmation au lieu d’agir', () => {
    expect(page).toContain("onClick={() => setAConfirmer('accept')}")
    expect(page).toContain("onClick={() => setAConfirmer('refuse')}")
  })

  it('la confirmation dit que la réponse est définitive', () => {
    expect(page).toMatch(/ne pourra plus être modifiée/)
  })

  it('le texte d’introduction annonce l’engagement', () => {
    expect(page).toMatch(/accepter vaut accord sur les travaux et le montant/)
  })

  it('l’action réelle n’est atteignable QUE depuis la confirmation', () => {
    // Un seul appelant : le bouton « Oui, j'accepte / je refuse ».
    const appels = page.match(/handleAction\(/g) ?? []
    expect(appels.length, 'déclaration + un seul point d’appel').toBeLessThanOrEqual(2)
  })
})
