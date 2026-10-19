# Correções financeiras — SQL para autorização

## Estado e âmbito
- **Nada aplicado à base de dados.** As migrations 0005/0006 e todos os dados ficam intactos.
- Confirmado por consulta: zero lançamentos, zero levantamentos de lojas e zero pedidos de payout; configuração AOA = 200000, Africa/Luanda; RLS ativo; índice `uniq_payout_open` existente.
- A confirmação aqui corrigida é `admin_settle_payout`, não o webhook bancário. Não inventar o formato de amount/currency nem liberar pagamentos reais.

## Falhas e correções propostas
1. **Estados finais reversíveis:** proteger `paid`/`cancelled`; nenhum destes estados volta a disponibilizar saldo por outra transição.
2. **Confirmação repetida:** bloquear por utilizador/tipo e por linha; repetição do mesmo estado retorna `already_processed`, sem UPDATE, notificação ou auditoria adicional.
3. **Escrita direta:** retirar escrita de visitantes, utilizadores e service_role; trigger valida uma identidade PostgreSQL isolada, não um parâmetro manipulável. Só as duas funções autorizadas recebem essa identidade. Campos financeiros ficam imutáveis e DELETE bloqueado. RLS permanece ativo.
4. **Limite ausente/inválido:** helper rejeita configuração ausente, nula, não finita, não positiva ou timezone inválido; leitura bloqueia a configuração durante a operação. Valor atual 200000 não é alterado nem duplicado no frontend.

## Compatibilidade necessária após autorização
O painel administrativo atualmente envia `rejected`, mas a função aceita `cancelled`; também ignora `ok:false`. Corrigir esse caminho no mesmo trabalho autorizado: enviar `cancelled`, respeitar a resposta e não anunciar sucesso quando recusado. Não alterar design.

## SQL completo proposto
O SQL será entregue à ferramenta de migrations somente após autorização. Não adicionar manualmente ao journal ou alterar migrations anteriores. A identidade NOLOGIN não tem BYPASSRLS nem credenciais; as suas políticas só atendem funções com proprietário isolado. A criação e transferência de propriedade requerem privilégios do executor da migration: se indisponíveis, parar, nunca substituir por uma proteção mais fraca. Operadores privilegiados capazes de alterar funções/triggers continuam fora da garantia contra escritas da aplicação.

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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v numeric; tz text;
BEGIN
 SELECT max_daily_amount,timezone INTO v,tz FROM public.withdrawal_limits WHERE currency='AOA' FOR SHARE;
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
DECLARE u uuid:=auth.uid(); s jsonb; available numeric; remaining numeric; amount numeric; lim numeric; id uuid; due timestamptz;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF _kind IS NULL OR _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payout:'||u::text||':'||_kind));
 lim:=public.max_daily_withdrawal_aoa();
 s:=CASE WHEN _kind='affiliate' THEN public.affiliate_withdrawable() ELSE public.courier_withdrawable() END;
 IF (s->>'has_open_request')::boolean THEN RETURN jsonb_build_object('ok',false,'reason','open_request'); END IF;
 available:=COALESCE((s->>'available_aoa')::numeric,0);
 IF available<=0 OR available::text IN ('NaN','Infinity','-Infinity') THEN RETURN jsonb_build_object('ok',false,'reason','insufficient_balance'); END IF;
 remaining:=GREATEST(lim-public.payout_withdrawn_today(u,_kind),0);
 IF remaining<=0 THEN RETURN jsonb_build_object('ok',false,'reason','daily_limit','max_daily_aoa',lim); END IF;
 amount:=LEAST(available,remaining); due:=now()+interval '72 hours';
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
-- request_store_withdrawal already calls the helper before creating any financial row.
-- Invalid configuration now raises an exception: the entire operation is rolled back.
-- Keep its existing authentication, per-store lock, daily sum and atomic reservation intact.

-- Temporary membership permits ownership transfer, then is removed.
GRANT liveteka_payout_executor TO postgres;
GRANT CREATE ON SCHEMA public TO liveteka_payout_executor;
ALTER FUNCTION public.request_payout(text,text,jsonb) OWNER TO liveteka_payout_executor;
ALTER FUNCTION public.admin_settle_payout(uuid,text,text) OWNER TO liveteka_payout_executor;
REVOKE CREATE ON SCHEMA public FROM liveteka_payout_executor;
REVOKE liveteka_payout_executor FROM postgres;
REVOKE EXECUTE ON FUNCTION public.request_payout(text,text,jsonb),public.admin_settle_payout(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_payout(text,text,jsonb),public.admin_settle_payout(uuid,text,text) TO authenticated;
-- Abort the whole migration if the executor can be assumed by another role.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='liveteka_payout_executor')) THEN
  RAISE EXCEPTION 'executor_membership_not_isolated';
 END IF;
END $$;
```

## Verificações e resultados
- **Executado:** inspeção das funções ativas, estados permitidos, permissões, RLS, configuração e índices. Confirmadas as quatro falhas; nenhum teste de movimentação financeira executado.
- **Após autorização:** aplicar numa única transação; verificar proprietários/ACL, ausência de membros da identidade isolada, RLS/policies, triggers e assinaturas. Testar chamadas sem login e como não-admin sem criar dinheiro. Corrigir e testar a leitura da resposta no painel administrativo.
- **MANUAL ACTION REQUIRED:** com transações reais ou ambiente oficial, confirmar paid→cancelled recusado; cancelamento único; confirmação repetida sem UPDATE/notificação; INSERT/UPDATE/DELETE direto bloqueado como lojista/admin/service_role; pedidos simultâneos; soma diária com rejeitados excluídos; saldo disponível nunca ultrapassado. Não tratar tabelas vazias como prova.
- **Ambiente oficial isolado:** testar configuração ausente/nula/inválida sem alterar a configuração da produção e comprovar nenhuma reserva/lançamento criado.
- **Pagamentos reais continuam não autorizados:** documentação bancária, amount/currency, webhook autenticado e provas reais de idempotência/ledger permanecem bloqueadores. Esta proposta não altera nem desativa qualquer proteção de pagamento.