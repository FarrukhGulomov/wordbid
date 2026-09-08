-- AlterTable
ALTER TABLE "public"."WebhookEvent" ADD COLUMN     "needsAttention" TEXT,
ADD COLUMN     "providerReference" TEXT;

-- CreateIndex
CREATE INDEX "WebhookEvent_needsAttention_idx" ON "public"."WebhookEvent"("needsAttention");
