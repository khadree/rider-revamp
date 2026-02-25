# Rider Service - Docker Setup

A microservice for managing rider information and rider authentication, built with Node.js, Express, TypeScript, and PostgreSQL. Containerized with Docker.

## 🚀 Quick Start with Docker

### 1. Clone and Navigate

```bash
git clone <repository-url>
cd rider-service
```

### 2. Create Environment File

Create a `.env` file in the root of rider-service:

```env
NODE_ENV=development
PORT=3001

# JWT Configuration
JWT_SECRET=your-jwt-secret-here
JWT_EXPIRES_IN=2d

# PostgreSQL
DATABASE_URL=postgresql://<username>:<password>@<host>:5432/<database>?sslmode=require

# Redis
REDIS_HOST=swiftride-redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Frontend & other services
FRONTEND_URL=http://localhost:3000
EMAIL_SERVICE_URL=http://email-service:3002
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
RIDER_SERVICE_URL=http://rider-service:3001
TRIP_SERVICE_URL=http://trip-service:3005
```

### 3. Run with Docker

This is a microservice application. The Docker network and Redis instance are **shared across all services**. If `swiftride-net` and `swiftride-redis` are already running from another service, skip straight to Step 3b.

```powershell
# 3a. Create a shared Docker network (skip if already exists)
docker network create swiftride-net

# 3b. Build the Rider Service image
docker build -t rider-service .

# 3c. Run the Rider Service container
docker run -d -p 3001:3001 `
  --name rider-service `
  --network swiftride-net `
  --env-file .env `
  rider-service
```

### 4. Verify Service

- Health Check: http://localhost:3001/api/v1/riders/health
- Docs: http://localhost:3001/api/v1/riders/docs
