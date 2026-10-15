/**
 * Hors ligne, l'application doit dire la vérité — et rester utilisable.
 *
 * ─── Les défauts ────────────────────────────────────────────────────────────
 *
 * 1. La page hors ligne AFFIRMAIT : « Vos actions ne sont enregistrées sur le
 *    serveur qu'une fois la connexion rétablie. » Cette phrase décrit une file
 *    d'attente différée. Il n'y en a AUCUNE — ni localStorage, ni IndexedDB, ni
 *    file d'envoi nulle part. Un mécanicien pouvait donc croire son travail mis
 *    de côté alors qu'il était perdu.
 *
 * 2. La déconnexion effaçait TOUS les caches, y compris le cache statique qui
 *    porte `offline.html`. Le worker ne le reprécharge qu'à une prochaine
 *    INSTALLATION : un mécanicien qui se déconnectait puis perdait le réseau
 *    n'avait plus d'écran du tout.
 *
 * 3. Les erreurs de transport remontaient en anglais brut — « Failed to fetch »,
 *    « NetworkError », « Load failed » — à l'écran d'un mécanicien en atelier.
 *
 * 4. Changer de jour hors réseau laissait les interventions de la VEILLE sous la
 *    nouvelle date : `data` n'était jamais remise à null.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('la page hors ligne ne promet rien qu’elle ne tienne', () => {
  const page = lire('public/offline.html')

  it('elle n’annonce plus un enregistrement différé inexistant', () => {
    expect(page, 'aucune file d’attente n’existe dans le code')
      .not.toMatch(/ne sont enregistrées sur le serveur qu'une fois la connexion rétablie/)
  })

  it('elle dit ce qui se passe VRAIMENT pour ce qui n’est pas parti', () => {
    expect(page).toMatch(/n'est pas conservé/)
  })

  it('elle laisse une porte de sortie vers le planning', () => {
    // Sans cela, un mécanicien éjecté ici n'avait aucun chemin de retour.
    expect(page).toMatch(/href="\/mechanic"/)
  })

  it('elle détecte le retour du réseau au lieu d’attendre un appui', () => {
    expect(page).toMatch(/addEventListener\('online'/)
  })
})

describe('la déconnexion n’emporte pas la page hors ligne', () => {
  it('le cache statique est épargné', () => {
    const src = lire('src/lib/mechanic-client.ts')
    expect(src).toContain("keys.filter((k) => !k.endsWith('-static'))")
  })

  it('les caches PRIVÉS sont bien effacés, eux', () => {
    // La raison d'être de la purge : les données d'un mécanicien ne doivent pas
    // rester visibles au suivant sur le même appareil.
    const src = lire('src/lib/mechanic-client.ts')
    expect(src).toMatch(/prives\.map\(\(k\) => caches\.delete\(k\)\)/)
  })
})

describe('les messages affichés sont en français et actionnables', () => {
  it('une panne de transport est traduite', async () => {
    const { messageLisible } = await import('@/lib/use-mechanic-live')
    for (const brut of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      const lisible = messageLisible(new Error(brut))
      expect(lisible, `« ${brut} » ne doit pas atteindre l’écran`).not.toBe(brut)
      expect(lisible).toMatch(/réseau/i)
    }
  })

  it('un délai dépassé est expliqué, pas masqué', async () => {
    const { messageLisible } = await import('@/lib/use-mechanic-live')
    expect(messageLisible(new Error('Délai dépassé'))).toMatch(/trop de temps/i)
  })

  it('un message MÉTIER du serveur est conservé intact', async () => {
    // C'est lui qui porte l'information utile : le reformuler la détruirait.
    const { messageLisible } = await import('@/lib/use-mechanic-live')
    expect(messageLisible(new Error('Intervention non accessible.'))).toBe('Intervention non accessible.')
  })

  it('une valeur non-Error ne produit pas « undefined » à l’écran', async () => {
    const { messageLisible } = await import('@/lib/use-mechanic-live')
    expect(messageLisible(null)).toMatch(/impossible/i)
  })
})

describe('changer de jour ne montre pas la veille', () => {
  it('la donnée précédente est effacée au changement d’URL', () => {
    const src = lire('src/lib/use-mechanic-live.ts')
    // Mieux vaut un écran vide et honnête qu'un planning d'hier sous la date
    // d'aujourd'hui, sans rien qui le signale.
    expect(src).toMatch(/setLoading\(true\)[\s\S]{0,400}setData\(null\)/)
  })
})
