-- CreateTable
CREATE TABLE "advisor_summaries" (
    "user_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "points" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_summaries_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "advisor_usage" (
    "day" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,

    CONSTRAINT "advisor_usage_pkey" PRIMARY KEY ("day")
);

-- AddForeignKey
ALTER TABLE "advisor_summaries" ADD CONSTRAINT "advisor_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
