
CREATE OR REPLACE FUNCTION public.live_viewer_count(_live_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.live_viewers
  WHERE live_id = _live_id AND last_seen_at >= now() - interval '60 seconds'
$$;
GRANT EXECUTE ON FUNCTION public.live_viewer_count(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS live_viewers_select_all ON public.live_viewers;
CREATE POLICY live_viewers_select_scoped ON public.live_viewers FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.lives l JOIN public.stores s ON s.id = l.store_id
             WHERE l.id = live_viewers.live_id AND s.owner_id = auth.uid())
);

DROP POLICY IF EXISTS property_images_select ON public.property_images;
CREATE POLICY property_images_select_visible ON public.property_images FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_images.property_id));
