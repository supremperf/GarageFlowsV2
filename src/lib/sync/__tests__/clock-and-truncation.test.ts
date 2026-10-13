/**
 * GF31-AUD-016 et GF31-AUD-017 — arbitrage de conflit et complétude de la
 * fenêtre de synchronisation.
 *
 * ─── GF31-AUD-016 : deux horloges comparées entre elles ─────────────────────
 * `resolveMirrorWrite` tranchait entre le poste et le cloud en comparant
 * `incoming.updatedAt` — produit par l'horloge du POSTE — à `mirrorUpdatedAt`,
 * produit par celle du SERVEUR (`@updatedAt` Prisma). Un poste dont l'horloge
 * avance de quelques minutes (dérive NTP, réglage manuel) gagnait donc
 * SYSTÉMATIQUEMENT l'arbitrage : le statut et le chronomètre saisis par le
 * mécanicien étaient écrasés en silence à chaque synchronisation. Un poste en
 * retard subissait l'inverse.
 *
 * ─── GF31-AUD-017 : une fenêtre tronquée prise pour la vérité ───────────────
 * Le poste n'envoie que `SYNC_MAX_JOBS` interventions (`take`), tandis que le
 * cloud SUPPRIME toute intervention de la fenêtre qu'il n'a pas reçue. Au-delà
 * du plafond, le surplus était donc détruit à chaque remontée — et jamais
 * recréé, `orderBy: date asc` renvoyant toujours la même tranche.
 */
import { describe, it, expect } from 'vitest'
import { resolveMirrorWrite, clockOffsetMs, MAX_CLOCK_OFFSET_MS, type SyncJob } from '@/lib/sync/job-fields'
import { parseReturnCursors } from '@/lib/sync/return-path'

const CLOUD = new Date('2026-08-12T10:00:00.000Z')

/** Intervention du poste, horodatée à `iso`. */
function job(iso: string): SyncJob {
  return {
    id: 'j1', customerName: 'C', vehicleModel: 'V', licensePlate: null,
    repairType: 'other', estimatedDuration: 60, actualDuration: null,
    startTime: '08:00', date: '2026-08-12', status: 'scheduled', notes: null,
    isUrgent: false, delayMinutes: null, timerStartedAt: null,
    timerAccumulatedSec: 0, mechanicId: 'm1', updatedAt: iso,
  }
}

/** L'exécution du mécanicien est-elle préservée ? */
const executionPreservee = (j: SyncJob, offset = 0) =>
  resolveMirrorWrite(j, CLOUD, offset).executionKept

describe('GF31-AUD-016 — neutralisation du décalage d’horloge', () => {
  it('sans compensation, un poste EN AVANCE écrase le travail du mécanicien', () => {
    // Le poste a modifié à 09h50 dans SA référence, mais son horloge avance de
    // 10 minutes : le cloud, lui, a enregistré le mécanicien à 10h00.
    const posteEnAvance = job('2026-08-12T10:00:00.000Z')
    expect(executionPreservee(posteEnAvance, 0)).toBe(false) // comportement d'origine
  })

  it('avec compensation, l’exécution du mécanicien est PRÉSERVÉE', () => {
    // offset = serverNow - clientNow = −10 min (le poste avance de 10 min).
    const offset = -10 * 60 * 1000
    expect(executionPreservee(job('2026-08-12T10:00:00.000Z'), offset)).toBe(true)
  })

  it('un poste EN RETARD ne perd plus son planning à cause de son horloge', () => {
    // Le poste a réellement modifié APRÈS le mécanicien, mais son horloge
    // retarde de 10 min : brut, il perdait l'arbitrage.
    const posteEnRetard = job('2026-08-12T09:55:00.000Z')
    expect(executionPreservee(posteEnRetard, 0)).toBe(true)            // avant
    expect(executionPreservee(posteEnRetard, 10 * 60 * 1000)).toBe(false) // après
  })

  it('à égalité stricte, le poste reste la source de vérité du dossier', () => {
    expect(executionPreservee(job(CLOUD.toISOString()), 0)).toBe(false)
  })

  it('une création (aucun miroir) applique tout depuis le poste', () => {
    const plan = resolveMirrorWrite(job('2026-08-12T10:00:00.000Z'), null, 999_999)
    expect(plan.executionKept).toBe(false)
  })
})

