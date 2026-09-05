-- AlterTable
ALTER TABLE "public"."Click" ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "public"."Ownership" ADD COLUMN     "impressionCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."OwnershipDailyStat" (
    "id" TEXT NOT NULL,
    "ownershipId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OwnershipDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnershipDailyStat_day_idx" ON "public"."OwnershipDailyStat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipDailyStat_ownershipId_day_key" ON "public"."OwnershipDailyStat"("ownershipId", "day");

-- AddForeignKey
ALTER TABLE "public"."OwnershipDailyStat" ADD CONSTRAINT "OwnershipDailyStat_ownershipId_fkey" FOREIGN KEY ("ownershipId") REFERENCES "public"."Ownership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
