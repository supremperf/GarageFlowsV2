'use strict'
/**
 * MOTEUR DE DÉCISION.
 *
 * Pour chaque couple (variable, cible), le moteur répond à une seule question :
 * « que faut-il faire, et pourquoi ? ». Il ne touche à rien — il produit un
 * plan que le pipeline exécute ensuite. Cette séparation permet le mode
 * `--simulation`, le rapport détaillé et les tests sans effet de bord.
 *
 * Quatre catégories, reprises du cahier des charges :
 *
 *   A — générable   : secret symétrique produit par le CSPRNG local.
 *   B — récupérable : la valeur existe déjà quelque part et peut être réutilisée.
 *   C — fournisseur : seule une ressource externe réelle peut la fournir.
 *   D — dérivable   : calculable à partir d'une autre valeur vérifiable.
 *
 * La règle qui domine toutes les autres : UNE VALEUR EXISTANTE N'EST JAMAIS
 * REMPLACÉE. Une clé symétrique protège des données déjà écrites ; la remplacer
 * ne « répare » rien, cela rend illisible ce qu'elle protégeait. Le moteur ne
 * sait pas produire une rotation, et c'est volontaire : une rotation exige une
 * migration, une fenêtre de bascule et un retour arrière, c'est-à-dire une
 * décision d'exploitation, pas une étape de configuration.
 */

const secrets = require('../security/secrets.js')
const destinations = require('../config/destinations.js')

const CATEGORIES = {
  A: 'A-generable',
  B: 'B-recuperable',
  C: 'C-fournisseur',
  D: 'D-derivable',
  PLATEFORME: 'plateforme',
  HORS_PERIMETRE: 'hors-perimetre',
}

/** Cibles gérées, et le fichier local associé à chacune. */
const CIBLES = {
  desktop: { fichier: destinations.FICHIERS.desktop, vercel: null, libelle: 'poste de développement (Electron / SQLite)' },
  development: { fichier: destinations.FICHIERS.development, vercel: 'development', libelle: 'Vercel Development' },
  preview: { fichier: destinations.FICHIERS.preview, vercel: 'preview', libelle: 'Vercel Preview' },
  production: { fichier: destinations.FICHIERS.serveur, vercel: 'production', libelle: 'Vercel Production' },
}

/** Risques de rotation qui interdisent tout remplacement automatique. */
const RISQUES_INTOUCHABLES = new Set(['critical', 'high'])

/**
 * Clés qui chiffrent ou authentifient des DONNÉES STOCKÉES. Le manifeste ne les
 * marque pas `autoGenerate`, et `config-core` sait pourtant les produire : la
 * différence est exactement la précaution à prendre. On ne les génère que sur
 * demande explicite, et jamais pour remplacer.
 */
const CLES_DE_DONNEES = new Set([
  'GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_TOTP_ENC_KEY', 'GF_EINVOICE_CREDENTIALS_KEY',
])

/**
 * Clés dont la valeur conditionne la LISIBILITÉ ou la VALIDITÉ de données déjà
 * écrites. Elles exigent une preuve d'innocuité avant toute création, pas
 * seulement le constat qu'elles sont absentes du fichier local.
 *
 * Le cas de `GF_DB_MAC_SECRET` est exemplaire. Il signe les enregistrements de
 * licence (`src/lib/license/record-mac.ts`) ; en l'absence de la variable et
 * hors production, le code applique un repli de développement. Inscrire une
 * vraie valeur change donc la clé effective : tous les enregistrements signés
 * avec le repli deviennent « altérés » aux yeux du contrôle d'intégrité. Une
 * base vide rend l'opération sans conséquence ; une base peuplée non.
 */
const CLES_LIEES_AUX_DONNEES = new Set([
  'GF_DB_MAC_SECRET', 'GF_SIGNATURE_SECRET', 'DEVICE_TOKEN_PEPPER',
  'GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_TOTP_ENC_KEY', 'GF_EINVOICE_CREDENTIALS_KEY',
])

