# Module Premium — OCR automobile (multi-documents)

Transforme le **texte OCR** d'un document automobile en **données structurées** :
type détecté + champs extraits, avec **confiance par champ** et **contrôles de
validité**. L'étape image→texte est externe (moteur OCR / API vision) et se
branche derrière l'interface `OcrProvider` ; toute la suite est **déterministe
et testable hors-ligne**.

## Architecture

```
src/lib/ocr/
├── types.ts       # DocumentType, OcrResult, OcrProvider, ExtractedField, ExtractedDocument
├── normalize.ts   # lignes, montants FR (1 234,56), dates FR → ISO, correction VIN (I/O/Q)
├── vin-scan.ts    # findVin : détection + validation (réutilise le moteur VIN)
├── plate-scan.ts  # findPlate : SIV (AB-123-CD) & FNI, forme canonique
├── classify.ts    # classifyDocument : score par mots-clés + signaux structurels
├── extract.ts     # extracteurs par type + dispatch
├── providers.ts   # OcrProvider (interface) + TextOcrProvider / MockOcrProvider
├── engine.ts      # extractDocument (pur) + OcrEngine (provider → classify → extract)
└── index.ts
```

## Types de documents & champs

| Type | Champs extraits |
|---|---|
| `carte_grise` | plaque (A), VIN (E), marque (D.1), dénomination (D.3), 1re immat. (B), énergie (P.3) |
| `invoice` | fournisseur, n° de facture, date, total HT, total TTC |
| `plate` | plaque (SIV / FNI, forme canonique) |
| `vin_plate` | VIN (+ plaque si présente) |
| `odometer` | kilométrage |

Chaque champ porte **valeur**, **confiance** (0..1), **extrait source** (raw,
pour audit) et parfois **valid** (validation exécutée).

## Détection & robustesse

- **VIN** : recherche d'un jeton de 17 caractères, **correction OCR** (I→1, O→0,
  Q→0) puis validation via le moteur VIN (format + chiffre de contrôle). La
  confiance monte avec un chiffre de contrôle valide et la proximité d'un label
  « E » / « VIN » (les VIN européens échouent souvent le contrôle nord-américain).
- **Plaque** : SIV `AA-123-AA` (depuis 2009) et FNI ancien, ramenés à la forme à
  tirets.
- **Montants** FR (« 1 234,56 », NBSP, séparateur décimal `,` ou `.`) et **dates**
  FR (`jj/mm/aaaa`, année sur 2 ou 4 chiffres) → ISO.
- **Total** : on prend le **dernier** nombre de la ligne (évite d'attraper un taux
  de TVA « 20 % » avant le montant).

## Classification

Score par mots-clés (accent- & ponctuation-insensible) par type, plus des
**signaux structurels** : un VIN ou une plaque seuls sur un **document court**
impliquent une étiquette (plaque/VIN) ; sur un document long ils ne font que
corroborer un certificat. Le type au meilleur score gagne ; score nul ⇒
`unknown`. La confiance de classification pondère la confiance finale.

## API — `POST /api/ocr` (lecture seule)

Authentifié, cloisonné par `garageId`, limité (30 req/min). Extraction pure —
**aucune persistance**, donc aucune confirmation requise.

```jsonc
// requête
{ "text": "<texte OCR>", "type": "carte_grise" /* optionnel : force le type */ }
// réponse
{ "type": "carte_grise", "fields": [ { "key": "vin", "value": "VF3…", "confidence": 0.8, "valid": true }, … ],
  "confidence": 0.78, "warnings": [], "vinDecoded": { "manufacturer": "…", "modelYear": … } }
```

Un **VIN détecté est recoupé** avec le décodeur VIN hors-ligne (`vinDecoded`,
lecture seule). L'entrée **image** nécessite un `OcrProvider` configuré (non
fourni) : passez le `text` reconnu par un moteur OCR client ou serveur.

## Tests

`src/lib/ocr/__tests__/ocr.test.ts` — 22 tests : montants/dates FR, VIN (valide,
correction O→0, absent), plaques SIV/FNI, classification des 5 types + `unknown`,
extraction carte grise (6 champs) et facture (n°/date/HT/TTC/fournisseur,
dernier montant), compteur, `extractDocument` (auto, type forcé, avertissements),
et le pipeline via `TextOcrProvider` / `MockOcrProvider`.

## Intégrations & suite

Le VIN alimente le **décodeur VIN** et le **catalogue** ; la carte grise pré-remplit
un **véhicule** ; la facture alimente les **commandes fournisseurs** / la
**rentabilité** — chaque écriture restant confirmée par l'utilisateur. À venir :
connecteur `OcrProvider` réel (Tesseract/API vision), extraction des lignes de
facture détaillées, et pré-remplissage assisté des formulaires.
