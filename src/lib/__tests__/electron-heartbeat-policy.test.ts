/**
 * LICENCE — « une licence révoquée ou suspendue finit par se réactiver ».
 *
 * `electron/heartbeat-policy.js` porte l'invariant de sécurité qui interdit ce
 * comportement. Ce module existait, était câblé dans `periodicLicenseCheck()`,
 * documentait le bug qu'il corrige… et n'était couvert par AUCUN test : un
 * `grep -r heartbeatDecision` ne renvoyait que le module lui-même et son appel
 * dans `main.js`. La règle la plus sensible du produit reposait donc sur une
 * relecture.
 *
 * Le scénario d'origine, rejoué ici de bout en bout (`séquence complète`) :
 *   1. l'admin révoque la licence → l'autorité distante répond `allowed:false`
 *      → l'accès est bloqué ;
 *   2. le serveur distant devient injoignable (panne, pare-feu, fichier hosts —
 *      un utilisateur motivé sait provoquer cet état) ;
 *   3. le battement retombe sur le contrôle LOCAL, dont la base SQLite du poste
 *      n'a jamais été informée de la révocation : elle répond « active » ;
 *   4. avant correction, ce « active » levait le blocage et émettait
 *      `license:reactivated`. Couper le réseau suffisait à annuler une
 *      révocation.
 *
 * Règle verrouillée : un blocage n'est levé QUE par un « active » explicite de
 * l'autorité DISTANTE. Un blocage, lui, est honoré quelle que soit l'autorité
 * qui le prononce (fail-secure).
 */
import { describe, it, expect } from 'vitest'

// `require` et non `import` : c'est le fichier CommonJS réellement chargé par le
// processus principal Electron, pas une transposition.
const { heartbeatDecision } = require('../../../electron/heartbeat-policy')

type Decision = { action: 'none' | 'block' | 'unblock' | 'hold'; status?: string; reason?: string }
type Authority = 'remote' | 'local' | null

const decide = (result: unknown, authority: Authority, blocked: boolean): Decision =>
  heartbeatDecision({ result, authority, blocked })

const ACTIVE = { allowed: true, status: 'active' }

