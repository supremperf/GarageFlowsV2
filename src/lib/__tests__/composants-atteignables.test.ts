/**
 * GF-040 — un module complet, mais qu'aucun écran ne peut ouvrir.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `WorkOrderModal` existait entièrement : routes serveur, signature du client,
 * impression, préfixe de numérotation réglable dans les paramètres, et il était
 * l'unique appelant de `/api/work-orders*`. Mais il n'était **importé nulle
 * part** : aucun bouton, aucun menu, aucun chemin ne l'ouvrait. Le catalogue de
 * main-d'œuvre, dont il est le seul consommateur, devenait par ricochet une
 * saisie sans débouché — un garage pouvait y passer une heure pour rien.
 *
 * ─── Pourquoi la garde existante ne le voyait pas ───────────────────────────
 * `routes-sans-appelant.test.ts` cherche la chaîne d'une route dans n'importe
 * quel fichier source non-test. `WorkOrderModal.tsx` est un fichier source :
 * un composant jamais monté satisfaisait donc la garde en se citant lui-même.
 * Ce test ferme cet angle mort — il regarde qui IMPORTE le composant, pas qui
 * mentionne la route.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../..')

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['__tests__', 'node_modules', 'generated', 'integration', 'test-utils'].includes(e.name)) continue
      sources(p, acc)
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      acc.push(p)
    }
  }
  return acc
}

/**
 * L'ORDRE est imposé : commentaires de LIGNE d'abord, blocs ensuite. Dans
 * l'autre sens, un `/*` cité dans un `//` avale le code qui suit.
 */
const sansCommentaires = (src: string) =>
  src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * Modales de PREMIER PLAN : elles n'ont de sens qu'ouvertes depuis un écran.
 * Les composants de présentation (cartes, champs, sections) sont montés par
 * leur parent et sortent de ce périmètre.
 */
const MODALES = [
  'WorkOrderModal',
  'QuoteInvoiceModal',
  'InspectionModal',
  'VehicleHistoryModal',
  'WarrantyPanel',
  'LoanerPanel',
  'LaborCatalogPanel',
  'ClientsPanel',
  'SuppliersPanel',
]

describe('GF-040 — toute modale est atteignable depuis un écran', () => {
  const fichiers = sources(path.join(RACINE, 'components'))
    .concat(sources(path.join(RACINE, 'app')))
    .map((f) => ({ f, texte: sansCommentaires(fs.readFileSync(f, 'utf8')) }))

  it.each(MODALES)('%s est importé par au moins un autre fichier', (nom) => {
    const definition = fichiers.find(({ texte }) =>
      new RegExp(`export default function ${nom}\\b`).test(texte)
      || new RegExp(`export function ${nom}\\b`).test(texte))
    expect(definition, `${nom} n'existe plus : mettez ce garde à jour`).toBeTruthy()

    // Trois formes comptent comme un montage :
    //   · `import X from '…'`            — import statique ;
    //   · `import { X } from '…'`        — import nommé ;
    //   · `const X = dynamic(() => import('…/X'))` — chargement DIFFÉRÉ, qui
    //     est la forme recommandée pour un panneau ouvert à la demande. Ne pas
    //     la reconnaître ferait échouer ce garde sur du code plus sain que
    //     celui qu'il protège.
    const importeurs = fichiers.filter(({ f, texte }) =>
      f !== definition!.f && new RegExp(
        `import\\s+${nom}\\b`
        + `|\\{[^}]*\\b${nom}\\b[^}]*\\}\\s*from`
        + `|const\\s+${nom}\\s*=\\s*dynamic\\(`,
      ).test(texte))

    expect(
      importeurs.map((i) => path.relative(RACINE, i.f)),
      `${nom} n'est monté par aucun écran : le module est injoignable, quoi qu'il contienne`,
    ).not.toEqual([])
  })

  it('l’ordre de réparation s’ouvre bien depuis la fiche d’intervention', () => {
    const jobModal = fichiers.find(({ f }) => f.endsWith('JobModal.tsx'))!.texte
    expect(jobModal).toContain('<WorkOrderModal')
    expect(jobModal).toContain('setIsWorkOrderOpen(true)')
  })

  it('le catalogue main-d’œuvre a de nouveau un consommateur', () => {
    // Il n'en avait qu'un — l'ordre de réparation — et celui-ci était
    // injoignable : le barème ne servait donc à rien.
    const consommateurs = fichiers.filter(({ texte }) => texte.includes('/api/labor-operations'))
    expect(consommateurs.length, 'aucun écran ne lit le barème').toBeGreaterThan(0)
  })
})

describe('GF-040 — aucun bloc d’interface sans écrivain', () => {
  it('`RepairTypePart` n’est plus AFFICHÉ, faute de quoi que ce soit qui l’écrive', () => {
    // Aucune route, aucun écran, aucun jeu de démonstration, aucune sauvegarde
    // n'écrit cette table : le bloc « pièces habituelles » était vide sur toute
    // installation, et relançait une requête à chaque changement de type.
    const ecrivains = sources(RACINE)
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => /repairTypePart\s*\.\s*(create|createMany|update|upsert|delete)/i
        .test(fs.readFileSync(f, 'utf8')))
    expect(ecrivains, 'si un écrivain apparaît, le bloc peut revenir').toEqual([])

    const jobModal = fs.readFileSync(path.join(RACINE, 'components/JobModal.tsx'), 'utf8')
    expect(jobModal).not.toContain('JobDefaultPartsSuggestion')
    expect(jobModal, 'la requête toujours vide est supprimée').not.toContain('?repairType=')
  })
})
