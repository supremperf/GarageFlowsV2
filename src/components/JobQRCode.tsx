'use client'
import { useEffect, useState } from 'react'

interface Props {
  jobId: string
  size?: number
}

export function JobQRCode({ jobId, size = 120 }: Props) {
  const [svg,     setSvg]     = useState<string>('')
  const [portalUrl, setPortalUrl] = useState<string>('')

  useEffect(() => {
    async function load() {
      try {
        // Generate a 7-day portal JWT token for this job
        const res = await fetch('/api/portal/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ jobId }),
        })
        if (!res.ok) throw new Error('token failed')
        const { path } = await res.json()

        // Prefer local network IP (from Electron) for LAN-accessible QR; fall back to window.location.origin
        let base = window.location.origin
        const electronAPI = (window as any).electronAPI
        if (electronAPI?.getLocalIP) {
          const ip = await electronAPI.getLocalIP().catch(() => null)
          if (ip) base = `http://${ip}:${new URL(window.location.origin).port || 4028}`
        }

        const url = `${base}${path}`
        setPortalUrl(url)

        const QRCode = await import('qrcode')
        QRCode.toString(url, { type: 'svg', width: size, margin: 1 }, (err, svgStr) => {
          if (!err && svgStr) setSvg(svgStr)
        })
      } catch {
        // Fallback: internal job link
        const fallback = `${window.location.origin}/?job=${jobId}`
        setPortalUrl(fallback)
        const QRCode = await import('qrcode')
        QRCode.toString(fallback, { type: 'svg', width: size, margin: 1 }, (err, svgStr) => {
          if (!err && svgStr) setSvg(svgStr)
        })
      }
    }
    load()
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
// Export the portalUrl separately for the footer
export function usePortalUrl(jobId: string) {
  const [portalUrl, setPortalUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jobId }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(async data => {
        if (!data?.path) return
        let base = window.location.origin
        const electronAPI = (window as any).electronAPI
        if (electronAPI?.getLocalIP) {
          const ip = await electronAPI.getLocalIP().catch(() => null)
          if (ip) {
            const port = new URL(window.location.origin).port || '4028'
            base = `http://${ip}:${port}`
          }
        }
        setPortalUrl(`${base}${data.path}`)
      })
      .catch(() => setPortalUrl(`${window.location.origin}/?job=${jobId}`))
  }, [jobId])

  return portalUrl
}
