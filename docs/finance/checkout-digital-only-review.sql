-- REVIEW ONLY — do not apply before express approval of this complete SQL.
-- No historical orders, balances, payment intents or ledgers are changed.
-- Provider initiation remains blocked until official adapters are validated.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_digital_checkout_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method IS NULL OR NEW.payment_method NOT IN (
    'multicaixa_express', 'multicaixa_reference', 'unitel_money',
    'kwik', 'ekwanza', 'afrimoney'
  ) THEN
    RAISE EXCEPTION 'digital_payment_method_required';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_digital_checkout_method() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_digital_checkout_method
BEFORE INSERT OR UPDATE OF payment_method ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_digital_checkout_method();

COMMIT;

-- Isolated validation required before approval/application:
-- 1. INSERT with cash_on_delivery is rejected, with no stock movement.
-- 2. INSERT with NULL, manual, bank_transfer or unknown is rejected.
-- 3. Existing historical orders remain unchanged, including cash records.
-- 4. Status transitions on historical orders are unchanged.
-- 5. Each of the six native method values passes only this method guard;
--    this must never count as evidence of provider initiation or payment.
-- 6. UPDATE to cash_on_delivery is rejected.
-- Existing RLS, financial triggers and provider-confirmation protections remain.