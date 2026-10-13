/**
 * VERSIONS — source de vérité unique, partagée poste / API / PWA.
 *
 * ─── Le risque couvert ──────────────────────────────────────────────────────
 * Poste en vX appelant une API en vY pendant que la PWA est encore en vZ : les
 * contrats divergent en silence et la corruption n'apparaît qu'en production.
 * Rien ne permettait à un client de SAVOIR s'il parlait à un serveur compatible :
 * la politique de version existait (lib/license/client-policy) mais n'était
 * consultée qu'au heartbeat de licence, et la PWA n'en connaissait rien.
 *
 * ─── Ce qui est déclaré ici ─────────────────────────────────────────────────
 *  • APP_VERSION      : version du produit — celle de package.json, la seule.
 *  • API_CONTRACT     : version du CONTRAT d'API. À incrémenter dès qu'une
 *                       requête/réponse cesse d'être comprise par l'ancien
 *                       client. Indépendante de la version produit : une
 *                       correction d'affichage ne change pas le contrat.
 *  • SCHEMA_VERSION   : nombre de migrations poste appliquées (même valeur que
 *                       `schemaVersion` renvoyé par /api/internal/migrate).
 *
 * Les minima par plateforme restent pilotés par l'environnement
 * (GF_MIN_ELECTRON_VERSION / GF_MIN_PWA_VERSION) : une politique de
 * compatibilité doit pouvoir changer sans reconstruire les clients.
 */
import { MIGRATIONS } from '@/lib/migrations'
import { minVersionFor, compareVersions } from '@/lib/license/client-policy'

// Injecté au build par next.config.mjs depuis package.json — jamais recopié à
// la main (scripts/check-version.js verrouille la cohérence du dépôt).
export const APP_VERSION: string = process.env.NEXT_PUBLIC_GF_VERSION ?? '0.0.0'

/**
 * Version du contrat d'API.
 *
 * 1 — contrat historique.
 * 2 — ajout de la passerelle de synchronisation des interventions
 *     (/api/sync/jobs, /api/sync/job-photo) : un poste antérieur ne remonte
 *     aucune intervention, donc la PWA mécanicien d'un tel garage reste vide.
 */
export const API_CONTRACT = 2

/** Version de schéma du poste : le nombre de migrations connues. */
export const SCHEMA_VERSION = MIGRATIONS.length

export interface VersionInfo {
  serverVersion: string
  apiVersion: number
  schemaVersion: number
  minimumDesktopVersion: string | null
  minimumPwaVersion: string | null
}

export function versionInfo(): VersionInfo {
  return {
    serverVersion: APP_VERSION,
    apiVersion: API_CONTRACT,
    schemaVersion: SCHEMA_VERSION,
    minimumDesktopVersion: minVersionFor('electron'),
    minimumPwaVersion: minVersionFor('pwa'),
  }
}

export type CompatibilityVerdict =
  /** Le client peut travailler normalement. */
  | { status: 'ok' }
  /** Le client fonctionne mais devrait être mis à jour bientôt. */
  | { status: 'outdated'; minimum: string }
  /** Le client NE DOIT PAS écrire : contrat incompatible. */
  | { status: 'incompatible'; minimum: string }

/**
 * Le client `clientVersion` peut-il parler à ce serveur ?
 *
 * Fonction PURE, testable, sans accès réseau ni base : c'est elle qui décide,
 * pas l'appelant. Une version absente ou mal formée est traitée comme
 * incompatible dès qu'un minimum est exigé — jamais l'inverse (pas de
 * « dans le doute, laisse écrire »).
 */
export function evaluateCompatibility(
  clientVersion: string | null | undefined,
  minimum: string | null,
): CompatibilityVerdict {
  if (!minimum) return { status: 'ok' }
  if (!clientVersion || !/^\d+(\.\d+)*$/.test(clientVersion)) {
    return { status: 'incompatible', minimum }
  }
  return compareVersions(clientVersion, minimum) >= 0
    ? { status: 'ok' }
    : { status: 'incompatible', minimum }
}
