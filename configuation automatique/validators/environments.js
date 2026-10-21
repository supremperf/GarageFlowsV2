'use strict'
/**
 * COHÉRENCE ENTRE ENVIRONNEMENTS.
 *
 * Chaque environnement pris isolément peut être parfaitement valide, et
 * l'ensemble rester dangereux. Les cas que ce module traque sont tous arrivés
 * dans ce dépôt ou sont explicitement documentés par son code :
 *
 *   · ISOLATION PREVIEW — une intégration Marketplace est attachée au PROJET,
 *     donc ses variables sont injectées en Production ET en Preview. Sans
 *     surcharge, chaque déploiement de branche écrit dans les données réelles
 *     des clients. `src/lib/env.ts` détecte le cas via
 *     `GF_PRODUCTION_DB_FINGERPRINT` — mais seulement si cette variable est
 *     provisionnée partout : une garde non provisionnée est une garde absente.
 *
 *   · ALIAS HISTORIQUES — `PWA_DATABASE_URL` portait la même valeur que
 *     `DATABASE_URL` et était recopiée au démarrage par un correctif absent du
 *     dépôt. Tout déploiement fait autrement démarrait sans la recopie
 *     (incident du 15/08/2026). Leur présence chez Vercel est une anomalie.
 *
 *   · SECRET SOUS UN NOM PUBLIC — une variable `NEXT_PUBLIC_*` est inlinée
 *     dans le bundle navigateur par Next.js. Un secret y est public.
 *
 *   · SURCHARGE DE RUNTIME — `NODE_ENV` autre que production, ou `ELECTRON`
 *     déclarée sur le projet PWA : le code choisit son client Prisma et son
 *     mode d'exécution sur ces valeurs.
 */

const path = require('node:path')

/**
 * @param {string} racine
 * @param {object} unifie manifeste unifié
 * @param {Record<string, object>} snapshots état lu par environnement Vercel
 * @param {{ empreinteProduction?: string|null }} options
 */
