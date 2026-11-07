# Plano de execução dos 55 testes financeiros e de segurança

Estado: PREPARAÇÃO. Nenhum teste executado, nenhuma migração aplicada, nenhum dado real alterado, funcionalidades novas desativadas.

## 1. Ambiente isolado — diagnóstico

| Ambiente | Isolado? | Dados | Decisão |
|---|---|---|---|
| Backend atual (preview + app publicada) | NÃO — uma única instância serve as duas | Reais | PROIBIDO para testes |
| Schema `test_env` | Não existe (migração anterior rejeitada) | — | Indisponível |
| Rascunho (draft) com backend próprio | SIM — stack isolada, auth separada | Vazio; só fixtures fictícias | Ambiente principal proposto |
| PostgreSQL 17 local descartável no sandbox | SIM — destruído no fim | Só fixtures fictícias | Complementar: testes destrutivos, privilégios, ordem de instalação, reversão (R1–R5, S13, F12) |

Verificação obrigatória antes de qualquer teste (bloqueante, aborta se falhar):
- ref do backend do teste diferente do ref de produção; zero linhas copiadas de produção;
- todas as contas, lojas, saldos e pedidos com marcador `FIXTURE-TEST` e emails `@test.invalid`;
- contagem de `ledger_entries`, `store_withdrawals`, `payout_requests`, `financial_audit_log` em produção registada antes e depois (deve ser idêntica).

## 2. Fixtures fictícias (só no ambiente isolado)

- Identidades: root, gestor limites, financeiro, contabilista, team-read, lojista A/B, afiliado, courier, convidado, anon.
- Mercados: AO-main (AOA, Africa/Luanda), mercado sintético 2 com AOA, EUR/USD sem motor.
- Saldos fictícios: 50.000 e 250.000 AOA via ledger de teste; pedidos em pending/approved/processing/paid/rejected/cancelled.
- Banco: provas oficiais simuladas só para estrutura; F1, F5 e R7 com prova oficial ficam PENDENTE até documentação Banco Atlântico.

## 3. Matriz de execução (55 testes)

| Bloco | Testes | Ambiente | Pré-requisito | Execução possível agora |
|---|---|---|---|---|
| F — 12 bancários originais (preservados sem alteração) | F1–F12 | Draft + local | Migration B instalada no isolado | F2–F4, F6–F12 sim; F1, F5 PENDENTE (banco oficial) |
| S — segurança/RBAC | S1–S15 | Draft + local (S13) | M2 v2 | S1–S8, S10–S13 sim; S9, S15 parcial (fase B); S14 PENDENTE (workflow futuro) |
| L — limites/concorrência | L1–L15 | Draft | M2 + M1 v2 | Todos; L10–L12 dependem de adaptadores fase B |
| I — internacionalização | I1–I5 | Draft | M1 v2 | Todos (bloqueio esperado) |
| R — instalação/reversão | R1–R8 | Local + draft | Snapshots | R1–R5, R8 sim; R6 PENDENTE (adaptadores); R7 PENDENTE (banco) |

Resultados esperados por teste: os definidos em `docs/finance/proposta-limites-e-equipa.md` (tabelas F, S, L, I, R), sem alteração.

Concorrência (F10, F11, L3, L4, L6, L7, S10): N≥20 sessões paralelas reais, 10 repetições, ordem de locks registada.

## 4. Critérios de aprovação

- PASS: resultado observado igual ao esperado, com evidência guardada (SQL, saída, contagens antes/depois, IDs de fixture).
- FAIL: qualquer divergência, incluindo erro diferente do esperado, efeito parcial ou duplicação.
- PENDENTE: pré-requisito externo ausente — nunca contado como PASS.
- Aprovação global só com: 0 FAIL; F1–F12 todos PASS (com prova oficial); S1–S13 e L1–L9, L13–L15 PASS; contagens de produção idênticas; reversão R1–R5 PASS.

## 5. Validação da reversão (antes de qualquer implementação)

1. Snapshot (dump + checksums por tabela) do ambiente isolado antes de M2.
2. Instalar M2 → M1; reverter pré-ativação; comparar diff de schema, ACL, funções antigas e dados: deve ser zero (exceto históricos v2 preservados).
3. Falha injetada a meio (R3): rollback integral comprovado.
4. Reexecução (R4) e ordem inversa (R1).
5. Só depois de R1–R5 PASS se considera pedir autorização para produção, numa fase separada.

## 6. Evidência e entrega

- Relatório `docs/finance/resultados-testes-v2.md` com ID, ambiente, comandos, saída, estado.
- Ambiente local destruído no fim; draft mantido para auditoria humana até aprovação.

## Pedido de autorização

Autorizar: (a) criação do rascunho isolado e do PostgreSQL local; (b) inserção apenas de fixtures fictícias aí; (c) instalação de M2/M1/B nesses ambientes; (d) execução dos testes possíveis. Produção permanece intocada.
