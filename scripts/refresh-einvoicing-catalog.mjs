#!/usr/bin/env node
/**
 * refresh-einvoicing-catalog.mjs — importe le registre des PLATEFORMES AGRÉÉES
 * (PA, ex-PDP) de la facturation électronique française.
 *
 * ─── Pourquoi ce script existe ──────────────────────────────────────────────
 * Le catalogue livré contenait quatre entrées INVENTÉES — « Alpha Facturation »,
 * « Axion », « Azer », « Beta Invoice » — présentées à l'écran comme des
 * plateformes agréées. Aucune ne correspond à une plateforme réelle. Un
 * catalogue réglementaire ne se fabrique pas : il s'importe, et sa provenance
 * s'affiche (§82).
 *
 * ─── Source ─────────────────────────────────────────────────────────────────
 * Jeu de données ouvert « Plateformes Agréées de facturation électronique
 * (PA / ex-PDP) — annuaire DGFiP », publié sur data.gouv.fr sous licence ODbL.
 * Chaque entrée porte son propre champ `dgfip.source`, qui pointe vers la page
 * officielle impots.gouv.fr — la seule qui fasse foi.
 *
 * ⚠️ Ce jeu de données est une republication ENRICHIE par un tiers, pas le
 * fichier de la DGFiP lui-même. C'est écrit tel quel dans le fichier généré et
 * affiché dans l'application : on ne présente pas une source secondaire comme
 * une source primaire.
 *
 * ─── Ce qui est importé, et ce qui ne l'est PAS ─────────────────────────────
 * Seuls les champs FACTUELS et vérifiables sont repris : nom, site, statut
 * d'immatriculation, date, numéro, formats déclarés, e-reporting, Peppol.
 * Les capacités d'INTÉGRATION (`capabilities`) ne viennent jamais du registre :
 * elles décrivent ce que GarageFlows sait faire avec la plateforme, ce qui
 * dépend de l'existence d'un adaptateur — pas de ce que la plateforme annonce.
 * Les méthodes d'authentification ne figurent pas dans la source : elles ne sont
 * donc PAS inventées.
 *
 * Usage :
 *   node scripts/refresh-einvoicing-catalog.mjs            # depuis le réseau
 *   node scripts/refresh-einvoicing-catalog.mjs --file x.json
 *   node scripts/refresh-einvoicing-catalog.mjs --check    # n'écrit rien
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SORTIE = join(ROOT, 'src', 'lib', 'einvoicing', 'data', 'plateformes-agreees.json')

const SOURCE = {
  jeuDeDonnees: 'Plateformes Agréées de facturation électronique (PA / ex-PDP) — annuaire DGFiP',
  portail: 'https://www.data.gouv.fr/datasets/plateformes-agreees-de-facturation-electronique-pa-ex-pdp-annuaire-dgfip',
  fichier:
    'https://static.data.gouv.fr/resources/plateformes-agreees-de-facturation-electronique-pa-ex-pdp-annuaire-dgfip/20260725-150905/plateformes-agreees-facturation-electronique.json',
  licence: 'ODbL',
  autoriteDeReference: 'https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees',
  avertissement:
    'Republication enrichie par un tiers du registre DGFiP — seule la page impots.gouv.fr fait foi.',
}

/** Statuts d'immatriculation du registre → vocabulaire du produit. */
const STATUT = {
  immatriculee: 'approved',
  immatriculee_sous_reserve: 'provisionally_approved',
  suspendue: 'suspended',
  retiree: 'withdrawn',
}

function telecharger(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'GarageFlows/catalog-refresh' } }, (r) => {
        if (r.statusCode !== 200) {
          r.resume()
          reject(new Error(`HTTP ${r.statusCode} sur ${url}`))
          return
        }
        let d = ''
        r.setEncoding('utf8')
        r.on('data', (c) => { d += c })
        r.on('end', () => resolve(d))
      })
      .on('error', reject)
  })
}

/** Insensible à la casse et aux accents — même règle que `normalizePlatformSearch`. */
function normaliser(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function projeter(entree) {
  const statutBrut = entree?.dgfip?.statut ?? null
  const approvalStatus = STATUT[statutBrut]
  // Une entrée dont le statut d'immatriculation est inconnu n'est PAS retenue :
  // mieux vaut une liste plus courte qu'une entrée au statut inventé.
  if (!approvalStatus) return null

  const nom = String(entree.nom ?? '').trim()
  const id = String(entree.id ?? '').trim()
  if (!nom || !id) return null

  const f = entree.formats ?? {}
  return {
    id,
    officialName: nom,
    normalizedName: normaliser(nom),
    slug: id,
    approvalStatus,
    ...(entree.dgfip?.numero ? { officialRegistrationNumber: String(entree.dgfip.numero) } : {}),
    ...(entree.dgfip?.date_immatriculation ? { registeredAt: entree.dgfip.date_immatriculation } : {}),
    ...(entree.site_web ? { officialWebsite: String(entree.site_web) } : {}),
    // Formats ANNONCÉS par la plateforme dans le registre — déclaratif, jamais
    // vérifié par GarageFlows. Nommé sans ambiguïté pour cette raison.
    declaredFormats: {
      facturX: f.factur_x === true,
      ubl: f.ubl === true,
      cii: f.cii === true,
      peppolBis: f.peppol_bis === true,
    },
    declaredEReporting: entree.e_reporting === 'oui',
  }
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const iFichier = args.indexOf('--file')

  const brut = iFichier !== -1
    ? readFileSync(args[iFichier + 1], 'utf8')
    : await telecharger(SOURCE.fichier)

  const donnees = JSON.parse(brut)
  const entrees = Array.isArray(donnees) ? donnees : (donnees.data ?? donnees.plateformes ?? [])
  if (!Array.isArray(entrees) || entrees.length === 0) {
    console.error('❌ Source vide ou de forme inattendue — aucun catalogue écrit.')
    process.exit(1)
  }

  const plateformes = entrees.map(projeter).filter(Boolean)
  plateformes.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName, 'fr'))

  const ignorees = entrees.length - plateformes.length
  const catalogue = {
    source: SOURCE,
    importedAt: new Date().toISOString().slice(0, 10),
    count: plateformes.length,
    ...(ignorees > 0 ? { skipped: ignorees } : {}),
    platforms: plateformes,
  }

  if (check) {
    if (!existsSync(SORTIE)) {
      console.error(`❌ Catalogue absent : ${SORTIE}`)
      process.exit(1)
    }
    const actuel = JSON.parse(readFileSync(SORTIE, 'utf8'))
    const identique = JSON.stringify(actuel.platforms) === JSON.stringify(plateformes)
    console.log(
      identique
        ? `✅ Catalogue à jour (${plateformes.length} plateformes).`
        : `⚠️  Catalogue DIVERGENT de la source (${actuel.count} en base, ${plateformes.length} à la source).`,
    )
    process.exit(identique ? 0 : 1)
  }

  mkdirSync(dirname(SORTIE), { recursive: true })
  writeFileSync(SORTIE, `${JSON.stringify(catalogue, null, 1)}\n`, 'utf8')
  console.log(`✅ ${plateformes.length} plateformes importées${ignorees ? ` (${ignorees} ignorées : statut d'immatriculation inconnu)` : ''}.`)
  console.log(`   → ${SORTIE}`)
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
