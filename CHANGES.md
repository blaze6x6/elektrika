# Spremembe 2026.10.1 (varnostni pregled in popravki)

## ⚠️ Pred nadgradnjo obstoječe namestitve

1. **Nastavi pravi `JWT_SECRET` (≥ 32 znakov) in `CRON_SECRET` (≥ 16) ter `DB_PASSWORD` v `.env`.**
   Stare privzete vrednosti (`spremeni_me_v_produkciji_abc123`, `energy_cron_secret_123`, `energy_pass_123`, …) so javno znane;
   z njimi se kontejner `web` ne zažene več (napaka je izpisana v `docker compose logs web`).
   Spremeni geslo baze tudi v samem PostgreSQL (`ALTER USER … PASSWORD …`), ker se podatkovna mapa ne ponovno inicializira.
2. **Naredi varnostno kopijo** (`./backup.sh`) pred prvim zagonom nove različice.
3. **Vsi se morajo enkrat znova prijaviti** (format seje se je spremenil).
4. Uporabnik `admin` s staro geslom `admin` mora ob prvi prijavi nastaviti novo geslo.
5. Če si SMTP strežnik uporabljal s samopodpisanim potrdilom, vklopi "Dovoli samopodpisano TLS potrdilo" (E-mail nastavitve).
6. SMTP geslo ponovno vnesi, če spremeniš `JWT_SECRET`/`SETTINGS_KEY` (shranjeno je šifrirano).
7. Cron kontejner ima nov entrypoint: **ponovno zgradi / potegni obe sliki** (`docker compose pull` ali `up -d --build`).
8. Poženi `npm install` in commitaj nastali `package-lock.json` (Docker/CI ga uporabljata za ponovljive gradnje).
9. Node 22 (prej 20, ki je brez podpore), Alpine 3.22 za cron. PostgreSQL ostane 15.

## Varnost

| Področje | Popravek |
|---|---|
| Privzete skrivnosti | `JWT_SECRET`/`CRON_SECRET`/`DB_PASSWORD` so obvezni; znane privzete in vzorčne vrednosti so zavrnjene (app, init skripta, compose `:?`) |
| Vloge | `isAdmin` se zdaj preverja povsod (`requireAdmin`); vsaka API pot ima lasten guard, ne zanaša se samo na `proxy.ts` |
| Uporabniki | zadnjega skrbnika in samega sebe ni mogoče izbrisati/degradirati; politika gesel (≥ 10 znakov); bcrypt cost 12; imena niso občutljiva na velikost črk |
| Seje | `token_version` – zamenjava gesla/skrbniška ponastavitev razveljavi seje; prisilna menjava začetnega gesla; `__Host-` piškotek prek HTTPS; samodejna zaznava HTTPS |
| Prijava | omejevalnik poskusov (uporabnik + IP), enak čas odziva za neobstoječe uporabnike, beleženje prijav in neuspelih prijav |
| CSRF | preverjanje `Origin` za POST/PUT/PATCH/DELETE (poleg SameSite=Lax) |
| Začetni račun | brez `admin/admin`: `ADMIN_PASSWORD` ali naključno geslo v logu, obvezna zamenjava |
| Baza | port `5432` samo na `127.0.0.1`; skrivnosti obvezne |
| SMTP geslo | šifrirano v bazi, ne vrača se odjemalcu; `/api/settings` samo za skrbnika, samo znani ključi |
| SSRF | SMTP gostitelj/vrata preverjeni, blokirani loopback/link-local/metadata |
| TLS | preverjanje SMTP potrdila privzeto vklopljeno |
| XSS | vsa vsebina v HTML poročilih in e-pošti je escapana; PDF poročilo teče z nonce CSP; globalne varnostne glave (CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS) |
| Formule | `new Function` zamenjan z varnim razčlenjevalnikom (brez eval) |
| Cron | skrivnost samo v glavi, primerjava v konstantnem času, brez privzete vrednosti; `/api/solaredge/live` ni več dostopen s cron skrivnostjo |
| Vhodi | vsi parametri (`month`, `year`, `from`, `to`, `date`, `id`, …) so validirani; omejen obseg izvoza, velikost/št. vrstic uvoza |
| Zunanji klici | časovne omejitve na vseh `fetch`, `api_key` se ne beleži/vrača v odgovorih |

## Pravilnost podatkov

- **Sinhronizacija ne prepiše ročnih vnosov** (`isManual`); ročni vnos jih označi. Prepis: `force: true`.
- **Cron:** 1. in 2. v mesecu sinhronizira tudi prejšnji mesec (zadnji dan je prej ostal nepopoln, mesečno poročilo je šlo z manjkajočimi podatki);
  MojElektro se zdaj sinhronizira samodejno; opozorilo za »včeraj« deluje tudi 1. v mesecu; datumi po lokalnem času, ne UTC.
