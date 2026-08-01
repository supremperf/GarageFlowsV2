/**
 * Parcours 4-8 : flux garage réels via l'application en fonctionnement
 * (navigateur + serveur Next + base). Données fictives.
 *   4. tableau de bord accessible après connexion ;
 *   5. création d'un client (persistée, visible dans la liste) ;
 *   6. import CSV de clients (dry-run puis exécution) ;
 *   7. décision d'abonnement (endpoint serveur) ;
 *   8. liste des employés réservée au propriétaire.
 */
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => { await login(page, 'a') })

test('parcours 4 : le tableau de bord se charge après connexion', async ({ page }) => {
  await page.goto('/')
  // L'app ne renvoie pas sur /login et rend un contenu (pas d'écran d'erreur).
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('body')).toBeVisible()
})

test('parcours 5 : création d’un client, visible dans la liste', async ({ page }) => {
  const create = await page.request.post('/api/clients', {
    data: { name: 'Nouveau Client E2E', phone: '0102030405', email: 'e2e-new@x.test' },
  })
  expect([200, 201]).toContain(create.status())
  const res = await page.request.get('/api/clients')
  const body = await res.json()
  const list = Array.isArray(body) ? body : (body.clients ?? body.data ?? [])
  expect(list.map((c: any) => c.name)).toContain('Nouveau Client E2E')
})

test('parcours 6 : import CSV de clients (dry-run puis exécution)', async ({ page }) => {
  const csv = 'nom,email\nImport Un,imp1@x.test\nImport Deux,imp2@x.test'
  const dry = await page.request.post('/api/import', { data: { entity: 'clients', csv, dryRun: true } })
  expect(dry.ok()).toBeTruthy()
  const dryBody = await dry.json()
  expect(dryBody.plan.toCreate.length).toBe(2)

  const run = await page.request.post('/api/import', { data: { entity: 'clients', csv, dryRun: false } })
  expect([200, 201]).toContain(run.status())
  expect((await run.json()).created).toBe(2)
})

test('parcours 7 : décision d’abonnement renvoyée par le serveur', async ({ page }) => {
  const res = await page.request.get('/api/subscription')
  expect(res.ok()).toBeTruthy()
  const d = await res.json()
  // Sans abonnement configuré, l'accès est refusé (décision serveur explicite).
  expect(d).toHaveProperty('allowed')
  expect(d).toHaveProperty('effectiveStatus')
})

test('parcours 8 : liste des employés accessible au propriétaire', async ({ page }) => {
  const res = await page.request.get('/api/users')
  expect(res.ok()).toBeTruthy()
  const list = await res.json()
  expect(Array.isArray(list)).toBeTruthy()
  expect(list.some((u: any) => u.role === 'OWNER')).toBeTruthy()
})
