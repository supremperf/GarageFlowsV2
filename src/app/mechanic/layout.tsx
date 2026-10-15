import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'

// L'espace mécanicien est isolé : aucune donnée mise en cache par le navigateur
// (chaque réponse API porte déjà no-store ; on désactive aussi la revalidation).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * Espace MÉCANICIEN — son propre manifeste.
 *
 * Le manifeste racine déclare `start_url: '/'` et `scope: '/'`. L'icône
 * installée par un mécanicien n'ouvrait donc jamais `/mechanic` directement :
 * elle y arrivait par ricochet, le middleware redirigeant tant qu'une session
 * `typ=mechanic` valide existe. Le jour où cette session expire — 30 jours —
 * l'icône ouvre le formulaire de connexion du GARAGE, que le mécanicien ne peut
 * pas franchir : il n'a pas de compte, il a une clé. Sa page de réactivation
 * est `/license`, qu'aucun chemin ne lui propose depuis là.
 *
 * Un `start_url` et un `scope` propres suppriment le ricochet : l'icône ouvre
 * son espace, session valide ou non, et l'application y reste bornée.
 */
export const metadata: Metadata = {
  manifest: '/manifest-mecanicien.webmanifest',
}

/**
 * La teinte annoncée est celle de CET écran (`#0a0f1e`), pas celle de l'accueil
 * du garage (`#0f1629`) : sinon le liseré système et l'écran de lancement
 * s'affichent dans une couleur que la page suivante dément.
 */
export const viewport: Viewport = {
  themeColor: '#0a0f1e',
}

export default function MechanicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#0a0f1e] text-slate-200">
      {children}
    </div>
  )
}
