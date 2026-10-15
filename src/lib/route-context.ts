/** Next 15 supplies Promise params. Keep inner authorization handlers on resolved
 * values, including legacy direct invocation used by integration callers. */
export type PromisedRouteContext<T> = T extends { params: infer P }
  ? Omit<T, 'params'> & { params: Promise<P> }
  : T
export type ResolvedRouteContext<T> = T extends { params: infer P }
  ? Omit<T, 'params'> & { params: Awaited<P> }
  : T

export async function resolveRouteContext<T>(context: T): Promise<ResolvedRouteContext<T>> {
  if (context && typeof context === 'object' && 'params' in context) {
    return { ...context, params: await context.params } as ResolvedRouteContext<T>
  }
  return context as ResolvedRouteContext<T>
}
