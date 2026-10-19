/**
 * Normalisation COMMUNE des recherches (§45) et disparition de l'annuaire
 * parallèle en `localStorage` (GF-016).
 *
 * Chaque écran normalisait à sa façon — ou pas du tout : la recherche de
 * véhicule comparait les plaques telles que saisies (« AB-123-CD » ne trouvait
 * pas « AB123CD »), l'autocomplétion client comparait des minuscules sans
 * retirer les accents (« Lefevre » ne trouvait pas « Lefèvre »).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  normaliserTexte, normaliserPlaque, correspond, correspondPlaque,
} from '@/lib/recherche/normalisation'

describe('normalisation de texte', () => {
  it('retire les accents et met en minuscules', () => {
    expect(normaliserTexte('Hélène LEFÈVRE')).toBe('helene lefevre')
    expect(normaliserTexte('Citroën')).toBe('citroen')
    expect(normaliserTexte('Bœuf')).toBe('boeuf')
  })

  it('normalise espaces, tirets et apostrophes', () => {
    expect(normaliserTexte('  Jean   Dupont  ')).toBe('jean dupont')
    expect(normaliserTexte('Saint-Étienne')).toBe('saint etienne')
    expect(normaliserTexte('L’Atelier')).toBe("l'atelier")
  })

  it('tolère null et undefined', () => {
    expect(normaliserTexte(null)).toBe('')
    expect(normaliserTexte(undefined)).toBe('')
  })
})

describe('normalisation de plaque', () => {
  it('ignore les séparateurs et la casse', () => {
    expect(normaliserPlaque('ab-123-cd')).toBe('AB123CD')
    expect(normaliserPlaque('AB 123 CD')).toBe('AB123CD')
    expect(normaliserPlaque('AB123CD')).toBe('AB123CD')
  })

  it('les anciens formats se comparent aussi', () => {
    expect(normaliserPlaque('1234 AB 56')).toBe('1234AB56')
  })
})

describe('correspondance', () => {
  it('une recherche VIDE ne correspond à rien', () => {
    // C'est ainsi qu'une autocomplétion se met à proposer le début de la table.
    expect(correspond('Jean Dupont', '')).toBe(false)
    expect(correspond('Jean Dupont', '   ')).toBe(false)
    expect(correspondPlaque('AB-123-CD', '')).toBe(false)
  })

  it('trouve malgré accents, casse et séparateurs', () => {
    expect(correspond('Hélène Lefèvre', 'helene')).toBe(true)
    expect(correspond('Saint-Étienne', 'saint etienne')).toBe(true)
    expect(correspondPlaque('AB-123-CD', 'ab123')).toBe(true)
    expect(correspondPlaque('AB-123-CD', 'AB 123 CD')).toBe(true)
  })

  it('ne trouve pas ce qui ne correspond pas', () => {
    expect(correspond('Jean Dupont', 'martin')).toBe(false)
    expect(correspondPlaque('AB-123-CD', 'ZZ999')).toBe(false)
  })
})

describe('l’annuaire client parallèle a disparu (GF-016)', () => {
  const RACINE = path.resolve(__dirname, '../../../..')

  function sources(dir = path.join(RACINE, 'src'), acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (['node_modules', '__tests__'].includes(e.name)) continue
        sources(p, acc)
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p)
    }
    return acc
  }

  it('le module `client-memory` n’existe plus', () => {
    expect(fs.existsSync(path.join(RACINE, 'src/lib/client-memory.ts')))
      .toBe(false)
  })

  it('plus aucun code ne lit ni n’écrit la clé `gf_clients`', () => {
    // Les COMMENTAIRES ont le droit de nommer l'annuaire supprimé — c'est même
    // ainsi qu'on garde la mémoire du défaut. Seul le CODE est examiné.
    // ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite.
    const sansCommentaires = (src: string) => src
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')

    const fautifs = sources()
      .filter((f) => /gf_clients|client-memory/.test(sansCommentaires(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(RACINE, f).replace(/\\/g, '/'))
    expect(fautifs, 'une seconde vérité sur « qui est ce client » ne doit pas revenir').toEqual([])
  })

  it('la recherche client passe par le serveur', () => {
    const hook = fs.readFileSync(path.join(RACINE, 'src/lib/clients/use-recherche-client.ts'), 'utf8')
    expect(hook).toContain('/api/clients?q=')
    expect(hook, 'les réponses périmées doivent être ignorées').toMatch(/generation/)
    for (const rel of ['src/components/JobModal.tsx', 'src/components/QuoteInvoiceModal.tsx']) {
      expect(fs.readFileSync(path.join(RACINE, rel), 'utf8'), `${rel} doit utiliser le hook partagé`)
        .toContain('useRechercheClient')
    }
  })
})
