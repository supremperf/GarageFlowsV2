/** Small, build-time knowledge index. No runtime crawl, embeddings or tenant data. */
import { can, type Permission } from '@/lib/authz'

export interface KnowledgeArticle {
  id: string
  title: string
  keywords: string[]
  text: string
  permission?: Permission
  source: { path: string; anchor: string }
}
export const KNOWLEDGE_VERSION = '2026-10-15.2'
export const KNOWLEDGE: readonly KnowledgeArticle[] = [
  { id: 'planning', title: 'Planning et rendez-vous', keywords: ['planning', 'rdv', 'rendez vous', 'intervention', 'planifier'], permission: 'job:manage',
    text: 'Depuis le planning, créer une intervention avec le client, le véhicule, la date, l’heure et le mécanicien. « Crée un rendez-vous » ouvre le formulaire après confirmation ; le chat ne crée pas une intervention avec des champs manquants.',
    source: { path: 'src/app/page.tsx', anchor: "case 'create_appointment': openCreateModal()" } },
  { id: 'quotes', title: 'Devis et facturation', keywords: ['devis', 'facture', 'facturation', 'valider', 'document'], permission: 'quote:manage',
    text: 'Ouvrir le panneau Facturation pour préparer un devis et ses lignes. La proposition « Crée un devis » ouvre ce panneau : vérifier le destinataire, les lignes et les montants avant enregistrement. « Quels devis sont en attente ? » consulte les devis du garage. Les coûts et les indicateurs financiers dépendent des permissions.',
    source: { path: 'src/app/page.tsx', anchor: "case 'create_quote':       ouvrirPage('billing')" } },
  { id: 'stock', title: 'Stock et pièces à commander', keywords: ['stock', 'piece', 'pieces', 'rupture', 'commander', 'reapprovisionnement'],
    text: '« Quelles pièces sont en rupture de stock ? » consulte les besoins de réapprovisionnement. Les coûts d’achat sont retirés pour les utilisateurs sans accès financier. Un besoin de réapprovisionnement n’est pas une commande déjà passée.',
    source: { path: 'src/lib/copilot/server-readers.ts', anchor: 'redactReorderCosts(' } },
  { id: 'purchases', title: 'Commandes fournisseurs', keywords: ['fournisseur', 'fournisseurs', 'commande', 'achat'], permission: 'stock:manage',
    text: '« Commander des pièces » propose d’ouvrir l’outil fournisseurs. Le formulaire de commande doit être complété et validé. La création d’une commande requiert stock:manage côté serveur ; le copilote n’envoie pas de commande automatiquement.',
    source: { path: 'src/app/api/purchase-orders/route.ts', anchor: "'stock:manage'" } },
  { id: 'clients', title: 'Clients et véhicules', keywords: ['client', 'clients', 'vehicule', 'vehicules', 'immatriculation'], permission: 'customer:manage',
    text: 'Les fiches clients et leurs véhicules sont liés au garage connecté. La recherche client utilise un nom et retourne les véhicules associés. Pour retrouver une intervention dans le chat, donner une immatriculation ou un nom : « retrouve le dossier AB-123-CD ». Sans référence, le copilote demande une précision.',
    source: { path: 'src/app/api/clients/route.ts', anchor: 'garageId: session.user.garageId' } },
  { id: 'finance', title: 'Chiffre d’affaires, marge et prévision', keywords: ['chiffre', 'affaires', 'marge', 'rentabilite', 'prevision', 'ca', 'finance'], permission: 'financial:read',
    text: 'Les indicateurs de chiffre d’affaires, de marge, meilleurs clients et prévisions sont réservés à financial:read. Les données proviennent des moteurs de calcul et des factures du garage. Une prévision n’est pas un chiffre réalisé ; le modèle ne recalcule ni ne remplace les montants.',
    source: { path: 'src/lib/copilot/tools.ts', anchor: "'financial:read'" } },
  { id: 'reports', title: 'Analyser mon garage et historique', keywords: ['analyse', 'rapport', 'rapports', 'export', 'historique', 'pdf', 'csv'], permission: 'financial:read',
    text: 'La page Copilote « Analyser mon garage » propose les périodes affichées, un rapport calculé depuis les données réelles, un export PDF/CSV et une historisation explicite. L’historique est filtré par garage et réservé à financial:read. Une analyse affichée n’est pas historisée tant que l’enregistrement n’a pas réussi.',
    source: { path: 'src/app/api/copilot/reports/route.ts', anchor: 'prisma.reportSnapshot.create' } },
  { id: 'reminders', title: 'Rappels clients', keywords: ['rappel', 'relance', 'notification', 'envoyer'], permission: 'customer:manage',
    text: 'La proposition « Envoyer un rappel » ouvre le panneau Rappels. Vérifier le destinataire et le contenu dans l’outil avant l’envoi. La confirmation du chat ne signifie pas que le message a été envoyé.',
    source: { path: 'src/app/page.tsx', anchor: "case 'send_reminder':      ouvrirPage('reminders')" } },
  { id: 'mechanics', title: 'Espace mécanicien', keywords: ['mecanicien', 'mecaniciens', 'affectation', 'absence', 'disponible', 'chrono'],
    text: 'L’espace mécanicien utilise une session de licence distincte et un périmètre d’interventions attribuées. Ses permissions ne donnent pas un accès global aux finances ou à tous les dossiers du garage. Le copilote du comptoir ne remplace pas cette session.',
    source: { path: 'src/lib/authz.ts', anchor: 'const MECHANIC_PERMISSIONS' } },
  { id: 'diagnostic', title: 'Diagnostic et VIN', keywords: ['diagnostic', 'panne', 'obd', 'defaut', 'vin', 'chassis'],
    text: 'Fournir un symptôme ou un code défaut pour obtenir des causes possibles du moteur de diagnostic. Ce sont des pistes, pas une certitude sur le véhicule. Le décodage VIN demande le VIN complet ; une information absente ne doit pas être inventée.',
    source: { path: 'src/lib/copilot/server-readers.ts', anchor: "case 'diagnostic'" } },
  { id: 'ocr', title: 'Extraction OCR de texte reconnu', keywords: ['ocr', 'scanner', 'scan', 'carte grise', 'document'],
    text: 'L’API OCR structure du texte déjà reconnu en amont. Une présence de route OCR ne signifie pas qu’un moteur universel d’image est configuré : l’entrée texte est requise par cette API et les informations restent à vérifier avant enregistrement.',
    source: { path: 'src/app/api/ocr/route.ts', anchor: 'text requis (OCR effectué en amont)' } },
  { id: 'plate-photo', title: 'Photo de plaque', keywords: ['photo', 'plaque', 'photographier', 'camera'],
    text: 'La lecture d’une plaque sur photo passe par /api/plate-ocr et Anthropic, avec une clé serveur et un accès réseau. Elle valide la forme de l’immatriculation renvoyée ; relire la plaque avant de l’utiliser. Ce service est distinct de /api/ocr (texte) et du modèle de classification du chat.',
    source: { path: 'src/app/api/plate-ocr/route.ts', anchor: 'client.messages.create' } },
  { id: 'security', title: 'Permissions et confidentialité', keywords: ['permission', 'acces', 'securite', 'confidentialite', 'autorisation', 'secret'],
    text: 'Les droits et le garage sont vérifiés côté serveur à partir de la session. Une demande, un document, un ancien message ou un modèle ne peuvent pas accorder un droit. Ne pas communiquer de clé, mot de passe ou jeton au copilote. Les résultats métier ne sont pas envoyés au modèle de classification.',
    source: { path: 'src/lib/api-helpers.ts', anchor: 'export async function requireSession()' } },
]

export function normalizeQuery(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}
const STOP = new Set('comment faire pour dans avec est une des les mon mes moi peux peut puis ou qui que quoi quel quelle quels quelles aide explique logiciel garageflows'.split(' '))
export function searchKnowledge(query: string, role: string, limit = 3): KnowledgeArticle[] {
  const tokens = new Set(normalizeQuery(query).split(' ').filter(t => t.length > 1 && !STOP.has(t)))
  return KNOWLEDGE.filter(a => !a.permission || can(role, a.permission))
    .map(a => ({ a, score: a.keywords.reduce((n, kw) => n + normalizeQuery(kw).split(' ').filter(t => tokens.has(t)).length, 0) }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.a.id.localeCompare(b.a.id))
    .slice(0, Math.min(3, Math.max(0, limit))).map(r => r.a)
}
