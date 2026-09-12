-- Migration: 20260912_quota_002_account_limits_on_signup.sql
-- Description: Automatically provision account_room_limits and account_room_usage on account signup,
--              and backfill all existing profiles.

-- 1. Update handle_new_user() trigger function to provision profile, limits, and usage atomically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1. Provision profile
  INSERT INTO public.profiles (
    id,
    username,
    avatar_url,
    display_name
  )
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'username',
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      NEW.raw_user_meta_data ->> 'username',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    avatar_url = COALESCE(public.profiles.avatar_url, excluded.avatar_url),
    display_name = COALESCE(public.profiles.display_name, excluded.display_name);

  -- 2. Provision account room limits (default quotas: 5 total, 5 watch, 2 permanent)
  INSERT INTO public.account_room_limits (
    account_id,
    max_total_rooms,
    max_watch_rooms,
    max_permanent_rooms,
    enabled,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    5,
    5,
    2,
    true,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (account_id) DO NOTHING;

  -- 3. Provision account room usage
  INSERT INTO public.account_room_usage (
    account_id,
    total_rooms,
    watch_rooms,
    permanent_rooms,
    updated_at
  )
  VALUES (
    NEW.id,
    0,
    0,
    0,
    clock_timestamp()
  )
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. Ensure execution permissions remain locked to postgres / service_role
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role, supabase_auth_admin;

-- 3. Comprehensive Backfill: Provision default room limits for all existing profiles
INSERT INTO public.account_room_limits (
  account_id,
  max_total_rooms,
  max_watch_rooms,
  max_permanent_rooms,
  enabled,
  created_at,
  updated_at
)
SELECT 
  id,
  5,
  5,
  2,
  true,
  clock_timestamp(),
  clock_timestamp()
FROM public.profiles
ON CONFLICT (account_id) DO NOTHING;

-- 4. Comprehensive Backfill: Ensure room usage is initialized for all existing profiles
INSERT INTO public.account_room_usage (
  account_id,
  total_rooms,
  watch_rooms,
  permanent_rooms,
  updated_at
)
SELECT 
  id,
  0,
  0,
  0,
  clock_timestamp()
FROM public.profiles
ON CONFLICT (account_id) DO NOTHING;
