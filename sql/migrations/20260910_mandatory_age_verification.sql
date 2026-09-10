-- Mandatory account age declaration / minimum-age enforcement.
-- Minimum age: 18 years.
--
-- Important: raw_user_meta_data is user-editable after account creation in Supabase.
-- This trigger therefore enforces the metadata requirement at INSERT time; it is
-- not an identity-proofing mechanism. A stronger age-assurance product would
-- require a trusted verification provider or a Supabase Before User Created hook.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.check_user_age_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_birthdate DATE;
BEGIN
  IF COALESCE(new.raw_user_meta_data ->> 'age_verified', '') <> 'true' THEN
    RAISE EXCEPTION 'Age verification failed: age verification is required for account creation.';
  END IF;

  IF NULLIF(new.raw_user_meta_data ->> 'birthdate', '') IS NULL THEN
    RAISE EXCEPTION 'Age verification failed: Date of birth is required for account creation.';
  END IF;

  BEGIN
    user_birthdate := (new.raw_user_meta_data ->> 'birthdate')::DATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Age verification failed: Invalid date format.';
  END;

  IF user_birthdate > current_date THEN
    RAISE EXCEPTION 'Age verification failed: Date of birth cannot be in the future.';
  END IF;

  IF age(current_date::timestamp, user_birthdate::timestamp) < interval '18 years' THEN
    RAISE EXCEPTION 'Age verification failed: You must be at least 18 years old to create an account.';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_user_age_verification ON auth.users;

CREATE TRIGGER trg_check_user_age_verification
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.check_user_age_verification();

-- Store the declared birthdate only after auth.users has passed the INSERT guard.
-- Using a separate trigger avoids depending on the exact existing handle_new_user()
-- implementation while remaining compatible with an existing profiles INSERT trigger.
CREATE OR REPLACE FUNCTION public.sync_user_age_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, date_of_birth, age_verified_at)
  VALUES (
    new.id,
    (new.raw_user_meta_data ->> 'birthdate')::DATE,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    date_of_birth = EXCLUDED.date_of_birth,
    age_verified_at = EXCLUDED.age_verified_at;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_age_verification ON auth.users;

CREATE TRIGGER trg_sync_user_age_verification
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_age_verification();

GRANT EXECUTE ON FUNCTION public.check_user_age_verification() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.sync_user_age_verification() TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.check_user_age_verification() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_user_age_verification() FROM anon, authenticated, public;
