-- Fix the ON DELETE SET NULL contradiction
ALTER TABLE public.room_messages ALTER COLUMN user_id DROP NOT NULL;

-- Add client_message_id for idempotency
ALTER TABLE public.room_messages ADD COLUMN client_message_id UUID;
ALTER TABLE public.room_messages ADD CONSTRAINT room_messages_client_message_id_key UNIQUE (room_id, user_id, client_message_id);

-- Enforce the updated_at lifecycle constraint
ALTER TABLE public.room_messages ADD CONSTRAINT room_messages_updated_at_check CHECK (updated_at IS NULL OR updated_at >= created_at);
