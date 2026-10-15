/**
 * Les huit derniers culs-de-sac du LOT 6.
 *
 * Chacun a la même forme : l'utilisateur fait un geste normal et se retrouve
 * quelque part d'où rien ne le sort — un 404 anglophone, un JSON brut, une page
 * hors ligne qui a mangé son planning, un rechargement qui a mangé sa saisie.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('le service worker ne recharge pas quand rien n’a changé', () => {
  const src = lire('src/components/PwaRegister.tsx')

  it('aucun rechargement à la PREMIÈRE visite', () => {
    // `clients.claim()` fait passer le contrôleur de null au worker, ce qui
    // déclenche `controllerchange` : la page se rechargeait toute seule
    // quelques secondes après l'arrivée d'un visiteur, formulaire compris.
    expect(src).toContain('const avaitUnControleur = navigator.serviceWorker.controller !== null')
    expect(src).toContain('if (refreshing || !avaitUnControleur) return')
  })

  it('« Mettre à jour » demande confirmation avant de recharger', () => {
    // Le rechargement détruit ce qui n'est pas parti : un commentaire en cours,
    // une photo prise et pas encore envoyée. Une nouvelle version n'a jamais
    // l'urgence d'une saisie en cours.
    expect(src).toContain("onClick={() => setConfirmation(true)}")
    expect(src).toMatch(/Ce qui n’a pas été envoyé sera perdu/)
    expect(src, 'il doit rester un moyen de refuser').toMatch(/Plus tard/)
  })
})

describe('les liens de courriel ne mènent plus à du JSON brut', () => {
  const route = lire('src/app/api/portal/auth/verify-email/route.ts')

  it('un lien déjà utilisé redirige vers une page', () => {
    expect(route).toContain("versConnexion('utilise')")
    expect(route, 'plus aucune réponse JSON sur cette route ouverte depuis un courriel')
      .not.toMatch(/NextResponse\.json\(\{ error/)
  })

  it('la page de connexion EXPLIQUE ce qui s’est passé', () => {
    const page = lire('src/app/clients/login/page.tsx')
    for (const motif of ['verified', 'email', 'lien']) {
      expect(page, `le retour « ${motif} » est ignoré`).toContain(`p.get('${motif}')`)
    }
    expect(page).toMatch(/devient votre identifiant/)
  })
})

describe('les champs sont annonçables au retour vocal', () => {
  it.each(['src/app/clients/login/page.tsx', 'src/app/clients/register/page.tsx'])(
    '%s englobe le champ dans son étiquette',
    (rel) => {
      const src = lire(rel)
      // Étiquette et champ étaient FRÈRES, sans `htmlFor` ni `id` : rien ne les
      // associait, et toucher l'étiquette ne donnait pas le focus au champ.
      expect(src).toContain('<label className="block">')
      expect(src).not.toMatch(/<label className="mb-1\.5 block/)
    },
  )
})

describe('aucune adresse du portail ne mène à un 404', () => {
  it('/clients amène à la connexion', () => {
    const conf = lire('next.config.mjs')
    expect(conf).toContain("{ source: '/clients', destination: '/clients/login', permanent: false }")
  })

  it('/portal reste couvert — QR codes et SMS déjà envoyés', () => {
    const conf = lire('next.config.mjs')
    expect(conf).toContain("{ source: '/portal', destination: '/clients', permanent: true }")
  })
})

describe('le planning survit à un appui hors réseau', () => {
  const src = lire('src/app/mechanic/page.tsx')

  it('ouvrir une intervention passe par un contrôle', () => {
    // Sans lui, la navigation basculait en chargement complet, le worker ne
    // trouvait rien en cache et servait la page hors ligne : l'application
    // entière disparaissait, planning compris.
    expect(src).toContain('onClick={() => ouvrirIntervention(job.id)}')
    expect(src).not.toContain('onClick={() => router.push(`/mechanic/jobs/${job.id}`)}')
  })

  it('le refus est DIT, et le planning reste', () => {
    expect(src).toContain('setRefusHorsLigne(true); return')
    expect(src).toMatch(/Votre planning reste affiché/)
  })

  it('`navigator.onLine` ne sert QU’À refuser', () => {
    // Il ment dans un sens (réseau présent, serveur injoignable) mais pas dans
    // l'autre : s'en servir pour AUTORISER serait faux.
    expect(src).toContain('navigator.onLine === false')
  })
})

describe('le contraste des phrases explicatives', () => {
  it('l’explication du changement de mot de passe est lisible', () => {
    const src = lire('src/app/clients/password/page.tsx')
    // `text-slate-500` en 11 px passait sous le seuil : le client lisait le
    // titre et les boutons, mais pas la phrase qui explique pourquoi.
    expect(src).toContain('text-xs text-slate-300')
  })
})
