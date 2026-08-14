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

describe('les postes de licence sont visibles et libérables (GF-DUR-010/011)', () => {
  // Conséquence concrète du défaut : un ordinateur en panne, volé ou remplacé
  // gardait son siège À VIE. L'auto-désactivation ne pouvait rien y faire — elle
  // exige le `deviceToken`, que seul l'appareil détient.
  const admin = lire('src/components/admin/LicenseDevices.tsx')
  const exploitant = lire('src/components/LicenseChangeModal.tsx')

  it('la zone d\'administration liste les postes et agit dessus', () => {
    expect(admin).toMatch(/fetch\(`\/api\/admin\/licenses\/\$\{licenseId\}\/devices`/)
    expect(admin).toMatch(/fetch\(`\/api\/admin\/licenses\/\$\{licenseId\}\/devices\/\$\{deviceId\}`/)
    expect(admin).toMatch(/action, \.\.\.\(motif \? \{ reason: motif \} : \{\}\)/)
    expect(lire('src/app/admin/licenses/page.tsx')).toContain('<LicenseDevices licenseId={item.id} />')
  })

  it('les deux gestes sont nommés par leur CONSÉQUENCE, pas par leur verbe', () => {
    // Libérer un poste volé le laisse revenir ; révoquer un poste remplacé prive
    // le client d'un siège payé. « reset » et « revoke » ne disent ni l'un ni
    // l'autre à qui décide.
    expect(admin).toContain('Libérer le siège')
    expect(admin).toMatch(/pourra se réactiver/)
    expect(admin).toMatch(/NE POURRA PAS se réactiver/)
    expect(admin).toMatch(/PAS pour un poste volé/)
  })

  it('l\'état affiché vient du serveur après chaque action', () => {
    // Après `reset` l'appareil disparaît, après `revoke` il reste : deviner
    // finirait par mentir.
    const agir = admin.slice(admin.indexOf('async function agir'))
    expect(agir.indexOf('await charger()')).toBeGreaterThan(agir.indexOf('if (!r.ok)'))
  })

  it('l\'exploitant voit ses sièges consommés', () => {
    expect(exploitant).toMatch(/fetch\('\/api\/license\/devices'/)
    expect(exploitant).toMatch(/siège\$\{|siège/)
  })

  it('aucun bouton de libération côté exploitant — il ne pourrait pas fonctionner', () => {
    // `/api/license/deactivate` exige le `deviceToken`, qu'aucun navigateur ne
    // détient. Le proposer serait pire que de ne rien proposer ; l'écran dit
    // donc quoi faire à la place.
    expect(exploitant).not.toMatch(/fetch\([`'"]\/api\/license\/deactivate/)
    expect(exploitant).toMatch(/demandez la libération à votre revendeur/)
  })
})

describe('le client peut voir et fermer ses connexions (GF-DUR-012)', () => {
  const src = lire('src/components/portal/PortalSessions.tsx')

  it('la page du portail monte le panneau', () => {
    const page = lire('src/app/clients/account/page.tsx')
    expect(page).toContain("import { PortalSessions } from '@/components/portal/PortalSessions'")
    expect(page).toContain('<PortalSessions />')
  })

  it('les deux opérations sont déclenchées', () => {
    expect(src).toMatch(/fetch\('\/api\/portal\/auth\/devices', \{ cache: 'no-store' \}\)/)
    expect(src).toMatch(/method: 'POST'[\s\S]{0,120}deviceId: s\.id/)
  })

  it('fermer SA PROPRE session prévient avant, et redirige après', () => {
    // Sans cela, le client clique et se retrouve dehors sans comprendre : il
    // conclut à une panne.
    expect(src).toMatch(/s\.current && !window\.confirm\(/)
    expect(src).toMatch(/vous déconnectera immédiatement/)
    // Le serveur dit lui-même si la session fermée était la courante.
    expect(src).toMatch(/d\.revokedCurrent/)
    expect(src).toMatch(/router\.replace\(lienPortail\(cheminPortail\('login'\)\)\)/)
  })
})

describe('le garage voit qui relancer, et peut le faire (GF-DUR-013)', () => {
  const src = lire('src/components/reminders/ReminderSuggestions.tsx')

  it('les deux sources d\'alerte sont réellement lues', () => {
    expect(src).toMatch(/fetch\('\/api\/reminders\/suggestions'/)
    expect(src).toMatch(/fetch\('\/api\/vehicles\/ct-alerts\?days=60'/)
  })

  it('le panneau Rappels expose l\'onglet et le monte', () => {
    const panneau = lire('src/components/ReminderPanel.tsx')
    expect(panneau).toContain("import { ReminderSuggestions } from '@/components/reminders/ReminderSuggestions'")
    expect(panneau).toMatch(/\['pending', 'sent', 'all', 'suggestions'\]/)
    expect(panneau).toMatch(/filter === 'suggestions' \? \(/)
  })

  it('une suggestion se transforme en rappel réel, pas en note à recopier', () => {
    // Afficher une liste que l'utilisateur devrait ressaisir dans le formulaire
    // d'à côté aurait été une décoration.
    expect(src).toMatch(/fetch\('\/api\/reminders', \{\s*method: 'POST'/)
    expect(src).toMatch(/Créer le rappel/)
  })

  it('la ligne ne disparaît qu\'après confirmation du serveur', () => {
    // Sinon le garage croirait avoir relancé un client qu'il n'a pas relancé.
    const creer = src.slice(src.indexOf('async function creer'))
    expect(creer.indexOf('if (!r.ok)')).toBeLessThan(creer.indexOf('setTraitees('))
  })

  it('un CT dépassé n\'est pas présenté comme une échéance à venir', () => {
    expect(src).toMatch(/CT dépassé depuis/)
    expect(src).toMatch(/CT dans \$\{c\.daysLeft\}/)
    // Et il se rappelle aujourd'hui, pas la veille d'une date déjà passée.
    expect(src).toMatch(/c\.expired\s*\?\s*format\(new Date\(\), 'yyyy-MM-dd'\)/)
  })

  it('l\'onglet des suggestions n\'interroge pas la liste des rappels', () => {
    // `?status=suggestions` renverrait tout : l'onglet afficherait des rappels
    // existants sous un titre qui promet autre chose.
    expect(lire('src/components/ReminderPanel.tsx'))
      .toMatch(/if \(filter === 'suggestions'\) \{ setLoading\(false\); return \}/)
  })
})

describe('la messagerie existe des DEUX côtés (GF-DUR-014)', () => {
  const portail = lire('src/app/clients/messages/page.tsx')
  const garage = lire('src/components/TicketsPanel.tsx')

  it('le client atteint sa messagerie depuis son espace', () => {
    const espace = lire('src/app/clients/account/page.tsx')
    // Le lien porte le garage courant : un lien nu le perdrait, et le client
    // retomberait sur une connexion qui ne sait plus à quel garage il appartient.
    expect(espace).toMatch(/href=\{lienPortail\(cheminPortail\('messages'\)\)\}/)
    expect(espace).toContain('Mes messages')
  })

  it('les quatre opérations du portail sont déclenchables', () => {
    expect(portail).toMatch(/fetch\('\/api\/portal\/tickets', \{ cache: 'no-store' \}\)/)  // liste
    expect(portail).toMatch(/fetch\('\/api\/portal\/tickets', \{\s*method: 'POST'/)        // ouverture
    expect(portail).toMatch(/fetch\(`\/api\/portal\/tickets\/\$\{ouvert\}`, \{\s*method: 'POST'/) // réponse
    expect(portail).toMatch(/\/close`, \{\s*method: 'POST'/)                               // clôture
  })

  it('le panneau garage est atteignable en navigation desktop ET mobile', () => {
    expect(lire('src/app/page.tsx')).toMatch(/isTicketsOpen\s+&& <TicketsPanel/)
    expect(lire('src/components/Header.tsx')).toMatch(/onClick=\{onOpenTickets\}/)
    expect(lire('src/components/MobileNav.tsx')).toMatch(/run\(props\.onOpenTickets\)/)
  })

  it('le garage lit, répond, clôt et rouvre', () => {
    expect(garage).toMatch(/fetch\('\/api\/tickets', \{ cache: 'no-store' \}\)/)
    expect(garage).toMatch(/fetch\(`\/api\/tickets\/\$\{ouvert\}`, \{\s*method: 'POST'/)
    expect(garage).toMatch(/agir\(\{ message: reponse\.trim\(\) \}/)
    expect(garage).toMatch(/agir\(\{ close: true \}/)
    expect(garage).toMatch(/agir\(\{ reopen: true \}/)
  })

  it('un fil CLOS n\'offre aucun champ de saisie, des deux côtés', () => {
    // Le serveur refuserait le message (409) : laisser écrire pour refuser
    // ensuite ferait perdre son texte à celui qui vient de l'écrire.
    for (const [nom, src] of [['portail', portail], ['garage', garage]] as const) {
      expect(src, nom).toMatch(/status === 'closed'/)
      expect(src, nom).toMatch(/Rouvrir/)
    }
  })

  it('le statut est traduit en « qui doit agir », jamais recopié tel quel', () => {
    // « pending » et « answered » sont ambigus dans les deux sens pour qui ne
    // connaît pas la machine à états.
    expect(portail).toMatch(/answered: \{ texte: 'Réponse reçue'/)
    expect(portail).toMatch(/pending: \{ texte: 'En attente du garage'/)
    expect(garage).toMatch(/pending: \{ texte: 'Relance client'/)
    expect(garage).toMatch(/open: \{ texte: 'Nouveau'/)
  })

  it('le garage voit d\'abord ce qui attend une réponse', () => {
    // Tout montrer par défaut noierait les fils sans réponse dans l'historique.
    expect(garage).toMatch(/const A_TRAITER = new Set\(\['open', 'pending'\]\)/)
    expect(garage).toMatch(/useState<'a-traiter' \| 'tous'>\('a-traiter'\)/)
  })

  it('le texte des messages est rendu tel quel, jamais interprété', () => {
    for (const [nom, src] of [['portail', portail], ['garage', garage]] as const) {
      expect(src, nom).toMatch(/whitespace-pre-line[^>]*>\{m\.body\}/)
      expect(src, nom).not.toMatch(/dangerouslySetInnerHTML/)
    }
  })

  it('un envoi refusé ne fait pas perdre son texte au client', () => {
    const nouveau = portail.slice(portail.indexOf('async function envoyer'))
    const echec = nouveau.slice(0, nouveau.indexOf('onCree('))
    expect(echec).toMatch(/onErreur\(d\?\.error/)
    // Aucun vidage de champ sur le chemin d'échec.
    expect(echec).not.toMatch(/setMessage\(''\)|setSujet\(''\)/)
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
