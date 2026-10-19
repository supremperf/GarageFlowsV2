/**
 * GF-FINAL-019, volet DNS.
 *
 * Filtrer les adresses LITTÉRALES ne suffit pas : la configuration porte
 * normalement un NOM. `https://plateforme.exemple.test` passe tous les contrôles
 * syntaxiques — protocole HTTPS, nom non réservé — et peut néanmoins avoir un
 * enregistrement A valant `127.0.0.1` ou `169.254.169.254`. C'est le vecteur
 * réellement utilisé : il ne demande qu'un nom de domaine et coûte moins qu'un
 * déguisement d'adresse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dns = vi.hoisted(() => ({ reponse: [] as { address: string }[], echoue: false }))

vi.mock('node:dns/promises', () => ({
  lookup: async () => {
    if (dns.echoue) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    return dns.reponse
  },
}))

import { verifierDestination } from '@/lib/einvoicing/ssrf-guard'

const URL_PLAUSIBLE = 'https://plateforme.exemple.test/api/v1/invoices'

beforeEach(() => {
  dns.reponse = [{ address: '93.184.216.34' }]
  dns.echoue = false
})

describe('résolution DNS de la destination', () => {
  it('accepte un nom qui résout vers une adresse publique', async () => {
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toEqual({ ok: true })
  })

  it('refuse un nom qui résout vers la boucle locale', async () => {
    dns.reponse = [{ address: '127.0.0.1' }]
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })

  it('refuse un nom qui résout vers le service de métadonnées de l\'hébergeur', async () => {
    dns.reponse = [{ address: '169.254.169.254' }]
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })

  it('refuse dès qu\'UNE SEULE des adresses est interne', async () => {
    // Un enregistrement multiple ne doit pas permettre de tirer au sort la
    // destination : le résolveur peut rendre l'une ou l'autre à chaque appel.
    dns.reponse = [{ address: '93.184.216.34' }, { address: '10.0.0.7' }]
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })

  it('refuse une adresse IPv6 interne rendue par le DNS', async () => {
    dns.reponse = [{ address: 'fd00::1' }]
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })

  it('un nom introuvable ne BLOQUE pas par défaut', async () => {
    // On refuse sur la preuve d'une mauvaise destination, pas sur l'absence de
    // preuve : la connexion échouera d'elle-même, avec le même résolveur. Le
    // dire « destination refusée » enverrait l'exploitant chercher un problème
    // de configuration qui n'existe pas.
    dns.echoue = true
    await expect(verifierDestination(URL_PLAUSIBLE)).resolves.toEqual({ ok: true })
  })

  it('…mais le bloque à la VALIDATION de configuration, où c\'est utile', async () => {
    dns.echoue = true
    await expect(verifierDestination(URL_PLAUSIBLE, { bloquerSiNonResolu: true })).resolves.toMatchObject({
      ok: false, motif: 'resolution_impossible',
    })
  })

  it('les contrôles syntaxiques passent AVANT toute résolution', async () => {
    // Une URL en HTTP ne doit pas déclencher de requête DNS : la décision est
    // déjà prise.
    dns.reponse = [{ address: '93.184.216.34' }]
    await expect(verifierDestination('http://plateforme.exemple.test')).resolves.toMatchObject({
      ok: false, motif: 'protocole_non_https',
    })
  })

  it('une adresse littérale n\'est pas re-résolue', async () => {
    // Le littéral a déjà été jugé ; le DNS n'a rien à en dire.
    dns.echoue = true
    await expect(verifierDestination('https://8.8.8.8/api')).resolves.toEqual({ ok: true })
    await expect(verifierDestination('https://127.0.0.1/api')).resolves.toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })
})
