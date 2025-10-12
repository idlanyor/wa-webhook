-- Security definer functions to bypass RLS safely for contact operations

CREATE OR REPLACE FUNCTION insert_contact_secure(p_user uuid, p_name text, p_phone text, p_tags text)
RETURNS uuid AS $$
DECLARE
    new_id uuid;
BEGIN
    INSERT INTO contacts (user_id, name, phone, tags)
    VALUES (p_user, p_name, p_phone, COALESCE(p_tags, ''))
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_contact_tags_secure(p_user uuid, p_id uuid, p_tags text)
RETURNS void AS $$
BEGIN
    UPDATE contacts SET tags = COALESCE(p_tags, '')
    WHERE id = p_id AND user_id = p_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION insert_contact_secure(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_contact_tags_secure(uuid, uuid, text) TO authenticated;

