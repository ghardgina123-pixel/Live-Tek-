# Nova arquitetura de faturação — plano por fases

Objetivo global: separar claramente a **factura de venda emitida pelo lojista** das **facturas emitidas pela TUSSALA KAKA** (comissão de 5% ao lojista de retalho, 0% em serviços; e mensalidades/planos), com base fiscal preparada para AGT. Nenhuma alteração é feita agora.

## Fase 1 — Modelo `invoices` + migração segura de `subscription_invoices`
- **Objetivo**: uma tabela única de documentos, com `issuer_kind` (plataforma / lojista), `doc_kind` (venda, comissão, subscrição), série e número por série, `order_id`/`subscription_id`, `store_id`, snapshots de emissor e adquirente, totais, moeda, estado.
- **Afeta**: nova `invoices` (+ `invoice_series`, `invoice_items`); `subscription_invoices` mantida em modo leitura e copiada para `invoices`; trigger `create_invoice_on_subscription_active` reapontado; `lojista.subscricao.tsx`, `admin.subscricoes.tsx` passam a ler de `invoices`.
- **Pré-requisitos**: nenhum. É a base das restantes fases.
- **Riscos**: quebrar histórico de faturas; duplicação de numeração. Mitigação: migração copiadora (não destrutiva), sequência por série com unicidade `(series, number)`.
- **Validações**: contagem antiga = nova; números preservados; painel do lojista e do admin mostram exactamente as mesmas faturas de antes.

## Fase 2 — Separação venda do lojista vs documentos TUSSALA KAKA
- **Objetivo**: no pedido pago e verificado, registar (a) o documento de venda do lojista — número/série/ficheiro que o lojista associa ao pedido — e (b) gerar automaticamente a factura de comissão da TUSSALA KAKA ao lojista.
- **Afeta**: `orders` (referência ao documento de venda), `invoices`, `payouts` (ligação à factura de comissão), funções `notify_payment_confirmed`, `create_payout_on_paid`; UI de pedidos do lojista (upload/registo do documento) e do admin.
- **Pré-requisitos**: Fase 1; pagamento verificado pelo gateway (regra actual mantida).
- **Riscos**: gerar comissão sobre pagamentos não verificados. Mitigação: emissão só a partir do mesmo gatilho verificado usado hoje.
- **Validações**: pedido verificado gera exactamente 1 factura de comissão; serviços geram 0; listas de facturas do lojista e da plataforma não se misturam.

## Fase 3 — Correcção da comissão 5% / 0%
- **Objetivo**: fonte única de verdade da percentagem.
- **Afeta**: `store_commission_pct`, `calc_transaction_split`, `payment_intents.commission_pct` (default 10% desalinhado), `payouts`.
- **Pré-requisitos**: Fase 1 (para a factura de comissão reflectir o valor certo).
- **Riscos**: alterar valores de registos históricos. Mitigação: corrigir apenas o default e novos registos; histórico intocado.
- **Validações**: testes de split existentes; retalho 5% sobre o subtotal de produtos (nunca sobre a entrega), serviços 0%.

## Fase 4 — Dados fiscais e RLS
- **Objetivo**: identidade fiscal completa do emissor TUSSALA KAKA (NIF, morada, regime) e dos lojistas; acesso restrito.
- **Afeta**: configuração de emissor da plataforma, `stores`/`store_private` (NIF obrigatório para emitir), políticas e GRANTs de `invoices`/`invoice_items`.
- **Pré-requisitos**: Fases 1–3; dados legais reais fornecidos por si.
- **Riscos**: expor dados fiscais de terceiros. Mitigação: leitura limitada ao dono, ao adquirente e ao gestor.
- **Validações**: lojista vê só as suas; cliente vê só as do seu pedido; anónimo não vê nada.

## Fase 5 — PDF e arquivo em Storage
- **Objetivo**: PDF gerado no servidor e guardado de forma imutável, com download por link assinado.
- **Afeta**: `src/lib/invoice-pdf.ts` (emissor parametrizável), nova função de servidor, bucket privado de facturas, e-mails de subscrição (link).
- **Pré-requisitos**: Fase 4 (dados do emissor).
- **Riscos**: divergência entre PDF e registo. Mitigação: PDF gerado a partir do snapshot guardado, uma só vez.
- **Validações**: ficheiro existe, não é substituível, e o link expira.

## Fase 6 — AGT / software certificado
- **Objetivo**: numeração certificada, encadeamento de hash, assinatura e exportação SAF-T (AO), ou integração com fornecedor certificado.
- **Afeta**: `invoices` (hash, assinatura, série certificada), rota de exportação, processo de certificação.
- **Pré-requisitos**: Fases 1–5 e decisão comercial: certificar o próprio sistema ou integrar software já certificado.
- **Riscos**: emitir documentos não conformes. Mitigação: até haver certificação, os documentos da plataforma ficam marcados como internos/pró-forma.
- **Validações**: SAF-T válido, sequência sem furos, hash encadeado verificável.

## Fase 7 — UI e testes
- **Objetivo**: separadores distintos “Minhas facturas” (lojista) e “Facturas TUSSALA KAKA”, área do cliente com o documento do pedido, painel do gestor com toda a emissão.
- **Afeta**: painéis do lojista, do cliente e do admin; suite de testes.
- **Pré-requisitos**: fases anteriores.
- **Riscos**: confusão entre documentos. Mitigação: etiquetas de emissor sempre visíveis.
- **Validações**: typecheck, suite completa, build de produção e percurso manual em cada painel.

## Dependências externas
- Dados legais/fiscais da TUSSALA KAKA e NIF dos lojistas.
- Credenciais reais do gateway (sem elas, nada passa a “pago”).
- Decisão sobre certificação AGT própria vs fornecedor certificado.
