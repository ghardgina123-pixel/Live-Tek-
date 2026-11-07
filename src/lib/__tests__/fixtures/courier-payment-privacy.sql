-- FICTIONAL disposable LOCAL PostgreSQL only, used by the opt-in integration test.
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE TYPE public.app_role AS ENUM ('customer','seller','admin');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.couriers(id uuid, user_id uuid);
CREATE TABLE public.orders(id uuid, store_id uuid, address_id uuid, status text, subtotal_aoa numeric, shipping_aoa numeric, total_aoa numeric, payment_method text);
CREATE TABLE public.stores(id uuid, name text, phone text);
CREATE TABLE public.addresses(id uuid, municipality_id uuid, street text, reference text, recipient_name text, phone text);
CREATE TABLE public.municipalities(id uuid, name text);
CREATE TABLE public.order_items(order_id uuid, quantity integer);
CREATE TABLE public.deliveries(id uuid, order_id uuid, courier_id uuid, status text,
  pickup_address text, dropoff_address text, pickup_lat numeric, pickup_lng numeric,
  dropoff_lat numeric, dropoff_lng numeric, straight_distance_m numeric, distance_unit text,
  distance_computed_at timestamptz, route_distance_m numeric, route_duration_s integer,
  route_polyline text, route_provider text, route_computed_at timestamptz,
  total_weight_kg numeric, total_volume_cm3 numeric, logistics_incomplete boolean,
  load_class text, courier_fee_aoa numeric);
INSERT INTO public.couriers VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
INSERT INTO public.stores VALUES ('00000000-0000-4000-8000-000000000004','FICTIONAL TEST STORE',NULL);
INSERT INTO public.addresses VALUES ('00000000-0000-4000-8000-000000000005',NULL,'FICTIONAL TEST STREET',NULL,'FICTIONAL TEST RECIPIENT',NULL);
INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','paid',12000,3500,15500,'PRIVATE_TEST_METHOD');
INSERT INTO public.order_items VALUES ('00000000-0000-4000-8000-000000000006',2);
INSERT INTO public.deliveries(id,order_id,courier_id,status,pickup_lat,courier_fee_aoa)
VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000003','pending',-8.8,3500);