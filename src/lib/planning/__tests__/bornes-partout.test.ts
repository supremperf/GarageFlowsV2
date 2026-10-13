/**
 * GF-033 — les horaires du garage sont lus PARTOUT où ils comptent (§14-15).
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Les horaires étaient enregistrés, et la grille du planning les lisait bien
 * (GF-021). Mais tout le reste du raisonnement horaire continuait de retomber
 * sur les constantes `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR` (8 h – 18 h) :
 *
 *   · le bouton « créneau auto » de la modale (`findBestSlot`) proposait 08:00
 *     à un garage ouvrant à 7 h, et un créneau APRÈS la fermeture à un garage
 *     fermant à 16 h — que la grille refusait ensuite d'afficher ;
 *   · le taux d'occupation du tableau de bord divisait par 600 minutes : un
 *     garage ouvert de 8 h à 12 h, COMPLET, plafonnait à 40 % ;
 *   · les suggestions (créneaux libres, surcharge, rééquilibrage) et la
 *     redistribution après absence raisonnaient sur la même journée imaginaire.
 *
 * Et surtout, les bornes s'exprimaient en HEURES ENTIÈRES : 8 h 30 était
 * inexprimable, alors que la saisie l'exige.
 *
 * Ce garde est GÉNÉRIQUE : il échoue si un nouvel appelant oublie les bornes,
 * plutôt que de lister les quatre corrigés aujourd'hui.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')

/** Fichiers source du produit (ni tests, ni fixtures). */
function sources(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      sources(p, acc)
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      acc.push(p)
    }
  }
  return acc
}

/**
 * Retire les commentaires. L'ORDRE EST IMPOSÉ : les commentaires de LIGNE
 * d'abord, les blocs ensuite. Dans l'autre sens, un `/*` cité à l'intérieur
 * d'un `//` avale le code qui suit jusqu'au prochain `*` suivi d'un slash.
 */
const sansCommentaires = (src: string) =>
  src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Fonctions dont le dernier paramètre est les bornes de l'atelier. */
const A_BORNES = [
  'findBestSlot',
  'findAvailableSlots',
  'detectEmptySlots',
  'calculateUtilizationRate',
  'redistributeAfterAbsence',
]

/** Nombre d'arguments attendus AVANT les bornes, par fonction. */
const ARITE_SANS_BORNES: Record<string, number> = {
  findBestSlot: 4,
  findAvailableSlots: 4,
  detectEmptySlots: 3,
  calculateUtilizationRate: 3,
  redistributeAfterAbsence: 4,
}

/** Découpe les arguments d'un appel au premier niveau de parenthèses. */
function arguments1erNiveau(src: string, ouvrante: number): string[] | null {
  let profondeur = 0
  let debut = ouvrante + 1
  const args: string[] = []
  for (let i = ouvrante; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '[' || c === '{') profondeur++
    else if (c === ')' || c === ']' || c === '}') {
      profondeur--
      if (profondeur === 0) {
        const dernier = src.slice(debut, i).trim()
        if (dernier) args.push(dernier)
        return args
      }
    } else if (c === ',' && profondeur === 1) {
      args.push(src.slice(debut, i).trim())
      debut = i + 1
    }
  }
  return null
}

describe('GF-033 — aucun calcul horaire n’ignore les horaires du garage', () => {
  const fichiers = sources(RACINE)

  it('les quatre fonctions de créneaux existent bien (le garde ne vise pas dans le vide)', () => {
    const utils = fs.readFileSync(path.join(RACINE, 'lib/utils.ts'), 'utf8')
    for (const f of ['findBestSlot', 'findAvailableSlots', 'detectEmptySlots', 'calculateUtilizationRate']) {
      expect(utils, `${f} a disparu : ce garde doit être mis à jour`).toContain(`export function ${f}`)
    }
  })

  it('tout APPEL passe explicitement les bornes', () => {
    const manquants: string[] = []

    for (const fichier of fichiers) {
      // Les définitions elles-mêmes portent le paramètre par défaut : on ne
      // vérifie que les appels, dans les fichiers qui ne les définissent pas.
      const src = sansCommentaires(fs.readFileSync(fichier, 'utf8'))
      for (const fn of A_BORNES) {
        if (src.includes(`export function ${fn}`)) continue
        const motif = new RegExp(`\\b${fn}\\s*\\(`, 'g')
        let m: RegExpExecArray | null
        while ((m = motif.exec(src)) !== null) {
          const args = arguments1erNiveau(src, m.index + m[0].length - 1)
          if (!args) continue
          if (args.length <= ARITE_SANS_BORNES[fn]) {
            manquants.push(`${path.relative(RACINE, fichier)} → ${fn}(${args.length} arg.)`)
          }
        }
      }
    }

    expect(
      manquants,
      'un appel sans bornes retombe silencieusement sur 8 h – 18 h',
    ).toEqual([])
  })

  it('`runAIEngine` reçoit toujours des bornes', () => {
    const manquants: string[] = []
    for (const fichier of fichiers) {
      const src = sansCommentaires(fs.readFileSync(fichier, 'utf8'))
      if (src.includes('export function runAIEngine')) continue
      const motif = /\brunAIEngine\s*\(/g
      let m: RegExpExecArray | null
      while ((m = motif.exec(src)) !== null) {
        const args = arguments1erNiveau(src, m.index + m[0].length - 1)
        if (!args || args.length === 0) continue
        if (!args[0].includes('bornes')) {
          manquants.push(path.relative(RACINE, fichier))
        }
      }
    }
    expect(manquants, 'le moteur raisonnerait sur une journée imaginaire').toEqual([])
  })

  it('les bornes ne s’expriment plus en heures entières', () => {
    // `workshopStartHour` reste une COLONNE (avec sa minute associée) ; ce qui
    // ne doit plus exister, c'est un paramètre de calcul en heures pleines.
    const utils = fs.readFileSync(path.join(RACINE, 'lib/utils.ts'), 'utf8')
    expect(utils).not.toMatch(/workshopStartHour\s*=\s*WORKSHOP_START_HOUR/)
    expect(utils).toContain('bornes: BornesAtelier = BORNES_PAR_DEFAUT')
  })
})
