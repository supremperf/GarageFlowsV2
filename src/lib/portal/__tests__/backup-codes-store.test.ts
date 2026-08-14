/**
 * GF-DUR-025 — le retrait d'un code de secours résiste à un entrelacement CHOISI.
 *
 * ─── Pourquoi ce test-ci existe en plus de l'intégration ────────────────────
 * Le test d'intégration lance deux requêtes en `Promise.all` et espère qu'elles
 * se chevauchent. Pour « le même code deux fois » c'est fiable — la mutation le
 * fait bien tomber. Pour « deux codes différents », non : mesuré, l'ordre
 * observé sérialisait les deux opérations, et le test passait MÊME avec la
 * protection retirée. Il ne prouvait donc rien de ce qu'il annonçait.
 *
 * Ici l'entrelacement n'est pas espéré, il est IMPOSÉ : les deux lectures ont
 * lieu avant la première écriture, ce qui est exactement l'ordre où le
 * lire-modifier-écrire perd une écriture. Le résultat ne dépend plus de
 * l'ordonnanceur, donc le test ne peut ni être flottant, ni passer par chance.
 */

import { describe, it, expect } from 'vitest'
import { generateBackupCodes } from '../backup-codes'
import { consommerCodeSecours, TENTATIVES_MAX, type DepotCodesSecours } from '../backup-codes-store'

/**
 * Dépôt en mémoire dont on contrôle le moment des lectures et des écritures.
 *
 * `updateMany` applique la même règle que le moteur : la mise à jour ne touche
 * la ligne QUE si la valeur observée est encore la valeur courante.
 */
function depotPilote(initial: string[]) {
  const etat = { brut: JSON.stringify(initial) }
  const attentes: Array<() => void> = []
  const depot: DepotCodesSecours = {
    portalUser: {
      async findUnique() {
        return { backupCodes: etat.brut }
      },
      async updateMany(a) {
        // Point de suspension : l'écriture n'a lieu qu'une fois relâchée.
        await new Promise<void>((r) => attentes.push(r))
        if (a.where.backupCodes !== undefined && a.where.backupCodes !== etat.brut) return { count: 0 }
        etat.brut = a.data.backupCodes
        return { count: 1 }
      },
    },
  }
  return {
    depot,
    etat,
    /** Relâche les écritures en attente, dans l'ordre où elles sont arrivées. */
    async relacher() {
      // Boucle : une reprise après conflit ajoute une NOUVELLE attente.
      for (let tour = 0; tour < TENTATIVES_MAX + 2 && attentes.length; tour++) {
        attentes.splice(0).forEach((r) => r())
        await new Promise((r) => setTimeout(r, 0))
      }
    },
    /** Attend que `n` écritures soient en attente — donc que les lectures soient faites. */
    async attendre(n: number) {
      for (let i = 0; i < 200 && attentes.length < n; i++) await new Promise((r) => setTimeout(r, 0))
      expect(attentes.length, 'les opérations ne se sont pas chevauchées').toBe(n)
    },
  }
}

describe('consommerCodeSecours — entrelacement imposé', () => {
  it('deux codes DIFFÉRENTS : les deux sont consommés, aucun ne réapparaît', async () => {
    const { codes, hashes } = generateBackupCodes(4)
    const d = depotPilote(hashes)

    // Les deux lectures ont lieu AVANT la première écriture : l'ordre exact où
    // un lire-modifier-écrire perd une modification.
    const p1 = consommerCodeSecours(d.depot, 'u1', codes[0])
    const p2 = consommerCodeSecours(d.depot, 'u1', codes[1])
    await d.attendre(2)
    await d.relacher()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toEqual({ ok: true, restants: 3 })
    expect(r2).toEqual({ ok: true, restants: 2 })

    const restants = JSON.parse(d.etat.brut) as string[]
    expect(restants).toHaveLength(2)
    // La preuve : ni l'un ni l'autre n'est revenu dans la liste.
    expect(restants).not.toContain(hashes[0])
    expect(restants).not.toContain(hashes[1])
    // Et les deux non utilisés sont intacts — le test ne passe pas « parce que
    // tout aurait été effacé ».
    expect(restants).toEqual([hashes[2], hashes[3]])
  })

  it('le MÊME code deux fois : un seul retrait, le second ne trouve plus rien', async () => {
    const { codes, hashes } = generateBackupCodes(3)
    const d = depotPilote(hashes)

    const p1 = consommerCodeSecours(d.depot, 'u1', codes[0])
    const p2 = consommerCodeSecours(d.depot, 'u1', codes[0])
    await d.attendre(2)
    await d.relacher()
    const issues = await Promise.all([p1, p2])

    expect(issues.filter((i) => i.ok)).toHaveLength(1)
    expect(issues.filter((i) => !i.ok && i.motif === 'inconnu')).toHaveLength(1)
    expect(JSON.parse(d.etat.brut)).toEqual([hashes[1], hashes[2]])
  })

  it('un code inconnu n’écrit RIEN — une tentative ratée ne touche pas la colonne', async () => {
    const { hashes } = generateBackupCodes(3)
    const d = depotPilote(hashes)
    const avant = d.etat.brut

    expect(await consommerCodeSecours(d.depot, 'u1', 'ZZZZ-ZZZZ')).toEqual({ ok: false, motif: 'inconnu' })
    expect(d.etat.brut).toBe(avant)
  })

  it('conflit permanent : refus explicite, jamais une écriture inconditionnelle', async () => {
    const { codes, hashes } = generateBackupCodes(3)
    // Dépôt hostile : la valeur change à CHAQUE lecture, donc aucun CAS ne peut
    // aboutir. On vérifie qu'on renonce au lieu de forcer l'écriture.
    let n = 0
    const brut = () => JSON.stringify([...hashes, `${n++}`.padStart(64, 'f')])
    let ecritures = 0
    const depot: DepotCodesSecours = {
      portalUser: {
        async findUnique() { return { backupCodes: brut() } },
        async updateMany() { ecritures++; return { count: 0 } },
      },
    }

    expect(await consommerCodeSecours(depot, 'u1', codes[0])).toEqual({ ok: false, motif: 'conflit' })
    expect(ecritures).toBe(TENTATIVES_MAX)
  })

  it('une colonne illisible ne fait pas tomber la vérification', async () => {
    const depot: DepotCodesSecours = {
      portalUser: {
        async findUnique() { return { backupCodes: '{pas du json' } },
        async updateMany() { return { count: 1 } },
      },
    }
    expect(await consommerCodeSecours(depot, 'u1', 'ABCD-EFGH')).toEqual({ ok: false, motif: 'inconnu' })
  })
})
