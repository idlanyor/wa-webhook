-- Migration: Initial Tables for WhatsApp Service
-- Created: 2024
-- Description: Creates all necessary tables for multi-tenant WhatsApp webhook service

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create settings table for application configuration
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(255) NOT NULL UNIQUE,
    value TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create auto_replies table for automated responses
CREATE TABLE IF NOT EXISTS auto_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword VARCHAR(255) NOT NULL,
    reply TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create api_keys table for API authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash of the API key
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create contacts table for user contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create messages table for WhatsApp message history
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_jid VARCHAR(255) NOT NULL, -- WhatsApp JID (e.g., phone@s.whatsapp.net)
    sender VARCHAR(255) NOT NULL,
    sender_jid VARCHAR(255), -- Sender's WhatsApp JID
    message TEXT,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    stanza_id VARCHAR(255), -- WhatsApp message ID
    raw_message JSONB, -- Raw WhatsApp message object
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    quoted_text TEXT, -- Text of quoted message
    quoted_sender VARCHAR(255), -- Sender of quoted message
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value, description) VALUES
    ('auto_reply_enabled', 'true', 'Enable/disable automatic replies'),
    ('app_name', 'WhatsApp Webhook Service', 'Application name'),
    ('max_bulk_messages', '100', 'Maximum number of messages in bulk send')
ON CONFLICT (key) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_stanza_id ON messages(stanza_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_chat ON messages(user_id, chat_jid);
CREATE INDEX IF NOT EXISTS idx_auto_replies_enabled ON auto_replies(enabled) WHERE enabled = true;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_auto_replies_updated_at BEFORE UPDATE ON auto_replies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();