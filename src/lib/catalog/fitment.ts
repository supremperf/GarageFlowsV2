/**
 * Vehicle ↔ article compatibility. Pure & deterministic.
 *
 * An empty fitment list means the article is universal (fits everything). A
 * non-empty list fits a vehicle when *any* fitment matches: same make, a
 * compatible model (loose, either-way contains), and — when both the vehicle
 * year and the fitment range are known — a year inside the range. A missing
 * year never disqualifies a fitment (we cannot disprove compatibility).
 */
import { normalizeText } from './normalize'
import type { Fitment, VehicleRef } from './types'

function makeMatches(fitment: Fitment, vehicle: VehicleRef): boolean {
  return normalizeText(fitment.make) === normalizeText(vehicle.make)
}

function modelMatches(fitment: Fitment, vehicle: VehicleRef): boolean {
  const fm = normalizeText(fitment.model)
  const vm = normalizeText(vehicle.model)
  if (!fm) return true // fitment covers the whole make
  if (!vm) return true // vehicle model unknown → cannot disprove
  return fm === vm || fm.includes(vm) || vm.includes(fm)
}

function yearMatches(fitment: Fitment, vehicle: VehicleRef): boolean {
  const y = vehicle.year
  if (y == null) return true // unknown year → cannot disprove
  if (fitment.yearFrom != null && y < fitment.yearFrom) return false
  if (fitment.yearTo != null && y > fitment.yearTo) return false
  return true
}

/** Does a single fitment match the vehicle? */
export function fitmentMatches(fitment: Fitment, vehicle: VehicleRef): boolean {
  return makeMatches(fitment, vehicle) && modelMatches(fitment, vehicle) && yearMatches(fitment, vehicle)
}

/**
 * Does the article (via its fitment list) fit the vehicle? Universal articles
 * (no fitments) fit everything.
 */
export function fitsVehicle(fitments: Fitment[], vehicle: VehicleRef): boolean {
  if (fitments.length === 0) return true
  return fitments.some((f) => fitmentMatches(f, vehicle))
}

/**
 * How specific the fit is — used to rank a make/model/year match above a
 * universal article. 0 = universal, 3 = make+model+year all pinned & matched.
 */
export function fitmentSpecificity(fitments: Fitment[], vehicle: VehicleRef): number {
  if (fitments.length === 0) return 0
  let best = 0
  for (const f of fitments) {
    if (!fitmentMatches(f, vehicle)) continue
    let s = 1 // make matched
    if (normalizeText(f.model) && normalizeText(vehicle.model)) s += 1
    if (vehicle.year != null && (f.yearFrom != null || f.yearTo != null)) s += 1
    if (s > best) best = s
  }
  return best
}
