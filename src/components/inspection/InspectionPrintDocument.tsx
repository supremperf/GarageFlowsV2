'use client'

/**
 * DOCUMENT D'IMPRESSION du contrôle véhicule.
 *
 * ─── Pourquoi un document séparé ────────────────────────────────────────────
 * Le PDF était une CAPTURE de la modale interactive : champs de saisie, boutons,
 * en-têtes repliables. Trois conséquences :
 *   - les catégories REPLIÉES n'apparaissaient tout simplement pas dans le PDF ;
 *   - une fois l'inspection créée, le bloc client/véhicule disparaît de la
 *     modale — le PDF ne portait donc NI client, NI véhicule, NI immatriculation,
 *     NI kilométrage, NI date, NI garage ;
 *   - les teintes Tailwind `-50` (bg-emerald-50, bg-amber-50…) sont quasi
 *     blanches : d'où le rendu « extrêmement pâle » signalé.
 *
 * ─── Règles de rendu ────────────────────────────────────────────────────────
 * Tout est en STYLES INLINE avec des couleurs hexadécimales explicites : aucune
 * variable CSS, aucune classe utilitaire, aucune couleur en alpha (`rgba(…,.1)`),
 * aucune opacité. Le rendu est donc identique quels que soient le thème de
 * l'application, la feuille de styles chargée ou la luminosité du poste — et
 * html2canvas n'a aucune fonction CSS moderne à résoudre.
 *
 * L'état d'un point n'est JAMAIS porté par la seule couleur : chaque ligne porte
 * un pictogramme et un libellé écrit, donc reste lisible imprimée en noir et
 * blanc ou par une personne daltonienne.
 */

import {
  INK, INK_SOFT, INK_MUTED, RULE, RULE_LIGHT,
  STATUS_STYLES as STATUS, STATUS_ORDER as ORDER,
  type InspectionStatus,
} from '@/lib/inspection/print-theme'

export interface PrintItem {
  id: string
  category: string
  label: string
  status: InspectionStatus
  notes?: string | null
}

export interface PrintGarage {
  name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  logoBase64?: string | null
}

export interface InspectionPrintProps {
  garage: PrintGarage | null
  clientName: string
  vehicleModel: string
  licensePlate: string
  mileage: string
  notes: string
  items: PrintItem[]
  categoryLabel: (category: string) => string
  /** Date d'établissement (ISO ou lisible). */
  createdAt?: string | null
}

