-- Security definer function to insert messages with specified user_id

CREATE OR REPLACE FUNCTION insert_message_secure(
    p_user uuid,
    p_chat_jid text,
    p_sender text,
    p_text text,
    p_direction text,
    p_timestamp timestamptz,
    p_stanza_id text,
    p_raw jsonb,
    p_reply_to uuid,
    p_quoted_text text,
    p_quoted_sender text,
    p_sender_jid text
)
RETURNS messages AS $$
DECLARE
    rec messages%ROWTYPE;
BEGIN
    INSERT INTO messages (
        user_id, chat_jid, sender, message, direction, timestamp, stanza_id,
        raw_message, reply_to_id, quoted_text, quoted_sender, sender_jid
    ) VALUES (
        p_user, p_chat_jid, p_sender, p_text, p_direction, p_timestamp, p_stanza_id,
        p_raw, p_reply_to, p_quoted_text, p_quoted_sender, p_sender_jid
    ) RETURNING * INTO rec;
    RETURN rec;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION insert_message_secure(uuid, text, text, text, text, timestamptz, text, jsonb, uuid, text, text, text) TO authenticated;

