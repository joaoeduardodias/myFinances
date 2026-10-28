-- CreateTable
CREATE TABLE "description_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "description_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "description_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "description_rules_user_id_description_key_key" ON "description_rules"("user_id", "description_key");

-- AddForeignKey
ALTER TABLE "description_rules" ADD CONSTRAINT "description_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

