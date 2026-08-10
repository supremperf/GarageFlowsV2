'use client'
import { useEffect, useState } from 'react'

interface Props {
  jobId: string
  size?: number
}

/**
 * L'URL du portail client est FOURNIE PAR LE SERVEUR (`url` renvoyé par
 * /api/portal/generate, calculé via `src/lib/public-url.ts`).
 *
 * Elle n'est plus construite ici : le code précédent préférait l'IP LAN
 * remontée par Electron (`electronAPI.getLocalIP()`) et retombait sur
 * `window.location.origin`, ce qui produisait des liens
 * `http://192.168.x.x:4028/portal/…` ou `http://localhost:4028/portal/…`
 * remis tels quels au client du garage — inutilisables hors du réseau de
 * l'atelier. Le jeton signé, lui, est identique : seul le domaine change.
 */
async function fetchPortalUrl(jobId: string): Promise<string | null> {
  const res = await fetch('/api/portal/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jobId }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return typeof data?.url === 'string' && data.url ? data.url : null
}

export function JobQRCode({ jobId, size = 120 }: Props) {
  const [svg,       setSvg]       = useState<string>('')
  const [portalUrl, setPortalUrl] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const url = await fetchPortalUrl(jobId).catch(() => null)
      if (cancelled || !url) return
      setPortalUrl(url)
      const QRCode = await import('qrcode')
      QRCode.toString(url, { type: 'svg', width: size, margin: 1 }, (err, svgStr) => {
        if (!cancelled && !err && svgStr) setSvg(svgStr)
      })
    }
    load()
    return () => { cancelled = true }
  }, [jobId, size])

  if (!svg) return <div style={{ width: size, height: size }} className="bg-white/10 rounded animate-pulse" />
  return (
    <div
      className="bg-white rounded-lg p-1 inline-block cursor-pointer"
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ width: size + 8, height: size + 8 }}
      title={portalUrl}
    />
  )
}

export { }

/** URL publique du portail client pour cette intervention (ou null si indispo). */
export function usePortalUrl(jobId: string) {
  const [portalUrl, setPortalUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPortalUrl(jobId)
      .then(url => { if (!cancelled && url) setPortalUrl(url) })
      .catch(() => { /* lien indisponible : l'UI affiche « génération… » */ })
    return () => { cancelled = true }
  }, [jobId])

  return portalUrl
}
