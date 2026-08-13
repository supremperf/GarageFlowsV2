'use client'

import { useRef, useState } from 'react'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import MechanicAvatar from '@/components/MechanicAvatar'
import { AVATAR_ACCEPT, preparerAvatar } from '@/lib/mechanics/avatar-client'

/**
 * Photo de profil d'un mécanicien : choix du fichier, optimisation, envoi.
 *
 * Le fichier est décodé et réduit dans le navigateur AVANT l'envoi (orientation
 * EXIF appliquée, métadonnées supprimées par ré-encodage, quelques kilo-octets
 * au lieu de plusieurs mégaoctets). Le serveur revalide tout : ce traitement est
 * un confort, pas une garantie.
 *
 * Aucun état n'est présumé : la vignette n'est mise à jour qu'APRÈS la réponse
 * du serveur. Afficher la nouvelle photo dès la sélection aurait donné à croire
 * qu'un envoi refusé avait réussi.
 */
export interface MechanicAvatarFieldProps {
  mechanic: { id: string; name: string; avatar?: string | null; color?: string | null; avatarUrl?: string | null }
  onChange: (avatarUrl: string | null) => void
}

export default function MechanicAvatarField({ mechanic, onChange }: MechanicAvatarFieldProps) {
  const champ = useRef<HTMLInputElement>(null)
  const [enCours, setEnCours] = useState<'envoi' | 'suppression' | null>(null)

  async function choisir(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0]
    // Le champ est réinitialisé tout de suite : sans cela, resélectionner LE
    // MÊME fichier après un échec ne déclenche aucun événement.
    e.target.value = ''
    if (!fichier) return

    setEnCours('envoi')
    try {
      const prepare = await preparerAvatar(fichier)
      if (!prepare.ok) { toast.error(prepare.reason); return }

      const res = await fetch(`/api/mechanics/${mechanic.id}/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: prepare.dataUrl }),
      })
      const corps = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(corps?.error || 'Envoi de la photo refusé.'); return }

      onChange(corps.avatarUrl ?? null)
      toast.success('Photo mise à jour')
    } catch {
      toast.error('Envoi impossible — vérifiez votre connexion.')
    } finally {
      setEnCours(null)
    }
  }

  async function supprimer() {
    setEnCours('suppression')
    try {
      const res = await fetch(`/api/mechanics/${mechanic.id}/avatar`, { method: 'DELETE' })
      const corps = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(corps?.error || 'Suppression refusée.'); return }
      onChange(null)
      toast.success('Photo supprimée')
    } catch {
      toast.error('Suppression impossible — vérifiez votre connexion.')
    } finally {
      setEnCours(null)
    }
  }

  const occupe = enCours !== null

  return (
    <div>
      <label className="block text-xs text-slate-400 mb-2">Photo de profil</label>
      <div className="flex items-center gap-3">
        <MechanicAvatar mechanic={mechanic} size={56} />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => champ.current?.click()}
            disabled={occupe}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/[0.06] transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
          >
            {enCours === 'envoi'
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Envoi…</>
              : <><Camera className="w-3.5 h-3.5" />{mechanic.avatarUrl ? 'Modifier la photo' : 'Ajouter une photo'}</>}
          </button>

          {mechanic.avatarUrl && (
            <button
              type="button"
              onClick={supprimer}
              disabled={occupe}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-slate-400 text-xs hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
            >
              {enCours === 'suppression'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
              Supprimer
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-slate-600">
        JPEG, PNG ou WebP. L’image est recadrée en carré et réduite automatiquement ;
        les données de localisation éventuelles sont retirées.
      </p>

      <input
        ref={champ}
        type="file"
        accept={AVATAR_ACCEPT}
        onChange={choisir}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}
