/**
 * Base URL de l'application pour construire des liens absolus (e-mails de
 * récupération, invitations). Priorité : GF_APP_URL, puis NEXTAUTH_URL, puis
 * un repli local desktop. Sans barre finale.
 */
export function appBaseUrl(): string {
  const raw = process.env.GF_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || 'http://127.0.0.1:3000'
  return raw.replace(/\/+$/, '')
}
