/**
 * Synchronisation POSTE ⇄ CLOUD des INTERVENTIONS.
 *
 * Appelée après chaque écriture sur une intervention (création, modification,
 * réaffectation, suppression). Best-effort et bornée : l'action du garage ne
 * dépend JAMAIS du réseau — elle est déjà committée localement quand la
 * remontée part.
 *
 * Deux directions dans un seul aller-retour :
 *   POSTE → CLOUD  la fenêtre de planning courante (le mécanicien voit sa tâche) ;
 *   CLOUD → POSTE  ce que le mécanicien a produit (statut, chrono, commentaires,
 *                  photos) depuis le dernier échange.
 *
 * Ne lève jamais. Ne bloque jamais l'appelant.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'
import { shortId } from '@/lib/sync/garage-auth'
import { pullQuoteSignatures } from '@/lib/sync/quote-return'
import { pushGarageInvoices } from '@/lib/sync/invoice-sync'
import { pullGarageAppointments } from '@/lib/sync/appointment-sync'
import { pullGarageTickets } from '@/lib/sync/ticket-sync'
import {
  syncWindow, SYNC_MAX_JOBS, SYNC_MAX_TOMBSTONES, shouldApplyCloudExecution, clockOffsetMs,
  type SyncJob,
} from '@/lib/sync/job-fields'

export interface JobSyncResult {
  synced: boolean
  code?: string
  pushed?: number
  deleted?: number
  appliedBack?: number
  skipped?: boolean
  /** Le cloud a annoncé un reste, et ce passage a fait avancer les curseurs. */
  resteAPuiser?: boolean
}

/** Photos rapatriées au maximum par passage — la suite au tour suivant. */
const MAX_PHOTO_PULLS_PER_RUN = 10

/**
 * Marge de recouvrement du curseur : on redemande une petite fenêtre déjà vue
 * plutôt que de risquer de manquer un élément écrit pendant l'aller-retour
 * précédent. Les créations étant adressées par identifiant, revoir un élément
 * ne le duplique pas.
 */
const CURSOR_OVERLAP_MS = 60_000

// `garageLicenseToken` vit désormais dans cloud-client.ts : la publication de
// devis en a besoin elle aussi, et « quelle licence prouve ce garage » ne doit
// avoir qu'UNE définition.

/** Recul du curseur d'un flux, ou `null` si ce flux n'a encore rien reçu. */
function recule(d: Date | null | undefined): Date | null {
  return d instanceof Date ? new Date(d.getTime() - CURSOR_OVERLAP_MS) : null
}

/**
 * Heure du SERVEUR au dernier passage réussi, telle qu'il l'a datée
 * (`syncedAt`). Volontairement en mémoire : au redémarrage du poste, le curseur
 * repart à zéro et un passage complet remet tout à plat — c'est correct, et ça
 * évite une colonne de plus à réparer après une restauration de sauvegarde.
 */
const dernierSyncedAt = new Map<string, string>()

/**
 * Empreinte de la FENÊTRE telle qu'elle a été poussée avec succès la dernière
 * fois : nombre d'interventions et plus récente modification.
 *
 * Sans elle, chaque battement de 10 s renvoyait la fenêtre ENTIÈRE (jusqu'à 500
 * interventions), que quelque chose ait changé ou non. Le cloud réécrivait
 * alors chaque ligne — `resolveMirrorWrite` rend toujours au moins les champs
 * de planification —, ce qui remettait leur `updatedAt` à l'heure du serveur,
 * faisait redescendre la fenêtre entière par la voie de retour, et bougeait à
 * son tour l'empreinte du battement. Le garage rechargeait donc son planning en
 * permanence, atelier vide compris, et le seul détecteur de changement du
 * produit ne détectait plus rien.
 *
 * En mémoire, donc remise à zéro au redémarrage : le premier passage repousse
 * la fenêtre complète. C'est voulu — après un redémarrage, on ne sait pas ce que
 * le cloud a reçu.
 */
const derniereFenetrePoussee = new Map<string, { compte: number; maxUpdatedAt: number }>()

