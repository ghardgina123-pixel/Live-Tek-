import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Store, Sparkles, Users, ShoppingBag, Wallet, HelpCircle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatAoa, type SignupStatus } from "@/lib/signup-campaign";
import { storeCommissionPct } from "@/lib/settlement";
import { AFFILIATE_RULES } from "@/lib/affiliate";
import { serviceCategoryEmoji, serviceCategoryLabel } from "@/lib/services";

const TITLE = "Como vender no Live Teká";
const DESCRIPTION =
  "Guia completo do Live Teká: como abrir a sua loja, prestar serviços, publicar produtos, receber pagamentos, comissões e o programa de afiliados.";
const URL = "https://www.livemarketplece.live/como-vender";

const FAQ: Array<{ q: string; a: string }> = [
  { q: "Como abrir loja?", a: "Crie a sua conta, entre em Perfil → Quero vender / Registar loja, escolha a categoria, envie os dados exigidos e submeta para análise da gestão." },
  { q: "Quanto custa abrir loja?", a: "As primeiras 50 lojas aprovadas não pagam taxa de inscrição. A partir da 51.ª loja é cobrada a taxa de adesão definida na plataforma, mostrada no formulário de registo." },
  { q: "Como funciona a aprovação?", a: "A aprovação é sempre manual e feita pela gestão do Live Teká. Nunca é automática. Enquanto estiver pendente, a loja não pode vender." },
  { q: "Como vender?", a: "Depois de aprovada, publique produtos, divulgue-os nas lives e nos shorts e receba encomendas dos clientes dentro da app." },
  { q: "Como prestar serviços?", a: "Escolha a categoria de serviço, envie os requisitos pedidos para essa categoria e subscreva o plano mensal correspondente. A aprovação também depende da gestão." },
  { q: "Como funciona a comissão?", a: "Em cada venda de retalho a plataforma retém a comissão definida nas regras comerciais; o restante fica para a loja. Parceiros de serviços pagam plano mensal em vez de comissão por venda." },
  { q: "Como comprar?", a: "Escolha o produto, fale com o lojista se precisar de esclarecer o preço, toque em Comprar, escolha o método de pagamento disponível e finalize." },
  { q: "Como pagar?", a: "No checkout são apresentados apenas os métodos de pagamento que estão realmente activos na plataforma nesse momento." },
  { q: "Como receber o dinheiro?", a: "O valor líquido da venda entra no saldo da loja. Fica em compensação até a encomenda ser entregue e depois passa a disponível para saque." },
  { q: "Como ser afiliado?", a: "Entre na sua conta e abra a área de Afiliados para gerar o seu link único de indicação." },
  { q: "Como acompanho os meus ganhos?", a: "Na área de Afiliados vê indicações, comissões geradas, saldo e pedidos de saque. A loja acompanha vendas e saldo no painel do lojista." },
];

export const Route = createFileRoute("/como-vender")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: ComoVender,
});

type PlanRow = {
  code: string;
  name: string;
  price_aoa: number;
  period_days: number;
  categories: string[] | null;
  sort_order: number;
};

