# Security Tests

> **Document canonique : [`docs/audit/RISK_REGISTER.md`](../../../docs/audit/RISK_REGISTER.md)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Tests de sécurité exécutés : matrice d'isolation 63 tests, authz 128 cellules, IDOR statique 141 routes, portail (capability tokens), en-têtes HTTP, immuabilité documents, concurrence PG (numérotation/stock/licences), update-verify fail-closed, gitleaks (arbre + historique).
