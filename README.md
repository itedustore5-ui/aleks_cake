# PILOT DISTRIBUTERI CG

Aplikacija za dobru higijensku praksu i HACCP kod distributera hrane u Crnoj Gori — prijem robe,
LOT i sledljivost, zalihe, HACCP kontrole, neusaglašenosti i korektivne mjere, isporuka kupcu,
vozila, ljudi (sanitarne knjižice, plan obuke), izvoz podataka i štampani prilozi.

Ne prodaje se softver — prodaje se odgovor na pitanje *„serija je sporna, kojim kupcima je
otišla?"* i dokaz da zapisi nastaju svakog dana, ne noć prije inspekcije. Pravni okvir i sve
poslovne odluke ove aplikacije su detaljno obrazložene u [CLAUDE.md](CLAUDE.md) — pročitajte ga
prije bilo koje izmjene koda.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, React Router, obično `fetch` (bez dodatnih
  data-fetching biblioteka).
- **Backend**: Node.js + Express 5 + TypeScript, `pg` (node-postgres) sa ručno pisanim
  parametrizovanim SQL-om (bez ORM-a — jednostavnije za održavanje na ovoj skali), Zod za
  validaciju.
- **Baza**: PostgreSQL na [Supabase](https://supabase.com) — **jedna baza po klijentu**.
- **Deploy**: [Render](https://render.com) — jedan web servis po klijentu.

## Pravilo koje se ne krši

**Jedan klijent = jedna baza = jedan Render servis.** Aplikacija ne sprovodi izolaciju
više klijenata u istoj bazi. Ne dijeliti bazu između klijenata.

---

## Pokretanje lokalno

```bash
npm install
cp .env.example .env      # popuniti DATABASE_URL
npm run migriraj          # kreira šemu (fajlovi db/01_*.sql ... db/21_*.sql)
npm run seed:demo         # OPCIONO: dodaje demo podatke i demo naloge (SAMO za demo bazu)
npm run dev                # http://localhost:5000
```

### Environment (`.env`)

Vidi [`.env.example`](.env.example). Najvažnije:

- `DATABASE_URL` — Supabase **Session pooler**, port **5432**. Direct connection radi samo
  preko IPv6 i Render ga ne dohvata — ako se koristi, aplikacija se neće moći povezati u
  produkciji.
- `NODE_ENV` — `development` lokalno, `production` na Renderu.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_KORISNIK`, `SMTP_LOZINKA`, `SMTP_POSILJALAC` — samo za slanje „Stanja poslovanja“
  direktoru mejlom (vidi niže). Bez njih aplikacija radi, a izvještaj se preuzima i šalje kao prilog.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — **nisu potrebni**. Ključ za push
  obavještenja server pravi sam pri prvom pokretanju i čuva ga u bazi klijenta (`web_push_kljuc`);
  kontakt je javna adresa servisa na Renderu (`RENDER_EXTERNAL_URL`, Render ga sam postavlja).

Nema `SESSION_SECRET` ni `ADMIN_TOKEN` — sesije su nasumični 256-bitni tokeni; u bazi
(`sesija_prijave`, `db/20_sesije_prijave_cg.sql`) stoji samo njihov sha256 heš, pa deploy i restart
nikoga ne odjavljuju. Promjena lozinke odjavljuje sve ostale uređaje; promjena uloge i
deaktivacija odjavljuju sve. Server tabelu sesija pravi i sam pri pokretanju ako je nema, da
deploy prije dopune 20 ne zaključa korisnike van aplikacije. Nema HTTP admin-rute koja bi trebalo zaglavlje sa
tokenom (za razliku od ranije verzije aplikacije). Sve administrativne operacije idu preko
`alati/*` skripti koje se povezuju direktno na bazu.

### Migracije

`npm run migriraj` primjenjuje SQL fajlove iz `db/` po redu (`01_organizacija.sql` →
`33_talas5_cg.sql`), i pamti šta je već primijenjeno u tabeli `schema_migracije` —
bezbjedno je pokrenuti ga više puta. `db/13_demo_cg.sql` se primjenjuje samo sa `--demo`
(odnosno `npm run seed:demo`), i **nikad na bazi pravog klijenta**. Fajlovi poslije 13
(`14_povlacenje.sql`, `15_isporuka_uneo_cg.sql`, `16_bekap_cg.sql`, `17_naknadno_cg.sql`, `18_temperatura_predaje_cg.sql`, `19_skladista_poruke_cg.sql`, `20_sesije_prijave_cg.sql`, `21_pitanja_firme_cg.sql`, `22_integritet_cg.sql`, `23_otpremnice_cg.sql`, `24_haccp_sistem_cg.sql`, `25_push_cg.sql`, `26_talas1_cg.sql`, `27_talas2_cg.sql`, `28_talas3_otkaz_cg.sql`, `29_talas3_cg.sql`, `30_bekap_bez_tajni_cg.sql`, `31_magacin_mjerenja_cg.sql`, `32_bezbjednost_baze_cg.sql`, `33_talas5_cg.sql`) su dodati naknadno namjerno —
brojevi fajlova prate redoslijed kad su nastali, ne semantičku grupu; runner demo fajl uvijek
tretira posebno bez obzira na njegov broj.

Redoslijed fajlova nije proizvoljan — svaki sljedeći pretpostavlja da prethodni postoji
(FK reference, `alter table` na postojeće tabele). Ne mijenjati redoslijed.

### Demo nalozi

Poslije `npm run seed:demo`, ispisuju se korisnička imena i lozinke u terminalu (samo tada — poslije
se ne mogu ponovo prikazati). Podrazumijevano:

| Uloga | Korisničko ime |
|---|---|
| Konsultant (izvođač) | `konsultant` |
| Odgovorno lice (bzr) | `ana.b` |
| Magacioner (operater) | `marko.v` |
| Vozač | `petar.j` |
| Uprava | `direktor` |

---

## Build i produkcija

```bash
npm run build     # tsc -b && vite build -> dist/
npm start         # NODE_ENV=production tsx server/index.ts, servira dist/
```

`npm run typecheck` provjerava i `tsconfig.app.json` (frontend) i `tsconfig.server.json`
(backend) — pokrenuti prije svakog puša.

---

## Deploy na Render — nova instanca za novog klijenta

Svaki klijent dobija **svoj** Supabase projekat i **svoj** Render web servis, sa istim kodom.

1. **Supabase**: napraviti novi projekat (region u EU, npr. Frankfurt). **Odmah** Project Settings →
   Data API → isključiti (R-12). Iz **Connect** uzeti **Session pooler** (port 5432), ne Direct
   connection. Besplatni plan: najviše 2 aktivna projekta na nalogu (demo + jedan klijent), 500 MB po
   bazi — preko toga baza prelazi u „samo čitanje“ i aplikacija ne prima upise; pauza posle 7 dana bez
   rada. Najviše prostora troše fotografije otpremnica (čuvaju se u bazi). `npm run dnevni-pregled`
   javlja veličinu svake baze i upozorava na 400 MB.
2. **Render**: novi Web Service iz ovog repozitorijuma.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment: `DATABASE_URL` (iz koraka 1), `NODE_ENV=production`; za mejl direktoru i `SMTP_*` (vidi „Stanje poslovanja“)
   - Plaćeni plan (Starter) — besplatni spava poslije 15 min neaktivnosti (prvi zahtjev čeka ~1 min),
     ima 0,1 procesora (čitanje fotografija otpremnica je presporo), a 750 besplatnih sati mjesečno važi
     za CIJELI Render nalog: jedan budan servis ih troši sam — dva besplatna servisa (npr. demo i klijent)
     ostaju bez sati sredinom mjeseca i Render ih oba gasi do 1. u mjesecu.
3. Server pri prvom pokretanju sam napravi sve tabele (dopune baze, #79). Zatim, sa svog računara
   (PowerShell), prvi nalozi u NOVOJ bazi — odgovorno lice i vaš konsultantski nalog:
   ```powershell
   $env:DATABASE_URL="<adresa NOVE baze>"; npm run prvi-korisnik -- --firma "Naziv d.o.o." --ime "Ime Prezime" --korisnik ime.prezime --konsultant vase.ime
   ```
   Alat prvo ispiše u koju bazu upisuje i **odbija bazu koja već ima odgovorno lice ili konsultanta**
   (npr. demo iz `.env` kad se zaboravi adresa nove baze). Obje lozinke su privremene i ispišu se
   jednom. Konsultantski nalog treba: samo on otvara nalog direktoru (`uprava`), upisuje adresu i PIB
   firme (Podešavanje) i dobija obavještenje kad odgovorno lice samo zatvori neusaglašenost („bez četiri
   oka“). Bez njega: izostaviti `--konsultant` (može se dodati i kasnije: samo `--konsultant vase.ime`).
   Odgovorno lice u `/moja` mijenja lozinku i u `/ljudi` otvara naloge magacioneru i vozaču. Alat pravi i kontrolne
   tačke KKT 1–3 — bez njih se temperatura na prijemu i predaji ne ocjenjuje.
   **Podaci firme iz upitnika:** distributer popuni `upitnik-start/Upitnik-za-pocetak.html` i pošalje fajl, a vi:
   ```powershell
   $env:DATABASE_URL="<adresa NOVE baze>"; npm run uvoz-start -- --fajl pilot-start-<firma>-<datum>.json
   ```
   pokaže šta bi upisao (ništa ne upiše); ako je u redu — ista komanda sa `--upisi`. Zaposleni, magacini, vozila,
   dobavljači, kupci, artikli (granice NEpotvrđene — potvrditi u Šifarnicima) i termometri; nalozi, komore i kalibracije
   ostaju za aplikaciju (alat ih ispiše).
4. Dodati klijenta u `alati/klijenti.txt` (nije u gitu — ostaje samo na vašem računaru):
   ```
   Naziv klijenta = postgresql://...
   ```
5. Provjera da je deploy stvarno prošao: `GET /api/zdravlje` vraća `{ ok: true, izdanje: "abc1234" }` —
   izdanje je commit koji Render stvarno pokreće (`RENDER_GIT_COMMIT`), i piše i u dnu menija.
   Uporediti sa `git log -1 --format=%h`. Lokalno piše „lokalno".

### Demo instalacija

Demo baza (za prodajne sastanke) se pravi na isti način, ali sa `npm run seed:demo` umjesto
`prvi-korisnik`. Demo se nikad ne koristi za pravi rad klijenta, niti obrnuto.

---

## Alati (`alati/`) — pokreću se sa računara konsultantkinje, ne sa servera

| Alat | Šta radi |
|---|---|
| `npm run prvi-korisnik -- --firma "..." --ime "..." --korisnik ... [--konsultant ...]` | Prvi nalozi u novoj bazi: odgovorno lice (`bzr`) i konsultant (`izvodjac`), jedna transakcija, audit, privremene lozinke. Ispiše u koju bazu upisuje i odbija bazu koja već ima odgovorno lice ili konsultanta. Samo `--konsultant ...` — konsultantski nalog u bazi koja već ima odgovorno lice. |
| `npm run uvoz-start -- --fajl … [--upisi]` | Upitnik za početak (`upitnik-start/`) u bazu novog klijenta, posle `prvi-korisnik`. Bez `--upisi` samo pokaže šta bi uradio. Postojeće preskače (može se ponoviti), odbija demo bazu, kupca bez telefona i artikal bez granice; granice ostaju nepotvrđene; naloge ne otvara. |
| `npm run dnevni-pregled` | Stanje SVIH klijenata iz `alati/klijenti.txt` u jednom ispisu (poslednji unos, otvorene neusaglašenosti, **veličina baze i koliko su otpremnice**, greške servera i ekrana u 24 h, neprimijenjene dopune baze, vodstvo bez potvrde u dva koraka). Izlazni kod `1` ako je neko u zastoju (>2 dana bez unosa) ili mu je baza ≥ 400 MB (`BAZA_UPOZORENJE_MB=` za klijente na plaćenom planu; `KLIJENTI_FAJL=` drugi spisak) — pogodno za Task Scheduler + mejl na grešku. |
| `npm run demo-lozinke` | Nove lozinke za pet demo naloga — SAMO na demo bazi (provjeri fiksne ID-jeve); upiše ih u `.env` (`DEMO_LOZINKA_*`, za `test:e2e`) i ispiše jednom. |
| `npm run iskljuci-2fa -- --korisnik ime` | Isključuje potvrdu u dva koraka nalogu koji je izgubio telefon i rezervne kodove; prekida njegove prijave, upisuje se u audit. |
| `npm run zakazi-bekap` | Upisuje `npm run bekap` u Windows Task Scheduler (svaki dan u 13:00, i čim se računar upali ako je tada bio ugašen). `-Vrijeme 09:30`, `-Ukloni`. |
| `npm run demo:lokalno` | Aplikacija na LOKALNOJ probnoj bazi sa demo podacima (http://localhost:5059) — da se ekrani proklikaju bez diranja žive baze. |
| `node alati/napravi-licencu.ts "Naziv klijenta"` | Administrativni licencni ključ za ugovor (aplikacija ga ne provjerava — to je papirni trag, ne tehnička brava). |
| `npm run bekap` | `pg_dump` svake baze iz `alati/klijenti.txt` (ili, bez tog fajla, baze iz `DATABASE_URL`) u `bekap/<klijent>/`. Samo šema `public`, bez podataka sesija prijave. Svaki fajl se odmah provjeri (`pg_restore --list`); stariji od 90 dana se brišu; ishod u `bekap/POSLJEDNJI-BEKAP.txt`; izlazni kod `1` ako ijedan klijent padne. Traži PostgreSQL alate iste ili novije verzije od servera (uzima najnoviji iz `C:\Program Files\PostgreSQL`, ili `PG_DUMP=` / `PG_RESTORE=`). |

`alati/klijenti.txt` (format `Naziv = postgresql://...`, po jedan red) sadrži lozinke baza — u
`.gitignore` je i mora tu i ostati.

**Bekap van baze** pravi `npm run bekap`, ali **ne pokreće se sam** dok nije u Task Scheduleru —
jednom pokrenuti `npm run zakazi-bekap` (svaki dan u 13:00; ako je računar tada ugašen, čim se upali).
Fajlovi su u `bekap\<klijent>\`, ishod u `bekap\POSLJEDNJI-BEKAP.txt`. Folder `bekap` povremeno
kopirati i van računara (spoljni disk, šifrovan oblak) — u njemu su svi podaci klijenata.

**Vraćanje** — uvijek u NOVU, praznu bazu, nikad preko žive:

```bash
pg_restore --no-owner --no-privileges --dbname "<adresa nove baze>" bekap/<klijent>/<fajl>.dump
```

Pa `npm run migriraj` na toj bazi (preskače već primijenjeno) i provjera jednog lota na
`/sledljivost`. Vraćanje probati bar jednom prije nego što zatreba.

---

## Arhitektura

```
db/                    SQL šema (01-12) + demo podaci (13) + migracioni runner
server/
  index.ts             bootstrap: Express, CSRF zaglavlje, javne rute → GRANICA PRIJAVE → ostale rute,
                        Vite (dev) / static (prod), provjera ruta pri startu
  provjeraRuta.ts      javniRuter() i provjeriRute(): ruta bez uloga ili ruter sa .use → server ne kreće
  db.ts                pg Pool, transakcije, provjera postojanja pogleda/tabele
  auth.ts              sesije, uloge (requireUloga, sviPrijavljeni), PROZOR, CSRF
  lozinke.ts           scrypt heš, provjera dužine
  vrijeme.ts           datum po podgoričkom vremenu (Europe/Podgorica), ne UTC
  validacija.ts        Zod helper
  greske.ts            konzistentan format greške { error: { code, message, details } }
  services/            SQL i poslovna pravila: haccp (evaluacija pravila), prijem, isporuka, zaliha,
                        neusaglašenosti, vozila, sledljivost, izvoz, audit, zadaci, poruke, tabla,
                        ljudi, provjera znanja, push, inspekcijski paket, stanje poslovanja (izvještaj direktoru)
  zip.ts               ZIP arhiva bez spoljne biblioteke (Node zlib: deflate + crc32)
  routes/               REST rute po modulu, montirane pod /api — šema, uloga, poziv servisa, odgovor
src/
  pages/               po jedna strana po ulozi/modulu (Tabla, Ljudi, Prijem, Zalihe, HACCP,
                        Neusaglašenosti, Vozila, Isporuka, Moja, Sledljivost, Prilozi,
                        Izvještaji, StanjePoslovanja, Inspekcija, Audit, ProvjeraZnanja, Admin)
  components/          Layout (sidebar+topbar), StatusBadge, Modal, StatCard
  lib/                 api.ts (fetch wrapper + CSRF zaglavlje), auth.tsx (AuthContext)
public/obrasci-cg.json definicija dnevnih obrazaca (P3–P10) — nov obrazac se dodaje ovdje; čitaju je
                        i pregledač i server (koji odgovor je odstupanje: `odstupanjeAko`, obavezan tekst: `obavezno`)
public/sw.js           service worker: push obavještenja i rad bez interneta — čuva sve fajlove aplikacije
                        (spisak pravi gradnja: vite.offline.ts → dist/offline-spisak.json) i posljednje GET /api odgovore
src/lib/izlaz.ts       red upisa sa terena koji čekaju mrežu (D1, predaja, mjerenje, dnevni zapis, prijava problema)
public/manifest.webmanifest  aplikacija na početnom ekranu telefona (ikone ikona-192/512.png)
testovi/               E2E testovi; izolovano.mjs pravi sopstvenu test bazu (npm test)
.github/workflows/     testovi na svaki push (GitHub Actions)
alati/                 CLI skripte, pokreću se sa računara konsultantkinje
```

### Pet uloga (ne deset)

| Uloga | Za koga | Vidi |
|---|---|---|
| `bzr` | Odgovorno lice za bezbjednost hrane | sve u firmi — prva strana poslije prijave je `/tabla` |
| `operater` | Magacioner | prijem, zalihe, HACCP, isporuka — samo poslednji 1 dan, samo svoje unose i isporuke koje je sam spremio |
| `vozac` | Vozač | vozila (D1 — vidi samo vozač), isporuka — samo poslednji 1 dan, samo dodijeljene; on potvrđuje predaju |
| `uprava` | Direktor | svoj Kontrolni centar (semafor, četiri broja, zapisi po danu), Za inspekciju, poruke — bez unosa |
| `izvodjac` | Konsultant | sve + banka pitanja za provjeru znanja + podešavanje firme (`/admin`) + Izvještaji (izvoz) i Stanje poslovanja — samo on |

Dozvole se provjeravaju **na serveru** (`server/auth.ts` → `requireUloga`, `ogranicenjeDatuma`,
`samoMoje`, `izvrsilacZa`) — frontend meni samo krije stavke, ne štiti ništa.

### Poslovni tok

```
Dobavljač → Prijem → LOT (obavezan broj lota) → odluka (PRIHVATI / HOLD / ODBIJI)
  → Zaliha (FEFO) → Isporuka (vezana za LOT, kupac mora imati telefon) → Kupac

LOT na HOLD-u (karantin) → bzr: PUSTI (razlog obavezan) → zaliha, ili ODBIJ → otpis
  (ne pušta se dok je povlačenje u toku)

Prijem robe pod temperaturnim režimom → temperatura OBAVEZNA (KKT 1)

HACCP mjerenje → evaluacija protiv pravila iz baze (PASS/WARNING/FAIL)
  → FAIL: Neusaglašenost + Zadatak + Obavještenje bzr-u + LOT na HOLD
  → artikal sa NEPOTVRĐENOM granicom: samo WARNING i obavještenje bzr-u, bez HOLD-a
  Granica artikla se unosi u Šifarnicima → postaje pravilo KKT 1 i KKT 3 (jedan izvor)

Odstupanje u dnevnom obrascu → Neusaglašenost „čeka provjeru" + Zadatak + Obavještenje bzr-u
Neusaglašenost se zatvara samo uz urađenu mjeru i samo tuđom provjerom
  (izuzetak: firma sa JEDNIM odgovornim licem — označeno, obrazloženo, konsultant obaviješten)

Plan monitoringa (šta, koliko često, ko) → „Danas po planu" na Mojoj strani,
  „Danas fali po planu · juče propušteno" na Kontrolnom centru
Termometar ne prođe provjeru → Neusaglašenost + Zadatak + upozorenje na HACCP strani;
  mjerenja njime od posljednje dobre provjere su „upitna", a njime se više ne mjeri
Mjerenje (prijem, magacin, predaja) pamti termometar; lot se ocjenjuje po granici SVOG artikla

D1 prije utovara: čistoća, oprema, vrata + temperatura po granici vozila (rashladno vozilo)
  → pala → vozilo NIJE SPREMNO + Neusaglašenost; „spremno" važi samo za dan kontrole
Roba pod temperaturnim režimom ide samo rashladnim vozilom; predaja traži današnju D1

Dnevni obrazac: odstupanje slijedi iz odgovora („tragovi štetočina: da"), ne samo iz kvačice
  Ispravka: nov zapis, jednom, istog obrasca; terenska uloga samo svoj
Neusaglašenost iz kontrole (mjerenje, D1, termometar) se zatvara tek kad ponovna kontrola prođe;
  iz povlačenja — tek kad je povlačenje završeno. „Riješeno je“ = mjera + provjera u jednom upisu

Priprema isporuke drži robu (rezervacija): slobodno = na zalihi − isporuke u pripremi
  → otkaz isporuke (uz razlog) robu oslobađa; otpis ispod rezervisanog javlja ko je spremio
Prijem: rok trajanja obavezan (osim artikla izuzetog u Šifarnicima); ista serija jednom po prijemu;
  ista serija ranije primljena sa drugim rokom → upozorenje odgovornom licu
Povlačenje → cijela SERIJA (isti dobavljač, artikal, broj lota kroz sve prijeme)
Predaja kupcu → server PONOVO provjerava lot (prihvaćen, rok nije istekao) i zalihu
  → nepredato i odbijeno → KARANTIN → bzr: vrati u prodaju ili otpiši (Zalihe)
Lot pređe na HOLD (mjerenje van granice, povlačenje) → isporuke u pripremi sa njim:
  „Ne predajte lot" vozaču i onome ko je spremio
Istekao rok na zalihi → ne isporučuje se; kartica „Rok robe" na Kontrolnom centru;
  bzr dobija obavještenje jednom po lotu

Svaka kritična odluka piše u audit_log (imutabilan; dogadjaj se od faze 4 ne puni).
```

Sledljivost unazad i unaprijed (`/sledljivost`) čita iz pogleda `v_sledljivost_naprijed` /
`v_sledljivost_nazad` definisanih u `db/12_pogledi.sql`.

### Izmjena i uklanjanje

Ništa se ne briše iz baze kroz aplikaciju. Umjesto toga:

- **Ljudi** (`/ljudi`): "Izmijeni" mijenja podatke o licu; "Ukloni" postavlja `aktivan = false`
  (lice ostaje u istoriji zapisa, samo nestaje sa aktivnog spiska; "Vrati" ga reaktivira).
- **Prijem** (`/prijem`): stavka se može ispraviti ("Izmijeni") **samo dok lot čeka odluku**
  (status `PRIMLJEN`) — čim je prihvaćen/na čekanju/odbijen, brojke su već uticale na zalihu i
  ispravka ide kroz novi zapis, ne kroz prepravku ove stavke.
- **Isporuka** (`/isporuka`): cijela isporuka (kupac, vozilo, datum, stavke — dodavanje/uklanjanje/
  promjena količine) se može izmijeniti **samo dok je U_PRIPREMI** — čim je potvrđena, zaliha je
  već umanjena. Dok je u pripremi može se i **otkazati** („Otkaži“, uz razlog) — ostaje zapisana kao
  otkazana, a roba koju je držala je opet slobodna. Kupac koji odbije robu na vratima nije otkaz:
  to je potvrda sa 0 i razlogom (roba ide u karantin).
- **Otpremnica** (`/isporuka` → „Otpremnica“): stranica za štampu koja ide uz robu — firma, kupac sa
  PIB-om i adresom isporuke, vozilo i vozač, za svaku stavku lot, rok, planirano / predato / odbijeno i
  temperatura pri predaji, mjesta za potpis. Prateći list sledljivosti, **nije fiskalni dokument**. Na
  papiru piše kad je isporuka posljednji put izmijenjena, da se vidi koja je verzija odštampana.
- **Vozila** (`/vozila`): svaka D1 kontrola ostaje trajno u „Evidencija kontrola" ispod spiska
  vozila — ne može se izmijeniti ni obrisati, samo se doda nova. Vozilo (registarski broj, režim
  od–do °C, u upotrebi) mijenja odgovorno lice — „Izmijeni vozilo"; audit pamti šta je bilo.
- **Dnevni obrasci** (`/haccp`): „Ispravi" pravi nov zapis koji zamjenjuje stari; stari ostaje
  vidljiv (posivljen, „ispravljen"). Ispravlja se samo posljednja verzija; magacioner samo svoj zapis.

Svaka izmjena u `audit_log` nosi i **staru i novu vrijednost** (samo polja koja su se promijenila);
ekran `/audit` ih prikazuje kao „bilo → sada".

### Otpremnica — slikaj ili učitaj

Prijem → Novi prijem → **„Slikaj otpremnicu"** (telefon otvara kameru) ili **„Učitaj PDF ili sliku"**.
Otpremnica se čita **na vašem serveru, bez ikakvog spoljnog servisa**:

- **PDF** od dobavljača — tekst se čita direktno iz fajla, tačno do slova. PDF sa više otpremnica
  nudi izbor.
- **Fotografija** — lokalni OCR (Tesseract, srpska latinica), uz ispravljanje nagiba i sjenke. Polja
  koja je pročitao nesigurno (npr. „J" pročitano kao „)") su **žuta**.

Aplikacija samo **popuni formu**: dobavljač (po PIB-u), broj i datum dokumenta, stavke (artikal,
lot, rok, količina). Magacioner sve upoređuje sa robom i etiketom i to potvrđuje kvačicom — bez nje
se ne snima. Nepoznat dobavljač ostaje prazan (odgovorno lice ga doda jednim klikom, sa PIB-om).
Artikal sa otpremnice („J-010 Jogurt 1 kg") se prvi put bira ručno, a aplikacija ga **zapamti za tog
dobavljača** — sljedeći put ga prepozna sama.

Uz stavku ostaje šta piše na otpremnici: **manjak** („po otpremnici 50, primljeno 47") i **drugi lot**
se vide u prijemu i na listi („odstupa od otpremnice"). Otpremnica (PDF/slika) se čuva uz prijem i
otvara iz njega; ulazi i u bekap. Temperaturu sa otpremnice aplikacija samo prikaže — to je podatak
dobavljača; KKT 1 mjeri magacioner.

**Istekao rok:** takva roba se upisuje (stigla je), odgovorno lice odmah dobija obavještenje, a
stavka se **ne može prihvatiti** — samo odbiti (povrat ili uništenje).

Ograničenja: rukopis se ne čita; skeniran PDF bez teksta se odbija (slikajte ga); OCR je do sada
provjeren na izmišljenim otpremnicama i simuliranim fotografijama — prve prave otpremnice pilot
klijenta su pravi test.

### Otpis zaliha

`/zalihe` → dugme **"Otpiši"** na lotu koji ima nešto dostupno (oštećeno, isteklo, izgubljeno).
Jedini drugi način da količina na zalihi ide dolje je isporuka — ručnog unosa novog broja nema
nigdje, da izvještaj o zalihama ostane dokaz, ne procjena. Otpis ide kroz isti obrazac kao
isporuka: transakcija koja umanjuje `zaliha.kolicina`, upisuje red u `kretanje_zalihe` (tip
`OTPIS`, razlog u `napomena`) i ostavlja trag u `audit_log`. Dozvoljeno svima koji rade
sa robom (`operater`, `bzr`, `izvodjac`) — magacioner prijavljuje šta je zatekao, isto kao kod
prijema.

**Karantin povrata.** Roba koja se vrati sa isporuke (kupac odbio ili nije predata) ne ide nazad u
slobodnu zalihu — ide u **karantin** tog lota, a odgovorno lice dobija obavještenje. Na `/zalihe`
lot tada ima dugmad **„Iz karantina: pusti"** (pregledano — temperatura, ambalaža, rok — vraća se u
prodaju) i **„Iz karantina: otpiši"**. Upisuje se šta je pregledano. Istekla roba se ne pušta,
samo otpisuje.

**Dupli klik i slaba mreža.** Dugme za slanje je zaključano dok zahtjev traje, a nov prijem i nova
isporuka nose ključ zahtjeva — ako telefon pošalje isto dvaput (izgubljen odgovor), server vraća
prvi upis umjesto drugog. Bez interneta poruka kaže da je unos ostao u formi.

### Šifarnici

`/sifarnici` — jedino mjesto gdje se unose kupci, dobavljači i artikli (do sad su postojale samo
API rute, bez forme; padajuće liste u prijemu/isporuci su samo birale iz onoga što je ovdje
uneseno). Tri jezička: Kupci (telefon obavezan, čl. 28), Dobavljači, Artikli (temperaturni opseg
i „Granicu potvrdio klijent" — dok nije potvrđeno, automatska ocjena odstupanja se ne primjenjuje,
invarijanta #5). Vidljivo samo `bzr`/`izvodjac`.

### Ljudi — nalozi i početna lozinka

Odgovorno lice otvara nalog magacioneru ili vozaču na dva mjesta:

- **Novo lice** → kvačica „Otvori i nalog za prijavu". Uloga se predlaže iz radnog mjesta
  („vozač…" → vozač, inače magacioner), korisničko ime iz imena („Marko Vuković" → `marko.v`),
  a početna lozinka je predložena (npr. `Durmitor-4827`) — može se prekucati svojom, najmanje
  10 znakova. Lice i nalog nastaju zajedno ili nikako: zauzeto korisničko ime ne ostavlja lice
  bez naloga.
- **Svi zaposleni** → „Otvori nalog" kod svakog ko ga još nema (ili kartica Nalozi → „Novi nalog").

Poslije toga se prikaže **jednom**: korisničko ime, početna lozinka i šifra, sa dugmetom
„Štampaj ceduljicu" za zaposlenog. Poslije zatvaranja lozinku ne vidi niko.

Zaboravljena lozinka: Nalozi → **„Nova lozinka"** — postavlja novu privremenu, prekida prijavu
na svim uređajima tog naloga, a pri sljedećoj prijavi se opet mora promijeniti. Odgovorno lice
ovo može samo magacioneru i vozaču (invarijanta #13); svoju mijenja na Mojoj strani.

### Prva prijava — obavezna promjena lozinke

Dok god `korisnik.mora_promijeniti_lozinku` stoji na `true` (postavlja ga bzr/izvodjac pri
otvaranju naloga), cijela aplikacija je zaključana na jedan ekran — „Postavite svoju lozinku" —
bez obzira na ulogu i putanju. Provjera je u `Zasticeno` u `src/App.tsx`, prije provjere uloge, pa
je nema šanse zaobići idući direktno na neku drugu stranicu. Ranije se ovo polje čitalo sa servera
ali ništa u pregledaču nije reagovalo na njega — privremena lozinka je mogla ostati u trajnoj
upotrebi.

### Bekap

**Pravi bekap je `npm run bekap` sa računara konsultantkinje** (vidi Alati) — samo iz njega se baza vraća.
Besplatni Supabase nema svoje bekape.

Kontrolni centar (`/tabla`, samo `bzr`/`izvodjac`) ima karticu **Bekap**: „Preuzmi bekap sada“ preuzima
JSON sa svim poslovnim tabelama (bez lozinki, sesija i fajlova otpremnica) direktno na uređaj — to je
kopija podataka koju klijent čuva kod sebe. **U bazi se ne čuva kopija** (od dopune 35, 04.10.2026):
ranije je svaki bekap, i sedmični automatski, ostajao u istoj bazi 90 dana i trošio njen prostor, a od
gubitka baze nije štitio. U `bekap_log` ostaje samo ko je i kad preuzeo i koliko je fajl bio velik.
Kad prođe sedmica bez preuzimanja, odgovorno lice dobija podsjetnik „Preuzmite sedmični bekap“ (najviše
jednom u 7 dana; provjera po vremenu iz baze, pa radi i kad besplatni Render uspava server).

### Povlačenje (čl. 28)

`/sledljivost` → rezultat pretrage → **Pokreni povlačenje** (samo `bzr`/`izvodjac`) otvara
povlačenje za taj LOT i **automatski** popuni spisak kupaca iz stvarnih isporuka (ime, telefon,
količina — ručno se ništa ne kuca, da se niko ne izostavi). **Lot odmah ide na HOLD, a zaliha
tog lota u karantin** — sporna serija se više ne nudi za isporuku. Otvara i neusaglašenost visoke
ozbiljnosti i zadatak. Sekcija „Povlačenja" na istoj strani prati ko je već zvan
(„Označi zvano" po kupcu) i ne dozvoljava zatvaranje dok svi nisu kontaktirani. Spisak se štampa
dugmetom „Štampaj spisak" (`db/14_povlacenje.sql`). Zadržan lot se ne može pustiti dok je
povlačenje u toku; odbiti (otpisati) se može.

### Obavještenja i zadaci — ko šta dobija

Zvonce u zaglavlju pokazuje broj nepročitanih; klik na obavještenje vodi na stranu na koju se
odnosi (samo ako uloga smije tamo).

| Kome | Kada |
|---|---|
| odgovorno lice (`bzr`) | temperatura van opsega · pokrenuto povlačenje · vozilo nije prošlo kontrolu · sedmični bekap · **prijavljen problem sa terena** · **mjera urađena — čeka provjeru** |
| uprava | temperatura van opsega · povlačenje · vozilo nije spremno · problem visoke ozbiljnosti — sve ostalo vidi u „Aktivnosti uživo" |
| vozač | dodijeljena mu je isporuka (pri pravljenju ili kad se promijeni vozač) |
| magacioner | lot sa njegovog prijema je **zadržan** ili **odbijen** (odmah, po lotu); cio prijem je riješen (jedna poruka, ne po stavci) |
| svako | dodijeljen mu je zadatak ili korektivna mjera · neusaglašenost koju je prijavio je zatvorena · **poruka** od odgovornog lica ili uprave |

Niko ne dobija obavještenje o onome što je sam uradio.

**Na telefon, i kad je aplikacija zatvorena:** Moja strana → **„Obavještenja na telefon"** →
„Uključi na ovom uređaju" (pa „Pošalji probno"). Uključuje se na svakom uređaju posebno.
- Stiže ISTO što i na zvonce, za nekoliko sekundi; hitno (temperatura, povlačenje) ostaje na
  ekranu dok se ne pogleda. Klik otvara stranu na koju se odnosi.
- **iPhone:** samo kad je aplikacija na početnom ekranu (Safari → Dijeli → Dodaj na početni ekran,
  pa otvoriti sa te ikone), iOS 16.4 ili noviji. Android (Chrome) radi i iz pregledača.
- Sadržaj ide šifrovan kroz push servis pregledača (Google/Apple/Mozilla) — servis ga prenosi, ne
  čita. Uređaj koji je odjavio obavještenja ili ga više nema briše se sam.
- Zvonce u aplikaciji (provjera na 30 s) radi i dalje, za one koji push ne uključe.

**Zadaci** nastaju sami (neusaglašenost, povlačenje, kontrola vozila) i nastaju
**nedodijeljeni** — odgovorno lice ih vidi na Kontrolnom centru i u „Moji zadaci", i dodjeljuje
ih nekome padajućim spiskom (ta osoba dobije obavještenje). Terenske uloge vide samo zadatke
dodijeljene njima. Zadatak se **zatvara sam** kad se zatvori neusaglašenost ili povlačenje iz
kog je nastao. Odgovorno lice pravi i **ručne zadatke** („Novi zadatak": šta, kome, prioritet,
rok) — rok je kraj izabranog dana po podgoričkom vremenu.

### Neusaglašenosti — kako se rješavaju

Na vrhu strane stoje četiri koraka, a u svakoj neusaglašenosti piše **šta je sljedeće i čije je**:

1. **Prijava** — svako (i vozač i magacioner) prijavi problem tamo gdje ga vidi: „Prijavi problem"
   na Neusaglašenostima, ili „Problem" na konkretnoj isporuci. Odgovorno lice dobija
   obavještenje i nedodijeljen zadatak; visoku ozbiljnost vidi i uprava.
2. **Mjera** — odgovorno lice upiše korektivnu mjeru, **kome je daje** i rok. Ta osoba dobija
   obavještenje i na listi joj stoji „Mjera za vas".
3. **Urađeno** — mjeru završava **samo onaj kome je dodijeljena** (server odbija ostale), i mora
   upisati šta je urađeno — taj zapis čita inspektor. Odgovorno lice dobija „čeka vašu provjeru".
4. **Provjera** — odgovorno lice provjeri i zatvori (ne može ista osoba koja je uradila mjeru), ili
   vrati. Zadatak se zatvara sam, a ko je prijavio dobija obavještenje.

**„Riješeno je“ — kad je odgovorno lice samo riješilo problem.** U otvorenoj neusaglašenosti
odgovorno lice (i konsultant) bira između **„Riješeno je — upiši“** (prvi izbor) i **„Dodijeli
mjeru nekome“** (koraci 2–3 iznad). „Riješeno je“ je JEDAN upis (`POST /neusaglasenosti/:id/rijesi`,
jedna transakcija): šta je urađeno postaje urađena mjera, a dalje odlučuju ista pravila:

- fali ponovna kontrola (novo mjerenje, nova D1, provjera termometra) ili povlačenje još nije
  završeno → mjera je upisana, neusaglašenost čeka; ekran kaže šta fali i vodi tamo gdje se radi;
- u firmi postoji drugo odgovorno lice, ili upisuje konsultant → provjerava i zatvara DRUGO
  odgovorno lice (četiri oka), koje odmah dobija obavještenje;
- jedino odgovorno lice → upisuje i šta je provjerilo, označi kvačicu „zatvaram bez drugog lica“ i
  neusaglašenost se **odmah zatvara**.

Ako je mjera već dodijeljena nekome, „Riješeno je“ završava baš tu mjeru (ne pravi novu).

**Mala firma — jedno odgovorno lice.** Kad je mjeru uradilo samo odgovorno lice, a u firmi nema
drugog aktivnog `bzr` naloga, server to prepozna i ponudi kvačicu „provjeru radim bez drugog
lica". Tada napomena mora imati bar 10 znakova (šta je pregledano), provjera nosi trajnu oznaku
„bez četiri oka" (`verifikacija.izuzetak_cetiri_oka`), a konsultant dobija obavještenje. Čim
firma ima dva odgovorna lica, izuzetak se odbija (`IZUZETAK_NIJE_DOZVOLJEN`). Uprava ni tada ne
provjerava.

**Povlačenje.** Neusaglašenost „Pokrenuto povlačenje …“ se zatvara tek kad je povlačenje završeno
(svi kupci obaviješteni, „Završi povlačenje“) — dugme sa neusaglašenosti otvara baš to povlačenje.

Terenske uloge prvo vide „Za mene" (ono što su prijavile ili im je dodijeljeno).

### Problem na isporuci

Dugme „Problem" na svakoj isporuci: vrsta (kupac odbio, oštećeno, pogrešna količina ili artikal,
temperatura, reklamacija poslije isporuke, kašnjenje, drugo) + opis. Upisuje se kao neusaglašenost
vezana za tu isporuku, a isporuka dobija narandžastu oznaku dok se ne zatvori. **Potvrđena
isporuka se ne prepravlja** — ispravka je ovaj zapis, da ostane trag šta je bilo i šta je urađeno.
Dok isporuka nije potvrđena, pogrešna količina ili artikal se ispravljaju dugmetom „Izmijeni".

### Zalihe — filteri i štampa

Status (sa brojem na svakoj kartici), pretraga po artiklu, lotu i dobavljaču, rok (ističe za 7
dana, istekao, bez roka), dobavljač, artikal, magacin, „samo na stanju" i poredak (FEFO, artikal,
količina). „Štampaj" i „CSV" daju **tačno ono što je na ekranu**; na papiru stoje firma, datum i
primijenjeni filteri.

### Direktor (uprava) — jednostavan Kontrolni centar

Direktoru ne trebaju operativne kartice odgovornog lica. Njegov Kontrolni centar odgovara na tri pitanja:

1. **Jesmo li u redu i šta traži moju odluku?** — semafor („Sve pod kontrolom“ / „Ima stvari za pažnju“ /
   „Potrebna je vaša odluka“) sa najviše 7 kratkih stavki (istekla knjižica, neusaglašenost visoke ozbiljnosti,
   povlačenje u toku, propuštene kontrole…). Ista pravila kao mejl „Stanje poslovanja“, za posljednjih 7 dana.
2. **Vode li se zapisi svaki dan?** — četiri broja za 7 dana prema prethodnih 7 (kontrole po planu, zapisi na
   vrijeme, otvorene neusaglašenosti, isporuke) i zapisi po danu za 14 dana; crveno = radni dan bez ijednog zapisa.
3. **Šta da radim?** — „Došao inspektor — paket za inspekciju“ i „Poruka odgovornom licu“.

Povlačenje u toku stoji odmah ispod semafora, sa brojem obaviještenih kupaca. „Svaki upis uživo“ (ko je šta i kad
radio) je na dnu, otvara se na klik. Meni direktora: Kontrolni centar, Moja strana, Poruke, Za inspekciju. Uprava ne
dobija obavještenje za svaki unos (važno stiže na zvonce), nema zadatke i ne radi provjeru znanja ako ne rukuje hranom.

### Izvještaji — prvo pregled (samo konsultant)

Izvještaje i izvoz tabela (CSV, JSON) vidi samo konsultant — odgovornom licu i direktoru za inspektora ostaje
„Za inspekciju“, a direktor stanje firme dobija mejlom („Stanje poslovanja“, niže). Izvještaj se prvo otvori na ekranu (najnovijih 500 redova, čitljiva zaglavlja, statusi kao u
aplikaciji, bez internih ID-jeva, pretraga), pa se štampa ili preuzme CSV sa svim kolonama.
**Filter po vremenu** (danas, 7 dana, ovaj ili prošli mjesec, godina, sve, ili od–do — po datumu
radnje, npr. datumu prijema) i **po kategorijama** koje izvještaj ima (status, magacin, obrazac,
rezultat…) radi na serveru: isti filter važi za pregled, štampu i CSV, i ispiše se u zaglavlju
štampe. Period ostaje izabran kad se pređe na drugi izvještaj.

### Stanje poslovanja — izvještaj direktoru mejlom (`/stanje`, samo konsultant)

Jedna strana koju direktor pogleda za pet minuta: **semafor na vrhu** („Sve pod kontrolom“ / „Ima stvari za pažnju“ /
„Potrebna je vaša odluka“) sa najviše 7 stavki šta treba uraditi, pa **ključni pokazatelji** sa poređenjem sa prethodnim
periodom (isporuke i kupci, prijemi, otpis; kontrole po planu, zapisi na vrijeme, temperatura u granici; otvorene
neusaglašenosti, povlačenja, kontrole vozila), **grafikoni** (isporuke; zapisi i kontrole — crvena crta je radni dan bez
ijednog zapisa; neusaglašenosti nove/zatvorene) i **ljudi i oprema** (knjižice, obuka, termometri).

Period: **dan, sedmica, mjesec, kvartal, polugodište, godina** — strelicama ranije/kasnije; bez izbora posljednji završeni
(juče, prošla sedmica, prošli mjesec…), a tekući „do danas“. Ekran prikazuje tačno ono što stiže mejlom.

- **Kome se šalje** — mejl direktora (više adresa zarezom, najviše 10) → „Sačuvaj“ → **„Pošalji direktoru“**. Svako slanje
  ostaje u spisku „Poslati izvještaji“ (ko, kad, period, kome).
- **„Sačuvaj PDF“** — izvještaj se otvori u novom prozoru sa prozorom za štampu; kao štampač izaberite **„Sačuvaj kao
  PDF“** (A4, boje i grafikoni ostaju). Taj PDF pošaljete kao prilog iz svoje pošte. **„Preuzmi HTML“** — isti izvještaj
  kao `.html` fajl (otvara se u pregledaču).
- Slanje ide sa VAŠEG mejl naloga, podešenog na Render servisu klijenta: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
  `SMTP_KORISNIK=vasa.adresa@gmail.com`, `SMTP_LOZINKA=<lozinka za aplikacije>` (Google nalog → Bezbjednost → potvrda u dva
  koraka → Lozinke za aplikacije — ne obična lozinka), `SMTP_POSILJALAC=Ime Prezime <vasa.adresa@gmail.com>`.
  **Besplatni Render blokira slanje mejla (SMTP)** — radi samo na plaćenom planu; do tada „Sačuvaj PDF“ i prilog.

### Za inspekciju — inspekcijski paket (`/inspekcija`)

Kad dođe inspektor UBH: izabere se period (podrazumijevano posljednjih 30 dana, najviše godinu dana) i
na ekranu se sklopi jedan dokument — **Štampaj / sačuvaj PDF** (A4 položeno, naslovna sama na strani)
i **Podaci za inspektora (ZIP)** (isti izvori kao Izvještaji, CSV za Excel, sa `SADRZAJ.txt`; bez
dnevnika izmjena, koji se daje na zahtjev). Pravi ga odgovorno lice ili konsultant; i direktor, kad
on dočekuje inspektora (samo čita).

Redoslijed je namjeran — prvo ono što se prodaje, **dokaz da zapisi nastaju svaki dan**:

1. **Kontinuitet zapisa** — koliko zapisa, koliko upisano istog dana a koliko naknadno, koliko dana
   ima zapise, koliko ljudi upisuje, koliko obaveza po planu je urađeno; tabela po danu (preko dva
   mjeseca — po sedmici), radni dan bez ijednog zapisa je crven;
2. **Plan monitoringa** — urađeno X od Y i koji dani su propušteni (isto brojanje kao HACCP plan);
3. prijem (KKT 1, sa temperaturom i granicom), temperaturna mjerenja (KKT 2 i 3), dnevni obrasci
   (sa odgovorima; ispravka i zamijenjena verzija se obje vide), D1, isporuke sa lotovima,
   neusaglašenosti (mjera, ko je uradio, ko provjerio, „bez četiri oka“), povlačenja, termometri,
   verifikacija sistema, sanitarne knjižice (stanje u periodu) i obuka.

Odjeljak se može isključiti („Šta ulazi u paket“). Iznad dokumenta (ne štampa se) stoji upozorenje
ako ima propušteno po planu, otvorenih neusaglašenosti ili knjižica koje ne važe — **pregledajte paket
prije inspekcije: crveno vidi i inspektor.** Naknadni upisi i upisi bez mreže nose svoje oznake i u
paketu (`naknadno +N`, `bez mreže`) — paket ništa ne uljepšava.

### Audit trag — filteri

Period, **ko** (zaposleni), **radnja** (upis, izmjena, promjena statusa, odluka, prijava), **nad
čim** (prijem, lot, isporuka, neusaglašenost…) i tekst u vrijednostima (npr. broj lota). Kod
izmjene se vidi „bilo → sada“. Štampa sa filterima u zaglavlju.

### Obuka zaposlenih — gdje se upisuje

- **Godišnji plan obuke** (Prilog 13): Ljudi → „Godišnji plan obuke“ → **„Nova stavka plana“** — za
  jednog zaposlenog ili odjednom za sve koji rukuju hranom, tema sa spiska ili svoja. Održana obuka:
  „Označi urađeno“. Štampa: Prilozi → Prilog 13.
- **Pitanja za provjeru znanja**: Ljudi → „Provjera znanja“ → **„Pitanja firme“** → „Novo pitanje“.
- Do oba se stiže i sa strane **HACCP plan** (traka „Obuka zaposlenih“ na vrhu).

### Provjera znanja — pitanja firme i rezultati

**Kako zaposleni ulazi:** prijavljen **svojim nalogom**, sa svoje početne strane. Dok je termin
otvoren, na Mojoj strani (magacioner, vozač) i na Kontrolnom centru (odgovorno lice)
stoji kartica **„Otvorena je provjera znanja — Uđi"** — samo onima koji **rukuju hranom** (Ljudi → „rukuje
hranom“). Direktor i administracija je ne rade; direktor koji i sam radi sa robom se tamo označi. Šifra se **ne kuca**: server uzima šifru
prijavljenog, pa niko ne može raditi provjeru umjesto drugoga, a tuđu započetu provjeru ne može ni
odgovarati ni završiti. Poslije završetka na početnoj strani piše da je provjera urađena. Bez
prijave nema ulaza (ni na strani za prijavu, ni preko adrese). **Zaposleni bez naloga ne radi
provjeru** — prvo mu se otvori nalog (Ljudi → Svi zaposleni → „Otvori nalog"). Kartica u Ljudima
crveno javlja kad nema otvorenog termina.

Ljudi → Provjera znanja:

- **Termini i rezultati** — termin bira izvor pitanja (sva / samo pitanja firme / samo
  konsultantova) i **prag za „položeno"** (podrazumijevano 70 %). Za svaki termin: koliko je
  završilo, koliko položilo, prosjek. Ispod: ko je radio, tačno X/Y, skor u %, položeno ili ne —
  sa štampom.
- **Pitanja firme** — unosi ih odgovorno lice, o procedurama svoje firme; vidi koliko je ljudi
  odgovorilo i koliko tačno. „Izmijeni“ na pitanju na koje se već odgovaralo čuva **novu verziju**:
  staro se isključi i ostaje u rezultatima (da pokazuju odgovore na pitanje koje je stvarno
  postavljeno), a od tada važi novo.
- **Pitanja konsultanta** ostaju skrivena i odgovornom licu (invarijanta #14).

### Poruke

`/poruke` (odgovorno lice, konsultant, uprava): poruka se šalje **po grupi** (magacioneri,
vozači, …), **pojedinačno** ili **svima**; „Važno" je ističe crveno. Primalac je dobija kao
obavještenje sa imenom pošiljaoca. Pošiljalac vidi „pročitalo X od Y" i spisak ko je pročitao.
Poruka se ne briše i ne mijenja (`poruka`, `db/19_skladista_poruke_cg.sql`). Svi pošiljaoci
vide sve poslate poruke — da odgovorno lice i uprava ne šalju različita uputstva istim ljudima.

### Više skladišta

Dopuna 19 pravi jedno skladište („Glavni magacin") i veže za njega sve postojeće prijeme i
isporuke. **Dok firma ima jedno aktivno skladište, izbor se nigdje ne prikazuje.** Čim se u
Šifarnici → Skladišta doda drugo, prijem, isporuka i zalihe dobijaju izbor i kolonu „Magacin".

- Lot ostaje u skladištu u koje je primljen; isporuka ide iz jednog skladišta i server odbija
  lot iz drugog. **Premještanje robe između skladišta nije u ovoj verziji.**
- Matično skladište naloga (Ljudi → Nalozi) je samo podrazumijevani izbor — magacioner po potrebi
  bira drugo pri unosu. Bez matičnog, a sa više skladišta, izbor je obavezan.
- Posljednje aktivno skladište se ne može ugasiti; ugašeno ostaje u istoriji.

Isporuke se filtriraju po **datumu, vozilu i magacinu** (vozač vidi samo svoje).

### Temperatura pri predaji (KKT 3)

Na potvrdi isporuke, za svaki artikal pod temperaturnim režimom (`artikal.temp_kontrolisano`)
koji se predaje, vozač upisuje temperaturu izmjerenu kod kupca — bez nje server odbija potvrdu.
Čuva se na stavci (`isporuka_stavka.temperatura_predaje`, `db/18_temperatura_predaje_cg.sql`) i
izvozi u „Stavke isporuka".

Ocjena ide **samo po pravilu KKT 3 za taj artikal**. To pravilo pravi Šifarnik iz granice
artikla (`pravilaService.uskladiPravilaArtikla`) — aplikacija više ne čita granicu sa artikla
mimo pravila. Nepotvrđena granica (`granica_potvrdio`) daje samo upozorenje, bez
neusaglašenosti. Opšte pravilo KKT 3 (rashladni režim vozila, 0–5 °C) se namjerno ne koristi —
po njemu bi smrznuta roba na −18 °C ispala „van opsega". Van granice → mjerenje FAIL na KKT 3 (vezano za lot i vozilo),
neusaglašenost i zadatak, obavještenje odgovornom licu. **Lot u magacinu se ne stavlja na HOLD**
— problem je nastao u prevozu, a roba koja je ostala u magacinu nije bila u tom vozilu.

### HACCP plan (`/haccp-plan`)

Strana za odgovorno lice i konsultanta; uprava je vidi, ali ne mijenja. Četiri kartice:

- **Plan monitoringa** — šta se radi, koliko često (svaki dan / radnim danima / sedmično /
  mjesečno / po događaju), koliko puta i ko (uloga, po želji skladište). „Predloži osnovni plan"
  upiše polazni plan:
  - KKT 1 i KKT 3 po događaju;
  - KKT 2 radnim danima, dva puta;
  - P3, P8 i P9 radnim danima;
  - P7 i P10 sedmično;
  - D1 za svako vozilo.

  Ispod plana je stanje za danas i spisak propuštenih dana za posljednjih 30 dana.
  Brojanje radi `monitoringService.stanjeDanas()`; dan je po podgoričkom vremenu, a ispravka
  zapisa se ne broji dva puta.
- **Kontrolne tačke** — za svaku KKT: opasnost, granica, korektivna mjera, verifikacija.
  „Predloži tekst" popuni polazni tekst za KKT 1–3. KKT 1 i KKT 3 se ne mogu ugasiti.
- **Termometri** — interna provjera (npr. ledena voda, referentni termometar) i kalibracija.
  - Rezultat računa server iz referentne i izmjerene vrijednosti (dozvoljeno odstupanje
    podrazumijevano ±0,5 °C).
  - Kalibracija bez broja sertifikata se ne prima.
  - Stanje: ISTEKLA / USKORO (provjera ≤ 7 dana, kalibracija ≤ 30) / VAŽI / NEISPRAVAN.
  - Neispravan termometar otvara neusaglašenost i zadatak. Na strani HACCP stoji upozorenje
    da se njime ne mjeri, a server ga odbija pri mjerenju.
  - Svako mjerenje pamti termometar. Kad firma vodi termometre, ručno mjerenje bez izbora
    termometra se ne prima; kad je samo jedan, bira se sam.
  - Kad termometar padne na provjeri, mjerenja njime od posljednje ispravne provjere dobijaju
    oznaku „upitno" (neusaglašenost kaže koliko ih je). Neusaglašenost se zatvara tek posle nove
    ispravne provjere — ili kad se termometar isključi iz upotrebe.
- **Verifikacija sistema** — godišnja revizija HACCP plana, interni audit, vježba povlačenja.
  „Potrebne izmjene" pravi zadatak. Kartica pokazuje šta nije rađeno, šta kasni i šta uskoro ističe.

„Štampaj HACCP plan" (`/prilozi` → HACCP plan) sklapa dokument iz onoga što je podešeno:
- tabela KKT-ova;
- monitoring;
- termometri;
- verifikacija;
- potpisi.

Šta nije upisano, štampa se crveno kao „— upisati —".

**Na Mojoj strani** magacioner i vozač vide „Danas po planu" (šta je urađeno, šta fali, „Upiši"
otvara baš taj obrazac ili mjerenje) i upozorenje ako juče nešto nije urađeno. Na Kontrolnom
centru su dvije kartice: „Danas fali po planu · juče propušteno" i „HACCP rokovi".

---

## Pravni okvir (sažetak — puna verzija u CLAUDE.md)

- **Zakon o bezbjednosti hrane**, „Sl. list CG" **59/2026** (na snazi od 12.05.2026): čl. 27
  sledljivost, čl. 28 povlačenje, čl. 35 higijena, čl. 36 HACCP, čl. 43 registracija, čl. 47
  vodiči, čl. 82 kazne (2.000–20.000 € pravno lice).
- **Sanitarne knjižice**: Zakon o zaštiti stanovništva od zaraznih bolesti, čl. 31 (kazna
  2.500–20.000 €) — ljekarski pregled, ne obuka. U `lice` se čuva samo broj i rok, nikad nalaz.
- **Obuka zaposlenih nije zakonska obaveza** u važećem zakonu — nikad se ne predstavlja kao
  takva. Prodaje se kao dokaz da HACCP sistem radi (čl. 36) + Vodič UBH Prilog 13/14.
- **Obrazac 6 ne postoji u Crnoj Gori** (srpski obrazac) — nikad se ne pominje.
- Obrasci P1/P3/P7/P8 i D1-D4 u ovoj aplikaciji su **autorski**, ne zvanični obrasci UBH.

---

## Sigurnost

- Lozinke: `scrypt` heš (`server/lozinke.ts`), minimalna dužina 10 znakova, provjera i na
  serveru i u pregledaču. Lozinka se prikazuje **tačno jednom**, pri kreiranju naloga — poslije
  toga samo stanje (`privremena`/`svoja`/`postavljena`).
- Sesije: httpOnly kolačić, `SameSite=Lax`, `Secure` u produkciji, 8h trajanje.
- CSRF: state-changing zahtjevi (`POST`/`PATCH`/`DELETE`) moraju nositi zaglavlje
  `x-zahtjev-app: 1` (`server/auth.ts` → `zahtjevAppZaglavlje`) — cross-site forme ga ne mogu
  postaviti.
- Rate limiting na prijavu: 8 neuspjelih pokušaja po IP-u zaustavlja dalje pokušaje na 10 min.
- SQL injection: svi upiti su parametrizovani (`$1, $2...`), nema string-konkatenacije
  korisničkog unosa u SQL (jedini izuzetak su imena tabela u `izvozService.ts`, koja dolaze
  isključivo iz hardkodovane liste, nikad od korisnika).
- Validacija: Zod na serveru je autoritativna; frontend validacija je samo za UX.
- `korisnik.uloga` sa klijenta se nikad ne vjeruje — svaka ruta provjerava ulogu iz sesije.
- Jedna granica prijave (`app.use("/api", requireAuth)`); ispred nje samo javne adrese (prijava,
  odjava; provjera znanja NIJE javna). Server pri pokretanju prolazi sve rute i ne kreće ako
  neka nema `requireUloga` (`server/provjeraRuta.ts`).
- Push: pretplata se prima samo za push servise pregledača (ne „pošalji bilo kud"); sadržaj je
  šifrovan za uređaj; VAPID ključ je po bazi klijenta.

## Mobilni prikaz

Layout je responzivan (bočni meni postaje off-canvas ispod 760px, modali postaju bottom-sheet
ispod 480px, tabele dobijaju horizontalno skrolovanje). Terenske strane (`/haccp`, `/isporuka`,
`/vozila`, `/moja`) su testirane prvenstveno za telefon — magacioner i vozač rade sa telefona.
Svaku stranu svake uloge na 375 px provjerava `npm run test:ekrani` (vidi Testiranje).

Paket za pregledač: početno ~257 KB, a svaka strana se učitava tek kad se otvori (`React.lazy`).

### Rad bez interneta (vozač, magacioner)

U podrumu kupca ili u hladnjači nema signala. Tada se **D1, predaja isporuke, mjerenje, dnevni zapis i
prijava problema** čuvaju na telefonu („Sačuvano na telefonu — šalje se samo čim bude signala“), na vrhu
strane piše koliko upisa čeka, a čim se signal vrati odu sami — redom kojim su urađeni i sa vremenom kad
su urađeni (u listama nose oznaku „bez mreže“). Isti upis se nikad ne upiše dvaput. Predaja se provjerava
po danu predaje (D1 tog dana, rok tog dana). Ako server upis tada ne primi (npr. lot je u međuvremenu
povučen), upis ne nestaje: odgovorno lice dobija obavještenje, a radnik ga vidi na telefonu.
Aplikacija se otvara i bez signala (sačuvana je na telefonu), sa posljednjim podacima koje je telefon vidio.
Prijem robe, odluke i otpis traže mrežu. Uslov: vozač jednom otvori stranu Isporuka dok ima signala.

---

## Testiranje prije isporuke klijentu

```bash
npm run typecheck
npm run build
npm test             # 673 provjere na SOPSTVENOJ čistoj bazi; izlazni kod 1 ako išta padne
npm run test:ekrani  # 55 provjera ekrana: telefon 375 px, pet uloga, rad bez mreže, inspekcijski paket, stanje poslovanja, pregled direktora
```

**`npm run test:ekrani`** izgradi aplikaciju kao za Render, pokrene server u produkcijskom režimu (sa
service workerom) na istoj takvoj čistoj bazi, i kroz pravi Chrome bez prozora (`playwright-core` —
pregledač se ne preuzima, koristi se instaliran Chrome; `PW_KANAL=msedge` za Edge) u veličini telefona
prođe svaku stranu svake uloge (otvara se, ne viri van ekrana, bez greške u konzoli), D1 i predaju,
mjerenje, obrazac i prijem, i vozača bez signala. Lozinka se ne kuca u pregledač — prijava ide kroz API.

**`npm test`** ne dira ni demo bazu na Renderu ni vaše PostgreSQL servise: iz PostgreSQL-a
instaliranog na računaru (`C:/Program Files/PostgreSQL`, ili `PG_BIN=`) pravi svoj klaster u
`.testbaza/` (port 54329, bez lozinke, samo localhost), svaki put čistu bazu, na nju sve migracije
i demo podatke, pokrene server na portu 5055 (samo `/api`), pusti sve testove i sve ugasi. Jedan
test: `npm test -- povlacenje`. Isto radi **GitHub Actions na svaki push** na `main`
(`.github/workflows/testovi.yml`, `npm run test:ci`) — ishod je kvačica ili krstić pored commita.

`npm run test:e2e` pušta iste testove protiv servera koji već radi i baze iz `.env` — samo kad
treba provjeriti baš demo bazu. Radi **samo na demo bazi** — prije prvog koraka provjeri
da u bazi stoji svih pet demo naloga sa svojim fiksnim ID-jevima i inače odbije da krene, jer
testovi prave i brišu podatke. Server i test moraju gledati istu bazu (`DATABASE_URL` iz
`.env`); drugi server se zadaje sa `APP_URL=`. Jedan test: `npm run test:e2e -- povlacenje`.

Demo baza može imati i ono što je uneseno ručno kroz aplikaciju (npr. drugo skladište). Testovi
to ne diraju: prijem ide u „Glavni magacin" (`glavnoSkladiste()` u `testovi/pomoc.mjs`),
isporuka iz skladišta svog lota. Provjera koja traži da je skladište jedino se tada preskače i to
se ispiše („· preskočeno"). Demo lotovi vremenom isteknu (rok je od dana punjenja baze) — test
koji isporučuje demo lot bira onaj koji nije istekao (`nijeIstekao()`).

| Test | Šta dokazuje |
|---|---|
| `pristup` | svaka uloga vidi svoje adrese i ne vidi tuđe; bez prijave radi samo `/zdravlje` — ni provjera znanja, ni sa tačnom šifrom |
| `obavjestenja` | obavještenja za teren, zadaci, KKT 3 pri predaji, neusaglašenost od otvaranja do zatvaranja |
| `poruke_skladista` | poruke (grupa, pojedinačno, svima, ko je pročitao), ručni zadaci, više skladišta |
| `povlacenje` | spisak kupaca iz isporuka, lot na HOLD-u, ne zatvara se dok svi nisu zvani |
| `provjera_znanja` | ulazi samo prijavljeni, sa svog naloga i uz svoju lozinku (tuđa šifra iz zahtjeva se ne gleda, šifra se ne vraća); drugi zaposleni ne može odgovarati ni završiti tuđu provjeru; rezultat se ne može naduvati; Prilog 14 |
| `prilozi_izvoz` | podaci za štampu, svih 14 CSV izvora i kolone koje se prodaju kao dokaz |
| `sesije` | prijava u bazi kao heš, odjava, promjena lozinke odjavljuje ostale uređaje |
| `neusaglasenosti_teren` | vozač prijavi problem na isporuci → mjera njemu → samo on je završava, uz opis → provjera; uprava i aktivnost |
| `znanje_firme` | pitanja firme, termin sa pragom, rezultat „položeno", statistika po pitanju |
| `faza1_haccp` | HOLD → pusti/odbij sa razlogom, povlačenje blokira puštanje, provjera tek uz urađenu mjeru, odstupanje iz obrasca → neusaglašenost, nepotvrđena granica ne zadržava robu |
| `otpremnice` | 10 probnih otpremnica iz PDF-a tačno do slova, fotografija (i smanjena kao iz pregledača) sa tačnim lotovima, dobavljač po PIB-u, zapamćen artikal, „1 kg“ se ne upari sa „500 g“ ni „2,8%“ sa „3,2%“, nov dobavljač samo od odgovornog lica (magacioner javlja jednim dugmetom), nepoznata roba predložena kao nov artikal sa pretpostavljenim režimom i upisana uz prijem (isti PIB / naziv odbijen), fotografija okrenuta i tamna, otpremnica sa cijenom, rabatom i iznosom (PDF i fotografija), slika bez tabele se čuva uz prijem, manjak, istekao rok se ne prihvata |
| `faza2_integritet` | istovremeni unosi ne dobijaju isti broj, lice + nalog ili oba ili ništa, početna i nova lozinka, terenske uloge ne čitaju tuđe, kartice direktora, baza odbija nepoznat izvor |
| `push` | pretplata po uređaju, adresa koja nije push servis se odbija, push stiže potpisan i šifrovan i čita ga samo „uređaj", ne šalje se dvaput, nestao uređaj (410) se briše sam, odjava samo svog uređaja |
| `talas1` | predaja zadržanog lota, isteklog lota i više nego što je na zalihi se odbija, zaliha nikad u minusu; povrat u karantin i odluka o njemu; tuđa isporuka i stari prijem po adresi; isti ključ zahtjeva = jedan upis; potvrda sa svim stavkama; tuđi pogrešni pokušaji prijave ne zaključavaju druge |
| `bezbjednost_baze` | RLS na svim tabelama, pogledi po pravima pitaoca, javne uloge Supabase-a (`anon`, `authenticated`) ne čitaju i ne pišu ni sa vraćenim pravom, nova tabela bez prava za njih, aplikacija i dalje vidi sve |
| `monitoring_magacini` | plan po magacinu: ono što je izmjerio jedan magacioner važi za sve u tom magacinu, mjerenje u magacinu A ne pokriva B, vidi se ko je uradio, mjerenje i zapis (i ispravka) pamte magacin |
| `dorada` | D1 samo za vozilo koje danas vozi (crveno se skida posle kontrole); vozač dobija obavještenje kad mu isporuka ode ili se izmijeni; temperatura uz stavku prijema; neusaglašenost unaprijed kaže šta fali i ko provjerava; primljene poruke po vremenu; filteri izvještaja (pregled = CSV) i audita; nova verzija pitanja firme; „Riješeno je“ — neusaglašenost jednim upisom uz ista pravila (četiri oka, ponovna kontrola, završeno povlačenje) |
| `talas6` | rad bez interneta: isti upis dvaput → jedan zapis i isti odgovor, neuspio upis ne zauzima ključ, upis u obradi → pokušaj kasnije; vrijeme sa telefona i oznaka „bez mreže“ (mjerenje, D1, zapis, problem, predaja); budućnost i starije od 36 h odbijeno; predaja po danu predaje (D1 i rok tog dana); kasna jučerašnja D1 ne mijenja današnji status vozila; odbijen upis stiže do odgovornog lica |
| `ekrani/1_uloge` | svaka strana svake od pet uloga na telefonu: otvara se, bez vodoravnog skrola, bez greške; meni nudi samo strane uloge; četiri priloga za štampu |
| `ekrani/2_teren` | vozač D1 pa predaja, magacioner mjerenje sa termometrom, obrazac P9 i prvi korak prijema, direktor kartica → lista — sve kroz ekran |
| `ekrani/5_isporuka_nc` | magacioner čiji je matični magacin prazan: forma sama nudi magacin sa robom, „Sačuvaj“ kaže šta fali; Ana zatvara neusaglašenost jednim upisom („Riješeno je“ — kvačica i šta je provjereno) |
| `alati` | `prvi-korisnik` odbija bazu koja već ima odgovorno lice ili konsultanta (i bazu bez tabela); na novoj praznoj bazi pravi odgovorno lice, konsultanta i kontrolne tačke KKT 1–3 (privremene lozinke, audit, firma); drugi konsultant se odbija; `uvoz-start`: proba bez upisa, upis (preimenovan prazni magacin, dopunjena knjižica, granice nepotvrđene, pravila KKT 1/3, šifra kod dobavljača), ponovni uvoz bez duplikata, demo baza odbijena; `dnevni-pregled` javlja veličinu baze i upozorava preko granice |
| `inspekcija` | paket za period: prijem sa temperaturom i termometrom, mjerenje van granice i njegova neusaglašenost, zapis upisan dan kasnije („naknadno +1“) i ispravka (obje verzije), kontinuitet broji naknadne; period se provjerava na serveru (obrnut, duži od godine, budućnost); direktor ga izvlači; ZIP je ispravan (kontrolni zbir svakog fajla), bez audita, sa istim periodom |
| `ekrani/6_inspekcija` | paket se sklopi na telefonu (12 odjeljaka, ne viri van ekrana), isključen odjeljak nestaje i brojevi idu redom, ZIP se preuzima, u štampi ostaje samo dokument |
| `ekrani/3_bez_mreze` | vozač bez signala: aplikacija sačuvana na telefonu, D1 i predaja čekaju (i posle ponovnog otvaranja), signal → odu same, redom, sa oznakom |
| `talas5` | slika od 56 MP (mali fajl) odbijena prije obrade; izvoz bez Excel formula i sa vremenom po Podgorici; stari heš lozinke radi i pojača se; zdravlje javlja neprimijenjenu dopunu; dnevnik grešaka (pregledač, konsultant čita, 400 ne ide u dnevnik); potvrda u dva koraka — uključivanje, QR, rezervni kodovi, ponovljen kod ne važi, 5 pogrešnih = novi izazov, isključivanje, tajna nije u auditu ni bekapu, obavezna 2FA na drugom serveru |
| `talas4` | bekap iz aplikacije se preuzima direktno, bez kopije u bazi (i stare kopije obrisane), bez heševa lozinki, sesija i ključeva, sa svim tabelama; podsjetnik za sedmični bekap; zdravlje javlja i bazu; neispravan JSON, identifikator, veza i šema → 400/409 sa porukom; bezbjednosna zaglavlja |
| `talas3` | isporuka ne uzima rezervisanu robu, izmjena u okviru svoje rezervacije, otkaz (samo iz pripreme, uz razlog, ne vozač) oslobađa robu, ispravka kupca sa auditom; rok obavezan, serija jednom po prijemu, drugi rok iste serije → upozorenje; povlačenje cijele serije; otpremnica sa PIB-om i adresom isporuke; jedinstven PIB |
| `talas2` | D1 ocjenjuje temperaturu po granici vozila, roba pod režimom samo rashladnim vozilom, predaja traži današnju D1; izmjene pamte „prije"; ispravka zapisa jednom, istog obrasca, svog zapisa; odstupanje iz odgovora u obrascu; lot po granici svog artikla; termometar na mjerenju i „upitna" mjerenja; zatvaranje tek posle ponovne kontrole; novi izvori izvoza |
| `faza3_sistem` | temperatura obavezna na KKT 1, granica iz Šifarnika postaje pravilo (i nova verzija pri izmjeni), plan monitoringa i „šta danas fali", termometar (ispravan / neispravan → neusaglašenost, kalibracija traži sertifikat), verifikacija sistema, podaci za štampu HACCP plana, izuzetak od četiri oka samo kad je odgovorno lice jedino |

Svaki test briše sve što napravi. Nov tok u aplikaciji = nov test u `testovi/` — dvije greške koje
su dugo bile na Renderu (neusaglašenost se nije mogla zatvoriti; uprava i provjera znanja
zaključani) našao je tek test koji prolazi tok do kraja.

Ručno, na `npm run dev`, kroz svih pet uloga:

1. Prijava kao `bzr`, `operater`, `vozac`, `uprava`, `izvodjac` — provjeriti da meni odgovara
   ulozi.
2. **Prijem → LOT → zaliha → isporuka**: unijeti prijem sa temperaturom u opsegu, prihvatiti
   lot, kreirati isporuku, potvrditi je.
3. **Devijacija**: unijeti mjerenje van opsega (npr. 8.6°C za rashlađeno) → provjeriti da se
   otvorila neusaglašenost, zadatak i da je LOT otišao na HOLD; dodati korektivnu mjeru,
   završiti je, verifikovati drugim nalogom (ne istim koji je završio mjeru), zatvoriti.
4. **Sledljivost**: pretraga po broju lota — provjeriti lanac dobavljač → prijem → lot →
   isporuka → kupac.
5. **Izvoz** (kao konsultant): preuzeti CSV po tabeli i sve odjednom (JSON) sa `/izvjestaji`; `/stanje` → „Mjesec“ →
   upisati svoj mejl kao primaoca → „Pošalji direktoru“ i pogledati mejl na telefonu.
6. **Prilozi**: štampati rješenje o imenovanju i Prilog 13/14 sa `/prilozi`.
7. **Provjera znanja**: sa `/provjera-znanja`, ući šifrom sa spiska zaposlenih, odgovoriti na
   pitanja, provjeriti evidenciju na `/prilozi` → Prilog 14.
8. **HACCP plan**: `/haccp-plan` → „Predloži osnovni plan", dodati termometar i upisati
   provjeru, upisati reviziju plana; pa kao magacioner na `/moja` provjeriti „Danas po planu" i
   „Upiši"; na `/prilozi` → HACCP plan provjeriti štampu.
9. **Mobilni prikaz**: DevTools na 375px širine, provjeriti `/haccp`, `/isporuka`, `/moja`.
10. **Za inspekciju**: `/inspekcija` → „Prošli mjesec“ → Štampaj / sačuvaj PDF i pogledati PDF; preuzeti
    ZIP i otvoriti jedan CSV u Excelu.

---

## Šta NIJE u ovoj verziji (namjerno)

Picking, rute, optimizacija ruta, rezervacije zaliha, povrati/reklamacije kao posebni moduli,
multi-facility/multi-zone skladište, barcode/IoT senzori, spoljne integracije (ERP,
računovodstvo), SMS/email obavještenja (jedini mejl je „Stanje poslovanja“ direktoru, sa naloga konsultanta). Vidi plan/CLAUDE.md za obrazloženje — cilj je sistem
koji magacioner stvarno koristi, ne enterprise WMS.

## Otvoreno

- `npm run bekap` se ne pokreće sam dok vlasnica jednom ne pokrene `npm run zakazi-bekap`.
- Plan monitoringa i tekst HACCP plana su polazni prijedlog — za svakog klijenta ih konsultant
  prilagođava stvarnim komorama, vozilima i ritmu rada.
- Obavještenje o „tišini" klijenta (`dnevni-pregled`) je alat koji se pokreće ručno, ne mejl —
  pravi mejl traži SMTP nalog (poslovna odluka, ne kod).
- Ugovor i cjenovnik nijesu dio ovog repozitorijuma (vidi `.gitignore` — `prezentacija/` i
  `dokumenti/` žive u posebnom privatnom repozitorijumu).
- Banka pitanja za provjeru znanja nije validirana ni na jednoj grupi — prvih ~30 ispitanika su
  pilot, ne mjerenje.
