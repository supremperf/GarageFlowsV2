/**
 * HWID V1 — empreinte matérielle CANONIQUE (AUD-036).
 *
 * Problème résolu : historiquement, Electron (os.cpus/os.networkInterfaces/
 * os.platform) et le keygen Python (platform.processor/uuid.getnode/
 * platform.system) RECONSTRUISAIENT chacun une empreinte à partir de sources
 * DIFFÉRENTES → deux HWID distincts pour la même machine (une licence liée au
 * matériel pouvait ne jamais valider selon l'outil ayant produit le HWID).
 *
 * Architecture cible : GarageFlows (client Electron) est la SEULE AUTORITÉ qui
 * COLLECTE les champs matériels ; l'algorithme de CANONICALISATION ci-dessous est
 * partagé et STRICTEMENT déterministe. Le keygen et le backend ne reconstruisent
 * plus l'identité du poste : ils REÇOIVENT le HWID V1 produit par le client.
 * `scripts/hwid_v1.py` réimplémente le MÊME algorithme, et
 * `tests/fixtures/hwid-v1-vectors.json` prouve l'identité octet-pour-octet entre
 * Node et Python.
 *
 * Algorithme (v1), à partir d'un jeu de champs déjà collectés :
 *   1. clés canoniques triées : cpu, diskSerial, mac, machineId, platform ;
 *   2. normalisation de chaque valeur : Unicode NFC → espaces compressés → trim →
 *      minuscules (tolérance au bruit de casse/espaces entre OS) ;
 *   3. sérialisation « clé=valeur » jointe par LF, préfixée du tag de séparation
 *      de domaine « GF-HWID-V1\n » (toutes les clés TOUJOURS présentes, vide si
 *      absente → structure fixe) ;
 *   4. SHA-256 (UTF-8) → hex ; sortie « HWID1-<hex> ».
 *
 * Robustesse : l'appelant choisit des champs STABLES (voir HWID_SPEC_V1.md). On
 * ne trie/mélange pas les interfaces réseau ici : le client fournit UNE valeur mac
 * choisie de façon stable. Un champ absent devient vide (l'empreinte reste
 * définie), évitant qu'un VPN/une carte virtuelle ajoutée casse tout.
 */
import crypto from 'crypto'

export const HWID_V1_VERSION = 1
export const HWID_V1_PREFIX = 'HWID1-'

export interface HwidFieldsV1 {
  cpu?: string | null
  mac?: string | null
  platform?: string | null
  machineId?: string | null
  diskSerial?: string | null
}

// Ordre canonique FIXE (trié) — ne jamais réordonner : changerait toutes les empreintes.
export const HWID_V1_CANONICAL_KEYS = ['cpu', 'diskSerial', 'mac', 'machineId', 'platform'] as const

/** Normalisation déterministe d'une valeur de champ (identique en Python). */
export function normalizeHwidField(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Produit le HWID V1 canonique « HWID1-<sha256hex> » à partir des champs. */
export function hwidV1(fields: HwidFieldsV1): string {
  const lines = HWID_V1_CANONICAL_KEYS.map((k) => `${k}=${normalizeHwidField(fields[k])}`)
  const serialized = 'GF-HWID-V1\n' + lines.join('\n')
  const digest = crypto.createHash('sha256').update(Buffer.from(serialized, 'utf8')).digest('hex')
  return `${HWID_V1_PREFIX}${digest}`
}

/** Vrai si `s` a la forme d'un HWID V1 (prefix + 64 hex). */
export function isHwidV1(s: unknown): boolean {
  return typeof s === 'string' && /^HWID1-[0-9a-f]{64}$/.test(s)
}
