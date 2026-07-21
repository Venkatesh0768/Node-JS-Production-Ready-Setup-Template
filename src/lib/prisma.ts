/**
 * Prisma Client singleton for Flyanytrip.
 *
 * Prisma 7 uses the driver-adapter pattern.
 * We use @prisma/adapter-pg with the pg Pool for Supabase (PostgreSQL).
 *
 * In development, a global reference prevents hot-reload from spawning
 * multiple PrismaClient instances and exhausting the Supabase connection pool.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import config from '../config/config';

function createPrismaClient(): PrismaClient {
    const connectionString = config.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    return new PrismaClient({
        adapter,
        // Log queries only in development
        ...(config.ENV === 'development' && {
            log: ['query', 'warn', 'error'],
        }),
    });
}

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (config.ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
