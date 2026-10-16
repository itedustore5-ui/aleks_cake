# CLAUDE.md — kontekst projekta

**Pročitaj ovaj fajl prvi, prije bilo kakvog rada u ovom repozitorijumu.**
Ovdje je sve što se ne vidi iz koda: mapa aplikacije, zašto je nešto tako, šta se ne smije
dirati, šta je poznato da ne valja, i na čemu se već izgubilo vrijeme.

Ažurira se pri svakoj većoj izmjeni. Ako nešto naučiš na teži način — upiši ovdje.
Posljednji pregled koda i usklađivanje ovog fajla: **11.10.2026.** (jednostavan Kontrolni centar direktora, provjera znanja samo za one koji rukuju hranom; „Stanje poslovanja“ — izvještaj direktoru mejlom, Izvještaji samo kod konsultanta; upitnik za početak i `uvoz-start`, kontrolne tačke na svakoj bazi; 04.10. inspekcijski paket i „Riješeno je“ za neusaglašenost; 01.10. dorada posle probe vlasnice; talas 6 30.09.; ranije inspekcija i talas 5 29.09., revizija 25.09. i talasi 1–4) (Ranija verzija ovog fajla
opisivala je staru aplikaciju — `zapisi.js`, `promet.html`, `veza.js` — koje u ovom kodu nema.)

---

## Šta je ovo

Aplikacija za **dobru higijensku praksu i HACCP kod distributera hrane u Crnoj Gori.**
Vlasnica je konsultantkinja iz Srbije koja uslugu prodaje crnogorskim firmama:
tri paketa (odluka vlasnice 28.09.2026) — **Pod ključ / Standard / Start**: uspostavljanje
2.400 / 1.490 / 990 € + „vođenje i usklađenost“ 290 / 179 / 119 € mjesečno; cijena po veličini firme
(magacini, vozila, zaposleni), **nikad po korisniku**. Iznosi stoje u `prezentacija/podaci.cjs`, a
pozicioniranje, garancija „Svaki dan“, osnivački klijenti i prodajni tok u `dokumenti/strategija_prodaje.md`
(oboje van gita).

**Šta se stvarno prodaje:** ne softver, nego odgovor na pitanje *„serija je sporna, kojim
kupcima je otišla?"* i dokaz da zapisi nastaju svakog dana, a ne noć prije inspekcije.

---

## Pravilo koje se nikad ne krši

**Jedan klijent = jedna baza = jedan Render servis.**

Kod nema razdvajanje firmi: tabela `firma` ima jedan red, a sve ostale tabele pripadaju toj
firmi. Prvi put kad se dva klijenta nađu u istoj bazi, svaki vidi sve.

**Demo baza** (`npm run seed:demo`, `db/13_demo_cg.sql`) je samo za prodajne sastanke i
testove. Demo se nikad ne koristi za pravi rad, niti obrnuto. `npm run test:e2e` sam provjeri
da je baza demo i inače odbije da krene.

---

## Kome se predaje aplikacija

**Prvi nalog u klijentovoj firmi je `bzr` — odgovorno lice za bezbjednost hrane.** Ne direktor,
ne magacioner.

Zakon 59/2026 ne propisuje funkciju „odgovorno lice za bezbjednost hrane". Postoji **„odgovorno
lice u pravnom licu" iz čl. 82** — pojam prekršajnog prava, lično plaća 500–2.000 €. Dok firma
pisano ne odredi ko je to, to je izvršni direktor. *(likely — iz teksta kazni.)*

