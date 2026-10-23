-- DropIndex
DROP INDEX "recurrences_user_id_account_id_description_key_direction_key";

-- CreateIndex
CREATE UNIQUE INDEX "recurrences_user_id_account_id_description_key_direction_da_key" ON "recurrences"("user_id", "account_id", "description_key", "direction", "day_rule", "day_value");

