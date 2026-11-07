# Live Teká — Limites financeiros e equipa: revisão corretiva v2

**07/11/2026 · António Garcia · Apenas proposta para revisão humana.**

Os três documentos foram corrigidos; nenhum SQL foi executado, nenhuma consulta à base foi feita nesta revisão, nenhuma migração foi aplicada e nenhuma funcionalidade foi modificada. As observações sobre o sistema atual provêm dos ficheiros e da auditoria anterior; não equivalem a uma nova inspeção do catálogo ativo.

**Não autorizada para produção.** M2 é a primeira dependência, M1 a segunda. Compatibilidade operacional, privilégios efetivos, concorrência, reversão e os testes bancários continuam **PENDENTES**. Não confundir correção documental com implementação concluída.

## 1. O que já existe e não é substituído

- `withdrawal_limits` e auxiliares AOA; referência anterior: mínimo **10.000 AOA**, teto diário **200.000 AOA**, `Africa/Luanda`.
- `request_store_withdrawal(uuid,numeric)` reserva disponível no ledger e devolve `ok,id`.
- `request_payout(text,text,jsonb)` **não aceita montante**: calcula o montante com disponível e limite legado, devolvendo `ok,payout_id,amount_aoa,due_at,status`.
- Lojistas: `PENDING_REVIEW → APPROVED → PROCESSING → PAID`, rejeição antes de processamento; `PAID/REJECTED` terminais. Afiliados/entregadores: `pending/processing/paid/cancelled`; a auditoria anterior identificou incompatibilidades de `rejected` e campos bancários. Não presumir que foram resolvidas.
- Ledger append-only e RPCs atuais são a única autoridade monetária. A proposta Migration B e a integração oficial Banco Atlântico permanecem trabalhos distintos, não aplicados por este pacote.
- Papéis globais `user_roles` e `has_role` continuam intactos. O painel existente verifica admin; não concede acesso a funcionários simplesmente porque M2 foi instalada.

## 2. Correções e cobertura real

| Bloqueio do parecer | Correção nesta versão | Limite da cobertura |
|---|---|---|
| Políticas antes da função; M1 depende de M2 | M2: tabelas → funções → proprietário/ACL → políticas; M1 recusa sem funções M2 | Instalação real não ensaiada |
| `NULL` contorna mínimo/teto | Resolvedor interno lança erro explícito; montantes nulos, NaN, Infinity e precisão indevida recusados | Não substituir auxiliares legados sem cutover |
| País/moeda ambíguos | Mercado explícito, moeda exata, conta financeira verificada; sem autoridade do perfil editável | Mapeamentos reais exigem validação humana antes da ativação |
| Autoelevação e delegação arbitrária | Sem RPC de grant positivo/edição de função; gestor raiz separado; convites restritos a conjuntos não sensíveis | Permissões sensíveis só numa fase com dupla autorização completa |
| Convite por terceiro | Hash SHA-256, email confirmado do diretório, identidade exata, versão do convidante, prazo real, consumo único | Serviço de entrega e rate limiting não incluídos |
| Suspensão contornada por admin | Decisão v2 deny-first, sem `admin OU permissão`; convite de admin global recusado | Revogação universal exige adaptação de TODOS os caminhos legados |
| Teto conjunto e concorrência | Núcleo privado de quota por beneficiário/mercado/moeda; lock comum, eventos terminais únicos | Não ligado ao tráfego atual; ativação fechada |
| Globais duplicadas | Índice parcial global separado do específico | Globais não editáveis por RPC nesta fase |
| Fuso/reset diário | Fuso imutável de mercado, boundaries congelados; data capturada após espera | Mudança de fuso exige nova fase/boundary validado |
| Inicialização Angola errada | País AO/AOA exato, limites antigos verificados, gestor REAL confirmado, histórico na mesma transação | Sem placeholders de actor; instalação aborta se faltar prova |
| Auditoria mutável | Sem DML/TRUNCATE para roles da aplicação; triggers UPDATE/DELETE e statement TRUNCATE | Owner/infraestrutura privilegiada é fronteira confiável, não inviolável |
| SECURITY DEFINER/grants | Owner NOLOGIN isolado, funções qualificadas, `search_path=pg_catalog,pg_temp`, ACL de cada assinatura | Provisionamento do owner e ACL herdadas exigem inspeção futura |
| Reversão e repetição | Journal/checksum + transação; gate fechado; preservar história; repli seguro por fase | Procedimento escrito, **reversão NÃO validada** |

## 3. Pacote incluído agora: apenas proposta de fundação dormente

### M2 — primeiro

