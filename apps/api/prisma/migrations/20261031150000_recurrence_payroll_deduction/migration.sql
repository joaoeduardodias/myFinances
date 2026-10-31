-- AlterTable
ALTER TABLE "recurrences" ADD COLUMN     "payroll_deduction" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "recurrence_payroll_links" (
    "recurrence_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_payroll_links_pkey" PRIMARY KEY ("recurrence_id","transaction_id")
);

-- CreateIndex
CREATE INDEX "recurrence_payroll_links_transaction_id_idx" ON "recurrence_payroll_links"("transaction_id");

-- AddForeignKey
ALTER TABLE "recurrence_payroll_links" ADD CONSTRAINT "recurrence_payroll_links_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_payroll_links" ADD CONSTRAINT "recurrence_payroll_links_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

