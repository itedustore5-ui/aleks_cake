// R-12 (dopuna 32, invarijanta #78): baza je zatvorena i mimo aplikacije — i kad bi neko ponovo uključio
// Supabase Data API, javni „anon" ključ ne čita i ne piše ništa. Test pada i kad kasnija dopuna doda
// tabelu bez RLS-a ili pogled bez security_invoker.
import { pool, anonimno } from "./pomoc.mjs";

export const naziv = "Bezbjednost baze (R-12): RLS na svim tabelama, pogledi po pravima pitaoca, javne uloge bez pristupa";

// Pokušaj u transakciji koja se uvijek poništava — ništa ne ostaje u bazi.
async function uTransakciji(rad) {
  const k = await pool.connect();
  try {
    await k.query("begin");
    return await rad(k);
  } catch (e) {
    return { greska: e.code ?? e.message };
  } finally {
    await k.query("rollback").catch(() => undefined);
    k.release();
  }
}

export async function pokreni({ provjeri }) {
  const bezRls = (await pool.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`)).rows.map((r) => r.relname);
  provjeri("RLS uključen na SVAKOJ tabeli šeme public", bezRls.length === 0, bezRls.join(", "));

  const pogledi = (await pool.query(`
    select c.relname,
      exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
              where o like 'security_invoker=%' and split_part(o, '=', 2) in ('true', 'on', '1', 'yes')) as invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' order by 1`)).rows;
  const bezInvokera = pogledi.filter((p) => !p.invoker).map((p) => p.relname);
  provjeri(`Svaki pogled (${pogledi.length}) računa prava onoga ko pita (security_invoker)`, pogledi.length > 0 && bezInvokera.length === 0, bezInvokera.join(", "));

  // Aplikacija i dalje vidi sve: isto kao /api/zdravlje (tabeleBezPristupa u server/db.ts).
  const z = await anonimno()("/zdravlje");
  provjeri("Aplikacija vidi svoje tabele — zdravlje 200, baza „ok“", z.status === 200 && z.tijelo.baza === "ok", JSON.stringify(z.tijelo));
  const korisnika = (await pool.query(`select count(*)::int as n from korisnik`)).rows[0].n;
  provjeri("…korisnik baze iz aplikacije čita naloge (vlasnik tabela nije ograničen RLS-om)", korisnika >= 5, String(korisnika));

  const imaAnon = (await pool.query(`select 1 from pg_roles where rolname = 'anon'`)).rows.length > 0;
  if (!imaAnon) {
    console.log("    · preskočeno: baza nema ulogu anon (nije Supabase ni test baza)");
    return;
  }

  const sPravom = (await pool.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))
    order by 1`)).rows.map((r) => r.relname);
  provjeri("anon i authenticated nemaju pravo ni na jednu tabelu ili pogled", sPravom.length === 0, sPravom.join(", "));

  // Pravi pokušaj kao anon traži da korisnik baze smije „set role anon“ (superuser, ili član uloge kao
  // postgres na Supabase-u). Inače bi 42501 došao od samog set role — lažno „odbijeno“.
  const smijeAnon = (await pool.query(`select pg_has_role(current_user, 'anon', 'MEMBER') as da`)).rows[0].da;
  if (!smijeAnon) {
    console.log("    · preskočeno: korisnik baze ne smije glumiti anon — pokušaji čitanja/upisa kao anon nisu provjereni");
  } else {
    await pokusajiKaoAnon(provjeri);
  }

  // Nova tabela (buduća dopuna) ne dobija automatski prava za javne uloge — Supabase ih inače daje.
  const nova = await uTransakciji(async (k) => {
    await k.query("create table public.e2e_rls_proba (x int)");
    return (await k.query(`select has_table_privilege('anon', 'public.e2e_rls_proba', 'select') as anon,
      has_table_privilege('authenticated', 'public.e2e_rls_proba', 'select') as auth`)).rows[0];
  });
  provjeri("Nova tabela ne dobija prava za anon/authenticated sama od sebe", nova.anon === false && nova.auth === false, JSON.stringify(nova));
}

async function pokusajiKaoAnon(provjeri) {
  const citanje = await uTransakciji(async (k) => {
    await k.query("set local role anon");
    return (await k.query("select lozinka_hash from korisnik limit 1")).rows;
  });
  provjeri("anon ne čita naloge (heševe lozinki) — odbijeno", citanje.greska === "42501", JSON.stringify(citanje));
  const pogled = await uTransakciji(async (k) => {
    await k.query("set local role anon");
    return (await k.query("select * from v_lica limit 1")).rows;
  });
  provjeri("anon ne čita ni kroz pogled — odbijeno", pogled.greska === "42501", JSON.stringify(pogled));
  const upis = await uTransakciji(async (k) => {
    await k.query("set local role anon");
    return (await k.query(`update firma set naziv = naziv`)).rowCount;
  });
  provjeri("anon ne mijenja podatke — odbijeno", upis.greska === "42501", JSON.stringify(upis));

  // Druga brava: i kad bi neko ponovo dao pravo čitanja, RLS bez politika ne pušta nijedan red.
  const posleGranta = await uTransakciji(async (k) => {
    await k.query("grant select on korisnik to anon");
    await k.query("set local role anon");
    return (await k.query("select count(*)::int as n from korisnik")).rows[0].n;
  });
  provjeri("I sa vraćenim pravom čitanja, RLS ne pušta nijedan nalog", posleGranta === 0, JSON.stringify(posleGranta));
}
