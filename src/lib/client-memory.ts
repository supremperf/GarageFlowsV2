// Client memory: stores known customer/vehicle associations in localStorage
// so the modal can auto-fill fields when a known customer is typed.

const KEY = 'gf_clients'
const MAX = 300

export interface ClientRecord {
  customerName: string
  licensePlate?: string
  vehicleModel?: string
  phone?: string
  lastSeen: number // epoch ms
}

function load(): ClientRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(records: ClientRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, MAX)))
  } catch {}
}

export function upsertClient(rec: Omit<ClientRecord, 'lastSeen'>) {
  if (!rec.customerName?.trim()) return
  const all = load()
  const name = rec.customerName.trim().toLowerCase()
  const idx = all.findIndex(r => r.customerName.trim().toLowerCase() === name)
  const updated: ClientRecord = { ...rec, customerName: rec.customerName.trim(), lastSeen: Date.now() }
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...updated }
  } else {
    all.unshift(updated)
  }
  all.sort((a, b) => b.lastSeen - a.lastSeen)
  save(all)
}

export function searchClients(query: string): ClientRecord[] {
  if (!query.trim()) return []
  const q = query.trim().toLowerCase()
  return load()
    .filter(r => r.customerName.toLowerCase().includes(q))
    .slice(0, 6)
}

export function findClientByPlate(plate: string): ClientRecord | null {
  if (!plate.trim()) return null
  const p = plate.trim().toUpperCase()
  return load().find(r => r.licensePlate?.toUpperCase() === p) ?? null
}
