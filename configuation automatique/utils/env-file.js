'use strict'
/**
 * Édition CHIRURGICALE des fichiers .env.
 *
 * Pourquoi ne pas réécrire le fichier entier (comme `config-core.serializeEnv`) :
 * le `.env` du dépôt contient plus de 300 lignes de documentation — objectif,
 * environnement, format attendu, conséquence si la variable est absente. Cette
 * documentation vaut plus que le temps gagné à régénérer le fichier : la
 * reconstruire la détruirait. On modifie donc UNIQUEMENT les lignes concernées.
 *
 * Deux conventions du dépôt sont respectées :
 *  · une variable facultative est documentée en commentaire `# NOM=` ; lui
 *    donner une valeur consiste à décommenter CETTE ligne, pas à ajouter un
 *    doublon en fin de fichier, qui laisserait deux déclarations du même nom ;
 *  · l'encodage reproduit exactement ce que `scripts/config-core.cjs` sait
 *    relire (`parseEnv`), vérifié par un test d'aller-retour : le configurateur
 *    ne doit jamais écrire une valeur que l'application ne pourrait pas lire.
 */

const AFFECTATION = /^([ \t]*)(?:(export)[ \t]+)?([\w.-]+)([ \t]*=[ \t]*)(.*)$/
const DECLARATION_COMMENTEE = /^([ \t]*)#[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(.*)$/
// Délimiteur de repli de dotenv. Écrit par point de code pour que ce fichier
// reste manipulable par des outils qui interprètent l'accent grave.
const ACCENT_GRAVE = '\u0060'

/** Nom de variable acceptable dans un fichier dotenv (jamais entre guillemets). */
function nomValide(nom) {
  return typeof nom === 'string' && /^[\w.-]+$/.test(nom)
}

/**
 * Encode une valeur pour dotenv.
 *
 * Reproduit la règle de `config-core.encodeValue` : guillemets doubles par
 * défaut, repli sur simple puis sur accent grave si la valeur contient déjà le
 * délimiteur, et `$` échappé pour éviter toute interpolation.
 */