Novas tabelas `lt_staff_*_v2`, controlo de principals e registo raiz. Membros não ganham `user_roles.admin`. Funções base: contabilista consulta/prepara; financeiro consulta/prepara; operador de equipa lê equipa. **Contabilista nunca executa.** Gestor raiz gere limites/equipa, sem poder financeiro automático.

Não existe endpoint para conceder `finance.execute`, `finance.approve`, `finance.reject`, modificar funções partilhadas, remover negações, aumentar caps ou promover raiz. Assim, o bypass encontrado foi eliminado em vez de ser substituído por um workflow incompleto.

Convite: backend autenticado gera 32 bytes criptograficamente aleatórios, envia o token cru apenas uma vez ao destinatário e passa SHA-256 hexadecimal ao RPC service-only juntamente com o actor autenticado. Só o hash é persistido. Aceitação recebe hash, exige email confirmado igual ao destinatário e verifica papel, validade, ausência de admin global, ausência de principal prévio e versão/estado do convidante. O hash também deve ser tratado como credencial; não o divulgar nem logar. Nenhuma API de recuperação de token.

O serviço de entrega deve validar a sessão do solicitante (nunca confiar num actor vindo do corpo), impor rate limiting e não guardar links/tokens nos logs. A função service-only é uma fronteira de backend confiável; não substitui essa validação. Não implementar envio através de um endpoint público sem autenticação.

Suspensão/revogação v2 usa lock de autorização comum; alteração da versão invalida convites anteriores. Reativação só é permitida para conjuntos base não sensíveis. Autoalteração e alterações de raiz são recusadas. Principal revogado não é reativado. Recuperação de raiz é procedimento privilegiado separado e auditado, sem apagar história.

### M1 — depois

Novas tabelas de mercados, regras versionadas, histórico, contas de liquidação verificadas, reservas/eventos de **quota** e gate fechado. Não são um segundo ledger nem uma segunda reserva de dinheiro. Cada fonte tem identidade única `(kind,id)`.

Angola inicializada com 10.000/200.000, AOA, Africa/Luanda e precisão de 2 casas; isso preserva o contrato existente, sem fingir validação do banco. `execution_supported` significa somente compatibilidade do motor de saldo AOA, não que pagamentos bancários reais estão autorizados. Outros mercados não estão inicializados; moedas futuras permanecem bloqueadas até suporte completo.

Regra específica prevalece; existência de regra específica suspensa bloqueia fallback global. Global só pode ser usada quando não há configuração específica, com mesma moeda/fuso e mercado suportado. Moeda AOA noutro país não herda Angola automaticamente. Um país pode ter vários mercados explicitamente identificados; países com mesma moeda não partilham regras por acidente.

RPCs administrativas alteram valores mínimo/máximo ou ativação apenas no mercado suportado, com motivo e snapshots completos. Não editam fuso, suporte de moeda, país ou beneficiários. Sem desativar a regra velha por uma vigência futura prematura. Alterar país/fuso/global/support requer fase separada; não há endpoint que contorne esta restrição.

**Limitação deliberada:** limites v2 não substituem limites antigos nesta fase. Alterar v2 não muda levantamentos atuais; por exemplo, elevar o máximo v2 não supera o teto legado. Autonomia administrativa integral só será entregue após a adaptação completa dos consumidores, e não deve ser anunciada antes.

## 4. Contrato obrigatório da fase futura de integração

### 4.1 Autoridade financeira e internacionalização

Conta de liquidação verificada liga `(kind,entity_id)` a beneficiário, mercado e moeda. Loja exige proprietário/país validados; entregador exige entidade/mercado de liquidação verificados; afiliado exige vínculo financeiro aprovado, não simples `profiles.country_id`. Uma conta financeira é estável; mudanças de propriedade não transferem consumo histórico. Mapeamentos imutáveis nesta fundação, sem writer genérico. Não semear atribuições por adivinhação.

Configuração ausente, duplicada, inválida, mercado sem suporte, moeda diferente do saldo ou contexto ambíguo **recusa antes de movimentar dinheiro**. Nunca usar COALESCE/NULL como autorização ou FX implícito. Futuras moedas precisam de ledger/saldos separados, precisão, pagamentos, faturação e banco compatíveis; criar uma regra não fornece isso.

### 4.2 Adaptadores e teto conjunto

Não existem adaptadores exequíveis neste pacote, nem autorização para ativar o gate. É obrigatório apresentar os corpos completos dos adaptadores numa nova proposta antes da fase B.

