-- Migration: VBROWSER-LIFECYCLE-001 (Virtual Browser Resource Lifecycle & Room Persistence Integration)
ALTER TABLE public.vbrowser_reservations DROP CONSTRAINT IF EXISTS vbrowser_reservations_status_check;
ALTER TABLE public.vbrowser_reservations 
  ADD COLUMN IF NOT EXISTS operation_id text,
  ADD COLUMN IF NOT EXISTS vmid text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.vbrowser_reservations
  ADD CONSTRAINT vbrowser_reservations_status_check 
  CHECK (status IN ('RESERVED', 'ALLOCATED', 'RELEASING', 'RELEASED', 'FAILED', 'EXPIRED'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vbrowser_res_operation_id 
  ON public.vbrowser_reservations(operation_id) 
  WHERE operation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vbrowser_res_active_room 
  ON public.vbrowser_reservations(room_id) 
  WHERE status IN ('RESERVED', 'ALLOCATED', 'RELEASING');

CREATE INDEX IF NOT EXISTS idx_vbrowser_res_status_created_at 
  ON public.vbrowser_reservations(status, created_at);

CREATE INDEX IF NOT EXISTS idx_vbrowser_res_room_id_status 
  ON public.vbrowser_reservations(room_id, status);
