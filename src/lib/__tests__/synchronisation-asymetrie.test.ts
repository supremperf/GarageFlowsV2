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
 *   PWA mécanicien → poste garage : RIEN.
 *     `src/app/page.tsx` ne sonde pas. Il ne recharge qu'au retour de focus, et
 *     au plus une fois par 30 s. Mesuré : un mécanicien démarre son intervention
 *     depuis la PWA (base : `status=in_progress`, `timerStartedAt` posé), et
 *     l'écran du poste reste INCHANGÉ pendant 20 s. Le retour de focus lui-même
 *     n'a rien rafraîchi — la garde de 30 s n'était pas écoulée. Il a fallu un
 *     rechargement explicite.
 *
 * ─── Pourquoi ça compte ─────────────────────────────────────────────────────
 * Le planning du poste est l'écran laissé ouvert toute la journée sur le
 * comptoir de l'atelier. Un mécanicien qui démarre un travail, le termine,
 * ajoute une photo ou un commentaire est invisible pour le garage jusqu'à ce
 * que quelqu'un appuie sur F5 ou clique « Actualiser ». Le sens qui manque est
 * précisément celui que le responsable regarde.
 *
 * ─── Pourquoi la correction évidente est REFUSÉE ici ────────────────────────
 * Rebrancher `useMechanicLive` sur le planning du poste serait immédiat : le
 * module existe, il est testé, il se met en veille en arrière-plan. Mais la
 * limite de débit `api` est indexée sur l'ADRESSE IP, à 120 req/min, et tous
 * les appareils d'un garage sortent derrière la même. Mesuré :
 *
 *     PWA mécanicien au premier plan .......... 42 req/min
 *     poste avec un sondage à 3 s (jobs+mécas) . ~40 req/min estimées
 *
 * Soit, pour un poste et deux mécaniciens : ~124 req/min — au-dessus du quota.
 * Ajouter le sondage côté poste FABRIQUERAIT donc les 429 que GF-DUR-035 vient
 * d'éliminer. La solution demande de trancher d'abord l'indexation du quota (ou
 * la cadence), ce qui est une décision d'exploitation, pas un détail technique.
 *
 * Ce fichier existe pour que ce choix reste VISIBLE plutôt que de redevenir une
 * hypothèse tacite. Il vérifie l'état des lieux ; il ne le valide pas.
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

describe('sens PWA → poste : constat figé, à trancher (GF-DUR-036)', () => {
  const poste = lire('src/app/page.tsx')

  it('le planning du poste NE SONDE PAS les données — constat écrit, pas supposé', () => {
    // On vise le RECHARGEMENT DE DONNÉES, pas n'importe quel minuteur : le
    // poste porte bien un `setInterval`, mais il pilote `runAI` toutes les
    // 3 minutes — une analyse locale des données DÉJÀ chargées, qui n'appelle
    // pas le serveur. Une première version de ce test l'avait confondu avec un
    // sondage et concluait l'inverse de la mesure.
    const sondageDonnees = [
      /setInterval\(\s*fetchData/,
      /setInterval\(\s*fetchMechanics/,
      /setInterval\(\s*\(\)\s*=>\s*\{?\s*fetch(Data|Mechanics)/,
      /useMechanicLive</,
      /refetchInterval/,
    ].some((rx) => rx.test(poste))
    expect(
      sondageDonnees,
      'Un sondage de données a été ajouté au poste : revoyez d’abord l’indexation du quota `api` (120 req/min PAR IP, partagés par tout le garage).',
    ).toBe(false)
  })

  it('le seul minuteur du poste est l’analyse locale, sans appel serveur', () => {
    // Verrouille la distinction ci-dessus : si `runAI` se met à appeler le
    // serveur toutes les 3 minutes, le calcul de quota change.
    expect(poste).toMatch(/setInterval\(runAI, 3 \* 60 \* 1000\)/)
  })

  it('le seul rafraîchissement automatique est le retour de focus, throttlé', () => {
    expect(poste).toMatch(/visibilitychange/)
    expect(poste).toMatch(/30_000/)
  })

  it('un rafraîchissement manuel reste offert — c’est aujourd’hui la seule voie', () => {
    // Tant que le sens PWA → poste n'est pas assuré, retirer ce bouton
    // laisserait le garage sans aucun moyen de voir le travail en cours.
    expect(poste).toMatch(/onRefresh/)
  })
})
