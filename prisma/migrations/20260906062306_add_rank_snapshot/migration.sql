-- CreateTable
CREATE TABLE "public"."RankSnapshot" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "rank" INTEGER NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RankSnapshot_day_idx" ON "public"."RankSnapshot"("day");

-- CreateIndex
CREATE UNIQUE INDEX "RankSnapshot_wordId_day_key" ON "public"."RankSnapshot"("wordId", "day");

-- AddForeignKey
ALTER TABLE "public"."RankSnapshot" ADD CONSTRAINT "RankSnapshot_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "public"."Word"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
