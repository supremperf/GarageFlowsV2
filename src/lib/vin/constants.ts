/**
 * VIN decoding — ISO 3779 / ISO 3780 reference data.
 *
 * All data here is public standard information (transliteration table, check-digit
 * weights, the 30-year model-year cycle, WMI region/country ranges) plus a curated
 * offline WMI→manufacturer map for the most common makes. No external service is
 * required for the offline decoder to work.
 */

/** Characters never allowed in a VIN (avoid confusion with 0/1). */
export const FORBIDDEN_VIN_CHARS = ['I', 'O', 'Q'] as const

/** Transliteration values used for the check-digit computation. */
export const TRANSLITERATION: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

/** Position weights (1-indexed positions 1..17); position 9 (the check digit) weights 0. */
export const CHECK_DIGIT_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const

/**
 * Model-year codes in cycle order. 30 codes map to 1980..2009, then repeat for
 * 2010..2039, etc. Excludes I, O, Q, U, Z and 0 (never used as year codes).
 */
export const MODEL_YEAR_CODES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'W', 'X', 'Y',
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
] as const

/** Broad region by the first VIN character (ISO 3780 groupings). */
export const REGION_BY_FIRST_CHAR: { match: RegExp; region: string }[] = [
  { match: /[A-H]/, region: 'Afrique' },
  { match: /[J-R]/, region: 'Asie' },
  { match: /[S-Z]/, region: 'Europe' },
  { match: /[1-5]/, region: 'Amérique du Nord' },
  { match: /[6-7]/, region: 'Océanie' },
  { match: /[89]/, region: 'Amérique du Sud' },
  { match: /0/, region: 'Amérique du Sud' },
]

/**
 * Country of manufacture by the first two VIN characters (ISO 3780). Ranges are
 * inclusive; only the widely-used allocations are listed (extend as needed).
 */
export const COUNTRY_BY_PREFIX: { from: string; to: string; country: string }[] = [
  { from: 'AA', to: 'AH', country: 'Afrique du Sud' },
  { from: 'JA', to: 'J0', country: 'Japon' },
  { from: 'KL', to: 'KR', country: 'Corée du Sud' },
  { from: 'LA', to: 'L0', country: 'Chine' },
  { from: 'MA', to: 'ME', country: 'Inde' },
  { from: 'MF', to: 'MK', country: 'Indonésie' },
  { from: 'NA', to: 'NE', country: 'Turquie' },
  { from: 'SA', to: 'SM', country: 'Royaume-Uni' },
  { from: 'SN', to: 'ST', country: 'Allemagne' },
  { from: 'SU', to: 'SZ', country: 'Pologne' },
  { from: 'TA', to: 'TH', country: 'Suisse' },
  { from: 'TJ', to: 'TP', country: 'Tchéquie' },
  { from: 'TR', to: 'TV', country: 'Hongrie' },
  { from: 'VA', to: 'VE', country: 'Autriche' },
  { from: 'VF', to: 'VR', country: 'France' },
  { from: 'VS', to: 'VW', country: 'Espagne' },
  { from: 'VX', to: 'V2', country: 'Yougoslavie/Serbie' },
  { from: 'WA', to: 'W0', country: 'Allemagne' },
  { from: 'XA', to: 'XE', country: 'Bulgarie' },
  { from: 'XF', to: 'XK', country: 'Russie' },
  { from: 'XL', to: 'XR', country: 'Pays-Bas' },
  { from: 'XS', to: 'XW', country: 'URSS/CEI' },
  { from: 'YA', to: 'YE', country: 'Belgique' },
  { from: 'YF', to: 'YK', country: 'Finlande' },
  { from: 'YS', to: 'YW', country: 'Suède' },
  { from: 'ZA', to: 'ZR', country: 'Italie' },
  { from: '1A', to: '1Z', country: 'États-Unis' },
  { from: '10', to: '19', country: 'États-Unis' },
  { from: '2A', to: '2Z', country: 'Canada' },
  { from: '20', to: '29', country: 'Canada' },
  { from: '3A', to: '3W', country: 'Mexique' },
  { from: '30', to: '39', country: 'Mexique' },
  { from: '4A', to: '4Z', country: 'États-Unis' },
  { from: '40', to: '49', country: 'États-Unis' },
  { from: '5A', to: '5Z', country: 'États-Unis' },
  { from: '50', to: '59', country: 'États-Unis' },
  { from: '6A', to: '6W', country: 'Australie' },
  { from: '7A', to: '7E', country: 'Nouvelle-Zélande' },
  { from: '8A', to: '8Z', country: 'Argentine' },
  { from: '9A', to: '9E', country: 'Brésil' },
  { from: '9F', to: '9Z', country: 'Brésil' },
]

