# Live Teká — proposta de integração mínima (M1 v3 / M2 v4)

07/11/2026. Preparação aprovada; SQL NÃO aplicado. Aprovação do plano não autoriza SQL ainda não apresentado.

## Estruturas e âmbito

Reutilizar withdrawal_limits, user_roles/has_role, financial_audit_log, painel e RPCs existentes. Versões v2 preservadas em *-v2-retirada; não executar. Não criar mercados/regras/quota/ledger/checkout paralelos.

M2 v4: um único complemento staff_members, inexistente na inspeção direcionada, sem duplicar identidade/papéis. Convites por token aleatório de 256 bits para contas confirmadas, vinculados por UUID, validade de sete dias, hash SHA-256 armazenado, consumo atómico e cancelamento de convite pendente. Hash/token excluídos da auditoria; hash sem SELECT das roles da aplicação. A futura entrega deve usar fragmento removido imediatamente, sem logs do token. Poderes iniciais só consultar/preparar, suspensão/revogação e histórico no log existente. Sem grants sensíveis positivos, autoelevação ou promoção a admin. Sintaxe inspecionada (21 statements/6 PLpgSQL); não instalada nem validada funcionalmente.

M1 v3: acrescenta metadados country/market/revision à linha existente; preserva 10.000/200.000 AOA e Africa/Luanda na instalação. RPC de edição com revisão/motivo/auditoria; helpers sem fallback/NULL. Sem nova tabela financeira.

## Cobertura e bloqueios

Estes SQL completos cobrem SOMENTE a configuração Angola e vínculos de equipa não sensíveis. Não representam implementação integral do plano e não estão prontos para produção. UI, integração granular dos RPCs/RLS, soma diária conjunta, atribuição financeira por país e workflow sensível continuam por concluir. Instalar agora não entrega autonomia operacional segura.

O catálogo ativo confirmou incompatibilidade adicional: payout_requests NÃO contém bank_reference/verification_state/verification_source/verified_at; status rejected NÃO é permitido pela constraint, embora admin_settle_payout os use. Corrigir a operação existente sem nova carteira/saque; preservar cancelled como rejeição compatível. Confirmação manual não é prova oficial.

Rever ACL nativas/memberships/owners de todas as assinaturas e writers antes da aplicação. Não reduzir isolamento nem revogar pertenças da plataforma para conseguir executar. No âmbito desta preparação nenhuma migração nem dado real foi alterado.

Revisão independente adicional: verificar comportamento RLS/owner de staff_can e ausência de recursão; bloqueante antes de qualquer instalação, inclusive isolada. Convites são one-shot, sem reconvite/reativação de revogados. A unicidade de AOA já está comprovada pela PRIMARY KEY(currency) do catálogo atual; não acrescentar índice equivalente duplicado. Privilégios herdados continuam por ensaiar. Gramática local válida: M1 21 statements/5 definições PL/pgSQL, M2 21/6; não constitui PASS financeiro.

## Entrega de consulta em 07/11

Acrescentadas páginas /admin/equipa e /admin/limites ao painel existente. Leituras autenticadas, validação has_role no servidor e RLS existentes; sem cliente privilegiado. A equipa consulta apenas administradores atuais e papéis existentes, não funcionários fictícios. Limites e histórico são lidos de withdrawal_limits e financial_audit_log, sem reconstrução histórica. Convites/edição permanecem explicitamente indisponíveis. A conta do solicitante usada na verificação tem papel customer: recusa das duas páginas confirmada; visualização administrativa com conta admin ainda MANUAL ACTION REQUIRED. Conta desligada redirecionada ao login.

Base de teste existente confirmada pelo catálogo de rascunhos: “Testes financeiros isolados”, base própria, pronta mas atrasada, sem alterações. As ferramentas desta conversa atuam na base principal; não foi criado levantamento nem saldo fictício aqui. Execução no chat daquele rascunho exige completar instalação/validação dos RPCs existentes e do SQL revisto, sem aceitar o rascunho. Não foi emitido PASS de saldo, teto diário ou auditoria.

## Próxima autorização necessária

Rever os ficheiros SQL anexos ao projeto; NÃO autorizar produção como se o pacote fosse final. Autorizar primeiro instalação dos SQL de revisão apenas no ambiente isolado confirmado, sem aceitar o rascunho, dados exclusivamente fictícios e execução dos testes possíveis. Só após resolver os bloqueios e validar integração/reversão apresentar SQL final para aplicação financeira expressa.

Banco Atlântico: nenhum endpoint/assinatura/credencial inventados. Seam futura no intent/pedido existente deve exigir prova oficial conjunta ID, tipo, referência, montante, moeda, destinatário e retry exato. Documentação, credenciais e sandbox oficial permanecem bloqueantes.

