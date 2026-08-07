ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS service_category text,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS service_tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS stores_partner_type_status_idx ON public.stores (partner_type, status);
CREATE INDEX IF NOT EXISTS stores_service_category_idx ON public.stores (service_category);