- Preservar nomes de parâmetros/defaults e contratos JSON das RPCs existentes. Preferir wrappers v2 que chamem a lógica financeira existente mantendo `auth.uid()`. Não renomear/drop/recriar funções históricas nesta fundação.
- Entrada: autenticar → lock de autorização se operação administrativa → lock de mercado compartilhado → lock comum beneficiário/mercado/moeda → lock legado exato (`ledger:<store_id>` ou `payout:<user>:<kind>`) → linhas da fonte → validação/novo saldo → fonte monetária + quota na **mesma transação**.
- Usar namespaces/hashes exatamente comuns a todos os canais; não incluir loja, função ou dia no lock de quota. Vários recursos bloqueados por ordem determinística. Nenhuma chamada já bloqueada em ordem inversa.
- `request_payout` não aceita montante. Adapter preservador calcula candidato real antigo, recusa se ultrapassa restante conjunto e não inventa campo em destination. Depois verifica o montante realmente inserido. Pagamento parcial pelo restante conjunto exige seam nova amount-aware expressamente autorizada; não pode ser prometido pelo wrapper antigo.
- Se chamada antiga criar um pedido e validação posterior falhar, lançar erro para rollback integral. Nunca devolver `ok:false` deixando o pedido/reserva/notificação persistido.
- Validar saldo disponível pelo ledger/RPC origem; núcleo de quota não calcula nem cria dinheiro. Não deduzir disponibilidade de afiliados/entregadores outra vez.
- Todas as fontes/ações, incluindo admin/libertação/confirmação, precisam da mesma ordem de locks e revalidação. Inventariar triggers e writers monetários fora dos pedidos; bloquear ativação se houver bypass.

### 4.3 Reservas, estados e dia

Quota consumida por pedido pendente/aprovado/em processamento e pago, excluindo libertações legítimas únicas. `paid` retém consumo; `released` remove apenas quota do bucket original. Ambos mutuamente exclusivos por fonte. Alteração terminal indevida recusada; pagamento/rejeição não reconstrói fonte nem duplica ledger.

Dia é **dia do pedido**, equivalente ao critério histórico `created_at`. Pagamento posterior não consome outro dia. Pendência de ontem continua a reservar dinheiro e conserva restrição de pedido aberto, mas não consome quota de hoje. Virar meia-noite nunca liberta fundos. Boundaries são duas conversões locais independentes, não `+24h`, respeitando DST.

Fuso de cada reserva e atribuição do beneficiário ficam congelados. Configuração de fuso é imutável por RPC; futura alteração deve esperar boundary seguro e reconciliar buckets, sem oferecer reset de teto no mesmo dia. Montante decidido e bucket capturados após lock, não por um `now()` anterior à espera.

### 4.4 Adoção sem duplicação

Com novas entradas suspensas no cutover, reconciliar todas as pendências (também anteriores ao dia) e consumo pago do dia. Verificar cada pedido contra ledger reserva/pagamento/libertação e cálculos de disponibilidade; discrepância bloqueia ativação. Adoção grava só metadados de quota, origem `adoption`, pela chave fonte única. Não cria ledger, saldo, pedido nem notificação.

Não reconstruir snapshots antigos inexistentes: mostrar **indisponível**, nunca zero. Antes de reabrir: comparar contagens, totais, beneficiários, buckets e somas de cada canal; no mínimo 10.000/200.000 preservados para Angola. O pacote atual não contém backfill exequível, dado que as identidades históricas exigem prova.

### 4.5 Transição RBAC sem janela de bypass

Inventariar TODAS as RPCs admin, server functions, políticas RLS/storage, workers, leituras diretas de user_roles e acessos ao painel. Não basta acrescentar `admin OU permissão`. Políticas permissivas somam por OR; uma nova política permissiva não bloqueia antiga. Adaptar cada ação: consultar, preparar, aprovar, processar, executar, rejeitar, registar fatura. Ação NULL/desconhecida recusa.

Compatibilidade futura para gestor legado deve usar registo raiz aprovado + principal ativo, não todo admin. Funcionário suspenso com papel admin legado também precisa de recusa. Não modificar sem autorização `has_role` global para seller/customer. Receber permissão não torna alguém admin para navegar no painel antigo.

Permissões sensíveis: proposta imutável com payload/versão alvo, responsável e motivo; approver distinto do proposer e do beneficiário; ambos ativos/aptos na aplicação; caps de delegação explícitos por permissão/mercado/montante/prazo; ninguém delega por simplesmente possuir um poder; sem redelegação implicitamente. Mudança do payload invalida aprovação; apply único. Não permitir elevação indireta por função partilhada, conta alternativa ou remoção de deny.

