CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.live_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  live_id uuid REFERENCES public.lives(id) ON DELETE CASCADE,
  label text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('phone','rtsp','rtmp','whip')),
  source_url text,
  ingress_id text,
  ingress_url text,
  stream_key text,
  participant_identity text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX live_cameras_live_idx ON public.live_cameras(live_id);
CREATE INDEX live_cameras_store_idx ON public.live_cameras(store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_cameras TO authenticated;
GRANT ALL ON public.live_cameras TO service_role;

ALTER TABLE public.live_cameras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_cameras_owner_select" ON public.live_cameras
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_cameras.store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "live_cameras_owner_insert" ON public.live_cameras
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_cameras.store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "live_cameras_owner_update" ON public.live_cameras
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_cameras.store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_cameras.store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "live_cameras_owner_delete" ON public.live_cameras
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = live_cameras.store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER live_cameras_updated_at
  BEFORE UPDATE ON public.live_cameras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

ALTER TABLE public.lives
  ADD COLUMN IF NOT EXISTS active_identity text,
  ADD COLUMN IF NOT EXISTS active_camera_id uuid REFERENCES public.live_cameras(id) ON DELETE SET NULL;

GRANT SELECT (active_identity, active_camera_id) ON public.lives TO anon, authenticated;

ALTER TABLE public.live_cameras REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_cameras;