function formatDate(value?: string | null): string {
  if (!value) return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** Bandeau de synthèse : un compteur par état, lisible sans couleur. */
function Tally({ items }: { items: PrintItem[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {ORDER.map((key) => {
        const cfg = STATUS[key]
        const count = items.filter((i) => i.status === key).length
        return (
          <div
            key={key}
            style={{
              flex: 1, border: `1px solid ${RULE}`, borderRadius: 6,
              padding: '8px 10px', backgroundColor: '#ffffff', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: INK, lineHeight: 1.1 }}>{count}</div>
            <div style={{ fontSize: 10, color: INK_MUTED, marginTop: 2, fontWeight: 600 }}>
              {cfg.mark} {cfg.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: 0.6, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: INK, fontWeight: 600, marginTop: 2, wordBreak: 'break-word' }}>
        {value || '—'}
      </div>
    </div>
  )
}

export function InspectionPrintDocument({
  garage, clientName, vehicleModel, licensePlate, mileage, notes, items, categoryLabel, createdAt,
}: InspectionPrintProps) {
  // Toutes les catégories sont rendues, indépendamment de l'état replié/déplié
  // de la modale : un document ne dépend pas de la navigation de l'opérateur.
  const categories: string[] = []
  for (const item of items) if (!categories.includes(item.category)) categories.push(item.category)

  const critical = items.filter((i) => i.status === 'critical')

  return (
    <div
      style={{
        width: 794,                    // A4 à 96 dpi — largeur de rendu déterministe
        backgroundColor: '#ffffff',
        color: INK,
        padding: 32,
        boxSizing: 'border-box',
        fontFamily: 'Arial, Helvetica, sans-serif',
        // `-webkit-print-color-adjust` force l'impression des aplats : sans lui,
        // les navigateurs suppriment les fonds à l'impression et les bandeaux
        // d'état disparaissent.
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {/* En-tête garage */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, borderBottom: `2px solid ${INK}`, paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {garage?.logoBase64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={garage.logoBase64} alt="" style={{ height: 44, width: 'auto', objectFit: 'contain' }} />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: INK }}>{garage?.name || 'Garage'}</div>
            <div style={{ fontSize: 10, color: INK_SOFT, marginTop: 2 }}>
              {[garage?.address, garage?.phone, garage?.email].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: 0.5 }}>CONTRÔLE VÉHICULE</div>
          <div style={{ fontSize: 10, color: INK_SOFT, marginTop: 2 }}>Établi le {formatDate(createdAt)}</div>
        </div>
      </div>

      {/* Identification — ces champs manquaient totalement du PDF */}
      <div style={{ display: 'flex', gap: 20, padding: '12px 0', borderBottom: `1px solid ${RULE_LIGHT}`, marginBottom: 16 }}>
        <div style={{ flex: 1 }}><Field label="Client" value={clientName} /></div>
        <div style={{ flex: 1 }}><Field label="Véhicule" value={vehicleModel} /></div>
        <div style={{ flex: 1 }}><Field label="Immatriculation" value={licensePlate} /></div>
        <div style={{ flex: 1 }}><Field label="Kilométrage" value={mileage ? `${mileage} km` : ''} /></div>
      </div>

      <Tally items={items} />

      {/* Points critiques mis en avant */}
      {critical.length > 0 && (
        <div style={{ border: `2px solid ${STATUS.critical.color}`, borderRadius: 6, padding: 12, marginBottom: 16, backgroundColor: '#ffffff' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: STATUS.critical.color, marginBottom: 6 }}>
            ✖ {critical.length} point{critical.length > 1 ? 's' : ''} critique{critical.length > 1 ? 's' : ''} — intervention recommandée sans délai
          </div>
          {critical.map((item) => (
            <div key={item.id} style={{ fontSize: 11, color: INK, marginTop: 3 }}>
              • {item.label}
              {item.notes ? <span style={{ color: INK_SOFT }}> — {item.notes}</span> : null}
            </div>
          ))}
        </div>
      )}

      {/* Détail par catégorie */}
      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category === cat)
        return (
          // `break-inside: avoid` garde une catégorie d'un seul tenant quand le
          // document est imprimé directement depuis le navigateur.
          <div key={cat} style={{ marginBottom: 14, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <div
              style={{
                fontSize: 12, fontWeight: 700, color: INK, backgroundColor: '#f3f4f6',
                border: `1px solid ${RULE}`, borderRadius: '4px 4px 0 0',
                padding: '6px 10px', textTransform: 'uppercase', letterSpacing: 0.4,
              }}
            >
              {categoryLabel(cat)}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${RULE}`, borderTop: 'none' }}>
              <tbody>
                {catItems.map((item, idx) => {
                  const cfg = STATUS[item.status]
                  return (
                    <tr key={item.id} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                      {/* Bande d'état : repère visuel, doublé du texte ci-contre */}
                      <td style={{ width: 6, backgroundColor: cfg.band, borderRight: `1px solid ${RULE_LIGHT}`, padding: 0 }} />
                      <td style={{ padding: '6px 10px', fontSize: 11, color: INK, borderBottom: `1px solid ${RULE_LIGHT}` }}>
                        {item.label}
                        {item.notes ? (
                          <div style={{ fontSize: 10, color: INK_SOFT, marginTop: 2 }}>{item.notes}</div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: '6px 10px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                          color: cfg.color, textAlign: 'right', width: 110,
                          borderBottom: `1px solid ${RULE_LIGHT}`,
                        }}
                      >
                        {cfg.mark} {cfg.label}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {notes ? (
        <div style={{ marginTop: 8, border: `1px solid ${RULE}`, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 9, letterSpacing: 0.6, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
            Observations
          </div>
          <div style={{ fontSize: 11, color: INK, whiteSpace: 'pre-wrap' }}>{notes}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ fontSize: 9, color: INK_MUTED, maxWidth: 380, lineHeight: 1.5 }}>
          Ce contrôle porte sur les points listés ci-dessus, constatés à la date d’établissement
          et pour le kilométrage indiqué. Il ne vaut pas contrôle technique réglementaire.
        </div>
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 26 }}>
            Signature du garage
          </div>
          <div style={{ borderTop: `1px solid ${RULE}` }} />
        </div>
      </div>
    </div>
  )
}