function verifier(racine, unifie, snapshots, options = {}) {
  const rapport = {
    aliasPresents: [],
    inconnuesDuContrat: [],
    secretsSousNomPublic: [],
    surchargesRuntime: [],
    presenceParEnvironnement: {},
    requisesManquantes: {},
    isolationPreview: { verifiable: false, conclusion: 'non vérifiée', detail: null },
    anomalies: [],
    avertissements: [],
  }

  const destinations = require('../config/destinations.js')
  const plateforme = unifie.plateforme
  const alias = unifie.aliasInterdits

  for (const [environnement, snapshot] of Object.entries(snapshots)) {
    if (!snapshot) continue
    const presentes = [...snapshot.presentes].sort()
    rapport.presenceParEnvironnement[environnement] = {
      total: presentes.length,
      lisibles: Object.keys(snapshot.valeurs).filter((nom) => snapshot.valeurs[nom]).length,
      cachees: snapshot.cachees.size,
      protegees: snapshot.protegees.size,
      surchargesBranche: snapshot.surchargesBranche,
    }

    for (const nom of presentes) {
      if (alias[nom]) {
        // Une variable d'intégration ne se renomme pas : Neon fournit
        // `DATABASE_URL_UNPOOLED` et le retirer casserait le lien du projet
        // avec le service. On distingue donc les deux cas.
        const detenuePar = snapshot.protegees.has(nom) ? 'integration' : 'projet'
        rapport.aliasPresents.push({ nom, environnement, canonique: alias[nom].canonical, detenuePar })
        continue
      }
      if (!unifie.parNom.has(nom) && !plateforme.has(nom)) {
        rapport.inconnuesDuContrat.push({ nom, environnement, protegee: snapshot.protegees.has(nom) })
      }
      if (/^NEXT_PUBLIC_/.test(nom) && /SECRET|PRIVATE|PEPPER|TOKEN|API_KEY|PASSWORD|CREDENTIAL/i.test(nom)) {
        rapport.secretsSousNomPublic.push({ nom, environnement })
      }
      if (nom === 'ELECTRON') {
        rapport.surchargesRuntime.push({ nom, environnement, probleme: 'variable du runtime desktop déclarée sur le projet PWA' })
      }
    }
    const nodeEnv = snapshot.valeurs.NODE_ENV
    if (nodeEnv && nodeEnv !== 'production') {
      rapport.surchargesRuntime.push({ nom: 'NODE_ENV', environnement, probleme: 'valeur « ' + nodeEnv + ' » sur un déploiement Vercel' })
    }

    // Variables requises par la politique pour cet environnement.
    const requises = unifie.entrees
      .filter((entree) => entree.destination.cibles.includes(environnement))
      .filter((entree) => entree.requiredProduction)
      .map((entree) => entree.name)
    const manquantes = requises.filter((nom) => !snapshot.presentes.has(nom))
    rapport.requisesManquantes[environnement] = manquantes
    if (manquantes.length) {
      rapport.anomalies.push(environnement + ' : variable(s) requise(s) absente(s) chez Vercel — ' + manquantes.join(', ') + '.')
    }
  }

  const aliasProjet = rapport.aliasPresents.filter((element) => element.detenuePar === 'projet')
  if (aliasProjet.length) {
    rapport.anomalies.push('Alias historiques déclarés sur le projet : '
      + aliasProjet.map((element) => element.nom + ' (' + element.environnement + ')').join(', ')
      + '. Migrer vers le nom canonique puis les retirer manuellement.')
  }
  const aliasIntegration = rapport.aliasPresents.filter((element) => element.detenuePar === 'integration')
  if (aliasIntegration.length) {
    rapport.avertissements.push('Alias fournis par une intégration Marketplace : '
      + [...new Set(aliasIntegration.map((element) => element.nom))].join(', ')
      + '. Ils appartiennent au fournisseur (Neon, Upstash) ; les supprimer casserait le rattachement du projet. Laissés intacts.')
  }
  if (rapport.secretsSousNomPublic.length) {
    rapport.anomalies.push('Secret déclaré sous un nom NEXT_PUBLIC_ (inliné dans le bundle navigateur) : '
      + rapport.secretsSousNomPublic.map((element) => element.nom + ' (' + element.environnement + ')').join(', ')
      + '. Renommer ET renouveler la valeur : elle doit être considérée comme publiée.')
  }
  for (const surcharge of rapport.surchargesRuntime) {
    rapport.anomalies.push(surcharge.environnement + ' : ' + surcharge.nom + ' — ' + surcharge.probleme + '.')
  }

  // ── Isolation Preview ──────────────────────────────────────────────────────
  const preview = snapshots.preview
  const production = snapshots.production
  if (preview) {
    const postgres = require('../providers/postgres.js')
    const empreinteAttendue = options.empreinteProduction
      || (production && production.valeurs.GF_PRODUCTION_DB_FINGERPRINT)
      || preview.valeurs.GF_PRODUCTION_DB_FINGERPRINT
      || null
    const urlPreview = preview.valeurs.DATABASE_URL || preview.aliasRessources?.DATABASE_URL || null
    const empreintePreview = postgres.empreinteCible(urlPreview)

    if (!preview.presentes.has('GF_PRODUCTION_DB_FINGERPRINT')) {
      rapport.isolationPreview = {
        verifiable: false,
        conclusion: 'garde absente',
        detail: 'GF_PRODUCTION_DB_FINGERPRINT n est pas déclarée en Preview : la garde de src/lib/env.ts ne peut rien affirmer, '
          + 'et un déploiement de branche pourrait écrire dans la base de production sans être arrêté.',
      }
      rapport.anomalies.push('Preview : garde d isolation non provisionnée (GF_PRODUCTION_DB_FINGERPRINT absente).')
    } else if (!empreinteAttendue || !empreintePreview) {
      rapport.isolationPreview = {
        verifiable: false,
        conclusion: 'non vérifiable',
        detail: 'Les valeurs nécessaires ne sont pas relisibles (variables Sensitive) : la garde est provisionnée, '
          + 'mais le configurateur ne peut pas confirmer lui-même que Preview et Production visent des bases distinctes.',
      }
      rapport.avertissements.push('Preview : isolation provisionnée mais non vérifiable depuis ce poste (valeurs non relisibles chez Vercel).')
    } else if (empreinteAttendue === empreintePreview) {
      rapport.isolationPreview = {
        verifiable: true,
        conclusion: 'VIOLÉE',
        detail: 'La base visée par Preview porte l empreinte de la base de PRODUCTION. Chaque déploiement de branche écrirait '
          + 'dans les données réelles. Surcharger DATABASE_URL et DIRECT_URL au niveau Preview avec une branche dédiée.',
      }
      rapport.anomalies.push('Preview pointe vers la base de PRODUCTION : isolation violée.')
    } else {
      rapport.isolationPreview = {
        verifiable: true,
        conclusion: 'respectée',
        detail: 'Preview vise une base distincte de celle désignée par GF_PRODUCTION_DB_FINGERPRINT.',
      }
    }
  }

  // Variables qui n'existent que dans un seul environnement alors que la
  // politique en demande plusieurs : signalé, jamais corrigé en recopiant une
  // valeur propre à un environnement.
  const environnements = Object.keys(snapshots).filter((nom) => snapshots[nom])
  for (const entree of unifie.entrees) {
    const attendues = entree.destination.cibles.filter((cible) => environnements.includes(cible))
    if (attendues.length < 2) continue
    const presentesDans = attendues.filter((cible) => snapshots[cible].presentes.has(entree.name))
    if (presentesDans.length && presentesDans.length < attendues.length) {
      const manquantes = attendues.filter((cible) => !presentesDans.includes(cible))
      rapport.avertissements.push(entree.name + ' : présente dans ' + presentesDans.join(', ')
        + ' mais absente dans ' + manquantes.join(', ')
        + (destinations.copiableEntreEnvironnements(entree.name)
          ? '. Valeur copiable : elle peut être synchronisée.'
          : '. Valeur propre à chaque environnement : à provisionner séparément, jamais recopiée.'))
    }
  }

  rapport.ok = rapport.anomalies.length === 0
  return rapport
}

module.exports = { verifier }
