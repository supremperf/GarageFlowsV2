/**
 * WEBHOOKS — la signature est la seule authentification d'une route publique.
 *
 * Ces tests fixent le contrat qu'une plateforme doit respecter, et surtout les
 * refus : sans eux, une comparaison de chaînes mal écrite (« === » sur un hex)
 * passerait inaperçue tant que le cas heureux est testé seul.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  signatureWebhook,
  verifierSignatureWebhook,
  doitRemplacerStatut,
  TOLERANCE_SECONDES,
} from '../webhook-signature'

const SECRET = 'secret-de-test-32-octets-minimum'
const CORPS = JSON.stringify({ externalId: 'EXT-42', status: 'accepted', eventId: 'evt-1' })
const TS = 1_760_000_000

function entetes(ts: number | string, signature: string) {
  return { 'x-gf-timestamp': String(ts), 'x-gf-signature': signature }
}

describe('signatureWebhook', () => {
  it('reproduit exactement le schéma documenté (timestamp.corps)', () => {
    const attendu = crypto.createHmac('sha256', SECRET).update(`${TS}.${CORPS}`).digest('hex')
    expect(signatureWebhook(SECRET, String(TS), CORPS)).toBe(attendu)
    expect(attendu).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifierSignatureWebhook', () => {
  const bonne = signatureWebhook(SECRET, String(TS), CORPS)

  it('accepte une signature exacte dans la fenêtre', () => {
    expect(verifierSignatureWebhook({
      secret: SECRET, entetes: entetes(TS, bonne), corpsBrut: CORPS, maintenant: TS + 10,
    })).toEqual({ ok: true })
  })

  it('accepte un léger décalage d’horloge dans les deux sens', () => {
    for (const maintenant of [TS - TOLERANCE_SECONDES, TS + TOLERANCE_SECONDES]) {
      expect(verifierSignatureWebhook({
        secret: SECRET, entetes: entetes(TS, bonne), corpsBrut: CORPS, maintenant,
      }).ok).toBe(true)
    }
  })

  it('refuse un secret absent (configuration incomplète, pas un appel valide)', () => {
    for (const secret of [null, undefined, '', '   ']) {
      expect(verifierSignatureWebhook({
        secret, entetes: entetes(TS, bonne), corpsBrut: CORPS, maintenant: TS,
      })).toEqual({ ok: false, motif: 'SECRET_ABSENT' })
    }
  })

  it('refuse l’absence d’en-têtes', () => {
    expect(verifierSignatureWebhook({
      secret: SECRET, entetes: {}, corpsBrut: CORPS, maintenant: TS,
    })).toEqual({ ok: false, motif: 'ENTETES_ABSENTS' })
  })

  it('refuse un horodatage non entier, négatif ou nul', () => {
    for (const ts of ['abc', '-1', '0', '12.5']) {
      expect(verifierSignatureWebhook({
        secret: SECRET, entetes: entetes(ts, bonne), corpsBrut: CORPS, maintenant: TS,
      })).toEqual({ ok: false, motif: 'HORODATAGE_INVALIDE' })
    }
  })

  it('refuse un rejeu au-delà de la fenêtre, dans les deux sens', () => {
    for (const maintenant of [TS + TOLERANCE_SECONDES + 1, TS - TOLERANCE_SECONDES - 1]) {
      expect(verifierSignatureWebhook({
        secret: SECRET, entetes: entetes(TS, bonne), corpsBrut: CORPS, maintenant,
      })).toEqual({ ok: false, motif: 'HORODATAGE_PERIME' })
    }
  })

  it('refuse un corps modifié — même d’un seul octet', () => {
    const altere = CORPS.replace('accepted', 'accepted ')
    expect(verifierSignatureWebhook({
      secret: SECRET, entetes: entetes(TS, bonne), corpsBrut: altere, maintenant: TS,
    })).toEqual({ ok: false, motif: 'SIGNATURE_INVALIDE' })
  })

  it('refuse un mauvais secret', () => {
    expect(verifierSignatureWebhook({
      secret: SECRET + 'x', entetes: entetes(TS, bonne), corpsBrut: CORPS, maintenant: TS,
    })).toEqual({ ok: false, motif: 'SIGNATURE_INVALIDE' })
  })

  it('refuse une signature non hexadécimale ou de mauvaise longueur sans lever', () => {
    for (const fausse of ['zz'.repeat(32), 'abc', '0'.repeat(63), '0'.repeat(65)]) {
      expect(verifierSignatureWebhook({
        secret: SECRET, entetes: entetes(TS, fausse), corpsBrut: CORPS, maintenant: TS,
      })).toEqual({ ok: false, motif: 'SIGNATURE_INVALIDE' })
    }
  })

  it('tolère la casse des en-têtes (Request la normalise, pas tous les serveurs)', () => {
    const melange = { 'X-GF-Timestamp': String(TS), 'X-GF-Signature': bonne }
    expect(verifierSignatureWebhook({
      secret: SECRET, entetes: melange, corpsBrut: CORPS, maintenant: TS,
    }).ok).toBe(true)
  })
})

describe('doitRemplacerStatut — un webhook en retard ne fait pas régresser la facture', () => {
  it('applique une progression normale', () => {
    expect(doitRemplacerStatut('submitted', 'received_by_platform')).toBe(true)
    expect(doitRemplacerStatut('received_by_platform', 'accepted')).toBe(true)
    expect(doitRemplacerStatut('accepted', 'paid')).toBe(true)
  })

  it('refuse une régression', () => {
    expect(doitRemplacerStatut('accepted', 'submitted')).toBe(false)
    expect(doitRemplacerStatut('delivered', 'received_by_platform')).toBe(false)
    expect(doitRemplacerStatut('paid', 'submitted')).toBe(false)
  })

  it('ne remplace jamais `paid`', () => {
    for (const s of ['accepted', 'delivered', 'refused', 'rejected', 'error', 'unknown']) {
      expect(doitRemplacerStatut('paid', s)).toBe(false)
    }
  })

  it('ignore un statut identique ou intraduisible', () => {
    expect(doitRemplacerStatut('accepted', 'accepted')).toBe(false)
    expect(doitRemplacerStatut('accepted', 'unknown')).toBe(false)
    expect(doitRemplacerStatut('submitted', 'unknown')).toBe(false)
  })

  it('permet une correction de verdict par la plateforme', () => {
    expect(doitRemplacerStatut('accepted', 'refused')).toBe(true)
    expect(doitRemplacerStatut('refused', 'accepted')).toBe(true)
  })
})
