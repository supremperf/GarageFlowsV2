'use client'

import { useState, useEffect, useRef } from 'react'
import { Camera, Trash2, Plus, X, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { reduirePhoto } from '@/lib/photo-client'
import toast from 'react-hot-toast'

interface Photo {
  id: string
  phase: 'before' | 'during' | 'after'
  caption?: string | null
  base64: string        // legacy: empty string when photoPath is used
  photoPath?: string | null
  createdAt: string
}

function photoSrc(photo: Photo): string {
  return photo.photoPath ? `/api/photos/${photo.photoPath}` : photo.base64
}

interface Props {
  jobId: string
}

const PHASES = [
  { value: 'before', label: 'Avant', color: 'bg-amber-100 text-amber-700' },
  { value: 'during', label: 'En cours', color: 'bg-blue-100 text-blue-700' },
  { value: 'after',  label: 'Après', color: 'bg-emerald-100 text-emerald-700' },
] as const

export default function JobPhotos({ jobId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedPhase, setSelectedPhase] = useState<'before' | 'during' | 'after'>('before')
  const [caption, setCaption] = useState('')
  const [preview, setPreview] = useState<Photo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function fetchPhotos() {
    const r = await fetch(`/api/jobs/${jobId}/photos`)
    if (r.ok) setPhotos(await r.json())
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPhotos() }, [jobId])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Réduction par le module partagé — même passage canvas pour les quatre
    // écrans qui déposent une photo (GF-038).
    const base64 = await reduirePhoto(file, { coteMax: 800, qualite: 0.82 })

    setUploading(true)
    try {
      const r = await fetch(`/api/jobs/${jobId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: selectedPhase, caption: caption || null, base64 }),
      })
      if (!r.ok) throw new Error()
      await fetchPhotos()
      setCaption('')
      toast.success('Photo ajoutée')
    } catch {
      toast.error('Erreur upload photo')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(photoId: string) {
    const r = await fetch(`/api/jobs/${jobId}/photos?photoId=${photoId}`, { method: 'DELETE' })
    if (r.ok) {
      setPhotos(p => p.filter(x => x.id !== photoId))
      toast.success('Photo supprimée')
    }
  }

  const byPhase = (phase: string) => photos.filter(p => p.phase === phase)

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {PHASES.map(ph => (
            <button
              key={ph.value}
              onClick={() => setSelectedPhase(ph.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold transition-colors',
                selectedPhase === ph.value ? ph.color : 'text-gray-500 hover:bg-gray-50'
              )}
            >
              {ph.label}
            </button>
          ))}
        </div>
        <input
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Légende (optionnel)"
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Camera className="w-3.5 h-3.5" />
          {uploading ? 'Upload…' : 'Ajouter'}
        </button>
      </div>

      {/* Photos by phase */}
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Chargement…</p>
      ) : photos.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Aucune photo</p>
          <p className="text-xs mt-1">Ajoutez des photos avant / pendant / après l&apos;intervention</p>
        </div>
      ) : (
        <div className="space-y-4">
          {PHASES.map(ph => {
            const phasePics = byPhase(ph.value)
            if (phasePics.length === 0) return null
            return (
              <div key={ph.value}>
                <p className={cn('text-xs font-semibold px-2 py-0.5 rounded-full inline-block mb-2', ph.color)}>
                  {ph.label} ({phasePics.length})
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {phasePics.map(photo => (
                    <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-gray-100 aspect-video bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoSrc(photo)} alt={photo.caption ?? ''} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button onClick={() => setPreview(photo)} className="p-1.5 bg-white/90 rounded-lg hover:bg-white">
                          <ZoomIn className="w-3.5 h-3.5 text-gray-700" />
                        </button>
                        <button onClick={() => handleDelete(photo.id)} className="p-1.5 bg-white/90 rounded-lg hover:bg-white">
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                      {photo.caption && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-2 py-1 truncate">
                          {photo.caption}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreview(null)} className="absolute -top-10 right-0 text-white hover:text-gray-300">
              <X className="w-6 h-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(preview)} alt={preview.caption ?? ''} className="rounded-xl w-full object-contain max-h-[80vh]" />
            {preview.caption && (
              <p className="text-white text-center mt-2 text-sm">{preview.caption}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
