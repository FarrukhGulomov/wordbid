-- CreateEnum
CREATE TYPE "public"."PaymentKind" AS ENUM ('TAKEOVER', 'BOOST');

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "kind" "public"."PaymentKind" NOT NULL DEFAULT 'TAKEOVER';