/**
 * Curseurs de la voie de retour — UN PAR FLUX.
 *
 * Commentaires et photos se déduisent des données locales : aucun stockage
 * supplémentaire, donc rien à réparer si la base est restaurée depuis une
 * sauvegarde.
 *
 * Un curseur COMMUN aux deux n'a pas de bon réglage. Le plus récent avance au
 * rythme du flux le plus bavard et saute définitivement les éléments de l'autre
 * (GF31-AUD-017). Le plus ancien — le réglage précédent — se fixe sur le flux le
 * plus en retard : un garage dont la dernière photo date de trois mois
 * redemandait à chaque passage tout ce qui s'était écrit depuis, et le serveur
 * n'en renvoyait que les 200 plus ANCIENS. Passé ce volume, la réponse ne
 * contenait plus que du déjà-appliqué : les nouveaux commentaires du mécanicien
 * ne redescendaient JAMAIS.
 *
 * Séparer les curseurs supprime le choix : chaque flux avance seul, sans
 * bloquer ni se faire dépasser.
 */
async function returnCursors(garageId: string): Promise<{ jobs: Date | null; notes: Date | null; photos: Date | null }> {
  const [note, photo] = await Promise.all([
    prisma.jobMechanicNote.findFirst({
      where: { garageId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
    prisma.jobPhoto.findFirst({
      where: { garageId, mechanicId: { not: null } },
      select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
  ])
  // Le flux « exécution » ne peut PAS se déduire des données locales :
  // `Job.updatedAt` bouge à chaque écriture du poste, y compris celles qui n'ont
  // rien à voir avec le mécanicien — s'en servir masquerait son travail dès que
  // le garage touche la fiche. Le repère est donc l'heure que le SERVEUR a
  // lui-même donnée à son dernier passage : deux horodatages de la même horloge,
  // comparés entre eux. Tant qu'il n'y en a pas (premier passage, redémarrage du
  // poste), on demande la fenêtre entière.
  const dernier = dernierSyncedAt.get(garageId)
  const jobs = dernier ? recule(new Date(dernier)) : null
  return {
    jobs: jobs && !Number.isNaN(jobs.getTime()) ? jobs : null,
    notes: recule(note?.createdAt),
    photos: recule(photo?.createdAt),
  }
}

/**
 * Remonte la fenêtre de planning du garage et applique la voie de retour.
 * `now` est injectable pour les tests.
 */
export async function syncGarageJobs(garageId: string, now: Date = new Date()): Promise<JobSyncResult> {
  if (!isDesktopInstance()) return { synced: true, skipped: true }
  if (!garageId) return { synced: false, code: 'NO_GARAGE' }

  try {
    const token = await garageLicenseToken(garageId)
    if (!token) {
      // ── Le seul échec de remontée qui ne disait RIEN (mesuré le 2026-08-16) ──
      // Les refus du cloud sont journalisés plus bas ; celui-ci, non. Le comptoir
      // affichait « Synchronisation cloud en attente » indéfiniment et le journal
      // ne portait pas une ligne pour l'expliquer — la panne la plus coûteuse à
      // diagnostiquer est celle qui ne laisse aucune trace.
      logger.warn('[sync/jobs:push] aucune licence garage rattachée — remontée impossible', {
        garage: shortId(garageId),
        code: 'NO_GARAGE_LICENSE',
      })
      return { synced: false, code: 'NO_GARAGE_LICENSE' }
    }

    const window = syncWindow(now)
    const rows = await prisma.job.findMany({
      where: { garageId, date: { gte: window.from, lte: window.to } },
      select: {
        id: true, customerName: true, vehicleModel: true, licensePlate: true, repairType: true,
        estimatedDuration: true, actualDuration: true, startTime: true, date: true, status: true,
        notes: true, isUrgent: true, delayMinutes: true, timerStartedAt: true,
        timerAccumulatedSec: true, mechanicId: true, updatedAt: true,
      },
      take: SYNC_MAX_JOBS,
      orderBy: { date: 'asc' },
    })

    const jobs: SyncJob[] = rows.map((j) => ({
      ...j,
      timerStartedAt: j.timerStartedAt ? j.timerStartedAt.toISOString() : null,
      updatedAt: j.updatedAt.toISOString(),
    }))

    // Suppressions EXPLICITES en attente d'accusé de réception. Elles voyagent
    // indépendamment de la fenêtre : c'est tout leur intérêt (GF31-AUD-044).
    const tombstones = await prisma.jobTombstone.findMany({
      where: { garageId },
      select: { jobId: true },
      orderBy: { deletedAt: 'asc' },
      take: SYNC_MAX_TOMBSTONES,
    })
    const deletedIds = tombstones.map((t) => t.jobId)

    // ── Faut-il POUSSER, ou seulement lire ? ────────────────────────────────
    // La fenêtre est décrite par (nombre, plus récente modification). Inchangée
    // depuis la dernière poussée confirmée, et sans suppression en attente, il
    // n'y a rien à annoncer : on demande alors une passe EN LECTURE SEULE, qui
    // rapatrie le travail du mécanicien sans réécrire quoi que ce soit.
    const maxUpdatedAt = rows.reduce((m, j) => Math.max(m, j.updatedAt.getTime()), 0)
    const precedente = derniereFenetrePoussee.get(garageId)
    const lectureSeule = deletedIds.length === 0
      && precedente !== undefined
      && precedente.compte === rows.length
      && precedente.maxUpdatedAt === maxUpdatedAt

    const curseurs = await returnCursors(garageId)
    // Repli pour un serveur antérieur à cette version, qui ne connaît que
    // `since` : on lui donne le plus ancien des curseurs, c'est-à-dire
    // exactement ce qu'il recevait avant. Il ne régresse donc pas ; un serveur à
    // jour ignore ce champ au profit des trois curseurs précis.
    const stamps = [curseurs.notes, curseurs.photos].filter((d): d is Date => d instanceof Date)
    const sinceCompat = stamps.length > 0 ? new Date(Math.min(...stamps.map((d) => d.getTime()))) : null

    const out = await cloudPost('/api/sync/jobs', {
      garageLicense: token,
      garageId,
      window,
      // Une passe en lecture seule n'annonce AUCUNE intervention : le cloud ne
      // doit alors ni écrire, ni conclure à une suppression par absence.
      jobs: lectureSeule ? [] : jobs,
      pullOnly: lectureSeule,
      deletedIds,
      since: sinceCompat ? sinceCompat.toISOString() : null,
      sinceJobs: curseurs.jobs ? curseurs.jobs.toISOString() : null,
      sinceNotes: curseurs.notes ? curseurs.notes.toISOString() : null,
      sincePhotos: curseurs.photos ? curseurs.photos.toISOString() : null,
      // La fenêtre a-t-elle été envoyée COMPLÈTE ? Le cloud supprime les
      // interventions de la fenêtre qu'il n'a pas reçues ; avec plus de
      // SYNC_MAX_JOBS interventions, le surplus était donc détruit à chaque
      // remontée — et jamais recréé, `orderBy: date asc` renvoyant toujours la
      // même tranche. Le mécanicien ne voyait plus rien au-delà (GF31-AUD-017).
      truncated: rows.length >= SYNC_MAX_JOBS,
      // Horloge du POSTE au moment de l'envoi : permet au serveur de neutraliser
      // le décalage entre les deux horloges avant tout arbitrage (GF31-AUD-016).
      clientNow: now.toISOString(),
    })

    if (!out.ok) {
      logger.warn('[sync/jobs:push] non confirmée', {
        garage: shortId(garageId), code: out.code ?? 'UNKNOWN', status: out.status ?? 0,
      })
      return { synced: false, code: out.code ?? 'UNKNOWN', pushed: jobs.length }
    }

    // Le cloud accuse ce qu'il a RÉELLEMENT traité : on n'efface jamais une
    // pierre tombale sur la seule foi d'un envoi. Ce qu'il n'a pas confirmé
    // repartira à la prochaine remontée.
    const acquittees = Array.isArray(out.data?.deletedApplied)
      ? (out.data.deletedApplied as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    if (acquittees.length > 0) {
      await prisma.jobTombstone.deleteMany({ where: { garageId, jobId: { in: acquittees } } })
    }

    // ── Décalage d'horloge, mesuré sur la MÊME réponse ───────────────────────
    // Le serveur date sa réponse (`syncedAt`). L'écart avec l'heure du poste au
    // moment de l'envoi donne le décalage, borné exactement comme à la montée.
    // Sans lui, la descente arbitrait deux horloges différentes l'une contre
    // l'autre — le défaut que `resolveMirrorWrite` corrige déjà dans l'autre
    // sens (GF31-AUD-016).
    const decalageMs = clockOffsetMs(
      typeof out.data?.syncedAt === 'string' ? out.data.syncedAt : null,
      now,
    )

    // Curseur du flux « exécution » : l'heure du SERVEUR au dernier passage
    // réussi, telle qu'il l'a lui-même datée. Le prochain envoi ne redemande
    // donc que les miroirs modifiés depuis — au lieu de la fenêtre entière, à
    // chaque passage, toutes les dix secondes.
    if (typeof out.data?.syncedAt === 'string') {
      dernierSyncedAt.set(garageId, out.data.syncedAt)
    }

    // La fenêtre poussée est désormais celle que le cloud connaît. On ne
    // mémorise QU'APRÈS confirmation — les refus repartent plus haut, avant ce
    // point : un envoi rejeté doit être rejoué, pas oublié.
    //
    // Écrit aussi sur une passe en lecture seule : les valeurs y sont par
    // construction identiques à celles déjà mémorisées, donc sans effet. Une
    // garde `if (!lectureSeule)` aurait été une branche que rien ne peut
    // distinguer — donc rien ne peut éprouver.
    derniereFenetrePoussee.set(garageId, { compte: rows.length, maxUpdatedAt })

    const { applied: appliedBack, resteAPuiser } =
      await applyCloudChanges(garageId, token, out.data?.changes, decalageMs)

    logger.info('[sync/jobs:push] confirmée', {
      garage: shortId(garageId),
      mode: lectureSeule ? 'lecture-seule' : 'poussee',
      pushed: lectureSeule ? 0 : jobs.length,
      applied: Number(out.data?.applied ?? 0),
      deleted: Number(out.data?.deleted ?? 0),
      executionKept: Number(out.data?.executionKept ?? 0),
      appliedBack,
      resteAPuiser,
    })
    return {
      synced: true,
      pushed: jobs.length,
      deleted: Number(out.data?.deleted ?? 0),
      appliedBack,
      // Il reste de l'arriéré ET ce passage a fait avancer les curseurs :
      // l'appelant peut enchaîner immédiatement au lieu d'attendre le prochain
      // déclencheur. Sans progrès, on ne repasse pas — c'est ce qui empêche de
      // boucler sur un élément que le cloud ne saurait pas servir.
      resteAPuiser: resteAPuiser && appliedBack > 0,
    }
  } catch (err) {
    logger.warn('[sync/jobs:push] erreur', { garage: shortId(garageId), message: (err as Error)?.message })
    return { synced: false, code: 'LOCAL_ERROR' }
  }
}

interface CloudChanges {
  jobs?: Array<Record<string, unknown>>
  notes?: Array<Record<string, unknown>>
  photos?: Array<Record<string, unknown>>
  truncated?: { notes?: boolean; photos?: boolean }
}

/**
 * Applique localement ce que le mécanicien a produit. Ne lève jamais.
 *
 * @param decalageMs décalage à ajouter à un horodatage SERVEUR pour l'exprimer
 *   dans l'horloge du poste (`posteNow - serverNow`).
 */
async function applyCloudChanges(
  garageId: string,
  token: string,
  raw: unknown,
  decalageMs = 0,
): Promise<{ applied: number; resteAPuiser: boolean }> {
  const changes = (raw ?? {}) as CloudChanges
  let applied = 0

  // 1. Exécution (statut, chrono) — uniquement si le cloud est plus récent que
  //    la version locale, sinon on écraserait une décision du garage.
  //
  // Les états locaux sont lus en UNE requête. Un `findFirst` par intervention
  // faisait, sur une fenêtre pleine, cinq cents allers-retours SQLite à chaque
  // passage — toutes les dix secondes — pour n'en écrire le plus souvent aucune.
  const recues = (changes.jobs ?? [])
    .map((j) => ({
      brut: j,
      id: typeof j.id === 'string' ? j.id : '',
      cloudAt: typeof j.updatedAt === 'string' ? new Date(j.updatedAt) : null,
    }))
    .filter((e) => e.id && e.cloudAt && !Number.isNaN(e.cloudAt.getTime()))

  const locaux = recues.length === 0 ? [] : await prisma.job.findMany({
    where: { garageId, id: { in: recues.map((e) => e.id) } },
    select: { id: true, updatedAt: true },
  })
  const parId = new Map(locaux.map((l) => [l.id, l.updatedAt]))

  for (const { brut: j, id, cloudAt } of recues) {
    const localAt = parId.get(id)
    if (!localAt) continue
    if (!shouldApplyCloudExecution(localAt, cloudAt as Date, decalageMs)) continue
    await prisma.job.updateMany({
      where: { id, garageId },
      data: {
        status: typeof j.status === 'string' ? j.status : undefined,
        actualDuration: typeof j.actualDuration === 'number' ? j.actualDuration : null,
        delayMinutes: typeof j.delayMinutes === 'number' ? j.delayMinutes : null,
        timerStartedAt: typeof j.timerStartedAt === 'string' ? new Date(j.timerStartedAt) : null,
        timerAccumulatedSec: typeof j.timerAccumulatedSec === 'number' ? j.timerAccumulatedSec : undefined,
      },
    })
    applied += 1
  }

  // 2. Commentaires du mécanicien — créés à l'identique (même identifiant),
  //    donc rejouer la même réponse n'en duplique aucun.
  for (const n of changes.notes ?? []) {
    const id = typeof n.id === 'string' ? n.id : ''
    const jobId = typeof n.jobId === 'string' ? n.jobId : ''
    if (!id || !jobId) continue
    const exists = await prisma.jobMechanicNote.findUnique({ where: { id }, select: { id: true } })
    if (exists) continue
    const job = await prisma.job.findFirst({ where: { id: jobId, garageId }, select: { id: true } })
    if (!job) continue
    const mechanicId = typeof n.mechanicId === 'string' ? n.mechanicId : null
    const mechanic = mechanicId
      ? await prisma.mechanic.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } })
      : null
    await prisma.jobMechanicNote.create({
      data: {
        id,
        jobId,
        garageId,
        mechanicId: mechanic?.id ?? null,
        type: typeof n.type === 'string' ? n.type : 'comment',
        body: typeof n.body === 'string' ? n.body.slice(0, 5000) : '',
        createdAt: typeof n.createdAt === 'string' ? new Date(n.createdAt) : undefined,
      },
    }).catch(() => { /* course entre deux passages : l'identifiant existe déjà */ })
    applied += 1
  }

  // 3. Photos — métadonnées connues, octets récupérés un par un et bornés.
  let pulled = 0
  for (const p of changes.photos ?? []) {
    if (pulled >= MAX_PHOTO_PULLS_PER_RUN) break
    const id = typeof p.id === 'string' ? p.id : ''
    const jobId = typeof p.jobId === 'string' ? p.jobId : ''
    if (!id || !jobId) continue
    const exists = await prisma.jobPhoto.findUnique({ where: { id }, select: { id: true } })
    if (exists) continue
    const job = await prisma.job.findFirst({ where: { id: jobId, garageId }, select: { id: true } })
    if (!job) continue

    const res = await cloudPost('/api/sync/job-photo', { garageLicense: token, garageId, photoId: id }, 20_000)
    const photo = (res.data?.photo ?? null) as Record<string, unknown> | null
    if (!res.ok || !photo || typeof photo.base64 !== 'string' || !photo.base64) continue
    pulled += 1

    const mechanicId = typeof p.mechanicId === 'string' ? p.mechanicId : null
    const mechanic = mechanicId
      ? await prisma.mechanic.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } })
      : null
    await prisma.jobPhoto.create({
      data: {
        id,
        jobId,
        garageId,
        phase: typeof p.phase === 'string' ? p.phase : 'during',
        caption: typeof p.caption === 'string' ? p.caption.slice(0, 500) : null,
        base64: photo.base64,
        photoPath: null,
        mechanicId: mechanic?.id ?? null,
        createdAt: typeof p.createdAt === 'string' ? new Date(p.createdAt) : undefined,
      },
    }).catch(() => { /* déjà rapatriée entre-temps */ })
    applied += 1
  }

  // Reste-t-il de l'arriéré ? Deux sources : le plafond du SERVEUR (il a coupé
  // sa réponse) et celui du POSTE (`MAX_PHOTO_PULLS_PER_RUN`). Dans les deux cas
  // le passage suivant reprendra là où celui-ci s'arrête, les curseurs ayant
  // avancé.
  const resteAPuiser = Boolean(changes.truncated?.notes)
    || Boolean(changes.truncated?.photos)
    || pulled >= MAX_PHOTO_PULLS_PER_RUN

  return { applied, resteAPuiser }
}

