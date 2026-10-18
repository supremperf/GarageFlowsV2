/** Message client neutre par défaut : un corps inconnu n'établit jamais une licence invalide. */
export function activationErrorMessage(data: unknown, httpStatus: number): string {
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (httpStatus >= 500 || ['DB_UNAVAILABLE', 'SERVER_MISCONFIGURED', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'].includes(String(body.code))) {
    return 'Le service de vérification est indisponible. Activation non effectuée ; réessayez plus tard.'
  }
  if (httpStatus === 429) return 'Trop de tentatives. Attendez avant de réessayer.'
  if (typeof body.reason === 'string' && body.reason) return body.reason
  return 'La vérification n’a pas abouti. Réessayez ou contactez le support.'
}
