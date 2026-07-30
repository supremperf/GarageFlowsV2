/**
 * Déclarations de modules pour les imports d'images statiques.
 * Normalement fournies par `next-env.d.ts` (généré, non commité) ; on les commit
 * ici pour que `tsc --noEmit` passe même sans build Next préalable (CI robuste).
 */
declare module '*.png' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData
  export default content
}
declare module '*.jpg' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData
  export default content
}
declare module '*.jpeg' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData
  export default content
}
declare module '*.webp' {
  const content: import('next/dist/shared/lib/image-external').StaticImageData
  export default content
}