describe('GF31-AUD-016 — calcul du décalage, borné', () => {
  const serveur = new Date('2026-08-12T10:00:00.000Z')

  it('mesure un décalage plausible', () => {
    expect(clockOffsetMs('2026-08-12T09:55:00.000Z', serveur)).toBe(5 * 60 * 1000)
    expect(clockOffsetMs('2026-08-12T10:05:00.000Z', serveur)).toBe(-5 * 60 * 1000)
  })

  it('ignore un client qui n’annonce pas son horloge (compatibilité ascendante)', () => {
    expect(clockOffsetMs(undefined, serveur)).toBe(0)
    expect(clockOffsetMs(null, serveur)).toBe(0)
    expect(clockOffsetMs('', serveur)).toBe(0)
    expect(clockOffsetMs('pas-une-date', serveur)).toBe(0)
    expect(clockOffsetMs(1_760_000_000_000, serveur)).toBe(0)
  })

  it('REFUSE de compenser un écart aberrant — une horloge faussée ne doit pas décider', () => {
    const tresLoin = new Date(serveur.getTime() - MAX_CLOCK_OFFSET_MS - 60_000).toISOString()
    expect(clockOffsetMs(tresLoin, serveur)).toBe(0)
  })

  it('compense encore juste en dessous de la borne', () => {
    const limite = new Date(serveur.getTime() - MAX_CLOCK_OFFSET_MS + 1_000).toISOString()
    expect(clockOffsetMs(limite, serveur)).toBeGreaterThan(0)
  })
})

describe('GF31-AUD-017 / GF-030 — un curseur de retour PAR FLUX', () => {
  // L'assertion précédente lisait le texte source (`Math.min(...stamps.map`)
  // pour vérifier que le curseur commun suivait le flux le plus en retard. Ce
  // réglage a été remplacé : un curseur commun n'a pas de bon choix (le plus
  // récent saute des éléments, le plus ancien bloque tout, voir
  // `src/lib/sync/return-path.ts`). Le comportement se vérifie désormais sur
  // les données, plus sur la forme du code.
  it('chaque flux avance indépendamment', () => {
    const c = parseReturnCursors({
      sinceNotes: '2026-08-13T00:00:00.000Z',
      sincePhotos: '2026-05-16T00:00:00.000Z',
    })
    expect(c.notes?.toISOString()).toBe('2026-08-13T00:00:00.000Z')
    expect(c.photos?.toISOString()).toBe('2026-05-16T00:00:00.000Z')
  })

  it('un poste ANTÉRIEUR, qui n’envoie que `since`, garde son comportement', () => {
    const c = parseReturnCursors({ since: '2026-05-16T00:00:00.000Z' })
    expect(c.notes?.toISOString()).toBe('2026-05-16T00:00:00.000Z')
    expect(c.photos?.toISOString()).toBe('2026-05-16T00:00:00.000Z')
  })

  it('le poste annonce la troncature et son horloge', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../job-sync.ts'), 'utf8')
    expect(src).toContain('truncated: rows.length >= SYNC_MAX_JOBS')
    expect(src).toContain('clientNow:')
  })

  it('le cloud ne purge PAS une fenêtre annoncée tronquée', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../../../app/api/sync/jobs/route.ts'), 'utf8')
    expect(src).toContain('const truncated = body.truncated === true')
    // La garde s'est ENRICHIE le 16/08/2026 d'une seconde condition (passe en
    // lecture seule) : on exige toujours `!truncated`, sans figer les voisines.
    // Une comparaison textuelle exacte aurait interdit d'ajouter une protection.
    expect(src).toMatch(/if \([^)]*!truncated[^)]*&& staleIds\.length > 0\)/)
  })

  it('le cloud ne purge PAS non plus sur une passe en LECTURE SEULE', async () => {
    // Une charge utile vide l'est parce qu'elle est vide, pas parce que les
    // interventions ont disparu : conclure à une suppression effacerait le
    // planning entier du garage au premier battement sans changement.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../../../app/api/sync/jobs/route.ts'), 'utf8')
    expect(src).toMatch(/if \([^)]*!lectureSeule[^)]*&& staleIds\.length > 0\)/)
    // …et la voie de retour reste bornée à la fenêtre du MIROIR, sans quoi la
    // passe ne rapatrierait rien — c'est-à-dire ce qu'elle existe pour faire.
    expect(src).toContain('lectureSeule ? existing.map((j) => j.id) : jobs.map((j) => j.id)')
  })
})
