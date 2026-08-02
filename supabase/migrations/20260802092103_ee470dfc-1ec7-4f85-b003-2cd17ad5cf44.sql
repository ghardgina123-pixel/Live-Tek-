ALTER TABLE public.countries
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'pt-PT',
  ADD COLUMN IF NOT EXISTS currency_symbol text,
  ADD COLUMN IF NOT EXISTS center_lat numeric,
  ADD COLUMN IF NOT EXISTS center_lng numeric,
  ADD COLUMN IF NOT EXISTS default_zoom integer NOT NULL DEFAULT 6;

UPDATE public.countries SET language_code='pt', locale='pt-AO', currency_code='AOA', currency_symbol='Kz', phone_prefix='+244', center_lat=-11.2027, center_lng=17.8739, default_zoom=6 WHERE code='AO';
UPDATE public.countries SET language_code='pt', locale='pt-BR', currency_code='BRL', currency_symbol='R$', phone_prefix='+55', center_lat=-14.235, center_lng=-51.9253, default_zoom=4 WHERE code='BR';
UPDATE public.countries SET language_code='pt', locale='pt-PT', currency_code='EUR', currency_symbol='€', phone_prefix='+351', center_lat=39.3999, center_lng=-8.2245, default_zoom=6 WHERE code='PT';
UPDATE public.countries SET language_code='pt', locale='pt-MZ', currency_code='MZN', currency_symbol='MT', phone_prefix='+258', center_lat=-18.6657, center_lng=35.5296, default_zoom=5 WHERE code='MZ';
UPDATE public.countries SET language_code='pt', locale='pt-CV', currency_code='CVE', currency_symbol='$', phone_prefix='+238', center_lat=16.5388, center_lng=-23.0418, default_zoom=8 WHERE code='CV';
UPDATE public.countries SET language_code='en', locale='en-US', currency_code='USD', currency_symbol='$', phone_prefix='+1', center_lat=37.0902, center_lng=-95.7129, default_zoom=4 WHERE code='US';
UPDATE public.countries SET language_code='en', locale='en-GB', currency_code='GBP', currency_symbol='£', phone_prefix='+44', center_lat=55.3781, center_lng=-3.436, default_zoom=5 WHERE code='GB';
UPDATE public.countries SET language_code='fr', locale='fr-FR', currency_code='EUR', currency_symbol='€', phone_prefix='+33', center_lat=46.2276, center_lng=2.2137, default_zoom=5 WHERE code='FR';
UPDATE public.countries SET language_code='es', locale='es-ES', currency_code='EUR', currency_symbol='€', phone_prefix='+34', center_lat=40.4637, center_lng=-3.7492, default_zoom=5 WHERE code='ES';
UPDATE public.countries SET language_code='en', locale='en-ZA', currency_code='ZAR', currency_symbol='R', phone_prefix='+27', center_lat=-30.5595, center_lng=22.9375, default_zoom=5 WHERE code='ZA';
UPDATE public.countries SET language_code='fr', locale='fr-CD', currency_code='CDF', currency_symbol='FC', phone_prefix='+243', center_lat=-4.0383, center_lng=21.7587, default_zoom=5 WHERE code='CD';