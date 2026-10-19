/**
 * GF-018 — la consommation de pièces n'avait aucun écran, donc aucune donnée.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `POST /api/jobs/:id/parts` (transactionnelle, idempotente, refusant un stock
 * insuffisant en 409) et son `DELETE` n'étaient appelés par AUCUN écran : les
 * trois seuls appels du produit à cette route étaient des GET. La table
 * `JobPart` restait donc vide sur toute installation réelle.
 *
 * Tout ce qui la lit rendait des zéros — et le disait avec aplomb :
 *  · « Rentabilité » déclarait dormante chaque pièce du stock, y compris celles
 *    vendues la veille, et n'affichait aucune marge par pièce ;
 *  · « Prévision de stock » annonçait « consommation moyenne 0 » pour chaque
 *    référence et ne recommandait jamais de réapprovisionnement ;
 *  · l'historique d'un véhicule affichait 0 € de pièces ;
 *  · le copilote raisonnait sur ces zéros.
 *
 * Le module prédictif était inerte sur 100 % des installations — non par défaut
 * de calcul, mais faute d'un écran pour saisir la donnée d'entrée. C'est
 * exactement le cas que ce dépôt appelle « du code présent qui n'est pas une
 * fonctionnalité ».
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

/** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
const sansCommentaires = (src: string) => src
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('pièces d’une intervention — la route a enfin un appelant (GF-018)', () => {
  const section = () => sansCommentaires(lire('src/components/job-modal/JobPartsSection.tsx'))

  it('l’écran AJOUTE réellement une pièce (POST)', () => {
    const src = section()
    expect(src).toMatch(/fetch\(`\/api\/jobs\/\$\{jobId\}\/parts`,\s*\{[\s\S]{0,200}method:\s*'POST'/)
    expect(src, 'la pièce choisie et la quantité doivent partir').toMatch(/partId:\s*choisie\.id/)
    expect(src).toMatch(/quantity:\s*q/)
  })

  it('l’écran RETIRE une pièce et restitue le stock (DELETE)', () => {
    const src = section()
    expect(src).toMatch(/method:\s*'DELETE'/)
    expect(src, 'le contrat de la route est `{ jobPartId }`').toMatch(/jobPartId:\s*ligne\.id/)
  })

  it('aucun succès annoncé avant la réponse du serveur', () => {
    const src = section()
    // Le refus le plus fréquent — stock insuffisant, 409 — doit se voir.
    expect(src).toMatch(/if\s*\(!res\.ok\)/)
    const posSucces = src.indexOf('toast.success')
    const posControle = src.indexOf('if (!res.ok)')
    expect(posControle, 'contrôle de la réponse introuvable').toBeGreaterThan(-1)
    expect(posSucces, 'le succès doit être annoncé APRÈS le contrôle').toBeGreaterThan(posControle)
  })

  it('le motif de refus du serveur est affiché, pas remplacé', () => {
    expect(section()).toMatch(/corps\?\.error/)
  })

  it('la modale d’intervention monte la section en mode ÉDITION', () => {
    const modale = sansCommentaires(lire('src/components/JobModal.tsx'))
    expect(modale).toContain('JobPartsSection')
    expect(modale, 'le stock s’engage sur une intervention qui EXISTE')
      .toMatch(/jobModalMode === 'edit' && editingJob && \(\s*<JobPartsSection/)
  })

  it('l’écran réutilise l’autocomplétion de stock existante', () => {
    // Une seconde recherche de pièces serait une seconde vérité de plus.
    expect(section()).toContain('PartAutocomplete')
  })

  it('le coût d’achat n’est pas supposé présent', () => {
    // La route l'expurge pour les rôles sans `financial:read` (GF-007) : le
    // déclarer facultatif interdit d'afficher un « 0 € » inventé.
    expect(section()).toMatch(/unitCost\?:/)
  })
})