/**
 * Curated offline WMI → manufacturer map (common makes across EU / US / JP / KR).
 * A 3-char WMI is matched first; some manufacturers are keyed on the first 2 chars.
 */
export const WMI_MANUFACTURERS: Record<string, string> = {
  // France
  VF1: 'Renault', VF2: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', VF6: 'Renault Trucks',
  VF8: 'Matra', VFE: 'IVECO France', VG5: 'MBK',
  // Germany
  WVW: 'Volkswagen', WV1: 'Volkswagen VU', WV2: 'Volkswagen Bus', WVG: 'Volkswagen',
  WAU: 'Audi', WA1: 'Audi', TRU: 'Audi', WUA: 'Audi Sport',
  WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW i', WBX: 'BMW (US)',
  WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDF: 'Mercedes-Benz VU',
  WMW: 'MINI', WME: 'Smart', W0L: 'Opel', W0V: 'Opel', WP0: 'Porsche', WP1: 'Porsche SUV',
  WF0: 'Ford (Allemagne)',
  // Italy
  ZFA: 'Fiat', ZFC: 'Fiat', ZAR: 'Alfa Romeo', ZFF: 'Ferrari', ZHW: 'Lamborghini',
  ZAM: 'Maserati', ZLA: 'Lancia',
  // Spain / Czech / others EU
  VSS: 'SEAT', VSX: 'Opel España', TMB: 'Škoda', TMP: 'Škoda', VSE: 'Derbi',
  // UK
  SAJ: 'Jaguar', SAL: 'Land Rover', SAR: 'Rover', SCC: 'Lotus', SCA: 'Rolls-Royce',
  SCB: 'Bentley', SCF: 'Aston Martin', SDB: 'Peugeot (UK)',
  // Sweden
  YV1: 'Volvo', YV4: 'Volvo', YS3: 'Saab', YS2: 'Scania',
  // Japan
  JHM: 'Honda', JHL: 'Honda', JH4: 'Acura', JF1: 'Subaru', JF2: 'Subaru',
  JN1: 'Nissan', JN6: 'Nissan', JN8: 'Nissan', JT2: 'Toyota', JTD: 'Toyota', JTM: 'Toyota',
  JTE: 'Toyota', JMB: 'Mitsubishi', JM1: 'Mazda', JM3: 'Mazda', JS1: 'Suzuki', JS2: 'Suzuki',
  JYA: 'Yamaha', JDA: 'Daihatsu',
  // Korea
  KMH: 'Hyundai', KMF: 'Hyundai VU', KNA: 'Kia', KND: 'Kia', KNM: 'Renault Samsung',
  KLA: 'Daewoo', KL1: 'GM Korea',
  // USA
  '1HG': 'Honda (US)', '1FA': 'Ford', '1FT': 'Ford Truck', '1G1': 'Chevrolet',
  '1GC': 'Chevrolet Truck', '1GM': 'Pontiac', '1J4': 'Jeep', '1C3': 'Chrysler',
  '1C4': 'Chrysler', '1N4': 'Nissan (US)', '2HG': 'Honda (Canada)', '3VW': 'Volkswagen (Mexique)',
  '5YJ': 'Tesla', '4T1': 'Toyota (US)', '4US': 'BMW (US)', '19U': 'Acura',
}
