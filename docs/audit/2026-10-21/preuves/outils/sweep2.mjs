// Appelle CHAQUE méthode exportée des 169 routes, SANS cookie ni en-tête d'authentification.
import fs from 'node:fs'; import path from 'node:path'
const racine = '/home/user/GarageFlowsV2/src/app/api'; const fichiers = []
;(function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__tests__') parcourir(p) } else if (e.name === 'route.ts') fichiers.push(p) } })(racine)
const res = []
for (const f of fichiers) {
  const src = fs.readFileSync(f, 'utf8')
  const methodes = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(m => m[1]))
  const url = '/' + path.relative('/home/user/GarageFlowsV2/src/app', path.dirname(f)).split(path.sep).map(s => s.startsWith('[') ? (s.includes('...') ? 'x' : 'clxxxxxxxxxxxxxxxxxxxxxxx') : s).join('/')
  for (const m of methodes) {
    const r = await fetch('http://127.0.0.1:3123' + url, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' || m === 'DELETE' ? undefined : '{}', redirect: 'manual' })
    res.push([r.status, m, url])
  }
}
const parCode = {}; for (const [c] of res) parCode[c] = (parCode[c] || 0) + 1
console.log(`Routes : ${fichiers.length} · couples méthode × route appelés sans authentification : ${res.length}`)
console.log('Répartition des codes HTTP :', Object.entries(parCode).map(([c, n]) => `${c} × ${n}`).join(' · '))
console.log('\nRéponses 2xx/3xx (doivent être publiques par conception) :')
for (const [c, m, u] of res.filter(r => r[0] < 400)) console.log(`  ${c} ${m.padEnd(6)} ${u}`)
console.log('\nRéponses 500 (configuration absente en dev → refus fail-closed) :')
for (const [c, m, u] of res.filter(r => r[0] >= 500)) console.log(`  ${c} ${m.padEnd(6)} ${u}`)
