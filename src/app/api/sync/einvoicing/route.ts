import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/einvoicing — tunnel POSTE → CLOUD pour la facturation
 * électronique.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 * Quatre routes répondaient 501 SERVER_ONLY depuis un poste installé :
 * configuration de la plateforme, test de connexion, envoi, suivi de statut.
 * Le motif était réel — les quatre modèles d'e-facturation n'existent que dans
 * le schéma PostgreSQL — mais la conséquence l'était tout autant : la
 * facturation électronique était ANNONCÉE et INACCESSIBLE à qui travaille sur
 * un poste, c'est-à-dire à tous les garages.
 *
 * Retirer la garde `isPostgresDatabase()` aurait fait disparaître le 501 en
 * remplaçant une erreur claire par un 500 opaque : `serverPrisma()` lève sur
 * SQLite. Ce n'est pas la garde qu'il fallait corriger, c'est l'architecture.
 *
 * ── La chaîne ───────────────────────────────────────────────────────────────
 *   Poste ──[licence GF2]──▶ ce tunnel ──▶ PostgreSQL ──▶ adaptateur ──▶ plateforme
 *
 * Le poste n'atteint jamais une route exigeant PostgreSQL en local : il délègue.
 * Les identifiants de plateforme restent chiffrés au repos côté cloud, et ne
 * redescendent JAMAIS en clair (`projeter` les masque).
 *
 * ── Garanties ───────────────────────────────────────────────────────────────
 *   · identité par licence GARAGE GF2 ; `garageId` issu de la LICENCE ;
 *   · le poste ne choisit ni le garage, ni l'environnement (la configuration ne
 *     peut pas forcer la production) ;
 *   · l'idempotence de l'envoi reste celle de `submit.ts` (`cleIdempotence`) :
 *     deux clics ne produisent pas deux factures électroniques ;
 *   · les protections SSRF de `ssrf-guard.ts` s'appliquent inchangées, puisque
 *     c'est le même code d'envoi qui s'exécute.
 *
 * ── `actorUserId` ───────────────────────────────────────────────────────────
 * Volontairement `null` : l'utilisateur du poste n'existe pas dans la base
 * cloud, et inventer une correspondance produirait un journal d'audit qui ment
 * sur l'auteur. Le canal, lui, est tracé — la licence identifie le garage.
 */