Lock de autorização dá ordem definida: ação que adquiriu lock primeiro pode terminar antes de suspensão; após commit de suspensão novas ações recusam. Não cancelar/libertar dinheiro só porque operador foi suspenso. Jobs não enviados exigem nova validação/version; instrução bancária já enviada entra em reconciliação. Callback oficial autenticado deve reconciliar através de identidade bancária restrita, não do funcionário suspenso. Token/sessão/cache no browser não é autoridade.

## 5. Segurança PostgreSQL e limites de ameaça

- Cada CREATE TABLE tem GRANTs explícitos seguido de RLS. Roles da app têm só SELECT quando apropriado, nenhum INSERT/UPDATE/DELETE/TRUNCATE direto. Invites não têm SELECT para authenticated; tokens nunca aparecem nos históricos.
- Funções SECURITY DEFINER usam proprietário dedicado NOLOGIN, sem membership alcançável pelas roles de aplicação, sem SUPERUSER/BYPASSRLS. Mesmo proprietário das tabelas v2 evita recursão do avaliador RLS; não adicionar FORCE RLS sem redesign/teste.
- `search_path=pg_catalog,pg_temp`; tabelas, funções de aplicação e auth qualificadas. Funções de hash são nativas pg_catalog; SHA-256 de token é gerado na fronteira segura de entrega. Não assumir schema de extensão.
- Préflight exige gestor real confirmado, mesmo owner em todos os objetos M2/M1, manifests de oito tabelas/oito funções M2, RLS sem FORCE e `search_path` exato. Journal/checksum aprovado é atestado no comentário de controlo por executor privilegiado; não é uma assinatura criptográfica dos corpos SQL. Executor deve verificar o SHA256 real contra a revisão aprovada antes de definir os valores. A instalação exige superuser isolado autorizado e owner sem membros transitivos não-superuser nem pertença a outras roles; se indisponível, o pacote aborta. Owner precisa CREATE no schema para transferência e EXECUTE em auth.uid/has_role previamente provisionados. Nenhuma exceção não-superuser é autorizada por este SQL.
- Préflight exige gestor real confirmado e owner provisionado; falta de privilégios aborta, não tenta revogar membership de supabase_admin nem reduz isolamento.
- ACL das assinaturas v2 revogadas para PUBLIC/anon/authenticated/service_role antes dos grants necessários. Inspecionar ACL diretas/herdadas/default privileges, owners e dependências no ambiente isolado. **Esta revisão não inspecionou privilégios efetivos no catálogo ativo.**
- Owner requer só leitura exata de id/email/email_confirmed_at em auth.users, auth.uid e has_role necessários, schemas e dados de preflight; não escrever managed auth. Acesso de infraestrutura é uma fronteira confiável; um owner/superuser capaz de desativar triggers não é detido por RLS.
- Históricos/reservas/eventos de quota imutáveis contra UPDATE/DELETE/TRUNCATE; regras versionadas permitem só is_active por RPC controlada. Registrar before/after completo e actor real. Auditoria de rejeição seguida de exceção reverte com a transação; recusas exigem log externo seguro ou retorno negado com evento comprometido, nunca afirmar que um INSERT antes de RAISE persistiu.
- Auditoria de saldos monetários continua tarefa Migration B; históricos M1/M2 não inventam saldo anterior/posterior nem provam confirmação bancária.

## 6. Aplicação controlada, repetição e reversão

**Procedimento proposto; NÃO executado nem validado.**

1. Revisão humana desta versão, sem autorização implícita. Depois autorização independente para ambiente isolado, provisionamento owner e dados fictícios explicitamente identificados.
2. Inventário de catálogo isolado/representativo: ambas famílias de migrations, constraints/statuses/overloads/grants/políticas/triggers/owners, snapshots de definições e checksums. Resolver mismatch de liquidação documentado na Migration B antes de habilitar qualquer pagamento.
3. Antes da transação, executor verifica digest real dos ficheiros aprovados e journal. Define `app.review_owner`, `app.review_actor` e `app.review_package_sha256` de M2 na ligação dedicada; M2 grava atestação. M1 exige `app.expected_m2_sha256` igual ao digest aprovado e verifica o manifest/owner/RLS/funções de M2, sem conceder acesso privado a outro owner. Instalação M2 numa transação com actor real, owner isolado, versão/checksum guardados pelo journal; depois M1 em transação própria, com preflight de dependência e Angola. Gate continua false. Sem executar ficheiros por import automático em migrations.
4. Repetição via journal: mesmo ID+SHA256 já aplicado é no-op pelo executor; checksum diferente **aborta**. Os SQL têm CREATE strict: reexecução manual deve falhar/rollback, nunca mascarar divergência com IF NOT EXISTS. Falha em M1 deixa M2 dormente, não afeta clientes. Falha a meio de cada ficheiro reverte toda a transação.
5. Ensaiar fresh install, upgrade representativo, restart/falha no meio e reexecução; registrar catálogo e dados antes/depois. Corrigir proposta após FAIL, sem declarar PASS até evidência.
6. Nova proposta com adaptadores, migração de chamadas/UI, adoção, suspensão universal e approval workflow; mesma revisão/autorizações. Não existe SQL de ativação nesta versão. Campo gate não tem writer público.
7. Em cutover autorizado: suspender novos levantamentos/dispatch, reconciliar/adotar, verificar ACL originais (incluindo PUBLIC e overloads), ativar adaptadores/authorizations por domínio de uma só vez e só então reabrir. Sem bypass de nomes antigos. Histórico monetário e current releases preservados; owners não são credenciais para a app.

