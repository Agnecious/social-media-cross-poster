import { PrismaClient } from '@prisma/client';

/**
 * Single shared PrismaClient for the process. Reused across requests so we
 * don't exhaust the connection pool. Queries go through the pooled DATABASE_URL.
 */
export const prisma = new PrismaClient();