- **Formule:** pravilni rezultati za negativne vrednosti (`a-b` z negativnim `b` je vračal 0), za zelo majhne vrednosti (`1e-7`)
  in za formule, ki se sklicujejo na druge formule; deljenje z 0 → 0.
- **Uvoz CSV:** en upsert v transakciji (prej N×M poizvedb), prepozna izvozni zapis `Oznaka (kWh)`, pravilno bere `1.234,56`, javi neprepoznane stolpce.
- **Upsert** namesto "select potem insert" – ni več race conditionov.
- MojElektro: odčitki se seštevajo (ne prepisujejo), neveljavne dogovorjene moči ne prepišejo prave z 0.
- Izvoz CSV ima BOM (Excel pravilno prikaže č, š, ž) in zaščito pred formula-injection.
- Odjemalec: napake shranjevanja in sinhronizacije so vidne (prej tiho); admin povezava samo za skrbnike; vrstni red stolpcev ne ustvarja enakih vrednosti.
- API ob napaki vrača ustrezne HTTP kode (prej `200 success:true`), da jih cron zazna.

## Infrastruktura

- Node 22, večstopenjski Docker brez devDependencies, `HEALTHCHECK`, `npm ci` ob prisotnem lockfilu.
- SQL migracije (`db/migrations`) namesto podvojene sheme v entrypointu in `seed.ts` (odstranjen).
- Cron kontejner: urnik `SYNC_SCHEDULE`, izpis na stdout (`docker compose logs cron`), izhodna koda ob napaki.
- `backup.sh` zazna napako `pg_dump` (stara različica je javljala uspeh); novo `restore.sh`; kopije z pravicami 600.
- CI: lint, typecheck, test, audit pred objavo slik; oznaka različice iz izdaje; odstranjen `main.yml.bak`.
- Compose: omejitev dnevnikov, `no-new-privileges`, `cap_drop: ALL`, `depends_on` na zdravje.
- `.gitignore` (manjkal), `.dockerignore` razširjen; neuporabljene odvisnosti (`dotenv`, `clsx`, `tailwind-merge`) odstranjene; `@types/*` v devDependencies.
- Popravljeni manifest/ikone (`/favicon.png` ni obstajal), enotno ime aplikacije.

## Kaj ni bilo mogoče preveriti

