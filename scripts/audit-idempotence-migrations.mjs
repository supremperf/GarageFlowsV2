/**
 * Scan d'IDEMPOTENCE des migrations serveur en attente.
 *
 * PostgreSQL refuse `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` sur un objet
 * déjà présent, sauf `IF NOT EXISTS`. `ADD CONSTRAINT` n'a aucune forme
 * conditionnelle : il échoue toujours si la contrainte existe.
 *
 * Croisé avec l'audit d'état réel, ce scan dit AVANT de lancer `migrate deploy`
 * quelles migrations passeront, lesquelles buteront, et pourquoi.
 */
import fs from 'node:fs'
import path from 'node:path'

const sansCommentaires = (sql) =>
  sql.replace(/^[ \t]*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

const racine = 'prisma/server/migrations'
const cibles = process.argv.slice(2)
const dossiers = fs.readdirSync(racine)
  .filter((d) => fs.statSync(path.join(racine, d)).isDirectory())
  .filter((d) => cibles.length === 0 || cibles.includes(d))
  .sort()

for (const d of dossiers) {
  const sql = sansCommentaires(fs.readFileSync(path.join(racine, d, 'migration.sql'), 'utf8'))
  const risques = []

  for (const m of sql.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    if (!m[2]) risques.push(`ADD COLUMN sans IF NOT EXISTS : ${m[1]}.${m[3]}`)
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    if (!m[1]) risques.push(`CREATE TABLE sans IF NOT EXISTS : ${m[2]}`)
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    if (!m[1]) risques.push(`CREATE INDEX sans IF NOT EXISTS : ${m[2]}`)
  for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+"?(\w+)"?/gi))
    risques.push(`ADD CONSTRAINT (jamais conditionnel) : ${m[1]}`)

  // Un bloc DO $$ ... $$ gère souvent lui-même l'existence : on le signale.
  const bloc = /DO\s+\$\w*\$/.test(sql)

  console.log(`── ${d}`)
  if (risques.length === 0) console.log(`   IDEMPOTENTE${bloc ? ' (bloc DO conditionnel)' : ''}`)
  else {
    console.log(`   ${risques.length} instruction(s) non idempotente(s)${bloc ? ' + bloc DO' : ''}`)
    for (const r of risques.slice(0, 6)) console.log(`      ${r}`)
    if (risques.length > 6) console.log(`      … et ${risques.length - 6} autre(s)`)
  }
}
