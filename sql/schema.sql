CREATE EXTENSION pg_trgm;
CREATE EXTENSION pgcrypto;

CREATE TABLE public.profiles(
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, -- Unique user identifier linked to Supabase Auth
  updated_at timestamp with time zone DEFAULT now(), -- Timestamp of the last profile update
  username text, -- User's chosen username
  display_name text, -- User's display name
  avatar_url text, -- URL to the user's avatar image
  pref_show_chat_column boolean NOT NULL DEFAULT true, -- Preference to show the chat column
  pref_show_people_column boolean NOT NULL DEFAULT false, -- Preference to show the people column
  pref_disable_chat_sound boolean NOT NULL DEFAULT false, -- Preference to disable chat notification sounds
  pref_camera_on boolean NOT NULL DEFAULT false, -- Preference to turn camera on by default
  pref_mic_on boolean NOT NULL DEFAULT false, -- Preference to turn microphone on by default
  pref_appearance_mode text NOT NULL DEFAULT 'system' CHECK (pref_appearance_mode IN ('light', 'mantine', 'system')), -- Preference for UI theme mode
  CONSTRAINT profiles_display_name_length CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 50)
);

CREATE TABLE public.rooms(
  
  "roomId" text, -- Unique identifier for the room
  "creationTime" timestamp with time zone, -- Timestamp when the room was first created
  passcode text, -- Bcrypt hashed passcode for private rooms
  owner_id uuid NOT NULL REFERENCES public.profiles(id), -- User ID of the room owner (always required)

  "isChatDisabled" boolean NOT NULL DEFAULT false, -- Whether chat is disabled for all users in the room
  "isSubRoom" boolean, -- Indicates if this is a sub-room (e.g., breakout room)
  "coverPhoto" text, -- URL to the room's cover photo
  data jsonb, -- Additional flexible metadata for the room
  "lastUpdateTime" timestamp with time zone, -- Timestamp of the last room activity or state change
  "roomTitle" text NOT NULL, -- Display title of the room
  "roomDescription" text, -- Text description of the room's content
  "mediaPath" text, -- URL or path to the current media being played
  status text NOT NULL DEFAULT 'active', -- Current lifecycle status (scheduled, active, ended, expired)
  "startedAt" timestamp with time zone NOT NULL, -- Timestamp when the room became active
  "isPermanent" boolean NOT NULL DEFAULT false, -- True if the room is a permanent room
  "expiresAt" timestamp with time zone, -- Timestamp when the room is scheduled to expire, null if permanent
  "endedAt" timestamp with time zone, -- Timestamp when the room was explicitly ended
  "lastActiveAt" timestamp with time zone, -- Timestamp of the last verified socket presence
  owner_passcode text NOT NULL, -- Encrypted passcode available only to the room owner
  "scheduledStartsAt" timestamp with time zone, -- Optional scheduled start timestamp
  passcode_fingerprint text NOT NULL, -- Stable fingerprint used to identify the room passcode
  PRIMARY KEY ("roomId"),
  CONSTRAINT room_status_check CHECK (status IN ('scheduled', 'active', 'inactive', 'ended', 'expired')),
  CONSTRAINT room_title_not_empty CHECK (btrim("roomTitle") <> ''),
  CONSTRAINT rooms_expiration_policy_check CHECK (
    ("isPermanent" = true AND "expiresAt" IS NULL) OR
    ("isPermanent" = false AND "expiresAt" IS NOT NULL)
  ),
  CONSTRAINT rooms_passcode_fingerprint_key UNIQUE (passcode_fingerprint)
);

CREATE INDEX room_owner_id_idx ON rooms(owner_id);
CREATE INDEX "room_creationTime_idx" ON rooms("creationTime");
CREATE INDEX "room_roomId_idx" ON rooms USING GIN("roomId" gin_trgm_ops);
CREATE INDEX idx_room_expires_at ON rooms("expiresAt") WHERE "expiresAt" IS NOT NULL AND status = 'active';
CREATE INDEX rooms_inactivity_idx ON rooms("lastActiveAt") WHERE status = 'active';

