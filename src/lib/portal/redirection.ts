/**
 * Ce qu'une réponse du portail IMPOSE à la page appelante (GF-DUR-016).
 *
 * ─── Pourquoi ce point unique ───────────────────────────────────────────────
 * Deux refus du serveur ne sont pas des erreurs mais des ORDRES de navigation :
 *
 *   · `401` — la session est finie : retour à la connexion ;
 *   · `403 PASSWORD_CHANGE_REQUIRED` — le garage a remis un mot de passe
 *     provisoire, et TOUTES les routes du portail restent fermées tant qu'il
 *     n'est pas remplacé.
 *
 * Le second était traité nulle part. Les pages considéraient tout échec non-401
 * comme « pas de données », si bien qu'un client à qui l'on venait d'ouvrir un
 * accès voyait un espace BLANC, sans explication ni issue. Le défaut ne tenait
 * pas à une page en particulier : il tenait à ce que personne ne regardait ce
 * code.
 *
 * Chaque page appelle donc cette fonction plutôt que de deviner. Une page qui
 * l'oublie retombe dans le même piège — d'où le test qui vérifie qu'elles s'en
 * servent toutes.
 */

import { lienPortail } from './garage-slug'
import { cheminPortail } from './routes'

/**
 * Cible de redirection imposée par la réponse, ou `null` si la page continue.
 *
 * La réponse est CLONÉE avant lecture : l'appelant doit pouvoir exploiter son
 * corps ensuite, ce qu'une lecture directe lui interdirait.
 */
export async function redirectionPortail(res: Response): Promise<string | null> {
  if (res.status === 401) return lienPortail(cheminPortail('login'))

  if (res.status === 403) {
    const corps = await res.clone().json().catch(() => null) as { code?: unknown } | null
    if (corps?.code === 'PASSWORD_CHANGE_REQUIRED') {
      // `requis=1` : l'écran dit alors au client POURQUOI on le lui impose. Sans
      // ce mot, il croirait à un changement volontaire qu'il n'a pas demandé.
      // `lienPortail` a pu déjà poser un `?garage=…` : le séparateur en dépend.
      const cible = lienPortail(cheminPortail('password'))
      return `${cible}${cible.includes('?') ? '&' : '?'}requis=1`
    }
  }

  return null
}
