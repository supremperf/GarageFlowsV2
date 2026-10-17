/**
 * GF-DUR-045 — ce qui est SIGNÉ doit être borné, et l'émission limitée.
 *
 * ─── Pourquoi une validation ordinaire ne suffit pas ici ────────────────────
 * `/api/admin/licenses/generate` est la seule route du produit qui signe avec la
 * clé privée. Une licence est IMMUABLE une fois émise : la valeur signée ne se
 * corrige pas, elle se révoque — et il faut alors réémettre, redistribuer, et
 * mettre à jour le client. Une validation laxiste ne coûte donc pas un message
 * d'erreur, elle coûte une opération de reprise complète.
 *
 * ─── Les deux défauts constatés ─────────────────────────────────────────────
 *  1. `years` était borné [1, 10] mais `seats` ne l'était pas :
 *
 *         const seats = Math.max(1, body.seats ?? 1)
 *
 *     Aucun plafond, aucune exigence d'entier. `1e9`, `2.5` ou `"12"` partaient
 *     tels quels dans le payload signé. Une faute de frappe sur le formulaire
 *     d'administration produisait une licence à un million de sièges, valable
 *     jusqu'à révocation individuelle.
 *
 *  2. Aucune limitation de débit, alors que ses QUATRE voisines de
 *     `admin/licenses/*` en portent une. Une session admin volée pouvait donc
 *     émettre des licences en rafale — chacune restant valable indépendamment.
 *
 * Aucun des deux n'est un contournement d'authentification : la route est bien
 * protégée par `isAdminSession()`. Ce sont des défauts d'ABUS d'un accès
 * légitime, la catégorie qu'on regarde le moins parce que « il faut déjà être
 * admin ».
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('émission de licence : les valeurs signées sont bornées (GF-DUR-045)', () => {
  const src = lire('src/app/api/admin/licenses/generate/route.ts')

  it('la route reste protégée par une session admin', () => {
    // On borne un accès légitime ; on ne remplace pas le contrôle d'accès.
    expect(src).toMatch(/if \(!await isAdminSession\(\)\)/)
  })

  it('`seats` a un plafond ET doit être un entier', () => {
    // On vérifie la COMPARAISON, pas la simple présence de la constante : une
    // première version de ce test se contentait de `toMatch(/SEATS_MAX/)` et
    // survivait au retrait du `> SEATS_MAX`. Assertion trop faible — exactement
    // le genre de test qui rassure sans rien prouver.
    expect(src, 'le plafond doit être COMPARÉ, pas seulement déclaré')
      .toMatch(/seatsDemandes > SEATS_MAX/)
    expect(src, 'un plancher est nécessaire aussi').toMatch(/seatsDemandes < 1/)
    expect(src, 'la valeur doit être un entier fini')
      .toMatch(/!Number\.isFinite\(seatsDemandes\)/)
    expect(src).toMatch(/Math\.floor\(Number\(body\.seats \?\? 1\)\)/)
    expect(src, 'un seats hors bornes doit être REFUSÉ, pas rogné en silence')
      .toMatch(/status: 400/)
  })

  it('le refus précède la SIGNATURE', () => {
    // Signer puis regretter n'est pas une option : la licence est immuable.
    const garde = src.indexOf('Nombre de sièges invalide')
    const signature = src.indexOf('buildToken(privKeyPem')
    expect(garde).toBeGreaterThan(-1)
    expect(garde, 'la garde doit précéder buildToken').toBeLessThan(signature)
  })

  it('`years` reste borné, et devient un entier lui aussi', () => {
    expect(src).toMatch(/Math\.max\(1, Math\.min\(10, Math\.floor\(Number\(body\.years \?\? 1\)\) \|\| 1\)\)/)
  })

  it('l’émission est limitée en débit, comme ses voisines', () => {
    expect(src).toMatch(/enforceRateLimit\('admin', `license-generate:/)
  })
})

describe('toutes les routes d’administration de licences sont limitées', () => {
  const ROUTES = [
    'src/app/api/admin/licenses/create/route.ts',
    'src/app/api/admin/licenses/generate/route.ts',
    'src/app/api/admin/licenses/[id]/route.ts',
    'src/app/api/admin/licenses/[id]/devices/route.ts',
  ]

  it('le corpus existe — sinon ce garde ne prouverait rien', () => {
    for (const r of ROUTES) expect(fs.existsSync(path.join(RACINE, r)), r).toBe(true)
  })

  for (const r of ROUTES) {
    it(`${r.replace('src/app/api/admin/licenses/', '').replace('/route.ts', '')} : débit limité`, () => {
      expect(lire(r)).toMatch(/enforceRateLimit\(/)
    })
  }
})
