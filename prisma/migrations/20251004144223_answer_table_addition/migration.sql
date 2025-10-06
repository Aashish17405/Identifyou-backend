/*
  Warnings:

  - You are about to drop the column `submittedAt` on the `QuestionnaireResponse` table. All the data in the column will be lost.
  - You are about to drop the column `authId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `AnswerOption` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."AnswerOption" DROP CONSTRAINT "AnswerOption_answerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AnswerOption" DROP CONSTRAINT "AnswerOption_questionOptionId_fkey";

-- DropIndex
DROP INDEX "public"."User_authId_key";

-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "selectedOptionId" UUID;

-- AlterTable
ALTER TABLE "QuestionnaireResponse" DROP COLUMN "submittedAt",
ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "authId";

-- DropTable
DROP TABLE "public"."AnswerOption";

-- CreateIndex
CREATE INDEX "Answer_selectedOptionId_idx" ON "Answer"("selectedOptionId");

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
