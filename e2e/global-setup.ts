/**
 * Préparation E2E : pousse le schéma sur une base SQLite dédiée et sème DEUX
 * garages (A et B) avec propriétaires + données, pour tester les parcours réels
 * ET l'isolation multi-tenant. Données 100 % FICTIVES.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { PrismaClient } from '@prisma/client'

export const E2E_DB = path.resolve(__dirname, '../.tmp-e2e.db')
export const E2E_URL = `file:${E2E_DB}`
// Doit correspondre à playwright.config.ts (webServer.env).
export const E2E_SECRET = 'e2e-only-secret-not-for-production-0123456789abcdef'
export const STORAGE_STATE = path.resolve(__dirname, '.auth/license.json')

/**
 * Débloque le portail de licence (middleware) en injectant un cookie gf_session
 * VALIDE (JWT signé avec NEXTAUTH_SECRET). L'enforcement DB est désactivé côté
 * API via LICENSE_ENFORCEMENT=off (voir la config), donc aucune licence réelle
 * n'est requise — ceci est un contournement de TEST, jamais de production.
 */
async function writeLicenseStorageState() {
  const token = await new SignJWT({ typ: 'premium', lid: 'e2e-license', did: 'e2e-device' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(E2E_SECRET))
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  fs.writeFileSync(STORAGE_STATE, JSON.stringify({
    cookies: [{
      name: 'gf_session', value: token, domain: '127.0.0.1', path: '/',
      httpOnly: true, secure: false, sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    }],
    origins: [],
  }))
}
export const CREDS = {
  a: { email: 'owner@a.test', password: 'PasswordA-123!', garage: 'Atelier A' },
  b: { email: 'owner@b.test', password: 'PasswordB-123!', garage: 'Atelier B' },
}

export default async function globalSetup() {
  if (fs.existsSync(E2E_DB)) fs.rmSync(E2E_DB)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: E2E_URL }, stdio: 'ignore',
  })
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_URL } } })
  try {
    for (const key of ['a', 'b'] as const) {
      const c = CREDS[key]
      const garage = await prisma.garage.create({ data: { name: c.garage, slug: `atelier-${key}` } })
      await prisma.user.create({
        data: { name: `Propriétaire ${key.toUpperCase()}`, email: c.email, password: await bcrypt.hash(c.password, 10), role: 'OWNER', status: 'active', garageId: garage.id },
      })
      await prisma.client.create({ data: { name: `Client ${key.toUpperCase()}`, email: `client-${key}@x.test`, garageId: garage.id } })
    }
  } finally {
    await prisma.$disconnect()
  }
  await writeLicenseStorageState()
}
