/**
 * Horaires d'ouverture de l'atelier — source de vérité UNIQUE (GF-021).
 *
 * ─── Deux défauts traités ensemble ──────────────────────────────────────────
 * 1. Les bornes n'existaient qu'en HEURES PLEINES (`workshopStartHour`,
 *    `workshopEndHour`, entiers) : un atelier ouvrant à 8 h 30 ou fermant à
 *    18 h 30 ne pouvait pas le déclarer.
 * 2. Le planning ne les LISAIT PAS. `ScheduleBoard` calculait sa grille à partir
 *    des constantes `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR` (8 et 18),
 *    évaluées au chargement du module. Un garage ouvrant à 7 h enregistrait bien
 *    son horaire — et voyait une grille figée de 8 h à 18 h.
 *
 * Tout ce qui concerne les bornes passe désormais par ce module : une seule
 * conversion, un seul jeu de garde-fous.
 */

/** Granularité EXIGÉE de la saisie : la demi-heure. */
export const PAS_MINUTES = 30

/** Bornes de repli, identiques aux constantes historiques (8 h → 18 h). */
export const DEBUT_PAR_DEFAUT = 8 * 60
export const FIN_PAR_DEFAUT = 18 * 60

/** Durée minimale d'une journée d'ouverture — une grille vide n'a aucun sens. */
const AMPLITUDE_MINIMALE = 60

export interface HorairesGarage {
  workshopStartHour?: number | string | null
  workshopEndHour?: number | string | null
  workshopStartMinute?: number | string | null
  workshopEndMinute?: number | string | null
}

/** `08:30` → 510. Rend `null` si le libellé n'est pas un créneau valide. */
export function creneauEnMinutes(creneau: string | null | undefined): number | null {
  const m = String(creneau ?? '').match(/^(\d{1,2}):([0-5]\d)$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || (h === 24 && min > 0)) return null
  if (min % PAS_MINUTES !== 0) return null
  return h * 60 + min
}

/** 510 → `08:30`. */
export function minutesEnCreneau(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Tous les créneaux de la journée, au pas de 30 minutes : `00:00` … `23:30`.
 * La liste est COMPLÈTE à dessein : un atelier de nuit, un dépannage 24 h/24 ou
 * une ouverture le dimanche matin doivent pouvoir se déclarer.
 */
export const CRENEAUX_30MIN: string[] = Array.from(
  { length: (24 * 60) / PAS_MINUTES },
  (_, i) => minutesEnCreneau(i * PAS_MINUTES),
)

/** Créneaux valides pour une FERMETURE — `24:00` inclus (minuit). */
export const CRENEAUX_FERMETURE: string[] = [...CRENEAUX_30MIN.slice(1), '24:00']

function entier(v: unknown, defaut: number): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : Number(v)
  return Number.isFinite(n) ? n : defaut
}

/**
 * Bornes EFFECTIVES de l'atelier, en minutes depuis minuit.
 *
 * Toute valeur absente, hors bornes ou incohérente retombe sur le repli : la
 * grille du planning ne doit jamais devenir vide ou inversée à cause d'un
 * enregistrement douteux.
 */
export function bornesAtelier(garage: HorairesGarage | null | undefined): { debut: number; fin: number } {
  const hDebut = entier(garage?.workshopStartHour, 8)
  const hFin = entier(garage?.workshopEndHour, 18)
  const mDebut = entier(garage?.workshopStartMinute, 0)
  const mFin = entier(garage?.workshopEndMinute, 0)

  let debut = hDebut * 60 + mDebut
  let fin = hFin * 60 + mFin

  if (!Number.isFinite(debut) || debut < 0 || debut >= 24 * 60) debut = DEBUT_PAR_DEFAUT
  if (!Number.isFinite(fin) || fin <= 0 || fin > 24 * 60) fin = FIN_PAR_DEFAUT
  if (fin - debut < AMPLITUDE_MINIMALE) return { debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT }
  return { debut, fin }
}

/** Décompose des minutes en (heure, minute) pour l'enregistrement. */
export function enHeureEtMinute(minutes: number): { heure: number; minute: number } {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  return { heure: Math.floor(m / 60), minute: m % 60 }
}
