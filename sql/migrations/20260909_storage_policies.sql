-- Migration: 20260909_storage_policies.sql
-- Enforce strict RLS on room_covers and avatars buckets

-- Ensure the buckets exist with the correct configurations
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('room_covers', 'room_covers', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Enable RLS on storage.objects (assumed already enabled in Supabase)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Remove any existing permissive policies for these buckets
DROP POLICY IF EXISTS "Public Select avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth Insert avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth Delete avatars" ON storage.objects;

DROP POLICY IF EXISTS "Public Select room_covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth Insert room_covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update room_covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth Delete room_covers" ON storage.objects;

-- Create strict policies

-- Avatars: Public read
CREATE POLICY "Public Select avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Avatars: Owner write
CREATE POLICY "Auth Insert avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Auth Update avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Auth Delete avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Room Covers: Public read
CREATE POLICY "Public Select room_covers"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'room_covers');

-- Room Covers: Owner write
CREATE POLICY "Auth Insert room_covers"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'room_covers' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Auth Update room_covers"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'room_covers' AND 
  auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'room_covers' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Auth Delete room_covers"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'room_covers' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);


DROP POLICY IF EXISTS "Public Access to app bucket" ON storage.objects;
CREATE POLICY "Public Access to app bucket"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'app');
