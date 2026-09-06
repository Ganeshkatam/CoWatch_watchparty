-- 1. `rooms` — add inactivity state
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS room_status_check;
ALTER TABLE public.rooms ADD CONSTRAINT room_status_check CHECK (
  status IN (
    'scheduled',
    'active',
    'inactive',
    'ended',
    'expired'
  )
);

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS "lastActiveAt" timestamp with time zone;

CREATE INDEX IF NOT EXISTS rooms_inactivity_idx
ON public.rooms ("lastActiveAt")
WHERE status = 'active';

-- 2. `room_messages` — permanent chat
CREATE TABLE IF NOT EXISTS public.room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  room_id text NOT NULL
    REFERENCES public.rooms("roomId")
    ON DELETE CASCADE,

  user_id uuid
    REFERENCES public.profiles(id)
    ON DELETE SET NULL,

  message text NOT NULL,

  message_type text NOT NULL DEFAULT 'user',

  event_type text,

  metadata jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),

  updated_at timestamp with time zone,

  CONSTRAINT room_messages_type_check
    CHECK (message_type IN ('user', 'system')),

  CONSTRAINT room_messages_event_check
    CHECK (
      (message_type = 'user' AND event_type IS NULL)
      OR
      (message_type = 'system' AND event_type IS NOT NULL)
    ),

  CONSTRAINT room_messages_not_empty
    CHECK (btrim(message) <> '')
);

CREATE INDEX IF NOT EXISTS room_messages_room_created_id_idx
ON public.room_messages (
  room_id,
  created_at DESC,
  id DESC
);

-- 3. Lifecycle events foreign key
ALTER TABLE public.room_lifecycle_events
DROP CONSTRAINT IF EXISTS room_lifecycle_events_room_fk;

ALTER TABLE public.room_lifecycle_events
ADD CONSTRAINT room_lifecycle_events_room_fk
FOREIGN KEY ("roomId")
REFERENCES public.rooms("roomId")
ON DELETE RESTRICT;

-- 4. Rooms expiration policy invariant
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_expiration_policy_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_expiration_policy_check
CHECK (
  ("isPermanent" = true AND "expiresAt" IS NULL)
  OR
  ("isPermanent" = false AND "expiresAt" IS NOT NULL)
);
