export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/backup — instantané COHÉRENT de la base du poste.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 * `runBackup()` (electron/main.js) copiait le fichier de base avec
 * `fs.copyFileSync`, toutes les heures, DEPUIS LE PROCESSUS ELECTRON, pendant
 * que le serveur Next écrivait dans cette même base. Aucun verrou, aucune API de
 * sauvegarde : une simple copie d'octets.
 *
 * Le mode de journalisation mesuré sur un poste est `delete` (journal de
 * restauration, pas WAL) : pendant un commit, SQLite écrit les pages modifiées
 * DANS le fichier principal, l'état antérieur vivant dans `garageflow.db-journal`.
 * Copier le fichier principal à cet instant — et lui seul — produit une base
 * déchirée : des pages nouvelles, des pages anciennes, et rien pour rejouer ou
 * annuler. La sauvegarde paraît réussie et n'est pas restaurable. C'est le pire
 * défaut possible pour une sauvegarde : silencieux, et découvert le jour où on
 * en a besoin.
 *
 * ── La correction ───────────────────────────────────────────────────────────
 * `VACUUM INTO` est l'API prévue par SQLite pour exactement cela : elle produit
 * un fichier COMPLET et COHÉRENT depuis une connexion vivante, en prenant les
 * verrous nécessaires — les écritures concurrentes attendent ou sont incluses,
 * jamais coupées en deux. La sauvegarde est donc faite par le processus qui
 * DÉTIENT la connexion (le serveur Next), pas par un observateur extérieur.
 *
 * ── Sécurité ────────────────────────────────────────────────────────────────
 *  · `internalRequestAuthorized` : clé interne forte, comparaison en temps
 *    constant, origine loopback obligatoire (comme les autres routes internes) ;
 *  · la destination est BORNÉE au dossier de sauvegardes du poste et son nom
 *    contraint : un chemin fourni ne doit jamais pouvoir désigner un autre
 *    endroit du disque ;
 *  · refus explicite sur un déploiement PostgreSQL, où `VACUUM INTO` n'a aucun
 *    sens : mieux vaut un refus lisible qu'une erreur SQL opaque.
 */
import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { logger } from '@/lib/logger'

/** Nom de fichier accepté : lettres, chiffres, tiret, souligné, point. */
const NOM_VALIDE = /^[A-Za-z0-9._-]+\.db$/

/**
 * Racine autorisée des sauvegardes.
 *
 * Le serveur ne connaît pas les chemins d'Electron, mais il reçoit
 * `GF_PHOTOS_DIR` (= <données application>/photos) : son parent est le dossier
 * de données du poste. Même dérivation que la route des mises à jour.
 */
function racineSauvegardes(): string | null {
  const photos = process.env.GF_PHOTOS_DIR
  if (!photos) return null
  return path.join(path.dirname(photos), 'backups')
}

export async function POST(req: Request) {
  if (!internalRequestAuthorized(req)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (isPostgresDatabase()) {
    return NextResponse.json(
      { ok: false, code: 'SQLITE_ONLY', error: 'Cette sauvegarde ne concerne que la base locale d’un poste.' },
      { status: 409 },
    )
  }

  let corps: { destination?: unknown }
  try { corps = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const racine = racineSauvegardes()
  if (!racine) {
    return NextResponse.json(
      { ok: false, code: 'BACKUP_DIR_UNKNOWN', error: 'Dossier de sauvegarde indéterminé sur ce poste.' },
      { status: 409 },
    )
  }

  const demande = typeof corps.destination === 'string' ? corps.destination : ''
  if (!demande) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })

  // Anti-traversée : on résout, puis on EXIGE que le résultat reste sous la
  // racine. Un `startsWith` sur la chaîne d'origine se contournerait.
  const cible = path.resolve(demande)
  const relatif = path.relative(path.resolve(racine), cible)
  if (relatif.startsWith('..') || path.isAbsolute(relatif) || relatif.includes('..')) {
    logger.warn('[internal/backup] destination hors du dossier de sauvegarde, refusée')
    return NextResponse.json({ ok: false, code: 'DESTINATION_REFUSEE' }, { status: 400 })
  }
  if (!NOM_VALIDE.test(path.basename(cible))) {
    return NextResponse.json({ ok: false, code: 'NOM_INVALIDE' }, { status: 400 })
  }

  // `VACUUM INTO` REFUSE d'écraser : le fichier ne doit pas exister.
  if (fs.existsSync(cible)) {
    return NextResponse.json({ ok: true, skipped: 'DEJA_PRESENTE', path: cible })
  }
  fs.mkdirSync(path.dirname(cible), { recursive: true })

  try {
    // Le chemin est inliné parce que SQLite n'accepte pas de paramètre lié ici.
    // Il a été validé ci-dessus (sous la racine, nom contraint) ; les apostrophes
    // sont malgré tout doublées — une validation ne dispense pas d'échapper.
    const litteral = cible.replace(/'/g, "''")
    await prisma.$executeRawUnsafe(`VACUUM INTO '${litteral}'`)
  } catch (err) {
    logger.error('[internal/backup] VACUUM INTO en échec', err)
    // Aucun fichier partiel ne doit subsister : il ressemblerait à une
    // sauvegarde valide.
    try { if (fs.existsSync(cible)) fs.rmSync(cible, { force: true }) } catch { /* rien à ajouter */ }
    return NextResponse.json({ ok: false, code: 'VACUUM_FAILED' }, { status: 500 })
  }

  const taille = fs.existsSync(cible) ? fs.statSync(cible).size : 0
  if (taille === 0) {
    try { fs.rmSync(cible, { force: true }) } catch { /* rien à ajouter */ }
    return NextResponse.json({ ok: false, code: 'BACKUP_VIDE' }, { status: 500 })
  }

  logger.info('[internal/backup] instantané cohérent écrit', { octets: taille })
  return NextResponse.json({ ok: true, path: cible, bytes: taille })
}
