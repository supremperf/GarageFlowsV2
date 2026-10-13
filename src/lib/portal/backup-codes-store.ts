/**
 * Consommation ATOMIQUE d'un code de secours du portail (GF-DUR-025).
 *
 * ─── Le défaut, reproduit avant d'être corrigé ──────────────────────────────
 * La vérification du second facteur faisait un lire-modifier-écrire :
 *
 *     const hashes = JSON.parse(user.backupCodes)   // ① lecture
 *     hashes.splice(idx, 1)                         // ② retrait en mémoire
 *     await prisma.portalUser.update({ … })         // ③ écriture intégrale
 *
 * Entre ① et ③ il y a deux `await`. Deux requêtes simultanées lisent donc le
 * MÊME état, et « à usage unique » devient faux :
 *
 *   · MÊME code présenté deux fois → les deux lectures le trouvent, les deux
 *     réponses ouvrent une session. Le test le mesurait : 2 sessions au lieu
 *     d'1.
 *   · Codes DIFFÉRENTS présentés ensemble → pire encore. R1 lit [c1…c8] et
 *     écrit [c2…c8] ; R2, qui avait lu [c1…c8], écrit [c1,c3…c8]. La dernière
 *     écriture gagne : **c1, déjà consommé, réapparaît**. Un code de
 *     récupération ressuscité est un identifiant permanent que son porteur
 *     croit périmé.
 *
 * Ce n'est pas une course théorique : deux onglets, un double-clic sur
 * « Valider », ou un client qui rejoue sa requête suffisent.
 *
 * ─── La correction : compare-and-swap, pas de verrou ────────────────────────
 * L'écriture ne dit plus « mets cette valeur » mais « remplace CETTE
 * valeur-là par celle-ci » : la valeur lue devient un prédicat de la mise à
 * jour. Le moteur ne l'applique qu'à la ligne encore dans l'état observé —
 * `count === 1` prouve qu'on a gagné, `count === 0` qu'un autre a écrit
 * entre-temps. Aucun verrou applicatif, donc rien à libérer, et le
 * comportement est identique sur SQLite (poste) et PostgreSQL (serveur).
 *
 * Le perdant ne se voit pas refuser : il relit et recommence. Deux codes
 * DIFFÉRENTS présentés ensemble doivent tous deux être acceptés — c'est un
 * usage légitime. Seul le même code deux fois échoue au second tour, parce que
 * son empreinte n'est plus là : le refus vient alors de la vérification, pas
 * d'une collision.
 *
 * ─── Et si la course ne se résout pas ───────────────────────────────────────
 * Après {@link TENTATIVES_MAX} essais, on REFUSE (`conflit`). Se rabattre sur
 * une écriture inconditionnelle rétablirait exactement le défaut corrigé ici.
 * Un refus se retente d'un clic ; un code ressuscité ne se voit pas.
 */

import { verifyBackupCode } from './backup-codes'

/** Reprises avant de renoncer. Une course réelle se résout au 1er ou 2e tour. */
export const TENTATIVES_MAX = 5

export type ResultatConsommation =
  /** Code reconnu ET retiré — cette requête, et elle seule, l'a consommé. */
  | { ok: true; restants: number }
  /** Aucune empreinte ne correspond (code faux, ou déjà consommé ailleurs). */
  | { ok: false; motif: 'inconnu' }
  /** Écritures concurrentes non départagées : refus délibéré (fail-closed). */
  | { ok: false; motif: 'conflit' }

/** Empreintes stockées, en ignorant tout ce qui n'est pas une chaîne. */
export function lireEmpreintes(brut: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(brut ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
  } catch {
    return []
  }
}

/** Sous-ensemble de Prisma dont on dépend — utilisable avec un double en test. */
export interface DepotCodesSecours {
  portalUser: {
    findUnique(a: { where: { id: string }; select: { backupCodes: true } })
      : Promise<{ backupCodes: string } | null>
    updateMany(a: { where: { id: string; backupCodes: string }; data: { backupCodes: string } })
      : Promise<{ count: number }>
  }
}

/**
 * Retire l'empreinte du code présenté — au plus une fois, quoi qu'il arrive.
 *
 * N'écrit RIEN quand le code est inconnu : une tentative ratée ne doit pas
 * réécrire la colonne (elle donnerait un signal d'écriture observable, et
 * ferait échouer les CAS concurrents légitimes).
 */
export async function consommerCodeSecours(
  db: DepotCodesSecours,
  userId: string,
  code: string,
): Promise<ResultatConsommation> {
  for (let essai = 0; essai < TENTATIVES_MAX; essai++) {
    const u = await db.portalUser.findUnique({ where: { id: userId }, select: { backupCodes: true } })
    if (!u) return { ok: false, motif: 'inconnu' }

    // L'état lu sert de PRÉDICAT : on le garde tel quel, octet pour octet.
    const observe = u.backupCodes
    const empreintes = lireEmpreintes(observe)
    const idx = verifyBackupCode(code, empreintes)
    if (idx < 0) return { ok: false, motif: 'inconnu' }

    const restantes = empreintes.filter((_, i) => i !== idx)
    const prise = await db.portalUser.updateMany({
      where: { id: userId, backupCodes: observe },
      data: { backupCodes: JSON.stringify(restantes) },
    })
    if (prise.count === 1) return { ok: true, restants: restantes.length }
    // count === 0 : quelqu'un a écrit entre la lecture et ici. On relit.
  }
  return { ok: false, motif: 'conflit' }
}
