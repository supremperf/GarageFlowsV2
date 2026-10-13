/**
 * GF-024 — dix écrans annonçaient un succès que le serveur n'avait pas accordé.
 *
 * Le défaut est toujours le même, et c'est ce qui le rend dangereux : le message
 * de réussite est écrit à côté de l'appel, pas après sa réponse. Aucun de ces
 * dix cas n'échoue « bruyamment » — ils laissent l'utilisateur avec une
 * certitude fausse, et parfois une donnée perdue.
 *
 * Recensés et vérifiés un par un dans le code :
 *   · activation d'une licence depuis la Zone Administrateur — cinq refus de
 *     cette route répondent en HTTP 200 avec `{ ok: false }` ;
 *   · « Vous utilisez la dernière version » quand AUCUNE source n'a répondu ;
 *   · « Export terminé — vérifiez votre bureau » sur un dossier vide ;
 *   · « J'ai compris » sur une notification obligatoire dont l'accusé n'est pas
 *     parti — la surimpression se lève, l'éditeur n'a rien reçu ;
 *   · « Intervention mise à jour » avant la réponse, modale refermée ;
 *   · glisser-déposer et redimensionnement confirmés avant l'accord du serveur ;
 *   · « Interventions redistribuées ! » alors que les écritures partent à
 *     l'aveugle et que leurs échecs sont jetés ;
 *   · barème main-d'œuvre refermé comme s'il était enregistré ;
 *   · « Plateforme déconnectée. » sans regarder le refus du serveur ;
 *   · téléchargement manuel d'une mise à jour non signée : le bouton n'ouvrait
 *     rien du tout dans l'application packagée.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

/** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
const sansCommentaires = (s: string) => s
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Extrait le corps d'une fonction/gestionnaire à partir d'un repère textuel. */
function bloc(src: string, repere: string, longueur = 1800): string {
  const i = src.indexOf(repere)
  expect(i, `repère introuvable : ${repere}`).toBeGreaterThan(-1)
  return src.slice(i, i + longueur)
}

