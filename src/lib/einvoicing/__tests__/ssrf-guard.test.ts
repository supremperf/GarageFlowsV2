/**
 * GF-FINAL-019 — SSRF sur l'URL configurable de la plateforme agréée.
 *
 * La seule vérification était `u.protocol === 'https:'`. Or `https://` ne dit
 * rien de la DESTINATION : `https://169.254.169.254/latest/meta-data/` est une
 * URL HTTPS parfaitement valide qui pointe vers le service de métadonnées de
 * l'hébergeur. Sur le déploiement mutualisé, le serveur GarageFlows devenait un
 * relais vers le réseau interne — identifiants de la configuration joints.
 *
 * Second volet : `fetch` suit les redirections par défaut. La garantie HTTPS ne
 * portait donc que sur le PREMIER saut.
 */
import { describe, it, expect } from 'vitest'
import {
  estNomReserve,
  estIpv4NonRoutable,
  estIpv6NonRoutable,
  estAdresseNonRoutable,
  verifierDestinationSync,
} from '@/lib/einvoicing/ssrf-guard'

describe('adresses IPv4 non routables', () => {
  it('refuse les plages internes et spéciales', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3',            // boucle locale
      '10.0.0.5', '10.255.255.255',        // RFC 1918
      '172.16.0.1', '172.31.255.254',      // RFC 1918
      '192.168.1.1',                       // RFC 1918
      '169.254.169.254',                   // métadonnées cloud — la cible classique
      '0.0.0.0',                           // « cet hôte »
      '100.64.0.1',                        // CGNAT
      '198.18.0.1',                        // banc d'essai
      '224.0.0.1', '239.1.1.1',            // multicast
      '255.255.255.255',                   // diffusion
    ]) {
      expect(estIpv4NonRoutable(ip), ip).toBe(true)
    }
  })

  it('laisse passer les adresses publiques', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '51.15.20.30', '172.15.0.1', '172.32.0.1', '192.167.1.1', '99.99.99.99']) {
      expect(estIpv4NonRoutable(ip), ip).toBe(false)
    }
  })

  it('refuse les écritures non canoniques plutôt que de les interpréter', () => {
    // « 010.0.0.1 » (octal) et « 0x7f.0.0.1 » (hexadécimal) sont des moyens
    // classiques de déguiser une adresse locale. On ne cherche pas à les
    // décoder : on ne les reconnaît pas comme IPv4, donc elles seront traitées
    // comme des noms d'hôte — et devront passer par la résolution DNS.
    expect(octetsNonCanoniquesRefuses()).toBe(true)
  })
})

/** Aucune forme non canonique ne doit être acceptée comme IPv4 routable. */
function octetsNonCanoniquesRefuses(): boolean {
  return ['010.0.0.1', '0x7f.0.0.1', '127.00.0.1', '1.2.3', '1.2.3.4.5', '256.1.1.1']
    .every((v) => estIpv4NonRoutable(v) === false)
}

describe('adresses IPv6 non routables', () => {
  it('refuse boucle locale, uniques-locales, lien-local et multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '[::1]', 'fe80::1%eth0']) {
      expect(estIpv6NonRoutable(ip), ip).toBe(true)
    }
  })

  it('refuse les adresses IPv4 déguisées en IPv6', () => {
    // Le contournement le plus simple d'un filtre purement IPv4.
    for (const ip of ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '64:ff9b::127.0.0.1']) {
      expect(estIpv6NonRoutable(ip), ip).toBe(true)
    }
  })

  it('laisse passer une adresse IPv6 publique', () => {
    expect(estIpv6NonRoutable('2001:4860:4860::8888')).toBe(false)
    expect(estAdresseNonRoutable('2606:4700:4700::1111')).toBe(false)
  })
})

