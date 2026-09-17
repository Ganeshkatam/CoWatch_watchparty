-- Migration: 20260917_create_room_invitations.sql
-- Unified CoWatch Invitation System: Room Invitations Domain Table

CREATE TABLE IF NOT EXISTS public.room_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_reusable BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performant lookups
CREATE INDEX IF NOT EXISTS idx_room_invitations_token_hash ON public.room_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_room_invitations_room_id ON public.room_invitations (room_id);
CREATE INDEX IF NOT EXISTS idx_room_invitations_target_user_id ON public.room_invitations (target_user_id);
CREATE INDEX IF NOT EXISTS idx_room_invitations_inviter_id ON public.room_invitations (inviter_id);

-- Enable Row Level Security
ALTER TABLE public.room_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can read invitations targeted to them or created by them
CREATE POLICY "Users can view their targeted or created invitations"
    ON public.room_invitations
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = inviter_id
        OR auth.uid() = target_user_id
    );

-- RLS Policy: Server service role has full access
CREATE POLICY "Service role full access on room_invitations"
    ON public.room_invitations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
