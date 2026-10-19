export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/diagnostics — intégrité de la CONFIGURATION déployée.
 *
 * POURQUOI CETTE ROUTE EXISTE (incident du 2026-08-16)
 * `DATABASE_URL` de Production portait un `U+FEFF` en tête — invisible. Le hook
 * d'instrumentation refusait le démarrage, Next.js renvoyait sa page HTML 500
 * générique sur TOUTES les routes, et rien, depuis l'extérieur, ne permettait de
 * savoir laquelle des vingt-six variables était en cause : Vercel masque les
 * valeurs (`vercel env pull` rend « [SENSITIVE] »), et l'unique trace vivait dans
 * les journaux d'exécution. Le diagnostic a demandé une heure là où une empreinte
 * l'aurait donné en une requête.
 *
 * CE QU'ELLE EXPOSE — et ce qu'elle n'exposera JAMAIS
 * Uniquement des métadonnées : présence, longueur, PREMIER POINT DE CODE et
 * empreinte tronquée. Jamais une valeur, jamais un fragment de valeur, jamais un
 * URL de base, jamais un jeton. L'empreinte est salée par un domaine public ET
 * par le NOM de la variable : elle ne peut donc ni être comparée à une table
 * arc-en-ciel générique, ni être rejouée d'une variable à l'autre. Elle sert à
 * répondre à une seule question — « la valeur déployée est-elle EXACTEMENT celle
 * que je crois avoir poussée ? » — en la comparant à l'empreinte calculée
 * localement sur la valeur d'origine.
 *
 * Auth : en-tête `x-gf-key` == GARAGEFLOW_API_KEY, comparaison à temps constant,
 * exactement comme les routes d'administration de licences.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPublicKeyPem } from '@/lib/license/public-key'
import { validateEnv } from '@/lib/env'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Variables inspectées. La liste est EXPLICITE : parcourir `process.env` ferait
 * fuiter, par leurs seuls noms, la présence d'intégrations non publiques et les
 * variables internes de la plateforme.
 */
const INSPECTED = [
  'DATABASE_URL', 'DIRECT_URL',
  'NEXTAUTH_URL', 'NEXTAUTH_SECRET',
  'GF_APP_URL', 'GARAGEFLOW_API_KEY', 'DEVICE_TOKEN_PEPPER',
  'GF_DB_MAC_SECRET', 'GF_PORTAL_SECRET', 'GF_SIGNATURE_SECRET', 'GF_PRIVATE_KEY',
  'GF_TOTP_ENC_KEY', 'GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
] as const

/**
 * Caractères qui rendent une valeur « correcte à l'œil » et pourtant invalide.
 * U+FEFF est celui qui a causé l'incident ; les autres se copient de la même
 * façon depuis une page web ou un tableur.
 */
const INVISIBLES: ReadonlyArray<[number, string]> = [
  [0xfeff, 'U+FEFF'], [0x200b, 'U+200B'], [0x200c, 'U+200C'], [0x200d, 'U+200D'],
  [0x00a0, 'U+00A0'], [0x0000, 'U+0000'], [0x000a, 'U+000A'], [0x000d, 'U+000D'],
]

/** Comparaison à temps constant (évite l'oracle de timing sur la clé API). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Empreinte de configuration : SHA-256 sur « domaine | nom | valeur », tronquée
 * à 12 hex. Le domaine et le nom sont publics et constants — reproductibles hors
 * ligne sur la valeur d'origine, donc comparables — mais ils interdisent le
 * rejeu d'une empreinte d'une variable vers une autre.
 */
function configFingerprint(name: string, value: string): string {
  return crypto.createHash('sha256')
    .update(`GF-ENV-FP-v1|${name}|${value}`, 'utf8')
    .digest('hex').slice(0, 12).toUpperCase()
}

