import { describe, it, expect } from 'vitest'
import { groupPendingUpdates, pendingKeysForItem } from '../inspection-autosave'

describe('groupPendingUpdates — flush de TOUS les items en attente', () => {
  it('regroupe les modifications de plusieurs items (le bug : seul le dernier était flushé)', () => {
    const pending = new Map<string, string | null>([
      ['itemA:note', 'A note'],
      ['itemA:status', 'ok'],
      ['itemB:note', 'B note'],
      ['itemC:status', 'ko'],
    ])
    const patches = groupPendingUpdates(pending)
    expect(patches).toHaveLength(3) // A, B et C — pas seulement le dernier
    const a = patches.find((p) => p.itemId === 'itemA')!
    expect(a.fields).toEqual({ note: 'A note', status: 'ok' })
    expect(patches.find((p) => p.itemId === 'itemB')!.fields).toEqual({ note: 'B note' })
    expect(patches.find((p) => p.itemId === 'itemC')!.fields).toEqual({ status: 'ko' })
  })

  it('map vide → aucun patch', () => {
    expect(groupPendingUpdates(new Map())).toEqual([])
  })

  it('préserve les valeurs null (effacement d\'un champ)', () => {
    const patches = groupPendingUpdates(new Map([['i1:photoPath', null]]))
    expect(patches).toEqual([{ itemId: 'i1', fields: { photoPath: null } }])
  })

  it('ignore les clés malformées (sans id ou sans champ)', () => {
    const patches = groupPendingUpdates(new Map([
      [':orphan', 'x'],
      ['noSeparator', 'y'],
      ['id:', 'z'],
      ['good:field', 'v'],
    ]))
    expect(patches).toEqual([{ itemId: 'good', fields: { field: 'v' } }])
  })

  it('pendingKeysForItem reconstruit les clés d\'origine (pour suppression après envoi)', () => {
    const [patch] = groupPendingUpdates(new Map([['x:a', '1'], ['x:b', '2']]))
    expect(pendingKeysForItem(patch).sort()).toEqual(['x:a', 'x:b'])
  })
})
