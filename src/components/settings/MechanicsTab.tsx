'use client'

import { cn } from '@/lib/utils'
import { Save, Plus, Trash2, Edit2, Loader2, Check, Palette } from 'lucide-react'
import type { MechanicRecord } from './types'

export const MECHANIC_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a855f7', '#ef4444',
]

export const SPECIALTIES = [
  'distribution', 'embrayage', 'suspension', 'freins', 'pneus',
  'diagnostics', 'climatisation', 'révision', 'carrosserie', 'échappement',
  'électricité', 'boîte de vitesse', 'moteur', 'batterie',
]

interface NewMechState { name: string; color: string; specialty: string[] }

interface Props {
  mechanics: MechanicRecord[]
  mechLoading: boolean
  editingMech: MechanicRecord | null
  setEditingMech: (m: MechanicRecord | null) => void
  newMech: NewMechState
  setNewMech: React.Dispatch<React.SetStateAction<NewMechState>>
  showAddForm: boolean
  setShowAddForm: React.Dispatch<React.SetStateAction<boolean>>
  onAdd: () => void
  onUpdate: () => void
  onDelete: (id: string, name: string) => void
}

function toggleSpecialty(arr: string[], sp: string): string[] {
  return arr.includes(sp) ? arr.filter(x => x !== sp) : [...arr, sp]
}

export function MechanicsTab({
  mechanics, mechLoading,
  editingMech, setEditingMech,
  newMech, setNewMech,
  showAddForm, setShowAddForm,
  onAdd, onUpdate, onDelete,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Équipe mécaniciens</p>
          <p className="text-xs text-slate-500">
            {mechanics.length} mécanicien{mechanics.length !== 1 ? 's' : ''} configuré{mechanics.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(v => !v); setEditingMech(null) }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter
        </button>
      </div>

      {showAddForm && (
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Nouveau mécanicien</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nom complet *</label>
            <input
              value={newMech.name}
              onChange={e => setNewMech(p => ({ ...p, name: e.target.value }))}
              placeholder="ex: Thomas Bernard"
              className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-2 flex items-center gap-1">
              <Palette className="w-3 h-3" /> Couleur
            </label>
            <div className="flex gap-2 flex-wrap">
              {MECHANIC_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewMech(p => ({ ...p, color: c }))}
                  className={cn('w-7 h-7 rounded-full border-2 transition-all', newMech.color === c ? 'border-white scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-2">Spécialités</label>
            <div className="flex flex-wrap gap-1.5">
              {SPECIALTIES.map(sp => (
                <button
                  key={sp}
                  onClick={() => setNewMech(p => ({ ...p, specialty: toggleSpecialty(p.specialty, sp) }))}
                  className={cn(
                    'px-2 py-1 rounded-full text-[10px] font-medium border transition-all',
                    newMech.specialty.includes(sp)
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-white/20'
                  )}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onAdd}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors">
              <Check className="w-3.5 h-3.5" />
              Confirmer
            </button>
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-lg border border-white/10 text-slate-400 text-xs hover:bg-white/[0.05] transition-colors">
              Annuler
            </button>
          </div>
        </div>
      )}

      {mechLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        </div>
      ) : mechanics.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">
          Aucun mécanicien configuré
        </div>
      ) : (
        <div className="space-y-2">
          {mechanics.map(m => {
            const isEditing = editingMech?.id === m.id
            const specs = (() => { try { return JSON.parse(m.specialty) as string[] } catch { return [] } })()

            if (isEditing && editingMech) {
              const editSpecs = (() => { try { return JSON.parse(editingMech.specialty) as string[] } catch { return [] } })()
              return (
                <div key={m.id} className="bg-white/[0.04] border border-blue-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Modifier</p>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Nom</label>
                    <input
                      value={editingMech.name}
                      onChange={e => setEditingMech({ ...editingMech, name: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2 flex items-center gap-1">
                      <Palette className="w-3 h-3" /> Couleur
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {MECHANIC_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditingMech({ ...editingMech, color: c })}
                          className={cn('w-7 h-7 rounded-full border-2 transition-all', editingMech.color === c ? 'border-white scale-110' : 'border-transparent')}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">Spécialités</label>
                    <div className="flex flex-wrap gap-1.5">
                      {SPECIALTIES.map(sp => (
                        <button
                          key={sp}
                          onClick={() => setEditingMech({ ...editingMech, specialty: JSON.stringify(toggleSpecialty(editSpecs, sp)) })}
                          className={cn(
                            'px-2 py-1 rounded-full text-[10px] font-medium border transition-all',
                            editSpecs.includes(sp)
                              ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                              : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-white/20'
                          )}
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={onUpdate}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors">
                      <Save className="w-3.5 h-3.5" />Enregistrer
                    </button>
                    <button onClick={() => setEditingMech(null)}
                      className="px-4 py-2 rounded-lg border border-white/10 text-slate-400 text-xs hover:bg-white/[0.05] transition-colors">
                      Annuler
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:border-white/10 transition-colors">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-md"
                  style={{ backgroundColor: m.color }}
                >
                  {m.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{m.name}</p>
                  {specs.length > 0 && (
                    <p className="text-xs text-slate-500 truncate">{specs.join(', ')}</p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setEditingMech(m); setShowAddForm(false) }}
                    className="p-1.5 rounded-lg hover:bg-blue-500/15 text-slate-500 hover:text-blue-400 transition-colors"
                    title="Modifier"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(m.id, m.name)}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
        Les modifications des mécaniciens sont appliquées immédiatement dans le planning.
      </div>
    </div>
  )
}
