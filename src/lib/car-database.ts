// Pre-registered vehicle makes/models database
// Used for autocomplete in the job creation form

export interface CarMake {
  make: string
  models: string[]
}

export const CAR_DATABASE: CarMake[] = [
  { make: 'Alfa Romeo',    models: ['147', '156', '159', 'Giulia', 'Giulietta', 'Stelvio', 'Tonale'] },
  { make: 'Aston Martin',  models: ['DB9', 'DB11', 'Vantage', 'DBS'] },
  { make: 'Audi',          models: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'R8', 'e-tron'] },
  { make: 'BMW',           models: ['Série 1', 'Série 2', 'Série 3', 'Série 4', 'Série 5', 'Série 6', 'Série 7', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'M3', 'M5', 'iX', 'i4'] },
  { make: 'Chevrolet',     models: ['Aveo', 'Captiva', 'Cruze', 'Malibu', 'Orlando', 'Spark', 'Trax'] },
  { make: 'Chrysler',      models: ['300', '300C', 'Voyager', 'Grand Voyager'] },
  { make: 'Citroën',       models: ['C1', 'C2', 'C3', 'C4', 'C5', 'C5 Aircross', 'C5 X', 'C8', 'DS3', 'DS4', 'DS5', 'Berlingo', 'Jumpy', 'Jumper', 'Spacetourer'] },
  { make: 'Cupra',         models: ['Ateca', 'Born', 'Formentor', 'Leon'] },
  { make: 'Dacia',         models: ['Duster', 'Logan', 'Sandero', 'Spring', 'Jogger', 'Lodgy', 'Dokker'] },
  { make: 'DS',            models: ['DS3', 'DS4', 'DS5', 'DS7', 'DS9', 'DS3 Crossback'] },
  { make: 'Ferrari',       models: ['296', '458', '488', 'F8', 'Roma', 'SF90', 'GTC4Lusso'] },
  { make: 'Fiat',          models: ['500', '500X', '500L', 'Bravo', 'Doblo', 'Ducato', 'Grande Punto', 'Panda', 'Punto', 'Stilo', 'Tipo', 'Ulysse'] },
  { make: 'Ford',          models: ['B-Max', 'C-Max', 'EcoSport', 'Edge', 'Explorer', 'Fiesta', 'Focus', 'Fusion', 'Galaxy', 'Kuga', 'Mondeo', 'Mustang', 'Puma', 'S-Max', 'Transit', 'Transit Custom'] },
  { make: 'Honda',         models: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Jazz', 'NSX', 'Pilot', 'Ridgeline'] },
  { make: 'Hyundai',       models: ['i10', 'i20', 'i30', 'i40', 'ix20', 'ix35', 'IONIQ', 'Kona', 'Santa Fe', 'Tucson'] },
  { make: 'Infiniti',      models: ['Q30', 'Q50', 'Q60', 'QX30', 'QX50', 'QX70', 'QX80'] },
  { make: 'Jaguar',        models: ['E-Pace', 'F-Pace', 'F-Type', 'I-Pace', 'S-Type', 'X-Type', 'XE', 'XF', 'XJ'] },
  { make: 'Jeep',          models: ['Cherokee', 'Compass', 'Grand Cherokee', 'Renegade', 'Wrangler'] },
  { make: 'Kia',           models: ['Ceed', 'EV6', 'Niro', 'Picanto', 'Pro Ceed', 'Rio', 'Sorento', 'Soul', 'Sportage', 'Stinger', 'Stonic'] },
  { make: 'Lamborghini',   models: ['Aventador', 'Huracán', 'Urus'] },
  { make: 'Land Rover',    models: ['Defender', 'Discovery', 'Discovery Sport', 'Freelander', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'] },
  { make: 'Lexus',         models: ['CT', 'ES', 'GS', 'IS', 'LC', 'LS', 'NX', 'RX', 'UX'] },
  { make: 'Maserati',      models: ['Ghibli', 'GranTurismo', 'Levante', 'Quattroporte'] },
  { make: 'Mazda',         models: ['CX-3', 'CX-5', 'CX-30', 'MX-5', 'MX-30', 'Mazda2', 'Mazda3', 'Mazda6'] },
  { make: 'McLaren',       models: ['570S', '600LT', '720S', 'Artura', 'GT'] },
  { make: 'Mercedes',      models: ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'Classe G', 'Classe S', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'AMG GT', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'SL', 'SLK', 'Sprinter', 'Vito', 'Viano'] },
  { make: 'Mini',          models: ['Cabrio', 'Clubman', 'Countryman', 'Coupé', 'Mini', 'Paceman', 'Roadster'] },
  { make: 'Mitsubishi',    models: ['ASX', 'Eclipse Cross', 'Outlander', 'L200', 'Space Star'] },
  { make: 'Nissan',        models: ['350Z', '370Z', 'Ariya', 'Juke', 'Leaf', 'Micra', 'Navara', 'Note', 'Pathfinder', 'Pulsar', 'Qashqai', 'X-Trail', 'GT-R'] },
  { make: 'Opel',          models: ['Adam', 'Agila', 'Astra', 'Cascada', 'Corsa', 'Crossland', 'Grandland', 'Insignia', 'Meriva', 'Mokka', 'Vivaro', 'Zafira'] },
  { make: 'Peugeot',       models: ['107', '108', '206', '207', '208', '301', '307', '308', '3008', '407', '408', '508', '5008', '2008', '4008', 'Partner', 'Traveller', 'Expert', 'Boxer'] },
  { make: 'Porsche',       models: ['911', 'Boxster', 'Cayenne', 'Cayman', 'Macan', 'Panamera', 'Taycan'] },
  { make: 'Renault',       models: ['Arkana', 'Austral', 'Captur', 'Clio', 'Espace', 'Fluence', 'Grand Scenic', 'Kadjar', 'Kangoo', 'Koleos', 'Laguna', 'Latitude', 'Master', 'Megane', 'Mégane E-Tech', 'Rafale', 'Scenic', 'Symbol', 'Talisman', 'Trafic', 'Twingo', 'Zoe'] },
  { make: 'Seat',          models: ['Arona', 'Ateca', 'Ibiza', 'Leon', 'MII', 'Tarraco'] },
  { make: 'Skoda',         models: ['Citigo', 'Enyaq', 'Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Rapid', 'Scala', 'Superb', 'Yeti'] },
  { make: 'Smart',         models: ['ForFour', 'ForTwo'] },
  { make: 'Subaru',        models: ['Forester', 'Impreza', 'Legacy', 'Outback', 'XV', 'BRZ', 'WRX'] },
  { make: 'Suzuki',        models: ['Alto', 'Baleno', 'Celerio', 'Ignis', 'Jimny', 'SX4', 'Swift', 'Vitara'] },
  { make: 'Tesla',         models: ['Model 3', 'Model S', 'Model X', 'Model Y', 'Cybertruck'] },
  { make: 'Toyota',        models: ['Auris', 'Avensis', 'Aygo', 'bZ4X', 'C-HR', 'Camry', 'Corolla', 'Hilux', 'Land Cruiser', 'Prius', 'ProAce', 'RAV4', 'Urban Cruiser', 'Verso', 'Yaris'] },
  { make: 'Volkswagen',    models: ['Arteon', 'Caravelle', 'Caddy', 'Crafter', 'Fox', 'Golf', 'Golf GTI', 'ID.3', 'ID.4', 'ID.5', 'ID.6', 'Multivan', 'Passat', 'Polo', 'Scirocco', 'Sharan', 'T-Cross', 'T-Roc', 'Tiguan', 'Touareg', 'Touran', 'Transporter', 'Up'] },
  { make: 'Volvo',         models: ['C30', 'C40', 'EX30', 'EX90', 'S40', 'S60', 'S80', 'S90', 'V40', 'V60', 'V70', 'V90', 'XC40', 'XC60', 'XC70', 'XC90'] },
]

// Sorted by make for easy binary search / prefix lookup
CAR_DATABASE.sort((a, b) => a.make.localeCompare(b.make))

export function searchMakes(query: string): string[] {
  if (!query.trim()) return []
  const q = query.trim().toLowerCase()
  return CAR_DATABASE
    .map(c => c.make)
    .filter(make => make.toLowerCase().startsWith(q))
    .slice(0, 8)
}

export function searchModels(make: string, query: string): string[] {
  if (!make) return []
  const entry = CAR_DATABASE.find(c => c.make.toLowerCase() === make.toLowerCase())
  if (!entry) return []
  if (!query.trim()) return entry.models.slice(0, 8)
  const q = query.trim().toLowerCase()
  return entry.models
    .filter(m => m.toLowerCase().includes(q))
    .slice(0, 8)
}
