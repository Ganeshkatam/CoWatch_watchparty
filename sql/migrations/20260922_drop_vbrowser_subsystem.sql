BEGIN;

-- 1. Drop VBrowser Tables
DROP TABLE IF EXISTS public.vbrowser_reservations;
DROP TABLE IF EXISTS public.vbrowser;
DROP TABLE IF EXISTS public.vbrowser_pools;
DROP TABLE IF EXISTS public.vbrowser_providers;

-- 2. Drop VBrowser Functions
DROP FUNCTION IF EXISTS public.reserve_vbrowser_capacity(text, text, text, text, boolean, integer, integer, integer);
DROP FUNCTION IF EXISTS public.vbrowser_acquire_reservation(text, text, text, uuid, boolean, integer, integer, integer);
DROP FUNCTION IF EXISTS public.vbrowser_release_reservation(uuid, text);
DROP FUNCTION IF EXISTS public.check_vbrowser_concurrency_allowed(uuid);

-- 3. Remove VBrowser Constraints from Core Tables
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS check_vbrowser_concurrency_allowed,
  DROP CONSTRAINT IF EXISTS subscription_plans_max_vbrowser_concurrency_check;

ALTER TABLE public.account_room_limits
  DROP CONSTRAINT IF EXISTS account_room_limits_override_vbrowser_concurrency_check;

-- 4. Recreate resolve_account_entitlement (Dropping output columns)
DROP FUNCTION IF EXISTS public.resolve_account_entitlement(uuid);

CREATE OR REPLACE FUNCTION public.resolve_account_entitlement(p_account_id uuid)
 RETURNS TABLE(account_id uuid, plan_id text, plan_display_name text, enabled boolean, max_total_rooms integer, max_watch_rooms integer, max_permanent_rooms integer, max_participant_capacity integer, max_room_duration_hours integer, has_overrides boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_rec RECORD;
  v_eff_total integer;
  v_eff_watch integer;
  v_eff_permanent integer;
  v_eff_capacity integer;
  v_eff_duration integer;
  v_has_overrides boolean;
BEGIN
  SELECT 
    l.account_id,
    l.plan_id,
    p.display_name AS plan_display_name,
    l.enabled,
    p.max_total_rooms AS base_total,
    p.max_watch_rooms AS base_watch,
    p.max_permanent_rooms AS base_permanent,
    p.max_participant_capacity AS base_capacity,
    p.max_room_duration_hours AS base_duration,
    l.override_total_rooms,
    l.override_watch_rooms,
    l.override_permanent_rooms,
    l.override_participant_capacity,
    l.override_room_duration_hours
  INTO v_rec
  FROM public.account_room_limits l
  JOIN public.subscription_plans p ON l.plan_id = p.id
  WHERE l.account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_ENTITLEMENT_NOT_FOUND';
  END IF;

  v_eff_total := COALESCE(v_rec.override_total_rooms, v_rec.base_total);
  v_eff_watch := LEAST(COALESCE(v_rec.override_watch_rooms, v_rec.base_watch), v_eff_total);
  v_eff_permanent := LEAST(COALESCE(v_rec.override_permanent_rooms, v_rec.base_permanent), v_eff_total);
  v_eff_capacity := COALESCE(v_rec.override_participant_capacity, v_rec.base_capacity);
  v_eff_duration := COALESCE(v_rec.override_room_duration_hours, v_rec.base_duration);

  v_has_overrides := (
    v_rec.override_total_rooms IS NOT NULL OR
    v_rec.override_watch_rooms IS NOT NULL OR
    v_rec.override_permanent_rooms IS NOT NULL OR
    v_rec.override_participant_capacity IS NOT NULL OR
    v_rec.override_room_duration_hours IS NOT NULL
  );

  account_id := v_rec.account_id;
  plan_id := v_rec.plan_id;
  plan_display_name := v_rec.plan_display_name;
  enabled := v_rec.enabled;
  max_total_rooms := v_eff_total;
  max_watch_rooms := v_eff_watch;
  max_permanent_rooms := v_eff_permanent;
  max_participant_capacity := v_eff_capacity;
  max_room_duration_hours := v_eff_duration;
  has_overrides := v_has_overrides;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_account_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account_entitlement(uuid) TO postgres, service_role;

-- 5. Remove VBrowser Columns from Core Tables
ALTER TABLE public.subscription_plans
  DROP COLUMN IF EXISTS is_vbrowser_allowed,
  DROP COLUMN IF EXISTS max_vbrowser_concurrency;

ALTER TABLE public.account_room_limits
  DROP COLUMN IF EXISTS override_vbrowser_allowed,
  DROP COLUMN IF EXISTS override_vbrowser_concurrency;

COMMIT;
