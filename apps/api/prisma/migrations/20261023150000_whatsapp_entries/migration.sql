-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "description_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_description" TEXT,
ADD COLUMN     "whatsapp_message_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "whatsapp_phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "transactions_whatsapp_message_id_key" ON "transactions"("whatsapp_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_whatsapp_phone_key" ON "users"("whatsapp_phone");

