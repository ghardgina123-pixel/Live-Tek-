# Ledger financeiro interno — Live Teká (conta coletora única)

## Objetivo
Cada lojista passa a ter um extrato interno imutável que representa o que a TUSSALA KAKA lhe deve. O dinheiro fica na conta coletora do Banco Atlântico; levantamentos só saem após aprovação manual e transferência externa registada.

```text
Cliente → pagamento → webhook assinado → validação → lançamento no ledger
→ saldo do lojista → pedido de levantamento (reserva) → aprovação admin
→ transferência bancária manual → registo com referência → PAID
```

## O que já existe e é reaproveitado
- Webhook Multicaixa com assinatura HMAC e `confirm_payment_intent_by_reference` (idempotente).
- `payouts` (repasse por pedido, pending → released na entrega), `store_balance`, `calc_transaction_split` (comissão no servidor).
- `payout_requests` (afiliados/entregadores), `security_audit_log`, painel `admin.financeiro`.
Nada é removido; o saldo do lojista passa a ser calculado a partir do ledger.

## Fase 1 — Base de dados
- Tabela `ledger_entries` (só inserção): id, store_id, order_id, kind (sale_credit, commission, release, withdrawal_reserve, withdrawal_release, withdrawal_paid, adjustment, reversal), bucket (pending/available/reserved), amount, moeda AOA, comissão, líquido, origem, referência do evento, `idempotency_key` UNIQUE, created_by, created_at.
- Triggers que bloqueiam UPDATE/DELETE; correções só por novo lançamento de ajuste/estorno.
- `store_withdrawals`: PENDING_REVIEW → APPROVED → PROCESSING → PAID, ou → REJECTED; referência bancária, comprovativo (storage privado), quem aprovou/pagou; trigger de transições válidas; aprovador ≠ dono da loja.
- `financial_audit_log` imutável: quem, quando, ação, recurso, estado anterior/novo, resultado, id da operação.
- Lançamentos criados por triggers sobre os fluxos existentes (pagamento confirmado → crédito pendente; entrega → liberta). Sem backfill fictício: pedidos já pagos são migrados a partir dos `payouts` reais existentes, com origem `migration`.
- RLS: lojista lê só os seus dados; sem INSERT/UPDATE/DELETE para clientes; GRANT apenas SELECT a `authenticated`.

## Fase 2 — Funções seguras
- `store_ledger_summary(store_id)`: disponível, pendente, reservado, vendas, comissões, levantado.
- `request_store_withdrawal(store_id, amount)`: valida dono, mínimo, saldo; `SELECT … FOR UPDATE` por loja (advisory lock) para impedir uso simultâneo; cria reserva + pedido + auditoria atomicamente.
- `admin_review_withdrawal`, `admin_mark_withdrawal_processing`, `admin_mark_withdrawal_paid(ref, comprovativo)`, `admin_reject_withdrawal` (devolve a reserva). Todas verificam `has_role(admin)` e recusam o próprio dono.
- Saldo nunca negativo: verificação dentro da mesma transação; violação → rejeita e regista evento.
- Webhook: adicionar validação de valor e moeda contra o pedido; eventos repetidos/inconsistentes registados e ignorados.

## Fase 3 — Interface
- Lojista: cartão "Carteira" com os 6 valores, extrato paginado com estados, botão "Solicitar Levantamento" e histórico de pedidos.
- Admin (em `admin.financeiro`): fila de levantamentos, aprovar/rejeitar/processar, registar referência bancária, anexar comprovativo, marcar PAID, histórico e auditoria.

## Fase 4 — Verificação real
- Testes automatizados em SQL/Vitest contra a base: alteração de preço/amount/commission pelo cliente, seller_id trocado, webhook falso/duplicado/replay, acesso a ledger alheio, saldo negativo, levantamento acima do saldo, duplicado e concorrente, autoaprovação, alteração direta de estado, RPC sem login.
- Scanner de segurança, linter, typecheck, build.
- Relatório A–S com PASS/FAIL/MANUAL ACTION REQUIRED/BLOCKED só com evidência.

## MANUAL ACTION REQUIRED (previsto)
- Especificação oficial do webhook do Banco Atlântico/Multicaixa (formato, assinatura, moeda) — confirmar com o banco; até lá a validação usa o formato atual.
- Segredo do webhook configurado pelo banco + registo do URL de callback.
- Teste ponta a ponta com um pagamento real de baixo valor e uma transferência real de levantamento.
- Rotação de chaves se algum segredo tiver estado exposto (auditoria vai verificar).

## Detalhes técnicos
- Migrações aditivas apenas; `payouts` mantém-se e alimenta o ledger.
- Funções SECURITY DEFINER com `search_path = public`, EXECUTE revogado de `anon`.
- Comprovativos num bucket privado com acesso só a admin e ao dono.
