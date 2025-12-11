Rider Service - Docker Setup
A microservice for managing rider information, built with Node.js, Express, Typescript, and PostgreSQL. Containerized with Docker.

🚀 Quick Start with Docker
1. Clone and Navigate
bash
git clone <repository-url>
cd rider-service

2. Create Environment File
NODE_ENV=development
PORT=3001

# PostgreSQL Configuration
NODE_ENV=development
PORT=3001
JWT_SECRET=
JWT_EXPIRES_IN=2d
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=
FRONTEND_URL=http://localhost:3000
EMAIL_SERVICE_URL=http://localhost:3002
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RIDER_SERVICE_URL=http://localhost:3001
TRIP_SERVICE_URL=http://localhost:3005

3. Run the docker 
docker run -d \
  --name driver-service \
  -p 3003:3003 \
  --env-file .env \
  driver-service:latest

  or 

  docker run -d \
  --name driver-service \
  NODE_ENV=development
 -p port=3001
 -e jwt_token=
 -e jwt_expires_in=2d
 -e database_url=
 -e redis_host=
 -e redis_port=
 -e redis_password=
 -e frontend_url=http://localhost:3000
 -e email_service_url=http://localhost:3002
 -e google_client_id=
 -e google_client_secret=
 -e rider_service_url=http://localhost:3001
 -e trip_service_url=http://localhost:3005
  rider-service:latest


