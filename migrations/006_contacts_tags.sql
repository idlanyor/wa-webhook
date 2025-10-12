-- Migration: Add tags to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT;

