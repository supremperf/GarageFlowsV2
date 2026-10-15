export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { linesToEuros } from '@/lib/money-db'

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
        // `Invoice.status` vaut draft | sent | paid | overdue | cancelled.
        // Exclure le seul brouillon laissait les factures ANNULÉES produire des
        // écritures de vente (706) et de TVA collectée (445710) : le FEC remis à
        // l'administration surdéclarait alors le chiffre d'affaires ET la TVA
        // (GF31-AUD-014). Une facture annulée ne constate aucun produit.
        status: { notIn: ['draft', 'cancelled'] },
      },
      include: { lines: true },
      orderBy: { issueDate: 'asc' },
      // Entiers exacts → vue euros pour le calcul FEC (mêmes nombres qu'avant migration).
    }).then(rows => rows.map(i => ({ ...i, lines: linesToEuros(i.lines) }))),
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
  // Neutralise les champs TEXTE libres (nom client, n° de pièce) provenant de la
  // saisie utilisateur — JAMAIS les montants/dates/n° de compte, générés par le
  // programme. Deux menaces :
  //  1. Corruption du fichier délimité : un « | » ou un retour ligne dans un
  //     libellé injecterait des colonnes / des écritures fantômes dans le FEC.
  //  2. Injection de formule tableur : un libellé débutant par = + - @ (ou tab)
  //     s'exécute à l'ouverture du .txt dans Excel/LibreOffice.
  function fecText(s: string) {
    let t = s.replace(/[|\r\n\t]+/g, ' ').trim()
    if (/^[=+\-@]/.test(t)) t = `'${t}`
    return t
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
    const safeNumber   = fecText(inv.number)
    const lib          = fecText(`${inv.number} - ${inv.clientName.slice(0, 30)}`)
    const auxNum       = clientCode(inv.clientName)
    const auxLib       = fecText(inv.clientName.slice(0, 30))

    veSeq++
    const veNum = `VE${String(veSeq).padStart(4, '0')}`

    // 706 — revenue (HT)
    rows.push(row(['VE','Ventes',veNum,ecritureDate,'706000','Prestations de services','','',safeNumber,pieceDate,lib,'0,00',fmt(ht),'','','','','']))
    // 44571 — TVA collectée (libellé au taux RÉEL de la facture, pas figé à 20 %)
    if (tva > 0) {
      const rateLabel = `TVA collectée ${String(inv.taxRate).replace('.', ',')} %`
      rows.push(row(['VE','Ventes',veNum,ecritureDate,'445710',rateLabel,'','',safeNumber,pieceDate,lib,'0,00',fmt(tva),'','','','','']))
    }
    // 411 — client receivable
    rows.push(row(['VE','Ventes',veNum,ecritureDate,'411000','Clients',auxNum,auxLib,safeNumber,pieceDate,lib,fmt(ttc),'0,00','','','','','']))

    // If paid — bank entry
    if (inv.status === 'paid') {
      bqSeq++
      const bqNum = `BQ${String(bqSeq).padStart(4, '0')}`
      rows.push(row(['BQ','Banque',bqNum,ecritureDate,'512000','Banque','','',safeNumber,pieceDate,lib,fmt(ttc),'0,00','','','','','']))
      rows.push(row(['BQ','Banque',bqNum,ecritureDate,'411000','Clients',auxNum,auxLib,safeNumber,pieceDate,lib,'0,00',fmt(ttc),'','','','','']))
    }
  }

  // Nom de fichier selon la convention DGFiP : <SIREN>FEC<AAAAMMJJ>.txt, où la
  // date est la clôture de l'exercice. Le SIREN = 9 premiers chiffres du SIRET ;
  // clôture supposée au 31/12 (année civile — cas standard TPE ; un exercice
  // décalé doit être paramétré, cf. revue expert-comptable).
  const siret = (garage?.siret ?? '').replace(/\D/g, '')
  const siren = siret.length >= 9 ? siret.slice(0, 9) : (siret || 'SIREN')
  const filename = `${siren}FEC${year}1231.txt`
  const body = rows.join('\r\n')  // FEC uses CRLF

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
