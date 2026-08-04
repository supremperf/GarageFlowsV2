-- Rattache RepairTypePart.garageId à Garage (relation + cascade + index).
--
-- Contexte : RepairTypePart.garageId existait sans clé étrangère ni index. Sans
-- FK, la suppression d'un Garage laissait des RepairTypePart ORPHELINS ; sans
-- index, les lectures filtrées par (garageId, repairType) faisaient un scan.
--
-- SÛRETÉ (données existantes) : avant d'ajouter la contrainte FK, on supprime
-- les lignes déjà orphelines (garageId ne référençant aucun Garage) — sinon
-- l'ajout de la FK échouerait. Ces lignes sont des défauts de pièces rattachés
-- à un garage inexistant : données mortes. Additif et idempotent au niveau
-- schéma (l'index et la contrainte n'existaient pas).

-- Nettoyage des orphelins (rend l'ajout de FK sûr sur une base existante).
DELETE FROM "RepairTypePart" rtp
 WHERE NOT EXISTS (SELECT 1 FROM "Garage" g WHERE g."id" = rtp."garageId");

-- CreateIndex
CREATE INDEX "RepairTypePart_garageId_repairType_idx" ON "RepairTypePart"("garageId", "repairType");

-- AddForeignKey
ALTER TABLE "RepairTypePart" ADD CONSTRAINT "RepairTypePart_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
