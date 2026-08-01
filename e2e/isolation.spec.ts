/**
 * Parcours 3 (SÉCURITÉ) : isolation multi-tenant. Le propriétaire A, une fois
 * connecté, ne voit QUE les données du garage A via l'API réelle ; les données
 * du garage B ne fuient jamais dans sa session.
 */
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test('A ne voit que ses propres clients (aucune fuite depuis B)', async ({ page }) => {
  await login(page, 'a')
  // La requête réutilise les cookies de session du navigateur.
  const res = await page.request.get('/api/clients')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  const list = Array.isArray(body) ? body : (body.clients ?? body.data ?? [])
  const names: string[] = list.map((c: any) => c.name)
  expect(names).toContain('Client A')
  expect(names).not.toContain('Client B') // isolation : aucune donnée de B
})

test('B ne voit que ses propres clients', async ({ page }) => {
  await login(page, 'b')
  const res = await page.request.get('/api/clients')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  const list = Array.isArray(body) ? body : (body.clients ?? body.data ?? [])
  const names: string[] = list.map((c: any) => c.name)
  expect(names).toContain('Client B')
  expect(names).not.toContain('Client A')
})
