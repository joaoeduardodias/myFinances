-- CreateEnum
CREATE TYPE "AdvisorRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "advisor_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "AdvisorRole" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisor_messages_user_id_created_at_idx" ON "advisor_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "advisor_messages" ADD CONSTRAINT "advisor_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