CREATE TABLE public.room_lifecycle_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique event ID
  "roomId" text NOT NULL, -- Room this event belongs to
  actor text NOT NULL, -- Who triggered the event (user uid or 'system')
  event text NOT NULL, -- Event type (e.g. 'room.extended', 'room.expired')
  "previousStatus" text, -- Room status before the event
  "newStatus" text, -- Room status after the event
  "previousExpiresAt" timestamp with time zone, -- Expiration time before the event
  "newExpiresAt" timestamp with time zone, -- Expiration time after the event
  reason text, -- Human-readable reason for the event
  timestamp timestamp with time zone NOT NULL DEFAULT NOW(), -- When the event occurred
  CONSTRAINT room_lifecycle_events_room_fk
    FOREIGN KEY ("roomId") REFERENCES public.rooms("roomId") ON DELETE CASCADE
);
CREATE INDEX idx_room_lifecycle_events_room_id ON room_lifecycle_events("roomId");
CREATE INDEX idx_room_lifecycle_events_timestamp ON room_lifecycle_events(timestamp);

ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  message text NOT NULL,
  message_type text NOT NULL DEFAULT 'user' CHECK (message_type IN ('user', 'system')),
  event_type text,
  metadata jsonb,
  client_message_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone,
  CONSTRAINT room_messages_client_message_id_key UNIQUE (room_id, user_id, client_message_id),
  CONSTRAINT room_messages_updated_at_check CHECK (updated_at IS NULL OR updated_at >= created_at),
  CONSTRAINT room_messages_type_check CHECK (message_type IN ('user', 'system')),
  CONSTRAINT room_messages_event_check CHECK (
    (message_type = 'user' AND event_type IS NULL) OR
    (message_type = 'system' AND event_type IS NOT NULL)
  ),
  CONSTRAINT room_messages_not_empty CHECK (btrim(message) <> '')
);
CREATE INDEX room_messages_room_created_id_idx ON room_messages(room_id, created_at DESC, id DESC);

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;



CREATE TABLE public.vbrowser(
  id bigserial PRIMARY KEY, -- numeric sequence ID
  pool text NOT NULL, -- name of the pool this VM is in, e.g. HetznerLargeUS
  vmid text NOT NULL, -- identifier for the VM, only unique across a provider
  state text NOT NULL, -- available, staging, used
  "creationTime" timestamp with time zone NOT NULL, -- time the VM was created
  "heartbeatTime" timestamp with time zone, -- last time a room reported this VM was in use
  "assignTime" timestamp with time zone, -- last time the room was assigned
  "roomId" text, -- room VM assigned to
  uid text, -- user requesting the VM
  data json, -- metadata for the VM
  retries int DEFAULT 0, -- how many times we checked if VM is up
  pass text, -- password to access vbrowser
  image text -- ID of the last image applied to this VM
);
CREATE UNIQUE INDEX vbrowser_pool_vmid_idx ON vbrowser(pool, vmid);
CREATE INDEX vbrowser_pool_state_idx ON vbrowser(pool, state);
CREATE INDEX "vbrowser_roomId_idx" ON vbrowser("roomId");
CREATE INDEX vbrowser_uid_idx ON vbrowser(uid);

CREATE TABLE public.vbrowser_providers(
  id text PRIMARY KEY,
  display_name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('cloud', 'docker')),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vbrowser_providers_id_not_empty CHECK (btrim(id) <> ''),
  CONSTRAINT vbrowser_providers_display_name_not_empty CHECK (btrim(display_name) <> '')
);

CREATE TABLE public.vbrowser_pools(
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT,
  region text NOT NULL,
  is_large boolean NOT NULL DEFAULT false,
  min_size integer NOT NULL DEFAULT 0 CHECK (min_size >= 0),
  limit_size integer CHECK (limit_size IS NULL OR limit_size >= min_size),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vbrowser_pools_id_not_empty CHECK (btrim(id) <> '')
);

ALTER TABLE public.vbrowser ADD COLUMN provider_id text REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT;
CREATE INDEX vbrowser_pools_provider_id_idx ON public.vbrowser_pools(provider_id);
CREATE INDEX vbrowser_provider_id_idx ON public.vbrowser(provider_id);

CREATE TABLE active_user(
  uid text PRIMARY KEY, -- Unique user identifier (session or auth uid)
  "lastActiveTime" timestamp with time zone -- Timestamp of the user's last recorded activity
);

-- ==========================================
-- FUNCTIONS & TRIGGERS
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
begin
  insert into public.profiles (
    id,
    username,
    avatar_url,
    display_name
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'username',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do update set
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

-- Trigger to automatically create a profile when a new user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vbrowser_providers_set_updated_at
  BEFORE UPDATE ON public.vbrowser_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vbrowser_pools_set_updated_at
  BEFORE UPDATE ON public.vbrowser_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_pools ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Room Policies
CREATE POLICY "Users can view their own rooms" ON public.rooms FOR SELECT USING (auth.uid() = owner_id);

-- ==========================================
-- STORAGE BUCKETS
-- ==========================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES 
  ('avatars', 'avatars', true, 1048576),
  ('room_covers', 'room_covers', true, 5242880)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies (Avatars Bucket)
CREATE POLICY "Avatar images are publicly accessible." ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload avatars to their own folder." ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update avatars in their own folder." ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete avatars in their own folder." ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage Policies (Room Covers Bucket)
CREATE POLICY "Room covers are publicly accessible." ON storage.objects FOR SELECT USING (bucket_id = 'room_covers');
CREATE POLICY "Users can upload room covers to their own folder." ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'room_covers' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update room covers in their own folder." ON storage.objects FOR UPDATE USING (bucket_id = 'room_covers' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete room covers in their own folder." ON storage.objects FOR DELETE USING (bucket_id = 'room_covers' AND auth.uid()::text = (storage.foldername(name))[1]);
