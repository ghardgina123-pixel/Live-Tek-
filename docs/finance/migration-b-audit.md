# Migration B v2 — proposta e auditoria, 7 de novembro de 2026

**REVISÃO APENAS — NÃO APLICADA. Não pronta para pagamentos reais.**

## Evidência atual (consultas SELECT)

- AOA: mínimo 10.000; máximo diário 200.000; fuso Africa/Luanda.
- Zero pedidos de lojistas, zero pedidos de afiliados/entregadores, zero movimentos no ledger; 19 registos de auditoria.
- RLS ativo nas quatro tabelas financeiras; políticas consultadas permitem leitura própria/admin, não escrita.
- Ledger possui UNIQUE(idempotency_key) e triggers contra UPDATE/DELETE; auditoria possui trigger contra UPDATE/DELETE.
- `verify_withdrawal_payment` ausente na lista consultada.
- `admin_settle_payout(uuid,text,text,text)` existe, referencia colunas de verificação ausentes e tenta gravar `rejected`, incompatível com CHECK atual. A assinatura de três argumentos não aparece no catálogo consultado; a proposta revoga-a condicionalmente se existir.
- RPCs `request_payout` e `admin_settle_payout` têm EXECUTE para PUBLIC/anon no catálogo, embora validem utilizador/admin internamente.
- `information_schema.role_table_grants` devolveu zero linhas sob a identidade de leitura disponível. **Isso não prova ausência de grants**; privilégios efetivos/inheridos ficam por testar.

## Alterações propostas

SQL completo: `docs/finance/migration-b-review.sql` (fora de drizzle/migrations; não será aplicado por um migrador).

1. Colunas nullable/com defaults; nenhuma remoção, mudança de tipo, atualização histórica, backfill ou alteração de migrations 0005/0006/0007.
2. Estados terminais imutáveis em triggers e RPCs; pagamento apenas PROCESSING → PAID / processing → paid. Operações em processamento não se cancelam automaticamente: exigem reconciliação oficial para evitar libertar dinheiro em trânsito.
3. Pedido rejeitado de afiliado/entregador mantém estado bruto `cancelled` com motivo adicional; apresentação futura pode mostrar “Rejeitado”. Não se altera o CHECK original.
4. Instrução bancária esperada imutável, destino mapeado oficialmente e prova bancária imutável; associação única por operação, transação e referência. ID, tipo, referência, valor exato, moeda e destinatário devem coincidir conjuntamente.
5. Sem função para inserir destinos oficiais ou provas bancárias, e sem grants de escrita nessas tabelas. **Confirmação fica bloqueada até uma integração oficial ser revista e autorizada separadamente.** Um booleano no payload não é prova; nenhum HMAC ou cabeçalho do banco foi inventado.
6. Admin deixa de poder marcar pago com uma referência manual; proteção de auto-aprovação; permissões de função restritas sem criar/revogar pertenças de roles.
7. Soma diária única por utilizador para afiliado + entregador; por loja para lojistas. Mínimo continua configurado no banco. Substitui `request_payout` pela versão baseada na Migration A, preservando argumentos/defaults e usando o lock conjunto.
8. Índice único adicional por levantamento/tipo de movimento, mantendo UNIQUE(idempotency_key). Conflito aborta a transação, não apaga dados nem ignora inconsciências.
9. Saldos medidos em BEFORE e AFTER; diferença verificada contra o movimento esperado; se não for demonstrável, aborta com `audit_snapshot_not_serialized`. Histórico antigo continua sem saldos inventados. RPC de leitura própria/admin ordenada por data/hora e ID.

## Compatibilidade e riscos — autorização deve considerar estes limites

- A versão anterior procurava ID **OU** referência e aceitava repetição sem rever a identidade completa; poderia confirmar operação errada. A nova proposta exige todas as identidades simultaneamente.
- Usar estado `rejected` diretamente quebraria o CHECK atual; remover defaults/assinaturas quebraria chamadas existentes. A proposta preserva-os.
- Pagamento manual passa a recusar: é alteração comportamental deliberada para cumprir “não marcar PAID sem confirmação efetiva”. Botões atuais não ficam automaticamente corrigidos por este SQL; a adaptação de ecrãs deve ser autorizada e entregue depois.
- Lojistas atualmente não registam destino no pedido; destinos nulos/vazios são recusados. A proposta NÃO inventa uma conta nem altera destinos históricos. Registo de destino correto e integração oficial continuam bloqueios de utilização.
- As novas tabelas de destinos/provas permanecem vazias. Nenhum pagamento pode ser confirmado por este pacote sozinho. Documentação oficial, segredo/mecanismo oficial, estado final remoto e mapeamento de conta são obrigatórios para habilitar o escritor de provas.
- Referência única global assume namespace único de instruções; verificar esta hipótese na documentação oficial antes de ativar banco.
- Snapshots antigos não podem ser reconstruídos fielmente; UI deve mostrar “saldo histórico indisponível”, não zero. Novos snapshots são propostos, não funcionalmente comprovados.
- SHARE locks sobre fontes de ganhos são conservadores e podem bloquear compras/entregas; writers antigos podem ter ordem de locks diferente. **Concorrência, impacto e deadlocks permanecem bloqueios de autorização para produção.** Não afirmar ausência de deadlock sem teste isolado.
- Statements multirow incompatíveis com snapshots por linha abortam em segurança; há risco de indisponibilidade se writers existentes dependem desse padrão. Testar antes de produção, sem contornar a validação.
- Índices novos falham se surgirem duplicados entretanto; não limpar dados automaticamente. Privilégios herdados, overloads e privilégios de owners precisam de verificação efetiva. Owner/superuser é fronteira de confiança; triggers/grants não impedem um administrador da infraestrutura de alterar o esquema.
- Auditoria de recusas seguida de RAISE reverte junto com a transação; respostas JSON em RPCs preservam recusas explicitamente auditadas. Ataques negados por grants/triggers exigem logs de segurança externos, não se afirmam presentes no histórico financeiro.

