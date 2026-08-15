'use client'
import { useEffect, useState } from 'react'

/**
 * Lien portail client d'une intervention — UNE seule génération, et la vérité
 * sur son état.
 *
 * ─── Ce que faisait le code précédent ───────────────────────────────────────
 * Deux composants demandaient chacun leur lien : `<JobQRCode>` appelait
 * `/api/portal/generate` de son côté, et `usePortalUrl` l'appelait du sien.
 * Sur un poste installé, chaque appel PUBLIE l'instantané au cloud, et la
 * publication révoquait alors la précédente : des deux liens affichés côte à
 * côte — le QR code et le lien « copier » — un seul pouvait fonctionner.
 * D'où « Lien invalide ou expiré » sur un lien qui venait d'être créé.
 *
 * La cause profonde a été traitée côté serveur (la publication réemploie
 * désormais l'instantané vivant, cf. /api/sync/portal). On ne garde pas pour
 * autant deux requêtes là où une suffit : le QR code et le lien affichent
 * maintenant, par construction, EXACTEMENT la même URL.
 *
 * ─── Et quand la publication échoue ─────────────────────────────────────────
 * Le serveur renvoie `cloudPublished:false` — poste hors ligne, sans licence
 * garage, cloud injoignable. Le lien est alors syntaxiquement correct mais
 * illisible pour le client. Ce champ n'était lu par personne : l'interface
 * affichait un lien et un bouton « copier » comme si tout allait bien. Il est
 * désormais lu, et l'écran le dit.
 */

/** L'URL du portail est FOURNIE PAR LE SERVEUR (`src/lib/public-url.ts`).
 *  Elle n'est jamais construite ici : le code d'origine préférait l'IP LAN
 *  remontée par Electron puis `window.location.origin`, ce qui produisait des
 *  liens `http://192.168.x.x:4028/…` inutilisables hors de l'atelier. */
export type EtatLienPortail =
  /** Requête en cours. */
  | 'chargement'
  /** Lien publié et utilisable — il peut être remis au client. */
  | 'pret'
  /** Lien signé mais NON publié au cloud : le client verrait une page d'erreur. */
  | 'nonPublie'
  /** La génération elle-même a échoué. */
  | 'echec'

export interface LienPortail {
  etat: EtatLienPortail
  /** URL publique, présente dès que le serveur a répondu (même non publiée). */
  url: string | null
}

/**
 * Génère (ou republie) le lien portail de l'intervention — UNE fois par montage.
 *
 * Republier est sans danger : le serveur réemploie l'instantané vivant de
 * l'intervention, donc l'URL déjà remise au client reste la même et reste
 * valide.
 */
export function usePortalLink(jobId: string): LienPortail {
  const [lien, setLien] = useState<LienPortail>({ etat: 'chargement', url: null })

  useEffect(() => {
    let annule = false
    setLien({ etat: 'chargement', url: null })

    ;(async () => {
      try {
        const res = await fetch('/api/portal/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ jobId }),
        })
        if (annule) return
        if (!res.ok) { setLien({ etat: 'echec', url: null }); return }

        const data = await res.json()
        if (annule) return
        const url = typeof data?.url === 'string' && data.url ? data.url : null
        if (!url) { setLien({ etat: 'echec', url: null }); return }

        // `cloudPublished` absent ⇒ instance cloud : le lien est lisible là où
        // il pointe. Seul un `false` explicite signale une publication ratée.
        setLien({ etat: data?.cloudPublished === false ? 'nonPublie' : 'pret', url })
      } catch {
        if (!annule) setLien({ etat: 'echec', url: null })
      }
    })()

    return () => { annule = true }
  }, [jobId])

  return lien
}

/**
 * QR code d'une URL déjà obtenue — composant d'AFFICHAGE, sans requête.
 *
 * Il ne génère plus le lien lui-même : c'est ce qui produisait la seconde
 * publication concurrente.
 */
export function JobQRCode({ url, size = 120 }: { url: string | null; size?: number }) {
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let annule = false
    if (!url) { setSvg(''); return }
    ;(async () => {
      const QRCode = await import('qrcode')
      QRCode.toString(url, { type: 'svg', width: size, margin: 1 }, (err, svgStr) => {
        if (!annule && !err && svgStr) setSvg(svgStr)
      })
    })()
    return () => { annule = true }
  }, [url, size])

  if (!svg) return <div style={{ width: size, height: size }} className="bg-white/10 rounded animate-pulse" />
  return (
    <div
      className="bg-white rounded-lg p-1 inline-block"
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ width: size + 8, height: size + 8 }}
      title={url ?? undefined}
    />
  )
}

export { }
