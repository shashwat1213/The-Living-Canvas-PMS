-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
