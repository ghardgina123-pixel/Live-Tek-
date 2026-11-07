# Migration B — revisão completa, sem aplicação

## Entrega desta revisão

O SQL completo está em `docs/finance/migration-b-review.sql`; a auditoria completa está em `docs/finance/migration-b-audit.md`.

Esta proposta **não foi aplicada**. Não foram criados saldos, movimentos ou pedidos de teste, nem alterados dados existentes.

## O que a proposta muda

- Impede regressão ou edição de estados pagos/rejeitados/cancelados.
- Exige coincidência conjunta de ID, tipo, referência, montante exato, moeda e destinatário.
- Exige prova bancária oficial persistida; repetições exatas não repetem movimentos, notificações ou alterações.
- Impede pagamento manual baseado apenas numa referência.
- Mantém ledger imutável e acrescenta unicidade por levantamento/tipo de movimento.
- Mantém mínimo de 10.000 AOA e teto de 200.000 AOA, com soma conjunta de afiliado/entregador por utilizador e soma por loja.
- Acrescenta auditoria cronológica, com saldos medidos; valores históricos desconhecidos ficam indisponíveis, não zero.
- Preserva estados brutos, argumentos/defaults, RLS, históricos e migrations 0005/0006/0007.

## Compatibilidade

Gravar `rejected` diretamente quebraria a restrição atual de afiliados/entregadores; a proposta usa `cancelled` com motivo adicional, sem mudar a restrição nem reescrever história. Remover defaults ou funções quebraria chamadas existentes; as assinaturas ativas são preservadas.

Colunas novas são nullable/com defaults; não há remoções, mudanças de tipo, backfill ou alterações retroativas. Não há esquema aposentado nesta proposta.

## Auditoria e resultados honestos

Inspeção atual: mínimo 10.000, teto 200.000, Africa/Luanda; zero pedidos e zero movimentos no ledger; 19 registos de auditoria. A liquidação atual referencia colunas ausentes e estado incompatível. RLS e imutabilidade foram inspecionados, não funcionalmente testados.

Análise sintática local: 67 statements e 16 definições PL/pgSQL analisados. Isso **não** comprova execução, privilégios, saldos ou concorrência.

Os 12 testes obrigatórios estão **PENDENTES**, com ações e resultados esperados na auditoria. Nenhum PASS financeiro foi declarado.

Scan básico: 16 resultados ativos (3 erros, 7 avisos, 6 informativos), não alterados. Scan aprofundado iniciado e ainda pendente.

## Bloqueios e riscos antes de produção

- Documentação oficial Banco Atlântico, mecanismo/segredo oficial, consulta remota do estado final e mapeamento oficial de destinatário.
- As tabelas de mapeamento/provas não têm escritor neste pacote; a verificação permanece bloqueada em segurança. Não é uma integração bancária operacional.
- Ambiente isolado e identidades de teste para executar os 12 testes e testar concorrência/deadlocks.
- Locks conservadores sobre fontes de ganhos podem bloquear compras/entregas; ordem de locks e operações multirow precisam de ensaio. A proposta **não é recomendada para produção** antes disso.
- Os ecrãs atuais ainda precisam de adaptação ao mínimo, histórico e pagamento exclusivamente verificado; esta revisão não os altera.

## Próximo passo permitido

Rever o SQL integral e a auditoria; resolver os bloqueios e autorizar expressamente a versão final antes de qualquer aplicação. Aprovar este plano não valida pagamentos reais nem substitui documentação bancária ou testes isolados.
