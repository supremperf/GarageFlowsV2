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

describe('le mot de passe provisoire a une sortie (GF-DUR-016)', () => {
  /**
   * Le défaut le plus coûteux de la série, et le plus discret : toutes les
   * routes se comportaient correctement. Ce qui manquait, c'était l'ÉCRAN qui
   * referme la boucle — sans lui, chaque accès ouvert par le garage produisait
   * un client enfermé dehors devant une page blanche.
   */
  const page = lire('src/app/clients/password/page.tsx')
  const redirection = lire('src/lib/portal/redirection.ts')

  it('la page appelle bien la route de changement', () => {
    expect(page).toMatch(/fetch\('\/api\/portal\/auth\/password', \{\s*method: 'PUT'/)
    expect(page).toMatch(/currentPassword: actuel, newPassword: nouveau/)
  })

  it('un refus du serveur est rendu tel quel', () => {
    // « mot de passe actuel incorrect » et « identique à l'actuel » n'appellent
    // pas la même correction : les confondre laisserait le client tâtonner.
    expect(page).toMatch(/setErreur\(d\?\.error/)
  })

  it('la divergence des deux saisies est signalée AVANT l\'envoi', () => {
    // Le serveur ne voit qu'un seul des deux champs : il ne peut pas la détecter.
    expect(page).toMatch(/const identiques = nouveau\.length > 0 && nouveau === confirmation/)
    expect(page).toMatch(/Les deux saisies diffèrent/)
  })

  it('la connexion envoie DIRECTEMENT vers cet écran quand c\'est imposé', () => {
    const login = lire('src/app/clients/login/page.tsx')
    expect(login).toMatch(/function apresConnexion\(motDePasseProvisoire: unknown\)/)
    expect(login).toMatch(/router\.push\(apresConnexion\(data\.mustChangePassword\)\)/)
    // Et la route rend bien l'information sur laquelle l'écran s'appuie.
    for (const r of ['src/app/api/portal/auth/login/route.ts', 'src/app/api/portal/auth/2fa/verify/route.ts']) {
      expect(lire(r), r).toMatch(/mustChangePassword: user\.mustChangePassword/)
    }
  })

  it('toute page du portail réoriente sur le code du serveur, sans le redeviner', () => {
    expect(redirection).toMatch(/PASSWORD_CHANGE_REQUIRED/)
    expect(redirection).toMatch(/res\.status === 401/)
    // La réponse est CLONÉE : l'appelant doit pouvoir lire son corps ensuite.
    expect(redirection).toMatch(/res\.clone\(\)\.json\(\)/)

    for (const p of ['src/app/clients/account/page.tsx', 'src/app/clients/messages/page.tsx']) {
      const src = lire(p)
      expect(src, p).toContain("import { redirectionPortail } from '@/lib/portal/redirection'")
      expect(src, p).toMatch(/const ailleurs = await redirectionPortail\(/)
      expect(src, p).toMatch(/if \(ailleurs\) \{ router\.replace\(ailleurs\); return \}/)
      // Le 401 n'est plus traité à la main : le redeviner ferait diverger les
      // pages au premier ajout de code.
      expect(src, p).not.toMatch(/if \(r(es)?\.status === 401\)/)
    }
  })
})

describe('les rendez-vous existent des DEUX côtés (GF-DUR-017)', () => {
  const portail = lire('src/app/clients/appointments/page.tsx')
  const garage = lire('src/components/AppointmentsPanel.tsx')

  it('le client atteint ses rendez-vous depuis son espace', () => {
    const espace = lire('src/app/clients/account/page.tsx')
    expect(espace).toMatch(/href=\{lienPortail\(cheminPortail\('appointments'\)\)\}/)
    expect(espace).toContain('Mes rendez-vous')
  })

  it('les quatre opérations du portail sont déclenchables', () => {
    expect(portail).toMatch(/fetch\('\/api\/portal\/appointments', \{ cache: 'no-store' \}\)/)
    expect(portail).toMatch(/fetch\('\/api\/portal\/appointments', \{\s*\n?\s*method: 'POST'/)
    expect(portail).toMatch(/method: 'PATCH'/)
    expect(portail).toMatch(/method: 'DELETE'/)
  })

  it('le panneau garage est atteignable en navigation desktop ET mobile', () => {
    expect(lire('src/app/page.tsx')).toMatch(/isApptsOpen\s+&& <AppointmentsPanel/)
    expect(lire('src/components/Header.tsx')).toMatch(/onClick=\{onOpenAppointments\}/)
    expect(lire('src/components/MobileNav.tsx')).toMatch(/run\(props\.onOpenAppointments\)/)
  })

  it('une DEMANDE n\'est jamais présentée comme un rendez-vous pris', () => {
    // C'est la distinction qui décide si un client se présente devant un rideau
    // fermé.
    expect(portail).toMatch(/requested: \{ texte: 'Demande envoyée'/)
    expect(portail).toMatch(/confirmed: \{ texte: 'Confirmé par le garage'/)
    expect(garage).toMatch(/requested: \{ texte: 'À confirmer'/)
  })

  it('les heures d\'ouverture viennent du serveur, jamais recopiées', () => {
    // Les recopier les ferait diverger au premier changement de réglage : le
    // client se verrait proposer une heure que le serveur refuse.
    expect(portail).toMatch(/if \(d\.horaires\) setHoraires\(d\.horaires\)/)
    expect(lire('src/app/api/portal/appointments/route.ts')).toMatch(/ouverture: garage\?\.workshopStartHour/)
  })

  it('l\'écran ne propose que les transitions que le serveur accepterait', () => {
    // `nextAppointmentStatus` est la MÊME fonction que celle du serveur, pas une
    // copie qui divergerait — proposer une transition impossible mènerait à un
    // 409 incompréhensible.
    expect(garage).toContain("import { nextAppointmentStatus")
    expect(garage).toMatch(/nextAppointmentStatus\(r\.status as AppointmentStatus, a\.action\) !== null/)
  })

  it('déplacer un créneau confirmé est annoncé comme une perte de confirmation', () => {
    expect(portail).toMatch(/annulera la confirmation/)
  })

  it('le garage ouvre sur les demandes en attente', () => {
    expect(garage).toMatch(/useState<'a-confirmer' \| 'a-venir' \| 'tous'>\('a-confirmer'\)/)
    expect(garage).toMatch(/r\.status === 'requested'/)
  })

  it('annuler le rendez-vous d\'un client exige une confirmation', () => {
    expect(garage).toMatch(/action === 'cancel' && !window\.confirm\(/)
    expect(garage).toMatch(/prévenez-le si c’est de votre fait/)
  })
})

describe('un devis peut enfin être envoyé à la signature (GF-DUR-020)', () => {
  /**
   * La chaîne était coupée en son MILIEU : la page de signature du client
   * existait et était complète — elle affiche le devis, recueille une signature,
   * accepte ou refuse — mais aucun écran du garage n'appelait la seule route qui
   * fabrique le jeton. La moitié cliente attendait un lien que la moitié garage
   * ne savait pas produire.
   */
  const modale = lire('src/components/QuoteInvoiceModal.tsx')
  const route = lire('src/app/api/quotes/[id]/signature-token/route.ts')

  it('le bouton appelle réellement la route', () => {
    expect(modale).toMatch(/fetch\(`\/api\/quotes\/\$\{doc\.id\}\/signature-token`, \{ method: 'POST' \}\)/)
    expect(modale).toMatch(/onClick=\{handleSignatureLink\}/)
  })

  it('proposé seulement quand le devis est encore signable', () => {
    // Le serveur refuse un devis accepté, refusé ou converti : autant ne pas
    // proposer un bouton qui mène à un 409.
    expect(modale).toMatch(/\['draft', 'sent'\]\.includes\(doc\.status\)/)
    expect(route).toMatch(/\['draft', 'sent'\]\.includes\(quote\.status\)/)
  })

  it('le lien est AFFICHÉ, pas seulement envoyé', () => {
    // Un garage sans SMTP, ou dont le client n'a pas d'adresse, doit pouvoir le
    // communiquer autrement. Tout faire dépendre du courriel rendrait la
    // signature inutilisable là où elle sert.
    expect(modale).toMatch(/signatureUrl && \(/)
    expect(modale).toMatch(/navigator\.clipboard\?\.writeText\(signatureUrl\)/)
    expect(route).toMatch(/return NextResponse\.json\(\{ token, url, emailEnvoye/)
  })

  it('l\'issue de l\'envoi est dite, y compris l\'absence d\'adresse', () => {
    const bloc = modale.slice(modale.indexOf('async function handleSignatureLink'))
    expect(bloc).toMatch(/d\.emailEnvoye === true/)
    expect(bloc).toMatch(/d\.emailEnvoye === false/)
    expect(bloc).toMatch(/n’a pas d’adresse e-mail/)
  })

  it('l\'écran suit le changement d\'état côté serveur', () => {
    // Le devis passe à « envoyé » : sans cela l'écran continue d'afficher
    // « brouillon » sur un devis déjà parti au client.
    expect(modale).toMatch(/prev\.status === 'draft' \? \{ \.\.\.prev, status: 'sent' \}/)
  })

  it('émettre un devis exige la permission de les gérer', () => {
    expect(route).toMatch(/can\(session\.user\.role, 'quote:manage'\)/)
  })
})

describe('le garage peut enfin créer des comptes pour son personnel (GF-DUR-021)', () => {
  /**
   * `/api/users` listait et créait les comptes depuis longtemps sans aucun
   * écran : un garage restait à l'unique compte né de son installation. Chaque
   * contrôle de permission écrit dans ce produit protégeait donc une distinction
   * que personne ne pouvait créer.
   */
  const onglet = lire('src/components/settings/TeamTab.tsx')

  it('l\'onglet est monté dans les réglages', () => {
    const reglages = lire('src/components/SettingsModal.tsx')
    expect(reglages).toContain("import { TeamTab } from './settings/TeamTab'")
    expect(reglages).toMatch(/tab === 'team' && canManageAccess && <TeamTab \/>/)
  })

  it('la liste et la création sont déclenchées', () => {
    expect(onglet).toMatch(/fetch\('\/api\/users', \{ cache: 'no-store' \}\)/)
    expect(onglet).toMatch(/fetch\('\/api\/users', \{\s*method: 'POST'/)
  })

  it('chaque rôle porte sa CONSÉQUENCE, pas seulement son intitulé', () => {
    // « RECEPTIONIST » ne dit rien à qui choisit ; « ni facturation ni
    // finances » décide.
    for (const r of ['RECEPTIONIST', 'MANAGER', 'OWNER']) expect(onglet).toContain(r)
    expect(onglet).toMatch(/Ni facturation ni finances/)
    expect(onglet).toMatch(/effet: string|effet:/)
  })

  it('les identifiants ne s\'affichent qu\'APRÈS création', () => {
    // Les montrer avant les ferait communiquer pour un compte inexistant.
    const creer = onglet.slice(onglet.indexOf('async function creer'))
    expect(creer.indexOf('if (!r.ok)')).toBeLessThan(creer.indexOf('setCree('))
    expect(onglet).toMatch(/ne seront plus jamais affichés/)
  })

  it('un refus de permission est DIT, pas affiché comme une équipe vide', () => {
    expect(onglet).toMatch(/r\.status === 403/)
    expect(onglet).toMatch(/réservée au propriétaire/)
  })
})

describe('le client peut ACTIVER sa double authentification (GF-DUR-026)', () => {
  const src = lire('src/components/portal/PortalTwoFactor.tsx')
  const espace = lire('src/app/clients/account/page.tsx')

  it('« Mon espace » monte le panneau', () => {
    expect(espace).toContain("import { PortalTwoFactor } from '@/components/portal/PortalTwoFactor'")
    expect(espace).toContain('<PortalTwoFactor />')
  })

  it('les trois opérations du cycle sont déclenchées', () => {
    expect(src).toMatch(/fetch\('\/api\/portal\/auth\/2fa\/setup'/)
    expect(src).toMatch(/fetch\('\/api\/portal\/auth\/2fa\/enable'/)
    expect(src).toMatch(/fetch\('\/api\/portal\/auth\/2fa\/disable'/)
    // Et l'état initial vient du serveur, pas d'une supposition locale.
    expect(src).toMatch(/twoFactorEnabled/)
    expect(src).toMatch(/backupCodesRemaining/)
  })

  it('les codes de secours ne peuvent pas être quittés par inadvertance', () => {
    // Ils ne sont rendus qu'UNE fois : refermer sans les noter enferme dehors
    // un client qui perdra ensuite son téléphone. La confirmation est donc
    // exigée — le bouton reste inerte tant qu'elle n'est pas cochée.
    expect(src).toMatch(/disabled=\{!compris\}/)
    expect(src).toMatch(/ne seront plus jamais affichés/)
    // Et il existe un moyen de les emporter sans les recopier à la main.
    expect(src).toMatch(/a\.download = 'garageflows-codes-de-secours\.txt'/)
  })

  it('les codes de secours ne repartent pas sur le réseau', () => {
    // Le téléchargement est LOCAL (Blob) : un envoi vers le serveur, même
    // « pour sauvegarde », annulerait l'intérêt de ne stocker que des hachés.
    const bloc = src.slice(src.indexOf('function CodesSecours'))
    expect(bloc).not.toMatch(/fetch\(/)
    expect(bloc).toMatch(/URL\.createObjectURL/)
  })

  it('un service sans clé de chiffrement est EXPLIQUÉ, pas rendu comme une panne', () => {
    // 503 TWOFA_UNAVAILABLE est un refus volontaire (GF-DUR-022). Afficher
    // « erreur » ferait réessayer indéfiniment un client qui n'y peut rien.
    expect(src).toMatch(/TWOFA_UNAVAILABLE/)
    expect(src).toMatch(/n’est pas une panne/)
  })

  it('le nombre de codes restants est affiché — ils s\'épuisent sans bruit', () => {
    expect(src).toMatch(/codesRestants/)
    expect(src).toMatch(/SEUIL_CODES_BAS/)
  })

  it('la désactivation demande le mot de passe AVANT de la tenter', () => {
    // Le serveur l'exige ; faire cliquer puis annoncer le refus serait une
    // impasse déguisée en bouton.
    expect(src).toMatch(/JSON\.stringify\(\{ password: motDePasse \}\)/)
    expect(src).toMatch(/type="password"/)
  })

  it('le changement de mot de passe est atteignable sans y être forcé', () => {
    // `/clients/password` n'était visée que par redirection : un client qui
    // voulait simplement changer son mot de passe n'avait aucun chemin.
    expect(espace).toMatch(/href=\{lienPortail\(cheminPortail\('password'\)\)\}/)
    expect(espace).toContain('Mot de passe')
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
