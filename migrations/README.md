# Database Migrations for WhatsApp Webhook Service

This directory contains SQL migration files for setting up the Supabase database schema for the WhatsApp webhook service.

## Migration Files

### 001_initial_tables.sql
Creates the core database tables:
- `settings` - Application configuration settings
- `auto_replies` - Automated response rules
- `api_keys` - API authentication keys (hashed)
- `contacts` - User contact management
- `messages` - WhatsApp message history

Includes:
- Primary keys using UUID
- Foreign key relationships
- Basic indexes for performance
- Default settings
- Timestamp triggers for updated_at columns

### 002_rls_policies.sql
Implements Row Level Security (RLS) for multi-tenant data isolation:
- Users can only access their own data
- Policies for SELECT, INSERT, UPDATE, DELETE operations
- Proper permissions for authenticated users
- Global access for settings and auto_replies tables

### 003_additional_constraints.sql
Adds additional constraints and optimizations:
- Unique constraints to prevent duplicate data
- Check constraints for data validation
- Performance indexes for common queries
- Phone number cleaning function and trigger
- Chat list view for efficient queries

## How to Apply Migrations

### Option 1: Supabase Dashboard
1. Open your Supabase project dashboard
2. Go to the SQL Editor
3. Copy and paste each migration file content
4. Run them in order (001, 002, 003)

### Option 2: Supabase CLI
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Initialize Supabase in your project (if not done)
supabase init

# Apply migrations
supabase db reset
```

### Option 3: Direct SQL Execution
If you have direct database access:
```bash
psql -h your-db-host -U postgres -d your-database -f migrations/001_initial_tables.sql
psql -h your-db-host -U postgres -d your-database -f migrations/002_rls_policies.sql
psql -h your-db-host -U postgres -d your-database -f migrations/003_additional_constraints.sql
```

## Database Schema Overview

### Tables Structure

#### settings
- Global application configuration
- Key-value pairs for app settings
- No user isolation (shared across all users)

#### auto_replies
- Automated response rules
- Keyword-based triggers
- Can be enabled/disabled
- Global settings (shared across all users)

#### api_keys
- User-specific API keys for authentication
- SHA-256 hashed keys for security
- Linked to Supabase auth users
- RLS enabled for user isolation

#### contacts
- User contact management
- Phone numbers automatically cleaned
- Unique constraint per user
- RLS enabled for user isolation

#### messages
- WhatsApp message history
- Supports message threading (replies)
- Stores raw WhatsApp message data
- Direction tracking (in/out)
- RLS enabled for user isolation

### Key Features

1. **Multi-tenant Architecture**: Each user's data is isolated using RLS
2. **Performance Optimized**: Strategic indexes for common query patterns
3. **Data Integrity**: Comprehensive constraints and validation
4. **Audit Trail**: Created/updated timestamps on all tables
5. **Flexible Configuration**: Settings table for runtime configuration
6. **Message Threading**: Support for reply-to relationships
7. **Phone Number Normalization**: Automatic cleaning of phone numbers

## Environment Variables Required

Make sure your `.env` file contains:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
```

## Notes

- The migrations assume Supabase Auth is enabled and configured
- UUID extension is automatically enabled
- All timestamps use timezone-aware format
- RLS policies require authenticated users
- Phone numbers are automatically cleaned on insert/update
- The chat_list view provides optimized access to latest messages per chat

## Troubleshooting

If you encounter issues:

1. **Permission Errors**: Ensure you're using the service key, not anon key
2. **UUID Extension**: Make sure the uuid-ossp extension is available
3. **Auth Users**: Ensure Supabase Auth is properly configured
4. **RLS Issues**: Check that users are properly authenticated when accessing data

## Rollback

To rollback migrations, you can drop tables in reverse order:
```sql
DROP VIEW IF EXISTS chat_list;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS auto_replies CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS clean_phone_number(TEXT) CASCADE;
DROP FUNCTION IF EXISTS trigger_clean_phone_number() CASCADE;
```