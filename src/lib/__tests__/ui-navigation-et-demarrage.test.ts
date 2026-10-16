/**
 * Garde-fous de l'interface — navigation, barre d'outils, fermeture, démarrage
 * automatique de Windows (exigences du 16/10/2026).
 *
 * Ces tests ne vérifient pas une apparence : ils vérifient des MÉCANISMES dont
 * la perte est invisible en relecture et coûteuse en atelier —
 *
 *   • la barre d'outils défilait VERTICALEMENT (les libellés glissaient hors du
 *     bandeau à la molette et « Tableau de bord » apparaissait tronqué) ;
 *   • les pages s'empilaient les unes sur les autres, seize booléens
 *     indépendants ne fermant jamais celle d'avant ;
 *   • les brouillons de saisie disparaissaient au premier aller-retour ;
 *   • des boutons de fermeture sans zone cliquable certaine, ou sans nom
 *     accessible.
 *
 * Ils lisent la source : ce sont des garde-fous de NON-RÉGRESSION, pas des
 * tests de rendu.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8')

describe('barre d’outils : défilement horizontal EXCLUSIVEMENT', () => {
  const css = lire('src/app/globals.css')
  const entete = lire('src/components/Header.tsx')

  it('la classe dédiée verrouille l’axe vertical et autorise l’horizontal', () => {
    const bloc = css.slice(css.indexOf('.gf-hscroll {'))
    expect(bloc).toBeTruthy()
    expect(bloc).toMatch(/overflow-x:\s*auto/)
    // C'est CE point qui manquait : `overflow-x: auto` seul rend l'autre axe
    // défilant (la spécification force `visible` → `auto`).
    expect(bloc).toMatch(/overflow-y:\s*hidden/)
    expect(bloc).toMatch(/flex-wrap:\s*nowrap/)
  })

  it('la barre d’outils l’utilise, et plus `overflow-x-auto`', () => {
    expect(entete).toContain('gf-hscroll')
    expect(entete).not.toMatch(/className="[^"]*overflow-x-auto[^"]*"/)
  })

  it('la bande des mécaniciens du planning suit la même règle', () => {
    const planning = lire('src/components/ScheduleBoard.tsx')
    expect(planning).toContain('gf-hscroll')
    expect(planning).not.toMatch(/overflow-x-auto scrollbar-hide/)
  })
})

describe('boutons de fermeture : zone cliquable RÉELLE et nommée', () => {
  const css = lire('src/app/globals.css')

  it('la zone élargie ne vole plus le clic des voisins', () => {
    const bloc = css.slice(css.indexOf('.gf-close::before'))
    expect(bloc.slice(0, 200)).toMatch(/pointer-events:\s*none/)
  })

  it('les cibles tactiles atteignent 40 px, et 44 px au doigt', () => {
    const bloc = css.slice(css.indexOf('.gf-close {'))
    expect(bloc.slice(0, 400)).toMatch(/min-width:\s*40px/)
    expect(bloc.slice(0, 400)).toMatch(/min-height:\s*40px/)
    expect(css).toMatch(/\.gf-close \{ min-width: 44px; min-height: 44px; \}/)
  })

  it('chaque bouton de fermeture PORTE un nom accessible', () => {
    const composants = fs.readdirSync(path.join(RACINE, 'src/components'))
      .filter((f) => f.endsWith('.tsx'))
    const sansNom: string[] = []
    for (const f of composants) {
      const src = lire(`src/components/${f}`)
      for (const m of src.matchAll(/<button[^>]*gf-close[^>]*>/g)) {
        // Le « Passer » de CompanySetup porte un TEXTE visible : le renommer
        // « Fermer » mentirait sur son effet.
        if (m[0].includes('aria-label')) continue
        const apres = src.slice(m.index ?? 0, (m.index ?? 0) + 260)
        if (/<X[^>]*\/>\s*<\/button>/.test(apres)) sansNom.push(f)
      }
    }
    expect(sansNom, `boutons de fermeture sans aria-label : ${sansNom.join(', ')}`).toEqual([])
  })
})

describe('fonds de panneaux : un clic à l’extérieur FERME le panneau', () => {
  it('le volet Stock ne laisse plus une surface morte autour de lui', () => {
    const stock = lire('src/components/StockPanel.tsx')
    const couche = stock.slice(stock.indexOf('<div className="fixed inset-0 z-40'))
    // Le panneau se déclare `aria-modal="true"` : laisser l'application cliquable
    // derrière est un mensonge pour l'utilisateur comme pour les lecteurs d'écran.
    expect(stock).toMatch(/aria-modal="true"/)
    expect(stock).not.toMatch(/className="fixed inset-0[^"]*pointer-events-none/)
    expect(couche).toMatch(/<button[\s\S]{0,400}?onClick=\{onClose\}/)
    // Le panneau reste AU-DESSUS du fond (sinon le fond intercepterait ses clics).
    expect(couche).toMatch(/relative z-\[1\][^"]*max-w-md/)
  })

  it('tout fond plein écran est cliquable et appelle la fermeture', () => {
    // Inventaire volontairement explicite : ces surfaces recouvrent l'application
    // et promettent la fermeture au clic extérieur.
    for (const fichier of ['StockPanel.tsx', 'BillingPanel.tsx', 'FinancialDashboard.tsx', 'GfDrawer.tsx']) {
      const src = lire(`src/components/${fichier}`)
      // Le gestionnaire peut précéder ou suivre la classe selon l'ordre des
      // attributs : on regarde des deux côtés du repère.
      const repere = src.indexOf('absolute inset-0 bg-black/60')
      expect(repere, `${fichier} : fond plein écran absent`).toBeGreaterThan(-1)
      const autour = src.slice(Math.max(0, repere - 320), repere + 320)
      expect(autour, `${fichier} : le fond ne ferme pas au clic`).toMatch(/onClick=\{onClose\}/)
    }
  })

  it('Échap referme aussi le volet Stock (voie clavier, sans souris)', () => {
    const page = lire('src/app/page.tsx')
    const raccourcis = page.slice(page.indexOf('onClose:'))
    expect(raccourcis.slice(0, 300)).toMatch(/if \(isStockPanelOpen\) toggleStockPanel\(\)/)
  })
})

describe('une SEULE page à l’écran (plus d’empilement)', () => {
  const page = lire('src/app/page.tsx')

  it('les seize booléens de page ont disparu au profit d’une variable unique', () => {
    expect(page).toContain('const [surface, setSurface] = useState<Surface | null>(null)')
    for (const ancien of ['isClientsOpen', 'isTicketsOpen', 'isBillingOpen', 'isReceptionBoardOpen']) {
      expect(page, `${ancien} ne doit plus exister`).not.toMatch(new RegExp(`set${ancien.charAt(0).toUpperCase()}${ancien.slice(1)}\\(`))
    }
    // `isApptsOpen` survit volontairement : c'est un TIROIR ouvert PAR-DESSUS le
    // tableau de bord (le gestionnaire de demandes), pas une page concurrente.
    expect(page).toMatch(/isApptsOpen && surface === 'dashboard'/)
    // Deux pages montées en même temps redeviendraient possibles si le montage
    // repassait par des booléens.
    expect(page).toMatch(/\{surface === 'clients'\s+&&/)
    expect(page).toMatch(/\{surface === 'billing'\s+&&/)
  })

  it('ouvrir une page referme la précédente ET le tiroir de stock', () => {
    const bloc = page.slice(page.indexOf('const ouvrirPage'), page.indexOf('const fermerPage'))
    expect(bloc).toMatch(/setSurface\(cible\)/)
    expect(bloc).toMatch(/if \(isStockPanelOpen\) toggleStockPanel\(\)/)
    expect(bloc).toMatch(/if \(isDashboardOpen\) toggleDashboard\(\)/)
  })

  it('les brouillons survivent à un changement de page, pas à un abandon', () => {
    const brouillon = lire('src/lib/ui/brouillon.ts')
    expect(brouillon).toContain('export function useBrouillonPersistant')
    expect(brouillon).toMatch(/if \(process\.env|brouillons\.set\(cle, valeur\)/)
    // ✕ / Échap = abandon : les brouillons de LA page sont effacés.
    const fermer = page.slice(page.indexOf('const fermerPage'), page.indexOf('// Le tableau de bord peut aussi'))
    expect(fermer).toMatch(/viderBrouillons\(prefixe\)/)
    // Et les panneaux à formulaire s'en servent réellement.
    for (const f of ['ClientsPanel', 'TicketsPanel', 'OcrPanel', 'CopilotPanel', 'WarrantyPanel', 'LaborCatalogPanel', 'ReminderPanel']) {
      expect(lire(`src/components/${f}.tsx`), f).toContain('useBrouillonPersistant')
    }
  })
})

describe('démarrage automatique de Windows (exigence du 16/10)', () => {
  const principal = lire('electron/main.js')
  const preload = lire('electron/preload.js')
  const reglages = lire('src/components/SettingsModal.tsx')
  const onglet = lire('src/components/settings/SystemeTab.tsx')

  it('le mécanisme est celui d’Electron, sans droits administrateur', () => {
    expect(principal).toContain('app.setLoginItemSettings(')
    expect(principal).toContain('app.getLoginItemSettings(')
    expect(principal).toMatch(/process\.platform !== 'win32'/)
    // L'installeur reste « asInvoker », et l'entrée va dans HKCU.
    const pkg = JSON.parse(lire('package.json'))
    expect(pkg.build.win.requestedExecutionLevel).toBe('asInvoker')
    expect(pkg.build.nsis.allowElevation).toBe(false)
    expect(pkg.build.nsis.perMachine).toBe(false)
  })

  it('l’état affiché est RELU du système, jamais déduit d’un booléen local', () => {
    // Écrire puis relire : annoncer l'état demandé au lieu de l'état obtenu
    // afficherait « Activé » sur un poste où Windows a refusé.
    const definition = principal.slice(principal.indexOf('function definirDemarrageAuto'))
    expect(definition).toMatch(/const etat = etatDemarrageAuto\(\)/)
    expect(definition).toMatch(/erreur: 'Windows n’a pas appliqué le réglage\.'/)
    expect(onglet).toMatch(/await relire\(\)/)
  })

  it('le pont est exposé et l’interrupteur cablé', () => {
    expect(preload).toContain("ipcRenderer.invoke('app:autostart-get')")
    expect(preload).toContain("ipcRenderer.invoke('app:autostart-set'")
    expect(principal).toContain("ipcMain.handle('app:autostart-get'")
    expect(principal).toContain("ipcMain.handle('app:autostart-set'")
    expect(reglages).toContain('<SystemeTab />')
    expect(onglet).toContain('useElectronApi')
    // Hors application installée : pas d'interrupteur factice.
    expect(onglet).toMatch(/if \(!dansApplication\)/)
  })
})