describe('aucun succès annoncé avant le verdict du serveur (GF-024)', () => {
  it('activation de licence (admin) : un 200 ne suffit plus', () => {
    const src = sansCommentaires(lire('src/app/admin/licenses/page.tsx'))
    const b = bloc(src, "fetch('/api/license/activate'")
    expect(b, 'le corps de la réponse doit être lu').toMatch(/await r\.json\(\)/)
    expect(b, 'cette route refuse en 200 avec ok:false').toMatch(/d\?\.ok === false/)
    expect(b, 'le refus doit être visible').toMatch(/toast\.error/)
  })

  it('vérification de mise à jour : « à jour » exige une source qui a répondu', () => {
    const onglet = sansCommentaires(lire('src/components/settings/UpdatesTab.tsx'))
    expect(onglet).toMatch(/checked === false/)
    const main = sansCommentaires(lire('electron/main.js'))
    expect(main, 'le processus principal doit distinguer les deux cas')
      .toMatch(/Aucune source de mise à jour joignable/)
    expect(main).toMatch(/sourceRepondu/)
  })

  it('la version affichée n’est plus « 1.0.0 » en dur', () => {
    const onglet = sansCommentaires(lire('src/components/settings/UpdatesTab.tsx'))
    expect(onglet).toMatch(/NEXT_PUBLIC_GF_VERSION/)
    expect(onglet).not.toMatch(/useState\('1\.0\.0'\)/)
  })

  it('export bureau : le verdict est rendu puis lu', () => {
    const main = sansCommentaires(lire('electron/main.js'))
    const handler = bloc(main, "ipcMain.handle('app:desktop-export-now'", 400)
    expect(handler, 'le retour ne doit plus être inconditionnel').not.toMatch(/return \{ ok: true \}/)
    expect(handler).toMatch(/await runDesktopExport\(\)/)
    const onglet = sansCommentaires(lire('src/components/settings/ThemeTab.tsx'))
    expect(onglet).toMatch(/if \(!r\?\.ok\)/)
  })

  it('notification obligatoire : la surimpression ne se lève que si l’accusé est parti', () => {
    const src = sansCommentaires(lire('src/components/NotificationCenter.tsx'))
    const b = bloc(src, 'const ack = useCallback')
    expect(b).toMatch(/if \(!r\?\.ok\)/)
    // Le `setNotifs` optimiste était HORS du try : il doit désormais suivre le
    // contrôle, jamais le précéder.
    expect(b.indexOf('if (!r?.ok)')).toBeLessThan(b.indexOf('setNotifs('))
  })

  it('modale d’intervention : le succès suit la réponse', () => {
    const src = sansCommentaires(lire('src/components/JobModal.tsx'))
    const b = bloc(src, 'const handleSubmit = useCallback')
    expect(b, 'le gestionnaire doit être asynchrone').toMatch(/useCallback\(async \(\)/)
    expect(b).toMatch(/await updateJob\(/)
    expect(b, 'un refus doit interrompre avant le message').toMatch(/if \(!ok\) return/)
    expect(b, 'addJob relance : le try / catch est indispensable').toMatch(/catch/)
  })

  it('planning : déplacement et redimensionnement attendent l’accord', () => {
    const src = sansCommentaires(lire('src/components/ScheduleBoard.tsx'))
    expect(src).toMatch(/const ok = await moveJob\(/)
    expect(src).toMatch(/const ok = await updateJob\(/)
    expect(src).toMatch(/if \(ok\) toast\.success/)
  })

  it('le magasin rend le verdict au lieu de l’avaler', () => {
    const store = sansCommentaires(lire('src/store/schedule-store.ts'))
    expect(store).toMatch(/updateJob:\s+\(id: string, updates: Partial<Job>\)\s+=> Promise<boolean>/)
    expect(store).toMatch(/moveJob:\s+\(jobId: string, mechanicId: string, startTime: string\) => Promise<boolean>/)
  })

  it('redistribution : les écritures sont attendues, leurs échecs comptés', () => {
    const store = sansCommentaires(lire('src/store/schedule-store.ts'))
    // On vise l'IMPLÉMENTATION, pas la déclaration de l'interface qui la précède.
    const b = bloc(store, 'redistributeAbsentMechanic: (mechanicId) => {', 2200)
    expect(b, 'les PATCH partaient sans être attendus').toMatch(/Promise\.allSettled/)
    expect(b, 'un échec doit recharger et le dire').toMatch(/rejected/)
    expect(b).not.toMatch(/\.catch\(\(\) => null\)/)
  })

  it('barème main-d’œuvre : la fermeture n’est plus le signal de succès', () => {
    const src = sansCommentaires(lire('src/components/LaborCatalogPanel.tsx'))
    const b = bloc(src, 'async function save()')
    expect(b).toMatch(/if \(!res\.ok\)/)
    expect(b).toMatch(/toast\.error/)
    const d = bloc(src, 'async function del(')
    expect(d).toMatch(/if \(!res\.ok\)/)
  })

  it('déconnexion e-facturation : le refus est lu, `disconnected` aussi', () => {
    const src = sansCommentaires(lire('src/components/settings/EInvoicingConnectionForm.tsx'))
    const b = bloc(src, 'async function deconnecter()')
    expect(b).toMatch(/if \(!r\.ok \|\| j\?\.ok === false\)/)
    expect(b, 'le champ renvoyé par la route doit être exploité').toMatch(/disconnected/)
  })

  it('téléchargement manuel d’une mise à jour non signée : la fenêtre s’ouvre', () => {
    // Les deux seules sources sans manifeste étaient précisément celles que le
    // garde d'ouverture externe refusait : GitHub et l'installeur publié en
    // local. Le bouton ne faisait rien, sans message.
    const main = sansCommentaires(lire('electron/main.js'))
    expect(main, 'le chemin des installeurs publiés doit être déclaré')
      .toContain("PREFIXE_INSTALLEUR_LOCAL = '/api/admin/updates/file/'")
    const b = bloc(main, 'setWindowOpenHandler', 1600)
    expect(b.includes('github.com')).toBe(true)
    expect(b).toMatch(/PREFIXE_INSTALLEUR_LOCAL/)
    expect(b, 'la boucle locale s’écrit 127.0.0.1 ET localhost').toMatch(/127\.0\.0\.1/)
    expect(b, 'aucune ouverture arbitraire').toMatch(/return \{ action: 'deny' \}/)
  })
})
