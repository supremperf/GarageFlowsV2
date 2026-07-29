'use client'

import PwaRegister from './PwaRegister'
import InstallPrompt from './InstallPrompt'
import PwaShortcutHandler from './PwaShortcutHandler'

/**
 * Point de montage unique des fonctionnalités PWA (client-only).
 * Monté une seule fois dans le layout racine.
 */
export default function PWA() {
  return (
    <>
      <PwaRegister />
      <InstallPrompt />
      <PwaShortcutHandler />
    </>
  )
}