/**
 * Déclenchement APRÈS une écriture, sans faire attendre la réponse HTTP.
 *
 * Regroupement : plusieurs écritures rapprochées (glisser-déposer en rafale,
 * réaffectation multiple) ne produisent qu'une remontée. On ne lance jamais
 * deux remontées simultanées pour un même garage — la suivante est simplement
 * marquée « à refaire » et part à la fin de celle en cours.
 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout> | null; running: boolean; again: boolean }>()
/**
 * Regroupement des écritures rapprochées avant une remontée.
 *
 * Il servait aussi d'intervalle entre deux ENCHAÎNEMENTS de rattrapage : une
 * rafale de vingt enchaînements émettait alors une centaine de requêtes en huit
 * secondes — assez pour vider le seau de limitation partagé par tout le poste,
 * et faire refuser au garage une action HUMAINE pendant que l'arriéré s'écoule.
 * Le regroupement reste vif ; les enchaînements, eux, s'espacent.
 */
const DEBOUNCE_MS = 400
/** Intervalle entre deux enchaînements de rattrapage — voir DEBOUNCE_MS. */
const ENCHAINEMENT_MS = 2_000

export function scheduleJobSync(garageId: string | null | undefined): void {
  if (!garageId || !isDesktopInstance()) return
  const state = pending.get(garageId) ?? { timer: null, running: false, again: false }
  pending.set(garageId, state)

  if (state.running) { state.again = true; return }
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => { void runNow(garageId) }, DEBOUNCE_MS)
}

