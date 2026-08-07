/**
 * Décrément de stock sous CONCURRENCE RÉELLE (PostgreSQL) — AUD-021.
 *
 * Le test existant (stock-parts.test.ts) prouve la logique sur une base SIMULÉE
 * en mémoire (sérialisation mono-thread JS), pas le décrément conditionnel
 * atomique d'un vrai moteur. Ici : N ajouts de pièces EN PARALLÈLE via le VRAI
 * handler POST sur un vrai PostgreSQL, avec un stock volontairement insuffisant
 * pour tous. On prouve qu'AUCUN sur-décrément (survente) n'est possible :
 * exactement floor(stock/qty) succès, le reste en 409, stock final jamais négatif.
 *
 * Skippé sauf TEST_POSTGRES_URL fourni (service postgres CI ou cluster local).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execSync } from "node:child_process"
import path from "node:path"
import crypto from "node:crypto"

const ADMIN_URL = process.env.TEST_POSTGRES_URL
const run = ADMIN_URL ? describe : describe.skip

function sh(cmd: string, opts: Parameters<typeof execSync>[1] = {}) {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], ...opts }) }
  catch (e) { const err = e as { stdout?: Buffer; stderr?: Buffer; message: string }; throw new Error(`${cmd}\n${err.stdout}\n${err.stderr}\n${err.message}`) }
}

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock("@/lib/api-helpers", () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

run("Décrément de stock — concurrence réelle PostgreSQL", () => {
  let prisma: any
  let POST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
  let dbName = ""
  const ids = { garageId: "", jobId: "", partId: "" }

  beforeAll(async () => {
    dbName = `gf_stock_${crypto.randomBytes(4).toString("hex")}`
    const dbUrl = (ADMIN_URL as string).replace(/\/[^/]*$/, `/${dbName}`)
    sh(`psql "${ADMIN_URL}" -c 'CREATE DATABASE ${dbName}'`)
    process.env.DATABASE_URL = dbUrl; process.env.DIRECT_URL = dbUrl
    sh(`npx prisma db push --schema prisma/server/schema.prisma --skip-generate --accept-data-loss`, {
      cwd: path.resolve(__dirname, "../../.."), env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
    })
    ;({ prisma } = await import("@/lib/db"))
    ;({ POST } = (await import("@/app/api/jobs/[id]/parts/route")) as any)

    const g = await prisma.garage.create({ data: { name: "G", slug: `g-${crypto.randomBytes(3).toString("hex")}` } })
    const mech = await prisma.mechanic.create({ data: { name: "M", avatar: "", color: "#000", garageId: g.id } })
    const job = await prisma.job.create({ data: { customerName: "C", vehicleModel: "V", repairType: "R", estimatedDuration: 60, startTime: "09:00", date: "2026-08-07", mechanicId: mech.id, garageId: g.id } })
    const part = await prisma.part.create({ data: { name: "Filtre", garageId: g.id, quantity: 5 } })
    ids.garageId = g.id; ids.jobId = job.id; ids.partId = part.id
    h.session = { user: { id: "u1", role: "OWNER", garageId: g.id } }
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (dbName) { try { sh(`psql "${ADMIN_URL}" -c 'DROP DATABASE ${dbName} WITH (FORCE)'`) } catch { /* best effort */ } }
  })

  it("stock 5, 10 ajouts parallèles de 2 → 2 succès, 8 refus (409), stock final = 1, jamais négatif", async () => {
    const N = 10, QTY = 2
    const body = { partId: ids.partId, quantity: QTY }
    const mkReq = () => new Request(`http://localhost/api/jobs/${ids.jobId}/parts`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })
    const results = await Promise.all(Array.from({ length: N }, () => POST(mkReq(), { params: { id: ids.jobId } })))
    const statuses = results.map((r) => r.status)
    const ok = statuses.filter((s) => s === 201 || s === 200).length
    const conflict = statuses.filter((s) => s === 409).length

    expect(ok, `statuts: ${JSON.stringify(statuses)}`).toBe(2)       // floor(5/2) = 2
    expect(conflict).toBe(N - 2)
    const part = await prisma.part.findUnique({ where: { id: ids.partId } })
    expect(part.quantity).toBe(1)          // 5 - 2*2 = 1
    expect(part.quantity).toBeGreaterThanOrEqual(0)  // JAMAIS négatif (pas de survente)
  }, 120_000)
})
