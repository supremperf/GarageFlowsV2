-- GF-PORT-006 — changement d'adresse e-mail en attente de vérification.
--
-- STRICTEMENT ADDITIVE : une colonne nullable, aucune donnée existante lue ni
-- réécrite, rien rendu obligatoire.
--
-- L'adresse e-mail est l'IDENTIFIANT de connexion au portail
-- (contrainte @@unique([garageId, email])). La remplacer directement sur demande
-- du client aurait deux conséquences inacceptables :
--   1. une faute de frappe l'enfermerait dehors, sans aucun recours de son côté ;
--   2. il pourrait revendiquer l'adresse d'un tiers et, si ce tiers a un compte
--      dans le même garage, provoquer une collision d'identifiants.
--
-- La nouvelle adresse patiente donc dans `pendingEmail` et ne devient
-- l'identifiant qu'après confirmation par le lien envoyé sur ELLE. Tant que la
-- confirmation n'a pas eu lieu, le client continue de se connecter avec son
-- ancienne adresse.

ALTER TABLE "PortalUser" ADD COLUMN "pendingEmail" TEXT;
