-- Migration: Campaigns (Scheduling for Blaster)

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    template_id UUID NULL REFERENCES message_templates(id) ON DELETE SET NULL,
    numbers TEXT NOT NULL, -- one per line
    start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled|running|done|paused|failed
    throttle_min_ms INTEGER DEFAULT 2000,
    throttle_max_ms INTEGER DEFAULT 7000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_start_at ON campaigns(start_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

