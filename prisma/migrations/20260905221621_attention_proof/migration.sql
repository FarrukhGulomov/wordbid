-- CreateTable
CREATE TABLE "public"."Visitor" (
    "id" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VisitorHourly" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_lastSeenAt_idx" ON "public"."Visitor"("lastSeenAt");

-- CreateIndex
CREATE INDEX "VisitorHourly_hourBucket_idx" ON "public"."VisitorHourly"("hourBucket");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorHourly_visitorId_hourBucket_key" ON "public"."VisitorHourly"("visitorId", "hourBucket");

-- AddForeignKey
ALTER TABLE "public"."VisitorHourly" ADD CONSTRAINT "VisitorHourly_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "public"."Visitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
