# Fase 1 — Relatório final (18/11/2026). Nada aplicado.
SQL: `docs/finance/fase1-beneficiarios-proposta.sql` (4 conjuntos, autorização separada).
Estado verificado: 0 perfis fiscais, 0 pedidos de payout, 0 levantamentos de lojas, 0 NIF duplicados.

## 1. Diagnóstico por beneficiário
- Lojista: ledger_entries/store_withdrawals/request_store_withdrawal OK; destino bancário (store_private) não é copiado para o pedido.
- Entregador independente: request_payout/courier_withdrawable OK; destino vazio ({}); sem identidade do titular.
- Entregador de empresa: inexistente; só proposta (proposta-entregadores-empresa.md). Sem alteração.
- Afiliado: comissões preservadas; mesma lacuna de destino do entregador.
- Identidade: não existe BI; NIF não é único. Profiles não guarda NIF.

## 2. Reutilizado
customer_fiscal_profiles (NIF+BI), user_payment_accounts, store_private, payout_requests, store_withdrawals, financial_audit_log, has_role, withdrawal_limits (inalterado).

## 3. Incompatibilidades
1. admin_settle_payout escreve 4 colunas inexistentes em payout_requests → falha (Conjunto 2).
2. payout_requests não aceita 'rejected' (Conjunto 2).
3. Pagamento "pago" com referência manual (Conjunto 4).
4. Limite diário somado por tipo, não conjunto — documentado; correção pertence a M1, não alterada nesta fase.
5. Admin não vê destino → função auditada (Conjunto 3).

## 5. Código/interface (após aprovação)
- PayoutWallet/StoreLedgerWallet: mostrar erros bank_account_required, identity_required; tratar {ok:false} como falha.
- Perfil: campos NIF e BI (bloqueados após gravação).
- Admin financeiro: botão "Ver destino" (Conjunto 3); botão "Marcar pago" substituído por "Aguarda confirmação bancária".

## 6. Segurança
Nenhuma RLS alargada; snapshots via SECURITY DEFINER; imutabilidade por trigger; consulta admin registada em financial_audit_log.

## 7. Validação sem dinheiro
Testes por transação com ROLLBACK: NIF/BI duplicado recusado; pedido sem conta recusado; destino enviado pelo cliente ignorado; UPDATE de destino recusado; PAID sem confirmação recusado; não-admin recusado em Conjunto 3. Todos PENDENTES.

## 8. Riscos
Utilizadores sem conta bancária/identidade deixam de poder pedir levantamento (intencional). Conjunto 4 bloqueia liquidação manual até à integração oficial.
