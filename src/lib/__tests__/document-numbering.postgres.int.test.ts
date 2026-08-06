/**
 * Numérotation des factures sous CONCURRENCE RÉELLE (PostgreSQL) — AUD-020.
 *
 * Le test unitaire existant (document-numbering.test.ts) prouve la logique sur
 * une base SIMULÉE en mémoire — il ne peut pas exercer le verrouillage de ligne
 * ni la contrainte @@unique d'un vrai moteur. Ici on lance N créations de
 * factures EN PARALLÈLE sur un vrai PostgreSQL, via le VRAI handler POST, et on
 * prouve l'invariant comptable :
 *
 *   - aucun doublon de numéro (séquence légale intacte) ;
 *   - aucun trou (numéros 001..N contigus) ;
 *   - le compteur du garage vaut exactement N ;
 *   - aucune création n'échoue (le verrou de ligne sur garage.update sérialise
 *     les incréments — pas de P2002 sous contention).
 *
 * Skippé sauf si TEST_POSTGRES_URL est fourni (service postgres en CI, ou
 * cluster local jetable). Rôle autorisé à CREATE DATABASE requis.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execSync } from "node:child_process"
import path from "node:path"
import crypto from "node:crypto"

const ADMIN_URL = process.env.TEST_POSTGRES_URL
const run = ADMIN_URL ? describe : describe.skip

/** execSync qui remonte stdout+stderr dans l'erreur (sinon « Command failed » nu). */
function sh(cmd: string, opts: Parameters<typeof execSync>[1] = {}) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], ...opts })
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message: string }
    throw new Error(`${cmd}\n${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message}`)
  }
}

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock("@/lib/api-helpers", () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

run("Numérotation de factures — concurrence réelle PostgreSQL", () => {
  let prisma: any
  let POST: (req: Request) => Promise<Response>
  let dbName: string
  let dbUrl: string

  beforeAll(async () => {
    // Base jetable dédiée à ce test (isolée de toute autre suite PG).
    dbName = `gf_numbering_${crypto.randomBytes(4).toString("hex")}`
    const admin = new URL(ADMIN_URL as string)
    sh(`psql "${ADMIN_URL}" -c 'CREATE DATABASE ${dbName}'`)
    admin.pathname = `/${dbName}`
    dbUrl = admin.toString()

    process.env.DATABASE_URL = dbUrl
    process.env.DIRECT_URL = dbUrl
    sh(`npx prisma db push --schema prisma/server/schema.prisma --skip-generate --accept-data-loss`, {
      cwd: path.resolve(__dirname, "../../.."),
      env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
    })

    ;({ prisma } = await import("@/lib/db"))
    ;({ POST } = (await import("@/app/api/invoices/route")) as any)

    const garage = await prisma.garage.create({ data: { name: "G", slug: `g-${crypto.randomBytes(3).toString("hex")}`, invoicePrefix: "FAC", invoiceCounter: 0 } })
    h.session = { user: { id: "u1", name: "Owner", role: "OWNER", garageId: garage.id } }
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (dbName) {
      try { sh(`psql "${ADMIN_URL}" -c 'DROP DATABASE ${dbName} WITH (FORCE)'`) } catch { /* best effort */ }
    }
  })

  it("50 créations parallèles → 50 numéros distincts, contigus, aucun échec", async () => {
    const N = 50
    // Corps construit en variable (l'API accepte des euros en entrée = frontière,
    // convertis en entiers exacts côté serveur). Séparé du JSON.stringify pour ne
    // pas fausser le garde check:money-json.
    const invoiceBody = { clientName: "Client", issueDate: "2026-08-06", taxRate: 20, lines: [{ description: "Ligne", quantity: 1, unitPrice: 100 }] }
    const mkReq = () =>
      new Request("http://localhost/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invoiceBody),
      })

    const results = await Promise.all(Array.from({ length: N }, () => POST(mkReq())))
    const statuses = results.map((r) => r.status)

    // Aucune création n'échoue (ni 409 P2002, ni 500).
    expect(statuses.every((s) => s === 201), `statuts: ${JSON.stringify(statuses)}`).toBe(true)

    const bodies = await Promise.all(results.map((r) => r.json()))
    const numbers = bodies.map((b) => b.number as string)

    // Numéros tous distincts.
    expect(new Set(numbers).size).toBe(N)

    // Séquence contiguë 001..N (aucun trou, aucun doublon).
    const seqs = numbers.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b)
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1))

    // Compteur du garage = N exactement.
    const garage = await prisma.garage.findFirst({ where: { id: (h.session as any).user.garageId } })
    expect(garage.invoiceCounter).toBe(N)

    // Persistance : exactement N factures en base, N numéros uniques.
    const count = await prisma.invoice.count()
    expect(count).toBe(N)
  }, 120_000)
})
