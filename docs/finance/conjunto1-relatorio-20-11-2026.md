# Conjunto 1 — aplicado 20/11/2026
Migrações: 0011_identity_unique_nif_bi, 0012_allow_multiple_stores_per_owner.
Testes na base real em transação anulada (nada gravado): T1–T10 PASS
(2.ª conta com mesmo NIF/BI recusada; 3 lojas pelo mesmo titular; outro titular não vê/altera/cria lojas alheias nem lê identidade).
Testes locais anteriores: 19/19 PASS (inclui registos simultâneos). Testes unitários: 6 PASS.
Pendente: registo no navegador com e-mail real não executado (evitar contas fictícias em produção).
