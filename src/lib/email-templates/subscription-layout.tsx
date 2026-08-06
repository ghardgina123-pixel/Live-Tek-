import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export interface SubscriptionEmailProps {
  storeName?: string
  planName?: string
  amountAoa?: number
  reference?: string | null
  expiresAt?: string | null
  invoiceNumber?: string | null
}

export const money = (n?: number) =>
  `Kz ${Number(n || 0).toLocaleString('pt-AO', { maximumFractionDigits: 0 })}`

export const dateFmt = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('pt-AO') : '—'

export function SubscriptionShell({
  preview,
  heading,
  intro,
  rows,
  ctaLabel,
  ctaUrl,
  outro,
}: {
  preview: string
  heading: string
  intro: string
  rows: Array<[string, string]>
  ctaLabel: string
  ctaUrl: string
  outro?: string
}) {
  return (
    <Html lang="pt" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={banner}>
            <Text style={brand}>Live Teká</Text>
            <Text style={tagline}>A plataforma de vendas em tempo real</Text>
          </Section>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{intro}</Text>
          <Section style={card}>
            {rows.map(([label, value]) => (
              <Text key={label} style={row}>
                <strong>{label}:</strong> {value}
              </Text>
            ))}
          </Section>
          <Button style={button} href={ctaUrl}>
            {ctaLabel}
          </Button>
          {outro ? <Text style={text}>{outro}</Text> : null}
          <Hr style={hr} />
          <Text style={footer}>
            Recebeu este e-mail porque tem uma loja parceira na Live Teká.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const banner = { backgroundColor: '#047857', borderRadius: '12px', padding: '18px 20px' }
const brand = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold', margin: '0' }
const tagline = { color: '#d1fae5', fontSize: '12px', margin: '4px 0 0' }
const h1 = { fontSize: '20px', color: '#111827', margin: '24px 0 8px' }
const text = { fontSize: '14px', lineHeight: '22px', color: '#374151' }
const card = {
  backgroundColor: '#f0fdf4',
  borderRadius: '12px',
  padding: '14px 16px',
  margin: '16px 0',
}
const row = { fontSize: '13px', color: '#065f46', margin: '4px 0' }
const button = {
  backgroundColor: '#047857',
  color: '#ffffff',
  borderRadius: '10px',
  padding: '12px 20px',
  fontSize: '14px',
  fontWeight: 'bold',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#e5e7eb', margin: '24px 0 12px' }
const footer = { fontSize: '11px', color: '#6b7280' }
