/**
 * GF-004 — l'avatar du mécanicien lisait un champ que personne ne produisait.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `MechanicAvatar` affichait la photo si `mechanic.photoUrl` existait. Or
 * `photoUrl` n'apparaissait NULLE PART ailleurs dans le dépôt : toutes les
 * sources — `GET /api/mechanics`, `PUT /api/mechanics/:id/avatar`,
 * `GET /api/mechanic/me`, le type `MechanicRecord` — renvoient `avatarUrl`.
 *
 * Conséquence : le composant retombait TOUJOURS sur les initiales. Sur les cinq
 * surfaces qui l'utilisent — liste de l'équipe, fiche en cours d'édition,
 * en-tête de colonne du planning, sélecteur de mécanicien, en-tête de la PWA
 * mécanicien — aucune photo n'a jamais pu s'afficher.
 *
 * Vu de l'utilisateur : « je change la photo, ça dit que c'est enregistré, et
 * rien ne change ». L'envoi réussissait pourtant de bout en bout : image
 * validée, fichier écrit, base à jour, propagation cloud effectuée. Seul
 * l'affichage regardait ailleurs.
 *
 * ─── Pourquoi ni TypeScript ni les tests existants ne l'ont vu ──────────────
 * `mechanic={m}` passe une VARIABLE : le contrôle des propriétés excédentaires
 * de TypeScript ne s'applique qu'aux littéraux d'objet, et `photoUrl` était
 * optionnel — un objet qui porte `avatarUrl` satisfait donc parfaitement le
 * contrat. Quant aux gardes existants, ils vérifiaient la PRÉSENCE de
 * `<MechanicAvatar` dans les écrans, jamais que le champ lu existait.
 *
 * ─── Ce que ce garde vérifie ────────────────────────────────────────────────
 * La propriété générale, pas le seul nom corrigé : TOUT champ que le composant
 * lit sur son mécanicien doit être produit par au moins une API de mécanicien.
 * Un futur renommage d'un seul côté rouvrirait le défaut ; il échouera ici.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

const COMPOSANT = 'src/components/MechanicAvatar.tsx'

/** Routes qui décrivent un mécanicien à une interface. */
const PRODUCTEURS = [
  'src/app/api/mechanics/route.ts',
  'src/app/api/mechanics/[id]/avatar/route.ts',
  'src/app/api/mechanic/me/route.ts',
]

/** Types partagés qui décrivent un mécanicien côté client. */
const CONTRATS = [
  'src/components/settings/types.ts',
  'src/lib/types.ts',
  'src/app/mechanic/page.tsx',
]

/**
 * ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. L'inverse
 * laisse un `/*` écrit dans un commentaire de ligne avaler du code — et ce
 * fichier-ci commente abondamment l'ancien nom, qu'il ne doit surtout pas
 * compter comme du code.
 */
function sansCommentaires(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** Tous les .ts/.tsx de src/, tests exclus. */
function sources(dir = path.join(RACINE, 'src'), acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      sources(p, acc)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** Champs de REPLI, calculés sans photo — ils n'ont pas à venir d'une API. */
const CHAMPS_DE_REPLI = new Set(['name', 'avatar', 'color', 'isAbsent'])

describe('avatar mécanicien — le champ lu est bien celui qui est produit (GF-004)', () => {
  it('tout champ lu par le composant est produit par au moins une API', () => {
    const code = sansCommentaires(lire(COMPOSANT))
    const lus = new Set(Array.from(code.matchAll(/\bmechanic\.(\w+)/g), (m) => m[1]))
    expect(lus.size, 'aucun accès `mechanic.<champ>` trouvé — le composant a changé de forme').toBeGreaterThan(0)

    const produit = PRODUCTEURS.map((r) => sansCommentaires(lire(r))).join('\n')
    const orphelins = Array.from(lus).filter(
      (champ) => !CHAMPS_DE_REPLI.has(champ) && !new RegExp(`\\b${champ}\\s*:`).test(produit),
    )
    expect(
      orphelins,
      'le composant lit un champ qu’aucune API de mécanicien ne renvoie — il affichera toujours le repli',
    ).toEqual([])
  })

  it('la photo est lue sous le nom `avatarUrl`', () => {
    expect(sansCommentaires(lire(COMPOSANT))).toContain('mechanic.avatarUrl')
  })

  it('les trois APIs renvoient bien `avatarUrl`', () => {
    for (const rel of PRODUCTEURS) {
      expect(sansCommentaires(lire(rel)), `${rel} doit renvoyer avatarUrl`).toMatch(/\bavatarUrl\s*:/)
    }
  })

  it('les contrats client déclarent `avatarUrl`', () => {
    for (const rel of CONTRATS) {
      expect(sansCommentaires(lire(rel)), `${rel} doit déclarer avatarUrl`).toMatch(/\bavatarUrl\??\s*:/)
    }
  })

  it('plus aucun `photoUrl` orphelin dans le code', () => {
    // Il n'était produit par personne : le laisser vivre, c'est laisser un
    // second nom pour la même chose et rouvrir la porte au même défaut.
    const fautifs = sources()
      .filter((f) => /\bphotoUrl\b/.test(sansCommentaires(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(RACINE, f).replace(/\\/g, '/'))
    expect(fautifs, 'un seul nom de champ pour la photo d’un mécanicien').toEqual([])
  })

  it('la liste de l’équipe se rafraîchit quand la photo change', () => {
    // La photo s'enregistre hors du formulaire : sans rechargement, la vignette
    // de la ligne gardait l'ancienne image alors que la fiche montrait la neuve.
    const tab = sansCommentaires(lire('src/components/settings/MechanicsTab.tsx'))
    expect(tab).toContain('onAvatarChanged')
    const modale = sansCommentaires(lire('src/components/SettingsModal.tsx'))
    expect(modale).toMatch(/onAvatarChanged=\{loadMechanics\}/)
  })

  it('un envoi non synchronisé au cloud n’est pas annoncé comme un succès complet', () => {
    // La route renvoie `cloudSynced` exprès : tant qu'il vaut false, la photo
    // n'existe que sur ce poste et le mécanicien voit encore ses initiales.
    expect(sansCommentaires(lire('src/components/settings/MechanicAvatarField.tsx')))
      .toContain('cloudSynced')
  })
})
