import { Page, expect } from '@playwright/test'
import { CREDS } from './global-setup'

/**
 * Connexion via l'UI réelle (sélecteurs de src/app/login/page.tsx). Robuste à la
 * latence du dev-server : la 1re compilation de /api/auth/callback/credentials
 * peut échouer/temporiser, on retente donc la soumission complète.
 */
export async function login(page: Page, who: 'a' | 'b') {
  const c = CREDS[who]
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(c.email)
    await page.locator('input[type="password"]').fill(c.password)
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/auth/callback/credentials'), { timeout: 60_000 }).catch(() => null),
      page.getByRole('button', { name: 'Se connecter' }).click(),
    ])
    await page.waitForTimeout(700) // laisse le cookie de session s'écrire
    await page.goto('/')
    if (!page.url().includes('/login')) return
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
}

export { CREDS }
