-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "credit_limit_cents" INTEGER;

-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "institution_code" TEXT;
