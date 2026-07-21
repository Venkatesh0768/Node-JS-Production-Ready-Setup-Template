# ✈️ FlyAnyTrip Backend Infrastructure

Welcome to the **FlyAnyTrip** production-ready backend repository. This project serves as the core infrastructure for flight searches, dynamic pricing (FareQuotes), and LCC/Non-LCC flight bookings through the Adivaha API, persisting data efficiently into a Supabase PostgreSQL database.

---

## 🌟 Key Features

### 1. Robust Flight API Integration
- **End-to-End Booking:** Handles Flight Search, Fare Quotes, SSR (Ancillaries), Ticketing (LCC), Booking (Non-LCC), and Cancellations.
- **Dynamic Fare Resolution:** Automatically resolves deeply nested, dynamic Adivaha API fare responses to guarantee zero-error pricing.
- **Database Synchronization:** Automatically intercepts successful ticket generations and persists deep Booking and Passenger data into PostgreSQL.

### 2. State-of-the-Art Tech Stack
- **Core:** Node.js, Express, TypeScript (Strict).
- **Database:** Prisma ORM v7 using `@prisma/adapter-pg` specifically tuned for Supabase connection pooling (pgbouncer).
- **Testing:** `vitest` for blazing-fast unit testing, with `axios-mock-adapter` for isolated API tests.
- **Logging:** Structured JSON logging using `winston` for robust production observability.

### 3. Developer Productivity & Quality Assurance
- **Husky & lint-staged:** Git hooks automatically run formatting and linting on staged files before every commit.
- **Commitlint:** Enforces Conventional Commits (e.g., `feat: ...`, `fix: ...`) ensuring a clean, auto-releasable git history.
- **ESLint & Prettier:** Flat-config ESLint (`eslint.config.mjs`) synchronized with Prettier for perfect code formatting.
- **Dynamic Postman Generation:** Includes a custom script (`script/generatePostman.js`) that outputs a highly dynamic Postman collection chaining Trace IDs, Fares, and PNRs across requests automatically.

---

## 🚀 Getting Started (How to Run)

### 1. Prerequisites
- **Node.js** (v20+ recommended)
- **Git**
- A **Supabase** account (or local PostgreSQL database)

### 2. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory (you can copy from `.env.example`):
```env
ENV=development
PORT=3000
SERVER_URL=http://localhost:3000

# Adivaha Credentials
ADIVAHA_BASE_URL=https://api.adivaha.io/flights/api/
PID=your_pid_here
X_API_KEY=your_api_key_here

# Supabase DB URIs
# DATABASE_URL uses port 6543 for Prisma queries (pgbouncer/transaction pooler)
DATABASE_URL="postgresql://postgres.[REF]:[PASS]...:6543/postgres?pgbouncer=true"

# DIRECT_URL uses port 5432 for CLI schema migrations (session pooler)
DIRECT_URL="postgresql://postgres.[REF]:[PASS]...:5432/postgres"
```

### 4. Database Setup
Push the Prisma schema to your Supabase database:
```bash
npm run db:push
```
*Note: If Prisma detects destructive changes, you may need to append `-- --accept-data-loss` (or use `npx prisma db push --accept-data-loss`).*

Generate the Prisma Client:
```bash
npm run db:generate
```

### 5. Running the Application
Start the development server (auto-reloads on file changes):
```bash
npm run dev
```

The server will start at `http://localhost:3000`.

---

## 🧪 Testing & Postman

### Unit Testing
Run the Vitest suite to validate all controllers and API mocks:
```bash
npm run test
# For coverage reporting:
npm run test:coverage
```

### Postman Integration Testing
To test the live APIs sequentially:
1. Generate the latest collection:
   ```bash
   node script/generatePostman.js
   ```
2. Import `postman_collection.json` into Postman.
3. Run the collection folder. It automatically extracts Trace IDs and prices from the search APIs and passes them to the booking APIs.

---

## 📦 Pushing to GitHub (Git Workflow)

Because this project enforces strict code quality and Conventional Commits, follow these steps to push your code:

1. **Stage your changes:**
   ```bash
   git add .
   ```

2. **Commit your changes (using Conventional Commits):**
   The commit message **must** be lowercase and start with a specific prefix (e.g., `feat:`, `fix:`, `chore:`, `refactor:`).
   
   ✅ **Correct Example:**
   ```bash
   git commit -m "feat: integrate adivaha flight booking api"
   ```
   ❌ **Incorrect Examples (Will be blocked):**
   ```bash
   git commit -m "Feat: Integrate Api" # Fails due to capitalization
   git commit -m "updated the api" # Fails due to missing prefix
   ```

   *When you press enter, Husky will automatically run ESLint and Prettier on your staged files. If the linter fails, fix the errors and try again.*

3. **Push to the repository:**
   ```bash
   git push origin main
   ```

---

## 📂 Project Architecture

```text
├── .husky/                  # Git hooks (pre-commit, commit-msg)
├── logs/                    # Winston generated application logs
├── prisma/
│   ├── schema.prisma        # Database models (Booking, Passenger, etc.)
│   └── prisma.config.ts     # Prisma v7 environment configuration
├── script/
│   └── generatePostman.js   # Automated API testing collection generator
├── src/
│   ├── constant/            # Application constants (e.g., Response Messages)
│   ├── controller/          # API Route Controllers (Flight, User, etc.)
│   ├── lib/                 # Core library initializations (Prisma singleton)
│   ├── middleware/          # Express middlewares (Validation, Error Handlers)
│   ├── router/              # Express route definitions
│   ├── service/             # Core business logic (Adivaha integration, DB sync)
│   ├── util/                # Helper utilities (Logger, HTTP Wrappers)
│   └── server.ts            # Application Entry Point
├── test/                    # Vitest unit test suites
└── vitest.config.ts         # Vitest test configuration
```

---

## 🔧 Useful Commands Summary

| Command | Description |
|---------|-------------|
| `npm run dev` | Starts the server in development mode using Nodemon. |
| `npm run build` | Compiles the TypeScript code into the `/dist` folder. |
| `npm run start` | Runs the compiled production code. |
| `npm run lint` | Analyzes code for ESLint errors. |
| `npm run format:fix` | Formats all files using Prettier. |
| `npm run db:studio` | Opens Prisma Studio to view database GUI at `localhost:5555`. |
