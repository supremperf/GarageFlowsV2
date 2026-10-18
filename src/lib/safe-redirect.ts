/**
 * Anti open-redirect : neutralise une cible de redirection provenant d'une entrée
 * non fiable (paramètre `callbackUrl`, `next`, `returnTo`…).
 *
 * Seul un CHEMIN INTERNE (même origine) est autorisé. Toute URL absolue, toute
 * cible protocol-relative (`//evil.com`), toute variante à antislash
 * (`/\evil.com`, que les navigateurs normalisent en `//evil.com`) ou toute cible
 * ne commençant pas par `/` est rejetée et repliée sur `fallback`.
 *
 * Rejeter empêche un attaquant de fabriquer `…/login?callbackUrl=https://evil.com`
 * pour rediriger la victime hors du domaine après authentification (phishing,
 * vol de session via page miroir).
 */
export function safeInternalPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  // Doit être un chemin relatif à la racine : commence par un unique '/'.
  if (raw[0] !== '/') return fallback
  // '//host' (protocol-relative) et '/\host' / '/ /' … s'échappent vers une
  // autre origine → interdits. On refuse tout 2e caractère '/' ou '\'.
  if (raw[1] === '/' || raw[1] === '\\') return fallback
  // Défense en profondeur : un caractère de contrôle en tête peut être ignoré
  // par le navigateur et démasquer un '//host' — on refuse les blancs de tête.
  if (/^[/][\s\\]/.test(raw)) return fallback
  return raw
}