/**
 * Passages d'affilée autorisés pour écouler un arriéré.
 *
 * L'arriéré s'écoule par tranches (200 commentaires, 10 photos) : sans
 * enchaînement, un garage rentrant de congés mettait des heures à rapatrier le
 * travail du mécanicien, à raison d'une tranche par déclenchement. La borne
 * évite qu'un cloud renvoyant éternellement « il en reste » ne fasse tourner le
 * poste sans fin — et l'enchaînement exige de toute façon un PROGRÈS réel.
 */
const MAX_ENCHAINEMENTS = 20

async function runNow(garageId: string, enchainement = 0): Promise<void> {
  const state = pending.get(garageId)
  if (!state) return
  state.timer = null
  state.running = true
  let reste = false
  try {
    const res = await syncGarageJobs(garageId)
    reste = res.resteAPuiser === true

    // Accords clients sur les devis publiés, puis remontée des factures — même
    // cycle, jamais un second. Chacun dans son propre try : un cloud qui refuse
    // l'une de ces voies ne doit pas empêcher les interventions de remonter, ni
    // faire croire à un échec global.
    try {
      const devis = await pullQuoteSignatures(garageId)
      if (devis.resteAPuiser) reste = true
    } catch (e) {
      logger.info('[sync] rapatriement des accords devis ignoré ce passage', {
        motif: e instanceof Error ? e.message.slice(0, 80) : 'inconnu',
      })
    }
    try {
      // Demandes de rendez-vous du portail : sans ce rapatriement, la table
      // reste vide sur un poste et le garage croit qu'aucun client n'en demande.
      await pullGarageAppointments(garageId)
    } catch (e) {
      logger.info('[sync] rapatriement des rendez-vous ignoré ce passage', {
        motif: e instanceof Error ? e.message.slice(0, 80) : 'inconnu',
      })
    }
    try {
      // Messagerie client : même silence sans elle — le panneau « Messages »
      // restait vide et le garage croyait qu'aucun client ne lui écrivait.
      await pullGarageTickets(garageId)
    } catch (e) {
      logger.info('[sync] rapatriement des messages ignoré ce passage', {
        motif: e instanceof Error ? e.message.slice(0, 80) : 'inconnu',
      })
    }
    try {
      const factures = await pushGarageInvoices(garageId)
      if (factures.resteAPuiser) reste = true
    } catch (e) {
      logger.info('[sync] remontée des factures ignorée ce passage', {
        motif: e instanceof Error ? e.message.slice(0, 80) : 'inconnu',
      })
    }
    // `skipped` = instance non-Desktop : il n'y a rien à synchroniser, ce n'est
    // pas une attente.
    if (!res.skipped) dernierResultat.set(garageId, res.synced ? 'ok' : 'attente')
    lastRunAt.set(garageId, Date.now())
  } finally {
    state.running = false
    if (state.again) {
      state.again = false
      scheduleJobSync(garageId)
    } else if (reste && enchainement < MAX_ENCHAINEMENTS) {
      state.timer = setTimeout(() => { void runNow(garageId, enchainement + 1) }, ENCHAINEMENT_MS)
    }
  }
}

