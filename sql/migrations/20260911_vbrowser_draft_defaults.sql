-- New infrastructure records start disabled. Enabling requires an explicit
-- lifecycle transition after policy validation.
ALTER TABLE public.vbrowser_providers ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE public.vbrowser_pools ALTER COLUMN enabled SET DEFAULT false;
