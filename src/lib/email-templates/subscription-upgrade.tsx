import * as React from 'react'
import type { TemplateEntry } from './registry'
import { SubscriptionShell, money, type SubscriptionEmailProps } from './subscription-layout'

const Email = ({ storeName, planName, amountAoa, reference }: SubscriptionEmailProps) => (
  <SubscriptionShell
    preview={`Pedido de upgrade para o plano ${planName ?? ''}`}
    heading="Pedido de upgrade registado"
    intro={`Olá${storeName ? ` ${storeName}` : ''}, registámos o seu pedido de upgrade. Conclua o pagamento por Multicaixa Express com a referência abaixo para ativar o plano.`}
    rows={[
      ['Plano', planName ?? '—'],
      ['Valor', money(amountAoa)],
      ['Referência', reference ?? '—'],
    ]}
    ctaLabel="Ver subscrição"
    ctaUrl="https://www.livemarketplece.live/lojista/subscricao"
    outro="Assim que o pagamento for confirmado, a subscrição é ativada automaticamente e a fatura fica disponível."
  />
)

export const template = {
  component: Email,
  subject: 'Pedido de upgrade recebido — Live Teká',
  displayName: 'Subscrição: upgrade pedido',
  previewData: { storeName: 'Loja Teste', planName: 'Profissional', amountAoa: 55000, reference: 'SUB-PRO-ABC123' },
} satisfies TemplateEntry