### Reversão por fase

- **Antes da ativação:** manter gate false e impedir novas entradas v2, preservar tabelas/históricos. Não é necessário apagar estruturas nem restaurar funções antigas porque não foram alteradas. Convites pending cancelar com evento, caso algum tenha sido emitido no isolado.
- **Falha de instalação:** transação integral rollback; recomeçar por journal/catálogo/checksum, não por REVOKEs improvisados de executor da plataforma.
- **Depois da ativação futura:** fechar novos levantamentos e dispatch, preservar reservas, callbacks oficiais e reconciliação; conservar autorização deny-first/suspensão e teto conjunto. Repli é versão segura anterior ou forward repair, **não retornar ao bypass admin/per-role**. Reverter UI não restaura grants inseguros. Não apagar membros/históricos nem converter PAID/REJECTED/CANCELLED.
- Se não existir versão anterior que preserve invariantes, manutenção fechada + reconciliação; não restaurar versão vulnerável. Limites v2 atualizados exigem reconciliar configuração antes do repli; não resetar quota nem sobrescrever valores antigos em silêncio.
- Critério de validação: ensaio isolado após pedidos/pendências e após callbacks, diffs zero de dados históricos, estados/ledger intactos, suspensão efetiva, teto e saldo correto; só então procedimento pode ser chamado “validado”. **Hoje: PENDENTE.**

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

### Evidência obtida nesta revisão

Revisão estática e revisão independente dos ficheiros, sem acesso à base. Análise local por parser PostgreSQL, sem enviar comandos a PostgreSQL: M2 tem **76 statements / 12 definições PL/pgSQL**, M1 tem **69 statements / 10 definições PL/pgSQL**, analisados sem erro de gramática após as correções. Esse parser não valida tabelas/assinaturas/proprietários/ACL, valores monetários, deadlocks ou execução. Nenhum resultado funcional PASS.

**Total: 55 cenários, todos PENDENTES.** Classificar PASS/FAIL apenas depois de execução isolada documentada; não reduzir os 12 bancários a outra matriz T1–T12. Aprovar rollout exige todos os cenários aplicáveis às fases habilitadas e nenhuma pendência de prova bancária para executar dinheiro real.

## 8. Riscos e decisão para nova revisão

- Pacote M2→M1 é compatível **no desenho estático** e usa nomes v2 sem substituir os atuais; não é prova de instalação bem-sucedida.
- Funções privadas de quota são seams internas, não proteção automática dos levantamentos atuais. Gate false, zero writer de ativação e nenhum adaptador: implementação financeira continua deliberadamente bloqueada.
- Gestor atual mantém funcionalidades legadas porque não foram alteradas. Não prometer suspensão universal, autonomia dos limites atuais, envio de convites, UI, contabilidade multimoeda ou Banco Atlântico como entregue.
- Owner dedicado pode exigir provisionamento privilegiado indisponível; nesse caso interromper e apresentar requisito, sem tentar remediar memberships da plataforma.
- Preflight lê dados só numa instalação futura autorizada; **não foi executado** nesta revisão. Não existem resultados de testes, bank sandbox ou rollback validado.
- Em aplicação futura alterações diretas aos auxiliares/has_role ou grants antes de adapters quebrariam chamadas e poderiam criar NULL bypass ou suspensão ineficaz. A divisão fundação → integração conjunta evita essa troca prematura.

**Para decisão humana:** rever estes SQL de fundação e o contrato da fase B; autorizar, se desejado, somente preparação/ensaio isolado numa nova mensagem. Não aplicar M1/M2 em produção nem considerar a matriz aprovada agora.
