-- Animated Messages SQL Upgrade
-- Add this to your Supabase database to enable animated message cards

-- Create animated_message_templates table
CREATE TABLE IF NOT EXISTS animated_message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL,
    template_description TEXT,
    animation_type TEXT NOT NULL, -- 'fade', 'slide', 'bounce', 'heart', 'confetti', 'sparkle', 'love_letter', 'typewriter'
    color_scheme TEXT DEFAULT '#E5334B',
    is_premium BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_animated_messages table to track which users have which animations
CREATE TABLE IF NOT EXISTS user_animated_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    template_id UUID REFERENCES animated_message_templates(id) ON DELETE SET NULL,
    is_unlocked BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT false,
    unlock_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template_id)
);

-- Create sent_animated_messages table to track animated messages sent
CREATE TABLE IF NOT EXISTS sent_animated_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES animated_message_templates(id) ON DELETE SET NULL,
    animation_type TEXT,
    custom_color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to initialize animated message templates
CREATE OR REPLACE FUNCTION init_animated_templates()
RETURNS VOID AS $$
BEGIN
    -- Love Letter templates
    INSERT INTO animated_message_templates (template_name, template_description, animation_type, color_scheme, is_premium, is_active)
    VALUES 
        ('Love Letter', 'Beautiful love letter with seal animation', 'love_letter', '#E5334B', false, true),
        ('Floating Hearts', 'Hearts float up from the message', 'heart', '#FF6B6B', false, true),
        ('Confetti Burst', 'Colorful confetti explodes on open', 'confetti', '#FFD700', false, true),
        ('Sparkle Effect', 'Sparkles shimmer across the message', 'sparkle', '#FF69B4', false, true),
        ('Typewriter', 'Message appears as if being typed', 'typewriter', '#E5334B', false, true),
        ('Fade In', 'Message gently fades in', 'fade', '#9C8F7A', false, true),
        ('Slide Up', 'Message slides up from bottom', 'slide', '#228B22', false, true),
        ('Bounce', 'Message bounces into view', 'bounce', '#4169E1', false, true),
        ('Rose Petals', 'Rose petals fall around the message', 'petals', '#FF1493', true, true),
        ('Fireworks', 'Fireworks display when opened', 'fireworks', '#FF4500', true, true),
        ('Golden Letter', 'Message appears with gold foil effect', 'golden', '#FFD700', true, true),
        ('Vintage Scroll', 'Message unfurls like an ancient scroll', 'scroll', '#8B4513', true, true)
    ON CONFLICT (template_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unlock a template for a user
CREATE OR REPLACE FUNCTION unlock_animation_template(
    p_user_id UUID,
    p_username TEXT,
    p_template_id UUID
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO user_animated_messages (user_id, username, template_id, is_unlocked, is_active, unlock_date)
    VALUES (p_user_id, p_username, p_template_id, true, false, NOW())
    ON CONFLICT (user_id, template_id) 
    DO UPDATE SET is_unlocked = true, unlock_date = NOW(), updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to activate a template for a user
CREATE OR REPLACE FUNCTION activate_animation_template(
    p_user_id UUID,
    p_template_id UUID,
    p_is_active BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    UPDATE user_animated_messages 
    SET is_active = p_is_active, updated_at = NOW()
    WHERE user_id = p_user_id AND template_id = p_template_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's unlocked templates
CREATE OR REPLACE FUNCTION get_user_animations(p_user_id UUID)
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
                'animation_type', t.animation_type,
                'color_scheme', t.color_scheme,
                'is_premium', t.is_premium,
                'is_active', COALESCE(uam.is_active, false),
                'is_unlocked', COALESCE(uam.is_unlocked, false),
                'unlock_date', uam.unlock_date
            ))
            FROM animated_message_templates t
            LEFT JOIN user_animated_messages uam ON t.id = uam.template_id AND uam.user_id = p_user_id
            WHERE t.is_active = true
        ),
        'active_template', (
            SELECT json_build_object(
                'id', t.id,
                'name', t.template_name,
                'animation_type', t.animation_type,
                'color_scheme', t.color_scheme
            )
            FROM user_animated_messages uam
            JOIN animated_message_templates t ON uam.template_id = t.id
            WHERE uam.user_id = p_user_id AND uam.is_active = true
            LIMIT 1
        )
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record an animated message being sent
CREATE OR REPLACE FUNCTION record_animated_message(
    p_message_id UUID,
    p_sender_id UUID,
    p_template_id UUID,
    p_animation_type TEXT,
    p_custom_color TEXT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO sent_animated_messages (message_id, sender_id, template_id, animation_type, custom_color)
    VALUES (p_message_id, p_sender_id, p_template_id, p_animation_type, p_custom_color);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unlock templates based on achievements
CREATE OR REPLACE FUNCTION unlock_templates_by_achievement(
    p_user_id UUID,
    p_username TEXT
)
RETURNS VOID AS $$
DECLARE
    v_achievement_count INTEGER;
    v_message_count INTEGER;
    v_receive_count INTEGER;
BEGIN
    -- Count achievements (from plant_achievements or similar)
    SELECT COUNT(*) INTO v_achievement_count
    FROM plant_achievements 
    WHERE user_id = p_user_id AND is_unlocked = true;
    
    -- Count messages sent
    SELECT COUNT(*) INTO v_message_count
    FROM plant_activities 
    WHERE user_id = p_user_id AND activity_type = 'send_message';
    
    -- Count messages received
    SELECT COUNT(*) INTO v_receive_count
    FROM plant_activities 
    WHERE user_id = p_user_id AND activity_type = 'receive_message';
    
    -- Unlock templates based on milestones
    -- First template unlocked for everyone
    IF v_achievement_count >= 1 OR v_message_count >= 1 THEN
        INSERT INTO user_animated_messages (user_id, username, template_id, is_unlocked, is_active, unlock_date)
        SELECT p_user_id, p_username, id, true, false, NOW()
        FROM animated_message_templates 
        WHERE template_name = 'Fade In'
        ON CONFLICT (user_id, template_id) DO NOTHING;
    END IF;
    
    -- Unlock more templates at higher levels
    IF v_achievement_count >= 3 OR v_message_count >= 5 THEN
        INSERT INTO user_animated_messages (user_id, username, template_id, is_unlocked, is_active, unlock_date)
        SELECT p_user_id, p_username, id, true, false, NOW()
        FROM animated_message_templates 
        WHERE template_name IN ('Floating Hearts', 'Confetti Burst', 'Sparkle Effect')
        ON CONFLICT (user_id, template_id) DO NOTHING;
    END IF;
    
    -- Unlock love letter at 5 achievements or 10 messages
    IF v_achievement_count >= 5 OR v_message_count >= 10 THEN
        INSERT INTO user_animated_messages (user_id, username, template_id, is_unlocked, is_active, unlock_date)
        SELECT p_user_id, p_username, id, true, false, NOW()
        FROM animated_message_templates 
        WHERE template_name = 'Love Letter'
        ON CONFLICT (user_id, template_id) DO NOTHING;
    END IF;
    
    -- Premium templates require premium status (would need to check that separately)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for anon role
GRANT SELECT, INSERT, UPDATE ON animated_message_templates TO anon;
GRANT SELECT, INSERT, UPDATE ON user_animated_messages TO anon;
GRANT SELECT, INSERT ON sent_animated_messages TO anon;
GRANT USAGE ON SEQUENCE animated_message_templates_id_seq TO anon;
GRANT USAGE ON SEQUENCE user_animated_messages_id_seq TO anon;
GRANT USAGE ON SEQUENCE sent_animated_messages_id_seq TO anon;

-- Allow execution of RPC functions
GRANT EXECUTE ON FUNCTION init_animated_templates() TO anon;
GRANT EXECUTE ON FUNCTION unlock_animation_template(UUID, TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION activate_animation_template(UUID, UUID, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION get_user_animations(UUID) TO anon;
GRANT EXECUTE ON FUNCTION record_animated_message(UUID, UUID, UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION unlock_templates_by_achievement(UUID, TEXT) TO anon;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_animated_templates_name ON animated_message_templates(template_name);
CREATE INDEX IF NOT EXISTS idx_user_animations_user_id ON user_animated_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_animations_template_id ON user_animated_messages(template_id);
CREATE INDEX IF NOT EXISTS idx_sent_animations_message_id ON sent_animated_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_sent_animations_sender_id ON sent_animated_messages(sender_id);

-- Initialize templates
SELECT init_animated_templates();

COMMENT ON TABLE animated_message_templates IS 'Stores available animated message templates';
COMMENT ON TABLE user_animated_messages IS 'Tracks which users have unlocked which animation templates';
COMMENT ON TABLE sent_animated_messages IS 'Tracks which messages used which animations';
