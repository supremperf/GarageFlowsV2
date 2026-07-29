/**
 * Diagnostic knowledge base — curated automotive fault knowledge.
 * All content is deterministic reference data.
 */
import type { Difficulty } from './types'

export interface CauseDef {
  id: string
  name: string
  /** Base likelihood 0..1 before corroboration/context boosts. */
  baseLikelihood: number
  checks: string[]
  parts?: string[]
  consumables?: string[]
  estimatedTimeMin: number
  difficulty: Difficulty
  /** Boosted when mileage is high. */
  wearRelated?: boolean
}

export const CAUSES: Record<string, CauseDef> = {
  obd_read: {
    id: 'obd_read', name: 'Lecture des codes défaut (préalable)', baseLikelihood: 0.9,
    checks: ['Brancher la valise OBD et lire les codes défaut', 'Noter les données figées (freeze frame)'],
    estimatedTimeMin: 15, difficulty: 'easy',
  },
  ignition_coil: {
    id: 'ignition_coil', name: "Bobine d'allumage défectueuse", baseLikelihood: 0.6,
    checks: ['Contrôler la résistance des bobines', 'Permuter la bobine suspecte et observer le raté'],
    parts: ["Bobine d'allumage"], estimatedTimeMin: 45, difficulty: 'medium', wearRelated: true,
  },
  spark_plugs: {
    id: 'spark_plugs', name: 'Bougies usées / encrassées', baseLikelihood: 0.55,
    checks: ["Déposer et inspecter l'état des bougies", "Vérifier l'écartement"],
    parts: ['Bougies'], estimatedTimeMin: 40, difficulty: 'easy', wearRelated: true,
  },
  injectors: {
    id: 'injectors', name: 'Injecteur bouché / défaillant', baseLikelihood: 0.45,
    checks: ["Test d'équilibrage des injecteurs", 'Contrôle du débit / retour'],
    parts: ['Injecteur'], consumables: ['Nettoyant injection'], estimatedTimeMin: 90, difficulty: 'hard',
  },
  maf_sensor: {
    id: 'maf_sensor', name: 'Débitmètre d\'air (MAF) encrassé', baseLikelihood: 0.5,
    checks: ['Lire la valeur MAF à la valise', 'Nettoyer le débitmètre et re-tester'],
    parts: ['Débitmètre MAF'], consumables: ['Nettoyant MAF'], estimatedTimeMin: 30, difficulty: 'easy',
  },
  o2_sensor: {
    id: 'o2_sensor', name: 'Sonde lambda (O2) défaillante', baseLikelihood: 0.5,
    checks: ['Observer le signal de la sonde amont', 'Comparer amont/aval'],
    parts: ['Sonde lambda'], estimatedTimeMin: 45, difficulty: 'medium', wearRelated: true,
  },
  vacuum_leak: {
    id: 'vacuum_leak', name: "Prise d'air / fuite de dépression", baseLikelihood: 0.45,
    checks: ['Test au nettoyant / fumigène sur les durites', 'Contrôler le collecteur d\'admission'],
    consumables: ['Nettoyant frein (test)'], estimatedTimeMin: 40, difficulty: 'medium',
  },
  catalytic_converter: {
    id: 'catalytic_converter', name: 'Catalyseur en fin de vie', baseLikelihood: 0.4,
    checks: ['Comparer sondes amont/aval', 'Contre-pression d\'échappement'],
    parts: ['Catalyseur'], estimatedTimeMin: 90, difficulty: 'hard', wearRelated: true,
  },
  thermostat: {
    id: 'thermostat', name: 'Thermostat bloqué', baseLikelihood: 0.6,
    checks: ['Suivre la montée en température', 'Contrôler l\'ouverture du thermostat'],
    parts: ['Thermostat'], consumables: ['Liquide de refroidissement'], estimatedTimeMin: 60, difficulty: 'medium',
  },
  head_gasket: {
    id: 'head_gasket', name: 'Joint de culasse', baseLikelihood: 0.35,
    checks: ['Test CO dans le liquide de refroidissement', 'Contrôle de compression', 'Recherche d\'émulsion'],
    parts: ['Joint de culasse'], estimatedTimeMin: 480, difficulty: 'hard',
  },
  valve_seals: {
    id: 'valve_seals', name: 'Joints de queue de soupape usés', baseLikelihood: 0.3,
    checks: ['Fumée bleue au redémarrage', 'Test de compression / fuite'],
    parts: ['Joints de soupape'], estimatedTimeMin: 300, difficulty: 'hard', wearRelated: true,
  },
  turbo: {
    id: 'turbo', name: 'Turbocompresseur', baseLikelihood: 0.35,
    checks: ['Contrôle du jeu de l\'arbre', 'Pression de suralimentation', 'Recherche de fuite d\'huile'],
    parts: ['Turbocompresseur'], estimatedTimeMin: 240, difficulty: 'hard', wearRelated: true,
  },
  fuel_filter: {
    id: 'fuel_filter', name: 'Filtre à carburant colmaté', baseLikelihood: 0.45,
    checks: ['Contrôler la pression de carburant', 'Inspecter/remplacer le filtre'],
    parts: ['Filtre à carburant'], estimatedTimeMin: 40, difficulty: 'easy', wearRelated: true,
  },
  fuel_pump: {
    id: 'fuel_pump', name: 'Pompe à carburant faible', baseLikelihood: 0.35,
    checks: ['Mesurer la pression/débit carburant', 'Écouter l\'amorçage de la pompe'],
    parts: ['Pompe à carburant'], estimatedTimeMin: 120, difficulty: 'hard',
  },
  egr_valve: {
    id: 'egr_valve', name: 'Vanne EGR encrassée / bloquée', baseLikelihood: 0.45,
    checks: ['Contrôler l\'ouverture EGR à la valise', 'Déposer et nettoyer la vanne'],
    parts: ['Vanne EGR'], consumables: ['Nettoyant EGR'], estimatedTimeMin: 90, difficulty: 'medium', wearRelated: true,
  },
  battery: {
    id: 'battery', name: 'Batterie en fin de vie', baseLikelihood: 0.6,
    checks: ['Test de charge de la batterie', 'Contrôler la tension au démarrage'],
    parts: ['Batterie'], estimatedTimeMin: 20, difficulty: 'easy', wearRelated: true,
  },
  starter: {
    id: 'starter', name: 'Démarreur défaillant', baseLikelihood: 0.35,
    checks: ['Contrôler l\'alimentation du démarreur', 'Test au démarrage (bruit/claquement)'],
    parts: ['Démarreur'], estimatedTimeMin: 90, difficulty: 'medium',
  },
  brake_pads: {
    id: 'brake_pads', name: 'Plaquettes de frein usées', baseLikelihood: 0.7,
    checks: ['Mesurer l\'épaisseur des plaquettes', 'Inspecter le témoin d\'usure'],
    parts: ['Plaquettes de frein'], estimatedTimeMin: 45, difficulty: 'easy', wearRelated: true,
  },
  brake_discs: {
    id: 'brake_discs', name: 'Disques de frein usés / voilés', baseLikelihood: 0.5,
    checks: ['Mesurer l\'épaisseur et le voile des disques'],
    parts: ['Disques de frein'], estimatedTimeMin: 60, difficulty: 'medium', wearRelated: true,
  },
  wheel_bearing: {
    id: 'wheel_bearing', name: 'Roulement de roue', baseLikelihood: 0.4,
    checks: ['Vérifier le jeu de la roue', 'Écouter le bruit selon la charge/virages'],
    parts: ['Roulement de roue'], estimatedTimeMin: 90, difficulty: 'medium', wearRelated: true,
  },
  wheel_balance: {
    id: 'wheel_balance', name: 'Équilibrage / géométrie', baseLikelihood: 0.5,
    checks: ['Contrôler l\'équilibrage des roues', 'Contrôler la géométrie'],
    consumables: ['Masses d\'équilibrage'], estimatedTimeMin: 45, difficulty: 'easy',
  },
  engine_mount: {
    id: 'engine_mount', name: 'Support moteur usé', baseLikelihood: 0.35,
    checks: ['Inspecter les silentblocs', 'Observer le mouvement moteur à l\'accélération'],
    parts: ['Support moteur'], estimatedTimeMin: 90, difficulty: 'medium', wearRelated: true,
  },
  coolant_leak: {
    id: 'coolant_leak', name: 'Fuite de liquide de refroidissement', baseLikelihood: 0.45,
    checks: ['Mise sous pression du circuit', 'Recherche de fuite (durites/radiateur)'],
    consumables: ['Liquide de refroidissement'], estimatedTimeMin: 60, difficulty: 'medium',
  },
  water_pump: {
    id: 'water_pump', name: 'Pompe à eau', baseLikelihood: 0.35,
    checks: ['Contrôler le jeu/fuite de la pompe', 'Vérifier la circulation'],
    parts: ['Pompe à eau'], consumables: ['Liquide de refroidissement'], estimatedTimeMin: 180, difficulty: 'hard', wearRelated: true,
  },
}

