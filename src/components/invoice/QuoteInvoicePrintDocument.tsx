'use client'

/**
 * DOCUMENT D'IMPRESSION du DEVIS et de la FACTURE.
 *
 * ─── Pourquoi un document séparé ────────────────────────────────────────────
 * Le PDF était une CAPTURE de la modale d'édition (`#qimodal-print`). Trois
 * conséquences mesurées le 2026-08-11 sur la même facture :
 *   - la largeur capturée suivait l'écran (896 px sur poste, 358 px sur iPhone,
 *     328 px sur Android) : le PDF n'était pas le même document selon
 *     l'appareil, et sur téléphone il partait agrandi ×2,5 puis écrasé ;
 *   - en mode édition, le PDF embarquait les CHAMPS DE SAISIE, la corbeille de
 *     suppression de ligne, les boutons « + Pièce » et l'encart de marge
 *     interne — un document client montrant l'outil de travail du garage ;
 *   - le rendu dépendait du thème chargé (teintes Tailwind, variables CSS).
 *
 * ─── Règles de rendu ────────────────────────────────────────────────────────
 * Largeur FIXE (`A4_CONTENT_WIDTH_PX`) et STYLES INLINE en hexadécimal : aucune
 * classe utilitaire, aucune variable CSS, aucune couleur en alpha, aucune
 * requête média. Le document est donc identique sur poste, tablette et
 * téléphone, dans les quatre thèmes de l'application.
 *
 * Les montants sont reçus DÉJÀ CALCULÉS par l'appelant (lib/money, en centiers
 * exacts) : ce composant ne recalcule aucun total, il ne peut donc pas diverger
 * du document enregistré ni de la comptabilité.
 */

import { INK, INK_SOFT, INK_MUTED, RULE, RULE_LIGHT } from '@/lib/inspection/print-theme'
import { A4_CONTENT_WIDTH_PX, printLogoSrc } from '@/lib/pdf/render-a4'

export interface PrintGarage {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  siret?: string | null
  vatNumber?: string | null
  iban?: string | null
  bic?: string | null
  logoBase64?: string | null
  /** Logo stocké en fichier (garages antérieurs au stockage base64). */
  logoPath?: string | null
  invoiceFooter?: string | null
}

export interface PrintLine {
  description: string
  quantity: number
  unitPrice: number
  /** Total HT de la ligne, calculé par l'appelant (centimes exacts). */
  lineTotal: number
  isLabor: boolean
}

export interface QuoteInvoicePrintProps {
  mode: 'quote' | 'invoice'
  garage: PrintGarage | null
  /** Libellé du type de document, déjà traduit (« Devis » / « Facture »). */
  documentTitle: string
  documentNumber: string
  /** Date d'émission déjà formatée pour la langue courante. */
  issueDateLabel: string
  /** Seconde date : validité (devis) ou échéance (facture). Déjà formatée. */
  secondaryDateLabel?: string | null
  clientName: string
  clientEmail?: string | null
  clientPhone?: string | null
  clientAddress?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
  lines: PrintLine[]
  subtotalHT: number
  taxRate: number
  taxAmount: number
  totalTTC: number
  notes?: string | null
  /** Libellés traduits — le document ne connaît pas le dictionnaire. */
  labels: {
    client: string
    vehicle: string
    description: string
    quantity: string
    priceHT: string
    totalHT: string
    subtotalHT: string
    vat: string
    totalTTC: string
    notes: string
    labor: string
    siret: string
    vatNumber: string
    paymentTransfer: string
  }
}

/** Formatage monétaire stable : le document ne dépend pas de la locale du poste. */
function money(value: number): string {
  return `${value.toFixed(2)} €`
}

