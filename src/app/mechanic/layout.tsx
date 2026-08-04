import type { ReactNode } from 'react'

// L'espace mécanicien est isolé : aucune donnée mise en cache par le navigateur
// (chaque réponse API porte déjà no-store ; on désactive aussi la revalidation).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export default function MechanicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#0a0f1e] text-slate-200">
      {children}
    </div>
  )
}