/** Symptom keyword → candidate cause ids (order = rough priority). */
export const SYMPTOM_RULES: Array<{ match: string[]; causes: string[] }> = [
  { match: ['voyant moteur', 'check engine', 'temoin moteur'], causes: ['obd_read', 'ignition_coil', 'o2_sensor', 'egr_valve'] },
  { match: ['fumee blanche', 'fumée blanche'], causes: ['head_gasket', 'coolant_leak'] },
  { match: ['fumee bleue', 'fumée bleue'], causes: ['valve_seals', 'turbo'] },
  { match: ['fumee noire', 'fumée noire'], causes: ['injectors', 'maf_sensor', 'egr_valve'] },
  { match: ['bruit frein', 'grincement frein', 'grincement au freinage'], causes: ['brake_pads', 'brake_discs'] },
  { match: ['vibration'], causes: ['wheel_balance', 'brake_discs', 'engine_mount', 'wheel_bearing'] },
  { match: ['perte de puissance', 'manque de puissance'], causes: ['turbo', 'fuel_filter', 'maf_sensor', 'egr_valve', 'injectors'] },
  { match: ['surconsommation', 'consommation'], causes: ['o2_sensor', 'maf_sensor', 'injectors'] },
  { match: ['demarrage difficile', 'démarrage difficile', 'ne demarre pas', 'demarre mal'], causes: ['battery', 'starter', 'fuel_pump', 'spark_plugs'] },
  { match: ['a-coups', 'à-coups', 'rates', 'ratés', 'broute'], causes: ['ignition_coil', 'spark_plugs', 'injectors', 'vacuum_leak'] },
  { match: ['surchauffe', 'temperature', 'température', 'chauffe'], causes: ['thermostat', 'coolant_leak', 'water_pump'] },
  { match: ['bruit roulement', 'sifflement roue', 'bruit en virage'], causes: ['wheel_bearing'] },
]

