Rider Service - Docker Setup
A microservice for managing rider information, built with Node.js, Express, TypeScript, and PostgreSQL. Containerized with Docker.

🚀 Quick Start with Docker
1. Clone and Navigate
git clone <repository-url>
cd rider-service

2. Build the Docker Image
docker build -t rider-service:latest .

3. Create Environment File
cat > .env << 'EOF'
NODE_ENV=development
PORT=3001
JWT_SECRET=your-jwt-secret-here
JWT_EXPIRES_IN=2d
DATABASE_URL=your-postgresql-connection-string
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
FRONTEND_URL=http://localhost:3000
EMAIL_SERVICE_URL=http://localhost:3002
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
RIDER_SERVICE_URL=http://localhost:3001
TRIP_SERVICE_URL=http://localhost:3005
EOF

4. Run with Docker
Option A: Using .env file
docker run -d \
  --name rider-service \
  -p 3001:3001 \
  --env-file .env \
  rider-service:latest

  Option B: Direct environment variables 
  docker run -d \
  --name rider-service \
  -p 3001:3001 \
  -e NODE_ENV=development \
  -e PORT=3001 \
  -e JWT_SECRET=your-jwt-secret \
  -e JWT_EXPIRES_IN=2d \
  -e DATABASE_URL=your-database-url \
  -e REDIS_HOST=your-redis-host \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=your-redis-password \
  -e FRONTEND_URL=http://localhost:3000 \
  -e EMAIL_SERVICE_URL=http://localhost:3002 \
  -e GOOGLE_CLIENT_ID=your-google-client-id \
  -e GOOGLE_CLIENT_SECRET=your-google-client-secret \
  -e RIDER_SERVICE_URL=http://localhost:3001 \
  -e TRIP_SERVICE_URL=http://localhost:3005 \
  rider-service:latest