Reversão: snapshots de funções/ACL/schema/dados isolados, falha intermédia, concorrência, reexecução e restauração segura sem apagar históricos nem reabrir estados terminais. Reversão NÃO validada.

## Matriz preservada

Os identificadores e critérios anteriores mantêm-se; referências a fundação/adaptadores v2 são cenários históricos a remapear para os consumidores existentes, nunca autorização para instalar estruturas paralelas. Todos PENDENTES.

## 7. Matriz completa de testes — TODOS PENDENTES

Nenhum dos testes seguintes foi executado nesta revisão. Análise de texto/sintaxe não aprova testes. Guardar input/retorno, contagens, estados, snapshots observados, logs de locks e diferenças antes/depois, sem credenciais. Fixtures financeiras fictícias só no isolado; confirmação real requer sandbox/adaptador oficial autorizado. Os testes bancários não podem usar assinatura inventada como prova oficial.

### F1–F12: os 12 financeiros/bancários anteriores, preservados

| ID | Ação | Critério exigido | Estado/bloqueio |
|---|---|---|---|
| F1 | Prova oficial final exata em pedido processing | PAID; um débito de reserva; disponível inalterado, reservado reduzido | PENDENTE — isolado e integração oficial |
| F2 | Referência diferente com mesmo ID | Recusa, estados/saldo/ledger intactos | PENDENTE — fixtures/prova |
| F3 | Montante diferente, também 10.000,001 | Recusa sem arredondamento silencioso | PENDENTE — fixtures/prova |
| F4 | Moeda USD onde é AOA | Nenhuma confirmação | PENDENTE — fixtures/prova |
| F5 | Assinatura oficial inválida | Recusa antes de persistir prova/verificar | PENDENTE — documentação Banco Atlântico |
| F6 | Repetição exata; depois mudar referência/valor/destino/tipo | Exata already_verified sem movimento/notificação duplicados; variantes recusadas | PENDENTE — fixtures/prova |
| F7 | PAID → pending/approved/processing/rejected; editar nota | Todas negadas, timestamps preservados | PENDENTE — fixture paga isolada |
| F8 | Rejeitado/cancelado → processing/verificação | Recusa sem reabrir/reservar | PENDENTE — fixtures terminais |
| F9 | Admin beneficiário aprova/processa a própria conta | self_approval_forbidden; nenhum movimento | PENDENTE — identidades isoladas |
| F10 | Duplicar reserva/pagamento/libertação, callbacks concorrentes | Uma ocorrência de cada movimento permitido; reserva não negativa | PENDENTE — fixtures/privilégios isolados |
| F11 | 190.000 no dia + 20.000; concorrência loja/affiliate/courier | Nunca excede 200.000, libertados excluídos, dia seguinte correto | PENDENTE — adaptadores e saldos isolados |
| F12 | App/admin/service UPDATE/DELETE/TRUNCATE auditoria | Recusa e conteúdo/contagem intactos, owner fora da ameaça da app | PENDENTE — teste destrutivo isolado |

### S: segurança, RBAC e convites

| ID | Ação | Critério exigido | Estado |
|---|---|---|---|
| S1 | Anon/auth sem permissão muda limite/status | Recusa, dados intactos | PENDENTE |
| S2 | Self grant, self invite, remoção de deny, edição de função que inclui actor | Sem endpoint/recusa; nenhum poder ganho | PENDENTE |
| S3 | Team read tenta convidar financeiro sensível/atribuir root | Recusa por cap e falta de autoridade | PENDENTE |
| S4 | Contabilista com tentativa de exceção execute | Recusa incondicional, nenhum pagamento | PENDENTE |
| S5 | Token correto, conta/email de terceiro | invalid_invitation, convite não consumido | PENDENTE |
| S6 | Email não confirmado, convite expirado/cancelado/replay concorrente | Recusa; no máximo um membro/aceitação | PENDENTE |
| S7 | Convidante suspenso/revogado ou versão alterada | Convite anterior recusado | PENDENTE |
| S8 | Role inativo ou ampliado depois do convite | Recusa, sem grants novos | PENDENTE |
| S9 | Suspensão com sessão velha, papel admin legado, chamada antiga/worker/RLS | Recusa universal após commit; bloqueia cutover se caminho antigo autoriza | PENDENTE — integração fase B |
| S10 | Ação concorrente com suspensão | Ordem de lock reproduzível; após commit nenhuma nova ação | PENDENTE |
| S11 | Reativação própria/privilegiada, último root, revogado | Recusa; recuperação somente aprovada e auditada | PENDENTE |
| S12 | Lê convite/hash ou auditoria alheia sem permissão | Recusa; logs sem tokens/links/hash | PENDENTE |
| S13 | ACL PUBLIC/anon/overloads/member do owner/search_path malicioso | Sem execução privada/escrita herdada/hijack; instalação insegura aborta | PENDENTE |
| S14 | Proposer=approver ou target; approval stale/payload alterado/replay | Recusa; apply único e caps atuais | PENDENTE — workflow sensível futuro |
| S15 | Preparar/aprovar/processar/executar/rejeitar com permissão diferente | Cada ação independente; NULL/unknown recusa; banco ainda obrigatório | PENDENTE — fase B |