describe('heartbeat licence — aucune réactivation automatique', () => {
  describe('le refus est honoré quelle que soit l\'autorité (fail-secure)', () => {
    for (const authority of ['remote', 'local'] as const) {
      it(`révocation annoncée par l'autorité « ${authority} » → blocage`, () => {
        const d = decide({ allowed: false, status: 'revoked', reason: 'Licence révoquée.' }, authority, false)
        expect(d.action).toBe('block')
        expect(d.status).toBe('revoked')
      })

      it(`suspension annoncée par l'autorité « ${authority} » → blocage`, () => {
        const d = decide({ allowed: false, status: 'suspended', reason: 'Licence suspendue.' }, authority, false)
        expect(d.action).toBe('block')
        expect(d.status).toBe('suspended')
      })
    }

    it('expiration → blocage, statut conservé tel quel', () => {
      expect(decide({ allowed: false, status: 'expired' }, 'remote', false)).toMatchObject({
        action: 'block',
        status: 'expired',
      })
    })

    it('un refus sans statut retombe sur « unknown » bloquant, sans inventer de révocation', () => {
      const d = decide({ allowed: false }, 'remote', false)
      expect(d.action).toBe('block')
      expect(d.status).toBe('unknown')
      expect(d.reason).toBeTruthy()
    })

    it('un refus contradictoire (allowed:false + status:active) bloque quand même', () => {
      // Un serveur compromis, un intermédiaire, ou simplement une réponse
      // incohérente ne doit pas pouvoir se faire passer pour une réactivation.
      const d = decide({ allowed: false, status: 'active' }, 'remote', true)
      expect(d.action).toBe('block')
    })
  })

  describe('le repli LOCAL ne réactive jamais — cœur du bug', () => {
    it('« active » du repli local pendant un blocage → maintien du blocage', () => {
      expect(decide(ACTIVE, 'local', true).action).toBe('hold')
    })

    it('« active » sans autorité identifiée pendant un blocage → maintien du blocage', () => {
      // Une autorité absente n'est pas l'autorité distante : ne pas confondre
      // « je ne sais pas qui a répondu » avec « l'admin a réactivé ».
      expect(decide(ACTIVE, null, true).action).toBe('hold')
      expect(decide(ACTIVE, undefined as unknown as Authority, true).action).toBe('hold')
    })

    it('répéter le « active » local ne finit PAS par débloquer', () => {
      // Le bug se manifestait dans la durée : un battement toutes les N minutes,
      // indéfiniment. Aucun compteur caché ne doit céder.
      const actions = new Set<string>()
      for (let i = 0; i < 500; i++) actions.add(decide(ACTIVE, 'local', true).action)
      expect(Array.from(actions)).toEqual(['hold'])
    })

    it('un « active » local NON bloqué reste sans effet (disponibilité hors ligne)', () => {
      // Le repli local garde sa raison d'être : faire tourner une licence déjà
      // active quand le réseau est coupé. Il ne doit simplement rien LEVER.
      expect(decide(ACTIVE, 'local', false).action).toBe('none')
    })
  })

  describe('seule l\'autorité distante réactive', () => {
    it('« active » distant pendant un blocage → levée du blocage', () => {
      expect(decide(ACTIVE, 'remote', true).action).toBe('unblock')
    })

    it('« active » distant hors blocage → aucun changement', () => {
      expect(decide(ACTIVE, 'remote', false).action).toBe('none')
    })
  })

  describe('réactivation positive : autorisation et statut HTTP réel', () => {
    for (const httpStatus of [301, 302, 400, 401, 403, 426, 429, 500, 502, 503, 504, null, '200']) {
      it(`HTTP ${httpStatus} ne vaut pas autorisation malgré un corps active`, () => {
        expect(decide({ ...ACTIVE, httpStatus }, 'remote', true).action).toBe('none')
      })
    }
    it('active sans allowed explicite ne réactive pas', () => {
      expect(decide({ status: 'active', httpStatus: 200 }, 'remote', true).action).toBe('none')
    })
    it('HTTP200 distant + accord explicite réactive, mais le repli local reste sans autorité', () => {
      expect(decide({ ...ACTIVE, httpStatus: 200 }, 'remote', true).action).toBe('unblock')
      expect(decide({ ...ACTIVE, httpStatus: 200 }, 'local', true).action).toBe('hold')
    })
    it('la politique de refus explicite et de version minimale est inchangée', () => {
      expect(decide({ allowed: false, status: 'upgrade_required', httpStatus: 426 }, 'remote', false).action).toBe('block')
      expect(decide({ allowed: false, status: 'revoked', httpStatus: 200 }, 'local', false).action).toBe('block')
    })
  })

  describe('les réponses indéterminées ne lèvent rien', () => {
    it('statut « unknown » (base non enregistrée / fail-open) pendant un blocage', () => {
      expect(decide({ allowed: true, status: 'unknown' }, 'remote', true).action).toBe('none')
    })

    it('statut inattendu pendant un blocage', () => {
      expect(decide({ allowed: true, status: 'pending_review' }, 'remote', true).action).toBe('none')
    })

    it('`allowed:true` SANS statut ne vaut pas réactivation', () => {
      // Un `allowed` nu ne prouve pas que l'admin a agi : seul `status:'active'`
      // explicite de l'autorité distante le fait.
      expect(decide({ allowed: true }, 'remote', true).action).toBe('none')
    })

    it('aucune réponse (les deux autorités injoignables) → état courant conservé', () => {
      expect(decide(null, null, true).action).toBe('none')
      expect(decide(undefined, null, true).action).toBe('none')
    })

    it('réponse non-objet (corps HTML d\'un portail captif, chaîne, tableau)', () => {
      // Un portail captif renvoyant du HTML en 200 ne doit pas être interprété.
      expect(decide('<html>login</html>', 'remote', true).action).toBe('none')
      expect(decide(42, 'remote', true).action).toBe('none')
      // Un tableau est un objet en JS : le code doit quand même s'en sortir sans
      // lever, et sans rien débloquer.
      expect(decide([], 'remote', true).action).toBe('none')
    })
  })

  describe('séquence complète — le scénario rapporté', () => {
    it('révocation admin puis serveur distant injoignable : le blocage tient', () => {
      let blocked = false
      const journal: string[] = []

      const battement = (result: unknown, authority: Authority) => {
        const d = decide(result, authority, blocked)
        if (d.action === 'block') blocked = true
        else if (d.action === 'unblock') blocked = false
        journal.push(d.action)
        return d
      }

      // 1. Fonctionnement normal.
      battement(ACTIVE, 'remote')
      expect(blocked).toBe(false)

      // 2. L'admin révoque : l'autorité distante refuse.
      battement({ allowed: false, status: 'revoked', reason: 'Licence révoquée.' }, 'remote')
      expect(blocked).toBe(true)

      // 3. Le serveur distant devient injoignable — 200 battements de repli
      //    local, la base du poste répondant « active » à chaque fois.
      for (let i = 0; i < 200; i++) battement(ACTIVE, 'local')
      expect(blocked).toBe(true)

      // 4. Redémarrages, pertes de réseau totales, réponses illisibles :
      //    toujours rien qui lève le blocage.
      battement(null, null)
      battement('<html>captive portal</html>', 'local')
      battement({ allowed: true, status: 'unknown' }, 'local')
      expect(blocked).toBe(true)

      // 5. Seule la réactivation ADMINISTRATIVE, vue par l'autorité distante,
      //    rend l'accès.
      battement(ACTIVE, 'remote')
      expect(blocked).toBe(false)

      // Aucun 'unblock' n'a pu survenir avant le dernier battement distant.
      expect(journal.filter((a) => a === 'unblock')).toHaveLength(1)
      expect(journal.lastIndexOf('unblock')).toBe(journal.length - 1)
    })

    it('une licence SUSPENDUE ne se relève pas non plus toute seule', () => {
      let blocked = false
      const battement = (result: unknown, authority: Authority) => {
        const d = decide(result, authority, blocked)
        if (d.action === 'block') blocked = true
        else if (d.action === 'unblock') blocked = false
        return d
      }

      battement({ allowed: false, status: 'suspended' }, 'remote')
      expect(blocked).toBe(true)
      for (let i = 0; i < 100; i++) battement(ACTIVE, 'local')
      expect(blocked).toBe(true)
    })
  })

  describe('pureté — la décision ne dépend que de ses arguments', () => {
    it('n\'altère pas le résultat qu\'on lui passe', () => {
      const result = { allowed: false, status: 'revoked', reason: 'Licence révoquée.' }
      const copie = JSON.parse(JSON.stringify(result))
      decide(result, 'remote', false)
      expect(result).toEqual(copie)
    })

    it('deux appels identiques rendent la même décision', () => {
      expect(decide(ACTIVE, 'local', true)).toEqual(decide(ACTIVE, 'local', true))
    })
  })
})
