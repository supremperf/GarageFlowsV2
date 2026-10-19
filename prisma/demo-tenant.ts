/**
 * demo-tenant.ts — tenant de démonstration GarageFlows : seed riche + reset sûr.
 *
 * Commandes (npm) :
 *   npm run demo:seed   → crée le garage de démo s'il n'existe pas (idempotent).
 *   npm run demo:reset  → supprime le tenant de démo PUIS le re-crée (état neuf).
 *   npm run demo:wipe   → supprime le tenant de démo uniquement.
 *
 * Périmètre STRICT du reset : uniquement le garage de slug `demo-garage` ET dont
 * l'email est `contact@garage-demo.fr` (double marqueur d'identité). Toutes les
 * données filles partent par cascade Prisma (`onDelete: Cascade`) ; les licences
 * (`LicenseKey`, `onDelete: SetNull`) survivent volontairement. Un garage réel
 * qui réutiliserait le slug sans le marqueur email n'est JAMAIS supprimé.
 *
 * Garde production : le reset/wipe refuse de s'exécuter si NODE_ENV=production,
 * sauf DEMO_RESET_FORCE=1 (décision explicite de l'opérateur).
 *
 * Retour arrière : les données du tenant de démo sont 100 % synthétiques et
 * régénérées à l'identique par `demo:seed` — le re-seed EST la procédure de
 * retour arrière.
 *
 * Monnaie : DIX-MILLIÈMES d'euro exclusivement (entiers exacts) — ex.
 * 459000 = 45,90 €. Aucun flottant monétaire.
 *
 * Mot de passe démo : jamais en clair dans le dépôt. Fourni via
 * SEED_ADMIN_PASSWORD, sinon généré aléatoirement et affiché UNE fois.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

const DEMO_SLUG = 'demo-garage'
const DEMO_EMAIL = 'contact@garage-demo.fr'
const OWNER_EMAIL = 'admingarageflow@admin.fr'
const RECEPTION_EMAIL = 'accueil@garage-demo.fr'

const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD
const demoPassword = SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')
const passwordWasGenerated = !SEED_ADMIN_PASSWORD

/** YYYY-MM-DD local, décalé de `offsetDays` jours. */
function isoDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split('T')[0]
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  const existing = await prisma.garage.findUnique({ where: { slug: DEMO_SLUG } })
  if (existing) {
    console.log(`✓ Le garage de démo existe déjà (${existing.id}). Utilisez « npm run demo:reset » pour un état neuf.`)
    return
  }

  console.log('🌱 Création du tenant de démonstration GarageFlows…')

  const garage = await prisma.garage.create({
    data: {
      name: 'Garage Demo',
      slug: DEMO_SLUG,
      address: '12 rue de la Mécanique, 75001 Paris',
      phone: '01 23 45 67 89',
      email: DEMO_EMAIL,
      plan: 'PRO',
      onboardingComplete: true,
      hourlyRateTenThousandths: 650000, // 65 €/h
      paymentTerms: '30 jours net',
    },
  })

  // Comptes (OWNER + RECEPTIONIST) — même mot de passe démo, affiché une fois.
  const hashed = await bcrypt.hash(demoPassword, 12)
  await prisma.user.create({
    data: { email: OWNER_EMAIL, password: hashed, name: 'Admin GarageFlows', role: 'OWNER', garageId: garage.id },
  })
  await prisma.user.create({
    data: { email: RECEPTION_EMAIL, password: hashed, name: 'Claire Accueil', role: 'RECEPTIONIST', garageId: garage.id },
  })

  // Mécaniciens.
  const mechanicDefs = [
    { name: 'Thomas B.', avatar: 'TB', color: '#3b82f6', specialty: ['distribution', 'clutch', 'suspension'], order: 1 },
    { name: 'Marco R.', avatar: 'MR', color: '#10b981', specialty: ['brake_pads', 'brake_discs', 'tire_change'], order: 2 },
    { name: 'Luc P.', avatar: 'LP', color: '#f59e0b', specialty: ['diagnostics', 'air_conditioning', 'revision'], order: 3 },
    { name: 'Karim D.', avatar: 'KD', color: '#8b5cf6', specialty: ['oil_change', 'battery', 'bulb', 'tire_repair'], order: 4 },
    { name: 'Sofia M.', avatar: 'SM', color: '#ec4899', specialty: ['bodywork', 'exhaust', 'revision'], order: 5 },
  ]
  const mechanics = []
  for (const m of mechanicDefs) {
    mechanics.push(await prisma.mechanic.create({
      data: { ...m, specialty: JSON.stringify(m.specialty), garageId: garage.id },
    }))
  }

  // Clients + véhicules.
  const clientDefs = [
    { name: 'Martin Dupont', phone: '06 11 22 33 44', email: 'martin.dupont@exemple.fr', vehicles: [{ licensePlate: 'AB-123-CD', make: 'Peugeot', model: '308', year: 2019, mileage: 78500, ctDate: isoDate(120) }] },
    { name: 'Sophie Laurent', phone: '06 22 33 44 55', email: 'sophie.laurent@exemple.fr', vehicles: [{ licensePlate: 'EF-456-GH', make: 'Renault', model: 'Clio V', year: 2021, mileage: 42300, ctDate: isoDate(300) }] },
    { name: 'Jean Moreau', phone: '06 33 44 55 66', email: 'jean.moreau@exemple.fr', vehicles: [{ licensePlate: 'IJ-789-KL', make: 'Citroën', model: 'C3', year: 2017, mileage: 112000, ctDate: isoDate(45) }, { licensePlate: 'IJ-790-KL', make: 'Citroën', model: 'Berlingo', year: 2015, mileage: 156000, ctDate: isoDate(15) }] },
    { name: 'Isabelle Bernard', phone: '06 44 55 66 77', email: 'isabelle.bernard@exemple.fr', vehicles: [{ licensePlate: 'MN-012-OP', make: 'Volkswagen', model: 'Golf 7', year: 2018, mileage: 95200, ctDate: isoDate(200) }] },
    { name: 'Pierre Fontaine', phone: '06 55 66 77 88', email: 'pierre.fontaine@exemple.fr', vehicles: [{ licensePlate: 'QR-345-ST', make: 'Toyota', model: 'Yaris', year: 2020, mileage: 51800, ctDate: isoDate(260) }] },
    { name: 'Transports Rivière SARL', phone: '01 98 76 54 32', email: 'contact@transports-riviere.exemple.fr', address: '4 avenue des Ateliers, 75012 Paris', vehicles: [{ licensePlate: 'UV-678-WX', make: 'Renault', model: 'Master', year: 2019, mileage: 187400, ctDate: isoDate(30) }] },
  ]
  const clients: { id: string; name: string }[] = []
  const vehicles: { id: string; plate: string; label: string; clientId: string; clientName: string }[] = []
  for (const c of clientDefs) {
    const client = await prisma.client.create({
      data: { name: c.name, phone: c.phone, email: c.email, address: c.address, garageId: garage.id },
    })
    clients.push({ id: client.id, name: client.name })
    for (const v of c.vehicles) {
      const vehicle = await prisma.vehicle.create({
        data: { ...v, clientId: client.id, garageId: garage.id },
      })
      vehicles.push({ id: vehicle.id, plate: v.licensePlate, label: `${v.make} ${v.model}`, clientId: client.id, clientName: c.name })
    }
  }

  // Stock — prix en DIX-MILLIÈMES d'€ (459000 = 45,90 €).
  const partDefs = [
    { reference: 'PLQ-AV-208', name: 'Plaquettes de frein avant', quantity: 14, minQuantity: 6, unitCostTenThousandths: 231000, unitPriceTenThousandths: 459000, location: 'A1-03', supplierName: 'AutoDistrib' },
    { reference: 'DSQ-AV-208', name: 'Disques de frein avant (paire)', quantity: 6, minQuantity: 4, unitCostTenThousandths: 482000, unitPriceTenThousandths: 899000, location: 'A1-04', supplierName: 'AutoDistrib' },
    { reference: 'FLT-HUI-01', name: 'Filtre à huile', quantity: 32, minQuantity: 10, unitCostTenThousandths: 42000, unitPriceTenThousandths: 89000, location: 'B2-01', supplierName: 'Mecapièces' },
    { reference: 'HUI-5W30-5L', name: 'Huile moteur 5W30 (bidon 5 L)', quantity: 21, minQuantity: 8, unitCostTenThousandths: 219000, unitPriceTenThousandths: 399000, location: 'B2-05', supplierName: 'Mecapièces' },
    { reference: 'BAT-60AH', name: 'Batterie 60 Ah', quantity: 5, minQuantity: 3, unitCostTenThousandths: 553000, unitPriceTenThousandths: 949000, location: 'C1-02', supplierName: 'ElecAuto' },
    { reference: 'KIT-DIST-C3', name: 'Kit distribution + pompe à eau', quantity: 3, minQuantity: 2, unitCostTenThousandths: 1180000, unitPriceTenThousandths: 1890000, location: 'C2-01', supplierName: 'AutoDistrib' },
    { reference: 'PNEU-205-55', name: 'Pneu 205/55 R16', quantity: 12, minQuantity: 8, unitCostTenThousandths: 468000, unitPriceTenThousandths: 749000, location: 'D1-01', supplierName: 'PneuPro' },
    { reference: 'ESS-GLC-01', name: 'Essuie-glaces (paire)', quantity: 18, minQuantity: 6, unitCostTenThousandths: 87000, unitPriceTenThousandths: 189000, location: 'B1-06', supplierName: 'Mecapièces' },
  ]
  for (const p of partDefs) await prisma.part.create({ data: { ...p, garageId: garage.id } })

  // Planning — jobs du jour + demain (liés aux véhicules quand pertinent).
  const today = isoDate(0)
  const tomorrow = isoDate(1)
  const v = (plate: string) => vehicles.find((x) => x.plate === plate)
  const jobDefs = [
    { customerName: 'Martin Dupont', vehiclePlate: 'AB-123-CD', repairType: 'oil_change', estimatedDuration: 30, mechanicIdx: 3, startTime: '08:00', date: today, status: 'completed', actualDuration: 25 },
    { customerName: 'Sophie Laurent', vehiclePlate: 'EF-456-GH', repairType: 'brake_pads', estimatedDuration: 45, mechanicIdx: 1, startTime: '08:30', date: today, status: 'in_progress' },
    { customerName: 'Jean Moreau', vehiclePlate: 'IJ-789-KL', repairType: 'distribution', estimatedDuration: 240, mechanicIdx: 0, startTime: '09:30', date: today, status: 'scheduled' },
    { customerName: 'Isabelle Bernard', vehiclePlate: 'MN-012-OP', repairType: 'diagnostics', estimatedDuration: 30, mechanicIdx: 2, startTime: '08:00', date: today, status: 'completed', actualDuration: 35 },
    { customerName: 'Pierre Fontaine', vehiclePlate: 'QR-345-ST', repairType: 'revision', estimatedDuration: 120, mechanicIdx: 2, startTime: '09:00', date: today, status: 'in_progress' },
    { customerName: 'Transports Rivière SARL', vehiclePlate: 'UV-678-WX', repairType: 'suspension', estimatedDuration: 120, mechanicIdx: 0, startTime: '14:00', date: today, status: 'scheduled', isUrgent: true },
    { customerName: 'Jean Moreau', vehiclePlate: 'IJ-790-KL', repairType: 'tire_change', estimatedDuration: 45, mechanicIdx: 4, startTime: '10:00', date: today, status: 'scheduled' },
    { customerName: 'Martin Dupont', vehiclePlate: 'AB-123-CD', repairType: 'air_conditioning', estimatedDuration: 60, mechanicIdx: 4, startTime: '08:30', date: tomorrow, status: 'scheduled' },
    { customerName: 'Sophie Laurent', vehiclePlate: 'EF-456-GH', repairType: 'battery', estimatedDuration: 20, mechanicIdx: 3, startTime: '09:00', date: tomorrow, status: 'scheduled' },
  ]
  const jobs = []
  for (const j of jobDefs) {
    const veh = v(j.vehiclePlate)
    jobs.push(await prisma.job.create({
      data: {
        customerName: j.customerName,
        vehicleModel: veh?.label ?? 'Véhicule',
        licensePlate: j.vehiclePlate,
        repairType: j.repairType,
        estimatedDuration: j.estimatedDuration,
        actualDuration: j.actualDuration,
        startTime: j.startTime,
        date: j.date,
        status: j.status,
        isUrgent: j.isUrgent ?? false,
        mechanicId: mechanics[j.mechanicIdx].id,
        vehicleId: veh?.id,
        garageId: garage.id,
      },
    }))
  }

  // Devis DEV-2026-001..003 (draft / sent / accepted) — lignes MO + pièces.
  const year = new Date().getFullYear()
  const quoteDefs = [
    {
      n: 1, status: 'sent', plate: 'IJ-789-KL',
      lines: [
        { description: 'Kit distribution + pompe à eau', quantityTenThousandths: 10000, unitPriceTenThousandths: 1890000, unitCostTenThousandths: 1180000, isLabor: false, sortOrder: 0 },
        { description: 'Main-dœuvre remplacement distribution (4 h)', quantityTenThousandths: 40000, unitPriceTenThousandths: 650000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 1 },
      ],
    },
    {
      n: 2, status: 'accepted', plate: 'UV-678-WX',
      lines: [
        { description: 'Amortisseurs avant (paire)', quantityTenThousandths: 10000, unitPriceTenThousandths: 1490000, unitCostTenThousandths: 921000, isLabor: false, sortOrder: 0 },
        { description: 'Main-dœuvre trains roulants (2 h)', quantityTenThousandths: 20000, unitPriceTenThousandths: 650000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 1 },
      ],
    },
    {
      n: 3, status: 'draft', plate: 'MN-012-OP',
      lines: [
        { description: 'Pneu 205/55 R16', quantityTenThousandths: 40000, unitPriceTenThousandths: 749000, unitCostTenThousandths: 468000, isLabor: false, sortOrder: 0 },
        { description: 'Montage + équilibrage (1 h)', quantityTenThousandths: 10000, unitPriceTenThousandths: 650000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 1 },
      ],
    },
  ]
  for (const q of quoteDefs) {
    const veh = v(q.plate)
    if (!veh) continue
    await prisma.quote.create({
      data: {
        number: `DEV-${year}-${String(q.n).padStart(3, '0')}`,
        garageId: garage.id,
        clientId: veh.clientId,
        vehicleId: veh.id,
        clientName: veh.clientName,
        vehicleModel: veh.label,
        licensePlate: veh.plate,
        status: q.status,
        issueDate: isoDate(-(10 - q.n)),
        validUntil: isoDate(30),
        taxRate: 20,
        lines: { create: q.lines },
      },
    })
  }

  // Factures FAC-2026-001..004 (2 payées / 1 envoyée / 1 brouillon).
  const invoiceDefs = [
    {
      n: 1, status: 'paid', plate: 'AB-123-CD', issued: -30,
      lines: [
        { description: 'Filtre à huile', quantityTenThousandths: 10000, unitPriceTenThousandths: 89000, unitCostTenThousandths: 42000, isLabor: false, sortOrder: 0 },
        { description: 'Huile moteur 5W30 (5 L)', quantityTenThousandths: 10000, unitPriceTenThousandths: 399000, unitCostTenThousandths: 219000, isLabor: false, sortOrder: 1 },
        { description: 'Main-dœuvre vidange (0,5 h)', quantityTenThousandths: 5000, unitPriceTenThousandths: 650000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 2 },
      ],
    },
    {
      n: 2, status: 'paid', plate: 'EF-456-GH', issued: -21,
      lines: [
        { description: 'Plaquettes de frein avant', quantityTenThousandths: 10000, unitPriceTenThousandths: 459000, unitCostTenThousandths: 231000, isLabor: false, sortOrder: 0 },
        { description: 'Main-dœuvre freinage (1 h)', quantityTenThousandths: 10000, unitPriceTenThousandths: 650000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 1 },
      ],
    },
    {
      n: 3, status: 'sent', plate: 'QR-345-ST', issued: -7,
      lines: [
        { description: 'Révision constructeur complète', quantityTenThousandths: 10000, unitPriceTenThousandths: 1590000, unitCostTenThousandths: 610000, isLabor: false, sortOrder: 0 },
        { description: 'Essuie-glaces (paire)', quantityTenThousandths: 10000, unitPriceTenThousandths: 189000, unitCostTenThousandths: 87000, isLabor: false, sortOrder: 1 },
      ],
    },
    {
      n: 4, status: 'draft', plate: 'MN-012-OP', issued: 0,
      lines: [
        { description: 'Diagnostic électronique', quantityTenThousandths: 10000, unitPriceTenThousandths: 490000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 0 },
      ],
    },
  ]
  for (const f of invoiceDefs) {
    const veh = v(f.plate)
    if (!veh) continue
    await prisma.invoice.create({
      data: {
        number: `FAC-${year}-${String(f.n).padStart(3, '0')}`,
        garageId: garage.id,
        clientId: veh.clientId,
        vehicleId: veh.id,
        clientName: veh.clientName,
        vehicleModel: veh.label,
        licensePlate: veh.plate,
        status: f.status,
        issueDate: isoDate(f.issued),
        dueDate: isoDate(f.issued + 30),
        taxRate: 20,
        lines: { create: f.lines },
      },
    })
  }

  // Compteurs de numérotation cohérents avec les documents semés : la prochaine
  // facture créée par l'application sera FAC-<année>-005, le prochain devis
  // DEV-<année>-004 (aucune collision d'unicité [garageId, number]).
  await prisma.garage.update({
    where: { id: garage.id },
    data: { invoiceCounter: invoiceDefs.length, quoteCounter: quoteDefs.length },
  })

  // Rendez-vous à venir (portail / accueil).
  await prisma.appointment.create({
    data: {
      garageId: garage.id, clientId: clients[1].id, vehicleId: v('EF-456-GH')?.id,
      clientName: 'Sophie Laurent', vehicleModel: 'Renault Clio V', licensePlate: 'EF-456-GH',
      reason: 'Bruit de roulement à l’avant', date: isoDate(2), startTime: '10:00', durationMin: 60, status: 'confirmed',
    },
  })
  await prisma.appointment.create({
    data: {
      garageId: garage.id, clientId: clients[5].id, vehicleId: v('UV-678-WX')?.id,
      clientName: 'Transports Rivière SARL', vehicleModel: 'Renault Master', licensePlate: 'UV-678-WX',
      reason: 'Contrôle avant contrôle technique', date: isoDate(3), startTime: '14:30', durationMin: 45, status: 'requested',
    },
  })

  console.log(`✅ Tenant de démo créé : garage « Garage Demo » (${garage.id})`)
  console.log(`   ${mechanics.length} mécaniciens · ${clients.length} clients · ${vehicles.length} véhicules · ${partDefs.length} pièces en stock`)
  console.log(`   ${jobs.length} interventions · ${quoteDefs.length} devis (DEV-${year}-001…) · ${invoiceDefs.length} factures (FAC-${year}-001…) · 2 rendez-vous`)
  console.log(`   Comptes : ${OWNER_EMAIL} (OWNER) · ${RECEPTION_EMAIL} (RECEPTIONIST)`)
  if (passwordWasGenerated) {
    console.log(`   Mot de passe (généré, à noter — affiché une seule fois) : ${demoPassword}`)
  } else {
    console.log('   Mot de passe : valeur de $SEED_ADMIN_PASSWORD')
  }
}