function Section({ id, icon: Icon, title, children }: { id: string; icon: typeof Store; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-border p-4">
      <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
        <Icon size={18} className="text-primary" aria-hidden />
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function ComoVender() {
  const [status, setStatus] = useState<SignupStatus | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [st, pl] = await Promise.all([
        supabase.rpc("seller_signup_status"),
        supabase.from("subscription_plans").select("code,name,price_aoa,period_days,categories,sort_order").eq("is_active", true).order("sort_order"),
      ]);
      if (!alive) return;
      setStatus((st.data as unknown as SignupStatus) ?? null);
      setPlans(((pl.data ?? []) as unknown as PlanRow[]) ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const retailPct = storeCommissionPct("retail");
  const servicePct = storeCommissionPct("service");

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-5 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" aria-label="Voltar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold leading-tight">Como vender no Live Teká</h1>
          <p className="mt-1 text-xs text-white/85">Lojas, serviços, produtos, pagamentos e afiliados — explicado passo a passo.</p>
        </div>
      </header>

      <div className="space-y-4 px-5 py-5">
        <Section id="como-funciona" icon={Sparkles} title="1. Como funciona o Live Teká">
          <p>O Live Teká é um mercado ao vivo: as lojas transmitem em direto, mostram os produtos e vendem no momento, com chat e entrega.</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Clientes</strong> descobrem lojas, assistem às lives, falam com o vendedor e compram na app.</li>
            <li><strong>Lojas</strong> registam-se, são aprovadas pela gestão, publicam produtos e transmitem lives.</li>
            <li><strong>Prestadores de serviços</strong> criam o seu perfil por categoria e são encontrados em <Link to="/servicos" className="text-primary underline">Serviços</Link>.</li>
            <li><strong>Afiliados</strong> divulgam lojas, produtos e serviços com um link único e ganham comissão pelas indicações.</li>
          </ul>
        </Section>

        <Section id="abrir-loja" icon={Store} title="2. Como abrir uma loja">
          <ol className="ml-4 list-decimal space-y-1">
            <li>Crie a sua conta em <Link to="/cadastro" className="text-primary underline">Criar conta</Link> (ou <Link to="/login" className="text-primary underline">entre</Link> se já tem conta).</li>
            <li>Abra <em>Perfil → Quero vender / Registar loja</em>.</li>
            <li>Escolha a categoria (retalho ou serviços) — os requisitos mudam consoante a categoria.</li>
            <li>Preencha identidade da loja, NIF, dados bancários para saques e localização.</li>
            <li>Anexe os documentos/comprovativos pedidos e submeta para análise.</li>
            <li>Aguarde a decisão da gestão.</li>
          </ol>
          <p className="rounded-lg bg-muted p-3 text-xs">A aprovação é <strong>sempre manual</strong>. Nenhuma loja é aprovada automaticamente e nenhuma loja pode vender antes de ser aprovada.</p>
        </Section>

        <Section id="taxa-adesao" icon={Wallet} title="3. Taxa de adesão das lojas">
          {loading ? (
            <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> A carregar as condições actuais…</p>
          ) : status ? (
            <>
              <ul className="ml-4 list-disc space-y-1">
                <li>Lojas 1 a {status.free_slots_total}: <strong>inscrição gratuita</strong>, mas sempre sujeita à aprovação do gestor.</li>
                <li>A partir da loja {status.free_slots_total + 1}: taxa de inscrição de <strong>{formatAoa(status.fee_aoa)}</strong>.</li>
                <li>Neste momento restam <strong>{status.slots_left}</strong> inscrições gratuitas e a sua loja seria a número <strong>{status.next_position}</strong>{status.fee_required ? " (com taxa)" : " (sem taxa)"}.</li>
              </ul>
              <p>Depois de aprovada, a loja pode publicar produtos e vender.</p>
              <p className="rounded-lg bg-muted p-3 text-xs">
                <strong>Atenção:</strong> inscrição gratuita não significa venda sem comissão. Cada venda de retalho gera {retailPct}% de comissão para a plataforma.
              </p>
            </>
          ) : (
            <p>Não foi possível carregar as condições de adesão neste momento. Consulte os valores no formulário de registo de loja.</p>
          )}
        </Section>

        <Section id="servicos" icon={Sparkles} title="4. Como prestar serviços">
          <ol className="ml-4 list-decimal space-y-1">
            <li>Escolhe a categoria de serviço no registo de parceiro.</li>
            <li>O sistema mostra os requisitos e documentos dessa categoria.</li>
            <li>Envia as informações e comprovativos exigidos.</li>
            <li>O sistema apresenta o plano mensal correspondente à categoria.</li>
            <li>A aprovação continua a depender da gestão.</li>
          </ol>
          <p>Parceiros de serviços não pagam comissão por venda ({servicePct}%) — pagam a subscrição mensal do plano da sua categoria.</p>
          {loading ? (
            <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> A carregar planos…</p>
          ) : plans.length ? (
            <ul className="space-y-2">
              {plans.map((p) => (
                <li key={p.code} className="rounded-xl border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{p.name}</span>
                    <span className="text-sm font-bold text-primary">{formatAoa(Number(p.price_aoa))}<span className="text-xs font-normal text-muted-foreground"> / {p.period_days} dias</span></span>
                  </div>
                  {(p.categories ?? []).length > 0 && (
                    <p className="mt-1 text-xs">
                      {(p.categories ?? []).map((c) => `${serviceCategoryEmoji(c)} ${serviceCategoryLabel(c)}`).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>Os planos são carregados directamente da plataforma. De momento não há planos activos para mostrar.</p>
          )}
        </Section>

        <Section id="publicar" icon={ShoppingBag} title="5. Como publicar e vender produtos">
          <ol className="ml-4 list-decimal space-y-1">
            <li>Cadastro da conta.</li>
            <li>Registo da loja e aprovação pela gestão.</li>
            <li>Criação da loja (logótipo, capa, descrição, localização).</li>
            <li>Publicação dos produtos (nome, preço, stock, imagem).</li>
            <li>Divulgação em lives, shorts e link da loja.</li>
            <li>O cliente escolhe o produto e finaliza a compra.</li>
            <li>Pagamento pelo método disponível e confirmação.</li>
            <li>Venda registada, encomenda preparada e entregue.</li>
          </ol>
        </Section>

        <Section id="comprar" icon={Users} title="6. Como o cliente compra">
          <ol className="ml-4 list-decimal space-y-1">
            <li>Escolhe o produto em <Link to="/lojas" className="text-primary underline">Lojas</Link> ou numa live.</li>
            <li>Pode falar com o lojista pelo chat para esclarecer ou negociar o preço.</li>
            <li>Toca em “Comprar” e confirma o endereço de entrega.</li>
            <li>Escolhe um dos métodos de pagamento realmente disponíveis no checkout.</li>
            <li>Efectua o pagamento e recebe a confirmação.</li>
            <li>O lojista recebe a notificação da venda e a gestão recebe o registo da transacção.</li>
            <li>A comissão da plataforma é calculada automaticamente pelas regras comerciais em vigor.</li>
          </ol>
          <p className="rounded-lg bg-muted p-3 text-xs">Os métodos de pagamento apresentados no checkout são apenas os que estão efectivamente activos. Nenhuma referência ou confirmação é gerada antes de a integração real estar disponível.</p>
        </Section>

        <Section id="receber" icon={Wallet} title="7. Como receber o dinheiro">
          <ul className="ml-4 list-disc space-y-1">
            <li>Cada venda paga gera um repasse: valor bruto − comissão da plataforma = valor líquido da loja.</li>
            <li>O repasse fica <strong>em compensação</strong> até a encomenda ser entregue.</li>
            <li>Depois da entrega, passa a <strong>saldo disponível</strong> no painel do lojista.</li>
            <li>O saque é pedido pelo próprio parceiro, para os dados bancários registados, e é processado pela gestão.</li>
          </ul>
          <p>O painel do lojista mostra sempre os valores reais: vendas, comissões, saldo em compensação e saldo disponível.</p>
        </Section>

        <Section id="afiliados" icon={Users} title="8. Programa de afiliados">
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Tornar-se afiliado:</strong> entre na conta e abra a área de Afiliados para gerar o seu código e link únicos.</li>
            <li><strong>Divulgar:</strong> partilhe o link de lojas, produtos, serviços ou o convite de registo.</li>
            <li><strong>Registo da indicação:</strong> quem entrar pelo seu link fica associado à sua conta no momento do registo.</li>
            <li><strong>Comissões actuais:</strong> bónus de {formatAoa(AFFILIATE_RULES.signupBonusAoa)} por registo válido, {AFFILIATE_RULES.buyerOrderPct}% nas compras do cliente indicado, {AFFILIATE_RULES.storeOrderPct}% nas vendas da loja indicada e {AFFILIATE_RULES.subscriptionPct}% nas subscrições indicadas.</li>
            <li><strong>Acompanhamento:</strong> indicações, comissões e saldo aparecem no painel de Afiliados.</li>
            <li><strong>Saque:</strong> pedido a partir do mesmo painel, respeitando o limite mínimo e o prazo de processamento indicados nessa página.</li>
          </ul>
        </Section>

        <Section id="faq" icon={HelpCircle} title="9. Perguntas frequentes">
          <dl className="space-y-3">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-foreground">{f.q}</dt>
                <dd>{f.a}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <section aria-label="Começar agora" className="space-y-2 rounded-2xl border border-border p-4">
          <h2 className="text-base font-bold">Comece agora</h2>
          <Link to="/cadastro" className="flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Criar minha loja</Link>
          <Link to="/servicos" className="flex h-11 items-center justify-center rounded-xl border border-border text-sm font-semibold">Quero prestar serviços</Link>
          <Link to="/cadastro" className="flex h-11 items-center justify-center rounded-xl border border-border text-sm font-semibold">Quero ser afiliado</Link>
          <Link to="/login" className="flex h-11 items-center justify-center rounded-xl border border-border text-sm font-semibold">Entrar na minha conta</Link>
          <p className="pt-1 text-xs text-muted-foreground">
            Dúvidas? Veja <Link to="/ajuda" className="text-primary underline">Ajuda e suporte</Link> ou os <Link to="/termos" className="text-primary underline">Termos e privacidade</Link>.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
