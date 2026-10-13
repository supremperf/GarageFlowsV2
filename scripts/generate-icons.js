#!/usr/bin/env node
/**
 * GarageFlows icon generator
 * Creates icon.png (512x512) from the app's SVG logo, then wraps it as icon.ico
 * Requires: npm install --save-dev sharp png2icons
 */

'use strict'

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

// ── GarageFlows logo SVG ──────────────────────────────────────────────────────
// Canvas 512×512 — fond sombre, hexagone métallique « G », flèche bleue « Flow »
const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141b2b"/>
      <stop offset="100%" stop-color="#05070d"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="38%" stop-color="#cbd5e1"/>
      <stop offset="62%" stop-color="#8b94a6"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="55%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="gl" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#3b82f6" flood-opacity="0.65"/>
    </filter>
  </defs>

  <rect width="100" height="100" rx="24" fill="url(#bg)"/>

  <g filter="url(#sh)">
    <polygon points="50,12 82.9,31 82.9,69 50,88 17.1,69 17.1,31"
      fill="none" stroke="url(#metal)" stroke-width="8.5" stroke-linejoin="round"/>
    <line x1="82.9" y1="50" x2="58" y2="50"
      stroke="url(#metal)" stroke-width="8.5" stroke-linecap="round"/>
  </g>

  <polyline points="38,33 60,50 38,67"
    fill="none" stroke="url(#blue)" stroke-width="10"
    stroke-linecap="round" stroke-linejoin="round" filter="url(#gl)"/>

  <polygon points="50,12 82.9,31 50,20 17.1,31" fill="#ffffff" opacity="0.08"/>
