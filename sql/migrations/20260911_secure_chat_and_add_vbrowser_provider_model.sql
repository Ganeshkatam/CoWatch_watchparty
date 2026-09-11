-- Secure server-managed room data and introduce a persistent, non-secret
-- provider registry for the VBrowser pool architecture.
--
-- Provider credentials deliberately remain in environment variables. `config`
-- is limited to operational metadata such as API region, endpoint and limits.

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;

-- The app reads and writes these tables exclusively through its server-side
-- PostgreSQL connection. With no anon/authenticated policies, browser clients
-- cannot enumerate or mutate chat messages or lifecycle audit records.

CREATE TABLE public.vbrowser_providers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('cloud', 'docker')),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vbrowser_providers_id_not_empty CHECK (btrim(id) <> ''),
  CONSTRAINT vbrowser_providers_display_name_not_empty CHECK (btrim(display_name) <> '')
);

CREATE TABLE public.vbrowser_pools (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT,
  region text NOT NULL,
  is_large boolean NOT NULL DEFAULT false,
  min_size integer NOT NULL DEFAULT 0 CHECK (min_size >= 0),
  limit_size integer CHECK (limit_size IS NULL OR limit_size >= min_size),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vbrowser_pools_id_not_empty CHECK (btrim(id) <> '')
);

ALTER TABLE public.vbrowser
  ADD COLUMN provider_id text REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT;

CREATE INDEX vbrowser_pools_provider_id_idx ON public.vbrowser_pools(provider_id);
CREATE INDEX vbrowser_provider_id_idx ON public.vbrowser(provider_id);

ALTER TABLE public.vbrowser_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_pools ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER vbrowser_providers_set_updated_at
  BEFORE UPDATE ON public.vbrowser_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vbrowser_pools_set_updated_at
  BEFORE UPDATE ON public.vbrowser_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
