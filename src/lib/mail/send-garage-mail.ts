/**
 * Envoi d'un courriel AU NOM D'UN GARAGE, depuis sa configuration SMTP.
 *
 * Trois routes construisaient déjà leur propre transport nodemailer
 * (`/api/email`, `/api/notifications/dispatch`, `/api/reminders/send`) ; ce
 * module ne les remplace pas — il évite d'en ajouter une quatrième copie pour
 * les envois transactionnels du portail client.
 *
 * Garanties :
 *  - le mot de passe SMTP est déchiffré CÔTÉ SERVEUR uniquement, jamais
 *    journalisé, jamais renvoyé ;
 *  - une configuration incomplète ou indéchiffrable renvoie un résultat
 *    STRUCTURÉ (`ok: false` + motif) — jamais une exception qui ferait échouer
 *    l'opération métier appelante ;
 *  - un échec n'est jamais présenté comme un succès (§3).
 */

import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'
import { decryptSecret, isEncryptedSecret } from '@/lib/security/secret-cipher'
import { logger } from '@/lib/logger'

export type MailFailure =
  /** Le garage n'a pas (ou pas complètement) configuré son SMTP. */
  | 'SMTP_NOT_CONFIGURED'
  /** Mot de passe stocké illisible (clé absente ou changée). */
  | 'SMTP_SECRET_UNREADABLE'
  /** Le serveur SMTP a refusé l'envoi. */
  | 'SMTP_SEND_FAILED'

export interface MailResult {
  ok: boolean
  reason?: MailFailure
  /** Message opérateur, sans secret ni pile d'appels. */
  message?: string
}

export interface GarageMail {
  garageId: string
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Envoie un courriel avec la configuration SMTP du garage.
 * Ne lève jamais : renvoie toujours un résultat exploitable.
 */
export async function sendGarageMail(mail: GarageMail): Promise<MailResult> {
  const garage = await prisma.garage.findUnique({
    where: { id: mail.garageId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true, name: true },
  })

  // Extraction AVANT la garde : le rétrécissement de type sur les propriétés
  // d'un objet lui-même nullable n'est pas conservé par TypeScript.
  const host = garage?.smtpHost ?? null
  const port = garage?.smtpPort ?? null
  const user = garage?.smtpUser ?? null
  const stocke = garage?.smtpPass ?? null

  if (!host || !port || !user || !stocke) {
    return {
      ok: false,
      reason: 'SMTP_NOT_CONFIGURED',
      message: 'Aucune configuration SMTP complète pour ce garage.',
    }
  }
  // `decryptSecret` renvoie `string | null` : il rend la valeur telle quelle si
  // elle n'est pas chiffrée (enregistrement hérité), et `null` seulement pour une
  // entrée nulle — écartée par la garde ci-dessus. On traite néanmoins le `null`
  // comme un échec plutôt que d'envoyer avec un mot de passe vide.
  let pass: string
  try {
    const clair = isEncryptedSecret(stocke) ? decryptSecret(stocke) : stocke
    if (!clair) {
      return {
        ok: false,
        reason: 'SMTP_SECRET_UNREADABLE',
        message: 'Mot de passe SMTP illisible (clé de chiffrement absente ou modifiée).',
      }
    }
    pass = clair
  } catch {
    return {
      ok: false,
      reason: 'SMTP_SECRET_UNREADABLE',
      message: 'Mot de passe SMTP illisible (clé de chiffrement absente ou modifiée).',
    }
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: Boolean(garage?.smtpSecure),
      auth: { user, pass },
    })
    await transporter.sendMail({
      from: garage?.smtpFrom ?? user,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    })
    return { ok: true }
  } catch (err) {
    // Jamais le mot de passe, jamais la pile : seulement de quoi diagnostiquer.
    logger.warn('[mail] envoi refusé par le serveur SMTP', {
      garageId: mail.garageId,
      host,
      erreur: err instanceof Error ? err.message : 'inconnue',
    })
    return {
      ok: false,
      reason: 'SMTP_SEND_FAILED',
      message: 'Le serveur SMTP a refusé l’envoi.',
    }
  }
}
