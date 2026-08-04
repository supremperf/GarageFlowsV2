export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'

// GET /api/export/fec?year=2026
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  // §Autorisation — export comptable FEC (donnée légale sensible) réservé à financial:read.
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const [garage, invoices] = await Promise.all([
    prisma.garage.findUnique({ where: { id: session.user.garageId } }),
    prisma.invoice.findMany({
      where: {
        garageId: session.user.garageId,
        issueDate: { gte: `${year}-01-01`, lte: `${year}-12-31` },
        status: { not: 'draft' },
      },
      include: { lines: true },
      orderBy: { issueDate: 'asc' },
    }),
  ])

  // Build FEC lines
  const header = 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise'

  const rows: string[] = [header]
  let veSeq = 0
  let bqSeq = 0

  function fmt(n: number) { return n.toFixed(2).replace('.', ',') }
  function fmtDate(d: string) { return d.replace(/-/g, '') }
  function clientCode(name: string) {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17).padEnd(1, 'X') || 'CLIENT'
  }
  function row(fields: (string | number)[]) {
    return fields.map(String).join('|')
  }

  for (const inv of invoices) {
    const ht  = roundCents(calcTotalHT(inv.lines))
    const ttc = roundCents(calcTotalTTC(inv.lines, inv.taxRate))
    const tva = roundCents(ttc - ht)
    const ecritureDate = fmtDate(inv.issueDate)
    const pieceDate    = fmtDate(inv.issueDate)
    const lib          = `${inv.number} - ${inv.clientName.slice(0, 30)}`
    const auxNum       = clientCode(inv.clientName)
    const auxLib       = inv.clientName.slice(0, 30)

    veSeq++
    const veNum = `VE${String(veSeq).padStart(4, '0')}`

    // 706 — revenue (HT)
    rows.push(row(['VE','Ventes',veNum,ecritureDate,'706000','Prestations de services','','',inv.number,pieceDate,lib,'0,00',fmt(ht),'','','','','']))
    // 44571 — TVA collectée
    if (tva > 0) {
      rows.push(row(['VE','Ventes',veNum,ecritureDate,'445710','TVA collectée 20%','','',inv.number,pieceDate,lib,'0,00',fmt(tva),'','','','','']))
    }
    // 411 — client receivable
    rows.push(row(['VE','Ventes',veNum,ecritureDate,'411000','Clients',auxNum,auxLib,inv.number,pieceDate,lib,fmt(ttc),'0,00','','','','','']))

    // If paid — bank entry
    if (inv.status === 'paid') {
      bqSeq++
      const bqNum = `BQ${String(bqSeq).padStart(4, '0')}`
      rows.push(row(['BQ','Banque',bqNum,ecritureDate,'512000','Banque','','',inv.number,pieceDate,lib,fmt(ttc),'0,00','','','','','']))
      rows.push(row(['BQ','Banque',bqNum,ecritureDate,'411000','Clients',auxNum,auxLib,inv.number,pieceDate,lib,'0,00',fmt(ttc),'','','','','']))
    }
  }

  const filename = `FEC_${garage?.siret ?? 'GARAGE'}_${year}.txt`
  const body = rows.join('\r\n')  // FEC uses CRLF

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