function Cell({ children, align = 'left', width, bold = false }: {
  children: React.ReactNode
  align?: 'left' | 'center' | 'right'
  width?: number
  bold?: boolean
}) {
  return (
    <td
      style={{
        padding: '6px 4px',
        textAlign: align,
        width,
        color: INK,
        fontSize: 11,
        fontWeight: bold ? 700 : 400,
        borderBottom: `1px solid ${RULE_LIGHT}`,
        verticalAlign: 'top',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </td>
  )
}

export function QuoteInvoicePrintDocument(props: QuoteInvoicePrintProps) {
  const { garage, labels, lines } = props
  const accent = props.mode === 'quote' ? '#1d4ed8' : '#047857'
  const logoSrc = printLogoSrc(garage)

  return (
    <div
      style={{
        width: A4_CONTENT_WIDTH_PX, // A4 à 96 dpi — largeur de rendu déterministe
        backgroundColor: '#ffffff',
        padding: 32,
        boxSizing: 'border-box',
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: INK,
      }}
    >
      {/* ── En-tête : garage à gauche, document à droite ───────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 0 }}>
          {logoSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" style={{ height: 44, width: 'auto', objectFit: 'contain', marginBottom: 6 }} />
          )}
          <div style={{ fontSize: 17, fontWeight: 700, color: INK }}>{garage?.name ?? '—'}</div>
          {garage?.address && <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 2 }}>{garage.address}</div>}
          {garage?.phone && <div style={{ fontSize: 11, color: INK_SOFT }}>{garage.phone}</div>}
          {garage?.email && <div style={{ fontSize: 11, color: INK_SOFT }}>{garage.email}</div>}
          {garage?.siret && <div style={{ fontSize: 10, color: INK_MUTED, marginTop: 3 }}>{labels.siret} {garage.siret}</div>}
          {garage?.vatNumber && <div style={{ fontSize: 10, color: INK_MUTED }}>{labels.vatNumber} {garage.vatNumber}</div>}
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 6,
              border: `1px solid ${accent}`, color: accent, fontWeight: 700, fontSize: 13,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}
          >
            {props.documentTitle}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: INK, marginTop: 6 }}>{props.documentNumber}</div>
          <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 4 }}>{props.issueDateLabel}</div>
          {props.secondaryDateLabel && (
            <div style={{ fontSize: 10, color: INK_MUTED, marginTop: 2 }}>{props.secondaryDateLabel}</div>
          )}
        </div>
      </div>

      {/* ── Client et véhicule ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
        <div style={{ flex: 1, border: `1px solid ${RULE}`, borderRadius: 6, padding: 10, minWidth: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: 0.6, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
            {labels.client}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, wordBreak: 'break-word' }}>{props.clientName || '—'}</div>
          {props.clientEmail && <div style={{ fontSize: 11, color: INK_SOFT, wordBreak: 'break-word' }}>{props.clientEmail}</div>}
          {props.clientPhone && <div style={{ fontSize: 11, color: INK_SOFT }}>{props.clientPhone}</div>}
          {props.clientAddress && <div style={{ fontSize: 11, color: INK_SOFT, wordBreak: 'break-word' }}>{props.clientAddress}</div>}
        </div>
        <div style={{ flex: 1, border: `1px solid ${RULE}`, borderRadius: 6, padding: 10, minWidth: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: 0.6, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
            {labels.vehicle}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, wordBreak: 'break-word' }}>
            {props.vehicleModel || '—'}
          </div>
          {props.licensePlate && (
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: 'Consolas, monospace', marginTop: 2 }}>
              {props.licensePlate}
            </div>
          )}
        </div>
      </div>

      {/* ── Lignes ─────────────────────────────────────────────────────────── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {[
              { text: labels.description, align: 'left' as const, width: undefined },
              { text: labels.quantity, align: 'center' as const, width: 60 },
              { text: labels.priceHT, align: 'right' as const, width: 95 },
              { text: labels.totalHT, align: 'right' as const, width: 95 },
            ].map((h) => (
              <th
                key={h.text}
                style={{
                  textAlign: h.align, width: h.width, padding: '6px 4px',
                  fontSize: 10, fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase',
                  letterSpacing: 0.4, borderBottom: `2px solid ${RULE}`,
                }}
              >
                {h.text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><Cell>—</Cell><Cell align="center">—</Cell><Cell align="right">—</Cell><Cell align="right">—</Cell></tr>
          ) : lines.map((line, i) => (
            <tr key={i}>
              <Cell>
                {line.isLabor && (
                  <span
                    style={{
                      display: 'inline-block', marginRight: 6, padding: '1px 5px', borderRadius: 3,
                      border: `1px solid ${RULE}`, fontSize: 9, fontWeight: 700, color: INK_MUTED,
                    }}
                  >
                    {labels.labor}
                  </span>
                )}
                {line.description || '—'}
              </Cell>
              <Cell align="center">{line.quantity}</Cell>
              <Cell align="right">{money(line.unitPrice)}</Cell>
              <Cell align="right" bold>{money(line.lineTotal)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totaux ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: INK_SOFT, padding: '3px 0' }}>
            <span>{labels.subtotalHT}</span>
            <span style={{ fontWeight: 600, color: INK }}>{money(props.subtotalHT)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: INK_SOFT, padding: '3px 0' }}>
            <span>{labels.vat} ({props.taxRate}%)</span>
            <span style={{ fontWeight: 600, color: INK }}>{money(props.taxAmount)}</span>
          </div>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              borderTop: `2px solid ${RULE}`, marginTop: 6, paddingTop: 6,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>{labels.totalTTC}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>{money(props.totalTTC)}</span>
          </div>
        </div>
      </div>

      {/* ── Notes et mentions ──────────────────────────────────────────────── */}
      {props.notes && (
        <div style={{ marginTop: 18, border: `1px solid ${RULE_LIGHT}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: 0.6, color: INK_MUTED, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
            {labels.notes}
          </div>
          <div style={{ fontSize: 11, color: INK_SOFT, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{props.notes}</div>
        </div>
      )}

      {garage?.iban && (
        <div style={{ marginTop: 16, paddingTop: 8, borderTop: `1px solid ${RULE_LIGHT}`, fontSize: 10, color: INK_MUTED, wordBreak: 'break-all' }}>
          <span style={{ fontWeight: 700, color: INK_SOFT }}>{labels.paymentTransfer} </span>
          IBAN {garage.iban}{garage.bic ? ` · BIC ${garage.bic}` : ''}
        </div>
      )}

      {garage?.invoiceFooter && (
        <div style={{ marginTop: 8, fontSize: 10, color: INK_MUTED, textAlign: 'center', wordBreak: 'break-word' }}>
          {garage.invoiceFooter}
        </div>
      )}
    </div>
  )
}

export default QuoteInvoicePrintDocument
