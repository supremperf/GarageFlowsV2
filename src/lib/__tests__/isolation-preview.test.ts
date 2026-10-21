/**
 * ISOLATION PREVIEW / PRODUCTION — tests NÉGATIFS.
 *
 * ─── Le risque, et pourquoi il est structurel ───────────────────────────────
 * Sur Vercel, une intégration Marketplace (Neon, Upstash) est attachée au
 * PROJET : ses variables sont injectées dans Production ET Preview. Sans
 * surcharge explicite au niveau Preview, chaque branche déployée se connecte à
 * la base de production et écrit dans les données réelles des clients.
 *
 * L'audit du 2026-10-20 (constat V-02) a relevé que le projet
 * `app.garageflows.fr` ne déclarait AUCUNE variable sur ses trois
 * environnements, et que `VERCEL_ENV` n'était lu nulle part dans le code hors
 * route de diagnostics : rien ne distinguait Preview de Production.
 *
 * ─── Ce que ces tests prouvent ──────────────────────────────────────────────
 * Un test positif (« l'isolation fonctionne quand elle est configurée ») ne
 * suffit pas : ce qui compte est qu'un Preview mal configuré soit REFUSÉ. Les
 * tests ci-dessous sont donc écrits à l'envers — ils vérifient que la
 * configuration dangereuse échoue, et que `assertEnv` LÈVE au lieu d'avertir.
 *
 * Sur Vercel, un déploiement Preview a `NODE_ENV=production` : `assertEnv` y
 * lève donc réellement, et la fonction ne sert aucune requête. Le dernier test
 * fige précisément cette combinaison, car c'est elle qui existe en production.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { empreinteCibleBase, validateEnv, assertEnv } from '@/lib/env'

/** URL de production FICTIVE : aucune valeur réelle n'apparaît dans ce dépôt. */
const PROD = 'postgresql://u_prod:MOT_DE_PASSE@ep-exemple-prod-pooler.c-5.eu-west-3.aws.neon.tech/neondb?sslmode=require'
/** Même cible, mot de passe DIFFÉRENT — simule une rotation d'identifiants. */
const PROD_APRES_ROTATION = 'postgresql://u_prod:AUTRE_MOT_DE_PASSE@ep-exemple-prod-pooler.c-5.eu-west-3.aws.neon.tech/neondb?sslmode=require'
/** Branche Neon dédiée à Preview : hôte distinct ⇒ empreinte distincte. */
const PREVIEW = 'postgresql://u_prev:MOT_DE_PASSE@ep-exemple-preview-pooler.c-5.eu-west-3.aws.neon.tech/neondb?sslmode=require'

const EMPREINTE_PROD = empreinteCibleBase(PROD)!

/** Environnement minimal et VALIDE, pour n'isoler que le défaut testé. */
function environnementSain(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    NEXTAUTH_SECRET: 'x'.repeat(48),
    DEVICE_TOKEN_PEPPER: 'y'.repeat(48),
    UPSTASH_REDIS_REST_URL: 'https://exemple.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'z'.repeat(48),
    VERCEL: '1',
    GF_PRODUCTION_DB_FINGERPRINT: EMPREINTE_PROD,
    ...over,
  }
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v)
}

/** Les problèmes signalés sur DATABASE_URL, concaténés. */
function problemesBase(): string {
  return validateEnv().issues.filter((i) => i.name === 'DATABASE_URL').map((i) => i.problem).join(' | ')
}

afterEach(() => vi.unstubAllEnvs())

describe('empreinteCibleBase — propriétés', () => {
  it('ne dépend PAS du mot de passe : elle survit à une rotation', () => {
    // C'est ce qui rend la garde durable : roter les identifiants ne la périme pas.
    expect(empreinteCibleBase(PROD_APRES_ROTATION)).toBe(EMPREINTE_PROD)
  })

  it('distingue deux cibles différentes', () => {
    expect(empreinteCibleBase(PREVIEW)).not.toBe(EMPREINTE_PROD)
  })

  it('ne contient aucun fragment des identifiants (publiable en clair)', () => {
    expect(EMPREINTE_PROD).toMatch(/^[0-9a-f]{64}$/)
    for (const fragment of ['u_prod', 'MOT_DE_PASSE']) {
      expect(EMPREINTE_PROD).not.toContain(fragment)
    }
  })

  it('retourne null sur une entrée absente ou illisible, jamais une empreinte fausse', () => {
    for (const mauvais of [undefined, null, '', '   ', 'pas-une-url', 'file:./dev.db']) {
      expect(empreinteCibleBase(mauvais as string | undefined)).toBeNull()
    }
  })
})

describe('garde d’isolation — tests NÉGATIFS', () => {
  it('REFUSE un Preview pointant vers la base de PRODUCTION', () => {
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PROD })
    expect(problemesBase()).toContain('base de PRODUCTION')
  })

  it('REFUSE aussi après une rotation d’identifiants (même cible, autre mot de passe)', () => {
    // Le cas qui piégerait une garde fondée sur l'égalité des URL entières.
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PROD_APRES_ROTATION })
    expect(problemesBase()).toContain('base de PRODUCTION')
  })

  it('ACCEPTE un Preview sur sa propre branche de base', () => {
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PREVIEW })
    expect(problemesBase()).not.toContain('base de PRODUCTION')
  })

  it('n’entrave PAS la production, qui doit évidemment viser sa propre base', () => {
    environnementSain({ VERCEL_ENV: 'production', DATABASE_URL: PROD })
    expect(problemesBase()).not.toContain('base de PRODUCTION')
  })

  it('se tait, sans fausse assurance, quand l’empreinte de référence est absente', () => {
    // Une garde non provisionnée ne peut rien affirmer. Elle ne doit NI bloquer
    // à tort, NI laisser croire qu'elle protège : c'est `check:env-vercel` qui
    // doit exiger GF_PRODUCTION_DB_FINGERPRINT.
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PROD, GF_PRODUCTION_DB_FINGERPRINT: '' })
    expect(problemesBase()).not.toContain('base de PRODUCTION')
  })
})

describe('fail-closed — le Preview dangereux ne sert aucune requête', () => {
  it('assertEnv LÈVE pour un Preview Vercel pointant vers la production', () => {
    // Combinaison RÉELLE sur Vercel : un Preview porte NODE_ENV=production.
    // C'est donc bien la branche qui lève, pas celle qui se contente d'avertir.
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PROD, NODE_ENV: 'production' })
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
    expect(() => assertEnv()).toThrow(/base de PRODUCTION/)
  })

  it('ne lève pas pour un Preview correctement isolé', () => {
    environnementSain({ VERCEL_ENV: 'preview', DATABASE_URL: PREVIEW, NODE_ENV: 'production' })
    expect(() => assertEnv()).not.toThrow()
  })
})
