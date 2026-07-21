// Prisma 7 configuration for Flyanytrip
// Uses Supabase PostgreSQL:
//   DATABASE_URL  — transaction-mode pooler  (pgbouncer, port 6543) — runtime queries
//   DIRECT_URL    — session-mode pooler (port 5432) — Prisma migrate / introspect

import 'dotenv/config'; // loads .env for Prisma CLI; app runtime uses dotenv-flow
import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: process.env['DIRECT_URL'], // CLI MUST use the session pooler (port 5432) for push/migrate
    },
});
