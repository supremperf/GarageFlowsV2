import { describe, it, expect } from 'vitest'
import { generateSecret, isWeakValue, ensureEnvSecret } from '../../../scripts/secrets.js'

describe('scripts/secrets — génération sûre des secrets', () => {
  it('génère un secret fort (>= 32 caractères base64)', () => {
    const s = generateSecret()
    expect(s.length).toBeGreaterThanOrEqual(32)
    expect(isWeakValue(s)).toBe(false)
  })

  it('deux installations produisent des secrets différents', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).not.toBe(b)
  })

  it('détecte les valeurs faibles / placeholders', () => {
    expect(isWeakValue('')).toBe(true)
    expect(isWeakValue('short')).toBe(true)
    expect(isWeakValue('CHANGE_ME_run_openssl_rand_base64_32')).toBe(true)
    expect(isWeakValue('votre_secret_ici')).toBe(true)
    expect(isWeakValue('a'.repeat(40))).toBe(false)
  })

  it("N'ÉCRASE PAS un secret existant déjà fort", () => {
    const strong = 'Zm9vYmFyYmF6cXV4c2VjcmV0MTIzNDU2Nzg5MA=='
    const env = `NEXTAUTH_SECRET="${strong}"\n`
    const { content, changed } = ensureEnvSecret(env, 'NEXTAUTH_SECRET')
    expect(changed).toBe(false)
    expect(content).toContain(strong)
  })

  it('remplace un placeholder par un secret fort', () => {
    const env = 'NEXTAUTH_SECRET="CHANGE_ME_run_openssl_rand_base64_32"\n'
    const { content, changed } = ensureEnvSecret(env, 'NEXTAUTH_SECRET')
    expect(changed).toBe(true)
    expect(content).not.toContain('CHANGE_ME')
    const val = content.match(/NEXTAUTH_SECRET="([^"]+)"/)?.[1] ?? ''
    expect(isWeakValue(val)).toBe(false)
  })

  it('ajoute la variable si elle est absente', () => {
    const env = 'DATABASE_URL="file:./dev.db"\n'
    const { content, changed } = ensureEnvSecret(env, 'NEXTAUTH_SECRET')
    expect(changed).toBe(true)
    expect(content).toMatch(/NEXTAUTH_SECRET="[^"]{16,}"/)
  })

  it('ne prend jamais le commentaire SUIVANT pour un secret lorsque la valeur est vide', () => {
    const separator = `# ${'-'.repeat(70)}`
    const env = `NEXTAUTH_SECRET=\n\n${separator}\nGARAGEFLOW_API_KEY=\n`
    const { content, changed } = ensureEnvSecret(env, 'NEXTAUTH_SECRET')
    expect(changed).toBe(true)
    const value = content.match(/^NEXTAUTH_SECRET="([^"]+)"$/m)?.[1] ?? ''
    expect(isWeakValue(value)).toBe(false)
    expect(content).toContain(`\n\n${separator}\n`)
  })

  it('préserve les fins de ligne CRLF lors du remplacement', () => {
    const { content, changed } = ensureEnvSecret('NEXTAUTH_SECRET=""\r\nDATABASE_URL="file:./dev.db"\r\n', 'NEXTAUTH_SECRET')
    expect(changed).toBe(true)
    expect(content).toMatch(/^NEXTAUTH_SECRET="[^"]{16,}"\r\nDATABASE_URL=/m)
    expect(content.endsWith('\r\n')).toBe(true)
  })

  it('deux exécutions sur des .env vides donnent des secrets différents', () => {
    const a = ensureEnvSecret('', 'NEXTAUTH_SECRET').content
    const b = ensureEnvSecret('', 'NEXTAUTH_SECRET').content
    const va = a.match(/NEXTAUTH_SECRET="([^"]+)"/)?.[1]
    const vb = b.match(/NEXTAUTH_SECRET="([^"]+)"/)?.[1]
    expect(va).not.toBe(vb)
  })
})
