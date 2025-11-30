import { db } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

const createTables = async () => {
  let client;
  
  try {
    console.log('🔄 Creating rider service tables in rider_service schema...');
    
    client = await db.connect();
    await client.query('SET search_path TO rider_service');
    await client.query('DROP TABLE IF EXISTS ride_requests CASCADE');
    await client.query('DROP TABLE IF EXISTS riders CASCADE');
    console.log('🔄 Creating riders table...');
    await client.query(`
      CREATE TABLE riders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        
        -- Authentication fields
        password_hash VARCHAR(255) NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        verification_token VARCHAR(255),
        reset_token VARCHAR(255),
        reset_token_expiry TIMESTAMP,
        last_login TIMESTAMP,
        
        -- Rider specific fields
        rating DECIMAL(3, 2) DEFAULT 5.00,
        total_trips INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create ride_requests table
    console.log('🔄 Creating ride_requests table...');
    await client.query(`
      CREATE TABLE ride_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id UUID REFERENCES riders(id),
        pickup_lat DECIMAL(10, 8) NOT NULL,
        pickup_lng DECIMAL(11, 8) NOT NULL,
        pickup_address TEXT,
        dropoff_lat DECIMAL(10, 8) NOT NULL,
        dropoff_lng DECIMAL(11, 8) NOT NULL,
        dropoff_address TEXT,
        vehicle_type VARCHAR(50) DEFAULT 'standard',
        status VARCHAR(50) DEFAULT 'pending',
        estimated_fare DECIMAL(10, 2),
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        matched_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        cancellation_reason TEXT
      )
    `);

    // Create indexes
    console.log('🔄 Creating indexes...');
    await client.query('CREATE INDEX idx_riders_email ON riders(email)');
    await client.query('CREATE INDEX idx_riders_verification_token ON riders(verification_token)');
    await client.query('CREATE INDEX idx_riders_reset_token ON riders(reset_token)');
    await client.query('CREATE INDEX idx_rider_requests ON ride_requests(rider_id)');
    await client.query('CREATE INDEX idx_request_status ON ride_requests(status)');

    console.log('✅ Rider service tables created successfully in rider_service schema');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await db.end();
  }
};

if (require.main === module) {
  createTables()
    .then(() => {
      console.log('🎉 Rider service migration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export { createTables };