// ─── Wipe (suppression strictement scopée) ────────────────────────────────────

async function wipe(): Promise<boolean> {
  const garage = await prisma.garage.findUnique({ where: { slug: DEMO_SLUG } })
  if (!garage) {
    console.log('✓ Aucun tenant de démo à supprimer.')
    return false
  }
  // Double marqueur d'identité : slug + email. Un garage réel qui aurait repris
  // le slug sans l'email démo n'est jamais touché.
  if (garage.email !== DEMO_EMAIL) {
    console.error(`❌ Refus : le garage « ${DEMO_SLUG} » n'a pas l'email démo attendu (${DEMO_EMAIL}). Suppression annulée.`)
    process.exitCode = 1
    return false
  }
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_RESET_FORCE !== '1') {
    console.error('❌ Refus : NODE_ENV=production. Posez DEMO_RESET_FORCE=1 pour confirmer explicitement.')
    process.exitCode = 1
    return false
  }

  const [users, clients, vehicles, jobs, quotes, invoices, parts, appointments] = await Promise.all([
    prisma.user.count({ where: { garageId: garage.id } }),
    prisma.client.count({ where: { garageId: garage.id } }),
    prisma.vehicle.count({ where: { garageId: garage.id } }),
    prisma.job.count({ where: { garageId: garage.id } }),
    prisma.quote.count({ where: { garageId: garage.id } }),
    prisma.invoice.count({ where: { garageId: garage.id } }),
    prisma.part.count({ where: { garageId: garage.id } }),
    prisma.appointment.count({ where: { garageId: garage.id } }),
  ])
  await prisma.garage.delete({ where: { id: garage.id } })
  console.log(`🗑  Tenant de démo supprimé (cascade) : ${users} comptes, ${clients} clients, ${vehicles} véhicules, ${jobs} interventions, ${quotes} devis, ${invoices} factures, ${parts} pièces, ${appointments} RDV.`)
  return true
}

// ─── Entrée ───────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || 'seed'
  if (cmd === 'seed') {
    await seed()
  } else if (cmd === 'wipe') {
    await wipe()
  } else if (cmd === 'reset') {
    await wipe()
    if (process.exitCode !== 1) await seed()
  } else {
    console.error(`Commande inconnue « ${cmd} ». Usage : demo-tenant.ts [seed|reset|wipe]`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
