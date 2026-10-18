/** Erreurs de configuration : distinctes des refus métier, sans valeur sensible. */
export class LicenseConfigurationError extends Error {
  constructor(message = 'Configuration du service de licence invalide.') {
    super(message)
    this.name = 'LicenseConfigurationError'
  }
}

/** Classement conservateur : un bug inconnu n'est ni une licence invalide ni une panne DB présumée. */
export function licenseFailure(error: unknown, depth = 0): { code: string; status: number } {
  if (error instanceof LicenseConfigurationError) return { code: 'SERVER_MISCONFIGURED', status: 500 }
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(e.code ?? e.errorCode ?? '')
  const message = error instanceof Error ? error.message : String(e.message ?? '')
  if (/^P10\d\d$/.test(code) || ['P2024', 'P2037'].includes(code) ||
      String(e.name ?? '').startsWith('PrismaClientInitialization') || e.kind === 'Closed' ||
      /kind:\s*Closed|Can't reach database server|connection (?:closed|refused)|ECONNREFUSED|database is locked/i.test(message)) {
    return { code: 'DB_UNAVAILABLE', status: 503 }
  }
  if (e.cause && depth < 3) return licenseFailure(e.cause, depth + 1)
  return { code: 'INTERNAL_ERROR', status: 500 }
}
