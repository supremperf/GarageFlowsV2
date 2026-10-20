# Détection de secrets dans les captures d'écran

## 1. Objectif

Bloquer le partage d'une capture (support, ticket, forum) qui contient une clé
API, un jeton, un mot de passe SMTP ou une URL de base de données. La décision
est prise **avant** l'envoi, localement, et la valeur détectée n'est jamais
renvoyée en clair.

## 2. Composants

| Fichier | Rôle |
|---|---|
| `patterns.toml` | 22 règles versionnées (aucune valeur réelle, uniquement des formes) |
| `scripts/secret_scan.py` | détection, masquage, OCR, service HTTP, CLI |
| `scripts/test_secret_scan.py` | 32 tests (détection, faux positifs, image, HTTP, fail-closed) |
| IHM Keygen → **Détection des secrets** | analyse d'une capture, rapport masqué, export JSON, service local |

Aucun service parallèle n'est créé : l'analyse d'image réutilise le binaire
Tesseract du poste et le module `src/lib/ocr` n'est pas modifié (il traite les
documents automobiles, pas les secrets).

## 3. Utilisation

```bash
# État du service (règles, OCR, persistance)
python scripts/secret_scan.py --check

# Analyse d'une capture (code 1 si un secret est détecté)
python scripts/secret_scan.py --image capture.png
python scripts/secret_scan.py --image capture.png --json

# Texte (diagnostic)
python scripts/secret_scan.py --text "OPENAI_API_KEY=sk-..." --redact

# Service local
python scripts/secret_scan.py --serve --port 7070
```

Depuis le Keygen : **Détection des secrets → Choisir une capture…**. Le verdict
est `PARTAGE BLOQUÉ` dès qu'un secret est trouvé. L'export JSON ne contient que
les valeurs masquées (`sk-****`), les scores et les positions.

## 4. API locale

Écoute **strictement** sur `127.0.0.1` (le bind sur `0.0.0.0` est refusé).

### `GET /health`

```json
{
  "ok": true,
  "service": "garageflows-secret-scan",
  "version": "1.0.0",
  "enabled": true,
  "ocrAvailable": true,
  "patterns": 22,
  "patternsVersion": 1,
  "persist": false,
  "maxBytes": 10485760
}
```

### `POST /scan`

Corps : image binaire (`Content-Type: image/png|jpeg|gif|bmp`), `Content-Length`
obligatoire, taille limitée par `GF_SCREENSHOT_SCAN_MAX_BYTES` (10 Mio par
défaut). Aucun en-tête CORS n'est émis ; une `Origin` non locale est refusée
(403).

Réponse 200 :

```json
{
  "ok": true,
  "secrets": [
    {
      "type": "OPENAI_API_KEY",
      "family": "openai",
      "description": "Clé API OpenAI (sk-, sk-proj-, sk-svcacct-)",
      "value_redacted": "sk-****",
      "score": 0.98,
      "start": 12,
      "end": 56
    }
  ],
  "count": 1,
  "blocked": true,
  "highest_score": 0.98,
  "patterns_version": 1,
  "image_format": "PNG",
  "image_bytes": 12345
}
```

Codes d'erreur : `SCAN_DISABLED` (503), `OCR_UNAVAILABLE` (503),
`UNSUPPORTED_FORMAT` (415), `INVALID_IMAGE` (415), `IMAGE_TOO_LARGE` (413),
`ORIGIN_FORBIDDEN` (403), `LENGTH_REQUIRED` (411), `PERSIST_FORBIDDEN` (500 au
démarrage).

## 5. Confidentialité et fail-closed

- Aucune image n'est écrite sur disque : Tesseract lit sur **stdin** et écrit sur
  **stdout**.
- Aucun texte OCR n'est renvoyé ni journalisé ; seul `raw_text_sha256` est
  calculé pour la traçabilité (le texte brut n'est pas exposé par l'API image).
- Aucune valeur complète n'est renvoyée : `value_redacted` conserve au plus un
  préfixe court.