## Verificações efetivamente executadas

- Consultas SELECT acima: inspeção, não teste funcional de saque.
- Parser PostgreSQL local: 67 statements e 16 definições PL/pgSQL analisados sem erro sintático; **não valida resolução de tabelas/tipos, privilégios nem execução**.
- Revisão independente do SQL: motivou correções de mapping de destino, retries pagos, snapshots e permissões. Alguns apontamentos do revisor usavam migrations antigas; catálogo ativo/Migration A prevalecem.
- Scan básico: 16 resultados ativos — 3 erros, 7 avisos, 6 informativos. Não alterados/dispensados nesta revisão; resultados dispensados anteriormente não foram reabertos. Leituras amplas sinalizadas não demonstram por si só exploração.
- Scan aprofundado concluído: **1 aviso** — em caso de falha ao cancelar emails, o link/token reutilizável pode ser gravado nos logs do servidor e utilizado por alguém com acesso aos logs. Não corrigido neste pedido de revisão; não é prova de exploração nem validação financeira. Nenhuma indicação de checks aprofundados desligados no resultado consultado.
- Nenhum teste financeiro nem saldo fictício criado. Nenhuma migration aplicada.

## Os 12 testes obrigatórios — todos PENDENTES

Executar somente num banco isolado, com fixtures explicitamente fictícias e adaptador oficial/sandbox bancário autorizado. Cada teste deve guardar retorno, contagens antes/depois, linha de estado e snapshots reais. Só depois classificar PASS/FAIL.

| # | Teste / ação concreta | Resultado exigido | Estado e bloqueio |
|---|---|---|---|
|1|Pedido processing, instrução e prova oficial final correspondentes; chamar verificação|PAID, 1 débito da reserva lojista, saldo disponível inalterado, reserva reduzida pelo valor|PENDENTE — sem integração/prova oficial nem ambiente isolado|
|2|Mesmo ID/prova, referência diferente|Recusado; estados, reserva e ledger intactos|PENDENTE — fixtures isoladas ausentes|
|3|Mesmo ID/prova, valor diferente (incluindo 10.000,001)|Recusado sem arredondamento silencioso ou movimento|PENDENTE — fixtures isoladas ausentes|
|4|Mesmo ID/prova, moeda USD em vez de AOA|Recusado; nenhuma confirmação|PENDENTE — fixtures isoladas ausentes|
|5|Enviar corpo bancário com assinatura oficial inválida|401/recusa antes de inserir prova/chamar verificação|PENDENTE — documentação e endpoint oficial ausentes|
|6|Repetir operação exata, depois mudar referência/valor/destino/tipo|Exata devolve already_verified, sem duplicar; alterações recusadas|PENDENTE — fixtures/prova ausentes|
|7|Pedido pago: tentar pending/approved/processing/rejected e editar nota|Todas alterações negadas; estado e timestamps preservados|PENDENTE — fixture paga isolada ausente|
|8|Pedido rejeitado/cancelado: tentar processar/verificar|Recusa; sem consumir saldo nem reabrir|PENDENTE — fixtures isoladas ausentes|
|9|Admin beneficiário tenta registar instrução/aprovar/processar a própria conta|self_approval_forbidden; nenhum movimento|PENDENTE — duas identidades isoladas necessárias|
|10|Inserir segunda reserva/pagamento/libertação para mesmo levantamento; repetir callbacks concorrentes|UNIQUE/recusa e apenas 1 movimento de cada tipo; nenhuma reserva negativa|PENDENTE — fixtures e privilégios isolados ausentes|
|11|Após 190.000 no dia Luanda, pedir 20.000; correr pedidos concorrentes afiliado/courier e loja|Recusa acima de 200.000; total nunca excede teto; rejeitados/cancelados excluídos; dia seguinte correto|PENDENTE — saldos e concorrência isolados ausentes|
|12|Utilizador/admin/service tenta UPDATE/DELETE/TRUNCATE de auditoria|Recusa, conteúdo e contagem preservados; owner fora do modelo de ameaça da app|PENDENTE — ensaio destrutivo somente isolado|

Testes adicionais necessários: valor 9.999,99 recusado, 10.000 elegível com saldo; tipo/destino incorretos; duas operações usando a mesma prova; saldo insuficiente; locks adversariais; escrita multirow; leitura própria não expõe outra conta. Todos PENDENTES.

## Decisão

Proposta completa entregue para revisão, **não recomendada para aplicação em produção até os riscos de concorrência/integração serem resolvidos e ensaiados**. Nenhuma autorização anterior cobre este SQL novo. Aplicação exige autorização expressa de António Garcia; os ecrãs não foram alterados.

O plano foi ignorado na apresentação; isso não constitui autorização. Nenhuma implementação ou reformulação do plano ocorreu depois dessa decisão.
