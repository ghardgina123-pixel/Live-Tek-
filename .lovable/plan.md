# Levantamentos — mínimo de 10.000 Kz e isolamento financeiro

## Resultado proposto
- Substituir a regra anterior sem mínimo: **10.000 Kz por levantamento** para lojistas, afiliados e entregadores; manter **200.000 Kz por dia**, soma diária no fuso Africa/Luanda e os âmbitos/locks existentes.
- Saldo ou valor efetivamente levantável abaixo do mínimo: recusa `below_minimum_limit`, com `min_amount_aoa: 10000`, antes de qualquer reserva/pedido financeiro. Para lojistas, 9.999,999 também é recusado antes de arredondar.
- Botões mostram o mínimo e ficam indisponíveis com saldo/valor levantável inferior a 10.000 Kz; mensagens respeitam a resposta da base de dados. Sem alterações de design.
- Concluir conjuntamente as quatro correções anteriores: estados finais irreversíveis, repetição idempotente, escrita financeira apenas pelas funções controladas e configuração inválida recusada.

## Estado verificado e autorização
- **Nada aplicado.** Esta proposta precisa de autorização após a revisão do SQL completo abaixo; as migrations 0005/0006 ficam intactas.
- Consultas atuais: PostgreSQL 17.6; `postgres` não é superuser, mas tem CREATEROLE; a role reservada não existe; zero lançamentos, levantamentos de loja e pedidos de payout; limite AOA = 200000, Africa/Luanda.
- A hipótese do bloqueio é uma pertença automática ao criador da role: o SQL anterior já revogava `postgres`, mas não enumerava os outros membros. Não foi possível observar os membros da transação abortada.
- O novo SQL revoga todos os membros encontrados depois de transferir as funções, mantendo a verificação final. Se o executor não tiver autoridade suficiente ou sobrar qualquer pertença, **a operação inteira deve abortar**, sem baixar a proteção ou inventar acesso de superuser.

## Saldo fictício e testes
- O projeto atual partilha a mesma base entre pré-visualização e aplicação publicada. **Não inserir 50.000 Kz fictícios nessa base**, nem como ajuste do ledger: seriam dinheiro disponível numa conta real.
- O saldo fictício expressamente solicitado só pode existir num ambiente separado, identificado como teste, com transferências reais desativadas. Não há isolamento confirmado nesta tarefa.
- Após autorização: testes locais das regras/estado dos botões; testes autenticados de recusa em conta real sem saldo; verificação de proprietários, permissões, RLS e inexistência de membros da role; nenhuma criação de dinheiro real.
- **MANUAL ACTION REQUIRED:** ambiente financeiro isolado para saques com 50.000 Kz fictícios e provas de 9.999,99 recusado / 10.000 aceite / 200.000 permitido pelo teto / 200.000,01 recusado; pedidos concorrentes, soma diária, cancelamento sem consumo do teto, repetição sem duplicação e ataque de escrita direta. Testes locais não constituem prova financeira ponta a ponta.
- Pagamentos reais continuam bloqueados pela validação bancária pendente.

## Detalhes técnicos
- `withdrawal_limits.min_amount` guarda o mínimo por moeda; o único backfill preenche a nova configuração AOA, sem alterar dados financeiros. Helper valida configuração e recusa ausência/valores inválidos.
- Resumos das três carteiras devolvem `min_amount_aoa`; a interface não decide a regra financeira.
- O painel administrativo passa `cancelled`, não `rejected`, respeita `ok:false` e oculta ações de estados finais.
- Após sucesso da migration, adicionar testes pequenos ao conjunto existente e refletir a configuração nas duas carteiras. Documentar o uso dos helpers em AGENTS.md.
- Aplicar todo o SQL numa única transação pela ferramenta de migrations, sem alteração manual do journal.

