-- AlterTable
ALTER TABLE "public"."Owner" ADD COLUMN     "domain" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Owner_domain_key" ON "public"."Owner"("domain");