/** OBD code → candidate cause ids. */
export const OBD_CODE_CAUSES: Record<string, string[]> = {
  P0300: ['ignition_coil', 'spark_plugs', 'injectors', 'vacuum_leak'],
  P0301: ['ignition_coil', 'spark_plugs', 'injectors'],
  P0302: ['ignition_coil', 'spark_plugs', 'injectors'],
  P0303: ['ignition_coil', 'spark_plugs', 'injectors'],
  P0304: ['ignition_coil', 'spark_plugs', 'injectors'],
  P0171: ['vacuum_leak', 'maf_sensor', 'fuel_filter'],
  P0174: ['vacuum_leak', 'maf_sensor', 'fuel_filter'],
  P0172: ['injectors', 'maf_sensor', 'o2_sensor'],
  P0420: ['catalytic_converter', 'o2_sensor'],
  P0128: ['thermostat'],
  P0401: ['egr_valve'],
  P0087: ['fuel_filter', 'fuel_pump'],
}

/** Fallback: powertrain subsystem group (3rd char) → candidate cause ids. */
export const SUBSYSTEM_CAUSES: Record<string, string[]> = {
  '3': ['ignition_coil', 'spark_plugs'],
  '2': ['injectors'],
  '0': ['maf_sensor', 'o2_sensor'],
  '1': ['maf_sensor', 'o2_sensor'],
  '4': ['egr_valve', 'catalytic_converter'],
}
