export const dynamic = 'force-dynamic'

/**
 * PUT /api/portal/auth/password — le client définit ou change son mot de passe.
 *
 * ─── Ce qui manquait (GF-PORT-003) ──────────────────────────────────────────
 * Le portail n'avait AUCUNE route de mot de passe : ni changement, ni
 * réinitialisation. Un client ne pouvait donc jamais changer le sien, et le
 * garage ne pouvait pas lui en remettre un — l'unique chemin d'entrée était
 * l'auto-inscription.
 *
 * Cette route sert les DEUX cas :
 *  - première définition après remise d'un mot de passe temporaire par le
 *    garage (`mustChangePassword` levé) ;
 *  - changement volontaire par un client déjà installé.
 *
 * Dans les deux cas le mot de passe ACTUEL est exigé. Ne pas l'exiger sur le
 * premier cas aurait paru commode — le client vient de le saisir — mais un
 * cookie volé aurait alors suffi à s'approprier le compte définitivement.
 *
 * ─── Invalidation des sessions ──────────────────────────────────────────────
 * Toutes les autres sessions sont révoquées. Changer son mot de passe est le
 * geste qu'on fait quand on soupçonne que quelqu'un d'autre est entré : le
 * laisser connecté viderait l'opération de son sens. La session COURANTE est
 * conservée, sans quoi l'utilisateur se ferait déconnecter par son propre
 * changement.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { withPortalAuth, type PortalContext } from '@/lib/portal/auth-helpers'
import { motDePasseAcceptable } from '@/lib/portal/mot-de-passe'
import { logger } from '@/lib/logger'

export const PUT = withPortalAuth(
  async (req: NextRequest, portal: PortalContext) => {
    let corps: { currentPassword?: unknown; newPassword?: unknown }
    try {
      corps = await req.json()
    } catch {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }

    if (typeof corps.currentPassword !== 'string' || corps.currentPassword.length === 0) {
      return NextResponse.json({ error: 'Mot de passe actuel requis.' }, { status: 400 })
    }

    const verdict = motDePasseAcceptable(corps.newPassword)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.raison, code: 'WEAK_PASSWORD' }, { status: 400 })
    }
    const nouveau = corps.newPassword as string

    // Vérification du mot de passe ACTUEL — y compris quand il est temporaire.
    const actuelValide = await bcrypt.compare(corps.currentPassword, portal.user.passwordHash)
    if (!actuelValide) {
      logger.warn('[portal/password] mot de passe actuel invalide', { user: portal.user.id })
      return NextResponse.json({ error: 'Mot de passe actuel incorrect.' }, { status: 403 })
    }

    // Réutiliser le mot de passe temporaire remis par le garage ne définirait
    // rien du tout : il reste connu de qui l'a communiqué.
    if (await bcrypt.compare(nouveau, portal.user.passwordHash)) {
      return NextResponse.json(
        { error: 'Le nouveau mot de passe doit être différent de l’actuel.', code: 'PASSWORD_UNCHANGED' },
        { status: 400 },
      )
    }

    const hash = await bcrypt.hash(nouveau, 12)

    await prisma.$transaction([
      prisma.portalUser.update({
        where: { id: portal.user.id },
        data: {
          passwordHash: hash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          // Un changement réussi remet le compteur d'échecs et lève un
          // verrouillage éventuel : le titulaire vient de prouver son identité.
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      // Toutes les AUTRES sessions tombent. La session courante survit, sinon
      // l'utilisateur serait déconnecté par son propre changement.
      prisma.portalDevice.updateMany({
        where: { portalUserId: portal.user.id, id: { not: portal.device.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    logger.info('[portal/password] mot de passe défini', { user: portal.user.id })

    return NextResponse.json({ ok: true })
  },
  // Sans cette exception, un client à qui le garage vient de remettre un mot de
  // passe temporaire ne pourrait JAMAIS le changer : la garde le renverrait sur
  // la route même qu'il essaie d'atteindre.
  { autoriseMotDePasseTemporaire: true },
)