const lastRunAt = new Map<string, number>()

/**
 * Issue du dernier passage, par garage — pour que l'écran puisse la DIRE.
 *
 * Une remontée non confirmée était seulement journalisée : l'écran du comptoir
 * ne distinguait pas « le mécanicien a bien reçu l'affectation » de « le cloud
 * ne répond pas depuis dix minutes ». Le rattrapage existe (la fenêtre entière
 * repart au passage suivant), mais tant que l'application tourne sans réseau,
 * personne ne le sait.
 */
const dernierResultat = new Map<string, 'ok' | 'attente'>()

/** État de la dernière remontée : `null` si aucune n'a encore eu lieu. */
export function etatSyncCloud(garageId: string | null | undefined): 'ok' | 'attente' | null {
  if (!garageId) return null
  return dernierResultat.get(garageId) ?? null
}

/**
 * Intervalle minimal entre deux remontées déclenchées par une simple LECTURE.
 * Sans lui, l'écran de planning — qui se rafraîchit régulièrement — lancerait
 * une remontée par requête.
 */
export const BACKGROUND_SYNC_MIN_INTERVAL_MS = 10_000

/**
 * Rattrapage OPPORTUNISTE, accroché à la consultation du planning.
 *
 * C'est ce qui fait remonter au poste ce que le mécanicien a produit (chrono,
 * commentaires, photos) même quand le garage ne modifie rien : sans cela, la
 * voie de retour n'existerait qu'au moment d'une écriture. Fortement limité en
 * cadence, et jamais bloquant.
 */
export function pollJobSync(garageId: string | null | undefined): void {
  if (!garageId || !isDesktopInstance()) return
  const last = lastRunAt.get(garageId) ?? 0
  if (Date.now() - last < BACKGROUND_SYNC_MIN_INTERVAL_MS) return
  lastRunAt.set(garageId, Date.now()) // marqué AVANT : pas de rafale concurrente
  scheduleJobSync(garageId)
}

/** Réinitialise l'état de regroupement — réservé aux tests. */
export function __resetJobSyncScheduler(): void {
  for (const state of Array.from(pending.values())) {
    if (state.timer) clearTimeout(state.timer)
  }
  pending.clear()
  lastRunAt.clear()
  dernierSyncedAt.clear()
  dernierResultat.clear()
}
