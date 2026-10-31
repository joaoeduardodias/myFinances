-- AlterTable
ALTER TABLE "recurrences" ADD COLUMN     "payroll_source_id" TEXT;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_payroll_source_id_fkey" FOREIGN KEY ("payroll_source_id") REFERENCES "recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