import { NextResponse } from 'next/server'
import { prisma, serverPrisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { lireConnexion, projeter, dechiffrer, enregistrerConnexion, supprimerConnexion } from '@/lib/einvoicing/connection'
import { testerConnexion } from '@/lib/einvoicing/test-connection'
import {
  envoyerFacture, rafraichirStatut, declarerNonParvenue,
  motifNonTransmissible, peutEtreDeclareeNonParvenue,
} from '@/lib/einvoicing/submit'
import { linesToEuros } from '@/lib/money-db'
import { GENERIC_PA_ADAPTER_ID } from '@/lib/einvoicing/adapters/generic-pa'
import type { GenericPaCredentials } from '@/lib/einvoicing/adapters/generic-pa'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/** Statuts métier de `submit.ts`, repris tels quels. */
const STATUT_ENVOI: Record<string, number> = {
  NO_CONNECTION: 409, NO_ADAPTER: 409, INVOICE_NOT_FOUND: 404,
  CONNECTION_UNUSABLE: 503, VALIDATION: 422, ALREADY_SENT: 409,
}

const ACTIONS = new Set([
  'connection.get', 'connection.put', 'connection.delete', 'connection.test',
  'invoice.submit', 'invoice.status', 'invoice.not-received', 'invoice.transmissions',
  'flags.get',
])

const chaine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', `einvoice-sync:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/einvoicing] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string

  const action = typeof body.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION' }, { status: 400 })
  }

  const flags = getEInvoicingFlags()
  if (!flags.enabled) {
    return NextResponse.json({ ok: false, code: 'EINVOICING_DISABLED' }, { status: 409 })
  }
  // L'environnement vient de la configuration du SERVICE, jamais du poste : une
  // installation ne doit pas pouvoir se déclarer « production ».
  const environment = flags.defaultEnvironment

  try {
    switch (action) {
      case 'flags.get': {
        // Drapeaux du SERVICE, rendus tels quels. Ce ne sont que des booléens de
        // configuration — aucun secret. Un poste n'a jamais les variables
        // `EINVOICING_*` : s'il lisait les siennes, il conclurait « désactivé »
        // et masquerait une fonctionnalité que le service, lui, propose.
        return NextResponse.json({ ok: true, flags })
      }

      case 'connection.get': {
        const ligne = await lireConnexion(garageId, environment)
        return NextResponse.json({
          ok: true,
          connection: ligne ? projeter(ligne, dechiffrer(ligne.credentials)) : null,
          environment,
        })
      }

      case 'connection.put': {
        if (!flags.connectionsEnabled) {
          return NextResponse.json({ ok: false, code: 'CONNECTIONS_DISABLED' }, { status: 409 })
        }
        const p = (body.payload ?? {}) as Record<string, unknown>
        const credentials: Partial<GenericPaCredentials> = {
          authMode: p.authMode === 'api_key' ? 'api_key' : p.authMode === 'oauth2' ? 'oauth2' : undefined,
          apiBaseUrl: chaine(p.apiBaseUrl),
          submitPath: chaine(p.submitPath),
          statusPath: chaine(p.statusPath),
          tokenUrl: chaine(p.tokenUrl),
          clientId: chaine(p.clientId),
          clientSecret: chaine(p.clientSecret),
          scope: chaine(p.scope),
          apiKeyHeader: chaine(p.apiKeyHeader),
          apiKey: chaine(p.apiKey),
          extraHeaderName: chaine(p.extraHeaderName),
          extraHeaderValue: chaine(p.extraHeaderValue),
          webhookSecret: chaine(p.webhookSecret),
        }
        const { id, clair } = await enregistrerConnexion({
          garageId,
          providerId: chaine(p.providerId) ?? GENERIC_PA_ADAPTER_ID,
          environment,
          credentials,
        })
        await serverPrisma().eInvoiceAuditEvent.create({
          data: {
            garageId, actorUserId: null, action: 'connection.save',
            targetType: 'GarageEInvoiceConnection', targetId: id,
            metadata: JSON.stringify({ environment, canal: 'poste' }),
          },
        })
        const ligne = await lireConnexion(garageId, environment)
        return NextResponse.json({
          ok: true,
          connection: ligne ? projeter(ligne, clair) : null,
          environment,
        })
      }

      case 'connection.delete': {
        // Même verrou que la route de session : un interrupteur qui laisse
        // passer la DESTRUCTION des identifiants — sans permettre de les
        // ressaisir, le PUT étant fermé — n'est pas un interrupteur.
        if (!flags.connectionsEnabled) {
          return NextResponse.json({ ok: false, code: 'CONNECTIONS_DISABLED' }, { status: 409 })
        }
        const supprimee = await supprimerConnexion(garageId, environment)
        if (supprimee) {
          await serverPrisma().eInvoiceAuditEvent.create({
            data: {
              garageId, actorUserId: null, action: 'connection.delete',
              targetType: 'GarageEInvoiceConnection', targetId: garageId,
              metadata: JSON.stringify({ environment, canal: 'poste' }),
            },
          })
        }
        return NextResponse.json({ ok: true, deleted: supprimee, environment })
      }

      case 'connection.test': {
        // `testerConnexion` porte déjà son propre `ok` : le réécrire ici
        // masquerait le résultat de la MESURE.
        const { status, ...resultat } = await testerConnexion(garageId, environment, null)
        return NextResponse.json(resultat, { status })
      }

      case 'invoice.submit': {
        // Même verrou que la route de session : l'émission désactivée l'est pour
        // tout le monde, y compris pour un poste qui appellerait directement.
        if (!flags.outgoingEnabled) {
          return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED' }, { status: 409 })
        }
        const invoiceId = chaine((body.payload as Record<string, unknown>)?.invoiceId)
        if (!invoiceId) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })

        // La facture est lue DANS LE CLOUD : elle y est arrivée par
        // /api/sync/invoice. Sans cette publication préalable, il n'y aurait
        // rien à transmettre — c'est la raison d'être de l'ordre des lots.
        const facture = await prisma.invoice.findFirst({
          where: { id: invoiceId, garageId },
          include: { lines: { orderBy: { sortOrder: 'asc' } } },
        })
        if (!facture) {
          return NextResponse.json(
            { ok: false, code: 'INVOICE_NOT_PUBLISHED',
              message: 'Cette facture n’est pas encore parvenue au service en ligne. Réessayez dans un instant.' },
            { status: 409 },
          )
        }
        // Le contrôle d'état est refait ICI, pas seulement sur le poste : un
        // poste est un client, et une garantie qui dépend du contrôle que le
        // client veut bien faire avant d'appeler n'est pas une garantie.
        const interdit = motifNonTransmissible(facture.status)
        if (interdit) {
          return NextResponse.json({ ok: false, ...interdit }, { status: 409 })
        }

        const garage = await prisma.garage.findUnique({ where: { id: garageId } })
        if (!garage) return NextResponse.json({ ok: false, code: 'GARAGE_NOT_FOUND' }, { status: 404 })

        const resultat = await envoyerFacture({
          garageId,
          invoiceId: facture.id,
          environment,
          garage: { name: garage.name, siret: garage.siret, vatNumber: garage.vatNumber, address: garage.address },
          invoice: {
            number: facture.number,
            issueDate: facture.issueDate,
            dueDate: facture.dueDate,
            taxRate: facture.taxRate,
            clientName: facture.clientName,
            clientAddress: facture.clientAddress,
          },
          // Mêmes champs, même conversion que la route de session : le document
          // réglementaire ne doit pas dépendre du chemin emprunté pour l'émettre.
          lines: linesToEuros(facture.lines).map((l) => ({
            description: l.description,
            quantityTenThousandths: l.quantityTenThousandths,
            unitPriceTenThousandths: l.unitPriceTenThousandths,
          })),
          actorUserId: null,
        })
        return NextResponse.json(resultat, { status: resultat.ok ? 200 : (STATUT_ENVOI[resultat.code ?? ''] ?? 502) })
      }

      case 'invoice.status':
      case 'invoice.not-received': {
        const transmissionId = chaine((body.payload as Record<string, unknown>)?.transmissionId)
        if (!transmissionId) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
        const resultat = action === 'invoice.status'
          ? await rafraichirStatut(garageId, transmissionId)
          : await declarerNonParvenue(garageId, transmissionId, null)
        return NextResponse.json(resultat, { status: resultat.ok ? 200 : (STATUT_ENVOI[resultat.code ?? ''] ?? 502) })
      }

      case 'invoice.transmissions': {
        const invoiceId = chaine((body.payload as Record<string, unknown>)?.invoiceId)
        if (!invoiceId) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })

        // Portée garage explicite : l'identifiant d'une facture ne suffit jamais
        // — sans ce `garageId`, un poste lirait les transmissions d'un autre.
        const transmissions = await serverPrisma().eInvoiceTransmission.findMany({
          where: { invoiceId, garageId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, providerId: true, environment: true, status: true,
            documentFormat: true, documentSha256: true, externalId: true,
            errorMessage: true, createdAt: true, updatedAt: true,
          },
        })
        return NextResponse.json({
          ok: true,
          transmissions: transmissions.map((t) => ({
            ...t,
            peutDeclarerNonParvenue: peutEtreDeclareeNonParvenue(t),
            peutRelireStatut: Boolean(t.externalId),
          })),
          outgoingEnabled: flags.outgoingEnabled,
          environment,
          // `peutEmettre` n'est PAS calculé ici : il dépend du rôle de la session
          // du poste, que ce tunnel ne connaît pas — la licence identifie un
          // garage, pas un utilisateur. Le poste l'ajoute à partir de sa session.
        })
      }

      default:
        return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION' }, { status: 400 })
    }
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}
