/**
 * GF-DUR-036 — la synchronisation ne va que dans UN sens, et c'est mesuré.
 *
 * ─── Ce que le LOT 4 devait établir ─────────────────────────────────────────
 * Que les surfaces convergent. Elles ne convergent que dans un sens.
 *
 *   Poste garage → PWA mécanicien : sondage à 3 s (`lib/live-sync`).
 *     Mesuré sur `next start`, 7 scénarios sur 7 :
 *       création → visible chez A ..........  438 ms
 *       modification → visible chez A ...... 2989 ms
 *       réaffectation → disparaît de A ..... 2960 ms
 *       réaffectation → apparaît chez B .... 2962 ms
 *       suppression → plus de fantôme ......  791 ms
 *       médiane 2960 ms · pire cas 2989 ms
 *
 *   PWA mécanicien → poste garage : RIEN, jusqu'au 14/08/2026.
 *     `src/app/page.tsx` ne sondait pas. Il ne rechargeait qu'au retour de
 *     focus, et au plus une fois par 30 s. Mesuré : un mécanicien démarre son
 *     intervention depuis la PWA (base : `status=in_progress`, `timerStartedAt`
 *     posé), et l'écran du poste reste INCHANGÉ pendant 20 s. Le retour de focus
 *     lui-même n'a rien rafraîchi — la garde de 30 s n'était pas écoulée.
 *
 *     CORRIGÉ (GF-DUR-041) par un sondage d'EMPREINTE : `/api/jobs/pulse`
 *     renvoie un haché de deux agrégats, jamais de donnée métier. Le poste
 *     l'interroge toutes les 10 s (6 req/min) et ne recharge le planning que si
 *     l'empreinte change. Un sondage classique des deux listes aurait coûté
 *     ~40 req/min et fait dépasser le quota — voir ci-dessous.
 *
 * ─── Pourquoi ça compte ─────────────────────────────────────────────────────
 * Le planning du poste est l'écran laissé ouvert toute la journée sur le
 * comptoir de l'atelier. Un mécanicien qui démarre un travail, le termine,
 * ajoute une photo ou un commentaire est invisible pour le garage jusqu'à ce
 * que quelqu'un appuie sur F5 ou clique « Actualiser ». Le sens qui manque est
 * précisément celui que le responsable regarde.
 *
 * ─── Pourquoi PAS le sondage évident, et ce qui a été retenu ────────────────
 * Rebrancher `useMechanicLive` sur le planning du poste aurait été immédiat.
 * Mais la limite `api` vaut 120 req/min et elle est indexée sur l'ADRESSE IP :
 * tous les appareils d'un garage sortent derrière la même. Mesuré :
 *
 *     PWA mécanicien au premier plan .............. 42 req/min
 *     poste, sondage à 3 s des deux listes ......... ~40 req/min
 *     → poste + 2 mécaniciens ...................... ~124 req/min, HORS quota
 *
 * Le remède aurait fabriqué les 429 que GF-DUR-035 venait d'éliminer.
 *
 * Changer l'indexation du quota a aussi été écarté : la limite s'applique AVANT
 * `requireSession()`, précisément pour protéger le chemin d'authentification.
 * L'indexer sur le garage exigerait d'authentifier d'abord — donc de ne plus
 * protéger ce qu'elle protège.
 *
 * Retenu : sonder une EMPREINTE plutôt que les données.
 *
 *     poste, empreinte toutes les 10 s ............. 6 req/min
 *     → poste + 2 mécaniciens ...................... ~90 req/min, sous quota
 *
 * Latence assumée : jusqu'à 10 s pour voir l'action d'un mécanicien. Le garage
 * ne guette pas un clic comme un mécanicien attend son affectation. Aucune de
 * ces valeurs ne s'appelle « temps réel ».
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('sens poste → PWA : le sondage existe et reste à 3 s', () => {
  it('la PWA mécanicien utilise bien la politique vivante', () => {
    expect(lire('src/app/mechanic/page.tsx')).toMatch(/useMechanicLive</)
  })

  it('la cadence annoncée est celle qui est appliquée', () => {
    // Vérifié en navigateur : écarts de 3111, 3064, 3058, 3066, 3072, 3060 ms.
    expect(lire('src/lib/live-sync.ts')).toMatch(/LIVE_BASE_INTERVAL_MS = 3_000/)
  })
})

describe('sens PWA → poste : sondage d’EMPREINTE, pas de données (GF-DUR-041)', () => {
  const poste = lire('src/app/page.tsx')
  const pulse = lire('src/app/api/jobs/pulse/route.ts')

  it('le poste sonde l’empreinte, à 10 s', () => {
    // Le sens manquant est désormais assuré. La cadence est écrite ici pour que
    // toute modification repasse par le calcul de quota ci-dessous.
    expect(poste).toMatch(/\/api\/jobs\/pulse\?date=/)
    expect(poste).toMatch(/setTimeout\(battre, 10_000\)/)
  })

  it('le poste ne sonde PAS les listes complètes — c’est tout l’intérêt', () => {
    // Sondage d'empreinte : 6 req/min. Sondage des deux listes : ~40 req/min.
    // Avec 120 req/min PAR IP partagés par tout le garage, c'est la différence
    // entre tenir (poste + 2 mécaniciens ≈ 90/min) et fabriquer des 429.
    const sondageLourd = [
      /setInterval\(\s*fetchData/,
      /setInterval\(\s*fetchMechanics/,
      /setTimeout\(\s*fetchData/,
      /useMechanicLive</,
      /refetchInterval/,
    ].some((rx) => rx.test(poste))
    expect(
      sondageLourd,
      'Un sondage des listes complètes a été ajouté : refaites le calcul de quota (120 req/min PAR IP, partagés par tout le garage) avant de le garder.',
    ).toBe(false)
  })

  it('le rechargement n’a lieu QUE si l’empreinte a changé', () => {
    // Sonder puis recharger à chaque battement annulerait le gain.
    expect(poste).toMatch(/if \(vu !== null && v !== vu\) \{ fetchData\(\); fetchMechanics\(\) \}/)
  })

  it('aucune requête en arrière-plan', () => {
    // Un écran d'atelier passe des heures masqué : y sonder viderait le quota
    // pour rien.
    expect(poste).toMatch(/if \(!document\.hidden\)/)
    expect(poste).toMatch(/document\.hidden\) battre\(\)/)
  })

  it('l’empreinte ne divulgue NI donnée métier NI volumétrie', () => {
    // La réponse est un haché tronqué : ni horodatage ni compte en clair, sinon
    // elle renseignerait sur l'activité du garage à qui l'observe.
    //
    // Depuis GF-039 elle porte aussi l'état de la remontée cloud — deux valeurs
    // fermées, `ok` ou `attente`. Elles ne disent rien de l'activité du garage,
    // seulement si le poste parle au cloud ; c'est précisément ce que l'écran
    // du comptoir devait pouvoir afficher.
    expect(pulse).toMatch(/createHash\('sha256'\)/)
    expect(pulse).toMatch(/cloud \? \{ v, cloud \} : \{ v \}/)
    expect(pulse).not.toMatch(/findMany/)
    // Aucun agrégat brut ne sort : ni compte, ni horodatage.
    expect(pulse).not.toMatch(/_count: \w+\._count/)
    expect(pulse).not.toMatch(/json\(\{[^}]*updatedAt/)
  })

  it('l’empreinte est bornée au garage de la SESSION', () => {
    expect(pulse).toMatch(/const garageId = session\.user\.garageId/)
    expect(pulse).toMatch(/const ouJobs = \{ garageId/)
  })

  it('le seul autre minuteur du poste est l’analyse locale, sans appel serveur', () => {
    expect(poste).toMatch(/setInterval\(runAI, 3 \* 60 \* 1000\)/)
  })

  it('le rafraîchissement manuel et celui au retour de focus restent offerts', () => {
    expect(poste).toMatch(/onRefresh/)
    expect(poste).toMatch(/30_000/)
  })
})