/**
 * Clés dont le remplacement ne coûte qu'une déconnexion : les sessions et les
 * liens signés en cours deviennent invalides, rien n'est perdu. Leur création
 * est sans danger dès qu'elles sont absentes.
 */
const CLES_DE_SESSION = new Set(['NEXTAUTH_SECRET', 'GF_PORTAL_SECRET'])

/** Valeurs par défaut sûres du profil desktop, telles que `setup-dev.js` les pose. */
const DEFAUTS_DESKTOP = { DATABASE_URL: 'file:./dev.db', NEXTAUTH_URL: 'http://localhost:4028' }

/**
 * Variables que le moteur sait calculer à partir d'une autre valeur.
 * Chaque dérivation est vérifiable : elle ne « devine » rien.
 */
const DERIVATIONS = {
  GF_PRODUCTION_DB_FINGERPRINT: {
    depuis: ['DATABASE_URL@production'],
    description: 'SHA-256 de (hôte + chemin) de la base de production, sans identifiants (src/lib/env.ts).',
  },
  GF_PRIVATE_KEY: {
    depuis: ['keys/private.pem'],
    description: 'PEM de l autorité de licences encodé en base64, après contrôle de correspondance avec la clé publique embarquée.',
  },
}

/** Formate une décision, en conservant la valeur hors de toute journalisation. */
function decision(nom, cible, champs) {
  return {
    nom,
    cible,
    categorie: champs.categorie,
    action: champs.action,
    statut: champs.statut,
    raison: champs.raison,
    valeur: champs.valeur === undefined ? null : champs.valeur,
    origine: champs.origine || null,
    confiance: champs.confiance || null,
    empreinte: champs.empreinte || null,
    requise: !!champs.requise,
    avertissements: champs.avertissements || [],
    anomalies: champs.anomalies || [],
  }
}

/**
 * Variables concernées par une cible donnée.
 * Une variable appartient à une cible si son fichier local y correspond ou si
 * la politique lui attribue cette cible Vercel.
 */
function variablesPourCible(entrees, cible) {
  const definition = CIBLES[cible]
  return entrees.filter((entree) => {
    const regle = entree.destination
    if (regle.fichiers.includes(definition.fichier)) return true
    if (definition.vercel && regle.cibles.includes(definition.vercel)) return true
    return false
  })
}

/**
 * Décide le sort d'une variable pour une cible.
 *
 * @param {object} contexte
 *   - entree : variable du manifeste unifié
 *   - cible : clé de CIBLES
 *   - candidats : valeurs découvertes pour ce nom
 *   - existante : valeur déjà en place dans la cible (fichier ou Vercel)
 *   - presenteDistante : la variable existe-t-elle chez Vercel pour cette cible
 *   - lisibleDistante : sa valeur distante est-elle relisible
 *   - options : autorisations explicites
 */
