-- CreateEnum
CREATE TYPE "AdvisorGoalKind" AS ENUM ('CATEGORY', 'SAVINGS');

-- AlterTable
ALTER TABLE "advisor_messages" ADD COLUMN     "proposals" JSONB;

-- CreateTable
CREATE TABLE "advisor_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AdvisorGoalKind" NOT NULL,
    "category" TEXT,
    "target_cents" INTEGER,
    "target_percent" INTEGER,
    "start_month" TEXT NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisor_goals_user_id_idx" ON "advisor_goals"("user_id");

-- AddForeignKey
ALTER TABLE "advisor_goals" ADD CONSTRAINT "advisor_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