function codePointLabel(cp: number | undefined): string {
  if (cp === undefined) return '(vide)'
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Étiquettes des caractères invisibles présents dans `value`. */
function invisiblesIn(value: string): string[] {
  return INVISIBLES.filter(([cp]) => value.includes(String.fromCodePoint(cp))).map(([, label]) => label)
}

function inspect(name: string) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return { name, present: false as const }
  }
  return {
    name,
    present: true as const,
    length: raw.length,
    firstCodePoint: codePointLabel(raw.codePointAt(0)),
    lastCodePoint: codePointLabel(raw.codePointAt(raw.length - 1)),
    trimChangesValue: raw.trim() !== raw,
    invisibles: invisiblesIn(raw),
    // CE QUI SURVIT À `.trim()` — la seule mesure qui dise si un caractère
    // invisible a un EFFET, et pas seulement une présence.
    //
    // `trim()` retire U+FEFF en JavaScript (production WhiteSpace d'ECMAScript).
    // Un consommateur qui écrit `process.env.X?.trim()` obtient donc EXACTEMENT
    // la même valeur avec ou sans BOM de tête : l'anomalie est cosmétique.
    // Un invisible au MILIEU d'une valeur, lui, survit à tout trim et corrompt
    // la valeur pour n'importe quel lecteur — c'est un défaut réel.
    //
    // Sans cette distinction, la porte de convergence ne peut que tout refuser
    // en bloc. Le 2026-08-16 elle a refusé un déploiement sain pour trois BOM
    // portés par des clés de chiffrement au repos DÉLIBÉRÉMENT préservées (donc
    // que la rotation ne réécrit pas) et lues avec `.trim()` : un refus que
    // AUCUNE rotation ultérieure ne pouvait lever, pendant que la production
    // restait sur un déploiement en panne.
    invisiblesAfterTrim: invisiblesIn(raw.trim()),
    fingerprint: configFingerprint(name, raw),
  }
}

/** Empreinte canonique d'une clé publique : SHA-256 du DER SPKI. */
function spkiFingerprint(pem: string): string {
  return crypto.createHash('sha256')
    .update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

/**
 * Empreinte de la clé PUBLIQUE dérivée de GF_PRIVATE_KEY. La clé privée n'est
 * ni renvoyée, ni journalisée : seule sa moitié publique — non secrète par
 * construction — sert à prouver que le déploiement peut vérifier ce qu'il signe.
 */
function privateKeyPublicFingerprint(): { fingerprint: string | null; error?: string } {
  const raw = process.env.GF_PRIVATE_KEY
  if (!raw) return { fingerprint: null, error: 'absente' }
  try {
    const pem = /-----BEGIN/.test(raw) ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const pub = crypto.createPublicKey(crypto.createPrivateKey(pem))
    return { fingerprint: spkiFingerprint(pub.export({ type: 'spki', format: 'pem' }) as string) }
  } catch {
    // Message générique : ne jamais refléter le contenu de la clé dans l'erreur.
    return { fingerprint: null, error: 'illisible' }
  }
}

export async function GET(req: NextRequest) {
  // Diagnostic sensible : une panne du limiteur requis doit fermer l’accès.
  const rl = await enforceRateLimit('admin', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''
  if (!serverApiKey || serverApiKey.length < 16) {
    return NextResponse.json(
      { error: 'Configuration serveur incomplète (GARAGEFLOW_API_KEY).' },
      { status: 500, headers: NO_STORE },
    )
  }
  if (!apiKey || !safeEqual(apiKey, serverApiKey)) {
    return NextResponse.json({ error: 'Accès refusé — clé API invalide' }, { status: 403, headers: NO_STORE })
  }

  const embedded = spkiFingerprint(getPublicKeyPem())
  const derived = privateKeyPublicFingerprint()
  const env = INSPECTED.map(inspect)
  const { ok: envOk, issues } = validateEnv()

  return NextResponse.json(
    {
      ok: true,
      runtime: {
        node: process.version,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        region: process.env.VERCEL_REGION ?? null,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        electron: process.env.ELECTRON === '1',
      },
      // Le cœur du diagnostic post-rotation : la clé publique embarquée dans le
      // build et la clé privée de signature doivent désigner la MÊME paire.
      // `converged: false` signifie que toute licence émise par ce déploiement
      // sera refusée par ce même déploiement.
      licenseKey: {
        embeddedPublicFingerprint: embedded,
        privateKeyPublicFingerprint: derived.fingerprint,
        privateKeyError: derived.error ?? null,
        converged: derived.fingerprint !== null && derived.fingerprint === embedded,
      },
      // `validateEnv()` ne renvoie que des noms et des motifs — jamais de valeur.
      envValidation: { ok: envOk, issues },
      env,
    },
    { headers: NO_STORE },
  )
}
