-- MEDIA-LOCAL-001: Room-Scoped Local Media Sessions Table
-- Schema for tracking active P2P local media manifests & host distribution sessions

CREATE TABLE IF NOT EXISTS public.room_media_sessions (
  media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'FAILED')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  duration_seconds NUMERIC(10, 3) NOT NULL DEFAULT 0,
  codec TEXT NOT NULL DEFAULT '',
  container TEXT NOT NULL DEFAULT 'mp4',
  content_hash TEXT NOT NULL,
  chunk_size INT NOT NULL DEFAULT 131072,
  total_chunks INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_room_media_sessions_room_id ON public.room_media_sessions(room_id);

-- SEC-001B Compliance: Server-Only Classification
REVOKE ALL ON TABLE public.room_media_sessions FROM anon, authenticated, PUBLIC;
ALTER TABLE public.room_media_sessions ENABLE ROW LEVEL SECURITY;
