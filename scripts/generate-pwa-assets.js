/*
 * PWA asset generator for GarageFlow.
 * Génère les icônes, icônes maskable, apple-touch-icon, favicons et les
 * splash screens iOS dans public/, ainsi que src/lib/pwaAssets.ts (table des
 * liens de splash iOS). Source vectorielle : icon.svg (rendu net à toute taille).
 *
 * Usage :  node scripts/generate-pwa-assets.js
 * Dépendance : sharp (déjà en devDependencies).
 */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '..')
const PUB = path.join(REPO, 'public')
const ICONS = path.join(PUB, 'icons')
const SPLASH = path.join(PUB, 'splash')
for (const d of [PUB, ICONS, SPLASH]) fs.mkdirSync(d, { recursive: true })

const BG = '#0f1629' // manifest background_color

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141b2b"/><stop offset="100%" stop-color="#05070d"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="38%" stop-color="#cbd5e1"/>
      <stop offset="62%" stop-color="#8b94a6"/><stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/><stop offset="55%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="gl" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#3b82f6" flood-opacity="0.65"/>
    </filter>
  </defs>`

const MARK = `
  <g filter="url(#sh)">
    <polygon points="50,12 82.9,31 82.9,69 50,88 17.1,69 17.1,31"
      fill="none" stroke="url(#metal)" stroke-width="8.5" stroke-linejoin="round"/>
    <line x1="82.9" y1="50" x2="58" y2="50"
      stroke="url(#metal)" stroke-width="8.5" stroke-linecap="round"/>
  </g>
  <polyline points="38,33 60,50 38,67"
    fill="none" stroke="url(#blue)" stroke-width="10"
    stroke-linecap="round" stroke-linejoin="round" filter="url(#gl)"/>`

const iconSvg = () => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  ${DEFS}
  <rect width="100" height="100" rx="24" fill="url(#bg)"/>
  ${MARK}
  <polygon points="50,12 82.9,31 50,20 17.1,31" fill="#ffffff" opacity="0.08"/>
</svg>`

const maskableSvg = () => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  ${DEFS}
  <rect width="100" height="100" fill="url(#bg)"/>
  <g transform="translate(50,50) scale(0.72) translate(-50,-50)">${MARK}</g>
</svg>`

const splashSvg = (w, h) => {
  const m = Math.round(Math.min(w, h) * 0.3)
  const x = Math.round((w - m) / 2)
  const y = Math.round((h - m) / 2)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${DEFS}
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <svg x="${x}" y="${y}" width="${m}" height="${m}" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="24" fill="url(#bg)"/>
    ${MARK}
  </svg>
</svg>`
}

async function main() {
  const iconBuf = Buffer.from(iconSvg())
  const maskBuf = Buffer.from(maskableSvg())

  const iconSizes = [72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512]
  for (const s of iconSizes) {
    await sharp(iconBuf, { density: 384 }).resize(s, s).png().toFile(path.join(ICONS, `icon-${s}.png`))
  }
  for (const s of [192, 512]) {
    await sharp(maskBuf, { density: 384 }).resize(s, s).png().toFile(path.join(ICONS, `maskable-${s}.png`))
  }
  await sharp(iconBuf, { density: 384 }).resize(180, 180).png().toFile(path.join(PUB, 'apple-touch-icon.png'))
  for (const s of [16, 32, 48]) {
    await sharp(iconBuf, { density: 384 }).resize(s, s).png().toFile(path.join(ICONS, `favicon-${s}.png`))
  }

  // [name, cssWidth, cssHeight, devicePixelRatio]
  const devices = [
    ['iphone-se', 320, 568, 2],
    ['iphone-8', 375, 667, 2],
    ['iphone-8-plus', 414, 736, 3],
    ['iphone-x', 375, 812, 3],
    ['iphone-xr', 414, 896, 2],
    ['iphone-xs-max', 414, 896, 3],
    ['iphone-12', 390, 844, 3],
    ['iphone-12-pro-max', 428, 926, 3],
    ['iphone-14-pro', 393, 852, 3],
    ['iphone-14-pro-max', 430, 932, 3],
    ['ipad-9-7', 768, 1024, 2],
    ['ipad-10-2', 810, 1080, 2],
    ['ipad-air-10-9', 820, 1180, 2],
    ['ipad-pro-11', 834, 1194, 2],
    ['ipad-pro-12-9', 1024, 1366, 2],
  ]

  const links = []
  for (const [name, cw, ch, r] of devices) {
    await sharp(Buffer.from(splashSvg(cw * r, ch * r))).png().toFile(path.join(SPLASH, `${name}-portrait.png`))
    links.push({
      url: `/splash/${name}-portrait.png`,
      media: `screen and (device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })
    await sharp(Buffer.from(splashSvg(ch * r, cw * r))).png().toFile(path.join(SPLASH, `${name}-landscape.png`))
    links.push({
      url: `/splash/${name}-landscape.png`,
      media: `screen and (device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: landscape)`,
    })
  }

  const ts = `// AUTO-GENERATED by scripts/generate-pwa-assets.js — do not edit by hand.
// iOS "apple-touch-startup-image" link table (portrait + landscape per device).
export type StartupImage = { url: string; media: string }

export const appleStartupImages: StartupImage[] = ${JSON.stringify(links, null, 2)}
`
  fs.writeFileSync(path.join(REPO, 'src/lib/pwaAssets.ts'), ts)
  console.log(`Generated ${iconSizes.length} icons, 2 maskable, 1 apple-touch, 3 favicons, ${links.length} splash images`)
}

main().catch((e) => { console.error(e); process.exit(1) })
