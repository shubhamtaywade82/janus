# Janus: Advanced Trading Dashboard & Execution Engine

Janus is a full-stack algorithmic trading dashboard and execution engine. It provides high-performance real-time market data visualization, order book analysis, portfolio/position tracking, confluence scoring, and automated trade execution.

Built on a unified modern stack utilizing Hono, Vite, React, TypeScript, and Drizzle ORM.

---

## Architecture Overview

```mermaid
graph TD
    subgraph FE["Frontend (Vite + React + TS)"]
        UI[Dashboard / Market / Trading UI]
        TRPC_Client[tRPC Client]
        UI --> TRPC_Client
    end

    subgraph BE["Backend (Hono + Node Server)"]
        API[Hono HTTP and WebSocket Server]
        TRPC_Server[tRPC Router]
        Auth[OAuth and Session Middleware]

        API --> TRPC_Server
        API --> Auth
    end

    subgraph DB_Layer["Database"]
        DB[(PostgreSQL)]
        Drizzle[Drizzle ORM]
    end

    TRPC_Client -->|tRPC Over HTTP| API
    TRPC_Server --> Drizzle
    Drizzle --> DB
```

### Stack Components

1. **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui.
2. **Backend**: Hono, Node Server, tRPC (fetch adapter) for type-safe API communication.
3. **Database**: PostgreSQL managed with Drizzle ORM.
4. **Authentication**: Generic OAuth workflow for user authorization, and JWT/Cookie-based session persistence.

---

## Directory Structure

```text
├── api/                  # Backend code
│   ├── boot.ts           # Server entry point (serves API & Static client)
│   ├── router.ts         # Main tRPC router
│   ├── context.ts        # tRPC request context resolver
│   ├── middleware.ts     # Public/Private tRPC procedures & CORS config
│   ├── oauth/            # Platform-agnostic OAuth flow & session managers
│   ├── routers/          # Domain-specific routers (market, trading, signal, etc.)
│   ├── services/         # Core business logic/service layer
│   └── lib/              # Shared helper libraries (env, cookies, encryption)
├── contracts/            # Common type contracts and constant declarations
├── db/                   # Database schemas and Drizzle migrations
│   ├── schema.ts         # PostgreSQL table definitions
│   └── migrations/       # Generated SQL migrations
├── src/                  # React Frontend application
│   ├── components/       # shadcn/ui elements
│   ├── hooks/            # Custom React hooks (trpc integration)
│   ├── pages/            # View pages (Login, Dashboard, Market, etc.)
│   ├── main.tsx          # Frontend entry point
│   └── index.css         # Global tailwind styles
└── contracts/            # Client-server shared constants & types
```

---

## Setup & Installation

### 1. Prerequisites
- **Node.js**: `v20` or higher
- **Package Manager**: `npm`
- **Database**: A running PostgreSQL database instance

### 2. Install Dependencies
Clone the repository and install the npm packages:
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory by copying the example file:
```bash
cp .env.example .env
```

Fill in the required configurations:
```ini
# ── Backend ─────────────────────────────────────────────────────
APP_ID=your-app-id
APP_SECRET=your-app-secret-jwt-key

# ── Database ───────────────────────────────────────────────────
DATABASE_URL=postgres://user:password@127.0.0.1:5432/janus

# ── Frontend (exposed to browser via Vite) ──────────────────────
VITE_AUTH_URL=https://auth.example.com
VITE_APP_ID=your-app-id

# ── Backend (Auth) ─────────────────────────────────────────────
AUTH_URL=https://auth.example.com
AUTH_PLATFORM_URL=https://open.example.com

# ── Admin Role ──────────────────────────────────────────────────
OWNER_UNION_ID=admin-union-id
```

### 4. Database Setup
Push the Drizzle schemas to your PostgreSQL database:
```bash
# Push schema changes directly
npm run db:push

# Or generate and run migrations
npm run db:generate
npm run db:migrate
```

---

## Usage & Development

### Run Development Server
Start the unified backend dev server and Vite compilation process:
```bash
npm run dev
```
The application will be accessible at `http://localhost:3010`.

### Running Tests
Execute test suites with Vitest:
```bash
npm run test
```

### Linting & Formatting
```bash
# Run ESLint check
npm run lint

# Format codebase with Prettier
npm run format
```

---

## Production Deployment

### Build the Application
To build both the React frontend bundle and the Hono API node server:
```bash
npm run build
```
The production bundle will be created in the `dist/` directory.

### Start Production Server
Run the compiled server:
```bash
npm start
```
The server will boot and serve the client bundles as static pages along with API endpoints under `/api`.
