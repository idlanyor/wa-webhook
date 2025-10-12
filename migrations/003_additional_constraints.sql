-- Migration: Additional Constraints and Optimizations
-- Created: 2024
-- Description: Adds additional constraints, unique indexes, and performance optimizations

-- Add unique constraint for user-phone combination in contacts
-- This prevents duplicate contacts for the same user
ALTER TABLE contacts ADD CONSTRAINT unique_user_phone 
    UNIQUE (user_id, phone);

-- Add composite index for message queries by user and timestamp
CREATE INDEX IF NOT EXISTS idx_messages_user_timestamp 
    ON messages(user_id, timestamp DESC);

-- Add index for message replies lookup
CREATE INDEX IF NOT EXISTS idx_messages_reply_to 
    ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Add partial index for active auto replies
CREATE INDEX IF NOT EXISTS idx_auto_replies_keyword_enabled 
    ON auto_replies(keyword) WHERE enabled = true;

-- Add constraint to ensure phone numbers are not empty
ALTER TABLE contacts ADD CONSTRAINT check_phone_not_empty 
    CHECK (phone IS NOT NULL AND trim(phone) != '');

-- Add constraint to ensure contact names are not empty
ALTER TABLE contacts ADD CONSTRAINT check_name_not_empty 
    CHECK (name IS NOT NULL AND trim(name) != '');

-- Add constraint to ensure auto reply keywords are not empty
ALTER TABLE auto_replies ADD CONSTRAINT check_keyword_not_empty 
    CHECK (keyword IS NOT NULL AND trim(keyword) != '');

-- Add constraint to ensure auto reply responses are not empty
ALTER TABLE auto_replies ADD CONSTRAINT check_reply_not_empty 
    CHECK (reply IS NOT NULL AND trim(reply) != '');

-- Add constraint to ensure setting keys are not empty
ALTER TABLE settings ADD CONSTRAINT check_setting_key_not_empty 
    CHECK (key IS NOT NULL AND trim(key) != '');

-- Add constraint for message direction
ALTER TABLE messages ADD CONSTRAINT check_message_direction 
    CHECK (direction IN ('in', 'out'));

-- Add constraint to ensure chat_jid is not empty
ALTER TABLE messages ADD CONSTRAINT check_chat_jid_not_empty 
    CHECK (chat_jid IS NOT NULL AND trim(chat_jid) != '');

-- Add constraint to ensure sender is not empty
ALTER TABLE messages ADD CONSTRAINT check_sender_not_empty 
    CHECK (sender IS NOT NULL AND trim(sender) != '');

-- Create function to clean phone numbers (remove non-digits except +)
CREATE OR REPLACE FUNCTION clean_phone_number(phone_input TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Remove all characters except digits and +
    -- Keep + only at the beginning
    RETURN regexp_replace(
        regexp_replace(phone_input, '[^0-9+]', '', 'g'),
        '(?<!^)\+', '', 'g'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create trigger to automatically clean phone numbers on insert/update
CREATE OR REPLACE FUNCTION trigger_clean_phone_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.phone = clean_phone_number(NEW.phone);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clean_phone_before_insert_update
    BEFORE INSERT OR UPDATE ON contacts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_clean_phone_number();

-- Add index for faster chat list queries (latest message per chat)
CREATE INDEX IF NOT EXISTS idx_messages_chat_latest 
    ON messages(user_id, chat_jid, timestamp DESC);

-- Add index for bulk message operations
CREATE INDEX IF NOT EXISTS idx_messages_bulk_operations 
    ON messages(user_id, direction, timestamp DESC) 
    WHERE direction = 'out';

-- Create view for chat list with latest message
CREATE OR REPLACE VIEW chat_list AS
SELECT DISTINCT ON (user_id, chat_jid)
    user_id,
    chat_jid,
    sender,
    message,
    timestamp,
    direction,
    id as message_id
FROM messages
ORDER BY user_id, chat_jid, timestamp DESC;

-- Grant access to the view
GRANT SELECT ON chat_list TO authenticated;