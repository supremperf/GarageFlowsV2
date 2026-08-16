import type { ReactNode } from 'react'
import type { Metadata } from 'next'

/**
 * Espace CLIENT — son propre manifeste.
 *
 * Sans ce layout, `/clients/*` héritait entièrement du `<head>` racine et
 * proposait donc au client d'installer… le logiciel de gestion du GARAGE. Un
 * client qui ouvrait son lien reçu par SMS se voyait offrir « Installer
 * GarageFlows » ; l'icône obtenue portait le nom et la description d'un outil
 * d'atelier, et son `start_url` pointait vers `/`, un écran de connexion
 * réservé au personnel qu'aucun client ne peut franchir.
 *
 * Le manifeste dédié rend l'installation UTILE plutôt que trompeuse : elle
 * ouvre l'espace client, et son périmètre y reste borné.
 */
export const metadata: Metadata = {
  manifest: '/manifest-client.webmanifest',
}

export default function ClientsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
