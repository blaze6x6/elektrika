# ⚡ Energy Dashboard

Spletna aplikacija za dnevno beleženje porabe in proizvodnje električne energije.
Podatke črpa iz **SolarEdge** in **MELCloud** API-jev, ali pa jih vnašate ročno.

## 📊 Stolpci

| # | Stolpec | Vir | Formula |
|---|---------|-----|---------|
| 1 | Toplotna | Formula | `Topl. ogrevanje + Topl. san. voda` |
| 2 | Topl. ogrevanje | MELCloud / ročno | – |
| 3 | Topl. san. voda | MELCloud / ročno | – |
| 4 | Avto | Ročno | – |
| 5 | Gospodinjstvo | Formula | `Skupna poraba - Avto - Topl. ogr. - Topl. san.` |
| 6 | Sončna elektr. | SolarEdge / ročno | – |
| 7 | Skupna poraba | SolarEdge / ročno | – |
| 8 | Višek/Manjko | Formula | `Sončna elektr. - Skupna poraba` |

Stolpce, formule in uporabnike urejate v **admin panelu** (`/admin`).

---

## 🚀 Namestitev z Docker Compose

### 1. Kloniraj repozitorij

```bash
git clone <url-repozitorija> energy-dashboard
cd energy-dashboard
```

### 2. Ustvari .env datoteko

```bash
cp .env.example .env
nano .env   # prilagodi gesla in API ključe
```

**Pomembno:** Spremeni vsaj `DB_PASSWORD` in `JWT_SECRET`!

Po želji lahko nastaviš tudi daljše trajanje prijave:
- `SESSION_DAYS=180`

> Opomba: na iPhone je shranjevanje sej v "Add to Home Screen" načinu najbolj zanesljivo, če aplikacija teče prek **HTTPS** domene, ne samo prek lokalnega HTTP naslova.

### 3. Zaženi

```bash
docker compose up -d --build
```

To bo:
- ✅ Pognalo PostgreSQL bazo
- ✅ Počakalo, da je baza pripravljena
- ✅ Ustvarilo tabele v bazi
- ✅ Ustvarilo privzetega admin uporabnika
- ✅ Nastavilo 8 stolpcev s formulami
- ✅ Zagnalo aplikacijo na portu 3000

### 4. Odpri v brskalniku

```
http://tvoj-ip:3000
```

**Privzeta prijava:**
- Uporabniško ime: `admin`
- Geslo: `admin`

⚠️ **Geslo takoj spremeni** v Admin → Uporabniki!

---

## 📱 Bližnjica na telefonu

### Android (Chrome):
1. Odpri stran v Chrome
2. Tapni ⋮ (tri pike) → **"Dodaj na začetni zaslon"**
3. Potrdi

### iPhone (Safari):
1. Odpri stran v Safari
2. Tapni 📤 (Share) → **"Dodaj na začetni zaslon"**
3. Potrdi

---

## ⚙️ Admin panel

Na `/admin` ali prek gumba ⚙️ na vrhu:

- **Stolpci:** Dodaj/uredi/briši stolpce, nastavi formule
- **Uporabniki:** Dodaj nove uporabnike, spremeni gesla
- **API nastavitve:** Nastavi SolarEdge in MELCloud ključe v `.env`

### Formule

V formulah se sklicuješ na druge stolpce z `{kljuc_stolpca}`:

```
{toplotna_ogrevanje} + {toplotna_sanitarna}
{skupna_poraba} - {avto} - {toplotna_ogrevanje} - {toplotna_sanitarna}
{solarna} - {skupna_poraba}
```

---

## 🔌 API integracije

### SolarEdge
1. Pojdi na https://monitoring.solaredge.com
2. Admin → Site Access → API Access
3. Kopiraj API Key in Site ID
4. Vstavi v `.env`:
   ```
   SOLAREDGE_API_KEY=tvoj_kljuc
   SOLAREDGE_SITE_ID=tvoj_site_id
   ```

### MELCloud
1. Uporabi iste podatke kot za MELCloud aplikacijo
2. Vstavi v `.env`:
   ```
   MELCLOUD_EMAIL=tvoj@email.com
   MELCLOUD_PASSWORD=tvoje_geslo
   ```
3. Če samodejno odkrivanje naprave ne uspe, dodaj še:
   ```
   MELCLOUD_DEVICE_ID=12345678
   ```

Po nastavitvi API ključev, na glavni strani pritisni **"API Sync"** za prenos podatkov.

---

## 🔧 Upravljanje

### Poglej loge
```bash
docker compose logs -f web
```

### Ponovno zgradi po spremembah kode
```bash
docker compose up -d --build
```

### Ustavi
```bash
docker compose down
```

### Ustavi in pobriši bazo (⚠️ vsi podatki se izgubijo!)
```bash
docker compose down -v
```

### Varnostna kopija baze
```bash
docker compose exec db pg_dump -U energy_user energydb > backup_$(date +%Y%m%d).sql
```

### Obnovi iz kopije
```bash
cat backup_20260715.sql | docker compose exec -T db psql -U energy_user energydb
```

---

## 🔒 Varnost

- Spremeni privzeto admin geslo!
- Nastavi močen `JWT_SECRET` v `.env`
- Nastavi močno `DB_PASSWORD` v `.env`
- Za dostop od zunaj uporabi reverse proxy (nginx/traefik) z HTTPS

### Primer nginx reverse proxy:
```nginx
server {
    listen 80;
    server_name energy.tvoja-domena.si;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
