/**
 * GF-DUR-023 — séparation des domaines cryptographiques SMTP / TOTP.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * La première protection des secrets TOTP réutilisait `GF_SMTP_CIPHER_KEY`. Une
 * seule clé brute servait alors deux domaines indépendants : les identifiants
 * SMTP du garage et les seconds facteurs de ses clients. Une rotation SMTP —
 * geste d'exploitation courant, documenté, sans rapport avec le 2FA — rendait du
 * même coup illisibles tous les secrets TOTP.
 *
 * Le dépôt avait déjà tranché : `GF_TOTP_ENC_KEY` est déclarée au manifeste,
 * générée par le script de configuration, EXCLUE de la rotation du reset, et le
 * manifeste désigne `src/lib/portal/totp-crypto.ts` comme consommateur attendu.
 * Il ne manquait que le code.
 *
 * ─── Deux séparations, pas une ──────────────────────────────────────────────
 * Une clé distincte ne suffit pas. Si deux domaines partagent un jour la même
 * valeur — copier-coller d'exploitation, environnement mal réglé — un
 * cryptogramme de l'un se déchiffrerait sous l'autre. Le domaine est donc AUSSI
 * lié par les données authentifiées de GCM. Le test « clé identique » ci-dessous
 * est celui qui distingue une vraie séparation d'un simple renommage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chiffrerSecretTotp,
  dechiffrerSecretTotp,
  estChiffreTotp,
  cleTotpConfiguree,
  PREFIXE_TOTP,
} from '../totp-crypto'
import { encryptSecret, decryptSecret } from '@/lib/security/secret-cipher'

const CLE_TOTP = Buffer.alloc(32, 7).toString('base64')
const CLE_SMTP = Buffer.alloc(32, 9).toString('base64')
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

const env = { ...process.env }
beforeEach(() => {
  process.env.GF_TOTP_ENC_KEY = CLE_TOTP
  process.env.GF_SMTP_CIPHER_KEY = CLE_SMTP
  delete process.env.GF_TOTP_ENC_KEY_OLD
})
afterEach(() => { process.env = { ...env } })

describe('aller-retour', () => {
  it('chiffre puis relit le secret', () => {
    const c = chiffrerSecretTotp(SECRET)
    expect(c.startsWith(PREFIXE_TOTP)).toBe(true)
    expect(c).not.toContain(SECRET)
    expect(dechiffrerSecretTotp(c)).toBe(SECRET)
  })

  it('deux chiffrements du MÊME secret diffèrent', () => {
    // Un vecteur d'initialisation constant révélerait que deux comptes
    // partagent le même secret — et rendrait l'attaque bien plus facile.
    expect(chiffrerSecretTotp(SECRET)).not.toBe(chiffrerSecretTotp(SECRET))
  })

  it('le marqueur porte le domaine et la version', () => {
    expect(PREFIXE_TOTP).toBe('gtotp1.')
    expect(estChiffreTotp(chiffrerSecretTotp(SECRET))).toBe(true)
    expect(estChiffreTotp('GFSEC1:quelquechose')).toBe(false)
    expect(estChiffreTotp(SECRET)).toBe(false)
  })
})

describe('confusion de domaine — impossible dans les DEUX sens', () => {
  it('un cryptogramme SMTP n\'est pas lu comme un secret TOTP', () => {
    const smtp = encryptSecret(SECRET)
    expect(dechiffrerSecretTotp(smtp)).toBeNull()
  })

  it('un cryptogramme TOTP n\'est pas lu par le déchiffreur SMTP', () => {
    const totp = chiffrerSecretTotp(SECRET)
    // `decryptSecret` rend les valeurs non marquées telles quelles (héritage) :
    // ce qui compte est qu'il ne restitue JAMAIS le secret.
    expect(decryptSecret(totp)).not.toBe(SECRET)
  })

  it('même à CLÉ IDENTIQUE, les domaines ne se confondent pas', () => {
    // C'est le test qui distingue une vraie séparation d'un simple renommage :
    // les données authentifiées de GCM lient le cryptogramme à son domaine.
    process.env.GF_SMTP_CIPHER_KEY = CLE_TOTP
    const smtp = encryptSecret(SECRET)
    expect(dechiffrerSecretTotp(smtp)).toBeNull()
  })
})

describe('fail-closed', () => {
  it('sans clé, on refuse d\'écrire plutôt que de dégrader', () => {
    delete process.env.GF_TOTP_ENC_KEY
    expect(cleTotpConfiguree()).toBe(false)
    expect(() => chiffrerSecretTotp(SECRET)).toThrow(/GF_TOTP_ENC_KEY/)
  })

  it('la clé SMTP ne sert JAMAIS de repli', () => {
    delete process.env.GF_TOTP_ENC_KEY
    process.env.GF_SMTP_CIPHER_KEY = CLE_SMTP
    expect(cleTotpConfiguree()).toBe(false)
    expect(() => chiffrerSecretTotp(SECRET)).toThrow()
  })

  it('une clé faible est refusée comme une clé absente', () => {
    process.env.GF_TOTP_ENC_KEY = 'changeme'
    expect(cleTotpConfiguree()).toBe(false)
    expect(() => chiffrerSecretTotp(SECRET)).toThrow()
  })

  it('clair, structure invalide, altération : null, jamais une exception', () => {
    const bon = chiffrerSecretTotp(SECRET)
    for (const v of [
      null, undefined, '', SECRET, 'GFSEC1:autre-domaine',
      PREFIXE_TOTP + 'tronque',
      bon.slice(0, -6) + 'AAAAAA',                    // corps altéré
      bon.split('.').slice(0, 4).join('.'),           // segment manquant
    ]) {
      expect(dechiffrerSecretTotp(v as string)).toBeNull()
    }
  })

  it('une clé qui ne correspond pas rend null, sans lever', () => {
    const c = chiffrerSecretTotp(SECRET)
    process.env.GF_TOTP_ENC_KEY = Buffer.alloc(32, 3).toString('base64')
    expect(dechiffrerSecretTotp(c)).toBeNull()
  })
})

describe('rotation', () => {
  it('l\'ancienne clé continue de relire, la nouvelle chiffre', () => {
    // Sans cela, une rotation verrouillerait tous les comptes protégés et la
    // seule issue serait la réinscription de chacun.
    const ancienne = CLE_TOTP
    const avant = chiffrerSecretTotp(SECRET)

    const nouvelle = Buffer.alloc(32, 11).toString('base64')
    process.env.GF_TOTP_ENC_KEY = nouvelle
    process.env.GF_TOTP_ENC_KEY_OLD = ancienne

    expect(dechiffrerSecretTotp(avant)).toBe(SECRET)      // relu par l'ancienne
    const apres = chiffrerSecretTotp(SECRET)
    expect(apres).not.toBe(avant)

    // Une fois l'ancienne retirée, seul ce qui a été rechiffré reste lisible.
    delete process.env.GF_TOTP_ENC_KEY_OLD
    expect(dechiffrerSecretTotp(apres)).toBe(SECRET)
    expect(dechiffrerSecretTotp(avant)).toBeNull()
  })

  it('plusieurs anciennes clés sont acceptées, séparées par des virgules', () => {
    const a1 = CLE_TOTP
    const c1 = chiffrerSecretTotp(SECRET)
    process.env.GF_TOTP_ENC_KEY = Buffer.alloc(32, 13).toString('base64')
    process.env.GF_TOTP_ENC_KEY_OLD = `${Buffer.alloc(32, 99).toString('base64')}, ${a1}`
    expect(dechiffrerSecretTotp(c1)).toBe(SECRET)
  })
})
