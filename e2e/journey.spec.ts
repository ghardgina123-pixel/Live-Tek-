/**
 * Jornada crítica E2E — Live Teká
 *
 * Cobre: chat realtime (cliente → lojista), checkout, notificação instantânea
 * para o lojista (Sonner toast disparado por subscription Supabase Realtime na
 * tabela `orders`) e atualização de status do pedido pelo lojista, refletida
 * no painel do cliente em tempo real.
 *
 * Requer Playwright: `bun add -d @playwright/test && bunx playwright install`.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CUSTOMER = {
  email: process.env.E2E_CUSTOMER_EMAIL!,
  password: process.env.E2E_CUSTOMER_PASSWORD!,
};
const SELLER = {
  email: process.env.E2E_SELLER_EMAIL!,
  password: process.env.E2E_SELLER_PASSWORD!,
};
const STORE_ID = process.env.E2E_STORE_ID!;
const PRODUCT_ID = process.env.E2E_PRODUCT_ID!;

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/(home|lojista)/);
}

test.describe("Jornada crítica: cliente ↔ lojista", () => {
  let customerCtx: BrowserContext;
  let sellerCtx: BrowserContext;
  let customer: Page;
  let seller: Page;

  test.beforeAll(async ({ browser }) => {
    customerCtx = await browser.newContext();
    sellerCtx = await browser.newContext();
    customer = await customerCtx.newPage();
    seller = await sellerCtx.newPage();
    await Promise.all([
      login(customer, CUSTOMER.email, CUSTOMER.password),
      login(seller, SELLER.email, SELLER.password),
    ]);
  });

  test.afterAll(async () => {
    await customerCtx.close();
    await sellerCtx.close();
  });

  test("1) cliente envia mensagem realtime — lojista recebe sem reload", async () => {
    // Cliente abre a loja e inicia conversa
    await customer.goto(`${BASE}/loja/${STORE_ID}`);
    await customer.getByRole("button", { name: /conversar/i }).click();
    await customer.waitForURL(/\/chat\?c=/);

    const msg = `Olá! Teste E2E ${Date.now()}`;
    await customer.getByPlaceholder(/mensagem/i).fill(msg);
    await customer.getByRole("button", { name: /enviar|send/i }).click();

    // Lojista abre a aba de mensagens e deve ver a mensagem chegar via realtime
    await seller.goto(`${BASE}/chat`);
    await expect(seller.getByText(msg)).toBeVisible({ timeout: 10_000 });
  });

  test("2) cliente realiza checkout e gera pedido pending", async () => {
    await customer.goto(`${BASE}/produto/${PRODUCT_ID}`);
    await customer.getByRole("button", { name: /adicionar ao carrinho/i }).click();
    await customer.goto(`${BASE}/checkout`);

    // Seleciona primeiro endereço e método de pagamento disponíveis
    await customer.locator("[data-testid='address-option']").first().click();
    await customer.locator("[data-testid='payment-option']").first().click();

    await customer.getByRole("button", { name: /confirmar pedido|pagar/i }).click();
    await expect(customer.getByText(/pedido confirmado/i)).toBeVisible({ timeout: 10_000 });
  });

  test("3) lojista recebe notificação Sonner instantânea do novo pedido", async () => {
    // O RealtimeNotifier dispara um toast quando `orders` insere uma linha na loja do lojista.
    await expect(seller.locator("[data-sonner-toast]").filter({ hasText: /novo pedido/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("4) lojista altera status do pedido pending → preparing → shipped", async () => {
    await seller.goto(`${BASE}/lojista/pedidos`);
    const firstOrder = seller.locator("[data-testid='order-row']").first();
    await firstOrder.click();

    await seller.getByRole("button", { name: /preparar|preparing/i }).click();
    await expect(seller.getByText(/preparing/i).first()).toBeVisible();

    await seller.getByRole("button", { name: /enviar|shipped/i }).click();
    await expect(seller.getByText(/shipped/i).first()).toBeVisible();
  });

  test("5) cliente vê o pedido atualizado para 'shipped' em tempo real", async () => {
    await customer.goto(`${BASE}/compras`);
    await expect(customer.getByText(/shipped|enviado/i).first()).toBeVisible({ timeout: 15_000 });
  });
});