// Résumé du manifeste : NOMS et classes uniquement, jamais une valeur.
const m = require('/home/user/GarageFlowsV2/scripts/garageflow-env-manifest.json')
const parClasse = {}
for (const v of m.variables) (parClasse[v.classification] ??= []).push(v.name)
console.log(`Variables canoniques : ${m.variables.length} · alias interdits : ${Object.keys(m.forbiddenAliases || {}).length} · fournies par la plateforme : ${(m.platformProvided || []).length}`)
for (const [c, noms] of Object.entries(parClasse).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${c.padEnd(22)} ${String(noms.length).padStart(3)}  ex. ${noms.slice(0, 4).join(', ')}`)
