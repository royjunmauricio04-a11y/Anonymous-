-- Love Letter Special Feature SQL Upgrade
-- Add this to enable special love letter messages with beautiful designs

-- Create love_letter_templates table
CREATE TABLE IF NOT EXISTS love_letter_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL,
    template_description TEXT,
    background_color TEXT DEFAULT '#FFF0F5',
    text_color TEXT DEFAULT '#8B0000',
    border_color TEXT DEFAULT '#8B0000',
    seal_color TEXT DEFAULT '#FF6B6B',
    seal_icon TEXT DEFAULT '❤️',
    is_premium BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_love_letters table
CREATE TABLE IF NOT EXISTS user_love_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    template_id UUID REFERENCES love_letter_templates(id) ON DELETE SET NULL,
    custom_message TEXT,
    is_unlocked BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT false,
    unlock_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template_id)
);

-- Create sent_love_letters table
CREATE TABLE IF NOT EXISTS sent_love_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES love_letter_templates(id) ON DELETE SET NULL,
    custom_color TEXT,
    seal_used TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to initialize love letter templates
CREATE OR REPLACE FUNCTION init_love_letter_templates()
RETURNS VOID AS $$
BEGIN
    INSERT INTO love_letter_templates (template_name, template_description, background_color, text_color, border_color, seal_color, seal_icon, is_premium, is_active)
    VALUES
        ('Classic Love', 'Traditional red and white love letter', '#FFF0F5', '#8B0000', '#DC143C', '#FF6B6B', '❤️', false, true),
        ('Pink Rose', 'Soft pink with rose seal', '#FFE4E1', '#DB7093', '#FF69B4', '#FF1493', '🌹', false, true),
        ('Golden Love', 'Elegant gold on cream', '#FFF8DC', '#8B4513', '#FFD700', '#FFA500', '💍', false, true),
        ('Purple Passion', 'Deep purple passion', '#F0E6FF', '#4B0082', '#800080', '#9370DB', '💜', false, true),
        ('Blue Romance', 'Cool blue romance', '#E6F2FF', '#1E90FF', '#4169E1', '#6495ED', '💙', false, true),
        ('Vintage Scroll', 'Ancient parchment look', '#F5F5DC', '#8B4513', '#A0522D', '#D2691E', '📜', false, true),
        ('Sunset Love', 'Warm sunset colors', '#FFE4B5', '#FF4500', '#FF8C00', '#FFD700', '🌅', false, true),
        ('Moonlight', 'Cool moonlight theme', '#F0F8FF', '#708090', '#2F4F4F', '#A9A9A9', '🌙', false, true),
        ('Royal Love', 'Regal purple and gold', '#F8F0FF', '#4B0082', '#9400D3', '#FFD700', '👑', true, true),
        ('Diamond', 'Sparkling diamond theme', '#FFFFFF', '#000000', '#C0C0C0', '#FFFFFF', '✨', true, true),
        ('Eternal Love', 'Timeless black and gold', '#000000', '#FFD700', '#FFD700', '#FFD700', '∞', true, true),
        ('Secret Admirer', 'Mysterious dark theme', '#1A1A2E', '#E94560', '#16213E', '#E94560', '👁️', true, true)
    ON CONFLICT (template_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unlock a love letter template
CREATE OR REPLACE FUNCTION unlock_love_letter(
    p_user_id UUID,
    p_username TEXT,
    p_template_id UUID
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO user_love_letters (user_id, username, template_id, is_unlocked, is_active, unlock_date)
    VALUES (p_user_id, p_username, p_template_id, true, false, NOW())
    ON CONFLICT (user_id, template_id)
    DO UPDATE SET is_unlocked = true, unlock_date = NOW(), updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to activate a love letter template
CREATE OR REPLACE FUNCTION activate_love_letter(
    p_user_id UUID,
    p_template_id UUID,
    p_is_active BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    UPDATE user_love_letters
    SET is_active = p_is_active, updated_at = NOW()
    WHERE user_id = p_user_id AND template_id = p_template_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's love letter templates
CREATE OR REPLACE FUNCTION get_user_love_letters(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'templates', (
            SELECT json_agg(json_build_object(
                'id', t.id,
                'name', t.template_name,
                'description', t.template_description,
                'background_color', t.background_color,
                'text_color', t.text_color,
                'border_color', t.border_color,
                'seal_color', t.seal_color,
                'seal_icon', t.seal_icon,
                'is_premium', t.is_premium,
                'is_active', COALESCE(ull.is_active, false),
                'is_unlocked', COALESCE(ull.is_unlocked, false),
                'unlock_date', ull.unlock_date
            ))
            FROM love_letter_templates t
            LEFT JOIN user_love_letters ull ON t.id = ull.template_id AND ull.user_id = p_user_id
            WHERE t.is_active = true
        ),
        'active_template', (
            SELECT json_build_object(
                'id', t.id,
                'name', t.template_name,
                'background_color', t.background_color,
                'text_color', t.text_color,
                'border_color', t.border_color,
                'seal_color', t.seal_color,
                'seal_icon', t.seal_icon
            )
            FROM user_love_letters ull
            JOIN love_letter_templates t ON ull.template_id = t.id
            WHERE ull.user_id = p_user_id AND ull.is_active = true
            LIMIT 1
        )
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record a love letter being sent
CREATE OR REPLACE FUNCTION record_love_letter(
    p_message_id UUID,
    p_sender_id UUID,
    p_template_id UUID,
    p_custom_color TEXT,
    p_seal_used TEXT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO sent_love_letters (message_id, sender_id, template_id, custom_color, seal_used)
    VALUES (p_message_id, p_sender_id, p_template_id, p_custom_color, p_seal_used);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for anon role
GRANT SELECT, INSERT, UPDATE ON love_letter_templates TO anon;
GRANT SELECT, INSERT, UPDATE ON user_love_letters TO anon;
GRANT SELECT, INSERT ON sent_love_letters TO anon;

-- Grant sequence permissions only if sequences exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'love_letter_templates_id_seq') THEN
        GRANT USAGE ON SEQUENCE love_letter_templates_id_seq TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'user_love_letters_id_seq') THEN
        GRANT USAGE ON SEQUENCE user_love_letters_id_seq TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'sent_love_letters_id_seq') THEN
        GRANT USAGE ON SEQUENCE sent_love_letters_id_seq TO anon;
    END IF;
END;
$$;

-- Allow execution of RPC functions
GRANT EXECUTE ON FUNCTION init_love_letter_templates() TO anon;
GRANT EXECUTE ON FUNCTION unlock_love_letter(UUID, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION activate_love_letter(UUID, UUID, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION get_user_love_letters(UUID) TO anon;
GRANT EXECUTE ON FUNCTION record_love_letter(UUID, UUID, UUID, TEXT, TEXT) TO anon;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_love_letter_templates_name ON love_letter_templates(template_name);
CREATE INDEX IF NOT EXISTS idx_user_love_letters_user_id ON user_love_letters(user_id);
CREATE INDEX IF NOT EXISTS idx_user_love_letters_template_id ON user_love_letters(template_id);
CREATE INDEX IF NOT EXISTS idx_sent_love_letters_message_id ON sent_love_letters(message_id);
CREATE INDEX IF NOT EXISTS idx_sent_love_letters_sender_id ON sent_love_letters(sender_id);

-- Initialize templates
SELECT init_love_letter_templates();

COMMENT ON TABLE love_letter_templates IS 'Stores available love letter templates';
COMMENT ON TABLE user_love_letters IS 'Tracks which users have unlocked which love letter templates';
COMMENT ON TABLE sent_love_letters IS 'Tracks which messages used which love letter templates';
