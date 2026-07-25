import { Job, Mechanic } from './types'
import { getTodayString, generateId } from './utils'

const SEED_GARAGE_ID = 'seed-garage'
const SEED_TS = new Date(0).toISOString()

export const DEFAULT_MECHANICS: Mechanic[] = [
  { id: 'mech-1', name: 'Thomas B.', avatar: 'TB', color: '#3b82f6', isAbsent: false, specialty: ['distribution', 'clutch', 'suspension'],           order: 1, garageId: SEED_GARAGE_ID, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: 'mech-2', name: 'Marco R.',  avatar: 'MR', color: '#10b981', isAbsent: false, specialty: ['brake_pads', 'brake_discs', 'tire_change'],        order: 2, garageId: SEED_GARAGE_ID, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: 'mech-3', name: 'Luc P.',    avatar: 'LP', color: '#f59e0b', isAbsent: false, specialty: ['diagnostics', 'air_conditioning', 'revision'],     order: 3, garageId: SEED_GARAGE_ID, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: 'mech-4', name: 'Karim D.',  avatar: 'KD', color: '#8b5cf6', isAbsent: false, specialty: ['oil_change', 'battery', 'bulb', 'tire_repair'],    order: 4, garageId: SEED_GARAGE_ID, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: 'mech-5', name: 'Sofia M.',  avatar: 'SM', color: '#ec4899', isAbsent: false, specialty: ['bodywork', 'exhaust', 'revision'],                 order: 5, garageId: SEED_GARAGE_ID, createdAt: SEED_TS, updatedAt: SEED_TS },
]

export function getSeedJobs(): Job[] {
  const today = getTodayString()
  const now   = new Date().toISOString()
  const j = (o: Omit<Job, 'garageId' | 'createdAt' | 'updatedAt'>): Job =>
    ({ ...o, garageId: SEED_GARAGE_ID, createdAt: now, updatedAt: now })

  return [
    j({ id: generateId(), customerName: 'Martin Dupont',    vehicleModel: 'Peugeot 308',        licensePlate: 'AB-123-CD', repairType: 'oil_change',      estimatedDuration: 30,  mechanicId: 'mech-1', startTime: '08:00', date: today, status: 'completed',  isUrgent: false, actualDuration: 25 }),
    j({ id: generateId(), customerName: 'Sophie Laurent',   vehicleModel: 'Renault Clio',        licensePlate: 'EF-456-GH', repairType: 'brake_pads',      estimatedDuration: 45,  mechanicId: 'mech-1', startTime: '08:30', date: today, status: 'in_progress', isUrgent: false }),
    j({ id: generateId(), customerName: 'Jean Moreau',      vehicleModel: 'Citroën C3',          licensePlate: 'IJ-789-KL', repairType: 'distribution',    estimatedDuration: 240, mechanicId: 'mech-1', startTime: '09:30', date: today, status: 'scheduled',   isUrgent: false }),
    j({ id: generateId(), customerName: 'Isabelle Bernard', vehicleModel: 'Volkswagen Golf',     licensePlate: 'MN-012-OP', repairType: 'diagnostics',     estimatedDuration: 30,  mechanicId: 'mech-2', startTime: '08:00', date: today, status: 'completed',  isUrgent: false, actualDuration: 35 }),
    j({ id: generateId(), customerName: 'Pierre Fontaine',  vehicleModel: 'Toyota Yaris',        licensePlate: 'QR-345-ST', repairType: 'revision',        estimatedDuration: 120, mechanicId: 'mech-2', startTime: '08:30', date: today, status: 'in_progress', isUrgent: false }),
    j({ id: generateId(), customerName: 'Cécile Roux',      vehicleModel: 'BMW Serie 3',         licensePlate: 'UV-678-WX', repairType: 'suspension',      estimatedDuration: 120, mechanicId: 'mech-2', startTime: '11:00', date: today, status: 'scheduled',   isUrgent: false }),
    j({ id: generateId(), customerName: 'Antoine Girard',   vehicleModel: 'Mercedes Classe A',   licensePlate: 'YZ-901-AB', repairType: 'air_conditioning', estimatedDuration: 60, mechanicId: 'mech-3', startTime: '08:00', date: today, status: 'in_progress', isUrgent: false }),
    j({ id: generateId(), customerName: 'Nathalie Simon',   vehicleModel: 'Audi A3',             licensePlate: 'CD-234-EF', repairType: 'brake_discs',     estimatedDuration: 90,  mechanicId: 'mech-3', startTime: '09:30', date: today, status: 'scheduled',   isUrgent: false }),
    j({ id: generateId(), customerName: 'François Michel',  vehicleModel: 'Ford Focus',          licensePlate: 'GH-567-IJ', repairType: 'tire_change',     estimatedDuration: 45,  mechanicId: 'mech-4', startTime: '08:00', date: today, status: 'completed',  isUrgent: false, actualDuration: 40 }),
    j({ id: generateId(), customerName: 'Valérie Legrand',  vehicleModel: 'Nissan Micra',        licensePlate: 'KL-890-MN', repairType: 'battery',         estimatedDuration: 20,  mechanicId: 'mech-4', startTime: '08:45', date: today, status: 'completed',  isUrgent: false, actualDuration: 15 }),
    j({ id: generateId(), customerName: 'David Petit',      vehicleModel: 'Honda Jazz',          licensePlate: 'OP-123-QR', repairType: 'clutch',          estimatedDuration: 180, mechanicId: 'mech-4', startTime: '09:30', date: today, status: 'scheduled',   isUrgent: true }),
    j({ id: generateId(), customerName: 'Élise Durand',     vehicleModel: 'Fiat 500',            licensePlate: 'ST-456-UV', repairType: 'bodywork',        estimatedDuration: 180, mechanicId: 'mech-5', startTime: '08:00', date: today, status: 'in_progress', isUrgent: false }),
    j({ id: generateId(), customerName: 'Marc Leroy',       vehicleModel: 'Seat Ibiza',          licensePlate: 'WX-789-YZ', repairType: 'exhaust',         estimatedDuration: 60,  mechanicId: 'mech-5', startTime: '11:30', date: today, status: 'scheduled',   isUrgent: false }),
  ]
}
