# ⚡ Štrom poraba (Energy Dashboard)

Spletna aplikacija za dnevno beleženje porabe in proizvodnje električne energije.
Podatke črpa iz **SolarEdge**, **MELCloud** in **MojElektro** API-jev, ali pa jih vnašate ročno.

> **Nadgrajujete obstoječo namestitev?** Preberite najprej [CHANGES.md](CHANGES.md) – zagon je zdaj
> zavrnjen, dokler ne nastavite pravih skrivnosti, vsi uporabniki se bodo morali enkrat znova prijaviti.

## 📊 Privzeti stolpci

| Stolpec | Vir | Formula |
|---|---|---|
| Toplotna | Formula | `Topl. ogrevanje + Topl. san. voda` |
| Topl. ogrevanje / san. voda | MELCloud / ročno | – |
| Avto | Ročno | – |
| Gospodinjstvo | Formula | `Skupna poraba - Avto - Topl. ogr. - Topl. san.` |
| Sončna elektr. / Skupna poraba | SolarEdge / ročno | – |
| Višek/Manjko | Formula | `Sončna elektr. - Skupna poraba` |

Poleg tega so ustvarjeni (skriti) stolpci `me_blok1…5`, `me_uvoz`, `me_oddaja` za podatke MojElektro
(prikaz vklopite v Admin → Stolpci). Formule se lahko sklicujejo tudi na druge formule; krožni sklici so zavrnjeni.

---

## 🚀 Namestitev (Docker Compose)

```bash
git clone <url-repozitorija> energy-dashboard && cd energy-dashboard
cp .env.example .env
```

V `.env` **obvezno** nastavi (primer vrednosti: `openssl rand -hex 32`):

| Spremenljivka | Pomen |
|---|---|
| `DB_PASSWORD` | geslo baze (priporočeno samo črke/številke, je del `DATABASE_URL`) |
| `JWT_SECRET` | podpisni ključ sej, ≥ 32 znakov |
| `CRON_SECRET` | skrivnost za cron klice, ≥ 16 znakov |

Brez veljavnih vrednosti (ali s primerom `CHANGE_ME`) se kontejner ne zažene in izpiše razlog.

```bash
docker compose up -d            # slike iz Docker Huba
# ali iz izvorne kode:
docker compose -f docker-compose.dev.yml up -d --build
docker compose logs web         # tu je izpisano začetno geslo skrbnika
```

**Prvi skrbnik:** ob prvem zagonu se ustvari uporabnik `admin` (ali `ADMIN_USERNAME`). Če `ADMIN_PASSWORD` ni nastavljen,
se ustvari naključno geslo in se **enkrat** izpiše v logu (`docker compose logs web`). Ob prvi prijavi je zamenjava
gesla obvezna. Geslo: najmanj 10 znakov.

Odpri `http://tvoj-ip:3000`.

### HTTPS in reverse proxy

Za dostop od zunaj postavi reverse proxy z HTTPS (nginx/Traefik/Caddy). Piškotek seje je `Secure`
(`__Host-session`), če zahteva pride prek HTTPS (proxy mora nastaviti `X-Forwarded-Proto`);
`COOKIE_SECURE=true|false` prisili vrednost. Proxy mora posredovati tudi `Host` (ali nastavi `ALLOWED_ORIGINS`).