function deciderVariable(contexte) {
  const { entree, cible, candidats, existante, presenteDistante, lisibleDistante, options, brouillonsProuves } = contexte
  const nom = entree.name
  const regle = entree.destination
  const requise = regle.cibles.includes(CIBLES[cible].vercel) && !!entree.requiredProduction
  const risque = entree.rotationRisk || 'inconnu'

  // 0. Hors périmètre : rien à faire, et il faut le dire plutôt que de laisser
  //    croire à un oubli.
  if (regle.categorieDestination === 'plateforme') {
    return decision(nom, cible, {
      categorie: CATEGORIES.PLATEFORME, action: 'ignorer', statut: 'SKIPPED',
      raison: 'Injectée par la plateforme ; jamais provisionnée.',
    })
  }
  if (['aucune', 'build', 'outillage', 'publication', 'runtime-desktop', 'interdite'].includes(regle.categorieDestination)) {
    return decision(nom, cible, {
      categorie: CATEGORIES.HORS_PERIMETRE, action: 'ignorer', statut: 'SKIPPED',
      raison: regle.raison,
    })
  }
  if (regle.autorisationExplicite && !options[regle.autorisationExplicite]) {
    return decision(nom, cible, {
      categorie: CATEGORIES.HORS_PERIMETRE, action: 'ignorer', statut: 'SKIPPED', requise,
      raison: regle.raison + ' Autorisation explicite requise (--' + regle.autorisationExplicite + ').',
    })
  }

  // 1. Une valeur est déjà en place. C'est le cas le plus fréquent et le plus
  //    important : on la conserve, on la contrôle, on ne la remplace pas.
  if (existante && existante.valeur) {
    const controle = secrets.conforme(nom, existante.valeur)
    if (controle.conforme) {
      return decision(nom, cible, {
        categorie: CATEGORIES.B, action: 'reutiliser', statut: 'REUSED', requise,
        valeur: existante.valeur, origine: existante.origine, confiance: existante.confiance,
        empreinte: existante.empreinte,
        raison: 'Valeur existante conforme ; conservée sans modification.',
      })
    }
    // Format invalide. Remplacer une clé à risque élevé casserait les données
    // qu'elle protège : on bloque et on explique, au lieu de « réparer ».
    if (RISQUES_INTOUCHABLES.has(risque)) {
      return decision(nom, cible, {
        categorie: CATEGORIES.B, action: 'bloquer', statut: 'BLOCKED', requise,
        valeur: existante.valeur, origine: existante.origine, confiance: existante.confiance,
        empreinte: existante.empreinte, anomalies: controle.anomalies,
        raison: 'Valeur existante non conforme, mais rotation à risque ' + risque +
          ' : remplacer cette clé rendrait illisibles les données déjà protégées. Correction manuelle avec migration.',
      })
    }
    return decision(nom, cible, {
      categorie: CATEGORIES.A, action: 'generer', statut: 'GENERATED', requise,
      anomalies: controle.anomalies,
      raison: 'Valeur existante non conforme et rotation à risque ' + risque + ' : régénérée (' + controle.anomalies[0] + ').',
    })
  }

  // 2. Variable absente localement mais présente chez Vercel sans être
  //    relisible (type Sensitive). Rien ne manque : la variable EST configurée,
  //    et sa valeur est protégée en lecture — c'est le comportement attendu
  //    d'un secret de production.
  //
  //    Le statut est donc `REUSED`, pas `BLOCKED` : annoncer un blocage sur une
  //    configuration complète enverrait chercher un problème qui n'existe pas.
  //    La seule conséquence réelle est que le miroir local ne peut pas être
  //    rempli pour cette variable, ce que la raison explicite.
  if (presenteDistante && !lisibleDistante) {
    return decision(nom, cible, {
      categorie: CATEGORIES.B, action: 'conserver', statut: 'REUSED', requise,
      avertissements: ['Valeur non relisible depuis ce poste : elle ne peut pas être recopiée dans un fichier local ni comparée à une valeur locale.'],
      raison: 'Présente chez Vercel et protégée en lecture (Sensitive) : conservée telle quelle. ' +
        'Aucune génération, aucune rotation — la régénérer invaliderait la valeur qui sert en ligne.',
    })
  }

  // 3. Dérivation : préférée à la génération, car elle rend une valeur
  //    cohérente avec le reste du système plutôt qu'une valeur neuve.
  const derivation = DERIVATIONS[nom]
  if (derivation && contexte.derivee && contexte.derivee.valeur) {
    return decision(nom, cible, {
      categorie: CATEGORIES.D, action: 'deriver', statut: 'SUCCESS', requise,
      valeur: contexte.derivee.valeur, origine: contexte.derivee.origine, confiance: 'prouvee',
      empreinte: contexte.derivee.empreinte,
      raison: 'Valeur calculée et vérifiée : ' + derivation.description,
    })
  }
  if (derivation && contexte.derivee && contexte.derivee.bloque) {
    return decision(nom, cible, {
      categorie: CATEGORIES.D, action: 'bloquer', statut: 'BLOCKED', requise,
      raison: contexte.derivee.bloque,
    })
  }

  // 4. Récupération : une valeur connue ailleurs, et la politique autorise sa
  //    réutilisation pour cette cible.
  const candidat = require('./discovery.js').choisir(candidats, nom, cible, { brouillonsProuves })
  if (candidat) {
    const controle = secrets.conforme(nom, candidat.valeur)
    if (!controle.conforme) {
      return decision(nom, cible, {
        categorie: CATEGORIES.B, action: 'bloquer', statut: 'BLOCKED', requise,
        anomalies: controle.anomalies, origine: candidat.origine,
        raison: 'Valeur trouvée (' + candidat.origine + ') non conforme au format attendu ; non importée.',
      })
    }
    const avertissements = []
    if (candidat.confiance === 'brouillon') {
      avertissements.push('Valeur issue d un brouillon interrompu, confirmée par un contrôle réel avant usage.')
    }
    if (candidat.cible && candidat.cible !== cible) {
      avertissements.push('Valeur reprise de la cible ' + candidat.cible + ' (variable déclarée copiable entre environnements).')
    }
    return decision(nom, cible, {
      categorie: CATEGORIES.B, action: 'recuperer', statut: 'REUSED', requise,
      valeur: candidat.valeur, origine: candidat.origine, confiance: candidat.confiance,
      empreinte: candidat.empreinte, avertissements,
      raison: 'Valeur existante récupérée depuis ' + candidat.origine + ' ; aucune génération.',
    })
  }

  // 5. Défaut sûr du profil desktop : ce ne sont pas des secrets, et ce sont
  //    les valeurs que `scripts/setup-dev.js` pose déjà.
  if (cible === 'desktop' && DEFAUTS_DESKTOP[nom]) {
    return decision(nom, cible, {
      categorie: CATEGORIES.D, action: 'deriver', statut: 'SUCCESS',
      valeur: DEFAUTS_DESKTOP[nom], origine: 'defaut-desktop', confiance: 'prouvee',
      raison: 'Valeur par défaut du profil desktop, identique à celle de scripts/setup-dev.js.',
    })
  }

  // 6. Génération : dernier recours, et seulement pour un secret symétrique
  //    dont la génération est explicitement prévue ET dont l'absence est PROUVÉE.
  if (secrets.generable(nom)) {
    const prevueParLeManifeste = !!entree.autoGenerate
    const cleDeChiffrement = CLES_DE_DONNEES.has(nom)
    const lieeAuxDonnees = CLES_LIEES_AUX_DONNEES.has(nom)
    const autorisee = prevueParLeManifeste || (cleDeChiffrement && options.genererClesChiffrement)

    if (!autorisee && cleDeChiffrement) {
      return decision(nom, cible, {
        categorie: CATEGORIES.A, action: 'ignorer', statut: 'SKIPPED', requise,
        raison: 'Clé de chiffrement de données absente. Sa création n est pas automatique : ' +
          'activer la fonctionnalité associée est une décision d exploitation (--generer-cles-chiffrement pour l autoriser).',
      })
    }

    if (autorisee) {
      // 6a. Une cible Vercel dont l'état distant n'a pas pu être lu interdit la
      //     génération. L'absence d'un fichier local ne prouve RIEN sur le
      //     projet distant : générer ici produirait une valeur locale
      //     différente de celle qui sert en ligne, et la divergence ne serait
      //     découverte qu'au premier déploiement.
      if (contexte.environnementDistant && !contexte.distantConnu) {
        return decision(nom, cible, {
          categorie: CATEGORIES.A, action: 'bloquer', statut: 'BLOCKED', requise,
          raison: 'Génération refusée : l état de l environnement Vercel « ' + contexte.environnementDistant
            + ' » n a pas pu être lu (hors ligne, session absente ou lecture refusée). '
            + 'L absence de fichier local ne prouve pas que la variable est absente en ligne ; la créer serait une rotation à l aveugle.',
        })
      }

      // 6b. Une clé liée à des données déjà écrites exige une base vide.
      if (lieeAuxDonnees && contexte.baseVide === false) {
        return decision(nom, cible, {
          categorie: CATEGORIES.A, action: 'bloquer', statut: 'BLOCKED', requise,
          raison: 'Génération refusée : la base de la cible « ' + cible + ' » contient des données métier. '
            + 'Cette clé protège ou authentifie des enregistrements existants — en créer une nouvelle les rendrait illisibles ou invalides. '
            + 'Fournir la valeur d origine, ou procéder à une rotation avec migration.',
        })
      }
      if (lieeAuxDonnees && contexte.baseVide === null) {
        return decision(nom, cible, {
          categorie: CATEGORIES.A, action: 'bloquer', statut: 'BLOCKED', requise,
          raison: 'Génération refusée : impossible de vérifier que la base de « ' + cible + ' » est vide. '
            + 'Une clé liée aux données n est créée que lorsque l innocuité de l opération est démontrée.',
        })
      }

      const avertissements = []
      if (cleDeChiffrement) {
        avertissements.push('Clé de chiffrement créée pour ' + cible + ' sur une base vérifiée sans donnée métier.')
      }
      if (CLES_DE_SESSION.has(nom)) {
        avertissements.push('Création d un secret de session : les sessions et liens signés en cours deviennent invalides (reconnexion nécessaire).')
      }
      if (risque === 'critical') {
        avertissements.push('Rotation ultérieure de cette clé classée critique : elle exigera une migration explicite.')
      }
      return decision(nom, cible, {
        categorie: CATEGORIES.A, action: 'generer', statut: 'GENERATED', requise, avertissements,
        raison: 'Absence vérifiée' + (contexte.environnementDistant ? ' localement et dans l environnement ' + contexte.environnementDistant : ' sur ce poste')
          + ' : secret généré localement (CSPRNG, ' + secrets.specification(nom).encodage + ' '
          + secrets.specification(nom).octets + ' octets).',
      })
    }
  }

  // 7. Valeur de configuration non secrète avec un défaut connu du dépôt.
  if (contexte.defautConnu !== undefined && contexte.defautConnu !== null) {
    if (!options.completerFacultatives) {
      return decision(nom, cible, {
        categorie: CATEGORIES.B, action: 'ignorer', statut: 'SKIPPED', requise,
        raison: 'Facultative : le code applique déjà cette valeur par défaut. Non ajoutée pour éviter une configuration en double (--completer-facultatives pour l inscrire).',
      })
    }
    return decision(nom, cible, {
      categorie: CATEGORIES.B, action: 'recuperer', statut: 'SUCCESS', requise,
      valeur: contexte.defautConnu, origine: 'defaut-depot', confiance: 'prouvee',
      raison: 'Valeur par défaut documentée du dépôt (scripts/config-core.cjs DEFAULTS).',
    })
  }

  // 8. Rien ne peut la produire : seule une ressource externe réelle le peut.
  //    Une variable DÉRIVABLE dont la source manque relève du même constat,
  //    mais le message doit nommer la source attendue plutôt que de laisser
  //    croire qu'il faut la saisir à la main.
  if (derivation) {
    return decision(nom, cible, {
      categorie: CATEGORIES.D, action: 'bloquer', statut: requise ? 'BLOCKED' : 'SKIPPED', requise,
      raison: 'Valeur calculable mais source indisponible (' + derivation.depuis.join(', ') + '). ' + derivation.description,
    })
  }
  const externe = ['external', 'external-config', 'external-path', 'secret', 'dangerous-external'].includes(entree.classification)
  if (requise) {
    return decision(nom, cible, {
      categorie: CATEGORIES.C, action: 'bloquer', statut: 'BLOCKED', requise,
      raison: 'Requise et introuvable : seule une ressource externe réelle peut la fournir (aucune valeur inventée).',
    })
  }
  if (externe) {
    // Facultative et absente : ce n'est pas une anomalie, c'est une
    // fonctionnalité non activée. `SKIPPED` le dit sans crier au loup.
    return decision(nom, cible, {
      categorie: CATEGORIES.C, action: 'ignorer', statut: 'SKIPPED', requise,
      raison: 'Facultative et absente : ' + (entree.fiche ? entree.fiche.siAbsente : 'la fonctionnalité associée reste inactive')
        + ' Aucune valeur inventée.',
    })
  }

  return decision(nom, cible, {
    categorie: CATEGORIES.HORS_PERIMETRE, action: 'ignorer', statut: 'SKIPPED', requise,
    raison: 'Absente, facultative et sans défaut : aucune action.',
  })
}

