# Upitnik za početak (za novog distributera)

Distributer prije uvođenja aplikacije PILOT popuni svoje podatke:
1. firma;
2. ritam rada;
3. magacini i komore;
4. vozila;
5. zaposleni sa sanitarnim knjižicama;
6. dobavljači;
7. kupci;
8. artikli sa režimom i granicom;
9. termometri.

Važe ista pravila kao u aplikaciji (telefon kupca obavezan, PIB ciframa, granica za robu pod režimom…).

| Fajl | Šta je |
|---|---|
| `Upitnik-za-pocetak.html` | **Ovo se šalje distributeru.** Otvara se dvoklikom u pregledaču (Chrome, Edge, Firefox), na računaru ili telefonu; ne treba nalog ni instalacija. |
| `upitnik.html` | Izvor (ovdje se mijenja). Isti fajl je objavljen i kao stranica na claude.ai. |
| `napravi.mjs` | Posle izmjene izvora: `node upitnik-start/napravi.mjs` napravi novi `Upitnik-za-pocetak.html`. |

**Kako ide:** distributer popunjava sa pauzama — upisano se pamti u njegovom pregledaču, na tom uređaju. Na kraju
„Pregled i slanje“ → **Sačuvaj fajl za konsultanta** napravi `pilot-start-<firma>-<datum>.json`, koji vam pošalje
e-poštom ili porukom. Vi ga otvorite u istom upitniku („Otvori sačuvan fajl“), pregledate i odštampate pregled.
Kad se ne može sačuvati fajl (npr. stranica otvorena kao link na claude.ai), „Kopiraj podatke“ kopira isto u
poruku, a vi tekst sačuvate kao `.json` fajl i otvorite ga.

**Lični podaci:** ništa ne ide na internet dok distributer sam ne pošalje fajl. U fajlu su imena zaposlenih i
brojevi sanitarnih knjižica (samo broj i rok, nikad nalaz) — čuvajte ga kao i ostale podatke klijenta. Popunjeni
fajlovi (`upitnik-start/*.json`) su u `.gitignore`.

**Uvoz u aplikaciju:** posle `npm run prvi-korisnik`, sa adresom NOVE baze klijenta:

```powershell
$env:DATABASE_URL="<adresa NOVE baze>"; npm run uvoz-start -- --fajl pilot-start-<firma>-<datum>.json
```

Prvo samo pokaže šta bi upisao (ništa ne upiše); ako je u redu, ista komanda sa `--upisi`. Ono što već
postoji preskače, pa se smije ponoviti. Naloge, komore, kalibracije i ritam rada ne upisuje — ispiše ih, da ih
konsultant unese u aplikaciji (Ljudi, HACCP plan). Granice artikala ostaju **nepotvrđene** dok ih odgovorno lice ne
potvrdi u Šifarnicima.
