/**
 * Machine à états des LICENCES — balayage exhaustif.
 *
 * Les licences n'avaient pas de table de transitions, contrairement aux
 * appareils. Ces tests couvrent le produit cartésien complet des états plutôt
 * que quelques cas choisis : c'est le seul moyen de démontrer qu'AUCUN chemin
 * ne ramène une licence révoquée à `active` sans geste administratif explicite.
 */
import { describe, it, expect } from 'vitest'
import {
  LICENSE_STATES,
  SETTABLE_LICENSE_STATES,
  MIN_REASON_LENGTH,
  isLicenseState,
  isSettableLicenseState,
  isUsableReason,
  canTransitionLicense,
  effectiveLicenseStatus,
  licenseGrantsAccess,
  auditActionFor,
} from '@/lib/license/state-machine'

const MOTIF = 'remise en service après régularisation du paiement'

describe('garde d\'exécution des statuts', () => {
  it('accepte exactement les trois états positionnables', () => {
    expect([...SETTABLE_LICENSE_STATES]).toEqual(['active', 'suspended', 'revoked'])
    for (const s of SETTABLE_LICENSE_STATES) expect(isSettableLicenseState(s)).toBe(true)
  })

  it('`expired` est un état canonique mais N\'EST PAS positionnable', () => {
    // Il découle de expiryAt : l'accepter en écriture créerait un second
    // mécanisme d'expiration, divergent du premier.
    expect(isLicenseState('expired')).toBe(true)
    expect(isSettableLicenseState('expired')).toBe(false)
  })

  it('refuse les variantes qui ressemblent à un état sans en être un', () => {
    // Chacune de ces valeurs était persistée telle quelle par le PATCH, puis
    // scellée par un recordMac recalculé. Aucune ne correspond à un test
    // d'égalité stricte `=== 'revoked'` : toutes accordaient donc l'accès.
    const pieges = ['Revoked', 'REVOKED', 'revoked ', ' revoked', 'revoked\n', 'révoqué', 'rev0ked', 'inactive', 'disabled', '']
    for (const p of pieges) {
      expect(isSettableLicenseState(p), `« ${JSON.stringify(p)} » ne doit pas être accepté`).toBe(false)
    }
  })

  it('refuse les types non-chaîne', () => {
    for (const v of [null, undefined, 0, 1, true, false, {}, [], ['revoked'], { status: 'revoked' }]) {
      expect(isSettableLicenseState(v)).toBe(false)
    }
  })
})

describe('motif de réactivation', () => {
  it('exige un motif substantiel', () => {
    expect(isUsableReason(MOTIF)).toBe(true)
    expect(isUsableReason('x'.repeat(MIN_REASON_LENGTH))).toBe(true)
  })

  it('rejette le vide, les espaces et les motifs trop courts', () => {
    for (const v of ['', '   ', '\t\n', 'ok', 'x'.repeat(MIN_REASON_LENGTH - 1), null, undefined, 42, {}]) {
      expect(isUsableReason(v)).toBe(false)
    }
  })
})

