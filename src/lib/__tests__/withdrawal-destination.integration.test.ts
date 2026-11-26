import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// Fixed disposable localhost endpoint. Never consumes application credentials.
const enabled = process.env['WITHDRAWAL_LOCAL_TEST'] === '1';
const db = postgres({host:'127.0.0.1',port:55442,user:'lovable',database:'postgres',max:1});
const uid = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin = uid(999);
const originalAccount = '004000000000123456789';
const nextAccount = '004000000000987654321';
type Result = {ok:boolean;reason?:string;id?:string;payout_id?:string;status?:string;min_amount_aoa?:number;max_daily_aoa?:number};
async function asUser<T>(id:string,action:()=>Promise<T>) {
 await db`select set_config('test.uid',${id},false)`;
 await db.unsafe('SET ROLE authenticated');
 try {return await action();} finally {await db.unsafe('RESET ROLE');}
}
async function seed(n:number,bank=true,amount=50000) {
 const user=uid(n),store=uid(n+1000),affiliate=uid(n+2000),courier=uid(n+3000),order=uid(n+4000);
 await db`insert into customer_fiscal_profiles values(${user},'LOCAL TEST BENEFICIARY',${`900000${n}LA001`},now(),false)`;
 await db`insert into stores values(${store},${user})`;
 if (bank) {
  await db`insert into store_private(store_id,bank_holder,bank_name,bank_account,legal_name) values(${store},'LOCAL TEST BENEFICIARY','LOCAL TEST BANK',${originalAccount},'LOCAL TEST BENEFICIARY')`;
  await db`insert into user_payment_accounts(user_id,method_type,account_holder,bank_name,account_number,is_default) values(${user},'bank_transfer','LOCAL TEST BENEFICIARY','LOCAL TEST BANK',${originalAccount},true)`;
 }
 await db`insert into ledger_entries(store_id,kind,net_aoa,delta_available,idempotency_key) values(${store},'adjustment',${amount},${amount},${`local_seed:${n}`})`;
 await db`insert into affiliate_accounts values(${affiliate},${user},true)`;
 await db`insert into affiliate_commissions(affiliate_id,amount_aoa,status) values(${affiliate},${amount},'released')`;
 await db`insert into couriers(id,user_id) values(${courier},${user})`;
 await db`insert into orders values(${order},${amount})`;
 await db`insert into deliveries values(${uid(n+5000)},${courier},${order},'delivered')`;
 return {user,store,affiliate,courier};
}
async function requestStore(user:string,store:string,amount=10000) {
 const [row]=await asUser(user,()=>db`select request_store_withdrawal(${store},${amount}) as result`);
 return row?.result as Result;
}
async function requestPayout(user:string,kind='affiliate',destination:Record<string,string>={}) {
 const [row]=await asUser(user,()=>db`select request_payout(${kind},'multicaixa_express',${db.json(destination)}) as result`);
 return row?.result as Result;
}
async function settle(id:string|undefined,status:string,note:string|null=null,actor=admin) {
 if (!id) throw new Error('Expected request ID');
 const [row]=await asUser(actor,()=>db`select admin_settle_payout(${id},${status},${note},'MANUAL-NOT-EVIDENCE') as result`);
 return row?.result as Result;
}
async function storeAction(id:string|undefined,action:string) {
 if (!id) throw new Error('Expected withdrawal ID');
 const [row]=await asUser(admin,()=>db`select admin_withdrawal_action(${id},${action},'MANUAL-NOT-EVIDENCE',null,'LOCAL TEST REJECTION') as result`);
 return row?.result as Result;
}

