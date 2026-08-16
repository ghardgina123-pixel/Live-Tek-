-- 1) Registo de lojas 51+ deixa de ser bloqueado; a taxa é criada automaticamente
CREATE OR REPLACE FUNCTION public.enforce_signup_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A posicao e a taxa ja foram atribuidas por assign_store_registration.
  -- Servicos nunca pagam taxa de adesao.
  IF NEW.partner_type = 'service'::partner_type THEN
    NEW.signup_fee_required := false;
    RETURN NEW;
  END IF;
  NEW.signup_fee_required := COALESCE(NEW.signup_fee_aoa, 0) > 0;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_signup_fee_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.signup_fee_aoa, 0) > 0 THEN
    INSERT INTO public.store_signup_fees (store_id, amount_aoa, method, status)
    VALUES (NEW.id, NEW.signup_fee_aoa, 'awaiting_gateway', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_signup_fee_record ON public.stores;
CREATE TRIGGER trg_store_signup_fee_record
AFTER INSERT ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.create_signup_fee_record();

-- 2) Estado real das gateways de pagamento
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS gateway_configured boolean NOT NULL DEFAULT false;

UPDATE public.payment_methods
   SET gateway_configured = is_cash_on_delivery;

-- 3) Notificacoes de pagamento confirmado (cliente, lojista e gestao)
CREATE OR REPLACE FUNCTION public.notify_payment_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_split jsonb;
  v_owner uuid;
  v_store text;
BEGIN
  IF NEW.status <> 'paid'::order_status OR OLD.status = 'paid'::order_status THEN
    RETURN NEW;
  END IF;

  v_split := public.calc_transaction_split(NEW.store_id, NEW.total_aoa);
  SELECT s.owner_id, s.name INTO v_owner, v_store FROM public.stores s WHERE s.id = NEW.store_id;

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (
    NEW.customer_id, 'payment.confirmed', 'Pagamento efetuado com sucesso.',
    'Pedido ' || left(NEW.id::text, 8) || ' — ' || to_char(NEW.total_aoa, 'FM999G999G990D00') || ' Kz em ' || COALESCE(v_store, 'loja') || '.',
    '/rastreio/' || NEW.id::text, NEW.id
  );

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (
      v_owner, 'payment.received', 'Pagamento recebido com sucesso.',
      'Pedido ' || left(NEW.id::text, 8) || ' — bruto ' || to_char(NEW.total_aoa, 'FM999G999G990D00')
        || ' Kz, comissão ' || to_char((v_split->>'platform_fee_aoa')::numeric, 'FM999G999G990D00')
        || ' Kz, líquido ' || to_char((v_split->>'net_aoa')::numeric, 'FM999G999G990D00') || ' Kz.',
      '/lojista/pedidos', NEW.id
    );
  END IF;

  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES (
    'payment.completed', 'Pagamento efetuado.',
    jsonb_build_object(
      'order_id', NEW.id,
      'store_id', NEW.store_id,
      'store_name', v_store,
      'customer_id', NEW.customer_id,
      'payment_method', NEW.payment_method,
      'paid_at', COALESCE(NEW.paid_at, now()),
      'split', v_split
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_confirmed ON public.orders;
CREATE TRIGGER trg_notify_payment_confirmed
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_payment_confirmed();