describe('transitions — balayage exhaustif', () => {
  it('aucune transition depuis `revoked` vers `active` sans confirmation ET motif', () => {
    // Les quatre combinaisons manquantes, une par une.
    expect(canTransitionLicense({ from: 'revoked', to: 'active' })).toMatchObject({
      ok: false, code: 'REACTIVATION_REQUIRES_CONFIRMATION',
    })
    expect(canTransitionLicense({ from: 'revoked', to: 'active', confirmReactivation: true })).toMatchObject({
      ok: false, code: 'REACTIVATION_REQUIRES_CONFIRMATION',
    })
    expect(canTransitionLicense({ from: 'revoked', to: 'active', reason: MOTIF })).toMatchObject({
      ok: false, code: 'REACTIVATION_REQUIRES_CONFIRMATION',
    })
    expect(canTransitionLicense({ from: 'revoked', to: 'active', confirmReactivation: true, reason: 'trop court'.slice(0, 3) })).toMatchObject({
      ok: false, code: 'REACTIVATION_REQUIRES_CONFIRMATION',
    })
  })

  it('un `confirmReactivation` seulement TRUTHY ne suffit pas', () => {
    // `=== true` et non `!!` : un `confirmReactivation: 'non'` envoyé par erreur
    // depuis un formulaire ne doit pas valoir confirmation.
    for (const truthy of ['true', 'oui', 1, {}, [], 'non']) {
      expect(
        canTransitionLicense({ from: 'revoked', to: 'active', confirmReactivation: truthy as never, reason: MOTIF }),
      ).toMatchObject({ ok: false, code: 'REACTIVATION_REQUIRES_CONFIRMATION' })
    }
  })

  it('réactivation administrative explicite : autorisée et étiquetée comme telle', () => {
    expect(canTransitionLicense({ from: 'revoked', to: 'active', confirmReactivation: true, reason: MOTIF })).toEqual({
      ok: true, kind: 'reactivation',
    })
  })

  it('`revoked → suspended` est refusé (adoucissement sans contrôle)', () => {
    expect(canTransitionLicense({ from: 'revoked', to: 'suspended', confirmReactivation: true, reason: MOTIF })).toMatchObject({
      ok: false, code: 'REVOKED_IS_FINAL',
    })
  })

  it('`revoked → revoked` reste neutre (idempotence)', () => {
    expect(canTransitionLicense({ from: 'revoked', to: 'revoked' })).toEqual({ ok: true, kind: 'noop' })
  })

  it('les transitions ordinaires restent possibles', () => {
    expect(canTransitionLicense({ from: 'active', to: 'suspended' })).toEqual({ ok: true, kind: 'normal' })
    expect(canTransitionLicense({ from: 'active', to: 'revoked' })).toEqual({ ok: true, kind: 'normal' })
    expect(canTransitionLicense({ from: 'suspended', to: 'revoked' })).toEqual({ ok: true, kind: 'normal' })
    // Lever une SUSPENSION est une décision admin légitime (elle sera journalisée).
    expect(canTransitionLicense({ from: 'suspended', to: 'active' })).toEqual({ ok: true, kind: 'normal' })
  })

  it('toute cible hors énumération est refusée, quelle que soit l\'origine', () => {
    for (const from of [...LICENSE_STATES, 'valeur-heritee', null, undefined]) {
      for (const to of ['Revoked', 'expired', 'banana', '', null, undefined, 1, {}]) {
        const v = canTransitionLicense({ from, to })
        expect(v.ok, `${String(from)} → ${JSON.stringify(to)} doit être refusé`).toBe(false)
        if (!v.ok) expect(v.code).toBe('INVALID_STATUS')
      }
    }
  })

  it('un état COURANT non reconnu ne peut jamais mener à `active`', () => {
    // C'est la trace des dégâts possibles : si une valeur hors énumération a été
    // écrite avant la garde, on ne la « répare » pas en activant.
    for (const from of ['Revoked', 'banana', '', null, undefined, 7]) {
      expect(canTransitionLicense({ from, to: 'active', confirmReactivation: true, reason: MOTIF })).toMatchObject({
        ok: false, code: 'UNKNOWN_CURRENT_STATE',
      })
      // …mais on peut la remettre en conformité vers un état de BLOCAGE.
      expect(canTransitionLicense({ from, to: 'revoked' }).ok).toBe(true)
      expect(canTransitionLicense({ from, to: 'suspended' }).ok).toBe(true)
    }
  })

  it('produit cartésien : seuls des chemins nommés mènent à `active`', () => {
    const origines = [...LICENSE_STATES, 'Revoked', 'banana', null, undefined]
    const autorisees: string[] = []
    for (const from of origines) {
      // Demande ORDINAIRE, sans confirmation ni motif — le cas de très loin le
      // plus fréquent (formulaire admin, script de maintenance, appel direct).
      if (canTransitionLicense({ from, to: 'active' }).ok) autorisees.push(String(from))
    }
    // `revoked` ne doit PAS y figurer. `active` (noop) et `suspended` oui.
    expect(autorisees.sort()).toEqual(['active', 'expired', 'suspended'])
  })
})

describe('statut effectif — l\'expiration ne masque jamais une sanction', () => {
  const passe = new Date('2020-01-01T00:00:00Z')
  const futur = new Date('2099-01-01T00:00:00Z')

  it('révocation prime sur expiration', () => {
    expect(effectiveLicenseStatus({ status: 'revoked', expiryAt: passe })).toBe('revoked')
  })

  it('suspension prime sur expiration', () => {
    expect(effectiveLicenseStatus({ status: 'suspended', expiryAt: passe })).toBe('suspended')
  })

  it('une licence active mais périmée est `expired`', () => {
    expect(effectiveLicenseStatus({ status: 'active', expiryAt: passe })).toBe('expired')
  })

  it('une licence active et valide est `active`', () => {
    expect(effectiveLicenseStatus({ status: 'active', expiryAt: futur })).toBe('active')
  })

  it('un statut hors énumération est `unknown`, JAMAIS `active`', () => {
    for (const s of ['Revoked', 'banana', '', 'ACTIVE']) {
      expect(effectiveLicenseStatus({ status: s, expiryAt: futur })).toBe('unknown')
    }
  })

  it('une date d\'expiration illisible ne vaut pas expiration… ni accès', () => {
    expect(effectiveLicenseStatus({ status: 'active', expiryAt: 'pas-une-date' })).toBe('active')
    expect(effectiveLicenseStatus({ status: 'Revoked', expiryAt: 'pas-une-date' })).toBe('unknown')
  })

  it('l\'accès n\'est accordé QUE sur `active` effectif', () => {
    expect(licenseGrantsAccess({ status: 'active', expiryAt: futur })).toBe(true)
    for (const rec of [
      { status: 'active', expiryAt: passe },
      { status: 'revoked', expiryAt: futur },
      { status: 'suspended', expiryAt: futur },
      { status: 'Revoked', expiryAt: futur },
      { status: 'banana', expiryAt: futur },
    ]) {
      expect(licenseGrantsAccess(rec), JSON.stringify(rec)).toBe(false)
    }
  })
})

describe('étiquette d\'audit', () => {
  it('distingue une réactivation d\'une simple mise en actif', () => {
    expect(auditActionFor('active', 'reactivation')).toBe('license_reactivated')
    expect(auditActionFor('active', 'normal')).toBe('license_active')
    expect(auditActionFor('suspended', 'normal')).toBe('license_suspended')
    expect(auditActionFor('revoked', 'normal')).toBe('license_revoked')
  })
})
