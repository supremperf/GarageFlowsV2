import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createPublicKey, createHash, createVerify, createSign, generateKeyPairSync } from 'node:crypto'
import path from 'node:path'

/**
 * La clé publique ECC qui vérifie les licences est codée en dur dans
 * electron/main.js (littéral `_PK`) ET présente dans keys/public.pem. Rien ne
 * les relie à l'exécution : quand elles divergent, `verify()` renvoie `false`
 * sans le moindre message, la licence valide est refusée, et l'application
 * repart en activation — que le serveur refuse une fois le quota d'appareils
 * atteint. L'utilisateur se retrouve verrouillé hors de son logiciel.
 *
 * Ces tests verrouillent la forme du littéral (dont dépend
 * scripts/check-public-key.mjs) et, quand keys/public.pem est disponible, la
 * correspondance effective des deux clés.
 */

const ROOT = path.join(__dirname, '..', '..', '..')
const MAIN = path.join(ROOT, 'electron', 'main.js')
const PEM = path.join(ROOT, 'keys', 'public.pem')

/** Extraction identique à celle de scripts/check-public-key.mjs. */
function extractEmbeddedPem(source: string): string | null {
  const block = source.match(/const\s+_PK\s*=\s*\[([\s\S]*?)\]/)
  if (!block) return null
  return [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n')
}

function fingerprint(pem: string): string {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

describe('clé publique de licence embarquée', () => {
  const source = readFileSync(MAIN, 'utf8')

  it('le littéral _PK reste extractible — le garde de build en dépend', () => {
    expect(extractEmbeddedPem(source)).not.toBeNull()
  })

  it('la clé embarquée est une clé publique P-256 valide, pas un gabarit', () => {
    const pem = extractEmbeddedPem(source)!
    expect(pem).not.toContain('REPLACE_WITH_YOUR_PUBLIC_KEY')
    const key = createPublicKey(pem)
    expect(key.asymmetricKeyType).toBe('ec')
    expect(key.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
  })

  it('l’extraction distingue bien deux clés différentes (test non vide)', () => {
    const a = extractEmbeddedPem(source)!
    const autre = a.replace(/^(-----BEGIN[^\n]*\n)([A-Za-z0-9+/=]{8})/m, (_m, h, b) =>
      h + (b === 'MFkwEwYH' ? 'MFkwEwYG' : 'MFkwEwYH'),
    )
    expect(autre).not.toBe(a)
  })

  it.skipIf(!existsSync(PEM))(
    'la clé embarquée est IDENTIQUE à keys/public.pem (clé émettrice des licences)',
    () => {
      const embarquee = fingerprint(extractEmbeddedPem(source)!)
      const emettrice = fingerprint(readFileSync(PEM, 'utf8'))
      expect(embarquee).toBe(emettrice)
    },
  )

  it('une signature faite avec une AUTRE clé est bien rejetée', () => {
    // Garantit que la vérification n'est pas permissive : on signe avec une paire
    // jetable et on vérifie que la clé embarquée refuse la signature.
    const message = 'entete.charge-utile'
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const signer = createSign('SHA256')
    signer.update(message)
    const signature = signer.sign(privateKey)

    const verifier = createVerify('SHA256')
    verifier.update(message)
    expect(verifier.verify({ key: extractEmbeddedPem(source)!, format: 'pem' }, signature)).toBe(false)
  })
})