</svg>`

async function main() {
  console.log('\n🎨 GarageFlows icon generator\n')

  // Write SVG
  const svgPath = path.join(ROOT, 'icon.svg')
  fs.writeFileSync(svgPath, LOGO_SVG, 'utf8')
  console.log('  ✅ icon.svg written')

  // Try to use sharp for high-quality PNG generation
  try {
    const sharp = require('sharp')

    const pngPath = path.join(ROOT, 'icon.png')
    await sharp(Buffer.from(LOGO_SVG))
      .resize(512, 512)
      .png()
      .toFile(pngPath)
    console.log('  ✅ icon.png created (512×512) via sharp')

    // Create all standard Windows icon sizes (taskbar uses 16, 24, 32, 40, 48)
    const sizes = [256, 128, 64, 48, 40, 32, 24, 16]
    const pngBuffers = await Promise.all(
      sizes.map(size =>
        sharp(Buffer.from(LOGO_SVG)).resize(size, size).png().toBuffer()
      )
    )

    // Build ICO file using PNG containers (Vista+ compatible)
    const ico = buildIco(pngBuffers, sizes)
    const icoPath = path.join(ROOT, 'icon.ico')
    fs.writeFileSync(icoPath, ico)
    console.log('  ✅ icon.ico created with', sizes.join(', '), 'px sizes')

  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('  ⚠  sharp not installed — generating minimal icon.ico')
      console.warn('     To get full quality: npm install --save-dev sharp')
      generateMinimalIco()
    } else {
      console.error('  ❌ Error:', err.message)
    }
  }

  console.log('\n🎉 Icons ready!\n')
}

/**
 * Build an ICO file from an array of PNG buffers.
 * Uses PNG inside ICO (Vista+ format, no BMP conversion needed).
 */
function buildIco(pngBuffers, sizes) {
  const count       = pngBuffers.length
  const headerSize  = 6               // ICONDIR
  const entrySize   = 16              // ICONDIRENTRY each
  const dataOffset  = headerSize + entrySize * count

  // Calculate total size
  let totalSize = dataOffset
  for (const buf of pngBuffers) totalSize += buf.length

  const result = Buffer.alloc(totalSize)
  let pos = 0

  // ICONDIR
  result.writeUInt16LE(0, pos);     pos += 2  // reserved
  result.writeUInt16LE(1, pos);     pos += 2  // type = ICO
  result.writeUInt16LE(count, pos); pos += 2  // number of images

  // Image data offset (after all entries) — must increment INSIDE map to get unique offsets
  let imgOffset = dataOffset
  const entries = pngBuffers.map((buf, i) => {
    const e = { size: sizes[i], buf, offset: imgOffset, len: buf.length }
    imgOffset += buf.length
    return e
  })

  // ICONDIRENTRY for each image
  let entryOffset = dataOffset
  for (const { size, len, offset } of entries) {
    const s = size >= 256 ? 0 : size  // 0 means 256 in ICO format
    result.writeUInt8(s, pos);              pos += 1  // width
    result.writeUInt8(s, pos);              pos += 1  // height
    result.writeUInt8(0, pos);              pos += 1  // color count
    result.writeUInt8(0, pos);              pos += 1  // reserved
    result.writeUInt16LE(0, pos);           pos += 2  // planes
    result.writeUInt16LE(32, pos);          pos += 2  // bit count
    result.writeUInt32LE(len, pos);         pos += 4  // image data size
    result.writeUInt32LE(offset, pos);      pos += 4  // image data offset
  }

  // Write PNG data
  for (const { buf } of entries) {
    buf.copy(result, pos)
    pos += buf.length
  }

  return result
}

/**
 * Fallback: generate a very simple 32×32 ICO with a blue background.
 * Used when sharp is not available.
 */
function generateMinimalIco() {
  // A 32×32 BMP inside an ICO - simple blue circle
  const SIZE = 32
  const bmpHeaderSize = 40
  const pixelDataSize = SIZE * SIZE * 4
  const maskSize      = SIZE * SIZE / 8
  const bmpSize       = bmpHeaderSize + pixelDataSize + maskSize

  const ico = Buffer.alloc(6 + 16 + bmpSize, 0)
  let pos = 0

  // ICONDIR
  ico.writeUInt16LE(0, pos);   pos += 2
  ico.writeUInt16LE(1, pos);   pos += 2
  ico.writeUInt16LE(1, pos);   pos += 2

  // ICONDIRENTRY
  ico.writeUInt8(SIZE, pos);   pos += 1  // width
  ico.writeUInt8(SIZE, pos);   pos += 1  // height
  ico.writeUInt8(0, pos);      pos += 1
  ico.writeUInt8(0, pos);      pos += 1
  ico.writeUInt16LE(1, pos);   pos += 2
  ico.writeUInt16LE(32, pos);  pos += 2
  ico.writeUInt32LE(bmpSize, pos); pos += 4
  ico.writeUInt32LE(22, pos);  pos += 4  // 6 + 16 = 22

  // BITMAPINFOHEADER
  ico.writeUInt32LE(bmpHeaderSize, pos);  pos += 4
  ico.writeInt32LE(SIZE, pos);            pos += 4
  ico.writeInt32LE(SIZE * 2, pos);        pos += 4  // height × 2 for ICO
  ico.writeUInt16LE(1, pos);              pos += 2
  ico.writeUInt16LE(32, pos);             pos += 2
  ico.writeUInt32LE(0, pos);              pos += 4
  ico.writeUInt32LE(pixelDataSize, pos);  pos += 4
  ico.writeInt32LE(0, pos);              pos += 4
  ico.writeInt32LE(0, pos);              pos += 4
  ico.writeUInt32LE(0, pos);             pos += 4
  ico.writeUInt32LE(0, pos);             pos += 4

  // Pixel data (BGRA, bottom-up)
  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dy = y - cy, dx = x - cx
      const inCircle = dx*dx + dy*dy <= r*r
      // Navy background, blue circle
      const B = inCircle ? 0xEB : 0x29
      const G = inCircle ? 0x82 : 0x18
      const R = inCircle ? 0x3B : 0x0F
      const A = 0xFF
      ico.writeUInt8(B, pos); pos++
      ico.writeUInt8(G, pos); pos++
      ico.writeUInt8(R, pos); pos++
      ico.writeUInt8(A, pos); pos++
    }
  }
  // AND mask (all zeros = fully opaque)
  // already zeroed

  fs.writeFileSync(path.join(ROOT, 'icon.ico'), ico)
  console.log('  ✅ icon.ico created (32×32 minimal fallback)')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