function encoder(nom, valeur) {
  if (typeof valeur !== 'string' || /[\0\r\n]/.test(valeur)) {
    throw new Error(nom + ' : valeur monoligne requise dans un fichier .env.')
  }
  const delimiteur = !/["\\]/.test(valeur)
    ? '"'
    : !valeur.includes("'")
      ? "'"
      : !valeur.includes(ACCENT_GRAVE)
        ? ACCENT_GRAVE
        : null
  if (!delimiteur) throw new Error(nom + ' : combinaison de guillemets non représentable sans ambiguïté.')
  return delimiteur + valeur.replace(/\$/g, '\\$') + delimiteur
}

/** Décode la partie droite d'une affectation, selon les règles de `parseEnv`. */
function decoder(nom, brut) {
  const valeur = String(brut).trim()
  if (valeur.startsWith('"')) {
    const cite = valeur.match(/^"((?:\\.|[^"\\])*)"[ \t]*(?:#.*)?$/)
    if (!cite) return { valeur: null, malformee: true }
    return { valeur: cite[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\$/g, '$'), malformee: false }
  }
  if (valeur.startsWith("'") || valeur.startsWith(ACCENT_GRAVE)) {
    const cite = valeur.startsWith("'")
      ? valeur.match(/^'([^']*)'[ \t]*(?:#.*)?$/)
      : valeur.match(new RegExp('^' + ACCENT_GRAVE + '([^' + ACCENT_GRAVE + ']*)' + ACCENT_GRAVE + '[ \t]*(?:#.*)?$'))
    if (!cite) return { valeur: null, malformee: true }
    return { valeur: cite[1].replace(/\\\$/g, '$'), malformee: false }
  }
  return { valeur: valeur.replace(/[ \t]*#.*$/, '').trim(), malformee: false }
}

/**
 * Analyse un fichier .env en lignes typées.
 * @returns {{ lignes: object[], variables: Map<string, number[]>, declarations: Map<string, number>,
 *             malformees: string[], doublons: string[], fin: string }}
 */
function analyser(texte) {
  const source = String(texte === undefined || texte === null ? '' : texte).replace(/^\uFEFF/, '')
  const fin = source.includes('\r\n') ? '\r\n' : '\n'
  const brutes = source.split(/\r?\n/)
  const lignes = []
  const variables = new Map()
  const declarations = new Map()
  const malformees = []

  brutes.forEach((brute, index) => {
    const affectation = brute.match(AFFECTATION)
    if (affectation && !brute.trimStart().startsWith('#')) {
      const nom = affectation[3]
      const decode = decoder(nom, affectation[5])
      if (decode.malformee) malformees.push(nom)
      lignes.push({
        type: 'affectation',
        brute,
        indentation: affectation[1],
        exportation: !!affectation[2],
        nom,
        separateur: affectation[4],
        droite: affectation[5],
        valeur: decode.valeur,
        malformee: decode.malformee,
      })
      if (!variables.has(nom)) variables.set(nom, [])
      variables.get(nom).push(index)
      return
    }
    const declaration = brute.match(DECLARATION_COMMENTEE)
    if (declaration) {
      lignes.push({ type: 'declaration', brute, indentation: declaration[1], nom: declaration[2], droite: declaration[3] })
      // Première déclaration commentée rencontrée : c'est là que la variable est
      // documentée, donc l'endroit naturel pour inscrire sa valeur.
      if (!declarations.has(declaration[2])) declarations.set(declaration[2], index)
      return
    }
    lignes.push({ type: brute.trim() === '' ? 'vide' : 'commentaire', brute })
  })

  const doublons = [...variables.entries()].filter((entree) => entree[1].length > 1).map((entree) => entree[0])
  return { lignes, variables, declarations, malformees, doublons, fin }
}

/** Valeurs effectives du fichier : pour un doublon, la DERNIÈRE l'emporte (dotenv). */
function valeurs(texte) {
  const analyse = analyser(texte)
  const resultat = Object.create(null)
  for (const ligne of analyse.lignes) {
    if (ligne.type === 'affectation' && !ligne.malformee) resultat[ligne.nom] = ligne.valeur
  }
  return resultat
}

/**
 * Applique des modifications à un fichier .env, en place et sans perte.
 *
 * @param {string} texte contenu d'origine (`null` ou vide pour un nouveau fichier)
 * @param {Record<string,string>} modifications valeurs à inscrire
 * @param {{ entete?: string[], supprimer?: string[], dedoublonner?: boolean, reparerMalformees?: boolean }} options
 * @returns {{ texte: string, ajoutees: string[], modifiees: string[], inchangees: string[],
 *             decommentees: string[], supprimees: string[], dedoublonnees: string[], reparees: string[] }}
 */
function appliquer(texte, modifications, options) {
  const parametres = options || {}
  const entete = parametres.entete || []
  const supprimer = parametres.supprimer || []
  const dedoublonner = parametres.dedoublonner !== false
  const reparerMalformees = parametres.reparerMalformees !== false
  const valeursDemandees = modifications || {}
  const analyse = analyser(texte === undefined || texte === null ? '' : texte)
  const lignes = analyse.lignes.map((ligne) => ({ ...ligne }))
  const rapport = {
    ajoutees: [], modifiees: [], inchangees: [], decommentees: [],
    supprimees: [], dedoublonnees: [], reparees: [],
  }

  for (const nom of Object.keys(valeursDemandees)) {
    if (!nomValide(nom)) throw new Error('Nom de variable invalide : une identité ne peut pas être échappée dans un fichier .env.')
  }

  // 1. Doublons : la dernière déclaration gagne au chargement. On neutralise les
  //    précédentes en les commentant — jamais en les effaçant, pour garder trace
  //    de ce qui existait si la valeur conservée s'avérait la mauvaise.
  if (dedoublonner) {
    for (const [nom, positions] of analyse.variables) {
      if (positions.length < 2) continue
      for (const position of positions.slice(0, -1)) {
        lignes[position] = {
          type: 'commentaire',
          brute: '# [configurateur] doublon neutralisé (la déclaration suivante de ' + nom + ' fait foi) : ' + lignes[position].brute.trim(),
        }
      }
      rapport.dedoublonnees.push(nom)
    }
  }

  // 2. Suppressions explicites : commentées, pour rester réversibles à la main.
  for (const nom of supprimer) {
    const positions = analyse.variables.get(nom)
    if (!positions) continue
    for (const position of positions) {
      if (lignes[position].type !== 'affectation') continue
      lignes[position] = { type: 'commentaire', brute: '# [configurateur] retirée : ' + lignes[position].brute.trim() }
    }
    rapport.supprimees.push(nom)
  }

  // 3. Valeurs : remplacement sur place, décommentage d'une déclaration
  //    documentée, puis ajout en fin de fichier en dernier recours.
  const ajouts = []
  for (const [nom, valeur] of Object.entries(valeursDemandees)) {
    if (supprimer.includes(nom)) continue
    const positions = (analyse.variables.get(nom) || []).filter((position) => lignes[position].type === 'affectation')
    const cible = positions.length ? positions[positions.length - 1] : undefined
    const encodee = encoder(nom, valeur)

    if (cible !== undefined) {
      const ligne = lignes[cible]
      if (!ligne.malformee && ligne.valeur === valeur) {
        rapport.inchangees.push(nom)
        continue
      }
      if (ligne.malformee && !reparerMalformees) {
        rapport.inchangees.push(nom)
        continue
      }
      const prefixe = ligne.indentation + (ligne.exportation ? 'export ' : '') + nom + '='
      lignes[cible] = { ...ligne, type: 'affectation', brute: prefixe + encodee, valeur, malformee: false }
      if (ligne.malformee) rapport.reparees.push(nom)
      rapport.modifiees.push(nom)
      continue
    }

    const declaration = analyse.declarations.get(nom)
    if (declaration !== undefined) {
      lignes[declaration] = {
        type: 'affectation', brute: nom + '=' + encodee, nom, valeur,
        malformee: false, indentation: '', exportation: false,
      }
      rapport.decommentees.push(nom)
      rapport.ajoutees.push(nom)
      continue
    }

    ajouts.push(nom + '=' + encodee)
    rapport.ajoutees.push(nom)
  }

  let resultat = lignes.map((ligne) => ligne.brute)

  // 4. En-tête : ajouté seulement sur un fichier neuf, pour ne pas empiler des
  //    bannières à chaque exécution d'un configurateur idempotent.
  const videAvant = resultat.every((ligne) => ligne.trim() === '')
  if (videAvant && entete.length) {
    resultat = entete.map((ligne) => '# ' + ligne).concat([''], resultat.filter((ligne) => ligne.trim() !== ''))
  }

  if (ajouts.length) {
    if (resultat.length && resultat[resultat.length - 1].trim() !== '') resultat.push('')
    resultat.push(...ajouts)
  }

  let texteFinal = resultat.join(analyse.fin)
  if (!texteFinal.endsWith(analyse.fin)) texteFinal += analyse.fin
  return Object.assign({ texte: texteFinal }, rapport)
}

module.exports = { analyser, valeurs, appliquer, encoder, decoder, nomValide, ACCENT_GRAVE }
