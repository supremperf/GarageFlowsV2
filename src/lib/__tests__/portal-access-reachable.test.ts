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
