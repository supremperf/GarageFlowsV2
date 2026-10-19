/**
 * La boucle de rafraîchissement du mécanicien ne doit ni mourir, ni rester
 * aveugle à une réaffectation.
 *
 * ─── Deux défauts ───────────────────────────────────────────────────────────
 *
 * 1. `onGone` n'a JAMAIS été appelé. La détection cherchait
 *    `/introuvable|not found|404/i` dans le TEXTE du message, alors que les
 *    routes répondent « Intervention non accessible. ». Un mécanicien dont
 *    l'intervention venait d'être réaffectée restait donc sur un écran mort, à
 *    retenter indéfiniment, sans qu'on le renvoie vers sa liste.
 *
 * 2. `inFlight` interdit deux appels simultanés et n'est relâché que dans le
 *    `finally`. Une requête qui ne se résout JAMAIS — connexion ouverte puis
 *    silencieuse, cas courant quand un mobile bascule de réseau — laissait donc
 *    `inFlight` à vrai pour toujours : plus aucun appel, plus aucune
 *    replanification. La boucle mourait en silence.
 *
 * Ces tests portent sur les BRIQUES : le client d'API et le garde-fou de délai.
 * Le dépôt n'a pas d'outillage de rendu React (environnement `node`, pas de
 * testing-library), donc le hook lui-même n'est pas monté ici — c'est dit, et
 * c'est la limite de ce fichier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('une erreur d’API porte son STATUT, pas seulement un texte', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('un 404 est reconnaissable sans lire le message', async () => {
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ error: 'Intervention non accessible.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ))
    const { mechFetch } = await import('@/lib/mechanic-client')

    const erreur = await mechFetch('/api/mechanic/jobs/x').then(() => null, (e) => e)
    expect(erreur).toBeInstanceOf(Error)
    // C'est CE champ qui manquait : le libellé « Intervention non accessible. »
    // ne contient ni « introuvable », ni « not found », ni « 404 ».
    expect((erreur as { status?: number }).status).toBe(404)
    expect(String((erreur as Error).message)).not.toMatch(/introuvable|not found|404/i)
  })

  it('le message reste celui du serveur — on ne le reformule pas', async () => {
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ error: 'Atelier complet le 2026-09-01.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ))
    const { mechFetch } = await import('@/lib/mechanic-client')
    const erreur = await mechFetch('/api/x').then(() => null, (e) => e)
    expect((erreur as Error).message).toBe('Atelier complet le 2026-09-01.')
    expect((erreur as { status?: number }).status).toBe(409)
  })
})

describe('une requête qui ne répond jamais ne doit pas tuer la boucle', () => {
  it('une promesse SANS ISSUE est rejetée au bout du délai', async () => {
    const { avecDelaiBorne } = await import('@/lib/use-mechanic-live')
    // Le cas réel : connexion ouverte puis silencieuse. Sans borne, l'attente
    // est éternelle et `inFlight` ne redescend jamais.
    const jamais = new Promise<string>(() => { /* volontairement sans issue */ })
    await expect(avecDelaiBorne(jamais, 20)).rejects.toThrow(/délai dépassé/i)
  })

  it('une réponse ARRIVÉE à temps traverse intacte', async () => {
    const { avecDelaiBorne } = await import('@/lib/use-mechanic-live')
    await expect(avecDelaiBorne(Promise.resolve('planning'), 1_000)).resolves.toBe('planning')
  })

  it('une erreur RÉELLE n’est pas transformée en délai dépassé', async () => {
    const { avecDelaiBorne } = await import('@/lib/use-mechanic-live')
    const vraie = Promise.reject(new Error('Intervention non accessible.'))
    await expect(avecDelaiBorne(vraie, 1_000)).rejects.toThrow('Intervention non accessible.')
  })

  it('le délai par défaut est borné et raisonnable', async () => {
    const { DELAI_REQUETE_MS } = await import('@/lib/use-mechanic-live')
    expect(DELAI_REQUETE_MS).toBeGreaterThan(1_000)
    expect(DELAI_REQUETE_MS, 'plus long qu’une minute, le mécanicien croit l’application morte')
      .toBeLessThanOrEqual(60_000)
  })

  it('l’appel réseau de la boucle est bien enveloppé par le garde-fou', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../use-mechanic-live.ts'), 'utf8')
    // Sans cette enveloppe, `inFlight` restait à vrai pour toujours et la boucle
    // ne se replanifiait plus jamais.
    expect(src).toContain('await avecDelaiBorne(mechFetch<T>(url))')
    // Et la décision de « ressource disparue » se prend sur le STATUT.
    expect(src).toContain('statut === 404')
  })
})