- `GF_SCREENSHOT_SCAN_PERSIST=true` est **refusé au démarrage**.
- Si le scan est activé mais que l'OCR est indisponible, le service répond 503 :
  le client doit bloquer le partage (fail-closed). Aucune dérogation
  silencieuse n'existe.
- Le journal HTTP est muet par défaut (méthode/route/statut uniquement si
  `GF_SCREENSHOT_SCAN_VERBOSE=1`).

## 6. Règles

`patterns.toml` est versionné (`version = 1`) et contient :

| Famille | Exemples de règles |
|---|---|
| OpenAI / Anthropic | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Stripe | `STRIPE_SECRET_KEY` |
| GitHub / GitLab | `GITHUB_TOKEN`, `GITHUB_FINE_GRAINED_TOKEN`, `GITLAB_TOKEN` |
| AWS / Google | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GOOGLE_API_KEY` |
| Messagerie | `SLACK_TOKEN`, `SENDGRID_API_KEY`, `TWILIO_API_KEY` |
| Structures | `PRIVATE_KEY_BLOCK`, `JWT` |
| Bases de données | `POSTGRES_URL_WITH_PASSWORD`, `REDIS_URL_WITH_PASSWORD` |
| Contexte | `GENERIC_API_KEY`, `GENERIC_SECRET`, `SMTP_PASSWORD`, `VERCEL_TOKEN`, `UPSTASH_TOKEN` |

Chaque règle porte un `score` (0..1). Sous `settings.min_score` (0.6), le match
est ignoré. Un chevauchement est résolu en faveur du score le plus élevé, puis
du match le plus long : une clé OpenAI reconnue par sa règle dédiée n'est pas
re-masquée par la règle générique.

Ajouter une règle = éditer `patterns.toml` puis exécuter
`python3 scripts/test_secret_scan.py`. Ne jamais y placer une valeur réelle.

## 7. Intégration applicative

Le dépôt **ne contient pas de flux de partage de capture** (aucune fonction
« partager une capture » dans `src/`). Le service et l'IHM Keygen sont donc
opérationnels, mais aucun bouton de l'application web/mobile ne les appelle
aujourd'hui : il n'existe pas de point d'intégration réel à câbler, et en créer
un aurait ajouté une fonctionnalité fictive.

Lorsqu'un flux de partage sera ajouté, il devra :

1. vérifier `GF_SCREENSHOT_SECRET_SCAN_ENABLED` ;
2. poster l'image sur `GF_SCREENSHOT_SCAN_SERVER_URL` (HTTPS ou boucle locale) ;
3. attendre la réponse et **bloquer** si `blocked=true` ;
4. proposer le masquage avant nouvel essai ;
5. bloquer aussi en cas d'indisponibilité (fail-closed).

## 8. Configuration

Voir `.env.example` et `ENVIRONMENT-VARIABLES.md` :

```env
GF_SCREENSHOT_SECRET_SCAN_ENABLED="true"
GF_SCREENSHOT_SCAN_SERVER_URL="http://127.0.0.1:7070"
GF_SCREENSHOT_SCAN_PERSIST="false"
GF_SCREENSHOT_SCAN_PORT="7070"
GF_SCREENSHOT_SCAN_MAX_BYTES="10485760"
GF_SCREENSHOT_SCAN_PATTERNS="patterns.toml"
GF_SCREENSHOT_TESSERACT="tesseract"
GF_SCREENSHOT_TESSERACT_LANG="eng"
```

## 9. Tests et limites

```bash
python3 scripts/test_secret_scan.py
```

Résultat de référence dans cet environnement : **32 tests OK**.

Limites honnêtes :

- Tesseract n'est pas installé dans le conteneur d'audit : l'OCR réel n'a pas pu
  être exécuté. Les tests injectent un moteur OCR pour prouver le pipeline, et
  vérifient que l'absence d'OCR produit bien un refus 503.
- Aucune image de production n'a été analysée.
- Le masquage **d'image** (dessiner des rectangles) n'est pas implémenté : seule
  la détection et la rédaction de texte le sont. L'écran propose le blocage et
  l'export du rapport masqué, pas une image réécrite.
