/**
 * Parcours 1-2 : authentification. Connexion réussie, échec sur mauvais mot de
 * passe, et redirection d'une route protégée vers /login.
 */
import { test, expect } from '@playwright/test'
import { login, CREDS } from './helpers'

test('connexion réussie du propriétaire A', async ({ page }) => {
  await login(page, 'a')
  await expect(page).not.toHaveURL(/\/login/)
})

test('échec de connexion avec un mauvais mot de passe', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(CREDS.a.email)
  await page.locator('input[type="password"]').fill('mauvais-mot-de-passe')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByText('Email ou mot de passe incorrect.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('une route protégée redirige vers /login sans session', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login/)
})
