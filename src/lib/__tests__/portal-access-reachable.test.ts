/**
 * GF-PORT-005 — la gestion des accès portail doit être ATTEIGNABLE.
 *
 * Ce produit a répété trois fois le même défaut : une route correcte, éprouvée,
 * qu'aucun écran n'appelle. Le module Fournisseurs incrémentait bien le stock —
 * personne ne déclenchait la réception. La photo de mécanicien arrivait bien au
 * cloud — la PWA affichait les initiales. Les routes d'accès portail
 * fonctionnaient — la gestion des clients n'avait aucune interface.
 *
 * Une fonctionnalité inatteignable est une fonctionnalité absente. Ces contrôles
 * portent donc sur le CÂBLAGE, du bouton de navigation jusqu'à l'appel réseau.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => readFileSync(path.join(RACINE, rel), 'utf8')

describe('le panneau Clients appelle réellement les routes d\'accès portail', () => {
  const src = lire('src/components/ClientsPanel.tsx')

  it('lit l\'annuaire client', () => {
    expect(src).toMatch(/fetch\(`\/api\/clients\?/)
  })

  it('couvre les quatre opérations : état, ouverture, réinitialisation, activation', () => {
    expect(src).toMatch(/fetch\(`\/api\/clients\/\$\{clientId\}\/portal-access`\)/)
    const appel = src.slice(src.indexOf('async function agir'))
    expect(appel).toMatch(/method: methode/)
    for (const m of ['POST', 'PUT', 'PATCH']) {
      expect(src, `méthode ${m} jamais déclenchée`).toContain(`'${m}'`)
    }
    // La bascule envoie bien l'inverse de l'état courant.
    expect(src).toMatch(/agir\(c\.id, 'PATCH', \{ actif: !a\.actif \}\)/)
  })

  it('affiche le mot de passe temporaire, et prévient qu\'il ne reviendra pas', () => {
    expect(src).toContain('motDePasseTemporaireEnClair')
    expect(src).toMatch(/ne sera plus jamais affiché/i)
  })

  it('un refus du serveur est affiché, jamais avalé', () => {
    expect(src).toMatch(/toast\.error\(d\?\.error/)
  })

  it('l\'état n\'est mis à jour qu\'APRÈS la réponse du serveur', () => {
    // Borne de fin sur `setOccupe(null)` (le `finally` de la fonction) et non
    // sur « return ( » : cette chaîne apparaît d'abord dans le `return` de
    // nettoyage d'un `useEffect` situé plus haut, ce qui donnait une tranche vide.
    const debut = src.indexOf('async function agir')
    const agir = src.slice(debut, src.indexOf('setOccupe(null)', debut))
    const posRefus = agir.indexOf('if (!r.ok)')
    const posMaj = agir.indexOf('setAcces((a) => ({ ...a, [clientId]: d }))')
    expect(posRefus).toBeGreaterThan(-1)
    expect(posMaj).toBeGreaterThan(posRefus)
  })
})

describe('la fiche client est modifiable depuis le panneau (GF-PORT-007)', () => {
  const src = lire('src/components/ClientsPanel.tsx')

  it('la route de modification est réellement appelée', () => {
    expect(src).toMatch(/fetch\(`\/api\/clients\/\$\{clientId\}`, \{\s*method: 'PATCH'/)
  })

  it('une adresse effacée est envoyée comme retirée, pas comme chaîne vide', () => {
    // `''` passerait la validation et s'installerait comme identifiant fantôme.
    expect(src).toMatch(/email: valeurs\.email\.trim\(\) \|\| null/)
  })

  it('le garage est averti AVANT d\'enregistrer que l\'identifiant va changer', () => {
    // Après le clic, ce serait un constat ; avant, c'est un choix.
    const bloc = src.slice(src.indexOf('brouillon?.clientId === c.id'))
    expect(bloc).toMatch(/deviendra son identifiant de connexion/)
    expect(bloc).toMatch(/sessions ouvertes seront fermées/i)
  })

  it('les conséquences réelles sont rapportées après coup, y compris l\'échec d\'envoi', () => {
    const bloc = src.slice(src.indexOf('async function enregistrerFiche'))
    expect(bloc).toMatch(/d\.portail\?\.identifiantModifie/)
    expect(bloc).toMatch(/emailEnvoye === false/)
    expect(bloc).toMatch(/n’a PAS pu être envoyé/)
  })

  it('l\'affichage suit la réponse du serveur, pas le brouillon local', () => {
    const debut = src.indexOf('async function enregistrerFiche')
    const maj = src.slice(debut, src.indexOf('setBrouillon(null)', debut))
    expect(maj).toMatch(/name: d\.name, email: d\.email, phone: d\.phone/)
    // Le refus est examiné AVANT que quoi que ce soit ne soit affiché.
    expect(maj.indexOf('if (!r.ok)')).toBeGreaterThan(-1)
    expect(maj.indexOf('if (!r.ok)')).toBeLessThan(maj.indexOf('setClients('))
  })
})

describe('le panneau est atteignable depuis la navigation', () => {
  it('la page principale le monte et sait l\'ouvrir', () => {
    const page = lire('src/app/page.tsx')
    expect(page).toContain("import ClientsPanel from '@/components/ClientsPanel'")
    expect(page).toMatch(/isClientsOpen\s+&&\s+<ClientsPanel/)
    expect(page).toMatch(/onOpenClients=\{\(\) => setIsClientsOpen\(true\)\}/)
  })

  it('un bouton existe en navigation desktop ET mobile', () => {
    expect(lire('src/components/Header.tsx')).toMatch(/onClick=\{onOpenClients\}/)
    expect(lire('src/components/MobileNav.tsx')).toMatch(/run\(props\.onOpenClients\)/)
  })
})

describe('la transmission à la plateforme agréée est atteignable depuis la facture', () => {
  // Quatrième occurrence du même défaut, et la plus complète : `envoyerFacture`
  // avait une route que personne n'ouvrait, `declarerNonParvenue` aussi — alors
  // que c'est la SEULE sortie de l'impasse « issue inconnue » — et
  // `rafraichirStatut` n'avait même pas de route.
  const panneau = lire('src/components/invoice/EInvoicePanel.tsx')
  const route = lire('src/app/api/einvoicing/invoices/[id]/submit/route.ts')

  it('le panneau est monté dans la modale de facture', () => {
    const modale = lire('src/components/QuoteInvoiceModal.tsx')
    expect(modale).toContain("import { EInvoicePanel } from '@/components/invoice/EInvoicePanel'")
    expect(modale).toMatch(/mode === 'invoice' && doc\?\.id && !editing && \(\s*<EInvoicePanel/)
  })

  it('les trois actions du serveur sont réellement déclenchables', () => {
    expect(panneau).toMatch(/fetch\(`\/api\/einvoicing\/invoices\/\$\{invoiceId\}\/submit`, \{\s*method: 'POST'/)
    expect(panneau).toMatch(/agir\(\{\}, 'envoi'/)                       // envoi
    expect(panneau).toContain("action: 'refresh-status'")                // relecture
    expect(panneau).toContain("action: 'declare-not-received'")          // sortie d'impasse
  })

  it('la route sert bien ces trois actions', () => {
    expect(route).toContain('rafraichirStatut')
    expect(route).toContain('declarerNonParvenue')
    expect(route).toContain('envoyerFacture')
    expect(route).toMatch(/corps\.action === 'refresh-status'/)
  })

  it('les droits viennent du SERVEUR, jamais recalculés par l\'écran', () => {
    // Recopier la règle des quinze minutes ou la liste des statuts rejouables
    // garantirait qu'un jour l'écran propose un bouton que le serveur refuse.
    for (const droit of ['peutEmettre', 'peutRelireStatut', 'peutDeclarerNonParvenue']) {
      expect(panneau, `${droit} doit venir de la réponse serveur`).toContain(droit)
      expect(route, `${droit} doit être calculé par la route`).toContain(droit)
    }
    expect(panneau).not.toMatch(/15 \* 60|900000|DELAI_ABANDON/)
  })

  it('la déclaration de non-parvenance exige une confirmation explicite', () => {
    // Faite à tort, elle produit exactement ce que toute la chaîne empêche :
    // deux déclarations de la même facture.
    const bloc = panneau.slice(panneau.indexOf("'declare-not-received'") - 900)
    expect(bloc).toMatch(/window\.confirm\(/)
    expect(bloc).toMatch(/déclarée deux fois|vérifié sur le portail/i)
  })

  it('aucun état optimiste : rien n\'est affiché avant la réponse du serveur', () => {
    const agir = panneau.slice(panneau.indexOf('async function agir'), panneau.indexOf('if (!etat) return null'))
    expect(agir).toMatch(/const res = await fetch/)
    // Le rechargement suit l'appel, il ne le précède pas.
    expect(agir.indexOf('await recharger()')).toBeGreaterThan(agir.indexOf('const res = await fetch'))
    // Et le refus du serveur est montré tel quel.
    expect(agir).toMatch(/toast\.error\(data\?\.message/)
  })
})

describe('anti-régression : les autres chaînes récemment recâblées restent branchées', () => {
  it('la réception fournisseur est toujours déclenchée par le panneau', () => {
    expect(lire('src/components/SuppliersPanel.tsx')).toMatch(/\/api\/purchase-orders\/\$\{[^}]+\}\/receive/)
  })

  it('la PWA mécanicien affiche toujours la photo, pas seulement les initiales', () => {
    expect(lire('src/app/mechanic/page.tsx')).toContain('<MechanicAvatar')
  })

  it('la fiche mécanicien permet toujours de téléverser une photo', () => {
    expect(lire('src/components/settings/MechanicsTab.tsx')).toContain('<MechanicAvatarField')
  })
})
