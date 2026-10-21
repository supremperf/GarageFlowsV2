import { describe, it, expect } from 'vitest'
import { createTxQueue, serializeTransactions } from '@/lib/sqlite-tx-queue'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('file de transactions SQLite', () => {
  it('exécute les tâches une à la fois, dans l’ordre d’arrivée', async () => {
    const q = createTxQueue()
    const journal: string[] = []
    let enCours = 0
    let maxEnCours = 0
    const tache = (nom: string, ms: number) => q.run(async () => {
      enCours++; maxEnCours = Math.max(maxEnCours, enCours)
      journal.push(`début ${nom}`)
      await pause(ms)
      journal.push(`fin ${nom}`)
      enCours--
      return nom
    })
    expect(await Promise.all([tache('A', 15), tache('B', 1), tache('C', 5)])).toEqual(['A', 'B', 'C'])
    expect(maxEnCours).toBe(1)
    expect(journal).toEqual(['début A', 'fin A', 'début B', 'fin B', 'début C', 'fin C'])
  })

  it('un échec est propagé à son appelant et ne bloque pas la file', async () => {
    const q = createTxQueue()
    const echec = q.run(async () => { throw new Error('panne') })
    const suivante = q.run(async () => 'ok')
    await expect(echec).rejects.toThrow('panne')
    await expect(suivante).resolves.toBe('ok')
  })

  it('une transaction ouverte depuis une autre ne s’attend pas elle-même', async () => {
    const q = createTxQueue()
    const r = await q.run(() => q.run(async () => 'imbriquée'))
    expect(r).toBe('imbriquée')
  })

  it('serializeTransactions enveloppe $transaction (formes interactive et tableau)', async () => {
    let enCours = 0
    let maxEnCours = 0
    const client = {
      async $transaction(arg: unknown) {
        enCours++; maxEnCours = Math.max(maxEnCours, enCours)
        await pause(3)
        enCours--
        return typeof arg === 'function' ? (arg as (tx: string) => unknown)('tx') : arg
      },
    }
    serializeTransactions(client)
    const res = await Promise.all([
      client.$transaction((tx: string) => `${tx}-1`),
      client.$transaction(['a', 'b']),
      client.$transaction((tx: string) => `${tx}-3`),
    ])
    expect(res).toEqual(['tx-1', ['a', 'b'], 'tx-3'])
    expect(maxEnCours).toBe(1)
  })
})
