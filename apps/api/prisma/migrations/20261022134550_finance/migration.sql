-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'CREDIT', 'WALLET');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('PLUGGY', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecurrenceDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "DayRule" AS ENUM ('DAY_OF_MONTH', 'NTH_BUSINESS_DAY');

-- CreateEnum
CREATE TYPE "NonBusinessDayPolicy" AS ENUM ('ANTICIPATE', 'POSTPONE', 'KEEP');

-- CreateEnum
CREATE TYPE "RecurrenceStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PayslipType" AS ENUM ('MONTHLY', 'ADVANCE', 'THIRTEENTH', 'VACATION');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('UNRECOGNIZED', 'RECOGNIZED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pluggy_item_id" TEXT NOT NULL,
    "connector_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "consent_expires_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "pluggy_account_id" TEXT,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "balance_cents" INTEGER NOT NULL,
    "closing_day" INTEGER,
    "due_day" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "pluggy_transaction_id" TEXT,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "description_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "source" "TransactionSource" NOT NULL,
    "pluggy_category" TEXT,
    "category" TEXT,
    "category_locked" BOOLEAN NOT NULL DEFAULT false,
    "is_transfer" BOOLEAN NOT NULL DEFAULT false,
    "transfer_locked" BOOLEAN NOT NULL DEFAULT false,
    "transfer_pair_id" TEXT,
    "installment_number" INTEGER,
    "total_installments" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_bills" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "pluggy_bill_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL,

    CONSTRAINT "card_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "description_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_key" TEXT NOT NULL,
    "direction" "RecurrenceDirection" NOT NULL,
    "expected_amount_cents" INTEGER NOT NULL,
    "day_rule" "DayRule" NOT NULL,
    "day_value" INTEGER NOT NULL,
    "non_business_day_policy" "NonBusinessDayPolicy" NOT NULL DEFAULT 'ANTICIPATE',
    "status" "RecurrenceStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "type" "PayslipType" NOT NULL,
    "status" "PayslipStatus" NOT NULL,
    "gross_cents" INTEGER,
    "net_cents" INTEGER,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_lines" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_pluggy_item_id_key" ON "connections"("pluggy_item_id");

-- CreateIndex
CREATE INDEX "connections_user_id_idx" ON "connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_pluggy_account_id_key" ON "accounts"("pluggy_account_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_pluggy_transaction_id_key" ON "transactions"("pluggy_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transfer_pair_id_key" ON "transactions"("transfer_pair_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_date_idx" ON "transactions"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "card_bills_pluggy_bill_id_key" ON "card_bills"("pluggy_bill_id");

-- CreateIndex
CREATE INDEX "card_bills_user_id_idx" ON "card_bills"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_user_id_description_key_key" ON "category_rules"("user_id", "description_key");

-- CreateIndex
CREATE UNIQUE INDEX "recurrences_user_id_account_id_description_key_direction_key" ON "recurrences"("user_id", "account_id", "description_key", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_user_id_file_sha256_key" ON "payslips"("user_id", "file_sha256");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_pair_id_fkey" FOREIGN KEY ("transfer_pair_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_bills" ADD CONSTRAINT "card_bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_bills" ADD CONSTRAINT "card_bills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma carteira (WALLET) por usuário
CREATE UNIQUE INDEX "accounts_user_id_wallet_key" ON "accounts"("user_id") WHERE "type" = 'WALLET';
