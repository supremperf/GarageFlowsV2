/**
 * Offline seed catalogue — a small but realistic dataset so the whole pipeline
 * works without any external provider. References, brands and OE cross-numbers
 * are representative examples for common European models; a real deployment
 * plugs a live catalogue (TecDoc-style) in behind `CatalogProvider`.
 *
 * Prices are indicative list prices (€), not the garage's own cost.
 */
import type { Category, CatalogArticle } from './types'

export const SEED_CATEGORIES: Category[] = [
  { id: 'braking', label: 'Freinage', parentId: null, repairTypes: ['brake_pads', 'brake_discs'] },
  { id: 'brake_pads', label: 'Plaquettes de frein', parentId: 'braking', repairTypes: ['brake_pads'] },
  { id: 'brake_discs', label: 'Disques de frein', parentId: 'braking', repairTypes: ['brake_discs'] },

  { id: 'filtration', label: 'Filtration', parentId: null, repairTypes: ['oil_change', 'revision'] },
  { id: 'filter_oil', label: 'Filtre à huile', parentId: 'filtration', repairTypes: ['oil_change'] },
  { id: 'filter_air', label: 'Filtre à air', parentId: 'filtration', repairTypes: ['revision'] },
  { id: 'filter_cabin', label: 'Filtre habitacle', parentId: 'filtration', repairTypes: ['revision'] },

  { id: 'engine', label: 'Moteur', parentId: null, repairTypes: ['distribution', 'oil_change'] },
  { id: 'timing', label: 'Distribution', parentId: 'engine', repairTypes: ['distribution'] },
  { id: 'oil', label: 'Huile moteur', parentId: 'engine', repairTypes: ['oil_change'] },

  { id: 'ignition', label: 'Allumage / Préchauffage', parentId: null, repairTypes: ['revision'] },
  { id: 'spark_plugs', label: 'Bougies', parentId: 'ignition', repairTypes: ['revision'] },

  { id: 'electric', label: 'Électrique', parentId: null, repairTypes: ['battery'] },
  { id: 'battery', label: 'Batterie', parentId: 'electric', repairTypes: ['battery'] },
]

export const SEED_ARTICLES: CatalogArticle[] = [
  // ── Brake pads ──
  {
    id: 'a-bosch-bp308', reference: '0986494600', brand: 'Bosch', name: 'Jeu de plaquettes de frein avant',
    categoryId: 'brake_pads', crossRefs: ['425371', 'GDB1330', '77364012'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 }, { make: 'Citroën', model: 'C4', yearFrom: 2004, yearTo: 2011 }],
    attributes: { 'Position': 'Avant', 'Système de freinage': 'Bosch' }, listPrice: 38.9,
  },
  {
    id: 'a-ferodo-bp308', reference: 'FDB1330', brand: 'Ferodo', name: 'Kit plaquettes de frein avant Premier',
    categoryId: 'brake_pads', crossRefs: ['425371', '0986494600'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 }],
    attributes: { 'Position': 'Avant' }, listPrice: 34.5,
  },
  {
    id: 'a-trw-bpclio', reference: 'GDB1789', brand: 'TRW', name: 'Jeu de plaquettes de frein avant',
    categoryId: 'brake_pads', crossRefs: ['410609695R', '7701210116'],
    fitments: [{ make: 'Renault', model: 'Clio', yearFrom: 2012, yearTo: 2019 }],
    attributes: { 'Position': 'Avant' }, listPrice: 29.9,
  },

  // ── Brake discs ──
  {
    id: 'a-brembo-bd308', reference: '09.9464.11', brand: 'Brembo', name: 'Disque de frein avant ventilé (x1)',
    categoryId: 'brake_discs', crossRefs: ['4249H0', 'DF4249'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 }],
    attributes: { 'Diamètre': '283 mm', 'Type': 'Ventilé' }, listPrice: 41.2,
  },

  // ── Oil filters ──
  {
    id: 'a-mann-w712', reference: 'W71280', brand: 'Mann-Filter', name: 'Filtre à huile',
    categoryId: 'filter_oil', crossRefs: ['OC90', '1109AY', 'HU7008Z'],
    fitments: [
      { make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 },
      { make: 'Citroën', model: 'C4', yearFrom: 2004, yearTo: 2011 },
      { make: 'Renault', model: 'Clio', yearFrom: 2012, yearTo: 2019 },
    ],
    attributes: { 'Type': 'Cartouche vissable' }, listPrice: 6.8,
  },
  {
    id: 'a-bosch-p3274', reference: 'F026407274', brand: 'Bosch', name: 'Filtre à huile',
    categoryId: 'filter_oil', crossRefs: ['W71280', 'OC90'],
    fitments: [{ make: 'Volkswagen', model: 'Golf', yearFrom: 2012, yearTo: 2020 }],
    attributes: { 'Type': 'Cartouche vissable' }, listPrice: 7.5,
  },

  // ── Air filter ──
  {
    id: 'a-mann-c30', reference: 'C3011480', brand: 'Mann-Filter', name: 'Filtre à air',
    categoryId: 'filter_air', crossRefs: ['1444TR', 'LX1780'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 }],
    listPrice: 12.4,
  },

  // ── Cabin filter ──
  {
    id: 'a-valeo-cf', reference: '698687', brand: 'Valeo', name: 'Filtre habitacle charbon actif',
    categoryId: 'filter_cabin', crossRefs: ['6447XF', 'CUK2545'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014 }, { make: 'Citroën', model: 'C4' }],
    attributes: { 'Type': 'Charbon actif' }, listPrice: 14.9,
  },

  // ── Timing belt kit ──
  {
    id: 'a-gates-k015', reference: 'K015607XS', brand: 'Gates', name: 'Kit de distribution',
    categoryId: 'timing', crossRefs: ['KP15607XS', '0831V2'],
    fitments: [{ make: 'Peugeot', model: '308', yearFrom: 2007, yearTo: 2014, engine: '1.6 HDi' }],
    attributes: { 'Contenu': 'Courroie + galets' }, listPrice: 78.0,
  },

  // ── Engine oil ──
  {
    id: 'a-total-5w30', reference: '5W30-C2-5L', brand: 'Total', name: 'Huile moteur Quartz Ineo 5W-30 (5 L)',
    categoryId: 'oil', crossRefs: [],
    fitments: [], // universal consumable
    attributes: { 'Viscosité': '5W-30', 'Norme': 'ACEA C2', 'Volume': '5 L' }, listPrice: 39.9,
  },

  // ── Spark plugs ──
  {
    id: 'a-ngk-plug', reference: 'BKR6E11', brand: 'NGK', name: 'Bougie d\'allumage (x1)',
    categoryId: 'spark_plugs', crossRefs: ['6953', 'ZFR6F11'],
    fitments: [{ make: 'Renault', model: 'Clio', yearFrom: 2012, yearTo: 2019, engine: '1.2 16V' }],
    listPrice: 3.9,
  },

  // ── Battery ──
  {
    id: 'a-varta-e11', reference: '574012068', brand: 'Varta', name: 'Batterie Blue Dynamic 74 Ah',
    categoryId: 'battery', crossRefs: ['E11', '5744120683132'],
    fitments: [
      { make: 'Peugeot', model: '308' },
      { make: 'Volkswagen', model: 'Golf' },
      { make: 'Renault', model: 'Clio' },
    ],
    attributes: { 'Capacité': '74 Ah', 'Courant de démarrage': '680 A' }, listPrice: 109.0,
  },
]
