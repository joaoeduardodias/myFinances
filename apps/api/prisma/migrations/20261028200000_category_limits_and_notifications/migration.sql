-- CreateEnum
CREATE TYPE "LimitStatus" AS ENUM ('ACTIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SPENDABLE_NEGATIVE', 'CATEGORY_WARNING', 'CATEGORY_EXCEEDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "spendable_negative" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "category_limits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "LimitStatus" NOT NULL,
    "limit_cents" INTEGER,
    "reviewed_month" TEXT,

    CONSTRAINT "category_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "dedupe_key" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_limits_user_id_category_key" ON "category_limits"("user_id", "category");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "category_limits" ADD CONSTRAINT "category_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
