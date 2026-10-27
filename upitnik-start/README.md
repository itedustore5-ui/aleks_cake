# Upitnik za početak (za novi atelje)

Vlasnica ateljea prije uvođenja aplikacije PILOT popuni svoje podatke (27.10.2026 — ranije je ovo bio
distributerski upitnik sa magacinima, vozilima i direktorom; takav fajl uvoz više ne prima):
1. atelje i vlasnica (odgovorno lice);
2. ritam rada (radni dani, porudžbine, dostava);
3. frižideri, vitrina i zamrzivač — svaki sa svojom granicom;
4. zaposleni sa sanitarnim knjižicama i nalogom (Vlasnica / Zaposleni);
5. dobavljači;
6. sastojci sa režimom, granicom, alergenima i oznakom „serija obavezna“ (jaja);
7. stalni kupci (kafići, hoteli, sale — nije obavezno);
8. termometri.

Važe ista pravila kao u aplikaciji (telefon kupca obavezan, PIB ciframa, granica za robu pod režimom, alergeni sa
spiska 14 iz Priloga II Uredbe EU 1169/2011 — upisuju se nazivom: „jaja, mlijeko“ ili „nema“).

| Fajl | Šta je |
|---|---|
| `Upitnik-za-pocetak.html` | **Ovo se šalje vlasnici.** Otvara se dvoklikom u pregledaču (Chrome, Edge, Firefox), na računaru ili telefonu; ne treba nalog ni instalacija. |
| `upitnik.html` | Izvor (ovdje se mijenja). Isti fajl se može objaviti i kao stranica na claude.ai. |
| `napravi.mjs` | Posle izmjene izvora: `node upitnik-start/napravi.mjs` napravi novi `Upitnik-za-pocetak.html`. |

**Kako ide:** vlasnica popunjava sa pauzama — upisano se pamti u njenom pregledaču, na tom uređaju. Na kraju
„Pregled i slanje“ → **Sačuvaj fajl za konsultanta** napravi `pilot-start-<firma>-<datum>.json`, koji vam pošalje
e-poštom ili porukom. Vi ga otvorite u istom upitniku („Otvori sačuvan fajl“), pregledate i odštampate pregled.
Kad se ne može sačuvati fajl (npr. stranica otvorena kao link na claude.ai), „Kopiraj podatke“ kopira isto u
poruku, a vi tekst sačuvate kao `.json` fajl i otvorite ga.

**Lični podaci:** ništa ne ide na internet dok vlasnica sama ne pošalje fajl. U fajlu su imena zaposlenih i
brojevi sanitarnih knjižica (samo broj i rok, nikad nalaz) — čuvajte ga kao i ostale podatke klijenta. Popunjeni
fajlovi (`upitnik-start/*.json`) su u `.gitignore`.

**Uvoz u aplikaciju:** posle `npm run prvi-korisnik`, sa adresom NOVE baze klijenta:

```powershell
$env:DATABASE_URL="<adresa NOVE baze>"; npm run uvoz-start -- --fajl pilot-start-<firma>-<datum>.json
```

Prvo samo pokaže šta bi upisao (ništa ne upiše); ako je u redu, ista komanda sa `--upisi`. Ono što već
postoji preskače, pa se smije ponoviti. Upisuje: podatke firme (samo prazna polja), uređaje kao kontrolne tačke sa
granicom i dnevnim mjerenjem u planu, zaposlene, dobavljače, stalne kupce, sastojke (sa alergenima i „serija
obavezna“) i termometre. Naloge i kalibracije ne upisuje — ispiše ih, da ih konsultant unese u aplikaciji (Ljudi,
HACCP plan). Granice sastojaka ostaju **nepotvrđene** dok ih vlasnica ne potvrdi u Šifarnicima.