### L: limites, concorrência, saldo e tempo

| ID | Ação | Critério exigido | Estado |
|---|---|---|---|
| L1 | 9.999,99; 10.000; 200.000; 200.000,01 com saldo suficiente | Primeiro/último recusados; fronteiras elegíveis sem dispensar saldo | PENDENTE |
| L2 | Configuração inexistente/suspensa, min/max NULL/NaN/Infinity | Erro explícito, zero pedido/movimento | PENDENTE |
| L3 | Mesmo user, duas lojas + afiliado + courier concorrentes | Soma conjunto ≤200.000, sem deadlock/duplicação | PENDENTE |
| L4 | Dois gestores criam/substituem/ativam regra sem linha prévia | Uma ativa; serialização por chave e histórico completo | PENDENTE |
| L5 | Dois globais NULL; específico suspenso e global ativo | Duplicado recusado; suspensão não usa fallback | PENDENTE |
| L6 | Pedido × rejeição/libertação × callback pago | Uma transição terminal; quota/fundos nunca negativos | PENDENTE |
| L7 | Lock iniciado antes de meia-noite/libertado depois | Bucket do instante pós-espera, limites corretos | PENDENTE |
| L8 | DST e mudança de fuso/regra | Boundaries locais reais; zero reset indevido de quota | PENDENTE |
| L9 | Paid ontem/pendente ontem pago hoje/rejeitado hoje | Sem dupla quota; reserva financeira antiga intacta até ação legítima | PENDENTE |
| L10 | Adoção duas vezes de fontes históricas/mudança de dono | Uma fonte; atribuição antiga intacta; zero ledger/notificação novo | PENDENTE |
| L11 | Falha depois da RPC antiga criar pedido | Rollback integral de pedido/ledger/quota/notificações | PENDENTE |
| L12 | Payout candidato antigo excede restante conjunto | Recusa sem pedido; partial só por seam aprovada | PENDENTE |
| L13 | Reduzir teto abaixo do uso do dia, aumentar mínimo | Uso passado intacto; novos pedidos recusados conforme regra | PENDENTE |
| L14 | Pedido sem saldo, com reserva prévia, multirow/locks adversariais | Saldo validado pelo servidor; nunca gastar reserva nem duplicar | PENDENTE |
| L15 | Inicialização Angola ausente/divergente/actor falso | Instalação aborta; 10.000/200.000 e actor real/história no caso válido | PENDENTE |

### I: internacionalização

| ID | Ação | Critério exigido | Estado |
|---|---|---|---|
| I1 | Dois países mesma moeda, mercados diferentes | Regras e buckets independentes, entidade correta | PENDENTE |
| I2 | AOA de mercado não-Angola sem suporte | Recusa; nenhuma herança automática de AO-main | PENDENTE |
| I3 | País do perfil/client currency/destination alterados | Contexto financeiro não muda; tentativa inconsistente recusa | PENDENTE |
| I4 | EUR/USD/regra criada sem motor completo | Operação bloqueada, zero débito AOA/FX implícito | PENDENTE |
| I5 | Precisão monetária/fuso inválidos; combinação país/moeda não verificada | Recusa explícita e nenhum histórico financeiro inventado | PENDENTE |

### R: instalação, reversão, preservação e compatibilidade

| ID | Ação | Critério exigido | Estado |
|---|---|---|---|
| R1 | Fresh install M2→M1, depois ordem inversa | Correta resolve dependências; inversa aborta antes de alterações M1 | PENDENTE |
| R2 | Upgrade com pedidos/história existentes | Zero alteração de dados e assinaturas legados; gate false | PENDENTE |
| R3 | Falha na metade M2/M1 | Transação integral rollback; M2 já concluída permanece dormente | PENDENTE |
| R4 | Reexecução mesmo checksum/diferente/manual | Journal no-op / aborta mudança / CREATE falha transacional | PENDENTE |
| R5 | Repli pré-ativação | Funções/grants antigos intactos; históricos v2 preservados | PENDENTE |
| R6 | Repli pós-ativação com paid/pendências e operador suspenso | Sem regressão de estados, saldo, teto conjunto ou autorização | PENDENTE — adaptadores inexistentes |
| R7 | Repli com callback oficial em voo | Reserva intacta até reconciliação; nenhuma falsa cancelamento/pagamento | PENDENTE — banco oficial |
| R8 | Snapshot/diff ledger/auditoria, SELECT por dono, realtime/GPS/compras | Históricos e funcionalidades não financeiras preservados | PENDENTE |

