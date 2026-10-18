/**
 * Trois publics, trois manifestes — l'icône installée doit ouvrir l'écran de
 * celui qui l'a installée.
 *
 * ─── Les défauts ────────────────────────────────────────────────────────────
 *
 * 1. Un seul manifeste, `start_url: '/'`, `scope: '/'`. L'icône installée par un
 *    MÉCANICIEN n'ouvrait donc jamais `/mechanic` directement : elle y arrivait
 *    par ricochet, le middleware redirigeant tant qu'une session `typ=mechanic`
 *    valide existait. Le jour où elle expire — 30 jours — l'icône ouvre le
 *    formulaire de connexion du GARAGE. Le mécanicien ne peut pas le franchir :
 *    il n'a pas de compte, il a une clé, et sa page de réactivation
 *    (`/license`) ne lui est proposée nulle part depuis là.
 *
 * 2. `/clients/*` n'avait pas de layout et héritait du `<head>` racine : le
 *    portail proposait donc au CLIENT d'installer le logiciel de gestion du
 *    garage, avec son nom, sa description, et un `start_url` qu'il ne peut pas
 *    ouvrir.
 *
 * 3. Trois raccourcis (`?view=schedule`, `?view=quotes`, `?view=invoices`)
 *    aboutissaient tous au même écran : AUCUNE ligne du code ne lit ce
 *    paramètre. Un raccourci qui ment est pire que pas de raccourci.
 *
 * 4. `site.webmanifest` — mort, non référencé par le moindre HTML, mais servi
 *    publiquement sous le nom de convention le plus répandu, et validé par la
 *    CI comme s'il comptait.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')
const manifeste = (rel: string) => JSON.parse(lire(rel)) as Record<string, unknown>

const RACINE_MF = manifeste('public/manifest.webmanifest')
const MECA_MF = manifeste('public/manifest-mecanicien.webmanifest')
const CLIENT_MF = manifeste('public/manifest-client.webmanifest')

describe('chaque public ouvre SON écran', () => {
  it('le mécanicien atterrit dans son espace, session valide ou non', () => {
    expect(MECA_MF.start_url).toBe('/mechanic')
    expect(MECA_MF.scope, 'hors de son espace, il est de toute façon redirigé').toBe('/mechanic')
  })

  it('le client atterrit dans le sien', () => {
    expect(CLIENT_MF.start_url).toBe('/clients/login')
    expect(CLIENT_MF.scope).toBe('/clients')
  })

  it('le logiciel de garage garde le sien', () => {
    expect(String(RACINE_MF.start_url)).toMatch(/^\/(\?|$)/)
  })

  it('les trois périmètres sont distincts — sinon l’un avalerait les autres', () => {
    const portees = [RACINE_MF.scope, MECA_MF.scope, CLIENT_MF.scope]
    expect(new Set(portees).size).toBe(3)
  })
})

describe('les layouts déclarent le bon manifeste', () => {
  it('l’espace mécanicien', () => {
    const src = lire('src/app/mechanic/layout.tsx')
    expect(src).toContain("manifest: '/manifest-mecanicien.webmanifest'")
    // …et la teinte annoncée est celle de CET écran, pas de l'accueil garage.
    expect(src).toContain("themeColor: '#0a0f1e'")
  })

  it('l’espace client', () => {
    const src = lire('src/app/clients/layout.tsx')
    expect(src).toContain("manifest: '/manifest-client.webmanifest'")
  })

  it('la racine ne réclame plus le manifeste général pour tout le monde', () => {
    // Le layout racine garde le sien : c'est aux sous-espaces de le remplacer.
    expect(lire('src/app/layout.tsx')).toContain("manifest: '/manifest.webmanifest'")
  })
})

describe('aucun raccourci ne promet ce qu’il ne tient pas', () => {
  it('le manifeste racine n’annonce plus de raccourcis inertes', () => {
    expect(RACINE_MF.shortcuts, 'les trois menaient au même écran').toBeUndefined()
  })

  it('si des raccourcis reviennent, leur destination doit être LUE quelque part', () => {
    // Garde de non-régression : ce test échouera le jour où l'on réintroduira
    // un raccourci sans câbler sa destination — c'est exactement ce qui s'était
    // produit avec `?view=`, que pas une ligne du code ne lisait.
    const sources: string[] = []
    const parcourir = (dossier: string) => {
      for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') parcourir(p) }
        else if (/\.(ts|tsx)$/.test(e.name) && !p.includes('__tests__')) sources.push(fs.readFileSync(p, 'utf8'))
      }
    }
    parcourir(path.join(RACINE, 'src'))
    const tout = sources.join('\n')

    const raccourcis = [RACINE_MF, MECA_MF, CLIENT_MF]
      .flatMap((m) => (m.shortcuts as Array<{ url?: string }> | undefined) ?? [])
    for (const r of raccourcis) {
      const url = String(r.url ?? '')
      for (const [, parametre] of Array.from(url.matchAll(/[?&]([a-zA-Z_]+)=/g))) {
        // `source=pwa` sert à la mesure d'audience, pas à l'aiguillage.
        if (parametre === 'source') continue
        expect(
          tout.includes(`'${parametre}'`) || tout.includes(`"${parametre}"`),
          `le raccourci « ${url} » passe « ${parametre} », qu’aucune ligne de src/ ne lit`,
        ).toBe(true)
      }
    }
  })
})

describe('aucun manifeste mort n’est servi', () => {
  it('site.webmanifest a disparu', () => {
    // Il n'était référencé par aucun HTML, mais servi sous le nom de convention
    // le plus répandu — et validé par la CI comme s'il comptait.
    expect(fs.existsSync(path.join(RACINE, 'public/site.webmanifest'))).toBe(false)
  })

  it('plus aucune référence n’y subsiste', () => {
    for (const rel of ['scripts/check-pwa.mjs', 'scripts/check-branding.mjs']) {
      expect(lire(rel), `${rel} énumère encore un fichier absent`).not.toContain('site.webmanifest')
    }
  })

  it('les gardes couvrent les TROIS manifestes vivants', () => {
    for (const rel of ['scripts/check-pwa.mjs', 'scripts/check-branding.mjs']) {
      const src = lire(rel)
      expect(src).toContain('manifest-mecanicien.webmanifest')
      expect(src).toContain('manifest-client.webmanifest')
    }
  })
})
