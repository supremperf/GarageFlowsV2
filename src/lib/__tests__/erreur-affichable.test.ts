/**
 * GF-035 — un refus du serveur doit se VOIR, sans rien exposer (§82, §83).
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `WorkOrderModal.save()` et `handleSign()` faisaient `try { … throw … }
 * finally { setSaving(false) }` : un `finally` SANS `catch`. Le serveur
 * refusait, la promesse partait en rejet non traité, et rien n'était dit.
 *
 * Dans la PWA : l'utilisateur reclique, croit à une lenteur, ferme la modale —
 * la saisie est perdue. Dans l'application packagée, c'est l'inverse : le
 * gestionnaire `unhandledrejection` injecté par Electron pose un bandeau de
 * diagnostic PLEIN ÉCRAN, sans bouton de fermeture, affichant le texte brut de
 * la réponse serveur jusqu'au redémarrage.
 *
 * D'où deux exigences, et non une : attraper, ET n'afficher que ce qui est
 * montrable. `e.message.slice(0, 300)` échoue sur la seconde — sur un 500 il
 * colle trois cents caractères de pile d'appels dans un bandeau.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { messageErreur } from '@/lib/erreur-affichable'

const DEFAUT = 'Enregistrement refusé par le serveur'

describe('messageErreur — ce qui est montrable l’est', () => {
  it('rend un message métier tel quel', () => {
    expect(messageErreur(new Error('Stock insuffisant pour cette pièce'), DEFAUT))
      .toBe('Stock insuffisant pour cette pièce')
  })

  it('extrait le champ `error` d’une réponse JSON', () => {
    expect(messageErreur(new Error('{"error":"Numéro déjà utilisé, réessayez"}'), DEFAUT))
      .toBe('Numéro déjà utilisé, réessayez')
  })

  it('accepte une chaîne nue', () => {
    expect(messageErreur('worksJson/partsJson invalides', DEFAUT)).toBe('worksJson/partsJson invalides')
  })
})

describe('messageErreur — ce qui ne l’est pas ne sort jamais', () => {
  it.each([
    ['une trace', 'TypeError: x is not a function\n    at Object.save (/app/.next/server/page.js:12:9)'],
    ['une page HTML', '<!DOCTYPE html><html><body>Internal Server Error</body></html>'],
    ['une URL de base', 'Can\'t reach database at postgres://user:pass@host:5432/db'],
    ['un code Prisma', 'Invalid invocation: P2002 unique constraint failed'],
    ['un jeton JWT', 'session invalide : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'],
    ['une licence GF2', 'jeton refusé GF2.aGVhZGVy.cGF5bG9hZA.c2ln'],
    ['une clé privée', '-----BEGIN PRIVATE KEY-----\nMIIE'],
    ['un nom d’erreur', 'PrismaClientKnownRequestError'],
  ])('remplace %s par le message neutre', (_quoi, texte) => {
    expect(messageErreur(new Error(texte), DEFAUT)).toBe(DEFAUT)
  })

  it('refuse un message trop long pour en être un', () => {
    expect(messageErreur(new Error('a'.repeat(500)), DEFAUT)).toBe(DEFAUT)
  })

  it('un JSON dont le champ `error` est technique retombe sur le neutre', () => {
    expect(messageErreur(new Error('{"error":"at Object.foo (/srv/app.js:1:1)"}'), DEFAUT)).toBe(DEFAUT)
    expect(messageErreur(new Error('{"error":'), DEFAUT), 'JSON tronqué').toBe(DEFAUT)
  })

  it.each([[null], [undefined], [{}], [0], [new Error('')], ['   ']])(
    'rend le message neutre pour %s', (valeur) => {
      expect(messageErreur(valeur, DEFAUT)).toBe(DEFAUT)
    },
  )
})

describe('GF-035 — aucun `finally` sans `catch` dans WorkOrderModal', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/WorkOrderModal.tsx'), 'utf8',
  )

  it('les deux enchaînements réseau attrapent leur rejet', () => {
    // L'ORDRE est imposé : commentaires de LIGNE d'abord, blocs ensuite. Dans
    // l'autre sens, un `/*` cité dans un `//` avale le code qui suit.
    const nu = src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Un `} finally` non précédé d'un `catch` = un rejet qui part dans le vide.
    const finallySansCatch = Array.from(nu.matchAll(/\}\s*finally\s*\{/g)).filter((m) => {
      const avant = nu.slice(Math.max(0, m.index - 400), m.index)
      return !/\}\s*catch\s*\(/.test(avant)
    })
    expect(finallySansCatch, 'un rejet non traité recouvre l’écran dans l’application packagée').toHaveLength(0)
  })

  it('l’échec est SIGNALÉ à l’utilisateur, pas seulement avalé', () => {
    expect(src).toContain('toast.error(messageErreur(')
  })

  it('le message brut du serveur n’est pas affiché sans filtre', () => {
    // `e.message.slice(0, N)` remettrait une pile d'appels dans un bandeau.
    expect(src).not.toMatch(/message\s*\?\.\s*slice\s*\(/)
  })
})
