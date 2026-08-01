# E2E — Live Teká

Cenários End-to-End que cobrem a jornada crítica da plataforma. As specs
abaixo são estruturadas para Playwright (`@playwright/test`). Para executar
localmente:

```bash
bun add -d @playwright/test
bunx playwright install --with-deps
bunx playwright test
```

Variáveis necessárias em `.env.test`:

```
E2E_BASE_URL=http://localhost:3000
E2E_CUSTOMER_EMAIL=cliente@example.com
E2E_CUSTOMER_PASSWORD=********
E2E_SELLER_EMAIL=lojista@example.com
E2E_SELLER_PASSWORD=********
E2E_STORE_ID=<uuid da loja de teste>
E2E_PRODUCT_ID=<uuid de um produto aprovado da loja>
```

## Cenários cobertos

1. **journey.spec.ts** — jornada completa cruzando dois contextos de browser:
   - Cliente envia mensagem em tempo real para a loja (chat realtime).
   - Cliente finaliza checkout e gera um pedido `pending`.
   - Lojista recebe toast de notificação instantânea (Supabase Realtime).
   - Lojista altera o status do pedido `pending → preparing → shipped`.
   - Cliente vê a atualização do status sem recarregar a página.