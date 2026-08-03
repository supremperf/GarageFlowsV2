import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

// Mot de passe du compte démo : JAMAIS de secret en clair dans le dépôt.
// Fourni via SEED_ADMIN_PASSWORD, sinon généré aléatoirement et affiché UNE fois.
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD
const seedAdminPassword = SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')
const seedPasswordWasGenerated = !SEED_ADMIN_PASSWORD

async function main() {
  console.log('🌱 Seeding demo garage...')

  // Check if demo garage already exists
  const existing = await prisma.garage.findUnique({ where: { slug: 'demo-garage' } })
  if (existing) {
    console.log('✓ Demo garage already exists, skipping seed.')
    return
  }

  // Create demo garage
  const garage = await prisma.garage.create({
    data: {
      name: 'Garage Demo',
      slug: 'demo-garage',
      address: '12 rue de la Mécanique, 75001 Paris',
      phone: '01 23 45 67 89',
      email: 'contact@garage-demo.fr',
      plan: 'PRO',
      onboardingComplete: true,
    },
  })

  // Create owner account.
  // NOTE: l'authentification recherche l'email en minuscules — on stocke donc
  // l'email en minuscules pour que le compte démo soit connectable.
  const hashedPassword = await bcrypt.hash(seedAdminPassword, 12)
  await prisma.user.create({
    data: {
      email: 'admingarageflow@admin.fr',
      password: hashedPassword,
      name: 'Admin GarageFlow',
      role: 'OWNER',
      garageId: garage.id,
    },
  })

  // Create default mechanics
  const mechanics = await Promise.all([
    prisma.mechanic.create({
      data: {
        name: 'Thomas B.',
        avatar: 'TB',
        color: '#3b82f6',
        specialty: JSON.stringify(['distribution', 'clutch', 'suspension']),
        order: 1,
        garageId: garage.id,
      },
    }),
    prisma.mechanic.create({
      data: {
        name: 'Marco R.',
        avatar: 'MR',
        color: '#10b981',
        specialty: JSON.stringify(['brake_pads', 'brake_discs', 'tire_change']),
        order: 2,
        garageId: garage.id,
      },
    }),
    prisma.mechanic.create({
      data: {
        name: 'Luc P.',
        avatar: 'LP',
        color: '#f59e0b',
        specialty: JSON.stringify(['diagnostics', 'air_conditioning', 'revision']),
        order: 3,
        garageId: garage.id,
      },
    }),
    prisma.mechanic.create({
      data: {
        name: 'Karim D.',
        avatar: 'KD',
        color: '#8b5cf6',
        specialty: JSON.stringify(['oil_change', 'battery', 'bulb', 'tire_repair']),
        order: 4,
        garageId: garage.id,
      },
    }),
    prisma.mechanic.create({
      data: {
        name: 'Sofia M.',
        avatar: 'SM',
        color: '#ec4899',
        specialty: JSON.stringify(['bodywork', 'exhaust', 'revision']),
        order: 5,
        garageId: garage.id,
      },
    }),
  ])

  // Create sample jobs for today
  const today = new Date().toISOString().split('T')[0]

  const sampleJobs = [
    { customerName: 'Martin Dupont', vehicleModel: 'Peugeot 308', licensePlate: 'AB-123-CD', repairType: 'oil_change', estimatedDuration: 30, mechanicId: mechanics[0].id, startTime: '08:00', status: 'completed', actualDuration: 25 },
    { customerName: 'Sophie Laurent', vehicleModel: 'Renault Clio', licensePlate: 'EF-456-GH', repairType: 'brake_pads', estimatedDuration: 45, mechanicId: mechanics[0].id, startTime: '08:30', status: 'in_progress' },
    { customerName: 'Jean Moreau', vehicleModel: 'Citroën C3', licensePlate: 'IJ-789-KL', repairType: 'distribution', estimatedDuration: 240, mechanicId: mechanics[0].id, startTime: '09:30', status: 'scheduled' },
    { customerName: 'Isabelle Bernard', vehicleModel: 'Volkswagen Golf', licensePlate: 'MN-012-OP', repairType: 'diagnostics', estimatedDuration: 30, mechanicId: mechanics[1].id, startTime: '08:00', status: 'completed', actualDuration: 35 },
    { customerName: 'Pierre Fontaine', vehicleModel: 'Toyota Yaris', licensePlate: 'QR-345-ST', repairType: 'revision', estimatedDuration: 120, mechanicId: mechanics[1].id, startTime: '08:30', status: 'in_progress' },
    { customerName: 'Cécile Roux', vehicleModel: 'BMW Serie 3', licensePlate: 'UV-678-WX', repairType: 'suspension', estimatedDuration: 120, mechanicId: mechanics[1].id, startTime: '11:00', status: 'scheduled' },
    { customerName: 'Antoine Girard', vehicleModel: 'Mercedes Classe A', licensePlate: 'YZ-901-AB', repairType: 'air_conditioning', estimatedDuration: 60, mechanicId: mechanics[2].id, startTime: '08:00', status: 'in_progress' },
    { customerName: 'Nathalie Simon', vehicleModel: 'Audi A3', licensePlate: 'CD-234-EF', repairType: 'brake_discs', estimatedDuration: 90, mechanicId: mechanics[2].id, startTime: '09:30', status: 'scheduled' },
    { customerName: 'François Michel', vehicleModel: 'Ford Focus', licensePlate: 'GH-567-IJ', repairType: 'tire_change', estimatedDuration: 45, mechanicId: mechanics[3].id, startTime: '08:00', status: 'completed', actualDuration: 40 },
    { customerName: 'Valérie Legrand', vehicleModel: 'Nissan Micra', licensePlate: 'KL-890-MN', repairType: 'battery', estimatedDuration: 20, mechanicId: mechanics[3].id, startTime: '08:45', status: 'completed', actualDuration: 15 },
    { customerName: 'David Petit', vehicleModel: 'Honda Jazz', licensePlate: 'OP-123-QR', repairType: 'clutch', estimatedDuration: 180, mechanicId: mechanics[3].id, startTime: '09:30', status: 'scheduled', isUrgent: true },
    { customerName: 'Élise Durand', vehicleModel: 'Fiat 500', licensePlate: 'ST-456-UV', repairType: 'bodywork', estimatedDuration: 180, mechanicId: mechanics[4].id, startTime: '08:00', status: 'in_progress' },
    { customerName: 'Marc Leroy', vehicleModel: 'Seat Ibiza', licensePlate: 'WX-789-YZ', repairType: 'exhaust', estimatedDuration: 60, mechanicId: mechanics[4].id, startTime: '11:30', status: 'scheduled' },
  ]

  for (const job of sampleJobs) {
    await prisma.job.create({
      data: {
        ...job,
        isUrgent: job.isUrgent ?? false,
        date: today,
        garageId: garage.id,
      },
    })
  }

  console.log(`✅ Seeded garage "${garage.name}" with ${mechanics.length} mechanics and ${sampleJobs.length} jobs.`)
  console.log('   Login: admingarageflow@admin.fr')
  if (seedPasswordWasGenerated) {
    // Affiché UNE fois (mot de passe généré). Pour un mot de passe fixe et
    // reproductible, définissez SEED_ADMIN_PASSWORD avant `npm run db:seed`.
    console.log(`   Mot de passe (généré, à noter) : ${seedAdminPassword}`)
  } else {
    console.log('   Mot de passe : valeur de $SEED_ADMIN_PASSWORD')
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