describe.skipIf(!enabled)('Conjunto 2 — real RPC execution in disposable PostgreSQL',()=>{
 beforeAll(async()=>{
  await db.unsafe(readFileSync('src/lib/__tests__/fixtures/withdrawal-destination.sql','utf8'));
  await db.unsafe(readFileSync('docs/finance/conjunto2-destinos-bancarios.sql','utf8'));
  await db`insert into user_roles values(${admin},'admin')`;
 });
 afterAll(async()=>{await db.end();});

 it('T1a: valid store request reserves exactly 10,000 AOA and captures its owner and bank',async()=>{
  const s=await seed(1); const r=await requestStore(s.user,s.store);
  expect(r.ok).toBe(true);
  const [w]=await db`select destination from store_withdrawals where id=${r.id ?? ''}`;
  expect(w?.destination).toMatchObject({source:'store_private',source_id:s.store,user_id:s.user,holder:'LOCAL TEST BENEFICIARY',account:originalAccount,currency:'AOA'});
  const [b]=await db`select * from ledger_balances(${s.store})`;
  expect(Number(b?.available)).toBe(40000); expect(Number(b?.reserved)).toBe(10000);
 });
 it.each(['affiliate','courier'])('T1b: valid %s request captures registered bank and reserves 50,000 AOA',async(kind)=>{
  const s=await seed(kind==='affiliate'?2:3);const r=await requestPayout(s.user,kind);
  expect(r).toMatchObject({ok:true,amount_aoa:50000,status:'pending'});
  const [w]=await db`select method,destination from payout_requests where id=${r.payout_id ?? ''}`;
  expect(w?.method).toBe('bank_transfer');expect(w?.destination).toMatchObject({user_id:s.user,account:originalAccount});
  const fn=kind==='affiliate'?'affiliate_withdrawable':'courier_withdrawable';
  const [b]=await asUser(s.user,()=>db.unsafe(`select ${fn}() as result`));
  expect(b?.result.available_aoa).toBe(0);expect(b?.result.has_open_request).toBe(true);
 });
 it.each(['store','affiliate','courier'])('T2: %s without bank is refused and no balance is reserved',async(kind)=>{
  const n={store:4,affiliate:5,courier:6}[kind];if (!n) throw new Error('Unknown test kind');
  const s=await seed(n,false);
  const r=kind==='store'?await requestStore(s.user,s.store):await requestPayout(s.user,kind);
  expect(r).toEqual({ok:false,reason:'bank_account_required'});
  const [a]=await db`select count(*)::int as total from store_withdrawals where requested_by=${s.user}`;
  const [b]=await db`select count(*)::int as total from payout_requests where user_id=${s.user}`;
  expect(a?.total).toBe(0);expect(b?.total).toBe(0);
  const [balance]=await db`select * from ledger_balances(${s.store})`;
  expect(Number(balance?.available)).toBe(50000);expect(Number(balance?.reserved)).toBe(0);
 });
 it('T2b: incomplete identity refuses a funded request',async()=>{
  const s=await seed(7);await db`update customer_fiscal_profiles set identity_locked_at=null where user_id=${s.user}`;
  expect(await requestStore(s.user,s.store)).toEqual({ok:false,reason:'identity_required'});
 });
 it('T2c: invalid IBAN cannot silently fall back to an account number',async()=>{
  const s=await seed(8);await db`update user_payment_accounts set iban='AO00000000000000000000000' where user_id=${s.user}`;
  expect(await requestPayout(s.user)).toEqual({ok:false,reason:'bank_account_invalid'});
 });
 it('T3a: changing store bank data does not alter the earlier snapshot',async()=>{
  const s=await seed(9);const r=await requestStore(s.user,s.store);
  const [before]=await db`select destination from store_withdrawals where id=${r.id ?? ''}`;
  await db`update store_private set bank_account=${nextAccount} where store_id=${s.store}`;
  const [after]=await db`select destination from store_withdrawals where id=${r.id ?? ''}`;
  expect(after?.destination).toEqual(before?.destination);expect(after?.destination.account).toBe(originalAccount);
  await expect(db`update store_withdrawals set destination=jsonb_set(destination,'{account}',${db.json(nextAccount)}) where id=${r.id ?? ''}`).rejects.toThrow('withdrawal_snapshot_immutable');
 });
 it('T3b: changing or deleting the registered user bank leaves the payout unchanged',async()=>{
  const s=await seed(10);const r=await requestPayout(s.user);
  const [before]=await db`select destination from payout_requests where id=${r.payout_id ?? ''}`;
  await db`update user_payment_accounts set account_number=${nextAccount} where user_id=${s.user}`;
  await db`delete from user_payment_accounts where user_id=${s.user}`;
  const [after]=await db`select destination from payout_requests where id=${r.payout_id ?? ''}`;
  expect(after?.destination).toEqual(before?.destination);
  await expect(db`update payout_requests set destination='{}' where id=${r.payout_id ?? ''}`).rejects.toThrow('withdrawal_snapshot_immutable');
 });
 it('T4a: ignores all client-provided beneficiary and destination data',async()=>{
  const s=await seed(11);const r=await requestPayout(s.user,'courier',{user_id:admin,holder:'FORGED',account:nextAccount});
  const [w]=await db`select destination from payout_requests where id=${r.payout_id ?? ''}`;
  expect(w?.destination.user_id).toBe(s.user);expect(w?.destination.account).toBe(originalAccount);expect(w?.destination.holder).toBe('LOCAL TEST BENEFICIARY');
 });
 it('T4b: another user cannot request a store withdrawal or read its bank snapshot',async()=>{
  const s=await seed(12);const other=await seed(13);const r=await requestStore(s.user,s.store);
  await expect(requestStore(other.user,s.store)).rejects.toThrow('not_authorized');
  expect(await asUser(other.user,()=>db`select destination from store_withdrawals where id=${r.id ?? ''}`)).toHaveLength(0);
  expect(await asUser(s.user,()=>db`select destination from store_withdrawals where id=${r.id ?? ''}`)).toHaveLength(1);
  expect(await asUser(admin,()=>db`select destination from store_withdrawals where id=${r.id ?? ''}`)).toHaveLength(1);
 });
 it('T4c: another user cannot read the payout snapshot or submit direct financial writes',async()=>{
  const s=await seed(14);const other=await seed(15);const r=await requestPayout(s.user);
  expect(await asUser(other.user,()=>db`select destination from payout_requests where id=${r.payout_id ?? ''}`)).toHaveLength(0);
  expect(await asUser(s.user,()=>db`select destination from payout_requests where id=${r.payout_id ?? ''}`)).toHaveLength(1);
  await expect(asUser(s.user,()=>db`update payout_requests set status='approved' where id=${r.payout_id ?? ''}`)).rejects.toThrow('permission denied');
 });
 it('T4d: bank holder mismatch refuses the request',async()=>{
  const s=await seed(16);await db`update user_payment_accounts set account_holder='OTHER PERSON' where user_id=${s.user}`;
  expect(await requestPayout(s.user)).toEqual({ok:false,reason:'bank_holder_mismatch'});
 });
 it('T4e: inactive affiliate and inactive courier cannot request',async()=>{
  const s=await seed(17);await db`update affiliate_accounts set is_active=false where user_id=${s.user}`;
  await db`update couriers set status='suspended' where user_id=${s.user}`;
  expect(await requestPayout(s.user)).toEqual({ok:false,reason:'beneficiary_not_eligible'});
  expect(await requestPayout(s.user,'courier')).toEqual({ok:false,reason:'beneficiary_not_eligible'});
 });
 it('T5a: affiliate approval is not payment; request remains reserved and readable as approved',async()=>{
  const s=await seed(18);const r=await requestPayout(s.user);
  expect(await settle(r.payout_id,'approved')).toEqual({ok:true,status:'approved'});
  const [b]=await asUser(s.user,()=>db`select affiliate_withdrawable() as result`);
  expect(b?.result.open_request.status).toBe('approved');expect(b?.result.available_aoa).toBe(0);
  expect(await settle(r.payout_id,'paid')).toEqual({ok:false,reason:'bank_confirmation_required'});
  expect(await settle(r.payout_id,'processing')).toEqual({ok:true,status:'processing'});
 });
 it('T5b: store approval is not payment and a manual reference cannot mark it paid',async()=>{
  const s=await seed(19);const r=await requestStore(s.user,s.store);
  expect(await storeAction(r.id,'approve')).toEqual({ok:true,status:'APPROVED'});
  expect(await storeAction(r.id,'process')).toEqual({ok:true,status:'PROCESSING'});
  expect(await storeAction(r.id,'pay')).toEqual({ok:false,reason:'bank_confirmation_required'});
  const [b]=await db`select * from ledger_balances(${s.store})`;expect(Number(b?.reserved)).toBe(10000);
 });
 it('T5c: payout self-approval and nonadmin approval are refused',async()=>{
  const s=await seed(20);await db`insert into user_roles values(${s.user},'admin')`;const r=await requestPayout(s.user);
  expect(await settle(r.payout_id,'approved',null,s.user)).toEqual({ok:false,reason:'self_approval_forbidden'});
  await expect(settle(r.payout_id,'approved',null,uid(21))).rejects.toThrow('not_authorized');
 });
 it('T5d: direct paid update is blocked even with a forged session bank flag',async()=>{
  const s=await seed(22);const r=await requestPayout(s.user);await settle(r.payout_id,'approved');await settle(r.payout_id,'processing');
  await db`select set_config('app.bank_confirmation','official',false)`;
  await expect(db`update payout_requests set status='paid' where id=${r.payout_id ?? ''}`).rejects.toThrow('bank_confirmation_required');
  const [w]=await db`select status from payout_requests where id=${r.payout_id ?? ''}`;expect(w?.status).toBe('processing');
 });
 it('T6a: rejection releases the store reservation once and preserves append-only entries',async()=>{
  const s=await seed(23);const r=await requestStore(s.user,s.store);
  expect(await storeAction(r.id,'reject')).toEqual({ok:true,status:'REJECTED'});
  await expect(storeAction(r.id,'reject')).rejects.toThrow('withdrawal_final');
  const [b]=await db`select * from ledger_balances(${s.store})`;
  expect(Number(b?.available)).toBe(50000);expect(Number(b?.reserved)).toBe(0);
  const [count]=await db`select count(*)::int as total from ledger_entries where withdrawal_id=${r.id ?? ''} and kind='withdrawal_release'`;expect(count?.total).toBe(1);
 });
 it.each(['affiliate','courier'])('T6b: %s rejection restores the existing available-balance formula',async(kind)=>{
  const s=await seed(kind==='affiliate'?24:25);const r=await requestPayout(s.user,kind);
  expect(await settle(r.payout_id,'rejected','LOCAL TEST REJECTION')).toEqual({ok:true,status:'rejected'});
  expect(await settle(r.payout_id,'rejected','LOCAL TEST REJECTION')).toMatchObject({ok:false,reason:'invalid_transition'});
  const fn=kind==='affiliate'?'affiliate_withdrawable':'courier_withdrawable';const [b]=await asUser(s.user,()=>db.unsafe(`select ${fn}() as result`));
  expect(b?.result.available_aoa).toBe(50000);expect(b?.result.has_open_request).toBe(false);
  // Known pre-existing difference retained: rejected payouts still count toward daily allowance.
  expect(b?.result.remaining_today_aoa).toBe(150000);
 });
 it('T7a: invalid transition, missing reason and missing ID return real ok:false',async()=>{
  const s=await seed(26);const r=await requestPayout(s.user);
  expect(await settle(r.payout_id,'processing')).toMatchObject({ok:false,reason:'invalid_transition',current_status:'pending'});
  expect(await settle(r.payout_id,'rejected')).toEqual({ok:false,reason:'reason_required'});
  expect(await settle(uid(888),'approved')).toEqual({ok:false,reason:'not_found'});
 });
 it('T7b: open-request rejection and no audit leakage of complete bank numbers',async()=>{
  const s=await seed(27);const r=await requestPayout(s.user);await settle(r.payout_id,'approved');
  expect(await requestPayout(s.user)).toEqual({ok:false,reason:'open_request'});
  const rows=await db`select metadata from financial_audit_log where resource_id=${r.payout_id ?? ''}`;
  expect(rows.length).toBeGreaterThan(0);expect(JSON.stringify(rows)).not.toContain(originalAccount);
 });
 it('T8a: 9,999 AOA is refused and 10,000 AOA is accepted',async()=>{
  const s=await seed(28);
  expect(await requestStore(s.user,s.store,9999)).toEqual({ok:false,reason:'below_minimum_limit',min_amount_aoa:10000});
  expect(await requestStore(s.user,s.store,10000)).toMatchObject({ok:true});
  const low=await seed(29,true,9999);expect(await requestPayout(low.user)).toMatchObject({ok:false,reason:'below_minimum_limit',min_amount_aoa:10000});
 });
 it('T8b: preserves 200,000 AOA maximum per existing beneficiary type, and Luanda day',async()=>{
  const s=await seed(30,true,250000);
  expect(await requestStore(s.user,s.store,200001)).toMatchObject({ok:false,reason:'daily_limit',max_daily_aoa:200000});
  expect(await requestStore(s.user,s.store,200000)).toMatchObject({ok:true});
  expect(await requestPayout(s.user)).toMatchObject({ok:true,amount_aoa:200000});
  expect(await requestPayout(s.user,'courier')).toMatchObject({ok:true,amount_aoa:200000});
  const [v]=await db`select min_withdrawal_aoa() as minimum,max_daily_withdrawal_aoa() as maximum,withdrawal_day_start()=(date_trunc('day',now() at time zone 'Africa/Luanda') at time zone 'Africa/Luanda') as day_ok`;
  expect(Number(v?.minimum)).toBe(10000);expect(Number(v?.maximum)).toBe(200000);expect(v?.day_ok).toBe(true);
 });
});
