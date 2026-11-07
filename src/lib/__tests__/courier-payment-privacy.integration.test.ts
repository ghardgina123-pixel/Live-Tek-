import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

// Opt-in disposable local database only. Never use the application's connection.
const enabled = process.env['COURIER_PRIVACY_LOCAL_TEST'] === '1';
const db = postgres({ host: '127.0.0.1', port: 55439, user: 'lovable', database: 'postgres', max: 1 });
const deliveryId = '00000000-0000-4000-8000-000000000001';
const courierUid = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!enabled)('courier payment privacy — disposable PostgreSQL', () => {
  beforeAll(async () => {
    await db.unsafe(readFileSync('src/lib/__tests__/fixtures/courier-payment-privacy.sql', 'utf8'));
    const functionPath = process.env['COURIER_PRIVACY_FUNCTION_SQL'];
    if (!functionPath) throw new Error('COURIER_PRIVACY_FUNCTION_SQL must point to the exact migration under test');
    await db.unsafe(readFileSync(functionPath, 'utf8'));
  });
  afterAll(async () => { await db.end(); });

  it('assigned courier never receives payment_method, even when it exists on the order', async () => {
    await db`select set_config('test.uid', ${courierUid}, false)`;
    await db.unsafe('SET ROLE authenticated');
    try {
      const [row] = await db`select public.courier_delivery_detail(${deliveryId}::uuid) as detail`;
      expect(row?.detail).not.toHaveProperty('payment_method');
      expect(row?.detail).toMatchObject({ delivery_id: deliveryId, courier_earning_aoa: 3500, pickup_lat: -8.8, recipient_name: 'FICTIONAL TEST RECIPIENT', items_count: 2 });
    } finally { await db.unsafe('RESET ROLE'); }
  });

  it('does not remove the customer payment method from order records', async () => {
    const [row] = await db`select payment_method from public.orders`;
    expect(row?.payment_method).toBe('PRIVATE_TEST_METHOD');
  });

  it('rejects a different courier', async () => {
    await db`select set_config('test.uid', '00000000-0000-4000-8000-000000000099', false)`;
    await db.unsafe('SET ROLE authenticated');
    try {
      await expect(db`select public.courier_delivery_detail(${deliveryId}::uuid)`).rejects.toThrow('not_authorized');
    } finally { await db.unsafe('RESET ROLE'); }
  });

  it('anonymous callers cannot execute the delivery detail RPC', async () => {
    const [row] = await db`select has_function_privilege('anon', 'public.courier_delivery_detail(uuid)', 'EXECUTE') as allowed`;
    expect(row?.allowed).toBe(false);
  });
});