| # | Šta | Čime |
|---|---|---|
| 1 | Direktor potpiše rješenje o imenovanju | `/prilozi` → prva stavka |
| 2 | Imenovanom licu se otvara nalog `bzr`, a konsultantu `izvodjac` (bez njega nema direktora, podataka firme ni obavještenja „bez četiri oka“) | `npm run prvi-korisnik -- … --konsultant …` |
| 2a | Podaci firme (zaposleni, magacini, vozila, dobavljači, kupci, artikli, termometri) — distributer ih popuni u upitniku, konsultant ih uveze | `upitnik-start/Upitnik-za-pocetak.html` → `npm run uvoz-start -- --fajl … [--upisi]` |
| 3 | To lice dobija Kontrolni centar kao prvu stranu | `/tabla`, automatski po ulozi |
| 4 | Upisuje sve zaposlene; kod onih koji rukuju hranom — rok sanitarne knjižice | `/ljudi` → Svi zaposleni |
| 5 | Magacioneri (`operater`) i vozači (`vozac`) dobijaju naloge — **otvara ih sam**, odmah pri unosu zaposlenog, sa početnom lozinkom i ceduljicom za štampu | `/ljudi` → Novo lice / „Otvori nalog" |
| 6 | Direktor dobija `uprava` — svoj Kontrolni centar (semafor, četiri broja, zapisi po danu), Za inspekciju i poruke, bez unosa (#95); „Stanje poslovanja“ mu konsultant šalje mejlom | otvara konsultant |
| 7 | Konsultant podešava HACCP plan: „Predloži osnovni plan" pa prilagodi stvarnim komorama i vozilima, upiše termometre i tekst kontrolnih tačaka | `/haccp-plan` |
| 8 | Svako na SVOM telefonu uključi obavještenja (na iPhoneu prvo „Dodaj na početni ekran") i pošalje probno | `/moja` → „Obavještenja na telefon" |

**Rješenje o imenovanju nije zakonski obrazac** i tako se i predstavlja — pisani trag ko
sprovodi postupke iz čl. 36 i ko javlja UBH po čl. 28.

---

## Pravni okvir — Crna Gora, provjereno

**Obrazac 6 ne postoji u Crnoj Gori.** To je srpski obrazac iz Pravilnika o evidencijama
BZR. Crnogorski inspektor ga ne traži i ne priznaje. Nosivi propis je zakonodavstvo o
hrani, a nadzor vodi **UBH** (Uprava za bezbjednost hrane, veterinu i fitosanitarne
poslove).

| Propis | Broj | Članovi |
|---|---|---|
| Zakon o bezbjednosti hrane | **59/2026** (objavljen 04.05.2026) — stavio 57/15 van snage | čl. 27, 28, 35, 36, 43, 47, 82 — provjereni, tabela ispod |
| ~~Zakon o bezbjednosti hrane~~ | ~~„Sl. list CG" 57/15~~ | ~~41 sledljivost · 42 povlačenje · 44 transport i obuka · 46 HACCP · 48 registracija · 82 kazne~~ — **prestao da važi** |
| Pravilnik o registraciji i odobravanju objekata | „Sl. list CG" **111/2022** | taksa 30 € |
| Pravilnik o sledljivosti | „Sl. list CG" **48/16** | identifikacija serije |
| Zakon o zaštiti stanovništva od zaraznih bolesti | „Sl. list CG" **12/2018, 64/2020** | **čl. 31** — sanitarne knjižice, izričito pominje **distribuciju**; čl. 69 kazna 2.500–20.000 € |
| **Uredba o higijeni hrane** | „Sl. list CG" **91/2026** (na snazi od 07.07.2026) | čl. 7 HACCP i dokazi · čl. 16 kazne 500–10.000 € · Dio 4 transport · Dio 13 kultura bezbjednosti hrane (obuka i nadzor) |
| Vodič za dobru higijensku praksu | UBH, v1.0, 03.05.2023 | Prilozi 1–14 |

**Važeći propis je Zakon o bezbjednosti hrane, „Sl. list CG" 59/2026.**
Usvojen 27.04.2026, objavljen 04.05.2026, **na snazi od 12.05.2026** (čl. 88 — osmog dana
od objave). Čl. 87 je stavio van snage raniji zakon 57/15.

Brojevi članova pročitani iz teksta zakona 14.09.2026. Potvrđeni dvostruko: iz naslova
članova i iz unakrsnih poziva u kaznenim odredbama.

| Tema | Novi zakon 59/2026 | Bilo u 57/15 |
|---|:-:|:-:|
| **Sljedljivost** — u svim fazama, sistem za identifikaciju dobavljača i kupaca, označavanje serije | **čl. 27** | 41 |
| **Povlačenje** nebezbjedne hrane i obavještavanje nadležnog organa; st. 3 izričito pominje **distribuciju** | **čl. 28** | 42 |
| **Zahtjevi za higijenu hrane** — st. 2: zahtjeve propisuje Vlada, dakle Uredba o higijeni hrane | **čl. 35** | 44 |
| **HACCP** — uspostaviti, primjenjivati i kontinuirano održavati postupke; st. 2 izmjena proizvoda/procesa → izmjena postupaka (naplativa revizija); posljednji stav: ko ne može identifikovati KKT dužan je da uspostavi **dobru higijensku praksu** | **čl. 36** | 46 |
| **Vodiči za dobru higijensku praksu i primjenu HACCP-a** | **čl. 47** | — |
| **Registracija objekata** — prije otpočinjanja djelatnosti | **čl. 43** | 48 |
| **Kazne** | **čl. 82** | 82 |
| Ponovljeni prekršaj | čl. 83 | — |
| Rok za podzakonske akte | čl. 84 | — |
| Prestanak važenja 57/15 | čl. 87 | — |
| Stupanje na snagu | čl. 88 | — |

**Kazne, čl. 82 — više NISU višekratnik najniže cijene rada, nego fiksan iznos:**

| Ko | Iznos |
|---|---|
| pravno lice | **2.000 – 20.000 €** |
| preduzetnik | 1.000 – 6.000 € |
| odgovorno lice u pravnom licu i fizičko lice | 500 – 2.000 € |

> ### Obuka zaposlenih: nije u Zakonu, JESTE u novoj Uredbi — provjereno 26.09.2026
>
> **Zakon o bezbjednosti hrane 59/2026: nema je.** Pretražen cio tekst (obuk, obuč, osposob,
> edukac, znanj, upućen, instru). Jedina „obuka" u zakonu je obuka službenih lica (inspektora).
> Čl. 35 kaže da zahtjeve higijene propisuje Vlada — dakle Uredba.
>
> **Uredba o higijeni hrane, „Sl. list CG" 91/2026** (Vlada CG, objavljena 29.06.2026, **na
> snazi od 07.07.2026**, donesena na osnovu Zakona 59/2026; stavila van snage raniju Uredbu i
> njene tri izmjene). Snimci teksta su u `zakoni/`. Ranija bilješka ovdje („ni u Uredbi nema
> obuke", 16.09.2026) odnosila se na STARU Uredbu i više ne važi.
>
> | Gdje | Šta traži |
> |---|---|
> | **čl. 7** | HACCP postupci; st. 3 izmjena proizvoda/procesa → preispitati i izmijeniti postupke; st. 5 — na zahtjev Uprave **dostaviti dokaze** o usaglašenosti, dokumentacija **redovno ažurirana**, ostala dokumentacija i evidencije **se čuvaju** |
> | **čl. 16** | **kazna 500 – 10.000 € za pravno lice** — između ostalog: nije uspostavio HACCP postupke (čl. 7 st. 1), nije ih preispitao pri promjeni (st. 3), ne dostavi dokaze (st. 5 t. 1), dokumentacija nije ažurna (t. 2), ne čuva evidencije (t. 3), ne pridržava se opštih zahtjeva iz Priloga 2 (čl. 6 st. 2) |
> | **Dio 4 — Transport** | vozila čista i održavana; razdvajanje robe; po potrebi vozilo koje održava temperaturu **koja se može pratiti** (st. 7) — D1 i temperatura pri predaji |
> | **Dio 13 — Kultura bezbjednosti hrane** | subjekat je dužan da **uspostavi, čuva i pruži dokaze** o kulturi bezbjednosti hrane: informisanje zaposlenih o opasnostima, otvorena komunikacija o odstupanjima; **odgovorna lica obezbjeđuju sprovođenje odgovarajuće obuke i nadzora zaposlenih** (st. 2 t. 4) i provjeravaju vođenje dokumentacije |
>
> **Neprovjereno:** koji Prilog nosi Dio 4 i Dio 13 (vjerovatno Prilog 2, pa kazna iz čl. 16 t. 4),
> i postoji li zaseban **Dio 12 „Osposobljavanje"** kao u EU 852 (Poglavlje XII). *(likely — nije
> u fascikli.)*
>
> **ŠTA TO ZNAČI ZA PRODAJU.**
> - Obuka i nadzor zaposlenih **smiju se citirati kao obaveza iz Uredbe 91/2026, Dio 13** — ne kao
>   obaveza iz Zakona.
> - **Provjera znanja sa pitanjima i rezultatom i dalje nije propisana** — ni Zakon ni Uredba ne
>   određuju oblik obuke. Prodaje se kao **dokaz** da je obuka sprovedena i da ima efekta (Dio 13 traži
>   dokaze; Vodič UBH Prilog 13 i 14). Nikad kao „zakon traži test".
> - **Tvrda obaveza sa posebnom kaznom su sanitarne knjižice** — Zakon o zaštiti stanovništva od
>   zaraznih bolesti, čl. 31, kazna 2.500–20.000 €. To je ljekarski pregled, ne obuka. Ne miješati.

**Podzakonski akti sa osnovom u 57/15 OSTAJU NA SNAZI** — čl. 84: novi propisi se donose
u roku od 18 mjeseci od stupanja na snagu (dakle do ~12.11.2027), a do tada se primjenjuju
stari *„ako nijesu u suprotnosti sa ovim zakonom"*. Pravilnik o sledljivosti 48/16 se i dalje
citira; Uredba o higijeni hrane je već nova — 91/2026 (vidi okvir iznad).

**Prelazni rokovi (čl. 85 i 86) — provjereno, NE pogađaju običnog distributera:**
šest mjeseci važi za objekte sa tradicionalnim postupcima proizvodnje (čl. 39), tri
mjeseca za predmete i materijale u kontaktu sa hranom (istekao 12.08.2026), a planovi
unapređenja za objekte III kategorije idu do 31.12.2030. **Distributeru registrovanom po
starom zakonu novi zakon ne daje rok za ponovnu registraciju.** Ne prodavati kao rok.

~~Broj Sl. lista za Uredbu o higijeni hrane nije provjeren~~ — **riješeno 26.09.2026:** 91/2026
(registar propisa, status „Važeći"; snimak u `zakoni/`).

**Obrasci D1–D5** (vozila, utovar, isporuka, povlačenje, reklamacije) su autorski rad.
Zvanični crnogorski vodič pokriva ugostiteljstvo i trgovinu, **ne distribuciju.**
Nikad ih ne predstavljati kao zvanične obrasce.

---

## Jezik i ton

- Dokumentacija i cijeli interfejs su na **ijekavici**: bezbjednost, sledljivost, mlijeko,
  prijem, obavještenje, mjera, vrijeme. Ekavica odaje da je predložak prepisan iz Srbije.
- Nazivi propisa se pišu onako kako glase u Službenom listu.
- Poruke u aplikaciji su **kratke i govore šta da se uradi**, ne šta je greška.
  Loše: „Validacija nije uspjela." Dobro: „Odstupanje bez zapisane mjere je nalaz protiv
  firme, ne protiv zaposlenog."

---

## Mapa aplikacije

### Stack i tok jednog zahtjeva

React 19 + TypeScript + Vite (`src/`) · Express 5 + TypeScript (`server/`, pokreće se kroz `tsx`) ·
PostgreSQL na Supabase (`db/`) · Render, jedan servis po klijentu.

```
pregledač  src/pages/*.tsx  ──►  src/lib/api.ts  (zaglavlje x-zahtjev-app, kolačić pilot_sesija;
   │                                            x-kljuc-zahtjeva za nov prijem i novu isporuku)
   │  bez mreže (#85): upis sa terena ──► src/lib/izlaz.ts (red na telefonu) ──► kad dođe signal:
   │                                      isti ključ + x-uradjeno-at (vrijeme kad je urađeno)
   │  public/sw.js: aplikacija sačuvana na telefonu, GET /api — mreža, pa posljednje sačuvano
   │
   ▼
server/index.ts   1. JAVNO: samo /api/zdravlje i prijava/odjava (javniRuter())
                  2. GRANICA PRIJAVE: app.use("/api", requireAuth) — jedna, za sve ispod
                  3. ruteri /api/*  (server/routes/*.ts) — zod šema, requireUloga NA SVAKOJ RUTI, odgovor
                  provjeriRute() pri startu: ruta bez uloga / ruter sa .use → server ne kreće (invarijanta #44)
   │
   ▼
server/services/*.ts   SQL i poslovna pravila, transakcije, audit (audit_log — jedini dnevnik)
                       brojevi dokumenata SAMO iz brojeviService.sljedeciBroj()
                       pushService: petlja 5 s šalje potvrđena obavještenja na telefone
                       rokoviService: 30 s po startu pa svaki sat — „Istekao rok“ odgovornom licu
   │
   ▼
PostgreSQL   tabele + pogledi (v_*) · migracije db/NN_*.sql, stanje u schema_migracije
```

### Moduli

| Modul | Strana | Ruta (`server/routes/`) | Servis (`server/services/`) | Glavne tabele |
|---|---|---|---|---|
| Prijava, sesije | `/prijava`, prisilna promjena lozinke | `auth.ts` | `server/auth.ts` | `korisnik`, `sesija_prijave` |
| Ljudi | `/ljudi` (zaposleni, plan obuke, provjera znanja, nalozi); ulaz u provjeru na `/moja` i `/tabla` | `ljudi.ts`, `provjeraZnanja.ts` | `ljudiService`, `provjeraZnanjaService` | `lice`, `korisnik`, `plan_obuke`, `pitanje`, `sesija_znanja`, `ucesnik_znanja`, `odgovor_znanja` |
| Šifarnici | `/sifarnici` | `sifarnici.ts` | `skladisteService` | `kupac` (+ PIB, adresa isporuke), `dobavljac` (PIB jedinstven), `artikal` (+ `rok_obavezan`), `skladiste` |
| Prijem — KKT 1 | `/prijem` | `prijem.ts` | `prijemService`, `haccpService` | `prijem`, `prijem_stavka`, `lot`, `zaliha`, `kretanje_zalihe` |
| Otpremnica (PDF / fotografija), forma prijema | `/prijem` → Novi prijem → „Slikaj / PDF / Ručno“ (`src/components/NoviPrijem.tsx`) | `prijem.ts` (`/prijem/otpremnica`) | `otpremnicaService` | `prijem_dokument`, `artikal_dobavljaca`, `prijem_stavka.po_otpremnici` |
| Zalihe, otpis, karantin povrata | `/zalihe` | `zaliha.ts` | `otpisService` (+ `rokoviService` — rok robe) | `zaliha`, `kretanje_zalihe` |
| HACCP — KKT 2, obrasci | `/haccp` | `haccp.ts` | `haccpService` (`praviloZaMjerenje`, `provjeriTermometar`), `obrasciService` (čita `public/obrasci-cg.json`, ocjenjuje odgovore) | `kontrolna_tacka`, `pravilo_kontrole`, `mjerenje_temperature` (+ `mjerni_uredjaj_id`), `zapis` |
| Neusaglašenosti | `/neusaglasenosti` | `neusaglasenosti.ts` | `ncService` | `neusaglasenost`, `korektivna_mjera`, `verifikacija` |
| Vozila — D1 | `/vozila` | `vozila.ts` | `vozilaService` (ocjena temperature po granici vozila, `D1_DANAS`) | `vozilo` (režim od–do), `kontrola_vozila` (+ granica i ocjena temperature) |
| Isporuka — KKT 3 | `/isporuka`; otpremnica za štampu `/isporuka/:id/otpremnica` (`OtpremnicaStampa.tsx`) | `isporuka.ts` | `isporukaService` (rezervacija, otkaz, `otpremnicaZaStampu`) + `lotBlokadaService` („Ne predajte lot“, manjak rezervacije), `kljucService` | `isporuka` (+ otkaz), `isporuka_stavka`, `kljuc_zahtjeva`, `v_zaliha_dostupna` (+ rezervisano, slobodno) |
| Sledljivost, povlačenje | `/sledljivost` | `sledljivost.ts`, `povlacenje.ts` | `sledljivostService`, `povlacenjeService` | `povlacenje`, `povlacenje_kontakt`, `v_sledljivost_*` |
| Zadaci, obavještenja, poruke (šalju SVI — #67; na `/poruke` primljene i poslate zajedno, po vremenu — `/poruke/primljene`) | `/moja`, `/tabla`, `/poruke` | `zadaci.ts`, `poruke.ts` | `zadaciService`, `porukeService` | `zadatak`, `obavjestenje`, `poruka` |
| Obavještenja na telefon (push) | `/moja` → „Obavještenja na telefon"; `public/sw.js`, `public/manifest.webmanifest` | `push.ts` | `pushService` | `push_pretplata`, `web_push_kljuc`, `obavjestenje.push_poslato_at` |
| Kontrolni centar, aktivnost | `/tabla` (direktor: `DirektorPregled.tsx`, `/tabla/direktor` — #95) | `tabla.ts` | `tablaService` (+ `monitoringService`, `haccpPlanService` za kartice „Danas fali po planu", „HACCP rokovi"); direktor — `stanjeService.pregledDirektora` | čita sve (aktivnost = unija domenskih tabela) |
| HACCP plan: plan monitoringa, kontrolne tačke, termometri, verifikacija sistema | `/haccp-plan`; štampa `/prilozi` → HACCP plan; „Danas po planu" na `/moja` | `haccpPlan.ts` | `monitoringService` (šta danas fali), `haccpPlanService` (termometri, verifikacija, podaci za štampu), `pravilaService` (granica artikla → pravilo) | `plan_monitoringa`, `mjerni_uredjaj`, `provjera_uredjaja`, `verifikacija_sistema`, `kontrolna_tacka` (opasnost, mjera, verifikacija) |
| Prilozi, izvještaji, izvoz | `/prilozi`; `/izvjestaji` samo konsultant (#93) | `izvoz.ts`, `firma.ts` | `izvozService` | `firma`, pogledi `v_izvoz_*`, `v_plan_obuke`, `v_evidencija_osposobljavanja` |
| Stanje poslovanja — izvještaj direktoru | `/stanje` (samo konsultant): period dan … godina, pregled mejla, primaoci, „Pošalji direktoru“, „Sačuvaj PDF“ (štampa pregledača), „Preuzmi HTML“ | `stanje.ts` | `stanjeService` (+ `pregledPlana`, `listaUredjaja`), `nodemailer` (SMTP iz env) | samo čita; `firma.izvjestaj_primaoci`, `izvjestaj_poslat` (trag slanja) |
| Inspekcijski paket | `/inspekcija` (meni „Za inspekciju“): štampa / PDF i ZIP sa CSV | `inspekcija.ts` | `inspekcijaService` (+ `pregledPlana` iz `monitoringService`, `izvezi` iz `izvozService`), `server/zip.ts` | samo čita (sve evidencije za period) |
| Audit | `/audit` („bilo → sada“) | `audit.ts` | `auditService` (`stanjeReda`, `logIzmjenaReda`) | `audit_log` (`dogadjaj` se od faze 4 ne puni — stari redovi ostaju) |
| Bekap | `/tabla` (kartica „Preuzmi bekap sada“) — preuzima se, u bazi samo trag (#68); pun bekap je `npm run bekap` | `bekap.ts` | `bekapService` (`pisiBekap`, sedmični podsjetnik) | `bekap_log` (ko je i kad preuzeo) |
| Rad bez interneta (#85) | traka na vrhu svake strane (`VanMreze.tsx`), „Sačuvano na telefonu“; red `src/lib/izlaz.ts`; `public/sw.js` | `vanMreze.ts` (odbijeni upisi) + posrednik `server/vanMreze.ts` na D1, predaji, mjerenju, zapisu i prijavi problema | `vrijemeVanMreze()` u `vozilaService`, `isporukaService`, `haccpService`, `ncService` | `van_mreze_odbijeno`, `kljuc_zahtjeva`, kolona `van_mreze` (`potvrda_van_mreze` na isporuci) |
| Podešavanje (konsultant) | `/admin` | `firma.ts`, `provjeraZnanja.ts` | — | `firma`, banka pitanja konsultanta |

Meni i ko smije na koju stranu: `STAVKE` u `src/components/Layout.tsx` (isti spisak koristi
`mozeNa()` za linkove iz obavještenja). Rute i uloge u pregledaču: `src/App.tsx`. **Prava stvarno
provjerava server** (`requireUloga` po ruti) — meni samo sakriva.

### Uloge

| Uloga | Ko | Prva strana | Upis unazad (`PROZOR`) | Šta radi |
|---|---|---|:-:|---|
| `izvodjac` | konsultantkinja | `/tabla` | 30 dana | sve što i `bzr` + Podešavanje, banka pitanja konsultanta; otvara sve naloge osim `izvodjac`; **Izvještaji (izvoz) i Stanje poslovanja** — samo on (#93) |
| `bzr` | odgovorno lice | `/tabla` | 7 | odluke o prijemu, karantin povrata sa isporuke (pusti / otpiši), mjere i provjera neusaglašenosti, povlačenje, nalozi `operater`/`vozac`, pitanja firme, HACCP plan (plan monitoringa, termometri, verifikacija), inspekcijski paket, poruke |
| `uprava` | direktor | `/tabla` | — (samo gleda) | SVOJ Kontrolni centar (#95): semafor „šta traži vašu odluku“, četiri broja za 7 dana, zapisi po danu za 14 dana, povlačenje u toku, aktivnost uživo (sklopljena); inspekcijski paket, poruke, Moja strana. Bez zaliha, HACCP plana i sledljivosti u meniju, bez zadataka, unosa i provjere znanja (ako ne rukuje hranom — #94) |
| `operater` | magacioner | `/moja` | 1 | prijem, zalihe i otpis, obrasci P3–P10 (i ispravka SVOG zapisa — #57), isporuka (samo svoje — #51; i otkaz svoje u pripremi — #63), prijava problema, SVOJA korektivna mjera; „Danas po planu" na Mojoj strani; provjera termometra (API) |
| `vozac` | vozač | `/moja` | 1 | isporuka i potvrda sa temperaturom (KKT 3) — samo dodijeljene (#51), kontrola vozila D1 (sa temperaturom — #55), prijava problema, SVOJA mjera; „Danas po planu" |

`PROZOR`, `NA_TERENU`, `ogranicenjeDatuma()`, `provjeriProzorUpisa()`, `izvrsilacZa()`,
`samoMoje()`, `smijeDodijelitiUlogu()` — sve u `server/auth.ts`.

### HACCP tok kako ga kod stvarno sprovodi

| Tačka | Šta se upisuje | Van granice → |
|---|---|---|
| **otpremnica** | PDF ili fotografija → server pročita (PDF tekst / lokalni OCR) i POPUNI formu; magacioner upoređuje sa robom i potvrđuje kvačicom | nesigurna polja žuta; dobavljač po PIB-u, pa po nazivu, a nepoznatog upisuje odgovorno lice — magacioner mu javlja (#71); artikal po zapamćenoj vezi, pa po šifri/nazivu uz isto pakovanje i procenat (#72), a nepoznat dolazi kao nov artikal sa pretpostavljenim režimom (#73); manjak i drugi lot se vide uz stavku |
| **plan monitoringa** | `plan_monitoringa`: šta (mjerenje na KKT / obrazac / D1 za vozilo), koliko često, koliko puta, ko (uloga, skladište) | ništa se ne blokira — „Danas po planu" na `/moja`, kartica „Danas fali po planu · juče propušteno" na tabli, propušteni dani na `/haccp-plan` |
| **KKT 1 — prijem** | stavke sa lotom (bez lota odbijeno) i rokom (osim artikla izuzetog od roka, #64); ista serija jednom po prijemu; temperatura **obavezna za robu pod režimom** (`TEMPERATURA_OBAVEZNA`), ocjena po `pravilo_kontrole` KKT1 artikla | mjerenje FAIL → neusaglašenost + zadatak + obavještenje `bzr` i uprava + **lot na HOLD**. Artikal sa NEPOTVRĐENOM granicom → samo WARNING i obavještenje `bzr`, bez HOLD-a (invarijanta #5) |
| odluka o lotu | `bzr`: prihvati / HOLD / odbij (odbijanje traži razlog). **Istekao rok se ne prihvata i ne pušta** (`ROK_ISTEKAO`); pri prijemu takve robe `bzr` odmah dobija obavještenje | prihvaćeno → zaliha DOSTUPNO + kretanje PRIJEM; HOLD → KARANTIN + kretanje PRIJEM; magacioner dobija obavještenje |
| **lot na HOLD-u** | `bzr`: **pusti** (razlog obavezan) ili **odbij** — na `/zalihe` i `/prijem` | pušteno iz karantina → DOSTUPNO, kretanje RELEASE 0; odbijeno → karantin 0, kretanje OTPIS. Zadržan pri prijemu (zaliha još ne postoji) → pušten = PRIJEM. **Ne pušta se dok je povlačenje U_TOKU**. Čim lot pređe na HOLD (mjerenje ili povlačenje), isporuke U_PRIPREMI sa njim dobijaju „Ne predajte lot“ (#53) |
| **KKT 2 — skladištenje** | ručno mjerenje na `/haccp`; lot po granici SVOG artikla (#59), uz izabran termometar (#60) | kao KKT 1 (ako je vezano za lot — HOLD) |
| obrasci P3–P10 | `zapis` iz `public/obrasci-cg.json`; da/ne bez podrazumijevanog odgovora; odstupanje slijedi i iz odgovora (`odstupanjeAko`, #58) i traži korektivnu mjeru; ispravka po #57 | neusaglašenost odmah u „čeka provjeru" — mjera iz obrasca je upisana kao urađena, potpisuje je ko je unio zapis; zadatak + obavještenje `bzr`. Ispravka zapisa ne otvara drugu |
| **D1 — vozilo** | kontrola prije utovara (vidi samo vozač, invarijanta #24): čistoća, oprema, vrata + temperatura po granici rashladnog vozila (#55) | vozilo NIJE_SPREMNO → isporuka tim vozilom odbijena; neusaglašenost (temperatura → VISOK). „Spremno“ važi za dan kontrole; predaja traži današnju D1 |
| **KKT 3 — isporuka** | priprema drži robu (rezervacija, #62); otkaz prije predaje uz razlog (#63); otpremnica za štampu ide uz robu (#65). Potvrda + temperatura pri predaji (obavezna za robu pod režimom; u formi jedna po grupi robe istog režima); ocjena SAMO po pravilu KKT3 artikla. U trenutku predaje server PONOVO provjerava lot i zalihu, sve stavke obavezne (#48) | FAIL → neusaglašenost; lot u magacinu se NE zadržava (problem je u prevozu). Nepredato i odbijeno → KARANTIN, `bzr` pušta ili otpisuje (#49) |
| **rok robe** | `rokoviService`: lot sa isteklim rokom na slobodnoj zalihi | ne isporučuje se — ni priprema, ni izmjena, ni predaja (`ROK_ISTEKAO`); ne vraća se iz karantina; kartica „Rok robe“ na tabli; `bzr` obavještenje jednom po lotu (#50) |
| **termometar** | interna provjera (referentna vs izmjereno — rezultat računa server) ili kalibracija (broj sertifikata obavezan) | NEISPRAVAN → neusaglašenost (sa brojem upitnih mjerenja) + zadatak + obavještenje `bzr`; traka upozorenja na `/haccp`; mjerenja njime od posljednje dobre provjere „upitna“; njime se više ne mjeri (#60). Istekla provjera/kalibracija → kartica „HACCP rokovi" |
| **verifikacija sistema** | revizija HACCP plana, interni audit, vježba povlačenja — jednom godišnje | POTREBNE_IZMJENE → zadatak (`verifikacija_sistema`); KASNI / NIJE_RADJENO → „HACCP rokovi" |
| problem na isporuci | „Problem" na isporuci → neusaglašenost vezana za isporuku | zadatak + obavještenje `bzr` |
| **neusaglašenost** | 4 koraka: prijava → mjera (kome, rok) → urađeno (samo dodijeljeni, uz opis) → provjera drugog lica. Ili **„Riješeno je“** (vodstvo): mjera + provjera jednim upisom (#89) | provjera SAMO iz „čeka provjeru"; mjeru koja se provjerava bira server (posljednja urađena), ne pregledač. Zadatak se zatvara sam; prijavilac dobija obavještenje. Izuzetak od četiri oka — invarijanta #41. Iz kontrole (mjerenje, D1, termometar) — tek kad ponovna kontrola prođe (#61); iz povlačenja — tek kad je povlačenje završeno |
| **povlačenje** (čl. 28) | povlači se SERIJA — isti dobavljač, artikal i broj lota kroz sve prijeme (#64); kontakti iz stvarnih isporuka serije | svi lotovi serije na HOLD, zaliha u karantin; nijedan se ne pušta dok je povlačenje u toku; zatvara se tek kad su svi pozvani |

### Migracije (`npm run migriraj`, redoslijed nije proizvoljan)

| Fajl | Šta |
|---|---|
| `01_organizacija` | `firma` (jedan red), `korisnik`, `uloga_t` |
| `02_ljudi` | `lice` (svi zaposleni, šifra, knjižica), `plan_obuke` |
| `03_sifarnici` | `dobavljac`, `kupac` (telefon obavezan), `artikal` (granice, `granica_potvrdio`) |
| `04_prijem_lot` | `prijem`, `lot`, `prijem_stavka` |
| `05_zaliha` | `zaliha` (po lotu i statusu), `kretanje_zalihe` (dnevnik) |
| `06_haccp` | `kontrolna_tacka`, `pravilo_kontrole` (verzionisano), `mjerenje_temperature`, `zapis` |
| `07_neusaglasenosti` | `neusaglasenost`, `korektivna_mjera`, `verifikacija` |
| `08_vozila_isporuka` | `vozilo`, `kontrola_vozila`, `isporuka`, `isporuka_stavka` |
| `09_zadaci_obavjestenja` | `zadatak`, `obavjestenje` |
| `10_events_audit` | `dogadjaj`, `audit_log` |
| `11_provjera_znanja` | `pitanje`, `sesija_znanja`, `ucesnik_znanja`, `odgovor_znanja` |
| `12_pogledi` | `v_lica`, `v_plan_obuke`, `v_zaliha_dostupna`, `v_sledljivost_*`, `v_evidencija_osposobljavanja`, … |
| `13_demo_cg` | **demo podaci — samo `npm run seed:demo`, samo demo baza** |
| `14_povlacenje` | `povlacenje`, `povlacenje_kontakt` |
| `15_isporuka_uneo_cg` | `isporuka.uneo_korisnik_id` |
| `16_bekap_cg` | `bekap_log` (bekap u ISTOJ bazi — od dopune 35 samo trag preuzimanja) |
| `17_naknadno_cg` | pogledi sa `naknadno_dana` za izvoz |
| `18_temperatura_predaje_cg` | `isporuka_stavka.temperatura_predaje` (KKT 3) |
| `19_skladista_poruke_cg` | `skladiste` (+ veze na prijem/isporuku/nalog), `poruka` |
| `20_sesije_prijave_cg` | `sesija_prijave` (heš tokena); server je pravi i sam pri startu |
| `21_pitanja_firme_cg` | `pitanje.izvor` (konsultant/firma), prag i izvor pitanja na terminu |
| `22_integritet_cg` | CHECK na `izvor_tip` u `neusaglasenost`, `zadatak`, `obavjestenje` (nalaz B2); isti spisak kao `IZVORI_*` u `zadaciService.ts` |
| `23_otpremnice_cg` | `prijem_dokument` (PDF/slika u bazi — ulazi u bekap), `artikal_dobavljaca` (zapamćena veza „njihov → naš artikal"), `prijem_stavka.po_otpremnici` |
| `24_haccp_sistem_cg` | `plan_monitoringa`, `mjerni_uredjaj`, `provjera_uredjaja`, `verifikacija_sistema`; `kontrolna_tacka` + opasnost/mjera/verifikacija; `verifikacija.izuzetak_cetiri_oka`; proširene CHECK liste izvora; pravila KKT1/KKT3 iz postojećih granica artikala |
| `25_push_cg` | `push_pretplata` (po uređaju), `web_push_kljuc` (VAPID, jedan po bazi), `obavjestenje.push_poslato_at` (izlazni red; sva ranija označena kao poslata) |
| `26_talas1_cg` | CHECK zaliha ≥ 0 i količine stavke isporuke (`NOT VALID`, pa provjera starih redova — ako ne prođe, samo `notice`, a pravilo važi za nove upise); `kljuc_zahtjeva` (R-10) |
| `27_talas2_cg` | `mjerenje_temperature.mjerni_uredjaj_id` (R-23); `kontrola_vozila` + `granica_min/max`, `temperatura_ok` (R-05); jedinstven `zapis.ispravlja_id` (R-07, u `do`-bloku — grananje na staroj bazi daje `notice`); pogledi za izvoz `v_izvoz_kontrole_vozila`, `v_izvoz_provjere_nc`, `v_izvoz_termometri`, `v_izvoz_verifikacija_sistema`, `v_izvoz_kretanja_zalihe` (R-20) |
| `28_talas3_otkaz_cg` | samo `isporuka_status_t` + `OTKAZANA` — nova vrijednost enuma u svom fajlu (ne smije se koristiti u istoj transakciji) |
| `37_stanje_poslovanja_cg` | `firma.izvjestaj_primaoci` (kome ide „Stanje poslovanja“), `izvjestaj_poslat` (ko je, kad i kome poslao koji period; RLS) — #93 |
| `36_kontrolne_tacke_cg` | KKT 1–3 za bazu koja već ima firmu, a nema tačke (na novoj ih pravi `prvi-korisnik`, na demo `13_demo_cg`) + pravila za artikle sa granicom bez pravila (#91) |
| `35_bekap_preuzimanje_cg` | `bekap_log.podaci` može biti prazno + `velicina_bajtova`; stare kopije podataka obrisane (bekap se više ne čuva u bazi, #68) |
| `34_van_mreze_cg` | rad bez interneta (#85): `van_mreze` na mjerenju, D1, zapisu i neusaglašenosti, `isporuka.potvrda_van_mreze`; `van_mreze_odbijeno` (sa RLS-om) |
| `33_talas5_cg` | potvrda u dva koraka (`korisnik.totp_*`, `prijava_izazov`) i dnevnik grešaka (`greska_log`) — obje tabele sa RLS-om (#78, #80, #81) |
| `32_bezbjednost_baze_cg` | RLS na svim tabelama šeme public (bez politika), pogledi `security_invoker`, `anon`/`authenticated` bez prava i bez podrazumijevanih prava — samo gdje te uloge postoje (#78, R-12) |
| `31_magacin_mjerenja_cg` | `mjerenje_temperature.skladiste_id`, `zapis.skladiste_id` (#77); stari redovi popunjeni gdje se zna (lot → magacin prijema; firma sa jednim magacinom) |
| `30_bekap_bez_tajni_cg` | iz bekapa već sačuvanih u `bekap_log` briše heševe lozinki (R-19) |
| `29_talas3_cg` | otkaz isporuke (`otkazano_at`, `otkazao_korisnik_id`, `razlog_otkaza` + CHECK), `v_izvoz_isporuke` ponovo (B5); `artikal.rok_obavezan`; jedinstvena serija u prijemu i indeks serije; `kupac.pib`, `kupac.adresa_isporuke`, jedinstven PIB kupca i dobavljača (u `do`-blokovima); `v_zaliha_dostupna` + `rezervisano`, `slobodno` |

Postojeći fajl se **nikad ne mijenja** — ispravka je nov fajl sa sljedećim brojem.

### Alati (`alati/`, pokreću se sa računara konsultantkinje)

| Alat | Šta radi |
|---|---|
| `npm run prvi-korisnik -- --firma … --ime … --korisnik … [--konsultant …]` | prvi nalozi u NOVOJ bazi: `bzr` i (preporučeno) `izvodjac`; jedna transakcija, audit, privremene lozinke. Ispiše u koju bazu upisuje; bazu koja već ima `bzr`/`izvodjac` odbija (demo iz `.env`!). Samo `--konsultant …` — konsultant naknadno |
| `npm run uvoz-start -- --fajl … [--upisi]` | fajl iz upitnika (`upitnik-start/`) u bazu NOVOG klijenta, posle `prvi-korisnik` (#92). Bez `--upisi` samo pokaže (ista transakcija, pa rollback) |
| `npm run dnevni-pregled` | stanje svih klijenata iz `alati/klijenti.txt` (+ veličina baze i otpremnica); izlazni kod 1 ako je neko u zastoju ili mu je baza ≥ `BAZA_UPOZORENJE_MB` (400). `KLIJENTI_FAJL=` drugi spisak (test ga usmjerava na nepostojeći, da gleda samo `DATABASE_URL`) |
| `alati/napravi-licencu.ts` | licencni ključ za ugovor (papirni trag, aplikacija ga ne provjerava) |
| `npm run demo-lozinke` | nove lozinke pet demo naloga, SAMO na demo bazi; upiše ih u `.env` (`DEMO_LOZINKA_*`) za `test:e2e` |
| `npm run iskljuci-2fa -- --korisnik ime` | isključi 2FA nalogu bez telefona i rezervnih kodova (#81); prekida prijave, audit |
| `npm run zakazi-bekap` | `npm run bekap` u Windows Task Scheduler — svaki dan 13:00 (`-Vrijeme`, `-Ukloni`); pokreće vlasnica |
| `npm run demo:lokalno` | aplikacija na LOKALNOJ probnoj bazi sa demo podacima (http://localhost:5059, isti klaster kao `npm test`, baza `pilot_lokalno`) — za klik kroz ekrane bez žive baze |
| `npm run bekap` (`alati/bekap.ts`) | `pg_dump` svake baze iz `klijenti.txt` (ili `DATABASE_URL`) u `bekap/<klijent>/`, samo šema `public`, **bez podataka sesija** (živi tokeni). Svaki fajl se odmah provjeri (`pg_restore --list`), stariji od 90 dana se brišu, ishod u `bekap/POSLJEDNJI-BEKAP.txt`, izlazni kod 1 ako ijedan klijent padne. `bekap/` je u `.gitignore`. Treba mu `pg_dump` ≥ verzije servera (traži najnoviji u `C:/Program Files/PostgreSQL`, ili `PG_DUMP=`). |

`alati/klijenti.txt` ima lozinke baza — u `.gitignore` je i ostaje.

### Testovi (`testovi/`)

| Komanda | Baza | Kad |
|---|---|---|
| **`npm test`** | SOPSTVENA, svaki put čista: klaster u `.testbaza/` (port 54329, bez lozinke, samo localhost) iz PostgreSQL-a instaliranog na računaru; server na 5055 sa `SAMO_API=1` | **uvijek prvo ovo** — Render-ova demo baza se ne dira |
| `npm run test:ekrani` | kao `npm test`, pa `vite build` i server KAO NA RENDERU (produkcija, service worker); Chrome bez prozora u veličini telefona (375 × 812) | posle izmjene ekrana — `testovi/ekrani/*.ekran.mjs` |
| `npm run test:ci` | `TEST_DATABASE_URL` (mora biti localhost) — API testovi pa ekrani (`--sve`) | GitHub Actions (`.github/workflows/testovi.yml`) na svaki push na `main` |
| `npm run test:e2e` | demo baza iz `.env`, server koji već radi | samo kad treba provjeriti baš demo bazu |

26 testova, 673 provjere (na čistoj bazi; na demo bazi dvije manje — preskaču se, a obavezna 2FA se provjerava samo lokalno), kroz svih pet uloga: pristup (svaka uloga × svaka adresa), obavještenja
i zadaci, poruke i skladišta, povlačenje, provjera znanja, pitanja firme, neusaglašenost sa
terena, prilozi i izvoz, prijave, i Faza 1 (HOLD → pusti/odbij, provjera mjere, odstupanje iz
obrasca, nepotvrđena granica — `faza1_haccp`), i Faza 2 (istovremeni brojevi, lice + nalog u
jednoj transakciji, početna i nova lozinka, čitanje po ulogama, kartice direktora, nepoznat izvor
odbijen u bazi — `faza2_integritet`), i otpremnice (10 probnih u PDF-u tačno do slova, fotografija
nakrivljena i sa sjenkom — i originalna i smanjena kao iz pregledača, zapamćen artikal, drugo pakovanje i
procenat se ne uparuju, nov dobavljač i nov artikal upisani uz prijem, okrenuta i tamna fotografija, otpremnica
sa cijenama (PDF i fotografija), slika bez tabele se čuva, čitanje u pozadini (odgovor odmah, napredak, „ne čekaj“),
manjak, istekao rok — `otpremnice`; plan monitoringa po magacinu — urađeno važi za sve u magacinu, ne za drugi
magacin, ko je uradio, magacin na mjerenju i zapisu — `monitoring_magacini`; RLS na svim tabelama, pogledi po
pravima pitaoca, `anon` ne čita ni ne piše ni sa vraćenim pravom, nova tabela bez prava za javne uloge — `bezbjednost_baze`
(test baza zato pravi `anon`/`authenticated` sa podrazumijevanim pravima kao Supabase); slikovna bomba, izvoz bez Excel formula i
po Podgorici, stari heš lozinke se pojača, zdravlje javlja neprimijenjenu dopunu, dnevnik grešaka, potvrda u dva koraka od uključivanja do
obavezne na drugom serveru — `talas5`; probni fajlovi u `testovi/otpremnice/` su izmišljeni), i Faza 3
(temperatura obavezna na KKT 1, granica iz Šifarnika → pravilo sa verzijama, plan monitoringa i
„šta danas fali", termometri, verifikacija sistema, podaci za štampu HACCP plana, izuzetak od
četiri oka — `faza3_sistem`), i push (pretplata po uređaju, šifrovan sadržaj koji dešifruje samo
„uređaj", najviše jednom, 410 briše uređaj, odjava samo svog — `push`; push servis glumi lokalni
HTTP server), i talas 1 revizije (predaja zadržanog lota, isteklog lota i više nego što je na zalihi,
povrat u karantin i odluka o njemu, tuđa isporuka, isti ključ zahtjeva, sve stavke, ograničenje prijave
po imenu, stari prijem po adresi — `talas1`), i talas 2 (D1 sa temperaturom i današnja D1 za predaju, rashladno
vozilo za robu pod režimom, audit „prije“, ispravka zapisa, odstupanje iz odgovora, lot po granici svog artikla,
termometar i „upitna“ mjerenja, ponovna kontrola prije zatvaranja, novi izvori izvoza — `talas2`), i talas 3 (rezervacija i
slobodna roba, otkaz i izmjena kupca, rok obavezan i serija jednom po prijemu, drugi rok iste serije, povlačenje cijele
serije, otpremnica, jedinstven PIB — `talas3`), i mali talas 4 (bekap bez tajni, zdravlje sa bazom, 400/409 umjesto 500, zaglavlja —
`talas4`), i talas 6 (isti upis dvaput → jedan zapis, neuspio upis ne zauzima ključ, ključ u obradi → 409 `U_TOKU`, vrijeme
sa telefona i oznaka „bez mreže“, budućnost i starije od 36 h odbijeno, D1 i rok po DANU PREDAJE, kasna jučerašnja D1 ne mijenja
današnji status vozila, odbijen upis javljen odgovornom licu — `talas6`), i dorada posle probe vlasnice (D1 samo za vozilo koje
danas vozi, vozač kad mu isporuka ode ili se izmijeni, temperatura uz stavku prijema, NC unaprijed kaže šta fali i ko provjerava,
primljene poruke po vremenu, filteri izvještaja (pregled = CSV) i audita, nova verzija pitanja firme, „Riješeno je“ — jedino odgovorno lice zatvara jednim upisom, sa drugim čeka četiri oka, konsultant ne zatvara, iz mjerenja čeka ponovno mjerenje, dodijeljena mjera se završava, povlačenje mora biti završeno — `dorada`), i inspekcijski paket (prijem sa temperaturom i termometrom, mjerenje van granice i
njegova neusaglašenost, zapis upisan dan kasnije i ispravka — obje verzije, kontinuitet broji naknadne, period provjeren na serveru,
direktor ga izvlači, ZIP prolazi kontrolni zbir svakog fajla, bez audita — `inspekcija`), i alati (prvi-korisnik na novoj praznoj bazi pravi odgovorno lice, konsultanta i KKT 1–3, odbija bazu koja
već ima vodstvo i bazu bez tabela; uvoz-start — proba bez upisa, upis, ponovni uvoz bez duplikata, odbijen kupac bez telefona i
artikal bez granice, granice nepotvrđene, pravila KKT 1/3, šifra kod dobavljača, demo baza odbijena; dnevni-pregled javlja veličinu baze — `alati`). i stanje poslovanja (šest vrsta perioda sa granicama i nazivom, tekući period do danas, budućnost odbijena, nova neusaglašenost VISOK
pali crveno, primaoci, slanje kroz LAŽNI SMTP server testa — prijava na nalog, oba primaoca, HTML i tekst, trag; SMTP odbije → 502 bez traga;
Odgovorno lice, direktor i magacioner 403; direktorov Kontrolni centar — isti semafor za 7 dana, 14 dana zapisa — `stanje`; u `provjera_znanja` i:
direktor koji ne rukuje hranom ne dobija karticu i ne ulazi). **Rade samo na demo podacima** (`testovi/pomoc.mjs` provjeri pet demo naloga sa
fiksnim ID-jevima) i brišu sve što naprave. Nov tok u aplikaciji = nov test.

Demo baza nije čista — vlasnica kroz Render unosi svoje (npr. drugo skladište „Magacin Bar").
Testovi to **ne diraju**: prijem ide u „Glavni magacin" (`glavnoSkladiste()`), isporuka iz
skladišta svog lota; provjera koja traži JEDNO skladište se tada preskače i ispiše „· preskočeno".
Demo lotovi vremenom isteknu (rok je računat od dana punjenja) — test koji isporučuje demo lot bira
važeći (`nijeIstekao()` iz `pomoc.mjs`). Demo lotovi su roba pod režimom — isporuka ide rashladnim vozilom
(`rashladnoVozilo()`), a predaja uz današnju D1 (`d1Prolazi()`, temperatura u sredini granice vozila); test
vraća status vozila i briše svoje kontrole. Test koji mjeri pravi svoj ispravan termometar — ne oslanja se
na termometre demo baze. Rok je obavezan pri prijemu — testovi ga šalju (`rokZaDana()`); demo lot za isporuku se bira
po SLOBODNOJ robi (`slobodno()` — isporuke u pripremi na demo bazi drže dio zalihe).

**Testovi ekrana** (`testovi/ekrani/`, talas 6, dorada, inspekcijski paket, stanje poslovanja i pregled direktora, 55 provjera): pravi Chrome (`playwright-core`, pregledač se NE preuzima —
koristi instaliran Chrome; `PW_KANAL=msedge` za Edge; na GitHub-u je Chrome već na računaru) u veličini telefona, prijava
kroz API pa samo kolačić u pregledač (lozinka se ne kuca u pregledač). `1_uloge` — svaka strana svake od pet uloga: otvara
se, ne viri van ekrana (vodoravni skrol), nema greške u konzoli; meni na telefonu nudi samo strane uloge; sva četiri priloga
za štampu. `2_teren` — vozač D1 pa predaja kroz ekran, magacioner mjerenje sa termometrom, obrazac P9 i prvi korak prijema,
direktor — svoj pregled (semafor, četiri broja, 14 dana zapisa, bez operativnih kartica), meni sa četiri strane, „Došao inspektor“ → paket. `3_bez_mreze` — vozač bez signala: sve strane sačuvane na telefonu, D1 i predaja „Sačuvano na
telefonu“, ponovno otvaranje bez signala, pa signal → oba upisa odu sama, redom, sa oznakom. `4_dorada` (konsultant) — filteri izvještaja i
audita, Stanje poslovanja (mejl u okviru čitav na 375 px, „Pošalji“ bez SMTP kaže šta fali, „Sačuvaj PDF“ otvara izvještaj sa štampom —
sa `EKRANI_SLIKE=` sačuva i `stanje-poslovanja.pdf`), poruke Sve/Primljene/Poslate, plan obuke sa HACCP plana. `5_isporuka_nc` — magacioner čiji je matični magacin
prazan sprema isporuku; Ana zatvara neusaglašenost jednim upisom („Riješeno je“, kvačica „bez četiri oka“). `6_inspekcija` —
paket se sklopi (12 odjeljaka), isključen odjeljak nestaje i brojevi idu redom, ZIP se preuzima, u štampi samo dokument
(sa `EKRANI_SLIKE=` sačuva i `inspekcijski-paket.pdf` za pregled očima). Scenario pravi svoje podatke
(`priprema.mjs`) i briše ih. Pomoćne funkcije su u `telefon.mjs`, NE u `pokreni.mjs` (vidi „Naučeno“ — ciklus uvoza).

---

## Invarijante — ovo se ne smije pokvariti

Brojevi su stalni — kod ih navodi u komentarima („invarijanta #14"). Ukinuta invarijanta ostaje
pod svojim brojem sa oznakom „ukinuto", da se brojevi ne pomjere.

1. **Zapis se ne briše i ne mijenja.** Ispravka je NOV zapis sa `ispravlja_id` → stari. Važeći je
   onaj **na koji niko ne pokazuje**: `NOT EXISTS (SELECT 1 FROM t n WHERE n.ispravlja_id = t.id)`.
   Isto važi za potvrđenu isporuku: ispravka je neusaglašenost vezana za nju, ne prepravka.
2. **Odstupanje bez korektivne mjere se ne snima** — `CHECK` u bazi (`NOT VALID` za stare redove),
   provjera u ruti i u pregledaču. Neusaglašenost se zatvara samo iz „čeka provjeru" i samo uz
   urađenu mjeru (`ncService.verifikuj`).
3. **Prijem bez broja lota se odbija** (zod + `prijemService`). Bez lota nema sledljivosti (čl. 27).
4. **Kupac bez telefona se ne upisuje.** Povlačenje (čl. 28) počinje telefonom.
5. **Automatska ocjena samo po POTVRĐENOJ granici** (`artikal.granica_potvrdio`). Nepotvrđena je
   pretpostavka konsultanta i po njoj se ne odbija roba. Sprovedeno na JEDNOM mjestu,
   `haccpService.zabiljeziMjerenje`, za sve KKT-ove: van nepotvrđene granice = WARNING +
   obavještenje `bzr`, bez neusaglašenosti i bez HOLD-a.
6. **Terenske uloge vide samo posljednji dan** — `ogranicenjeDatuma(uloga, kolona)`; kolona se
   prosljeđuje (`z.datum`, `i.datum_isporuke`, …), dan po podgoričkom vremenu.
7. **Isporuka se veže za LOT** (`isporuka_stavka.lot_id`), ne za artikal. Lot mora biti PRIHVAĆEN,
   imati zalihu i biti u skladištu iz kog isporuka ide.
8. **FEFO** — zalihe i ponuđeni lotovi poređani po roku.
9. **Koliko unazad se smije upisati stoji na SERVERU** — `PROZOR` + `provjeriProzorUpisa()`:
   operater i vozač 1 dan, `bzr` 7, `izvodjac` 30. Datum u budućnosti se ne prima nikad.
10. **Naknadan unos se ne krije** — `naknadno_dana` u listama i izvozu (oznaka „naknadno +N").
11. **Dan po podgoričkom vremenu** — `danasCG()` na serveru, `lokalniDatum()` u pregledaču,
    `(now() at time zone 'Europe/Podgorica')::date` u SQL-u. Nikad `current_date`, nikad
    `toISOString()` za datum.
12. *Ukinuto:* `ADMIN_TOKEN` — nova verzija nema HTTP admin rutu; administracija ide kroz `alati/`.
13. **`bzr` otvara i mijenja naloge samo ulogama `operater` i `vozac`**, nikad sebi ravnom ni
    iznad sebe — `smijeDodijelitiUlogu()` + `provjeriMozeDaDirneNalog()`, na serveru.
14. **Banka pitanja KONSULTANTA je samo izvođačeva** (`pitanje.izvor = 'konsultant'`, ruta
    `/pitanja`). Ko zna pitanja, ne mjeri više znanje. **Pitanja firme** (`izvor = 'firma'`,
    `/pitanja-firme`) unosi i vidi odgovorno lice. Rezultate vidi normalno.
15. **U `lice` ide broj i rok sanitarne knjižice — nikad nalaz pregleda.**
    15a. **Korektivnu mjeru završava samo onaj kome je dodijeljena** (terenske uloge; `bzr` i
    `izvodjac` smiju svaku), uz upisan opis šta je urađeno — `zavrsiKorektivnuMjeru()`. Ko je uradio
    mjeru, ne provjerava je.
16. **Nalog i lice su dvije stvari, spojene preko `korisnik.lice_id`.** Ime i šifra se čitaju iz
    `lice`, ne prepisuju u `korisnik`.
17. **Šifra (`lice.sifra`, M-01) je unutrašnji evidencioni broj zaposlenog — zaposlenom ne treba.**
    Prijava i provjera znanja idu nalogom i lozinkom, potpis je ime (#23). Šifra se ne prikazuje na Mojoj
    strani, na ceduljici sa pristupom ni u provjeri znanja, i nigdje se ne kuca (odluka vlasnice
    27.09.2026 — „šifra za test je suvišna"). Ostaje u spisku zaposlenih kod vodstva i kao ključ
    učesnika provjere (anonimni rezultat nosi šifru umjesto imena).
18. **Prilog 13 je plan, ne zapis** (`plan_obuke`, `v_plan_obuke` sa stanjem KASNI/USKORO/…).
    Stavka koja je prošla bez obuke se ne briše.
19. *Ukinuto:* `veza.js` / `dodajOdjavu()` — odjava i promjena lozinke su u `Layout.tsx` i `/moja`.
20. **Jedan spisak ljudi** — `lice` su SVI zaposleni; `rukuje_hranom` odlučuje za koga važe
    knjižica i obuka. Druga tabela zaposlenih se ne pravi.
21. **Izvršilac se ne kuca** — `izvrsilacZa()`: terenskoj ulozi UVIJEK njeno ime; `bzr` i
    `izvodjac` smiju upisati drugo lice.
22. **`izvrsilac` ≠ `uneo_korisnik_id`** — prvi je ko je obavio radnju (može biti bez naloga),
    drugi nalog sa kog je zapis poslat.
23. **Potpis je IME, ne šifra** — inspektoru „M-01" ne znači ništa; i u evidenciji kontrola vozila.
24. **Pet uloga.** D1 (kontrola vozila) vidi i unosi SAMO vozač, odgovorno lice i konsultant; HACCP
    obrasci nisu za vozača.
25. **Obrazac nosi `uloge` u `public/obrasci-cg.json`** — po njima se filtriraju pločice na
    `/haccp`. Nov obrazac bez `uloge` se ne pojavljuje terenskim ulogama.
26. **Terenske uloge u listama vide SAMO SVOJE unose** — `samoMoje()`; vozač vidi i isporuke koje su
    mu dodijeljene (`vozac_korisnik_id`); neusaglašenosti — one koje je sam prijavio i one gdje je
    mjera na njemu (`SAMO_MOJE_NC`). **Svaka ruta nosi `requireUloga`** sa tačno onim ulogama
    čije strane je zovu (mapa u `testovi/pristup.test.mjs`); za sve prijavljene — `sviPrijavljeni()`.
    Cijeli spisak zaposlenih (`/lica`) vidi samo vodstvo, a svako svoje lice čita preko `/lica/ja`.
    Ruta bez uloga ne prolazi `provjeriRute()` — server ne kreće (#44).
27. **Radno mjesto nije uloga.** `lice.radno_mjesto` ide na štampu, `korisnik.uloga` odlučuje
    tablu. Promjena uloge briše sesije tog naloga.
28. **Lozinka se prikazuje samo jednom, pri postavljanju.** U bazi je heš; najmanje 10 znakova,
    provjera i u pregledaču i na serveru. Početnu (i novu, za zaboravljenu) lozinku postavlja
    odgovorno lice — može je sama zadati ili prihvatiti predlog — i ona je UVIJEK privremena
    (`mora_promijeniti_lozinku`). „Nova lozinka" prekida sve prijave tog naloga. Sesije: u bazi samo heš tokena (`sesija_prijave`);
    promjena lozinke odjavljuje ostale uređaje.
29. *Ukinuto 27.09.2026:* dijeljenje šifri zaposlenima — šifra više nema namjenu za zaposlenog (#17).
30. **Izvoz ne pada zbog jednog nedostajućeg pogleda** — `tabelaPostoji()` prije upita; spisak
    izvora nosi `nedostaje`, `sve.json` listu `nedostaje`, pojedinačni CSV vraća 409.
31. **Preuzimanje ide kroz `fetch`** (`preuzmiFajl()`), da se greška 401/409/500 ispiše.
32. **Provjeru znanja radi SAMO PRIJAVLJENI zaposleni, sa svog naloga** (odluka vlasnice 25.09.2026).
    Ulaz, odgovori i završetak su iza granice prijave; zaposlenog server nalazi preko naloga
    (`korisnik.lice_id`) i ništa o identitetu ne čita iz zahtjeva. `moj-termin` vraća `vezan`, ne šifru.
    Odgovara i završava samo onaj ko je počeo (`TUDJA_PROVJERA`, 403). Nalog nevezan za lice →
    `NALOG_BEZ_SIFRE` (naziv koda ostaje zbog kompatibilnosti).
    Zaposleni bez naloga ne radi provjeru — prvo mu se otvori nalog. Ulaz se nudi na početnoj strani
    (`ProvjeraZnanjaUlaz` na `/moja` i `/tabla`, dok je termin otvoren), ne na strani za prijavu.
    Rezultat se ne može naduvati: jedan odgovor po pitanju, ništa poslije završetka.
    **Prije početka se upisuje lozinka PRIJAVLJENOG** (odluka vlasnice 26.09.2026) — na zajedničkom
    telefonu provjeru ne radi neko drugi na tuđem nalogu. Pogrešna ili tuđa lozinka → `POGRESNA_LOZINKA`
    (403); pokušaji se broje zajedno sa prijavom (IP + korisničko ime), pa se lozinka ne pogađa odavde.
33. *Ukinuto:* `generisiFormu` / `talas` — stara verzija. Provjera znanja sada pada samo ako nema
    otvorenog termina ili nema pitanja iz izabranog izvora (tada se termin ne može ni otvoriti).
34. **Broj dokumenta (NC, isporuka, povlačenje, šifra zaposlenog) samo iz `sljedeciBroj()`**
    (`server/services/brojeviService.ts`), i to UNUTAR transakcije koja upisuje red — ključ
    (`pg_advisory_xact_lock`) drži se do kraja transakcije. Nikad `count(*) + 1`, nikad nasumičan broj.
35. **Upis u više koraka je jedna transakcija** (`transakcija()`): red + audit + obavještenje +
    zadatak + brisanje sesija. Odgovor se šalje POSLIJE transakcije. Funkcija koju zove više mjesta
    prima `klijent` (npr. `neusaglasenostIzZapisa`, `obrisiSveSesijeZaKorisnika`).
36. **`izvor_tip` samo sa spiska** — `IZVORI_ZADATKA` / `IZVORI_OBAVJESTENJA` u `zadaciService.ts`
    (tip, pada pri typecheck-u) i CHECK u bazi (`22_integritet_cg.sql`). Nov izvor: na oba mjesta,
    novom dopunom.
37. **Otpremnica samo POPUNJAVA formu — ništa se ne snima bez čovjeka.** Prijem iz otpremnice traži
    kvačicu „uporedio/la sa robom i etiketom"; nesigurna polja su žuta; dobavljač nikad nije „prvi sa
    spiska" — prepoznat (PIB, pa naziv) je izabran, nepoznat sa pročitanim nazivom je „nov dobavljač"
    popunjen sa otpremnice (#71), ništa pročitano — prazno. Forma (`src/components/NoviPrijem.tsx`)
    prvo pita KAKO se unosi (Slikaj / PDF / Ručno), pa ide u koracima: dobavljač → roba → temperatura →
    potvrda. **Nepročitana otpremnica nije slijepa ulica**: fajl se ipak čuva uz prijem (`nijeProcitano`
    u odgovoru, 201), a stavke se upisuju ručno. Čita se **na našem serveru** — PDF tekst direktno, slika
    lokalnim OCR-om (Tesseract, `srp_latn`) u više prolaza (#75). **Nikakav spoljni servis** (vlasnica je
    to izričito odlučila 24.09.2026: bez Anthropica i sličnih). Temperatura sa otpremnice je podatak
    dobavljača — prikazuje se, ne upisuje; KKT 1 mjeri magacioner.
38. **Roba sa isteklim rokom se upisuje, ali se ne prihvata ni pušta** (`ROK_ISTEKAO` u
    `donesiOdlukuOLotu`). Upisuje se jer je stigla (trag za povrat i ocjenu dobavljača); ne HOLD-uje
    se automatski, da greška u kucanju datuma ostane ispravljiva dok odluka nije donesena.
39. **Granica temperature ima JEDAN izvor — `pravilo_kontrole`.** Unosi se na artiklu u Šifarnicima,
    a `uskladiPravilaArtikla()` (`pravilaService`) u ISTOJ transakciji pravi novu verziju pravila
    KKT 1 i KKT 3 za taj artikal (stara ostaje sa `vazi_do`), ili ga gasi kad artikal izađe iz
    režima. Nijedan KKT ne čita `artikal.temp_min/max` mimo pravila. KKT 1 i KKT 3 se ne mogu
    ugasiti (`TACKA_NEZAMJENJIVA`).
40. **Roba pod temperaturnim režimom se ne prima bez temperature** (`TEMPERATURA_OBAVEZNA`, i u
    formi). Temperatura sa otpremnice se ne računa (#37). U formi prijema se upisuje JEDNOM po vrsti
    robe (rashlađena, smrznuta — ne po tačnoj granici), a svaki artikal se ocjenjuje po SVOJOJ granici:
    odmah piše „u granici“ ili koji je artikal van granice (potvrđena → HOLD, pretpostavljena →
    upozorenje). „Različito po stavci“ ostaje kao izbor. Server i dalje prima i ocjenjuje po stavci.
41. **Četiri oka — izuzetak samo kad firma ima JEDNO aktivno odgovorno lice** (`ncService.verifikuj`).
    Server ga nudi (`VERIFIKACIJA_NIJE_NEZAVISNA` + `izuzetakMoguc`), pregledač ga ne izmišlja.
    Traži izričitu kvačicu i obrazloženje od bar 10 znakova. Trajno je označen
    (`verifikacija.izuzetak_cetiri_oka`, „bez četiri oka" u listi), a konsultant dobija
    obavještenje. Sa dva odgovorna lica — `IZUZETAK_NIJE_DOZVOLJEN`. Uprava i dalje ne provjerava.
42. **Rezultat provjere termometra računa server** iz referentne i izmjerene vrijednosti
    (dozvoljeno odstupanje, podrazumijevano 0,5). Pregledač ga ne šalje kad ima brojeva.
    Kalibracija bez broja sertifikata se ne prima. NEISPRAVAN → neusaglašenost (izvor `mjerni_uredjaj`).
43. **„Šta danas fali" ima jedan izvor — `monitoringService.stanjeDanas()`.** Tabla, Moja strana i
    HACCP plan čitaju isto. Dan je po Podgorici (#11). Zapis obrasca se broji jednom — ispravka
    (`ispravlja_id`) nije nov zapis. Terenska uloga vidi samo stavke svoje uloge i svog matičnog
    skladišta.
44. **Granica prijave je JEDNA** — `app.use("/api", requireAuth)` u `server/index.ts`. Ispred nje
    smiju samo javni ruteri (`javniRuter()` iz `server/provjeraRuta.ts`); iza nje ruter nema svoj
    `.use(...)`, a svaka ruta nosi `requireUloga`. `provjeriRute()` to provjerava pri svakom
    pokretanju: u razvoju server ne kreće, u produkciji se zapiše. (Nalaz A3 — ranije je ko smije
    zavisio od redoslijeda montiranja; adrese nisu mijenjane.)
45. **Jedan dnevnik promjena — `audit_log`.** `dogadjaj` se više ne puni (nalaz B4); tabela i stari
    redovi ostaju. Nova kritična radnja = `logKreiranje/logIzmjena/logPromjenaStatusa/logOdluka` u
    istoj transakciji.
46. **Push je samo kanal za postojeća obavještenja** (`pushService`): šalje se ono što je upisano u
    `obavjestenje`, tek kad je transakcija potvrđena, **najviše jednom** (red se označi prije
    slanja), šifrovano za uređaj (RFC 8291 — push servis ne čita sadržaj). Pretplata se prima samo
    za push servise pregledača (Google, Apple, Mozilla, Microsoft), lokalno još i `http://localhost`.
    U produkciji server preuzima samo obavještenja korisnika sa https pretplatom. Uređaj koji vrati
    404/410 briše se sam. Starije od sat vremena se ne šalje.
47. **SQL i poslovna pravila su u `server/services/`; ruta = šema, uloga, poziv servisa, odgovor.**
    Preseljeno u fazi 4: `zadaci`, `poruke`, `tabla`, `ljudi`, `provjeraZnanja`. Zajednički SQL
    dijelovi (`IME`, `IZVOR_OZNAKA`, `SAMO_MOJE_NC`) su u `services/sqlDijelovi.ts` — servis ne uvozi
    rutu. Ostale rute još imaju ponešto SQL-a, većinom liste (`sifarnici` 9 upita, `haccp`,
    `haccpPlan`, `prijem` po 5, `neusaglasenosti` 4, `isporuka`, `povlacenje`, `zaliha` po 3,
    `vozila`, `firma`, `auth` po 2, `audit` 1) — sele se kad se diraju.
48. **Predaja se provjerava U TRENUTKU PREDAJE, ne samo pri pripremi** (`potvrdiIsporuku`, R-01).
    Između pripreme i predaje lot može biti zadržan ili povučen, isteći mu rok, a roba otpisana. Za
    svaku stavku sa predatom količinom: lot PRIHVAĆEN (`LOT_BLOKIRAN`), rok nije istekao
    (`ROK_ISTEKAO`), na zalihi ima dovoljno (`NEDOVOLJNO_ZALIHE`) — red zalihe `for update` do kraja
    transakcije. **Zaliha nikad u minusu** — i CHECK u bazi (26). Potvrda mora obuhvatiti SVE stavke,
    svaku jednom (`STAVKE_NEPOTPUNE`, R-16); ono što nije predato je 0, ne izostavljeno.
49. **Roba koja se vraća sa isporuke ide u KARANTIN, ne u slobodnu zalihu** (R-03). Nepredato i
    odbijeno se premješta DOSTUPNO → KARANTIN (kretanje HOLD 0 sa razlogom), `bzr` dobija obavještenje,
    a na `/zalihe` robu pušta (RELEASE 0) ili otpisuje (OTPIS) — `odlukaOKarantinu()`, uz opis šta je
    pregledano. Samo za PRIHVAĆEN lot; zadržan lot se rješava u cjelini (nalaz H1). Lot koji je već
    zadržan ima svu robu u karantinu, pa se tada ništa ne premješta.
50. **Lot sa isteklim rokom se ne isporučuje** (R-02) — ni nova isporuka, ni izmjena, ni predaja; iz
    karantina se ne vraća u prodaju, samo otpisuje. Rok se računa po Podgorici (#11). Kartica „Rok
    robe“ na tabli i lista iza nje (`SQL_ROK_ROBE`) imaju isti uslov kao brojanje (`brojPoRoku`).
    „Istekao rok“ `bzr` dobija JEDNOM po lotu (`javiIstekleLotove`, provjera svaki sat).
51. **Magacioner i vozač rade samo sa SVOJIM isporukama** (R-04): onom koju su spremili
    (`uneo_korisnik_id`) ili koja im je dodijeljena (`vozac_korisnik_id`) — detalj (404), izmjena i
    potvrda (403 `NIJE_VASA_ISPORUKA`). **Predaju potvrđuje dodijeljeni vozač**; bez vozača — onaj ko
    je spremio. Isto za prijem (R-13): detalj i otpremnica samo u prozoru datuma (#6), a stavka se
    mijenja samo preko SVOG prijema (`l.prijem_id`).
52. **Nov prijem i nova isporuka nose ključ zahtjeva** (`x-kljuc-zahtjeva`, R-10) — jedan po otvorenoj
    formi (`noviKljuc()`). Server ga zauzima u ISTOJ transakciji kao upis (`zauzmiKljuc`); isti ključ
    istog korisnika vraća prvi rezultat. U pregledaču dugme je zaključano dok zahtjev traje
    (`useSlanje()`), a `api()` isti upis koji je već u toku ne šalje ponovo. Izmjene, odluke i
    potvrde štiti status (drugi pokušaj → 409).
53. **Zadržan lot javlja isporukama u pripremi** (`javiIsporukeSaLotom`): kad lot pređe na HOLD
    (mjerenje van granice ili povlačenje), vozač i onaj ko je isporuku spremio dobijaju „Ne predajte
    lot …“ — i za isporuke koje nisu njegove (demo baza ih ima; testovi to čiste po tekstu).
54. **Server stoji iza Render proksija** — `app.set("trust proxy", 1)`, pa je `request.ip` adresa
    korisnika. Ograničenje pokušaja prijave je po IP + korisničkom imenu (R-11): tuđi pogrešni
    pokušaji iz istog magacina ne zaključavaju druge.
55. **D1 ocjenjuje i temperaturu, a „spremno“ važi samo za dan kontrole** (R-05, `vozilaService`).
    Rashladno vozilo mora imati režim od–do (`GRANICA_VOZILA_OBAVEZNA`); D1 rashladnog vozila bez
    temperature se ne prima; van granice = NIJE PROŠAO (neusaglašenost VISOK). Granica po kojoj je
    ocijenjeno se upisuje uz kontrolu. Da/ne bez podrazumijevanog odgovora — „Sačuvaj“ bez klika ne
    upisuje „prošao“. Roba pod režimom ide samo rashladnim vozilom (`VOZILO_OBAVEZNO`,
    `VOZILO_BEZ_REZIMA`). **Predaja traži današnju D1 tog vozila** (`D1_NIJE_URADJENA`); pala D1 ne
    zaustavlja potvrdu već utovarene robe (neusaglašenost vozila je otvorena).
56. **Izmjena pamti „prije“** (R-06). `logIzmjena` po tipu traži `stareVrijednosti`; izmjena reda =
    `stanjeReda(…, for update)` prije, `logIzmjenaReda` poslije — upisuju se samo promijenjena polja, sa
    obje vrijednosti. Heš lozinke i sadržaj fajla ne ulaze u audit. Novi red je `logKreiranje`, ne izmjena.
    Tabele za `stanjeReda` su na zatvorenom spisku (`TABELE_AUDITA`) — naziv ide u SQL.
57. **Zapis se ispravlja jednom, istim obrascem, u svom prozoru** (R-07). Ispravlja se posljednja
    verzija (`ZAPIS_VEC_ISPRAVLJEN`, jedinstven `ispravlja_id`); ispravka nosi datum zapisa koji ispravlja;
    terenska uloga samo svoj zapis (`NIJE_VAS_ZAPIS`). Odstupanje koje unese tek ispravka otvara
    neusaglašenost; isto odstupanje u lancu ne otvara drugu.
58. **Odstupanje slijedi iz odgovora, ne samo iz kvačice** (R-08, `obrasciService`). U
    `obrasci-cg.json` da/ne polje nosi `odstupanjeAko`, tekst `obavezno`. Server odbija nepoznato polje,
    neodgovoreno da/ne i prazan obavezan tekst; `odstupanje = kvačica ILI odgovor`; neusaglašenost kaže iz
    kog odgovora. `uloge` obrasca se provjeravaju i na serveru (#25). Nov obrazac: odmah sa `odstupanjeAko`.
59. **Mjerenje lota se ocjenjuje po granici NJEGOVOG artikla** (R-09) — `praviloZaMjerenje()`: pravilo
    artikla lota na toj tački, pa opšte pravilo tačke. Isto na prijemu, u magacinu i pri predaji.
60. **Mjerenje pamti termometar** (R-23, `mjerenje_temperature.mjerni_uredjaj_id`). Ručno mjerenje bez
    termometra se ne prima čim firma ima aktivan termometar (`TERMOMETAR_OBAVEZAN`; kad nijedan nije
    ispravan — `NEMA_ISPRAVNOG_TERMOMETRA`); neispravnim se ne mjeri (`UREDJAJ_NEISPRAVAN`, i na prijemu i
    pri predaji). „Upitno“ = izmjereno termometrom čija je SLJEDEĆA provjera pala. Spisak za izbor
    (`/termometri`) vide svi prijavljeni — i vozač pri predaji.
61. **Neusaglašenost iz kontrole se zatvara tek kad ponovna kontrola prođe** (R-22,
    `ncService.stoFaliZaZatvaranje`): mjerenje pri predaji → nova D1 vozila prošla; mjerenje lota koji je
    još na zalihi → novo mjerenje lota u granici (odbijen ili prodat lot — ne treba); mjerenje bez lota →
    novo na istoj tački; D1 → nova D1 prošla; termometar → nova ispravna provjera. Vozilo ili termometar
    isključen iz upotrebe — ne treba. `PONOVNA_KONTROLA_POTREBNA` kaže šta tačno fali. Neusaglašenost iz POVLAČENJA
    (čl. 28) — tek kad je povlačenje ZAVRSENO (svi kupci obaviješteni); ekran vodi pravo na to povlačenje.
62. **Isporuka u pripremi drži robu — rezervacija se RAČUNA, ne upisuje** (R-14). Slobodno = na zalihi
    (DOSTUPNO) − planirano u isporukama U_PRIPREMI tog lota (`v_zaliha_dostupna.slobodno`, `/lotovi.rezervisano`).
    Priprema i izmjena primaju samo slobodno; stavke istog lota se sabiraju; izmjena ne broji svoju
    rezervaciju; red zalihe `for update` do kraja transakcije. Rezervacija nije kretanje robe — otkaz ili
    izmjena je oslobađa sama. Otpis se ne odbija (roba je stvarno propala), ali ako ostavi isporuke bez robe,
    ko ih je spremio i vozač dobijaju „Nema dovoljno robe za isporuku …“ (`javiManjakRezervacije`).
63. **Isporuka se otkazuje samo iz pripreme, uz razlog** (R-15, `otkaziIsporuku`): status OTKAZANA, ko i
    kad (CHECK u bazi), audit status prije/poslije, obavještenje vozaču i onome ko je spremio. Otkazuje
    magacioner svoju i vodstvo — ne vozač: kupac koji odbije robu na vratima je potvrda sa 0 i razlogom
    (#49), ne otkaz. Dok je u pripremi, ispravlja se i kupac (audit pamti starog).
64. **Rok i serija** (R-17). Rok trajanja se upisuje pri prijemu (`ROK_OBAVEZAN`) — osim za artikal koji
    konsultant izuzme (`artikal.rok_obavezan`). Ista serija (artikal + broj lota, bez obzira na velika
    slova i razmake) jednom po prijemu (`SERIJA_DVAPUT`, i jedinstven indeks). Ista serija ranije primljena
    sa DRUGIM rokom — prima se, uz upozorenje u odgovoru i obavještenje `bzr`. **Serija za povlačenje =
    isti dobavljač + artikal + broj lota kroz sve prijeme** (`SERIJA_LOTA`): povlačenje zadržava sve lotove
    serije i zove kupce svih njenih isporuka; nijedan lot serije se ne pušta dok je povlačenje u toku.
65. **Otpremnica za štampu je prateći list sledljivosti, ne fiskalni dokument** (R-21,
    `otpremnicaZaStampu`). Isto pravo čitanja kao detalj isporuke (#51). Nosi lot, rok, planirano /
    predato / odbijeno, temperaturu pri predaji, mjesta za potpis i vrijeme posljednje izmjene isporuke —
    da se na papiru vidi koja je verzija odštampana. Prije predaje „predato“ ostaje prazno (piše se rukom).
    Nikad je ne predstavljati kao zvaničan obrazac ni kao račun.
66. **PIB je jedinstven** (R-28) — kupca i dobavljača (`PIB_POSTOJI`); PIB kupca samo ciframa (8–13).
    Kupac ima i adresu isporuke kad roba ne ide u sjedište — ide na otpremnicu.
67. **Poruke šalju SVI zaposleni jedni drugima** (odluka vlasnice 26.09.2026) — pojedinačno, grupi ili
    svima; primalac ih dobija kao obavještenje, sa „Odgovori“. **Poruke između zaposlenih vide samo
    pošiljalac i primaoci**; vodstvo (bzr, konsultant, uprava) i dalje vidi poruke drugih iz vodstva
    (da dvoje ne šalje različita uputstva istim ljudima). Ko je pročitao vidi pošiljalac (i vodstvo za
    poruke vodstva) — tuđa poruka → 404.
68. **Bekap iz aplikacije je bez tajni i NE čuva se u bazi** (R-19, `bekapService`): bez heševa lozinki, sesija,
    VAPID ključa, push uređaja, ključeva zahtjeva i samog fajla otpremnice; sa svim poslovnim tabelama (i HACCP
    sistema). `GET /bekap/preuzmi` piše JSON direktno u odgovor, tabelu po tabelu iz jednog snimka (repeatable read),
    uz backpressure i prekid ako veza pukne; u `bekap_log` ostaje samo ko/kad/koliko (dopuna 35 — ranije je svaka
    kopija, i sedmična automatska, ostajala u istoj bazi 90 dana i punila besplatnih 500 MB, a od gubitka baze nije
    štitila). Sedmično: samo PODSJETNIK odgovornom licu kad 7 dana niko nije preuzeo (najviše jednom u 7 dana).
    Pun bekap sa svim je `npm run bekap` (pg_dump). Nova tabela sa tajnom → u `TABELE` ne ide, ili njena kolona u `BEZ_KOLONA`.
69. **Kriv zahtjev je 4xx, ne 500** (R-26, `greskaHandler`): `ZodError` → 400, neispravan JSON → 400,
    PostgreSQL 22P02/22007/22008/22003 → 400, 23503 → 409 „zapis ne postoji“, 23505 → 409, 23514 → 409.
    Poruka iz šeme (na našem jeziku) ide na ekran umjesto opšte. 500 ostaje samo za pravu grešku servera.
70. **Zdravlje i zaglavlja** (R-25, R-27): `/api/zdravlje` provjerava i bazu (i da aplikacija vidi svoje tabele — #78, i da su sve dopune primijenjene — #79; najviše 3 s;
    503 kad ne odgovara). U produkciji `Content-Security-Policy` (skripte samo sa našeg servera; stilovi i
    fontovi i sa Google Fonts; blob: za otpremnicu) i HSTS; svuda nosniff, zabrana okvira,
    `Permissions-Policy`. Nova spoljna stvar (skripta, font, API) → prvo u CSP, inače je pregledač blokira.

71. **Novog dobavljača upisuje SAMO odgovorno lice** (i konsultant) — odluka vlasnice 27.09.2026:
    dobavljači su stalan spisak koji vodi odgovorno lice. Odgovorno lice ga može upisati uz prijem
    (`POST /prijem` sa `noviDobavljac {naziv, pib?}` umjesto `dobavljacId` — tačno jedno, 400; u ISTOJ
    transakciji, `upisiNovogDobavljaca`, audit; isti PIB ili naziv → 409 `PIB_POSTOJI`/`DOBAVLJAC_POSTOJI`;
    drugo odgovorno lice dobija obavještenje). Magacioneru server to odbija (403
    `DOBAVLJAC_SAMO_ODGOVORNO_LICE`); u formi on vidi pročitan naziv i PIB, dugme „Javi odgovornom licu“
    (`POST /prijem/javi-dobavljaca` → obavještenje „Dodajte dobavljača: …“ svim odgovornim licima) i
    „Dodat je — osvježi spisak“ (ponovo učita dobavljače i sam izabere onog sa istim PIB-om ili nazivom).
72. **Artikal sa otpremnice se ne uparuje sa drugim pakovanjem ni procentom** (`upariPoNazivu`,
    `mjereIzNaziva`). Iz naziva se čitaju masa (g/kg), zapremina (ml/l) i procenat; ako se razlikuju od
    artikla iz Šifarnika, to NIJE isti artikal („Pileći file 1 kg“ ≠ „… 500g“, „Mlijeko 2,8%“ ≠ „3.2%“) —
    polje ostaje prazno uz napomenu šta se ne slaže. Masa naspram zapremine nije sukob. Ostatak naziva se
    poredi bez pakovanja; dva podjednako slična artikla → ne bira se. Ista šifra kod dobavljača i kod
    vas važi samo ako se pakovanje slaže i naziv liči. Svaka stavka nosi `artikalIzvor`
    (zapamćeno / šifra / naziv) i `artikalNapomena` — ekran je pokazuje ispod polja. Sigurno je SAMO
    ono što je čovjek ranije potvrdio (`artikal_dobavljaca`).
73. **Nov artikal se upisuje uz prijem** (odluka vlasnice 27.09.2026 — „neće cijelu isporuku“: jedna
    roba koje nema u Šifarnicima blokirala je cio prijem). Stavka nosi `artikalId` ILI `noviArtikal
    {naziv, jedinicaMjere, rezim}` — tačno jedno. Režim daje PRETPOSTAVLJENU granicu (rashlađeno 0–4 °C,
    smrznuto −25 do −18 °C, `GRANICA_REZIMA`) sa `granica_potvrdio = false` — po njoj se samo upozorava
    (#5), dok je odgovorno lice ne potvrdi. Artikal + pravila KKT 1/KKT 3 (#39) u ISTOJ transakciji sa
    prijemom; isti naziv već postoji → 409 `ARTIKAL_POSTOJI`. Odgovorna lica (osim onog ko je upisao)
    dobijaju obavještenje da potvrde granicu, jedinicu i rok. Rok i temperatura (za režim) obavezni i za
    nov artikal. Radi i magacioner. **Sa otpremnice se predlaže sam** (`uskladi` → `noviArtikal`): roba
    koje nema u Šifarnicima (i koja nije podjednako slična dvama postojećim) dolazi već postavljena kao
    nov artikal — naziv i jedinica sa otpremnice, režim PRETPOSTAVLJEN (`pretpostaviRezim`: naziv robe →
    temperatura sa otpremnice → roba koju taj dobavljač inače donosi; `rezimPo` kaže po čemu). Polje
    režima je žuto dok ga magacioner ne potvrdi; nesiguran naziv (OCR) je žut. Magacioner samo pregleda.
74. **„Sačuvaj“ nikad nije sivo bez objašnjenja.** Duga forma (prijem) drži dugme uvijek aktivnim: klik
    kad nešto fali ispiše ŠTA fali („Za čuvanje još fali: …“), zacrveni ta polja i skroluje do prvog;
    poruka se osvježava sama dok se popunjava. Greška (i sa servera) stoji UZ DUGME (`Modal` → `.modal-dno`),
    ne na vrhu prozora. Prozor se na računaru skroluje (`max-height`), dugme je uvijek vidljivo. Forma sa
    `siroki` se ne zatvara dodirom van prozora (brisalo je sve upisano na telefonu).
75. **Fotografija se čita u više prolaza, dok jedan ne da sve** (`procitajSliku`): obično (PSM 6) →
    CLAHE kontrast → izoštreno → oboje → rijedak tekst (PSM 11); mala slika se za pripremljene prolaze
    uveća. Ako prvo čitanje nema ni 12 „sigurnih riječi“, slika nije uspravna: brza proba 90°/270°/180° na
    manjoj kopiji bira položaj sa najviše sigurnih riječi. Staje čim su sve stavke potpune (količina, i
    lot/rok kad ih otpremnica ima), najviše 10 prolaza / 100 s; uzima se najbolje čitanje. Redovi tabele
    se slažu po POLOŽAJU riječi (uz ispravku nagiba, `redoviIzRijeci`), ne po Tesseractovim blokovima.
    Zaglavlje prepoznaje i kolone koje prijem ne koristi („ostalo“: R.br., cijena, rabat, iznos…) da
    iznos ne bi bio pročitan kao količina. Priprema slike je `sharp` (lokalno). Izmjereno na 16 izmijenjenih
    verzija probne fotografije (okrenuta, tamna, mutna, mala, nagnuta i kombinacije): 144/144 polja tačno;
    prije: ~12/99. Dobra fotografija — jedan prolaz (≈3 s), okrenuta ≈15 s na računaru.
76. **Otpremnica se čita u pozadini — telefon nikad ne „učitava“ bez kraja** (27.09.2026 — na Renderu je
    fotografija stajala na „Čitam…“: slab procesor, više prolaza, zahtjev bez roka). `POST /prijem/otpremnica`
    ODMAH sačuva fajl (`procitano` prazno) i pokrene čitanje (`pokreniCitanje`); sačeka najviše
    `OTPREMNICA_CEKAJ_MS` (5 s) — gotovo → 201 sa rezultatom, inače 202 `{status:"cita", prolaz, opis,
    sekundi}`. Pregledač pita `GET /prijem/otpremnica/:id/stanje` na 1,5 s i prikazuje napredak („Čitam —
    pojačavam kontrast · 23 s“) i dugme **„Ne čekaj — upiši ručno“** (`POST …/prekini`: čitanje staje posle
    tekućeg prolaza, fajl ostaje uz prijem). Forma odustaje sama posle 3 min. Server ponovo pokrenut usred
    čitanja → `status:"prekinuto"` (fajl je tu). Magacioner vidi samo svoje otpremnice, vodstvo sve.
    Brzina: telefon šalje 2200 px (JPEG 0,85), server čita najviše 2400 px (`NAJVECA`) — izmjereno jednako
    tačno kao 3200 (142/144 polja), a brže; ukupno čitanje najviše `OCR_NAJDUZE_MS` (75 s), novi prolaz se ne
    počinje ako ne bi stao. OCR radnik se pali UNAPRIJED kad se otvori forma (`POST /prijem/otpremnica-priprema`),
    posle 20 slika se zamijeni novim (memorija), `sharp` bez keša i sa jednom niti. `posaljiFajl` ima rok (90 s)
    i jasnu poruku za 502/503/504 i prekid veze.
77. **Plan monitoringa je obaveza MAGACINA, ne osobe** (pitanje vlasnice 27.09.2026: „2–3 magacionera —
    kad jedan izmjeri, drugome ne treba da stoji“). „Urađeno“ se broji iz svih unosa, bez obzira ko ih je
    unio. Mjerenje i dnevni zapis pamte magacin (`skladiste_id`, dopuna 31; `skladisteUnosa`: izabrano →
    magacin lota → matični magacin naloga → jedini aktivni; kad se ne zna — prazno, NE odbija se). Stavka
    plana vezana za magacin broji samo unose iz tog magacina (i stare, bez magacina); stavka bez magacina
    broji sve — firma sa više magacina zato plan vodi po magacinu. Ispravka zapisa ostaje u magacinu
    zapisa. `stanjeDanas` vraća i `uradili` (ime, vrijeme — posljednja tri): na Mojoj strani piše „uradio/la:
    Marko Vuković 08:14“. „Danas po planu“ se osvježava sam (45 s i pri povratku u aplikaciju). Na `/haccp`
    firma sa više magacina bira „Radim u magacinu“ (podrazumijevano matični; „Upiši“ sa plana otvara
    magacin stavke).
78. **Baza je zatvorena i mimo aplikacije** (R-12, dopuna 32, 27.09.2026 — Security Advisor je pokazao sve
    tabele bez RLS-a, izložene Data API-ju). Prva brava: Supabase Data API isključen u panelu (za svaki
    projekat). Druga, u bazi: RLS na SVAKOJ tabeli šeme public, **bez ijedne politike** — javne uloge ne vide
    nijedan red; pogledi `security_invoker` (prava onoga ko pita); `anon` i `authenticated` bez prava na
    tabele, poglede i sekvence, i na one koje se tek naprave. Aplikacija radi kao **vlasnik tabela**, pa je RLS
    ne ograničava (nikad `force row level security`). **Nova tabela u dopuni → `alter table … enable row level
    security`; nov ili ponovo napravljen pogled → `with (security_invoker = true)`** — test `bezbjednost_baze`
    pada ako se zaboravi. Ako aplikacija radi kao korisnik baze koji NIJE vlasnik tabela, RLS joj krije
    podatke bez greške (prijava bi javljala „pogrešna lozinka“) — zato `/api/zdravlje` vraća 503 sa spiskom
    tabela koje ne vidi (`tabeleBezPristupa`). DATABASE_URL na Renderu = isti korisnik kao za `npm run migriraj`.
79. **Dopune baze se primjenjuju same pri pokretanju u produkciji** (talas 5 — 27.09.2026 kod je otišao
    na Render prije dopune 31 i mjerenja su padala). `server/migracije.ts` je JEDNO mjesto za `npm run migriraj`
    i server: prije prvog zahtjeva server primijeni sve što fali (bez demo podataka; `pg_advisory_lock` protiv
    dva istovremena procesa; svaki fajl jedna transakcija). Padne li dopuna — server NE kreće, pa Render ostavlja
    prethodno izdanje. `MIGRACIJE_PRI_STARTU=0` gasi, `=1` pali i van produkcije. `/api/zdravlje` vraća 503 i
    ime svake neprimijenjene dopune; `dnevni-pregled` ih takođe javlja.
80. **Dnevnik grešaka je u bazi klijenta** (`greska_log`, dopuna 33, `greskeLogService`) — greška servera (500,
    iz `greskaHandler`), pad ekrana u pregledaču (`GreskaGranica` → `POST /greske/pregledac`, najviše 20 na sat po
    korisniku) i neuhvaćena greška procesa. Bez spoljnog servisa (u duhu #37). Nikad tijelo zahtjeva (lozinke, lični
    podaci) — samo ruta, status, kod, poruka, stek, korisnik, izdanje. Najviše 30 upisa u minuti; čuva se 90 dana.
    4xx NIJE greška servera i ne ide u dnevnik. Čita samo konsultant (`GET /greske`) i `npm run dnevni-pregled`.
81. **Potvrda u dva koraka (TOTP, RFC 6238) za vodstvo** — `izvodjac`, `bzr`, `uprava` je SAMI uključuju na Mojoj
    strani (lozinka → QR u aplikaciji na telefonu → kod → 8 rezervnih kodova, prikazanih JEDNOM). Terenske uloge
    ne (izgubljen telefon magacionera ne smije zaustaviti prijem). Posle tačne lozinke nalog sa 2FA dobija izazov
    (`prijava_izazov`, 5 min, najviše 5 pokušaja, u bazi samo heš), a sesiju tek uz kod iz aplikacije ili rezervni
    kod. Isti kod ne važi dvaput (`totp_zadnji_korak`); pogrešan kod se broji u ograničenje prijave (IP + ime).
    Uključivanje odjavljuje ostale uređaje. Tajna i rezervni kodovi NE idu u audit (`BEZ_AUDITA`) ni u bekap iz
    aplikacije (`BEZ_KOLONA`), a `pg_dump` ne nosi izazove. Isključivanje: lozinka + kod; izgubljen telefon i kodovi
    → `npm run iskljuci-2fa -- --korisnik ime`. **Obavezna** je samo gdje je env `OBAVEZNA_2FA` (npr. `izvodjac,bzr`):
    tada granica prijave (`requireAuth`) takvom nalogu propušta samo `/auth/ja`, `/auth/2fa*`, promjenu lozinke i
    javljanje greške, a pregledač pokazuje `ObaveznaDvaKoraka` umjesto aplikacije. Izdavač u aplikaciji na telefonu
    je „PILOT <naziv firme>“ — konsultant ima jedan unos po klijentu.
82. **Izvoz (CSV) je bezbjedan za Excel i u lokalnom vremenu** (`csvVrijednost`): tekst koji počinje sa = + - @
    (tab, CR) dobija apostrof, da ga Excel ne izvrši kao formulu (napomena „=HYPERLINK(…)“ iz aplikacije); broj
    („-18,5“) ostaje broj. Trenutak (`timestamptz`) se piše po Podgorici „2026-09-29 14:05:09“, ne UTC „…T…Z“ (#11).
    JSON izvoz ostaje ISO (mašinski čitljiv).
83. **Slika spolja se provjerava prije obrade** (`provjeriVelicinuSlike`): više od 50 MP (`NAJVISE_PIKSELA`) → 400
    `SLIKA_PREVELIKA` i ništa se ne čuva — mali PNG sa lažnim dimenzijama bi se raširio na stotine MB i srušio
    server („slikovna bomba“). Svaki `sharp()` nosi `limitInputPixels`. `sharp` ≥ 0.35.5 (ranije verzije imaju
    ranjivosti u libvips), `pdfjs-dist` nikad ispod 4.2.67 (CVE-2024-4367; od v6 nema ni opcije isEvalSupported).
84. **Lozinke: asinhroni scrypt sa parametrima u hešu** (`server/lozinke.ts`, `scrypt2$N$r$p$salt$heš`, N = 2^15).
    Sinhroni `scryptSync` je pri svakoj prijavi zaustavljao CIJELI server. Stari format (`scrypt$salt$heš`) i dalje
    radi i pri uspješnoj prijavi se tiho zamijeni novim (ista lozinka — ne ide u audit). Nepostojeće korisničko ime
    troši isto vrijeme kao pogrešna lozinka (`lazniPokusaj`) — po vremenu odgovora se ne vidi koje ime postoji.
85. **Rad bez interneta za teren — upis se ne gubi i ne duplira** (talas 6, 30.09.2026). Bez signala se na telefonu
    čuvaju (`src/lib/izlaz.ts`, localStorage, red PO KORISNIKU) samo: D1, predaja isporuke, mjerenje, dnevni zapis i prijava
    problema (`upisiIliSacuvaj`). Prijem, odluke, otpis, nalozi — samo sa mrežom. Red se šalje sam (povratak signala,
    otvaranje aplikacije, na 30 s), REDOM kojim je urađen (D1 prije predaje), a staje na prvom koji nije stigao. Svaki upis
    nosi isti ključ zahtjeva kao prvi pokušaj (posrednik `vanMreze()` u `server/vanMreze.ts`, tabela `kljuc_zahtjeva`,
    radnja `vm:…`): ponovljen → prvi odgovor; neuspio (4xx) → ključ se oslobađa; još u obradi → 409 `U_TOKU` (telefon
    pokušava kasnije); rezervacija bez ishoda starija od 10 min → oslobađa se. Upis iz reda nosi `x-uradjeno-at` —
    vrijeme radnje (izmjereno_at, izvrseno_at, potvrdjeno_at) je vrijeme sa telefona, `created_at` kad je stiglo, a red
    dobija `van_mreze` (isporuka `potvrda_van_mreze`); budućnost (+2 min) i starije od 36 h se ne primaju. **Predaja se
    provjerava po DANU PREDAJE** (#48, #50, #55): D1 tog dana, rok tog dana. **Status vozila mijenja samo najnovija D1** —
    kasna jučerašnja ne poništava današnju. Upis koji server tada odbije (4xx) NE nestaje: telefon ga šalje na
    `POST /van-mreze/odbijeno` (tabela `van_mreze_odbijeno`, obavještenje odgovornim licima VISOK), a radnik ga vidi
    („server nije primio“) dok ga ne ukloni. `public/sw.js` čuva SVE fajlove aplikacije po spisku koji pravi gradnja
    (`vite.offline.ts` → `offline-spisak.json`, nova verzija = nov keš) i posljednje GET odgovore `/api` (bez prijave,
    izvoza, bekapa, audita, grešaka, push-a, otpremnica; zaglavlje `x-pilot-sacuvano` → traka „podaci su od …“). Keš
    podataka i zapamćen korisnik (`pilot-korisnik-van-mreze`) brišu se pri prijavi i odjavi — zajednički telefon.
    Odjava traži mrežu (sesiju gasi server). Nov upis koji treba da radi bez mreže: `vanMreze("…")` na ruti,
    `vrijemeVanMreze()` u servisu, `upisiIliSacuvaj` u formi, `SacuvanoNaTelefonu` na ekranu, provjera u `talas6`.
86. **D1 je obaveza DANA VOŽNJE, ne kalendara** (proba vlasnice 01.10.2026 — vozaču je stajalo crveno „kontrola
    nije urađena“ za sva vozila iz evidencije, i posle kontrole svog). Dnevna stavka plana za D1 (`DNEVNO` /
    `RADNIM_DANIMA`) važi samo za dan kad vozilo ima isporuku koja nije otkazana (`monitoringService.daniVoznje`) —
    i za „danas fali“, i za „juče propušteno“, i za pregled rupa. Vozač vidi D1 samo za vozila sa SVOJIH današnjih
    isporuka (`korisnikId` u filteru `/monitoring/danas`); Moja strana („Vozilo i kontrola“) isto. `/vozila` vraća
    `vozi_danas`: vozilo koje danas ne vozi piše „Danas ne vozi — D1 nije potrebna“, ne „čeka D1“. Predaja i dalje
    traži D1 tog dana (#55) — to se ne mijenja.
87. **Vozač zna i kad mu isporuka ODE ili se promijeni** (`javiVozacuIzmjenu`): prebačena drugom vozaču ili bez
    vozača → stari vozač dobija „Isporuka … više nije vaša — ne utovarujte“; isti vozač, a promijenjen datum, vozilo,
    kupac ili roba → „Isporuka … je izmijenjena“ sa onim što je promijenjeno. Ko je sam izmijenio — ne obavještava se.
88. **Izvještaji i audit se filtriraju na SERVERU, isti filter za pregled, štampu i CSV** (`izvozService.uslovFiltera`).
    Vrijeme: prva kolona iz `DATUMSKE` koja postoji u izvoru (dan radnje prije trenutka upisa), dan po Podgorici (#11);
    „Zaposleni“ bez vremena (`BEZ_DATUMA`). Kategorije (status, magacin, obrazac, akcija…): samo kolone sa spiska
    `KATEGORIJSKE` koje izvor stvarno ima — naziv kolone nikad iz zahtjeva u SQL; vrijednost uvijek kao parametar;
    spisak vrijednosti dolazi sa servera (`filteri`). Audit: period, ko, radnja, nad čim, tekst u vrijednostima
    (`/audit/filteri`), najviše 500 redova. Ekran: `FilterVremena` (danas, 7 dana, ovaj/prošli mjesec, godina, sve, od–do);
    filteri idu i u zaglavlje štampe.
89. **„Riješeno je“ — mjera i provjera JEDNIM upisom, ista pravila** (proba vlasnice 03.10.2026: „kad hoću da zatvorim,
    nešto se nesretno završava“ — zatvaranje je tražilo mjeru, „urađeno“ i provjeru, u dva dijela prozora). `POST
    /neusaglasenosti/:id/rijesi` (`ncService.rijesiOdmah`, bzr i konsultant), JEDNA transakcija: otvorena mjera se
    završava (dodijeljena nekome — baš ona), inače nova, odmah urađena; status „čeka provjeru“. Dalje isto kao do sada:
    fali ponovna kontrola ili kraj povlačenja (#61) → čeka, odgovor kaže šta fali (`razlog`); drugo odgovorno lice postoji
    ili upisuje konsultant → čeka DRUGOG (četiri oka, #15a), on dobija obavještenje; JEDINO odgovorno lice → zatvara
    odmah, ali samo uz kvačicu i „šta ste provjerili“ ≥ 10 znakova (`IZUZETAK_POTREBAN`, `OBRAZLOZENJE_OBAVEZNO` — prije
    ikakvog upisa), sa oznakom „bez četiri oka“ i obavještenjem konsultantu (#41) — provjera je isti `verifikujU` kao
    „Provjereno — zatvori“. Ekran unaprijed zna sve to (`stanjeProvjere`: `samaZatvara`, `fali`, `faliGdje`,
    `povlacenjeId`) i bira dugme: „Upiši i zatvori“ / „Upiši — šalji na provjeru“ / „Upiši urađenu mjeru“.
90. **Inspekcijski paket samo čita i ništa ne uljepšava** (`inspekcijaService`, 04.10.2026 — „ono što se prodaje: dokaz da
    zapisi nastaju svaki dan“). Period se provjerava na SERVERU (`periodPaketa`): najviše 366 dana (`PERIOD_PREDUG`), početak
    ne poslije kraja ni u budućnosti; bez „od“ — godinu unazad, kraj u budućnosti se odsijeca na danas. Prvo kontinuitet:
    zapisa po danu (dan RADNJE po Podgorici, #11), koliko je upisano naknadno (`naknadno_dana`, #10 — ispravka se ne broji
    kao nov zapis), koliko ljudi upisuje, izvršenje plana monitoringa iz `pregledPlana` — ISTO brojanje kao HACCP plan (#43;
    tekući dan/sedmica/mjesec se ne ocjenjuje). KKT 1 je uz prijem (i u kalendaru se ne broji kao mjerenje), ostala mjerenja
    posebno. Dnevni obrasci idu SVI — ispravka i zamijenjena verzija se obje vide (#1, #57). Neusaglašenosti i povlačenja: sve
    koje su bile otvorene u periodu (nastale do kraja, nisu zatvorene prije početka). Knjižice: stanje u PERIODU, ne samo
    danas; samo broj i rok (#15). Provjera znanja po terminu, bez imena — prodaje se kao dokaz o obuci i nadzoru (Uredba
    91/2026, Dio 13), nikad kao „zakon traži test“. ZIP (`paketZip`): CSV iz `IZVORI_IZVOZA` sa istim filterom kao Izvještaji
    (#88), BEZ audita (nosi IP adrese i uređaje zaposlenih — daje se na zahtjev), izvor koga nema ne obara paket (#30, piše
    se u `SADRZAJ.txt`). `server/zip.ts` je bez spoljne biblioteke (zlib `deflateRawSync` + `crc32`, imena u UTF-8, vrijeme po
    Podgorici). Vidi ga bzr, konsultant i uprava (direktor dočekuje inspektora kad odgovorno lice nije tu).
91. **Kontrolne tačke KKT 1, KKT 2 i KKT 3 postoje na SVAKOJ bazi** (11.10.2026). Kod ih traži po šifri, a bez njih ćuti:
    prijem bez KKT 1 i predaja bez KKT 3 preskaču mjerenje i ocjenu temperature (`if (!kkt3Id) return []`), granica artikla
    ne postaje pravilo (#39), osnovni plan izostavlja mjerenja. Do sada su nastajale SAMO uz demo podatke — na bazi pravog
    klijenta ih ne bi bilo. Sada: nova baza ih dobija u `prvi-korisnik` (uz firmu), postojeća bez njih u dopuni 36 (samo kad
    firma postoji — da `migriraj` pa `seed:demo` ne padne na istoj šifri). Test `alati` provjerava praznu bazu, ne demo.
92. **Uvoz upitnika samo dopunjuje, nikad ne prepisuje** (`alati/uvoz-start.ts`, 11.10.2026). Fajl iz `upitnik-start/`
    (format `pilot-upitnik-start`) ide u bazu klijenta u JEDNOJ transakciji; bez `--upisi` se na kraju poništi, pa je proba
    tačno ono što bi upis uradio. Odbija demo bazu (demo nalozi), bazu bez tabela i bazu bez `prvi-korisnik`. Postojeće
    (naziv, PIB, registarska oznaka) se preskače — uvoz se smije ponoviti; firmi i postojećem licu dopunjava samo PRAZNO
    (drugačiju vrijednost kaže, ne mijenja). Prazan podrazumijevani „Glavni magacin“ (bez ijednog prijema, isporuke, mjerenja,
    zapisa) dobija ime prvog magacina iz upitnika. Ista pravila kao aplikacija: šifra lica iz `sljedeciBroj` (#34), kupac bez
    telefona se ne upisuje (#4), PIB ciframa i jedinstven (#66), u lice samo broj i rok knjižice (#15), granica artikla →
    pravilo (#39) i `granica_potvrdio = false` (#5 — potvrđuje čovjek), loša granica → predlog režima (drugi režim bez
    granice — odbijen), šifra kod dobavljača → `artikal_dobavljaca` (isti `kljucArtikla` kao prijem), audit sa
    `izvor: alati/uvoz-start`. NE otvara naloge (#28), ne upisuje komore, kalibracije ni ritam rada — to ispiše konsultantu.
94. **Provjeru znanja radi samo zaposleni koji RUKUJE HRANOM** (`lice.rukuje_hranom`, 11.10.2026 — direktoru Đorđu Peroviću na
    demo bazi se nudila). Isto pravilo kao knjižica i obuka (#20): provjera je dokaz o obuci onih koji rade sa hranom (Uredba
    91/2026, Dio 13). Ko ne rukuje hranom — kartica „Otvorena je provjera znanja“ se ne pokazuje (`moj-termin` → `otvoren: false`),
    a ulaz se odbija (403 `PROVJERA_NIJE_ZA_VAS`). Već upisani rezultati se ne brišu (#1). Direktor koji i sam rukuje hranom
    (mala firma) — u Ljudi označiti „rukuje hranom“, pa radi provjeru kao i ostali.
95. **Direktor ima svoj, jednostavan Kontrolni centar** (pitanje vlasnice 11.10.2026: „šta mu u stvari koristi od ovoga“).
    Direktor je „odgovorno lice u pravnom licu“ (čl. 82) i plaća uslugu — treba mu odgovor „jesmo li u redu, šta traži moju
    odluku i vode li se zapisi svaki dan“, ne operativne kartice odgovornog lica. `/tabla` za `uprava` = `DirektorPregled`
    (`GET /tabla/direktor`, samo `uprava`, `stanjeService.pregledDirektora`): semafor i stavke iz ISTE `ocjena` kao „Stanje
    poslovanja“ (#93) za posljednjih 7 dana sa danas; četiri broja (kontrole po planu, zapisi na vrijeme, otvorene
    neusaglašenosti, isporuke) prema prethodnih 7; zapisi po danu za 14 dana (crveno = radni dan bez zapisa); povlačenje u toku
    sa brojem obaviještenih kupaca; „Došao inspektor“ → `/inspekcija`; „Poruka odgovornom licu“; aktivnost uživo samo na klik.
    Meni direktora: Kontrolni centar, Moja strana, Poruke, Za inspekciju (Zalihe, HACCP plan i Sledljivost sklonjeni iz menija i
    ruta pregledača). API prava za čitanje (`/lotovi`, `/povlacenja`, `/haccp-plan`…) uprava zadržava — sklonjen je ekran, ne pravo.
**Izvještaji su konsultantovi; direktor dobija „Stanje poslovanja“ mejlom** (odluka vlasnice 11.10.2026). `/izvjestaji` i
    izvoz (`/izvoz/*`) — samo `izvodjac`; odgovornom licu i direktoru ostaje „Za inspekciju“ (#90). `/stanje-poslovanja`
    (`stanjeService`, samo `izvodjac`): period dan, sedmica, mjesec, kvartal, polugodište, godina — bez dana posljednji
    ZAVRŠENI, tekući se siječe na danas („do danas“), budućnost 400 `PERIOD_U_BUDUCNOSTI`; svaki broj poređen sa prethodnim
    periodom iste vrste. Na vrhu semafor i najviše 7 stavki „šta treba uraditi“ (crveno: povlačenje u toku, otvorena NC VISOK,
    istekla knjižica, neispravan termometar, plan < 80 %). Isti izvori kao ostatak: plan iz `pregledPlana` (#43), naknadno
    (#10), dan po Podgorici (#11), knjižice na KRAJ perioda (#15). Mejl je HTML sa tabelama i stilovima u redu — grafikoni su
    stubići od tabela, ne slike (vidi se u svakom programu pošte bez preuzimanja slika), bez skripti; na telefonu (≤ 480 px)
    kartice idu jedna ispod druge. PDF pravi pregledač (`Sačuvaj PDF` → novi prozor sa izvještajem + štampa → „Sačuvaj kao PDF“;
    `@page` A4, `print-color-adjust: exact` da stubići i semafor ostanu u boji, blok se ne lomi) — bez biblioteke na serveru.
    Šalje se preko SMTP naloga konsultanta (env `SMTP_HOST`, `SMTP_PORT` — 465 = TLS,
    `SMTP_KORISNIK`, `SMTP_LOZINKA`, `SMTP_POSILJALAC`); bez njih 409 `SLANJE_NIJE_PODESENO` i „Sačuvaj PDF“ / „Preuzmi HTML“ (isti HTML
    kao fajl). Primaoci (`firma.izvjestaj_primaoci`, najviše 10, audit) — predlog je mejl firme. Trag `izvjestaj_poslat` se
    upisuje tek POSLIJE uspješnog slanja (502 `SLANJE_NIJE_USPJELO` → nema traga). Automatsko slanje po rasporedu još ne postoji.
---

## Nalazi — arhitektura, baza, uloge, HACCP tok (pregled koda 23.09.2026)

Ozbiljnost: **K** kritično (pogrešan podatak ili zaglavljena roba) · **V** visoko · **S** srednje · **N** nisko.

### HACCP tok

| # | | Nalaz | Gdje |
|---|:-:|---|---|
| H1 | ✓ **riješeno u fazi 1 (23.09.2026)** | ~~Lot na HOLD-u je slijepa ulica.~~ Sada: `bzr` pušta (razlog obavezan) ili odbija zadržan lot; pušteno → RELEASE, odbijeno → OTPIS iz karantina; ne pušta se dok je povlačenje U_TOKU. Usput nađeno i ispravljeno: lot zadržan PRI PRIJEMU nije imao zalihu uopšte, a odluka „HOLD" nije upisivala PRIJEM u dnevnik kretanja. | `prijemService.donesiOdlukuOLotu` |
| H2 | ✓ **riješeno u fazi 1 (23.09.2026)** | ~~Neusaglašenost se može zatvoriti bez korektivne mjere.~~ Sada: samo iz CEKA_VERIFIKACIJU, a mjeru bira server (posljednja urađena) — četiri oka se ne mogu zaobići izostavljanjem id-a. | `ncService.verifikuj` |
| H3 | ✓ **riješeno u fazi 1 (23.09.2026)** | ~~Odstupanje u obrascu ne ulazi u tok neusaglašenosti.~~ Sada: neusaglašenost u „čeka provjeru" + zadatak + obavještenje `bzr`. **Posljedica za H7:** kad odstupanje upiše samo odgovorno lice, provjeriti ga može samo konsultant. | `ncService.neusaglasenostIzZapisa` |
| H4 | ✓ **riješeno u fazama 1 i 3 (23–24.09.2026)** | ~~KKT 1 i KKT 2 ne poštuju `granica_potvrdio`.~~ Sada na jednom mjestu (`zabiljeziMjerenje`). ~~Dva izvora granica.~~ U fazi 3: granica artikla postaje pravilo (`pravilaService`), KKT 3 više ne čita artikal (invarijanta #39). | `haccpService`, `pravilaService` |
| H5 | ✓ **riješeno u fazi 3 (24.09.2026)** | ~~Nema plana monitoringa.~~ Sada `plan_monitoringa` + „Danas po planu" na Mojoj strani, kartica „Danas fali po planu · juče propušteno" na tabli, propušteni dani za 30 dana na `/haccp-plan`. | `monitoringService` |
| H6 | ✓ **riješeno u fazi 3 (24.09.2026)** | ~~Verifikacija sistema nije pokrivena.~~ Sada termometri (interna provjera, kalibracija, rokovi), revizija plana / interni audit / vježba povlačenja, štampa HACCP plana iz podešenog. | `haccpPlanService`, `/prilozi` |
| H7 | ✓ **riješeno u fazi 3 (24.09.2026)** | ~~Firma sa jednim odgovornim licem ne može zatvoriti neusaglašenost.~~ Sada svjesno označen izuzetak (invarijanta #41). | `ncService.verifikuj` |

### Baza

| # | | Nalaz | Gdje |
|---|:-:|---|---|
| B1 | ✓ **riješeno u fazi 2 (24.09.2026)** | ~~Brojevi = `count(*) + 1`.~~ Sada `sljedeciBroj()`: ključ po prefiksu + najveći postojeći broj, u transakciji. Pet istovremenih prijava dobija pet različitih brojeva (test). Nasumični formati `NC-…-P###` / `-V###` ukinuti. | `brojeviService` |
| B2 | ✓ **riješeno u fazi 2 (24.09.2026)** — djelimično | ~~Polimorfne veze bez zaštite.~~ Sada CHECK liste u bazi (potvrđene i nad starim redovima na demo bazi) + tip u kodu. **Ostaje:** `izvor_id` i dalje nema FK — može pokazivati na obrisan red (brisanja poslovnih redova ionako nema). | 22, `zadaciService` |
| B3 | **S** | **Zaliha nije po skladištu** — skladište lota se čita iz prijema; premještanje ne postoji. Kad se uvede, `zaliha` mora dobiti `skladiste_id`. | 05, 19 |
| B4 | ✓ **riješeno u fazi 4 (24.09.2026)** | ~~Dva dnevnika.~~ `dogadjaj` se više ne puni (čitalo ga je jedno polje koje ekran nije ni prikazivao); jedini dnevnik je `audit_log` — dopunjen tamo gdje je samo `dogadjaj` bilježio (status vozila poslije D1, neusaglašenost od termometra, ishod provjere). „Aktivnost uživo" i dalje iz domenskih tabela — to je pregled rada, ne dnevnik. | `auditService` |
| B5 | **N** | Pogledi sa `p.*` se ne proširuju sami kad se doda kolona — mora `drop` + `create` (desilo se u 19). | `v_izvoz_*` |
| B6 | **N** | `CHECK ... NOT VALID` — stari redovi sa praznom mjerom nisu provjereni. | 07 |

### Arhitektura i pogon

| # | | Nalaz | Gdje |
|---|:-:|---|---|
| A1 | ✓ **riješeno u fazi 1 (23.09.2026)** — osim rasporeda | ~~Bekap samo u istoj bazi.~~ Sada `npm run bekap` (`pg_dump` na računar, provjeren, 90 dana). **Ostaje:** raspored — alat je spreman (`npm run zakazi-bekap`, talas 5), a pokreće ga vlasnica jednom na svom računaru. | `alati/bekap.ts` |
| A2 | ✓ **riješeno u fazi 2 (24.09.2026)** | ~~Više koraka bez transakcije.~~ Sada 26 mjesta u transakciji: šifarnici, nalozi (uloga, lozinka, deaktivacija + brisanje sesija), zadaci, pravila kontrole (`for update`), zapis + neusaglašenost, izmjena stavke prijema (`for update` — ne preplete se sa odlukom), povlačenje, bekap sa table (`repeatable read` — jedan snimak). Prijava (poslednja prijava + sesija) svjesno nije. | rute, servisi |
| A3 | ✓ **riješeno u fazi 4 (24.09.2026)** | ~~Ko smije zavisi od redoslijeda montiranja.~~ Riješeno drugačije nego „svaki ruter svoj prefiks" (to bi promijenilo sve adrese u pregledaču i testovima): jedna granica prijave, ruteri bez `.use`, uloge na svakoj ruti, i `provjeriRute()` pri startu (invarijanta #44). Pri prvom pokretanju je sama našla 10 ruta bez uloga. | `server/index.ts`, `provjeraRuta.ts` |
| A4 | ✓ **riješeno u fazi 4 (24.09.2026)** — za navedenih pet | ~~SQL u rutama `zadaci`, `poruke`, `tabla`, `ljudi`, `provjeraZnanja`.~~ Sada `zadaciService`, `porukeService`, `tablaService`, `ljudiService`, `provjeraZnanjaService`. Usput: promjena uloge i deaktivacija naloga sada pišu audit. **Ostaje:** liste u ostalim rutama (invarijanta #47). | `server/services/` |
| A5 | ✓ **riješeno u fazi 4 (24.09.2026)** | ~~Testovi na demo bazi Rendera, bez CI.~~ `npm test` = sopstvena čista baza na računaru; GitHub Actions na svaki push. Prvo pokretanje na čistoj bazi je odmah našlo grešku u izvozu (prazna tabela bez zaglavlja). | `testovi/izolovano.mjs`, `.github/workflows/` |
| A6 | ✓ **riješeno u fazi 4 (24.09.2026)** | ~~Obavještenja samo dok je aplikacija otvorena.~~ Web Push (PWA): Moja strana → „Obavještenja na telefon", po uređaju; iPhone samo sa početnog ekrana (iOS 16.4+). Zvonce na 30 s ostaje. **Nije još viđeno na pravom telefonu** — test glumi push servis. | `pushService`, `public/sw.js` |
| A7 | **N** | Liste bez straničenja (lotovi, isporuke, neusaglašenosti) — dovoljno za malog distributera. | rute |
| A8 | **N** | Ograničenje pokušaja prijave je u memoriji — restart ga briše. | `server/auth.ts` |

### Uloge

| # | | Nalaz |
|---|:-:|---|
| U1 | ✓ **riješeno u fazi 2 (24.09.2026)** | ~~GET rute samo sa `requireAuth`.~~ Sada svaka GET ruta ima uloge po mapi strana; `/lica` samo vodstvo (+ `/lica/ja`); neusaglašenosti na terenu samo svoje; `/tabla` samo vodstvo i uprava. |
| U2 | ✓ **riješeno u fazi 3 (24.09.2026)** | ~~Pravilo četiri oka nema izlaz za malu firmu.~~ Izabran svjesno potpisan izuzetak (ne uprava, ne konsultant umjesto firme) — invarijanta #41. |
| U3 | **N** | Jedan `izvodjac` nalog po bazi — ako konsultantkinja dobije saradnika, dijele nalog i ne vidi se ko je šta uradio. |

### Revizija 25.09.2026 — nalazi R-01 … R-37

Puna revizija (12 faza, dokazi, „NIJE UTVRĐENO“ gdje se nije moglo provjeriti) je izvještaj van
repozitorijuma. Ovdje samo stanje.

| # | | Nalaz | Stanje |
|---|:-:|---|---|
| R-01 | K | Potvrda isporuke nije provjeravala lot ni zalihu (zaliha u minusu, predaja povučenog lota) | ✓ talas 1 — #48, #53 |
| R-02 | K | Istekao rok nije blokirao isporuku | ✓ talas 1 — #50 |
| R-03 | V | Vraćena roba išla u slobodnu zalihu bez procjene | ✓ talas 1 — #49 |
| R-04 | V | Terenska uloga radila sa tuđom isporukom | ✓ talas 1 — #51 |
| R-05 | V | Kontrola vozila (D1) ne ocjenjuje temperaturu; status bez datuma; kvačice unaprijed označene | ✓ talas 2 — #55 |
| R-06 | V | Audit ne pamti staru vrijednost („prije“) | ✓ talas 2 — #56 (i: sopstvena lozinka, firma, zadatak, „obuka obavljena“ sada pišu audit; pitanja firme i termini provjere znanja još ne) |
| R-07 | V | Ispravka dnevnog zapisa: grananje ispravki, nema dugmeta u ekranu | ✓ talas 2 — #57, dugme „Ispravi“ |
| R-08 | V | Odstupanje u DHP obrascima je ručna kvačica, ne slijedi iz vrijednosti | ✓ talas 2 — #58 |
| R-09 | V | Ručno mjerenje ne gleda artikal | ✓ talas 2 — #59 |
| R-10 | V | Dupli klik pravio duple zapise | ✓ talas 1 — #52 |
| R-11 | V | Ograničenje prijave iza Render proksija važilo za sve | ✓ talas 1 — #54 |
| R-12 | V | Supabase Data API i RLS | ✓ 27.09.2026 — Advisor potvrdio rupu (sve tabele bez RLS-a, 15 pogleda „security definer“); Data API gasi vlasnica u panelu, u bazi dopuna 32 — #78 |
| R-13 | S | Magacioner čitao bilo koji prijem; stavka mijenjana bez provjere prijema | ✓ talas 1 — #51 |
| R-16 | S | Potvrda sa djelimičnim spiskom stavki | ✓ talas 1 — #48 |
| R-26 | S | Bez interneta / 502 → generička poruka | ✓ djelimično (pregledač: „Nema veze…“, „Server ne odgovara…“); ZodError i loš UUID → 500 ostaje |
| R-20 | S | Izvoz bez D1, provjera NC, termometara, verifikacije sistema, kretanja zaliha | ✓ talas 2 — pogledi `v_izvoz_*` (27) |
| R-22 | S | Nema ponovne kontrole poslije korektivne mjere | ✓ talas 2 — #61 |
| R-23 | S | Mjerenje ne pamti termometar | ✓ talas 2 — #60 |
| R-14 | S | Nema rezervacije zalihe | ✓ talas 3 — #62 |
| R-15 | S | Isporuka se ne može otkazati; kupac se ne može ispraviti | ✓ talas 3 — #63 |
| R-17 | S | Ista serija kao više lotova; rok nije obavezan | ✓ talas 3 — #64 (serija za povlačenje kroz sve prijeme) |
| R-21 | S | Nema izlazne otpremnice | ✓ talas 3 — #65 |
| R-28 | S | Kupac bez PIB-a i adrese isporuke; PIB nije jedinstven | ✓ talas 3 — #66 (EAN artikla još nije) |
| R-37 | N | Temperatura pri predaji po stavci — mnogo unosa | ✓ talas 3 — u formi jedna po grupi robe istog režima („Različito po stavci“ ostaje); server i dalje po stavci |
| R-19 | S | Bekap iz aplikacije sa heševima lozinki | ✓ mali talas 4 — #68, dopuna 30 |
| R-25 | S | `/api/zdravlje` ne provjerava bazu | ✓ mali talas 4 — #70 |
| R-26 | S | ZodError, loš UUID, loš JSON → 500 | ✓ mali talas 4 — #69 |
| R-27 | S | Nema CSP i HSTS | ✓ mali talas 4 — #70 (provjereno u produkcijskom režimu: stranica, fontovi i service worker rade) |
| R-18, R-24, R-29 – R-36 | S/N | Izvor istine za količine, straničenje, uloga podrške, statusi kao tekst, dupli odgovor u provjeri znanja (UQ u bazi), veliki JS paket, korisnik baze sa punim pravima, velike slike za OCR | otvoreno |

---

## Plan izmjena po fazama

| Faza | Šta | Nalazi | Procjena |
|---|---|---|---|
| ~~**1 — HACCP rupe i bekap**~~ ✓ 23.09.2026 | Pusti / odbij lot na HOLD-u. Provjera samo uz urađenu mjeru. Odstupanje u obrascu → neusaglašenost. Potvrđena granica na svim KKT. `npm run bekap`. Test `faza1_haccp` (33 provjere). **Ostalo: Task Scheduler za bekap.** | H1, H2, H3, H4, A1 | urađeno |
| ~~**2 — Integritet baze**~~ ✓ 24.09.2026 | Brojevi iz `sljedeciBroj()`. 26 višekoračnih upisa u transakciji. CHECK liste za `izvor_tip` (dopuna 22). Uloge na svim GET rutama. Test `faza2_integritet` (30 provjera). Uz to: nalog i početna lozinka pri unosu zaposlenog, „Nova lozinka", kartice direktora, ulaz u provjeru znanja sa prijave. | B1, A2, B2, U1 | urađeno |
| ~~**3 — HACCP kao sistem**~~ ✓ 24.09.2026 | Plan monitoringa + „šta danas fali" na tabli i Mojoj strani. Termometri (provjera, kalibracija), revizija plana, interni audit, vježba povlačenja, štampa HACCP plana. Izuzetak od četiri oka za malu firmu. Jedan izvor granica. Temperatura obavezna na KKT 1. Dopuna `24_haccp_sistem_cg`, test `faza3_sistem` (41 provjera). | H5, H6, H7, U2, ostatak H4 | urađeno |
| ~~**4 — Arhitektura i pogon**~~ ✓ 24.09.2026 | Jedna granica prijave + provjera ruta pri startu. SQL pet ruta u servise. `npm test` na sopstvenoj bazi + GitHub Actions. `dogadjaj` ugašen. Push obavještenja (PWA, dopuna 25, test `push`). Uz to: provjeru znanja radi samo prijavljeni, svojom šifrom, sa početne strane. | A3, A4, A5, B4, A6 | urađeno |
| ~~**Talas 1 revizije**~~ ✓ 25.09.2026 | Predaja provjerava lot, rok i zalihu u trenutku predaje; zaliha nikad u minusu (CHECK); povrat u karantin + pusti/otpiši; istekao rok blokiran + kartica „Rok robe“ + obavještenje; samo svoje isporuke i prijemi; ključ zahtjeva + zaključano dugme; „Ne predajte lot“; `trust proxy`. Dopuna `26_talas1_cg`, test `talas1` (44 provjere). | R-01, R-02, R-03, R-04, R-10, R-11, R-13, R-16 | urađeno |
| ~~**Talas 2 revizije**~~ ✓ 25.09.2026 | D1 sa temperaturom po granici vozila, „spremno danas“, rashladno vozilo za robu pod režimom, D1 prije predaje; audit „prije → poslije“; ispravka zapisa („Ispravi“, jednom, svoj); odstupanje iz odgovora u obrascu; lot po granici svog artikla; termometar na mjerenju i „upitna“ mjerenja; ponovna kontrola prije zatvaranja; 5 novih izvora izvoza. Dopuna `27_talas2_cg`, test `talas2` (53 provjere). | R-05 – R-09, R-20, R-22, R-23 | urađeno |
| ~~**Talas 3 revizije**~~ ✓ 26.09.2026 | Rezervacija (slobodno = zaliha − isporuke u pripremi), otkaz isporuke uz razlog i ispravka kupca, rok obavezan po artiklu, serija jednom po prijemu i povlačenje cijele serije, otpremnica za štampu, PIB i adresa isporuke kupca, jedna temperatura po grupi režima. Dopune `28`, `29`, test `talas3` (35 provjera). | R-14, R-15, R-17, R-21, R-28, R-37 | urađeno |
| ~~**Mali talas 4**~~ ✓ 26.09.2026 | Bekap bez tajni (+ dopuna 30 za stare), zdravlje sa bazom, 4xx umjesto 500, CSP/HSTS/Permissions-Policy. Uz to: provjera znanja uz lozinku prijavljenog, poruke šalju svi zaposleni. Test `talas4` (12 provjera). | R-19, R-25, R-26, R-27 | urađeno |
| ~~**Talas 5 — sigurnost i pogon**~~ ✓ 29.09.2026 (inspekcija 29.09.) | `sharp` 0.35.5 (ranjivosti u libvips) i provjera veličine slike; izvoz bez Excel formula i po Podgorici; asinhroni scrypt sa parametrima u hešu; dopune baze pri pokretanju + zdravlje; dnevnik grešaka u bazi; potvrda u dva koraka za vodstvo (+ obavezna po instanci); zaštita od pada ekrana, rok za zahtjev, traka „nema interneta“; demo lozinke iz koda u `.env` + `npm run demo-lozinke`; `npm run zakazi-bekap`, `npm run iskljuci-2fa`, `npm run demo:lokalno`; dnevni pregled sa greškama, dopunama i 2FA. Repozitorijum je vlasnica prebacila u privatni. Dopuna `33_talas5_cg`, test `talas5` (40 provjera). | inspekcija #1–#10 | urađeno |
| ~~**Talas 6 — teren i testovi**~~ ✓ 30.09.2026 | Rad bez interneta za vozača i magacionera (#85): red na telefonu, isti ključ, vrijeme sa telefona i oznaka „bez mreže“, predaja po danu predaje, odbijeni upisi odgovornom licu, aplikacija i posljednji podaci sačuvani na telefonu (service worker). Testovi ekrana (`npm run test:ekrani`, Chrome, 375 px, 5 uloga, bez mreže) — odmah našli dvije greške (bijela strana posle gradnje, Prilozi van ekrana). Paket po stranama (`React.lazy`) i gradnja bez serverovog `.env`: 970 → 257 KB. Dopuna `34_van_mreze_cg`, testovi `talas6` (31) i ekrani (32). | inspekcija #11–#18 (dio) | urađeno |
| **Ostatak talasa 6** | Server kompajliran u JS umjesto `tsx`; `statement_timeout`; ESLint/Prettier; podjela `otpremnicaService` i `NoviPrijem`; ograničenje slanja otpremnica po korisniku; alat za novog klijenta. | inspekcija #11–#18 (ostalo) | oko 1 sedmica |
| **Talas 7 — prodajne funkcije** | ~~„Inspekcijski paket“ jednim klikom (PDF/ZIP za period)~~ ✓ 04.10.2026 (#90, test `inspekcija`, ekran `6_inspekcija`); ~~izvještaj direktoru~~ ✓ 11.10.2026 — „Stanje poslovanja“ (#93, test `stanje`), za sada se šalje klikom; automatsko slanje po rasporedu; demo koji se vraća svake noći; uvoz iz Excela (zaposleni, artikli, kupci, dobavljači); pregled svih klijenata za konsultanta; EAN skeniranje; „preuzima kupac“. | inspekcija #20–#26 | 2–3 sedmice |
| **Ostatak talasa 4** | Jedan odgovor po pitanju i u bazi (UQ), korisnik baze sa najmanjim pravima, provjera veličine slike za OCR, podjela JS paketa po stranama. | R-12, R-33 – R-36 | posle pilota |
| **5 — Po potražnji klijenata** | Premještanje robe među skladištima, straničenje, više konsultantskih naloga. ~~Skeniranje otpremnica~~ ✓ 24.09.2026, urađeno prije faze 3 na zahtjev vlasnice (bez spoljnih servisa). | B3, A7, U3 | po stavci |

**Pilot sa prvim klijentom ide paralelno od faze 1** — pravi magacioner nađe ono što test ne nađe.

---

## Naučeno na teži način

| Problem | Uzrok | Rješenje |
|---|---|---|
| neusaglašenost se nikad nije mogla zatvoriti (500) | isti parametar i kao enum (`set status = $1`) i kao tekst (`case when $1 = …`) | kastovati na SVAKOM mjestu: `$1::nc_status_t`, `$2::uuid` |
| uprava 403 na Kontrolnom centru; provjera znanja 401 za sve | `.use(requireAuth, requireUloga(…))` BEZ putanje na ruteru montiranom na `/api` važi i za rute registrovane poslije | od faze 4: jedna granica prijave, ruteri bez `.use`, uloge na svakoj ruti, `provjeriRute()` pri startu (#44); `testovi/pristup.test.mjs` |
| lot pod povlačenjem i dalje ponuđen za isporuku | povlačenje nije mijenjalo status lota | povlačenje stavlja lot na HOLD, zalihu u karantin |
| „poruka nije stigla" — a stigla je | zvonce se osvježavalo samo pri prelasku na drugu stranu | provjera na 30 s + pri povratku u aplikaciju (`Layout.tsx`) |
| ne zna se je li deploy prošao | izdanje zakucano na „1.0.0" | izdanje = `RENDER_GIT_COMMIT`, u `/api/zdravlje` i u dnu menija |
| deploy odjavljuje vozača usred ture | sesije u memoriji servera | sesije u bazi (`sesija_prijave`, heš tokena) |
| skor provjere znanja se mogao naduvati | više odgovora na isto pitanje, odgovori poslije završetka | jedan odgovor po pitanju, ništa poslije završetka |
| svi demo zapisi nose „naknadno" | vrijeme upisa = trenutak pokretanja skripte | `13_demo_cg.sql` na kraju poravnava `created_at` sa datumom |
| odstupanje „sa mjerom" koja je prazan razmak | `CHECK` je tražio samo `IS NOT NULL` | `COALESCE(btrim(…),'') <> ''`, `NOT VALID` |
| `cannot change data type of view column` / nova kolona ne ulazi u izvoz | `create or replace view` ne mijenja tip ni redoslijed; `p.*` se razvija pri pravljenju | `drop view` + `create view` |
| `invalid input value for enum` | `ALTER TYPE … ADD VALUE` u istoj transakciji sa upotrebom | samostalna naredba |
| build pada, typecheck prolazi (ili obrnuto) | `replaceAll`, `.at()` — projekat cilja stariji JS | `.replace(/…/g, …)`, `[arr.length - 1]` |
| kvačice kao `Ä‡` | kopirano bez UTF-8 | uvijek UTF-8 |
| zadržana roba se nije mogla ni pustiti ni odbiti | odluka je primala samo lot PRIMLJEN; RELEASE u enumu, a niko ga ne koristi | odluka radi i iz HOLD (`odHolda`); test `faza1_haccp` |
| lot zadržan pri prijemu (temperatura) nema zalihu uopšte | HOLD na KKT 1 se desi PRIJE odluke, pa prebacivanje DOSTUPNO → KARANTIN nema šta da prebaci | puštanje takvog lota pravi zalihu i PRIJEM u dnevniku; kod čita količinu u karantinu i ne pretpostavlja da postoji |
| zaliha u karantinu se udvostruči ili padne na unique | drugi HOLD istog lota radio je `insert` u `zaliha` sa (lot, status) koji već postoji | `on conflict (lot_id, status) do update` — sabira |
| `pg_dump` pravi bekap od 78 tabela, pola tuđih | Supabase ima svoje šeme (`auth`, `storage`, …) | `--schema=public`; sesije bez podataka (`--exclude-table-data`) — to su živi tokeni |
| dvije istovremene prijave → druga pada sa `duplicate key` | broj = `count(*) + 1` čitan van transakcije | `sljedeciBroj()` — ključ po prefiksu do kraja transakcije, `max` umjesto `count` |
| direktoru se kartice na Kontrolnom centru „ne otvaraju" | klik je vodio na strane na koje uprava ne smije, pa `mozeNa()` nije radio ništa | lista iza broja u prozoru (`/tabla/detalj`), ISTI uslov kao brojanje |
| „Lotovi na HOLD-u" vodi na Zalihe, a tamo ih nema | Zalihe se otvaraju na „Prihvaćeni" | kartica šalje izabran status (`navigate(…, { state })`) |
| Moja strana je čitala spisak SVIH zaposlenih da nađe svoje ime | `/lica` bez uloga, filtriranje u pregledaču | `/lica/ja`; `/lica` samo vodstvo |
| OCR fotografije gubi red tabele | `tesseract.js` podrazumijevano čita stranicu kao JEDAN blok (PSM 6) | `tessedit_pageseg_mode: 3` + Sauvola prag (`thresholding_method: 2`) — sjenka više ne briše pola papira (pouzdanost 67 → 90 %) |
| ista fotografija: u testu tačna, iz pregledača smeće | pregledač je smanji i ponovo kompresuje, a OCR je osjetljiv na razmjeru; zaglavlje nakrivljene tabele pada u dva reda | polja se prepoznaju po OBLIKU s desna (datum, lot, broj, jedinica), naziv je ostatak; slanje do 3200 px; test sa obje verzije slike |
| rečenica „…količinski manjak, … istekao rok, LOT" prepoznata kao zaglavlje tabele | tri riječi kolona u jednoj rečenici | zaglavlje = kratak red u kom su labele većina, i uzima se prvi kandidat ISPOD kog ima stavki |
| forma prijema ostavila prvog dobavljača sa spiska kad sa otpremnice nije prepoznat | početna vrijednost polja | nepoznat → prazno („— izaberite dobavljača —") |
| `pdfjs-dist` na starijem Node-u ne radi | traži Node ≥ 22.13 | `engines.node` u `package.json` — Render bira verziju po njemu |
| zaposleni nisu znali gdje se ulazi u provjeru znanja | adresa `/provjera-znanja` je stajala samo kao tekst kod Ane | kartica „Otvorena je provjera znanja — Uđi" na početnoj strani prijavljenog dok je termin otvoren |
| svako je mogao ukucati tuđu šifru i uraditi provjeru umjesto drugoga | ulaz je bio javan, šifrom sa spiska | samo prijavljeni, šifra iz naloga, odgovor i završetak samo za svog učesnika (#32) |
| server pao usred testova: `Connection terminated unexpectedly`, neuhvaćen `'error'` | `pg-pool` skida svoj slušalac greške sa klijenta dok je izdat — prekid veze usred transakcije ruši cio proces | `transakcija()` kači svoj slušalac i vraća klijenta sa `release(greska)` (pokvarena veza se ne vraća u bazen); `pool.on("error")`; `connectionTimeoutMillis: 10_000` |
| testovi odjednom padaju na 400 „Firma ima više skladišta" | vlasnica je na demo bazi (preko Rendera) dodala svoje skladište; testovi su pretpostavljali jedno | testovi biraju skladište izričito; tuđe skladište se nikad ne gasi — provjera „posljednje aktivno" bi inače ugasila Glavni magacin |
| Vite: `Unterminated string`, a stranica bijela | u nizu pod `"…"` tekst „HACCP plan" zatvoren ASCII navodnikom | unutar koda: „…“ (zatvara se sa “, U+201C) |
| prazna tabela se izvozi kao prazan fajl, bez zaglavlja | `nizUCsv` je kolone čitao iz prvog reda | kolone iz upita (`fields`); našao ga je tek test na čistoj bazi — demo baza je uvijek imala redove |
| `pg_ctl start` iz Node-a visi zauvijek | server baze nasljeđuje ručke izlaza, pa `spawnSync` čeka da se zatvore | `stdio: "ignore"` + `-l log.txt` |
| test server ostaje na portu poslije testa | `tsx` komanda pokreće DIJETE-proces; gašenje roditelja ga ne gasi | `node --import tsx server/index.ts` — jedan proces |
| `tijelo()` vraćao ulazni tip šeme (`brojPitanja?: number` iako ima `.default`) | potpis `ZodType<T>` bira ulazni tip | `tijelo<S extends ZodTypeAny>(…): output<S>` |
| web-push upozorava „BadJwtToken" | VAPID `subject` = localhost; Apple ga odbija | na Renderu `RENDER_EXTERNAL_URL`, lokalno `mailto:` (ili `VAPID_SUBJECT=`) |
| zaliha −3 poslije potvrde isporuke | količina se provjeravala samo pri pripremi; otpis između pripreme i predaje nije se vidio | provjera u trenutku predaje, red zalihe `for update`, CHECK u bazi (#48) |
| iza Render proksija 8 pogrešnih pokušaja jednog magacionera zaključa prijavu svima | bez `trust proxy` je `request.ip` adresa proksija | `app.set("trust proxy", 1)` + ključ IP i ime (#54) |
| testovi na demo bazi odjednom padaju na `ROK_ISTEKAO` | demo lotovi imaju rok od dana punjenja baze | `nijeIstekao()` — test bira važeći lot |
| `faza3` na demo bazi: mjerenja odbijena (`TERMOMETAR_OBAVEZAN`) | testni termometar iz prolaza 24.09. ostao u demo bazi NEISPRAVAN (čišćenje tada nije prošlo); novo pravilo traži termometar čim postoji aktivan, a upotrebljivog nije bilo | test pravi svoj ispravan termometar; server kaže `NEMA_ISPRAVNOG_TERMOMETRA`; ostatak isključen kroz aplikaciju (ne obrisan) |
| test je u P7 upisivao `temperatura` — polje koje obrazac nema — i prolazilo je | server nije znao šta obrazac ima; `podaci` su bili bilo kakav objekat | `obrasciService` čita isti `obrasci-cg.json` kao pregledač i odbija nepoznato polje (#58) |
| nov obavezan podatak (rok pri prijemu) — pola testova pada na 400 | testovi primaju robu bez roka, jer ga server nije tražio | `rokZaDana()` u svakom prijemu testa; nov obavezan podatak = pretraga svih testova koji šalju taj zahtjev |
| test na demo bazi bira lot „na zalihi“, a isporuka pada na `NEDOVOLJNO_ZALIHE` | posle rezervacije lot na zalihi može biti sav rezervisan za isporuke u pripremi (vlasnica ih ima na demo bazi) | test bira po SLOBODNOJ robi (`slobodno()`) |
| push test pada samo u punom prolazu na demo bazi („2“ umjesto „1“) | povlačenje demo lota javilo je „Ne predajte lot“ i TUĐOJ isporuci u pripremi (vlasnica ju je unijela) — obavještenje vezano za njen id, čišćenje ga nije brisalo, pa ga je push poslao Marku | čišćenje po tekstu testa; nov tok koji obavještava TUĐE zapise → provjeriti čišćenje svih testova koji ga okidaju |
| „Pileći file 1 kg“ sa otpremnice predložen kao naš „Pileći file smrznuti 500g“ | naziv se poredio slovo po slovo (Dice) — „1 kg“ i „500g“ su tri znaka razlike u dugom nazivu | pakovanje i procenat se čitaju posebno i moraju se slagati; ostatak naziva se poredi bez njih (#72) |
| provjera „anon ne čita naloge“ prolazila je i kad ništa nije bilo zatvoreno | kao običan korisnik baze (ne superuser) `set role anon` pada sa 42501 — ista šifra kao odbijen upit | test prvo provjeri da korisnik smije glumiti `anon` (`pg_has_role … MEMBER`), inače te provjere preskače i kaže; jednom proći cio skup testova kao vlasnik tabela bez superusera (kao `postgres` na Supabase-u) |
| UptimeRobot javlja „aplikacija pala“, a radi (odgovor prazan, `Content-Security-Policy: default-src 'none'`) | besplatni UptimeRobot pita metodom HEAD; stranica aplikacije se slala samo za GET, pa je `/` vraćao Expressov 404 | povratak na `index.html` i za HEAD (`server/index.ts`); monitor da gađa `/api/zdravlje` (javlja i bazu) |
| sa dva magacina, mjerenje komore u jednom „pokrije“ plan drugog; drugi magacioner ne zna da je kolega već izmjerio | mjerenje i zapis nisu pamtili magacin; Moja strana se nije osvježavala; nije pisalo ko je uradio | magacin na mjerenju i zapisu, brojanje po magacinu, „uradio/la: …“, osvježavanje na 45 s (#77) |
| magacioner nije mogao primiti robu od dobavljača kog nema u Šifarnicima | dobavljača je dodavalo samo odgovorno lice, a forma je nudila samo spisak | „+ Nov dobavljač“ u formi prijema, upis u istoj transakciji, obavještenje odgovornom licu (#71) |
| regex u fajlu bez obrnute kose crte (`/(d+…)/` umjesto `/(\d+…)/`), a skripta za izmjenu „prošla“ | skripta pisana kroz bash heredoc: dvostruka kosa crta se sabije u jednu, pa je JS šablon (backtick) proguta | regex i sve sa obrnutom kosom crtom mijenjati alatom Edit ili kroz Python, ne kroz `node` heredoc; poslije izmjene grep-om provjeriti da je `\d` ostalo |
| „Sačuvaj prijem ne radi“ — na računaru | `.modal` je imao `overflow: hidden` bez visine: sa 3+ stavke sa otpremnice dugme je bilo ispod ekrana, nedostižno | `.modal` sa `max-height` i skrolom, dugme u `.modal-dno` (sticky) za SVE prozore (#74) |
| „Sačuvaj prijem ne radi“ — na telefonu | dugme sivo bez objašnjenja (fali kvačica na dnu, rok, temperatura…), a greška servera ispisana na VRHU prozora, dok je magacioner dole | dugme uvijek aktivno, „Za čuvanje još fali: …“ uz dugme, skrol do polja (#74) |
| ista fotografija: jednom tačno, a 5 % manja ili malo tamnija — ništa | Tesseract podijeli tabelu u više blokova; redovi su se slagali po blokovima, pa je „LOT Rok“ ispalo iznad „Proizvod JM Kol“ | redovi po položaju riječi uz ispravku nagiba; čitanje u više prolaza (#75) — 144/144 umjesto ~12/99 |
| na Renderu fotografija „samo se učitava“ | čitanje u više prolaza na 3200 px traje na slabom serveru minutama; zahtjev je čekao do kraja, bez roka, napretka i izlaza | čitanje u pozadini + stanje + „Ne čekaj — upiši ručno“, slika 2200 px, rok 75 s, OCR se pali unaprijed (#76) |
| na manjoj slici iznos pročitan kao lot, a količina prazna | OCR spojio dvije labele zaglavlja u jednu ćeliju („Cijena Rabat %“), pa su dvije kolone nestale | ćelija zaglavlja koja nije jedna labela razlaže se na riječi (`redoslijedKolona`) — ali samo kratka (≤ 4 riječi) i sa većinom labela, inače rečenica iz napomene („roba …, lot i rok provjereni, količina …“) postane „zaglavlje“ |
| „pojačaj kontrast“ je pogoršalo čitanje (0/9) | globalno razvlačenje (`normalise`) pojača sjenku; Otsu prag isto | lokalni kontrast (CLAHE) i samo Sauvola prag — izmjereno, ne pretpostavljeno |
| iznos sa kraja reda pročitan kao količina; redni broj kao šifra | zaglavlje nije poznavalo kolone „Cijena“, „Rabat“, „Iznos“, a „R.br.“ je bio šifra | kolona „ostalo“ zadržava položaj (#75); probni `sa_cijenama.pdf` |
| repozitorijum na GitHubu bio javan od 20.09. — sa cijelim kodom, CLAUDE.md i lozinkama demo naloga u kodu | napravljen kao javni; niko nije provjerio | vlasnica ga je 29.09. prebacila u privatni; demo lozinke u testovima iz `.env` (`DEMO_LOZINKA_*`), na živom demou promijeniti `npm run demo-lozinke`; istorija pregledana — pravih tajni nije bilo |
| prijava „zamrzne“ cio server na ~100 ms za svakoga | `crypto.scryptSync` u ruti — sinhrono, blokira petlju događaja | asinhroni `crypto.scrypt`, parametri u hešu, stari heš se pojača pri prijavi (#84) |
| pogrešan kod 2FA nije se brojao, a audit ga nije pamtio | greška bačena UNUTAR `transakcija()` poslije upisa — rollback je poništio i brojanje i audit | transakcija vraća ishod, greška se baca POSLIJE nje |
| typecheck pada posle nadogradnje `sharp` 0.35 / `pdfjs` 6 | `typeof import("sharp")` je sada modul, ne funkcija; `pdfjs` 6 nema opciju `isEvalSupported` | `(typeof import("sharp"))["default"]`; opcija uklonjena (zaštita je sada u samoj biblioteci) |
| lokalni PostgreSQL odbija vezu (`ECONNRESET`), u logu `0xC0000142` | klaster ugašen naglo (zajedno sa pregledačem) pa oporavak; `pg_ctl start` iz basha visi | klaster pokretati iz Node-a (`spawnSync`, `stdio: "ignore"`), ne istovremeno `npm test` i `demo:lokalno`; posle naglog gašenja jednom uredno ugasiti pa ponovo |
| ekran se provjerava u pregledaču, a lozinke se ne kucaju u pregledač (odluka vlasnice) | — | prijava na lokalni server iz Node-a (`fetch /api/auth/prijava`), pregledaču se da samo kolačić sesije |
| paket za pregledač 970 KB | Vite čita i SERVEROV `.env` — `NODE_ENV=development` iz njega pravi razvojnu gradnju i pri `vite build` | `envFile: false` u `vite.config.ts` (pregledaču ništa iz `.env` ne treba); sada ~257 KB + strane po potrebi |
| posle „popravke“ paketa aplikacija na telefonu bijela: `jsxDEV is not a function` | samo `define` za `process.env.NODE_ENV` — React produkcijski, a JSX i dalje preveden za razvoj | `envFile: false` (gore); našao ga je PRVI prolaz testa ekrana — typecheck, build i API testovi su prošli |
| ponovljen upis vraća „drugačiji“ odgovor | sačuvan odgovor je `jsonb` — Postgres preslaže ključeve | isti sadržaj, drugi redoslijed; test poredi sadržaj (`isto()`), ne tekst |
| test pada: `Cannot convert argument to a ByteString` | `fetch` ne prima zaglavlje sa č/ć/š | vrijednosti zaglavlja samo ASCII (i u testu „pogrešnog“ vremena) |
| testovi ekrana vise bez greške | scenario je uvozio pomoćne funkcije iz `pokreni.mjs`, a `pokreni.mjs` uvozi scenario uz top-level await — ciklus čeka sam sebe | pomoćne funkcije u zaseban modul (`testovi/ekrani/telefon.mjs`) |
| kasna D1 (stigla sa telefona posle nove) vraća vozilo u staro stanje | status vozila se postavljao po POSLJEDNJOJ UPISANOJ, ne najnovijoj kontroli | status mijenja samo kontrola bez novije `izvrseno_at` (#85) |
| posle slanja iz reda „Potvrdi“ na trenutak ponovo iskoči | stavka reda obrisana prije nego što se lista osvježila | „Predaja poslata“ 20 s ili do osvježavanja (`upravoPoslato`), lista se osvježava posle SVAKOG poslatog upisa |
| vozaču stoji crveno „kontrola nije urađena“ i posle kontrole | plan je tražio D1 za SVAKO vozilo svakog radnog dana, a Moja strana je bez današnje isporuke pokazivala sva vozila | D1 samo za dan vožnje, vozaču samo vozila sa njegovih isporuka (#86) |
| odgovorno lice odlučuje „Prihvati / Hold“, a ne vidi izmjerenu temperaturu | detalj prijema nije vraćao mjerenje KKT 1 | stavka nosi izmjereno, granicu (iz pravila), ocjenu i termometar; forma prijema i za robu bez režima kaže zašto nema temperature |
| neusaglašenost „teško se zatvara“ kad je proba sama | izuzetak „bez četiri oka“ se nudio tek POSLIJE greške, a „fali ponovna kontrola“ bez puta do nje | `stanjeProvjere` u detalju: šta fali + dugme do mjesta gdje se radi, izuzetak odmah; mjera se može upisati kao već urađena (jedan korak) |
| „gdje se upisuje plan obuke / pitanja?“ | sve je bilo na Ljudi → kartice, bez putokaza | objašnjenje na kartici, ulaz sa HACCP plana (`state: { tab, pod }`), plan za sve koji rukuju hranom odjednom, korišćeno pitanje se mijenja kao nova verzija |
| „kod vozača nova isporuka se čuva, kod magacionera ne“ (02.10.2026) | magacioneru je matični magacin bio bez robe („Magacin Bar“ na demo bazi); forma je nudila samo njega — lot „nema robe“ i SIVO „Sačuvaj“ bez riječi. Vozač nema matični magacin, pa je dobijao Glavni | forma bira magacin u kom ima slobodne robe, uz magacin piše „nema slobodne robe — roba je u: …“ (klik prebacuje); „Sačuvaj“ nikad sivo — kaže šta fali (#74). Test ekrana `5_isporuka_nc` |
| „neusaglašenost neće da se zatvori“ (02.10.2026) | posle dorade 01.10. dugme „Provjereno — zatvori“ je bilo SIVO dok se ne označi kvačica izuzetka — kršenje #74 koje je dorada sama uvela; greška je stajala na VRHU prozora, a ispod mjere je i dalje stajala forma „Nova korektivna mjera“ | dugme uvijek aktivno, klik kaže šta fali; greška uz dugmad (skrol do nje); dok mjera čeka provjeru — nema forme za novu mjeru; tekst na vrhu kaže tačno šta da se uradi |
| „kad hoću da neusaglašenost zatvorim, nešto se nesretno završava“ (03.10.2026, NC iz povlačenja) | zatvaranje je bilo četiri radnje: mjera (opis, kome, rok) → „Urađeno“ → napomena + kvačica → „Provjereno — zatvori“; za povlačenje nije ni pisalo da prvo treba završiti povlačenje | „Riješeno je — upiši“ kao prvi izbor: jedan upis, server sam odluči — zatvori, čeka drugog ili čeka ponovnu kontrolu/kraj povlačenja — i kaže koje (#89) |
| besplatna Supabase baza bi se napunila za nekoliko mjeseci, a da niko ne zna (04.10.2026) | bekap iz aplikacije (i sedmični automatski) čuvao je PUNU kopiju podataka u istoj bazi 90 dana — ~13 kopija; od gubitka baze ne štiti, a na 500 MB baza prelazi u „samo čitanje“ | bekap se preuzima direktno, u bazi samo trag (dopuna 35, #68); veličina baze u `dnevni-pregled` sa upozorenjem na 400 MB |
| na bazi PRAVOG klijenta ne bi bilo ocjene temperature ni na prijemu ni na predaji — bez ijedne greške (11.10.2026) | kontrolne tačke KKT 1–3 je pravio samo demo (`13_demo_cg`); kod ih traži po šifri i bez njih ćuti. Testovi rade na demo bazi, pa nisu mogli vidjeti | `prvi-korisnik` ih pravi uz firmu, dopuna 36 postojećim bazama (#91); test `alati` radi na PRAZNOJ bazi. Pouka: šta god kod traži po šifri ili nazivu mora nastati van demo podataka |
| na novoj instanci klijenta niko nije mogao otvoriti nalog direktoru ni upisati PIB firme | `prvi-korisnik` je pravio samo `bzr`, a `bzr` otvara samo magacionere i vozače (#13); Podešavanje je samo konsultantovo | `prvi-korisnik --konsultant …`; alat i odbija bazu koja već ima `bzr`/`izvodjac` (da se ne upiše u demo iz `.env`) |
| `could not determine data type of parameter $1` — izvještaj pao cijeli (11.10.2026) | upit je dobio dva parametra, a koristio samo `$2` — Postgres ne zna tip parametra koji se nigdje ne pojavljuje | upitu dati samo parametre koje koristi; našao ga je prvi prolaz testa `stanje` |
| mejl izvještaja na telefonu viri 28 px u stranu (11.10.2026) | tri kartice u redu, a „Neusaglašenosti“ (12 px) šira od trećine ekrana od 375 px | `<style>` sa `@media (max-width: 480px)` — kartice jedna ispod druge; tekst umjesto broja („u redu“) manjim slovom. Našao ga je test ekrana (širina dokumenta u okviru) |
| Python izmjena kroz bash heredoc „prošla“, a fajl nepromijenjen (assert na „⚠“) | konzola čita heredoc u cp1252 — znakovi van nje (⚠ ✓) se pokvare, pa se tekst ne poklopi | izmjene sa takvim znakovima: `.py` fajl napisan alatom (UTF-8), ne heredoc |
| „Rok trajanja je istekao (2026-10-02)“ — Ana nije znala šta sad (03.10.2026) | pravilo je ispravno (#38), ali poruka je imala datum kao `2026-10-02`, nije rekla da se pogrešno ukucan rok ispravlja, „Prihvati“ se nudio iako ne može, a greška je stajala na vrhu strane | datum „02.10.2026.“, uputstvo „Izmijeni“ → prihvati; za isteklu robu umjesto Prihvati/Hold/Pusti stoji „Odbij — istekao rok“ sa predloženim razlogom; skrol do greške |
| jedan test sa sintaksnom greškom oborio je CIO prolaz (izlazni kod 9, bez sažetka) | `await import(...)` scenarija stajao je van `try` u pokretaču | uvoz u `try` — pokvaren fajl je pao test, ostali se izvrše (`testovi/pokreni.mjs`, `testovi/ekrani/pokreni.mjs`) |
| `npm run typecheck` prolazi, a u stranici fali uvoz | korijenski `tsconfig.json` ima `"files": []` sa referencom — `tsc --noEmit` bez `-b` NE provjerava frontend (hvatao ga je samo `tsc -b` u `npm run build`) | `typecheck` = `tsc --noEmit -p tsconfig.app.json && … -p tsconfig.server.json` |
| Prilozi na telefonu vire 26 px van ekrana | 40 px unutrašnje margine + dva potpisa u redu bez prelamanja, tabele bez skrola | `.prilog-list` (manja margina na telefonu), potpisi se prelamaju, tabele u `.data-table-wrap` — našao test ekrana |
| temperatura na KKT 3 ocijenjena po drugoj granici nego na KKT 1 | KKT 3 je padao na `artikal.temp_*` kad pravila nema, KKT 1 nije | jedan izvor — pravilo (invarijanta #39); dopuna 24 napravila pravila iz postojećih granica |

### Gdje se zapravo testira

**Vlasnica radi na ŽIVOJ aplikaciji na Renderu.** Izmjena na računaru ne mijenja ništa dok ne ode
`git push` pa Render → Manual Deploy. Migracije (`npm run migriraj`) idu na istu Supabase bazu
i djeluju odmah — kod ne. Od talasa 5 server u produkciji **sam primijeni dopune pri pokretanju** (#79) —
`npm run migriraj` prije deploya je i dalje dobar običaj, ali zaboravljena dopuna više ne ruši funkcije, a ako
dopuna padne, novo izdanje ne kreće i Render ostavlja staro. Da li je deploy prošao: izdanje u dnu menija = `git log -1 --format=%h`.

### Okruženje

- **Supabase: Session pooler, port 5432.** Direct connection radi samo preko IPv6, Render ga ne dohvata.
- **Render besplatni plan spava poslije 15 min** — za demo i pravi rad plaćeni plan. Provjereno 04.10.2026 (render.com/docs/free):
  750 besplatnih sati mjesečno važi za CIJELI nalog (workspace) — jedan budan servis ih troši sam; kad se potroše, Render gasi
  SVE besplatne servise do 1. u mjesecu. 512 MB, 0,1 procesora (OCR presporo). Starter $7/mj po servisu: ne spava, 0,5 procesora.
- **Supabase besplatno** (supabase.com/pricing, 04.10.2026): najviše 2 aktivna projekta (demo + jedan klijent), 500 MB po bazi —
  preko toga „samo čitanje“ (aplikacija ne prima upise), pauza posle 7 dana bez rada, bez sopstvenih bekapa. Pro $25/mj
  (prvi projekat) + $10/mj svaki sljedeći, 8 GB po projektu. Izmjereno: prazna baza sa šemom ~11 MB, red 100–230 B (sa
  indeksima ~0,5 KB); najviše troše fotografije otpremnica (u bazi, `prijem_dokument`). `dnevni-pregled` javlja veličinu.
- **`x-render-routing: suspend-by-user`** u odgovoru = servis je SUSPENDOVAN u Render panelu (ručno,
  ili zbog naplate/iskorišćenih besplatnih sati) — to nije spavanje. UptimeRobot ga ne budi; kod ne
  pomaže. Render → servis → „Resume Service“ (ako traži — dodati karticu ili preći na plaćeni plan).
  UptimeRobot neka gađa `/api/zdravlje` (javlja i bazu, 503 kad ne odgovara; radi i sa HEAD, kojim
  besplatni UptimeRobot pita). Na besplatnom planu
  ping svakih 5 min drži servis budnim 24/7 i troši ~750 besplatnih sati mjesečno.
- Server ne učitava izmjene sam (`tsx` bez watch): poslije izmjene u `server/` — restart.
- **Env na Renderu (talas 5):** `OBAVEZNA_2FA=izvodjac` (ili `izvodjac,bzr`) za svakog klijenta čim konsultant na toj
  instanci uključi svoju 2FA; `MIGRACIJE_PRI_STARTU` ne treba (u produkciji je podrazumijevano uključeno).
- **Mejl „Stanje poslovanja“ (#93):** `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_KORISNIK`, `SMTP_LOZINKA`, `SMTP_POSILJALAC`
  (npr. `Ime Prezime <adresa@gmail.com>`) na SVAKOM Render servisu klijenta. Gmail: `smtp.gmail.com`, 465, lozinka je
  „lozinka za aplikacije“ (traži uključenu potvrdu u dva koraka na Google nalogu), ne obična. **Besplatni Render blokira
  odlazne SMTP portove 25, 465 i 587** (od 26.09.2025, render.com/changelog) — slanje radi samo na plaćenom planu; na
  besplatnom: „Sačuvaj PDF“ i poslati kao prilog. Lozinka za aplikacije ide samo u Render env, nikad u git ni `.env` u repou.
- **Node ≥ 22.13** (`engines` u `package.json`) — zbog `pdfjs-dist`.
- **Push:** VAPID ključ server pravi sam i čuva u bazi (`web_push_kljuc`) — na Renderu ne treba ništa
  podešavati; `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` samo ako se želi ručno. Push radi
  samo preko HTTPS-a (Render da) i na `localhost`. iPhone: samo aplikacija dodata na početni ekran, iOS ≥ 16.4.
  Promjena ključa poništava sve pretplate (ljudi moraju ponovo uključiti).
- **`npm test`** traži PostgreSQL na računaru (`C:/Program Files/PostgreSQL/<verzija>/bin`, ili
  `PG_BIN=`) — pravi svoj klaster u `.testbaza/` (u `.gitignore`), pokreće ga samo dok traju testovi.
- OCR: jedan Tesseract radnik za cijeli server, poslovi idu jedan za drugim, gasi se posle 5 min bez
  posla (oko 150 MB dok radi). Jezik `srp_latn` je u `node_modules` (`@tesseract.js-data/srp_latn`) —
  ništa se ne preuzima sa interneta. Priprema slike (okretanje, CLAHE, izoštravanje) — `sharp`
  (zavisnost od 27.09.2026; Render instalira gotov paket za Linux). Dobra slika 3–5 s na računaru,
  teška (okrenuta, tamna) do ~20 s; na Renderu 2–3 puta sporije — ekran kaže „do jednog minuta“.

---

## Provjera prije isporuke

```bash
npm run typecheck
npm run build
npm test             # sopstvena čista baza + sopstveni server; izlazni kod 1 ako išta padne
npm run test:ekrani  # telefon 375 px, pet uloga, rad bez mreže — izgrađena aplikacija kao na Renderu
```

Pa ručno na telefonu (375 px): `/moja` za vozača i magacionera (i „Danas po planu" → „Upiši"),
potvrda isporuke sa temperaturom, „Prijavi problem". Povrat: potvrda sa manje predatim → `/zalihe`
„Iz karantina: pusti / otpiši" kod odgovornog lica. Vozilo: D1 sa temperaturom van granice → „Nije spremno“,
pa nova D1 → „Spremno danas“. HACCP: obrazac sa odgovorom koji je odstupanje, pa „Ispravi“.

---

## Otvoreno

Tehnički nalozi i plan su u „Nalazi" i „Plan izmjena po fazama" iznad. Od ranijih stavki i dalje
važi: da li Uredba 91/2026 ima zaseban Dio 12 „Osposobljavanje" i u kom su Prilogu Dio 4 i Dio 13
(vidi pravni okvir). **Prodajna prezentacija i ponuda** (`prezentacija/`, van gita): `node napravi_prezentaciju.cjs` (18 slajdova,
.pptx) i `node napravi_ponudu.cjs` (jedna A4 strana → `PILOT_ponuda_paketi.pdf`, preko Chrome-a/Edge-a bez
prozora). Paketi, uslovi i kontakt su na JEDNOM mjestu — `prezentacija/podaci.cjs`. Biblioteke (pptxgenjs,
react-icons, sharp) su u `prezentacija/node_modules` (`npm install` u tom folderu), ne u projektu. Na ovom
računaru nema PowerPointa ni LibreOffice-a — slajdovi se ne mogu pretvoriti u slike, pa se tekst provjerava
mjerenjem stvarnim Calibri fontom (Chrome bez prozora); ponuda se gleda kao snimak strane. Pri promjeni
propisa, cijena ili funkcija aplikacije ažurirati oba. **Kontakt još nije upisan** — ponuda ima crveno
„[upisati kontakt]“ i takva se ne šalje.

**Otpremnice — OCR je provjeren samo na izmišljenim i simuliranim fotografijama** (16 varijanti jedne
probne fotografije + otpremnica sa cijenama; #75). Prve prave otpremnice pilot klijenta (više
dobavljača, pravi telefon, loše svjetlo, drugačiji raspored kolona) će pokazati šta još ne valja —
tada NJIH dodati u `testovi/otpremnice/` (izmijenjenih podataka) i mjeriti. Rukopis se ne čita.
Skeniran PDF (samo slika, bez teksta) se čuva uz prijem, stavke se upisuju ručno.

**Dorada 01.10.2026 (osam stavki iz probe vlasnice) u ekranu nije proklikana ručno** — server je pokriven testom `dorada`,
ekrani prolaze `npm run test:ekrani` (sve strane svih uloga na 375 px). Na Renderu pogledati: Izvještaji (traka perioda +
spiskovi), Audit (filteri), Prijem → otvori prijem (kolona Temperatura), Neusaglašenost iz mjerenja (žuta traka „fali“ +
dugme), Poruke (Sve / Primljene / Poslate), vozač bez današnje isporuke (nema crvenog), Ljudi → Godišnji plan obuke.

**Rad bez interneta nije viđen na pravom telefonu** (talas 6, #85). Test ekrana ga prolazi u Chromeu sa isključenom
mrežom (`context.setOffline`), a keš aplikacije je provjeren fajl po fajl — ali pravi Android u podrumu i iPhone nisu
probani. Poznato: (1) šalje se dok je aplikacija otvorena ili čim se ponovo otvori — ne u pozadini (Background Sync
namjerno nije uveden: iPhone ga nema); (2) iPhone briše podatke sajta koji se 7 dana ne otvori, OSIM aplikacije dodate
na početni ekran — vozaču i magacioneru zato uvijek „Dodaj na početni ekran“ (isto traži i push); (3) vozač jednom
otvori stranu Isporuka dok ima signala, da se stavke isporuka sačuvaju. Prva proba na Renderu: telefon u režimu
aviona → D1 → predaja → isključiti režim aviona → oba upisa u listama sa oznakom.

**Push obavještenja nisu viđena na pravom telefonu.** Test dokazuje da server šalje ispravno
potpisano i šifrovano; da li Android/iPhone stvarno prikažu — prvo probati „Pošalji probno" na
Renderu (HTTPS), na Androidu i na iPhoneu sa početnog ekrana.

**GitHub Actions: prvo pokretanje tek poslije sljedećeg pusha** — pogledati da je zeleno (GitHub →
Actions). Ako je repozitorijum privatan, troši besplatne minute (oko 5 min po pushu).

**HACCP plan je polazni prijedlog.** „Predloži osnovni plan" i „Predloži tekst" daju razuman
početak za distributera, ali ga konsultant za svakog klijenta prilagođava stvarnim komorama,
vozilima i ritmu rada — prazno polje se u štampi vidi kao crveno „— upisati —". Faza 3 nije
prošla ručni klik kroz pregledač (samo build, typecheck i E2E kroz API) — prvo korišćenje na
Renderu je i prva vizuelna provjera.

**R-12 — Supabase Data API: gasi se u panelu ZA SVAKI PROJEKAT.** Security Advisor (27.09.2026) je na demo
projektu pokazao sve tabele bez RLS-a, izložene Data API-ju. U bazi je to zatvoreno dopunom 32 (#78), a u
panelu: Project Settings → Data API → isključiti „Enable Data API“ (ili izbaciti `public` iz „Exposed
schemas“). Za svaki nov projekat klijenta: odmah pri otvaranju, prije prvog podatka; pa Advisors → Security
Advisor → Rerun — ostaje samo INFO „RLS Enabled No Policy“, to je namjerno (niko osim aplikacije). Ako je
javni `anon` ključ projekta ikad bio negdje zalijepljen — promijeniti ga (Project Settings → API Keys).

**Roba pod režimom ide samo rashladnim vozilom (#55).** Ako klijent ima i preuzimanje u magacinu (kupac
dolazi sam), takva isporuka se sada ne može upisati bez vozila — tada treba dodati „preuzima kupac“ (sa
temperaturom pri predaji), ne ukidati pravilo. Odluka vlasnice kad se pojavi.

**Ekrani se sada mogu proklikati lokalno** (`npm run demo:lokalno`, talas 5): u talasu 5 provjereni traka i panel 2FA,
traka „nema interneta“ i pad strane (greška uhvaćena i upisana). Drugi korak prijave i QR korak nisu viđeni u pregledaču —
lozinka se ne kuca u pregledač; pokriveni su kroz API (`talas5`).

**Talas 3 u ekranima nije proklikan.** Rezervacija, otkaz, otpremnica za štampu, jedna temperatura po grupi i
nova polja u Šifarnicima su provjereni kroz API (test `talas3`), typecheck i build — štampu otpremnice (A4,
potpisi) treba jednom odštampati i pogledati na papiru.

**Na demo bazi je isključen (ne obrisan) termometar „E2E ubodni termometar (T-99)“** — ostatak testa od
24.09. Može se obrisati kad vlasnica želi; isključen ne smeta ni prikazu ni testovima.

**Bekap se ne pokreće sam** dok vlasnica jednom ne pokrene `npm run zakazi-bekap` (Task Scheduler, svaki dan
u 13:00; ako je računar ugašen — čim se upali). Raspored je njena odluka, alat je spreman.

**Demo lozinke su bile javne** (repozitorijum javan 20.–29.09.2026). Na živoj demo bazi pokrenuti `npm run demo-lozinke`
— nove lozinke idu u `.env` i ispišu se jednom. Dok se ne pokrene, svako ko je vidio kod može ući u demo.

**„Stanje poslovanja“ nije viđeno u pravom programu pošte** (#93). Test šalje na lažni SMTP server i provjerava sadržaj, a
izgled je gledan u pregledaču (375 px i računar). Prvo poslati sebi: Gmail na telefonu i na računaru, i Outlook ako ga
direktor koristi (Outlook na računaru ne zna `@media` — tri kolone ostaju, to je u redu). Na besplatnom Renderu slanje ne radi.

**Potvrda u dva koraka** — konsultant je uključuje na svakoj instanci klijenta (Moja strana), pa na Renderu postavi
`OBAVEZNA_2FA=izvodjac` (i `bzr` kad odgovorno lice pristane). `dnevni-pregled` javlja ko je još bez nje.

### Van koda

- Ugovor nije pregledao crnogorski pravnik (naročito čl. 6, 7 i 9)
- Nije riješeno fakturisanje prema Crnoj Gori
- Nema nijedne reference — prva tri klijenta su „osnivački“ (uspostavljanje −50 %, mjesečno puna cijena
  zaključana na 24 mjeseca, zauzvrat preporuka i studija slučaja) — `dokumenti/strategija_prodaje.md`
- Banka pitanja nije validirana ni na jednoj grupi; prvih ~30 ispitanika su pilot,
  ne mjerenje. **Ne slati klijentu analizu pitanja kao nalaz.**

---

## Šta NE ide u ovaj repozitorijum

`prezentacija/` i `dokumenti/` su isključeni u `.gitignore` (dodato tek 26.09.2026 — ranije je ovdje
pisalo da jesu, a nisu bili) i drže se u **zasebnom
privatnom repozitorijumu**. Razlog: prezentacija sadrži prodajni scenario i interne
slijepe tačke vlasnice, a `dokumenti/` cjenovnik i nacrt ugovora. Taj repozitorijum se
objavljuje na Render i jednog dana može dobiti saradnika — to tamo ne smije biti.

`.env` nikad ne ide u git. Ni u jedan repozitorijum.
