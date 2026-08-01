/**
 * Protection contre l'injection de formules (CSV/Excel injection).
 *
 * Une cellule commençant par `= @` ou un caractère de contrôle (tab/CR/LF) peut
 * être interprétée comme une FORMULE si le fichier importé est ensuite ré-exporté
 * puis ouvert dans un tableur (exécution de commandes, DDE, exfiltration via
 * HYPERLINK/WEBSERVICE). On neutralise ces cellules en préfixant une apostrophe
 * (recommandation OWASP), TOUT EN PRÉSERVANT les données légitimes :
 *
 *   - `= @` et caractères de contrôle en tête → toujours neutralisés ;
 *   - `+ -` en tête → neutralisés UNIQUEMENT si la valeur contient une lettre
 *     (les charges utiles réelles — cmd, HYPERLINK, WEBSERVICE… — comportent des
 *     lettres, alors que les numéros de téléphone « +33… » et les nombres
 *     « -5.00 » n'en ont pas). Ces derniers sont donc conservés intacts.
 */

const HARD_TRIGGERS = ['=', '@', '\t', '\r', '\n']

/** Neutralise une cellule potentiellement interprétée comme formule. */
export function neutralizeFormula(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value
  const c = value[0]
  if (HARD_TRIGGERS.includes(c)) return "'" + value
  if ((c === '+' || c === '-') && /[A-Za-z]/.test(value)) return "'" + value
  return value
}

/** Vrai si la cellule DÉCLENCHERAIT une formule sans neutralisation. */
export function isFormulaInjection(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && neutralizeFormula(value) !== value
}
