/**
 * Résolution et diagnostic de la configuration SMTP.
 *
 * ─── Défauts corrigés ───────────────────────────────────────────────────────
 * 1. « Configuration SMTP incomplète » alors que le formulaire est rempli :
 *    le bouton « Tester » n'envoyait que `{action:'test'}` et le serveur lisait
 *    UNIQUEMENT la base. Une saisie non encore enregistrée — ou un mot de passe
 *    jamais persisté — donnait donc systématiquement ce refus.
 * 2. L'interface déduisait « un mot de passe est enregistré » de la seule
 *    présence de `smtpUser`. Un garage dont `smtpPass` est NULL affichait donc
 *    « •••••••• (déjà enregistré) », laissait enregistrer sans mot de passe,
 *    puis échouait au test — exactement le symptôme signalé.
 *
 * ─── Règle de sécurité NON NÉGOCIABLE ───────────────────────────────────────
 * Le mot de passe stocké (chiffré au repos) n'est JAMAIS renvoyé au navigateur,
 * et il n'est réutilisable QU'AVEC le couple (hôte, utilisateur) enregistré.
 * Sans cette restriction, un test pointant vers un hôte arbitraire ferait
 * présenter le mot de passe du garage à un serveur choisi par l'appelant —
 * c'est-à-dire une exfiltration d'identifiants. Changer d'hôte ou de compte
 * exige donc de ressaisir le mot de passe.
 */

export interface StoredSmtp {
  smtpHost: string | null
  smtpPort: number | null
  smtpUser: string | null
  /** Valeur CHIFFRÉE telle que stockée — jamais exposée. */
  smtpPass: string | null
  smtpFrom: string | null
  smtpSecure: boolean | null
}

/** Valeurs courantes du formulaire, transmises par « Tester ». */
export interface SmtpOverrides {
  smtpHost?: unknown
  smtpPort?: unknown
  smtpUser?: unknown
  smtpFrom?: unknown
  smtpSecure?: unknown
  /** Mot de passe SAISI (en clair) — présent seulement s'il a été modifié. */
  smtpPass?: unknown
}

export type SmtpResolution =
  | {
      ok: true
      host: string
      port: number
      secure: boolean
      user: string
      from: string
      /** true → déchiffrer le secret stocké ; false → utiliser `password`. */
      useStoredSecret: boolean
      password: string | null
    }
  | { ok: false; status: number; error: string }

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Le port par défaut dépend du mode : 465 implicite = SSL, sinon STARTTLS. */
function resolvePort(override: unknown, stored: number | null): number {
  if (typeof override === 'number' && Number.isFinite(override)) return override
  const parsed = text(override) ? Number(text(override)) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return stored ?? 587
}

/**
 * Combine la configuration enregistrée et les valeurs courantes du formulaire.
 * Aucune E/S : entièrement testable.
 */
export function resolveSmtpTestConfig(stored: StoredSmtp | null, overrides: SmtpOverrides = {}): SmtpResolution {
  const s: StoredSmtp = stored ?? {
    smtpHost: null, smtpPort: null, smtpUser: null,
    smtpPass: null, smtpFrom: null, smtpSecure: null,
  }

  const host = text(overrides.smtpHost) ?? text(s.smtpHost)
  const user = text(overrides.smtpUser) ?? text(s.smtpUser)
  const typedPassword = text(overrides.smtpPass)

  // Messages NOMMANT le champ manquant : « incomplète » sans précision ne
  // permettait pas de comprendre quoi corriger.
  if (!host) {
    return { ok: false, status: 422, error: 'Serveur SMTP manquant — choisissez un fournisseur ou renseignez un serveur.' }
  }
  if (!user) {
    return { ok: false, status: 422, error: 'Adresse email manquante — renseignez le compte d’envoi.' }
  }

  let useStoredSecret = false
  if (!typedPassword) {
    if (!s.smtpPass) {
      return {
        ok: false,
        status: 422,
        error: 'Aucun mot de passe enregistré — saisissez le mot de passe d’application puis réessayez.',
      }
    }
    // Anti-exfiltration : le secret stocké ne sert qu'avec son hôte/compte.
    if (host !== text(s.smtpHost) || user !== text(s.smtpUser)) {
      return {
        ok: false,
        status: 422,
        error: 'La configuration a changé — saisissez le mot de passe correspondant au nouveau compte, puis réessayez.',
      }
    }
    useStoredSecret = true
  }

  const port = resolvePort(overrides.smtpPort, s.smtpPort)
  const secure = typeof overrides.smtpSecure === 'boolean'
    ? overrides.smtpSecure
    : (s.smtpSecure ?? port === 465)

  return {
    ok: true,
    host,
    port,
    secure,
    user,
    from: text(overrides.smtpFrom) ?? text(s.smtpFrom) ?? user,
    useStoredSecret,
    password: typedPassword,
  }
}

/**
 * Traduit une erreur Nodemailer en message ACTIONNABLE pour l'utilisateur.
 * Aucun détail interne, aucune trace, aucun secret.
 */
export function smtpErrorMessage(err: unknown, host?: string): string {
  const e = err as { code?: string; responseCode?: number; message?: string } | null
  const code = typeof e?.code === 'string' ? e.code.toUpperCase() : ''
  const responseCode = typeof e?.responseCode === 'number' ? e.responseCode : 0
  const raw = typeof e?.message === 'string' ? e.message : ''
  const message = raw.toLowerCase()
  const provider = host?.includes('gmail') ? 'Gmail'
    : host?.includes('office365') || host?.includes('outlook') ? 'Outlook'
    : host?.includes('yahoo') ? 'Yahoo'
    : null
  /** Sujet de phrase : « Gmail n'a pas répondu » / « le serveur email … ». */
  const service = provider ?? 'le serveur email'
  /** Complément contracté : « auprès de Gmail » / « auprès du serveur email ». */
  const aupres = provider ? `de ${provider}` : 'du serveur email'

  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 ||
      message.includes('username and password not accepted') || message.includes('invalid login')) {
    const hint = /gmail|yahoo/.test(host ?? '')
      ? ' Ce fournisseur exige un mot de passe d’application, pas votre mot de passe habituel.'
      : ''
    return `Impossible d’envoyer l’email. L’authentification auprès ${aupres} a été refusée.` +
           ` Vérifiez l’adresse et le mot de passe.${hint}`
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || message.includes('timeout')) {
    return `Délai dépassé — ${service} n’a pas répondu. Vérifiez le port et votre connexion réseau.`
  }
  if (code === 'ENOTFOUND' || code === 'EDNS' || message.includes('getaddrinfo')) {
    return 'Serveur SMTP introuvable — vérifiez l’adresse du serveur.'
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNECTION') {
    return `Connexion refusée par ${service} — vérifiez le serveur et le port.`
  }
  if (code === 'ESSL' || code === 'ETLS' || message.includes('ssl') || message.includes('tls') ||
      message.includes('wrong version number') || message.includes('self signed')) {
    return 'Erreur TLS/SSL — vérifiez l’option SSL/TLS et le port (465 pour SSL, 587 pour STARTTLS).'
  }
  if (code === 'EENVELOPE' || responseCode === 550 || message.includes('recipient')) {
    return 'Adresse email refusée par le serveur — vérifiez l’adresse d’expédition.'
  }
  // Repli borné : utile au diagnostic, sans stack ni information interne.
  const short = raw.split('\n')[0].slice(0, 160)
  return short || 'Échec de l’envoi de l’email de test.'
}
