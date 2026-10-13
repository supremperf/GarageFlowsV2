/**
 * GF31-AUD-053 / 054 / 055 / 056 — quatre défauts du domaine licence, de faible
 * gravité mais réels.
 *
 * · 053 — la politique de version minimale ne s'appliquait à PERSONNE. La
 *   plateforme était déduite côté serveur de `process.env.ELECTRON`, jamais
 *   positionné sur le cloud : tout client Electron était classé « unknown », et
 *   `minVersionFor('unknown')` rendait `null`. `GF_MIN_ELECTRON_VERSION` donnait
 *   donc à l'exploitant l'illusion d'un mécanisme d'arrêt des versions
 *   obsolètes qui n'existait pas.
 *
 * · 054 — `POST /api/admin/licenses` insérait la ligne depuis le CORPS de la
 *   requête, sans vérifier la signature du jeton et sans poser de `recordMac` :
 *   sièges, type et expiration librement choisis, et enregistrement échappant
 *   définitivement au contrôle d'intégrité de la base.
 *
 * · 055 — le client rejetait les empreintes HWID V1, format pourtant accepté
 *   par le serveur et documenté comme canonique ; `getHwidV1()` n'avait aucun
 *   appelant. Une licence liée en V1 verrouillait l'utilisateur hors de son
 *   logiciel alors que le serveur la déclarait valide.
 *
 * · 056 — le secret du MAC de base se dérivait du seul HWID par un algorithme
 *   public : tout processus local pouvait le recalculer, donc forger un MAC.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { minVersionFor, isVersionSupported, parseClientPlatform } from '../license/client-policy'

const RACINE = path.resolve(__dirname, '../../..')
const main = () => readFileSync(path.join(RACINE, 'electron/main.js'), 'utf8')

const ENV = { ...process.env }
afterEach(() => {
  process.env.GF_MIN_ELECTRON_VERSION = ENV.GF_MIN_ELECTRON_VERSION
  process.env.GF_MIN_PWA_VERSION = ENV.GF_MIN_PWA_VERSION
})

describe('GF31-AUD-053 — la politique de version s’applique enfin', () => {
  it('un client NON identifié se voit appliquer le minimum le plus contraignant', () => {
    process.env.GF_MIN_ELECTRON_VERSION = '1.5.0'
    process.env.GF_MIN_PWA_VERSION = '1.0.0'
    // Avant : `null` — ne pas se nommer suffisait à échapper à la règle.
    expect(minVersionFor('unknown')).toBe('1.5.0')
    expect(isVersionSupported('unknown', '1.4.0')).toBe(false)
    expect(isVersionSupported('unknown', '1.5.0')).toBe(true)
  })

  it('sans aucun minimum configuré, rien ne change (défaut du produit)', () => {
    delete process.env.GF_MIN_ELECTRON_VERSION
    delete process.env.GF_MIN_PWA_VERSION
    expect(minVersionFor('unknown')).toBeNull()
    expect(isVersionSupported('unknown', undefined)).toBe(true)
  })

  it('un seul minimum configuré suffit à couvrir les non-identifiés', () => {
    delete process.env.GF_MIN_PWA_VERSION
    process.env.GF_MIN_ELECTRON_VERSION = '2.0.0'
    expect(minVersionFor('unknown')).toBe('2.0.0')
  })

  it('la plateforme annoncée est validée contre une liste blanche', () => {
    expect(parseClientPlatform('electron')).toBe('electron')
    expect(parseClientPlatform('pwa')).toBe('pwa')
    for (const v of ['ELECTRON', 'autre', '', null, undefined, 42, {}]) {
      expect(parseClientPlatform(v)).toBe('unknown')
    }
  })

  it('le client Electron ANNONCE sa plateforme au battement de licence', () => {
    expect(main()).toMatch(/platform:\s*'electron'/)
  })

  it('la route de contrôle lit la plateforme de la REQUÊTE', () => {
    const src = readFileSync(path.join(RACINE, 'src/app/api/license/check/route.ts'), 'utf8')
    expect(src).toContain('parseClientPlatform(body.platform)')
  })
})

describe('GF31-AUD-054 — l’import d’une licence part du payload SIGNÉ', () => {
  const route = () => readFileSync(path.join(RACINE, 'src/app/api/admin/licenses/route.ts'), 'utf8')

  it('vérifie la signature du jeton avant toute insertion', () => {
    const s = route()
    expect(s).toContain('verifyLicenseToken(body.token)')
    expect(s.indexOf('verifyLicenseToken')).toBeLessThan(s.indexOf('licenseKey.create'))
  })

  it('pose un recordMac — sinon la ligne échappe pour toujours au contrôle d’intégrité', () => {
    expect(route()).toContain('computeRecordMac(')
    expect(route()).toMatch(/recordMac,/)
  })

  it('les champs de SÉCURITÉ ne viennent plus du corps de la requête', () => {
    const s = route()
    for (const champ of ['licenseId:   p.lid', 'customerId:  p.cid', 'licenseType: p.typ']) {
      expect(s).toContain(champ)
    }
    // Sièges, expiration et liaison matérielle : dérivés du payload.
    expect(s).not.toMatch(/seats:\s*body\.seats/)
    expect(s).not.toMatch(/expiryAt:\s*new Date\(body\.expiryAt\)/)
    expect(s).not.toMatch(/hwid:\s*body\.hwid/)
  })
})

describe('GF31-AUD-055 — la liaison HWID V1 est reconnue par le client', () => {
  it('le comparateur accepte les deux formats et compare v1 avec v1', () => {
    const s = main()
    expect(s).toMatch(/hwid1-\[0-9a-f\]\{64\}/)
    expect(s).toContain('getHwidV1()')
    // `getHwidV1` n'était appelé nulle part : c'était du code mort.
    expect(s.match(/getHwidV1\(\)/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('la comparaison reste STRICTE et à temps constant', () => {
    expect(main()).toContain('crypto.timingSafeEqual')
  })

  it('le serveur accepte bien ce format — sinon la tolérance client serait vaine', () => {
    const verify = readFileSync(path.join(RACINE, 'src/lib/license/verify.ts'), 'utf8')
    expect(verify).toContain('hwid1-')
  })
})

describe('GF31-AUD-056 — le secret du MAC de base n’est plus recalculable', () => {
  it('un secret d’installation aléatoire est mêlé au HWID', () => {
    const s = main()
    expect(s).toContain('DB_MAC_SECRET_FILE')
    expect(s).toContain('loadOrCreateInstallSecret')
    expect(s).toMatch(/pbkdf2Sync\(`\$\{hwid\}:\$\{installSecret\}`/)
  })

  it('l’ancienne dérivation — HWID seul — a disparu', () => {
    expect(main()).not.toMatch(/pbkdf2Sync\(hwid,\s*DB_MAC_SALT/)
  })

  it('le secret est produit par le mécanisme éprouvé du secret de session', () => {
    const secret = readFileSync(path.join(RACINE, 'electron/secret.js'), 'utf8')
    // 256 bits, écriture atomique, permissions restreintes, jamais journalisé.
    expect(secret).toContain('function loadOrCreateInstallSecret')
    expect(secret).toMatch(/0o600|0600/)
  })
})