Pri pripravi ni bilo dostopa do npm registra: **`npm install`, `next build`, `eslint` in `npm audit` niso bili zagnani**.
Preverjeno je bilo: 33 unit testov (pass), `tsc` nad celotno kodo z ohlapnimi stubi za zunanje module, SQL migracije in
seed skripta na pravem PostgreSQL 16 (sveža + nadgrajena baza, idempotentnost), `cron-sync.sh` proti lažnemu strežniku,
`backup.sh` z lažnim `docker`. Pred produkcijo zaženi `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
Odprte točke: preveri obnašanje MojElektro (`endTime`, granularnost odčitkov), privzete tarife in da `eslint` ne javlja starih opozoril
(korak lint v CI je zato `continue-on-error`, dokler ga ne očistiš).

## Barvne teme (dodatek)

- 12 tem: temne (Temna, Polnočna, Nord, Vijolična, Gozd, Žerjavica, AMOLED), svetle (Svetla, Papir, Meta, Nebo, Sivka) in možnost »Samodejno« (sledi sistemu).
- Izbirnik (ikona palete) je na nadzorni plošči, grafih, primerjavi, kalkulatorju, administraciji, prijavi in zamenjavi gesla. Izbira se shrani v brskalnik (localStorage), nastavi se pred izrisom strani (brez utripanja).
- Teme so CSS spremenljivke v `src/app/globals.css` (`html[data-theme="..."]`), seznam je v `src/lib/themes.ts`. Nova tema = nov blok v CSS + vrstica v seznamu.
- Grafi (Chart.js) privzamejo barve osi/legende glede na svetlo/temno temo.
- Stari razredi `light-theme` so odstranjeni; shranjeni vrednosti `dark`/`light` še vedno veljata.
- Nepreverjeno: vizualni videz v brskalniku (build ni mogoč brez npm). Prosim, preglejte vse teme po `npm run build`.
- Izbirnik tem je tudi na vseh podstraneh administracije (uporabniki, stolpci, e-pošta, dnevnik, MojElektro).

## Kalkulator (preverjen po metodologiji omrežnine)

- Nov `src/lib/blocks.ts`: uradna tabela blokov (Priloga 2 Akta o metodologiji za obračunavanje omrežnine), sezone, dela prosti dnevi (sobote, nedelje, prazniki, velikonočni ponedeljek) in poletni čas. Testi: `tests/blocks.test.ts`.
- Hipotetična poraba »brez sončne« razporeja samooskrbo po dnevih in urah (model jasnega neba) v prave bloke; prej fiksno 60/40 oz. 70/30, kar je bilo napačno (vikendi, prazniki, vmesni bloki 14–16 h).
- Cene/nastavitve z vrednostjo 0 se ne nadomestijo več s privzeto (`||` → `??`).
- Eko popust velja v obeh scenarijih.
- Izbira obračuna s sončno: letno netiranje (soglasje do 2023) ali po blokih (od 2024).
- Opozorilo, če podatki MojElektro niso skladni z urnikom blokov ali uvozom.

## Samooskrba po blokih iz SolarEdge (dejanske meritve)

- Sinhronizacija SolarEdge zdaj dodatno pokliče `energyDetails` (`timeUnit=HOUR`, `meters=SelfConsumption`), urne vrednosti razporedi v bloke (`hourlyWhToBlocks` v `src/lib/blocks.ts`) in shrani v skrite stolpce `se_samo_blok1..5` (dodani z `scripts/init-db.js`).
- Kalkulator za posamezen dan uporabi te meritve; če jih ni, ostane ocena po profilu sonca. Prikazano je število dni iz meritev in število dni z oceno.
- Za starejše mesece zaženite sinhronizacijo (Sync) za vsak mesec posebej.
- Potreben je merilnik porabe/izvoza na SolarEdge lokaciji (sicer virtualni merilnik SelfConsumption ni na voljo). Preverjeno samo z umetnimi podatki, ne proti pravemu API-ju.

## Natančnost kalkulatorja (kontrole podatkov)

- Hipotetični izračun šteje samo dni, za katere ima podatke MojElektro (prej: uvoz za nekaj dni + samooskrba za cel mesec). Ob razliki v pokritosti je opozorilo.
- SolarEdge sinhronizacija shranjuje tudi uvoz po blokih (`se_kup_blok1..5`, iz urnega merilnika Purchased). Kalkulator ga primerja z MojElektro po blokih in opozori pri razliki > 10 %: pokaže napačno preslikavo blokov ali zamik ur v časovnih žigih.
- Sinhronizacija MojElektro izpiše obdobje, za katero je API vrnil podatke.

## MojElektro: bloki iz 15-minutnih odčitkov (popravek)

- Diagnostika (`/reading-type`) je pokazala, da API **nima** odčitkov po blokih (kode `…11` do `…15` ne obstajajo), oddaja pa je bila brana iz 24-urnega **stanja** števca, ne iz 15-minutne količine. Zato je sinhronizacija vračala 1 dan in `me_uvoz` = 0.
- Zdaj se berejo 15-minutni A+ (`32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0`) in A- (`32.0.2.4.19.2.12.0.0.0.0.0.0.0.0.3.72.0`); uvoz se razporedi v bloke 1–5 po uradnem urniku (`aggregateMeIntervals`), oddaja se sešteje.
- Časovni žig odčitka obravnavamo kot konec intervala (`MOJELEKTRO_TS_MODE=end`); kontrola v kalkulatorju (SolarEdge Purchased po blokih) pokaže, če je prav `start`.
- Pri več veljavnih vnosih dogovorjene moči za isto obdobje velja najnovejši po datumu vnosa.

## PWA (namestitev kot aplikacija)

- `public/manifest.json`: id, scope, `display: standalone`, ikone 192/512 (any) + 512 maskable, bližnjice (Grafi, Primerjava let, Kalkulator). PNG ikone so v `public/icons/` (ustvarjene iz `icon.svg`), `public/favicon.ico`.
- `public/sw.js`: service worker (samo omrežje za strani in API, predpomni le statične datoteke; ob izpadu povezave prikaže `public/offline.html`). Podatkov in prijavljenih strani **ne** predpomni.
- `src/lib/pwa.tsx`: registracija SW (samo v produkciji) in gumb »Namesti aplikacijo« (ikona telefona) na nadzorni plošči in prijavi: Android/Chrome sproži namestitev neposredno, iPhone (Safari ali Chrome) dobi navodila »Deli → Dodaj na začetni zaslon«.
- Proxy in `next.config.ts`: `/sw.js` in `/offline.html` sta javna, `sw.js` se ne predpomni.
- iOS: `apple-touch-icon` (180 px), status vrstica »black«; odstranjena dinamična `icon.tsx`/`apple-icon.tsx`.
- Pogoj za namestitev: stran mora teči prek **HTTPS** (ali localhost). Preverjeno v Chromiumu: namestljivost brez napak, offline stran, sprožitev namestitve; ne na pravi napravi.
