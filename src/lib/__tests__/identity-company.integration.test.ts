import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// Only explicitly enabled disposable localhost database; never use project credentials.
const enabled = process.env['IDENTITY_LOCAL_TEST'] === '1';
const db = postgres({ host: '127.0.0.1', port: 55440, user: 'postgres', database: 'postgres', max: 1 });
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function asUser<T>(id: string, action: () => Promise<T>) {
  await db`select set_config('test.uid',${id},false)`;
  await db.unsafe('SET ROLE authenticated');
  try { return await action(); } finally { await db.unsafe('RESET ROLE'); }
}
async function signup(n: number, bi: string, companyNif: string) {
  await db`insert into auth.users(id,email,raw_user_meta_data) values(${uid(n)},${`test-${n}@example.invalid`},${db.json({ display_name: 'LOCAL TEST PERSON', bi_number: bi, company_nif: companyNif })})`;
  return (await db`select bi_number,company_nif,nif from public.customer_fiscal_profiles where user_id=${uid(n)}`)[0];
}

describe.skipIf(!enabled)('BI identity and optional company NIF — isolated PostgreSQL', () => {
  beforeAll(async () => {
    await db.unsafe(readFileSync('src/lib/__tests__/fixtures/identity-company.sql','utf8'));
    await db.unsafe(readFileSync('drizzle/migrations/0011_identity_unique_nif_bi.sql','utf8'));
    await db`insert into auth.users values(${uid(90)},${db.json({ display_name: 'LEGACY TEST PERSON', nif: '5000000090', bi_number: '900000090LA090' })},'legacy@example.invalid')`;
    const path = process.env['IDENTITY_CORRECTION_SQL'];
    if (!path) throw new Error('IDENTITY_CORRECTION_SQL must name the exact correction migration');
    await db.unsafe(readFileSync(path,'utf8'));
  });
  afterAll(async () => { await db.end(); });

  it('preserves existing fiscal NIF and never reclassifies it as company NIF', async () => {
    const [row] = await db`select nif,bi_number,company_nif from public.customer_fiscal_profiles where user_id=${uid(90)}`;
    expect(row).toMatchObject({ nif:'5000000090',bi_number:'900000090LA090',company_nif:null });
  });
  it('signup accepts BI and no company', async () => {
    expect(await signup(1,'900000001LA001','')).toMatchObject({bi_number:'900000001LA001',company_nif:null,nif:null});
  });
  it('signup accepts the same number for BI and company NIF', async () => {
    expect(await signup(2,'900000002LA002','900000002LA002')).toMatchObject({bi_number:'900000002LA002',company_nif:'900000002LA002',nif:null});
  });
  it('signup accepts different BI and company NIF', async () => {
    expect(await signup(3,'900000003LA003','5000000001')).toMatchObject({bi_number:'900000003LA003',company_nif:'5000000001'});
  });
  it('different people may represent the same company', async () => {
    expect(await signup(4,'900000004LA004','5000000001')).toMatchObject({bi_number:'900000004LA004',company_nif:'5000000001'});
    const [row] = await db`select count(*)::int as total from public.customer_fiscal_profiles where company_nif='5000000001'`;
    expect(row?.total).toBe(2);
  });
  it('duplicate normalized BI refuses another signup regardless of company', async () => {
    await expect(signup(5,'900 000 001-la001','5000000005')).rejects.toThrow('identity_already_registered');
  });
  it('BI is mandatory even with a company NIF', async () => {
    await expect(signup(6,'','5000000006')).rejects.toThrow('identity_invalid');
  });
  it('availability ignores shared NIF but detects duplicate BI', async () => {
    const [r] = await db`select public.identity_availability('5000000001','900000007LA007') as available, public.identity_availability('','900000001LA001') as taken`;
    expect(r).toMatchObject({available:'available',taken:'taken'});
  });
  it.each([['', '900000011LA011', 11],['900000012LA012','900000012LA012',12],['5000000001','900000013LA013',13]] as const)('guarded completion accepts company NIF %s',async(nif,bi,n) => {
    const [r] = await asUser(uid(n),() => db`select public.register_my_identity('LOCAL TEST PERSON',${nif},${bi}) as result`);
    expect(r?.result).toEqual({ok:true});
    const [status] = await asUser(uid(n),() => db`select public.my_identity_status() as result`);
    expect(status?.result).toMatchObject({registered:true,bi_masked:`•••${bi.slice(-3)}`});
    expect(status?.result.company_nif_masked).toBe(nif ? `•••${nif.slice(-3)}` : null);
  });
  it('completion rejects another person with the same BI',async() => {
    const [r] = await asUser(uid(14),() => db`select public.register_my_identity('LOCAL TEST PERSON','5000000014','900000011LA011') as result`);
    expect(r?.result).toEqual({ok:false,error:'identity_already_registered'});
  });
  it('direct identity edits are refused and another identity is hidden by RLS',async() => {
    await asUser(uid(1),async() => {
      await expect(db`update public.customer_fiscal_profiles set company_nif='5000000088' where user_id=${uid(1)}`).rejects.toThrow('identity_locked');
      const rows = await db`select * from public.customer_fiscal_profiles where user_id=${uid(2)}`;
      expect(rows).toHaveLength(0);
    });
  });
  it('same owner may register three stores with shared company NIF',async() => {
    await asUser(uid(1),async() => {
      for (const n of [21,22,23]) await db`insert into public.stores(id,owner_id,name,nif) values(${uid(n)},${uid(1)},'LOCAL TEST STORE','5000000001')`;
      const rows = await db`select owner_id from public.stores`;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.owner_id===uid(1))).toBe(true);
    });
  });
  it('other owner cannot read private stores, edit them or create a store for someone else',async() => {
    await asUser(uid(2),async() => {
      expect(await db`select * from public.stores where owner_id=${uid(1)}`).toHaveLength(0);
      const changed = await db`update public.stores set name='FORBIDDEN' where owner_id=${uid(1)} returning id`;
      expect(changed).toHaveLength(0);
      await expect(db`insert into public.stores(id,owner_id,name) values(${uid(24)},${uid(1)},'FORBIDDEN')`).rejects.toThrow('row-level security');
    });
  });
  it('nonadmin cannot correct identities and anonymous cannot execute completion',async() => {
    const [r] = await asUser(uid(1),() => db`select public.admin_correct_identity(${uid(2)},'','900000002LA002','LOCAL TEST REASON') as result`);
    expect(r?.result).toEqual({ok:false,error:'forbidden'});
    const [permission] = await db`select has_function_privilege('anon','public.register_my_identity(text,text,text)','EXECUTE') as allowed`;
    expect(permission?.allowed).toBe(false);
  });
  it('BI uniqueness cannot be bypassed by conflict marker',async() => {
    await expect(db`insert into public.customer_fiscal_profiles(user_id,bi_number,identity_conflict) values(${uid(30)},'900000001LA001',true)`).rejects.toThrow('ux_cfp_bi_identity');
  });
});