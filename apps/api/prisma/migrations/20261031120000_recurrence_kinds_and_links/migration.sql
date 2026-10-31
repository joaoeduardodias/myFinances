-- CreateEnum
CREATE TYPE "RecurrenceKind" AS ENUM ('MONTHLY', 'LOAN', 'EXTERNAL');

-- AlterEnum
ALTER TYPE "RecurrenceStatus" ADD VALUE 'PAID_OFF';

-- DropForeignKey
ALTER TABLE "recurrences" DROP CONSTRAINT "recurrences_account_id_fkey";

-- DropIndex
DROP INDEX "recurrences_user_id_account_id_description_key_direction_da_key";

-- AlterTable
ALTER TABLE "recurrences" ADD COLUMN     "kind" "RecurrenceKind" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "remaining_as_of" DATE,
ADD COLUMN     "remaining_installments" INTEGER,
ALTER COLUMN "account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "recurrence_id" TEXT;

-- CreateTable
CREATE TABLE "recurrence_link_dismissals" (
    "recurrence_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_link_dismissals_pkey" PRIMARY KEY ("recurrence_id","transaction_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recurrences_user_id_description_key_direction_day_rule_day__key" ON "recurrences"("user_id", "description_key", "direction", "day_rule", "day_value");

-- CreateIndex
CREATE INDEX "transactions_recurrence_id_idx" ON "transactions"("recurrence_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_link_dismissals" ADD CONSTRAINT "recurrence_link_dismissals_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_link_dismissals" ADD CONSTRAINT "recurrence_link_dismissals_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

