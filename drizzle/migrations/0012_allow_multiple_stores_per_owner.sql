ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_owner_id_key;
CREATE INDEX IF NOT EXISTS stores_owner_id_idx ON public.stores (owner_id);