## SQL completo para autorização
```sql
-- Sem UPDATE/DELETE de dados financeiros existentes.
-- Preflight: stop instead of applying over a different configuration or role.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='liveteka_payout_executor') THEN
  RAISE EXCEPTION 'executor_role_already_exists_review_required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.withdrawal_limits
  WHERE currency='AOA' AND max_daily_amount=200000 AND timezone='Africa/Luanda') THEN
  RAISE EXCEPTION 'unexpected_aoa_limit_review_required';
 END IF;
END $$;
CREATE ROLE liveteka_payout_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO liveteka_payout_executor;
GRANT SELECT,INSERT ON public.payout_requests TO liveteka_payout_executor;
GRANT UPDATE(status,note,processed_at,updated_at) ON public.payout_requests TO liveteka_payout_executor;
GRANT INSERT ON public.user_notifications,public.admin_notifications TO liveteka_payout_executor;
GRANT EXECUTE ON FUNCTION auth.uid(),public.has_role(uuid,public.app_role),
 public.affiliate_withdrawable(),public.courier_withdrawable(),
 public.max_daily_withdrawal_aoa(),public.payout_withdrawn_today(uuid,text),
 public.fin_audit(text,text,text,text,text,text,text,jsonb) TO liveteka_payout_executor;
-- Additive configuration backfill only; no financial rows are changed.
ALTER TABLE public.withdrawal_limits ADD COLUMN min_amount numeric;
UPDATE public.withdrawal_limits SET min_amount=10000 WHERE currency='AOA';
COMMENT ON COLUMN public.withdrawal_limits.min_amount IS 'Minimum per withdrawal in currency units; NULL is unconfigured and fails closed.';
CREATE FUNCTION public.min_withdrawal_aoa() RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v numeric; mx numeric;
BEGIN
 SELECT min_amount,max_daily_amount INTO v,mx FROM public.withdrawal_limits WHERE currency='AOA';
 IF NOT FOUND OR v IS NULL OR v<=0 OR v::text IN ('NaN','Infinity','-Infinity')
  OR mx IS NULL OR mx<=0 OR mx::text IN ('NaN','Infinity','-Infinity') OR v>mx
 THEN RAISE EXCEPTION 'withdrawal_minimum_not_configured'; END IF;
 RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.min_withdrawal_aoa() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.min_withdrawal_aoa() TO service_role,liveteka_payout_executor;

CREATE POLICY payout_executor_read ON public.payout_requests FOR SELECT TO liveteka_payout_executor USING(true);
CREATE POLICY payout_executor_insert ON public.payout_requests FOR INSERT TO liveteka_payout_executor WITH CHECK(true);
CREATE POLICY payout_executor_update ON public.payout_requests FOR UPDATE TO liveteka_payout_executor USING(true) WITH CHECK(true);
CREATE POLICY payout_executor_user_notice ON public.user_notifications FOR INSERT TO liveteka_payout_executor WITH CHECK(true);
CREATE POLICY payout_executor_admin_notice ON public.admin_notifications FOR INSERT TO liveteka_payout_executor WITH CHECK(true);
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.payout_requests FROM PUBLIC,anon,authenticated,service_role;
-- Remove any column-level grants as well.
DO $$ DECLARE c text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO c FROM pg_attribute
 WHERE attrelid='public.payout_requests'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE 'REVOKE INSERT ('||c||'),UPDATE ('||c||') ON public.payout_requests FROM PUBLIC,anon,authenticated,service_role';
END $$;

CREATE OR REPLACE FUNCTION public.guard_payout_request_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payout_delete_forbidden'; END IF;
 IF current_user <> 'liveteka_payout_executor' THEN RAISE EXCEPTION 'payout_use_controlled_rpc'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status <> 'pending' OR NEW.amount_aoa IS NULL OR NEW.amount_aoa<=0
   OR NEW.amount_aoa::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_payout_insert'; END IF;
  IF NEW.amount_aoa < public.min_withdrawal_aoa() THEN RAISE EXCEPTION 'withdrawal_below_minimum_10k'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.user_id,NEW.kind,NEW.amount_aoa,NEW.method,NEW.destination,NEW.created_at,NEW.due_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.kind,OLD.amount_aoa,OLD.method,OLD.destination,OLD.created_at,OLD.due_at)
 THEN RAISE EXCEPTION 'payout_immutable_fields'; END IF;
 IF OLD.status IN ('paid','cancelled') THEN RAISE EXCEPTION 'payout_final'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
  (OLD.status='pending' AND NEW.status IN ('processing','paid','cancelled')) OR
  (OLD.status='processing' AND NEW.status IN ('paid','cancelled')))
 THEN RAISE EXCEPTION 'payout_invalid_transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payout_controlled_write BEFORE INSERT OR UPDATE OR DELETE ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_payout_request_write();
REVOKE EXECUTE ON FUNCTION public.guard_payout_request_write() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa() RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v numeric; tz text;
BEGIN
 SELECT max_daily_amount,timezone INTO v,tz FROM public.withdrawal_limits WHERE currency='AOA';
 IF NOT FOUND OR v IS NULL OR v<=0 OR v::text IN ('NaN','Infinity','-Infinity')
  OR tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz)
 THEN RAISE EXCEPTION 'withdrawal_limit_not_configured'; END IF;
 RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.max_daily_withdrawal_aoa() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.max_daily_withdrawal_aoa() TO service_role,liveteka_payout_executor;

CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid,_status text DEFAULT 'paid',_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.payout_requests%ROWTYPE; u uuid; k text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF _status IS NULL OR _status NOT IN ('processing','paid','cancelled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
 SELECT user_id,kind INTO u,k FROM public.payout_requests WHERE id=_payout_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payout:'||u::text||':'||k));
 SELECT * INTO w FROM public.payout_requests WHERE id=_payout_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF w.status=_status THEN RETURN jsonb_build_object('ok',true,'status',_status,'already_processed',true); END IF;
 IF w.status IN ('paid','cancelled') THEN
  PERFORM public.fin_audit('payout_transition','payout_request',w.id::text,w.status,_status,'rejected:final_state',NULL);
  RETURN jsonb_build_object('ok',false,'reason','final_state');
 END IF;
 UPDATE public.payout_requests SET status=_status,note=COALESCE(_note,note),
  processed_at=CASE WHEN _status IN ('paid','cancelled') THEN now() ELSE processed_at END,updated_at=now() WHERE id=w.id;
 INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
 VALUES(w.user_id,'payout.'||_status,
  CASE _status WHEN 'paid' THEN 'Levantamento pago' WHEN 'cancelled' THEN 'Levantamento cancelado' ELSE 'Levantamento em processamento' END,
  'Kz '||to_char(w.amount_aoa,'FM999G999G999D00'),CASE WHEN w.kind='affiliate' THEN '/afiliados' ELSE '/transportador' END,w.id);
 PERFORM public.fin_audit('payout_'||_status,'payout_request',w.id::text,w.status,_status,'ok','payout:'||w.id||':'||_status);
 RETURN jsonb_build_object('ok',true,'status',_status);
END $$;

CREATE OR REPLACE FUNCTION public.request_payout(_kind text,_method text DEFAULT 'multicaixa_express',_destination jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid:=auth.uid(); s jsonb; available numeric; remaining numeric; amount numeric; lim numeric; minimum numeric; id uuid; due timestamptz;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF _kind IS NULL OR _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payout:'||u::text||':'||_kind));
 lim:=public.max_daily_withdrawal_aoa(); minimum:=public.min_withdrawal_aoa();
 s:=CASE WHEN _kind='affiliate' THEN public.affiliate_withdrawable() ELSE public.courier_withdrawable() END;
 IF (s->>'has_open_request')::boolean THEN RETURN jsonb_build_object('ok',false,'reason','open_request'); END IF;
 available:=COALESCE((s->>'available_aoa')::numeric,0);
 IF available::text IN ('NaN','Infinity','-Infinity') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_amount'); END IF;
 IF available<minimum THEN RETURN jsonb_build_object('ok',false,'reason','below_minimum_limit','min_amount_aoa',minimum); END IF;
 remaining:=GREATEST(lim-public.payout_withdrawn_today(u,_kind),0);
 IF remaining<=0 THEN RETURN jsonb_build_object('ok',false,'reason','daily_limit','max_daily_aoa',lim); END IF;
 amount:=LEAST(available,remaining);
 IF amount<minimum THEN RETURN jsonb_build_object('ok',false,'reason','below_minimum_limit','min_amount_aoa',minimum,'remaining_today_aoa',remaining); END IF;
 due:=now()+interval '72 hours';
 INSERT INTO public.payout_requests(user_id,kind,amount_aoa,method,destination,due_at)
 VALUES(u,_kind,amount,COALESCE(NULLIF(_method,''),'multicaixa_express'),COALESCE(_destination,'{}'),due)
 RETURNING payout_requests.id INTO id;
 INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
 VALUES(u,'payout.requested','Pedido de levantamento registado',
  'Kz '||to_char(amount,'FM999G999G999D00')||' — processamento até '||to_char(due,'DD/MM/YYYY HH24:MI')||'.',
  CASE WHEN _kind='affiliate' THEN '/afiliados' ELSE '/transportador' END,id);
 INSERT INTO public.admin_notifications(kind,subject,payload)
 VALUES('payout.requested','Novo pedido de levantamento',jsonb_build_object('payout_id',id,'user_id',u,'kind',_kind,'amount_aoa',amount,'due_at',due));
 PERFORM public.fin_audit('payout_request','payout_request',id::text,NULL,'pending','ok','payout:'||id||':pending');
 RETURN jsonb_build_object('ok',true,'payout_id',id,'amount_aoa',amount,'due_at',due,'status','pending');
END $$;
CREATE OR REPLACE FUNCTION public.request_store_withdrawal(_store_id uuid, _amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; b record; v_id uuid; v_amt numeric := ROUND(_amount, 2); v_max numeric; v_today numeric; v_min numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:not_owner',NULL);
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||_store_id::text));
  IF _amount IS NULL OR _amount <= 0 OR _amount::text IN ('NaN','Infinity','-Infinity') THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:invalid_amount',NULL, jsonb_build_object('amount',v_amt));
    RETURN jsonb_build_object('ok',false,'reason','invalid_amount');
  END IF;
  v_min := public.min_withdrawal_aoa();
  IF _amount < v_min THEN
    RETURN jsonb_build_object('ok',false,'reason','below_minimum_limit','min_amount_aoa',v_min);
  END IF;
  v_max := public.max_daily_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
  IF v_today + v_amt > v_max THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:daily_limit',NULL,
      jsonb_build_object('amount',v_amt,'withdrawn_today',v_today,'max_daily',v_max));
    RETURN jsonb_build_object('ok',false,'reason','daily_limit','max_daily_aoa',v_max,'remaining_today_aoa',GREATEST(v_max - v_today,0));
  END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  IF v_amt > b.available THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:insufficient_balance',NULL, jsonb_build_object('amount',v_amt,'available',b.available));
    RETURN jsonb_build_object('ok',false,'reason','insufficient_balance');
  END IF;
  IF EXISTS (SELECT 1 FROM public.store_withdrawals WHERE store_id=_store_id AND status IN ('PENDING_REVIEW','APPROVED','PROCESSING')) THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:open_request',NULL);
    RETURN jsonb_build_object('ok',false,'reason','open_request');
  END IF;
  INSERT INTO public.store_withdrawals(store_id, requested_by, amount_aoa) VALUES (_store_id, auth.uid(), v_amt) RETURNING id INTO v_id;
  INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_available, delta_reserved, origin, event_ref, idempotency_key, created_by)
  VALUES (_store_id, v_id, 'withdrawal_reserve', v_amt, -v_amt, v_amt, 'withdrawal_request', 'withdrawal:'||v_id, 'wd_reserve:'||v_id, auth.uid());
  PERFORM public.fin_audit('withdrawal_request','withdrawal',v_id::text,NULL,'PENDING_REVIEW','ok','wd_reserve:'||v_id, jsonb_build_object('amount',v_amt));
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.affiliate_withdrawable()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_aff uuid; v_released numeric := 0; v_requested numeric := 0; v_open record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_aff FROM public.affiliate_accounts WHERE user_id = v_uid;
  IF v_aff IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_aoa),0) INTO v_released
      FROM public.affiliate_commissions WHERE affiliate_id = v_aff AND status IN ('released','paid');
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'affiliate' AND status <> 'cancelled';
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'affiliate' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('min_amount_aoa', public.min_withdrawal_aoa(),
    'available_aoa', GREATEST(ROUND(v_released - v_requested, 2), 0),
    'max_daily_aoa', public.max_daily_withdrawal_aoa(), 'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, 'affiliate'), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.courier_withdrawable()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_courier uuid; v_earned numeric := 0; v_requested numeric := 0;
        v_deliveries int := 0; v_open record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_courier FROM public.couriers WHERE user_id = v_uid;
  IF v_courier IS NOT NULL THEN
    SELECT COALESCE(SUM(o.shipping_aoa),0), COUNT(*)
      INTO v_earned, v_deliveries
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
     WHERE d.courier_id = v_courier AND d.status = 'delivered';
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'courier' AND status <> 'cancelled';
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'courier' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('min_amount_aoa', public.min_withdrawal_aoa(),
    'is_courier', v_courier IS NOT NULL,
    'deliveries_done', v_deliveries,
    'earned_aoa', ROUND(v_earned, 2),
    'withdrawn_aoa', ROUND(v_requested, 2),
    'available_aoa', GREATEST(ROUND(v_earned - v_requested, 2), 0),
    'max_daily_aoa', public.max_daily_withdrawal_aoa(), 'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, 'courier'), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.store_ledger_summary(_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; b record; v_sales numeric; v_comm numeric; v_withdrawn numeric; v_max numeric; v_today numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  SELECT COALESCE(SUM(gross_aoa),0), COALESCE(SUM(commission_aoa),0) INTO v_sales, v_comm FROM public.ledger_entries WHERE store_id=_store_id AND kind='sale_credit';
  SELECT COALESCE(SUM(net_aoa),0) INTO v_withdrawn FROM public.ledger_entries WHERE store_id=_store_id AND kind='withdrawal_paid';
  v_max := public.max_daily_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
  RETURN jsonb_build_object('min_amount_aoa', public.min_withdrawal_aoa(),'available_aoa', b.available, 'pending_aoa', b.pending, 'reserved_aoa', b.reserved,
    'sales_aoa', v_sales, 'commissions_aoa', v_comm, 'withdrawn_aoa', v_withdrawn,
    'max_daily_withdrawal_aoa', v_max, 'withdrawn_today_aoa', v_today,
    'remaining_today_aoa', GREATEST(v_max - v_today, 0));
END $function$;



-- Temporary membership permits ownership transfer, then is removed.
GRANT liveteka_payout_executor TO postgres;
GRANT CREATE ON SCHEMA public TO liveteka_payout_executor;
ALTER FUNCTION public.request_payout(text,text,jsonb) OWNER TO liveteka_payout_executor;
ALTER FUNCTION public.admin_settle_payout(uuid,text,text) OWNER TO liveteka_payout_executor;
REVOKE CREATE ON SCHEMA public FROM liveteka_payout_executor;
-- PostgreSQL 17 may auto-grant membership to the role creator.
-- Revoke all discovered incoming memberships, not just the explicit postgres grant.
-- CASCADE removes dependent grants. Insufficient authority aborts the transaction.
DO $$ DECLARE member_name text; BEGIN
 FOR member_name IN
  SELECT DISTINCT m.rolname FROM pg_auth_members a
  JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
  WHERE r.rolname='liveteka_payout_executor'
 LOOP
  EXECUTE format('REVOKE liveteka_payout_executor FROM %I CASCADE',member_name);
 END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.request_payout(text,text,jsonb),public.admin_settle_payout(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_payout(text,text,jsonb),public.admin_settle_payout(uuid,text,text) TO authenticated;
-- Abort the whole migration if the executor can be assumed by another role.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='liveteka_payout_executor')
  OR member=(SELECT oid FROM pg_roles WHERE rolname='liveteka_payout_executor')) THEN
  RAISE EXCEPTION 'executor_membership_not_isolated';
 END IF;
END $$;
```
