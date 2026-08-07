-- Telemetry on cameras
ALTER TABLE public.live_cameras
  ADD COLUMN IF NOT EXISTS last_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Audit log for live operations
CREATE TABLE IF NOT EXISTS public.live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_id uuid REFERENCES public.lives(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  camera_id uuid,
  actor_id uuid,
  kind text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_events_live_idx ON public.live_events (live_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_events_store_idx ON public.live_events (store_id, created_at DESC);

GRANT SELECT, INSERT ON public.live_events TO authenticated;
GRANT ALL ON public.live_events TO service_role;

ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store owners read own live events" ON public.live_events;
CREATE POLICY "Store owners read own live events"
ON public.live_events FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_events.store_id AND s.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Store owners write own live events" ON public.live_events;
CREATE POLICY "Store owners write own live events"
ON public.live_events FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_events.store_id AND s.owner_id = auth.uid())
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_events;