```nginx
server {
    listen 443 ssl;
    server_name energy.tvoja-domena.si;
    # ssl_certificate ... (certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Baza je privzeto dostopna samo na `127.0.0.1`. **Ne izpostavljaj porta 5432 na internet.**
Za zaščito pred ugibanjem gesel poleg vgrajene omejitve (10 napačnih poskusov na uporabnika / 30 na IP) razmisli o `fail2ban` na proxyju.

---

## 🔐 Vloge in varnost

- **Uporabnik:** vpogled v podatke, ročni vnos, uvoz/izvoz CSV, sinhronizacija, grafi, kalkulator, lastna zamenjava gesla.
- **Skrbnik:** dodatno stolpci/formule, uporabniki, tarife, e-pošta/SMTP, dnevnik sprememb, MojElektro diagnostika.
- Seje so podpisane (HS256) in vezane na `token_version` v bazi: zamenjava gesla odjavi vse naprave.
- SMTP geslo je v bazi **šifrirano** (AES-256-GCM; ključ iz `SETTINGS_KEY` ali `JWT_SECRET`) in se nikoli ne pošlje v brskalnik.
- SMTP strežnik je zaščiten pred SSRF (blokirani loopback/link-local, dovoljena standardna vrata). Strežnik v LAN na
  nestandardnih vratih omogoči `SMTP_ALLOW_INTERNAL=true`. TLS potrdilo se privzeto preverja; samopodpisano dovoliš v nastavitvah e-pošte.
- Ročno vnesene vrednosti (`isManual`) **sinhronizacija ne prepiše**.
- Vse spremembe (vnosi, uporabniki, nastavitve, stolpci, prijave, neuspele prijave) so v dnevniku; zapisi starejši od ~400 dni se brišejo.

## ⏰ Samodejna sinhronizacija (cron kontejner)

Vsak dan ob 4:00 (`SYNC_SCHEDULE`, časovni pas `TZ`): sinhronizacija tekočega meseca (SolarEdge, MELCloud, MojElektro),
**1. in 2. v mesecu tudi prejšnjega meseca** (da dobi zadnji dan končne vrednosti), preverjanje opozorila za včerajšnji dan
in 1. v mesecu mesečno poročilo. Izpis: `docker compose logs cron`. Ob napaki skripta vrne kodo ≠ 0.

## 💾 Varnostne kopije

```bash
./backup.sh                 # ./backups/energydb_backup_*.sql.gz (ohrani zadnjih 30; KEEP=60 ./backup.sh)
./backup.sh /mnt/nas/elektrika
./restore.sh backups/energydb_backup_20261008_031500.sql.gz
```

Skripta se ustavi ob vsaki napaki (tudi pg_dump), preveri veljavnost datoteke in ne pusti pol-zapisanih kopij.
Samodejno: `15 3 * * * cd /pot/do/projekta && ./backup.sh /mnt/nas/elektrika >> backup.log 2>&1`.
Kopije hrani tudi zunaj tega strežnika.

## 🗄️ Baza in migracije

SQL migracije so v `db/migrations/` in se ob zagonu uporabijo samodejno (zabeležene v `schema_migrations`, z zaklepom).
Nova sprememba sheme = nova datoteka `0003_….sql` (idempotentna) + posodobitev `src/db/schema.ts`.
PostgreSQL 15 je še podprt; nadgradnja na novejši major zahteva `pg_dump` → nova baza → `restore` (podatkovne mape se ne dajo kar zamenjati).

## 🧪 Razvoj

```bash
npm install          # ustvari package-lock.json – commitaj ga (Docker in CI uporabljata npm ci)
npm run typecheck && npm run lint && npm test
npm run dev          # potrebuje DATABASE_URL, JWT_SECRET, CRON_SECRET; nato: npm run db:init
```

Testi (`tests/`) pokrivajo formule, validacijo, omejevalnik, tarife, SSRF in preverjanje skrivnosti.

## 🔌 API integracije

- **SolarEdge** – `SOLAREDGE_API_KEY`, `SOLAREDGE_SITE_ID`. API ima omejitev ~300 klicev/dan; ročni sync ima 30 s premor, živi podatki so 30 s v predpomnilniku.
- **MELCloud** – `MELCLOUD_EMAIL`, `MELCLOUD_PASSWORD` (po potrebi `MELCLOUD_DEVICE_ID`). Neuradni API.
- **MojElektro** – `MOJELEKTRO_API_KEY`, `MOJELEKTRO_EIMM`, (`MOJELEKTRO_GSRN_MT`). Bloki se izračunajo iz **15-minutnih odčitkov A+/A-** po uradnem urniku blokov (`src/lib/blocks.ts`); `MOJELEKTRO_TS_MODE` (`end`/`start`) določa, ali je časovni žig konec ali začetek intervala.
  ⚠️ Preveri na svojih podatkih, ali je `endTime` v API-ju vključen (zadnji dan v mesecu) in ali so odčitki dnevni ali 15-minutni.

## 🧾 Tarife v kalkulatorju

Privzete cene (`src/lib/tariff.ts`) so **primer** iz računa dobavitelja za 2024+ in so lahko zastarele.
Skrbnik jih nastavi v Kalkulator → Tarife; dogovorjene moči se ob sinhronizaciji MojElektro posodobijo samodejno.

## Licenca

Glej [LICENSE](LICENSE).
