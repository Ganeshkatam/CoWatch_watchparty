-- CoWatch approved email provider policy.
-- Applies only when a new auth.users row is inserted. Existing users are unaffected.

CREATE OR REPLACE FUNCTION public.check_user_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  normalized_email text;
  email_domain text;
BEGIN
  normalized_email := lower(trim(coalesce(NEW.email, '')));

  IF normalized_email = ''
     OR position('@' IN normalized_email) <= 1
     OR position('@' IN substring(normalized_email FROM position('@' IN normalized_email) + 1)) > 0
     OR normalized_email ~ '[[:space:]]'
  THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  email_domain := split_part(normalized_email, '@', 2);

  IF email_domain NOT IN (
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'zoho.com',
    'proton.me',
    'protonmail.com'
  ) THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_user_email_domain ON auth.users;

CREATE TRIGGER trg_check_user_email_domain
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.check_user_email_domain();