describe('noms d\'hôtes réservés', () => {
  it('refuse localhost et les suffixes internes', () => {
    for (const h of [
      'localhost', 'LOCALHOST', 'localhost.', 'ip6-localhost',
      'api.localhost', 'serveur.local', 'plateforme.internal',
      'truc.intranet', 'machine.home.arpa', 'nas.lan', '',
    ]) {
      expect(estNomReserve(h), h).toBe(true)
    }
  })

  it('laisse passer un nom public', () => {
    for (const h of ['api.plateforme-agreee.fr', 'portail.chorus-pro.gouv.fr', 'example.com']) {
      expect(estNomReserve(h), h).toBe(false)
    }
  })
})

describe('verifierDestinationSync — porte d\'entrée de la configuration', () => {
  it('refuse tout ce qui n\'est pas HTTPS', () => {
    for (const u of ['http://api.exemple.fr', 'ftp://api.exemple.fr', 'file:///etc/passwd', 'gopher://x']) {
      expect(verifierDestinationSync(u), u).toMatchObject({ ok: false, motif: 'protocole_non_https' })
    }
  })

  it('refuse une URL malformée ou vide', () => {
    for (const u of ['', '   ', 'pas-une-url', null, undefined, 42, {}]) {
      expect(verifierDestinationSync(u)).toMatchObject({ ok: false, motif: 'url_invalide' })
    }
  })

  it('refuse les adresses internes MALGRÉ le HTTPS — le cœur du défaut', () => {
    for (const u of [
      'https://127.0.0.1/api',
      'https://127.0.0.1:8443/api',
      'https://10.0.0.5/submit',
      'https://192.168.1.10/submit',
      'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://[::1]/api',
      'https://[fd00::1]/api',
    ]) {
      const v = verifierDestinationSync(u)
      expect(v.ok, u).toBe(false)
      expect(v.motif, u).toBe('adresse_non_routable')
    }
  })

  it('refuse les noms réservés MALGRÉ le HTTPS', () => {
    for (const u of ['https://localhost/api', 'https://api.local/x', 'https://truc.internal/x']) {
      expect(verifierDestinationSync(u), u).toMatchObject({ ok: false, motif: 'nom_reserve' })
    }
  })

  it('accepte une plateforme publique légitime', () => {
    for (const u of [
      'https://api.plateforme-agreee.fr',
      'https://api.plateforme-agreee.fr/v1/invoices',
      'https://8.8.8.8/api',
    ]) {
      expect(verifierDestinationSync(u), u).toEqual({ ok: true })
    }
  })

  it('l\'identifiant utilisateur d\'une URL ne déguise pas la destination', () => {
    // `https://api.plateforme-agreee.fr@127.0.0.1/` a pour hôte 127.0.0.1.
    // Un contrôle par préfixe de chaîne se serait laissé prendre ; `URL.hostname`
    // non.
    expect(verifierDestinationSync('https://api.plateforme-agreee.fr@127.0.0.1/')).toMatchObject({
      ok: false, motif: 'adresse_non_routable',
    })
  })

  it('chaque refus porte un message destiné à l\'exploitant', () => {
    for (const u of ['http://x.fr', 'https://127.0.0.1', 'https://localhost', 'pas-une-url']) {
      const v = verifierDestinationSync(u)
      expect(v.ok).toBe(false)
      expect(typeof v.message).toBe('string')
      expect(v.message!.length).toBeGreaterThan(10)
    }
  })
})

describe('les redirections ne peuvent pas contourner la garde', () => {
  it('l\'appel sortant du connecteur refuse de suivre une redirection', async () => {
    // Vérifié sur la SOURCE : `fetch` suit les redirections par défaut, si bien
    // qu'un « 302 Location: http://169.254.169.254/… » emportait en-têtes
    // personnalisés et corps de facture. Le contrôle de destination ne portait
    // que sur le premier saut.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(
      path.resolve(__dirname, '../adapters/generic-pa.ts'),
      'utf8',
    )
    expect(src).toContain("redirect: 'error'")
    // …et la destination est revérifiée à chaque appel, pas seulement à
    // l'enregistrement de la configuration (une zone DNS peut changer entre-temps).
    expect(src).toContain('await verifierDestination(url)')
  })
})
