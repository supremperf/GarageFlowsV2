/**
 * Export FEC (fichier des écritures comptables) — conformité (lot financier).
 *
 * Vérifie les correctifs de conformité :
 *   - le libellé de TVA reflète le taux RÉEL de la facture (plus figé à 20 %) ;
 *   - le nom de fichier suit la convention DGFiP <SIREN>FEC<AAAAMMJJ>.txt ;
 *   - chaque écriture est ÉQUILIBRÉE (total débit = total crédit) — invariant
 *     comptable fondamental ;
 *   - structure : en-tête présent, séparateur « | », fins de ligne CRLF.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const ctx = vi.hoisted(() => ({ role: "OWNER" as string }))
const data = vi.hoisted(() => ({ garage: null as any, invoices: [] as any[] }))

vi.mock("@/lib/api-helpers", () => ({
  requireSession: async () => ({ user: { id: "u1", role: ctx.role, garageId: "gA" } }),
  withAuth: (h: (req: unknown) => Promise<unknown>) =>
    async (req: unknown) => { try { return await h(req) } catch (e) { if (e instanceof Response) return e; throw e } },
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    garage: { findUnique: async () => data.garage },
    invoice: { findMany: async () => data.invoices },
  },
  isPostgresDatabase: () => false,
}))

import { GET } from "@/app/api/export/fec/route"

const scaled = (n: number) => Math.round(n * 10000)
function invoice(over: Record<string, unknown>) {
  return {
    number: "FAC-2026-001", clientName: "Dupont SARL", issueDate: "2026-03-15",
    status: "sent", taxRate: 20,
    lines: [{ quantityTenThousandths: scaled(1), unitPriceTenThousandths: scaled(100) }],
    ...over,
  }
}
const call = (year = 2026) => (GET as unknown as (r: Request) => Promise<Response>)(new Request(`http://localhost/api/export/fec?year=${year}`))

/** Regroupe les lignes FEC par EcritureNum et vérifie l'équilibre débit/crédit. */
function ecritureBalances(body: string): boolean {
  const lines = body.split("\r\n").slice(1).filter(Boolean)
  const sums = new Map<string, { d: number; c: number }>()
  for (const l of lines) {
    const f = l.split("|")
    const num = f[2]
    const debit = Number(f[11].replace(",", "."))
    const credit = Number(f[12].replace(",", "."))
    const s = sums.get(num) ?? { d: 0, c: 0 }
    s.d += debit; s.c += credit
    sums.set(num, s)
  }
  for (const v of Array.from(sums.values())) if (Math.abs(v.d - v.c) > 0.001) return false
  return true
}

beforeEach(() => { ctx.role = "OWNER"; data.garage = { siret: "12345678900011" }; data.invoices = [] })

describe("FEC — libellé de TVA au taux réel", () => {
  it("une facture à 10 % produit « TVA collectée 10 % », pas 20 %", async () => {
    data.invoices = [invoice({ taxRate: 10 })]
    const body = await (await call()).text()
    expect(body).toContain("TVA collectée 10 %")
    expect(body).not.toContain("TVA collectée 20 %")
  })
  it("une facture à 5,5 % produit « TVA collectée 5,5 % »", async () => {
    data.invoices = [invoice({ taxRate: 5.5 })]
    const body = await (await call()).text()
    expect(body).toContain("TVA collectée 5,5 %")
  })
})

describe("FEC — nom de fichier DGFiP <SIREN>FEC<AAAAMMJJ>.txt", () => {
  it("dérive le SIREN des 9 premiers chiffres du SIRET", async () => {
    data.invoices = [invoice({})]
    const res = await call(2026)
    expect(res.headers.get("Content-Disposition")).toContain('filename="123456789FEC20261231.txt"')
  })
})

describe("FEC — écritures équilibrées (débit = crédit)", () => {
  it("facture émise : l'écriture de vente s'équilibre", async () => {
    data.invoices = [invoice({ taxRate: 20 })] // HT 100, TVA 20, TTC 120
    const body = await (await call()).text()
    expect(ecritureBalances(body)).toBe(true)
  })
  it("facture payée : ventes ET banque s'équilibrent, à taux mixtes", async () => {
    data.invoices = [
      invoice({ number: "FAC-2026-001", taxRate: 20, status: "sent" }),
      invoice({ number: "FAC-2026-002", taxRate: 10, status: "paid",
        lines: [{ quantityTenThousandths: scaled(1), unitPriceTenThousandths: scaled(200) }] }),
    ]
    const body = await (await call()).text()
    expect(ecritureBalances(body)).toBe(true)
    // La facture payée génère aussi une écriture de banque (BQ).
    expect(body).toContain("|BQ")
  })
})

describe("FEC — structure & autorisation", () => {
  it("en-tête FEC présent, séparateur | et fins de ligne CRLF", async () => {
    data.invoices = [invoice({})]
    const body = await (await call()).text()
    expect(body.startsWith("JournalCode|JournalLib|EcritureNum|")).toBe(true)
    expect(body.includes("\r\n")).toBe(true)
  })
  it("RECEPTIONIST (sans financial:read) → 403", async () => {
    ctx.role = "RECEPTIONIST"
    expect((await call()).status).toBe(403)
  })
})