/**
 * Construit le plan complet, cible par cible.
 *
 * @param {object} contexte
 *   - unifie : manifeste unifié
 *   - decouverte : résultat de `discovery.collecter`
 *   - distant : { production: snapshot, preview: snapshot, development: snapshot }
 *   - derivees : { 'NOM@cible': { valeur | bloque } }
 *   - cibles : liste des cibles à planifier
 *   - options : autorisations
 */
function planifier(contexte) {
  const { unifie, decouverte, distant = {}, derivees = {}, options = {} } = contexte
  const cibles = contexte.cibles || ['desktop', 'production']
  const brouillonsProuves = contexte.brouillonsProuves || new Set()
  const plan = { cibles: {}, parStatut: {}, avertissements: [], anomalies: [] }

  for (const cible of cibles) {
    const definition = CIBLES[cible]
    if (!definition) throw new Error('Cible de configuration inconnue : ' + cible)
    const snapshot = definition.vercel ? distant[definition.vercel] : null
    const decisions = []

    for (const entree of variablesPourCible(unifie.entrees, cible)) {
      const nom = entree.name
      const candidats = decouverte.parNom.get(nom) || []
      // Valeur déjà en place POUR CETTE CIBLE : fichier de la cible, ou valeur
      // distante relisible de l'environnement Vercel correspondant.
      const localeCible = candidats.find((candidat) => candidat.origine === 'fichier:' + definition.fichier)
      const distanteLisible = snapshot && snapshot.valeurs && snapshot.valeurs[nom]
        ? { valeur: snapshot.valeurs[nom], origine: 'vercel:' + definition.vercel, confiance: 'prouvee' }
        : null
      const existante = localeCible || distanteLisible
      const presenteDistante = !!(snapshot && snapshot.presentes && snapshot.presentes.has(nom))
      const lisibleDistante = !!distanteLisible

      decisions.push(deciderVariable({
        entree,
        cible,
        candidats,
        existante,
        presenteDistante,
        lisibleDistante,
        // Preuves nécessaires avant toute génération : l'état de l'environnement
        // distant, et la vacuité de la base de cette cible.
        environnementDistant: definition.vercel,
        distantConnu: definition.vercel ? !!snapshot : true,
        baseVide: Object.prototype.hasOwnProperty.call(contexte.basesVides || {}, cible)
          ? contexte.basesVides[cible]
          : null,
        derivee: derivees[nom + '@' + cible] || derivees[nom] || null,
        defautConnu: unifie.defauts[nom],
        options,
        brouillonsProuves,
      }))
    }

    plan.cibles[cible] = { cible, definition, decisions }
    for (const prise of decisions) {
      plan.parStatut[prise.statut] = (plan.parStatut[prise.statut] || 0) + 1
    }
  }

  return plan
}

/** Décisions d'une cible qui produisent une écriture locale. */
function valeursAEcrire(planCible) {
  const valeurs = {}
  for (const prise of planCible.decisions) {
    if (!['reutiliser', 'recuperer', 'deriver', 'generer'].includes(prise.action)) continue
    if (!prise.valeur) continue
    valeurs[prise.nom] = prise.valeur
  }
  return valeurs
}

module.exports = {
  CATEGORIES, CIBLES, CLES_DE_DONNEES, CLES_LIEES_AUX_DONNEES, CLES_DE_SESSION,
  DEFAUTS_DESKTOP, DERIVATIONS, RISQUES_INTOUCHABLES,
  decision, variablesPourCible, deciderVariable, planifier, valeursAEcrire,
}
