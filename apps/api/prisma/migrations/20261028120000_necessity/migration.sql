-- CreateEnum
CREATE TYPE "Necessity" AS ENUM ('ESSENTIAL', 'AVOIDABLE');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "necessity" "Necessity";

-- CreateTable
CREATE TABLE "category_necessities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "necessity" "Necessity" NOT NULL,

    CONSTRAINT "category_necessities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_necessities_user_id_category_key" ON "category_necessities"("user_id", "category");

-- AddForeignKey
ALTER TABLE "category_necessities" ADD CONSTRAINT "category_necessities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

