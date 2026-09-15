CREATE TABLE public.store_follows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

GRANT SELECT, INSERT, DELETE ON public.store_follows TO authenticated;
GRANT ALL ON public.store_follows TO service_role;

ALTER TABLE public.store_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_follows_read_own_or_store_owner
ON public.store_follows
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = store_id AND s.owner_id = auth.uid()
  )
);

CREATE POLICY store_follows_insert_own
ON public.store_follows
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY store_follows_delete_own
ON public.store_follows
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX store_follows_store_idx ON public.store_follows (store_id);

CREATE OR REPLACE FUNCTION public.store_follower_count(_store_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.store_follows WHERE store_id = _store_id
$$;

REVOKE ALL ON FUNCTION public.store_follower_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_follower_count(uuid) TO anon, authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.store_follows;