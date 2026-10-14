import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { encrypt, decrypt } from '../backup/crypto'
import { encryptSecret, decryptSecret, PREFIX } from '../security/secret-cipher'
import { encryptCredential, decryptCredential } from '../einvoicing/credentials-cipher'
import { chiffrerSecretTotp, dechiffrerSecretTotp } from '../portal/totp-crypto'

const plain = 'SYNTHETIC_GCM_FIXTURE_NOT_A_REAL_SECRET'
const envNames = ['GF_SMTP_CIPHER_KEY', 'GF_SMTP_CIPHER_KEY_OLD', 'GF_EINVOICE_CREDENTIALS_KEY', 'GF_TOTP_ENC_KEY', 'GF_TOTP_ENC_KEY_OLD'] as const
let saved: (string | undefined)[]
let key: Buffer
beforeEach(() => {
  saved = envNames.map(k => process.env[k])
  key = crypto.randomBytes(32)
  for (const name of envNames) process.env[name] = key.toString('base64')
})
afterEach(() => { envNames.forEach((k,i) => { if (saved[i] == null) delete process.env[k]; else process.env[k] = saved[i] }) })
function tagOfLength(tag: string, length: number, encoding: BufferEncoding) {
  const full = Buffer.from(tag, encoding)
  return (length <= full.length ? full.subarray(0, length) : Buffer.concat([full, Buffer.alloc(length-full.length)])).toString(encoding)
}
function secretWithTag(stored: string, length: number): string {
  const e = JSON.parse(Buffer.from(stored.slice(PREFIX.length), 'base64').toString('utf8'))
  e.tag = tagOfLength(e.tag, length, 'base64')
  return PREFIX + Buffer.from(JSON.stringify(e)).toString('base64')
}
// Actual CLI helper declarations run with real node:crypto in a VM. The CLI's
// migration main() is deliberately not invoked: no real/test database mutation
// or key rotation. This is NOT a validation of the Prisma migration workflow.
const migrationSource = fs.readFileSync(path.resolve(__dirname, '../../../scripts/encrypt-smtp-secrets.js'), 'utf8')
const boundary = migrationSource.indexOf('\nasync function main()')
if (boundary < 0) throw new Error('Migration helper boundary missing')
const migration = vm.runInNewContext(migrationSource.slice(0, boundary) + '\n({encrypt,decryptWithKeys})', { require, Buffer, console, process }, { timeout: 1000 })
const implementations = [
  { name: 'backup envelope', stored: () => encrypt(plain,key), full: (stored: ReturnType<typeof encrypt>) => decrypt(stored,key).toString(), altered: (stored: ReturnType<typeof encrypt>, length: number) => () => decrypt({...stored,tag:tagOfLength(stored.tag,length,'base64')},key) },
  { name: 'SMTP stored secret', stored: () => encryptSecret(plain), full: (stored: string) => decryptSecret(stored), altered: (stored: string,length: number) => () => decryptSecret(secretWithTag(stored,length)) },
  { name: 'e-invoice credentials', stored: () => encryptCredential(plain), full: (stored: string) => decryptCredential(stored), altered: (stored: string,length: number) => () => { const parts=stored.split('.');parts[3]=tagOfLength(parts[3],length,'base64url');return decryptCredential(parts.join('.')) } },
  { name: 'SMTP migration helper', stored: () => migration.encrypt(plain,key), full: (stored: string) => migration.decryptWithKeys(stored,[key]), altered: (stored: string,length: number) => () => migration.decryptWithKeys(secretWithTag(stored,length),[key]) },
]
// Keep typed generic-envelope and string-envelope cases separate at the test
// boundary; all callbacks remain the real production/helper implementations.
for (const impl of implementations) describe(impl.name, () => {
  it('retains genuine full-length tag compatibility', () => { const stored=impl.stored();expect((impl.full as (s: typeof stored) => unknown)(stored)).toBe(plain) })
  it.each([0,1,3,4,8,12,13,14,15,17,32])('rejects %i-byte authentication tags', length => {
    const stored=impl.stored()
    expect((impl.altered as (s: typeof stored,n: number) => () => unknown)(stored,length)).toThrow()
  })
})
describe('TOTP already rejects truncated tags (scanner alert is not a proven flaw)', () => {
  it.each([4,8,12,13,14,15])('rejects %i-byte tags', length => {
    const parts=chiffrerSecretTotp(plain).split('.')
    parts[3]=tagOfLength(parts[3],length,'base64url')
    expect(dechiffrerSecretTotp(parts.join('.'))).toBeNull()
  })
})
