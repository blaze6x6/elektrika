#!/usr/bin/env node
/* eslint-disable */
/**
 * Inicializacija baze ob zagonu kontejnerja:
 *  1. preveri skrivnosti (JWT_SECRET, CRON_SECRET) – ob napaki zavrne zagon
 *  2. uporabi SQL migracije iz db/migrations (z zaklepom, zabeležene v schema_migrations)
 *  3. ustvari začetnega skrbnika (ADMIN_PASSWORD ali naključno geslo) in privzete stolpce
 *  4. vsili menjavo gesla za uporabnike, ki še imajo staro privzeto geslo "admin"
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// ── 1. Skrivnosti (pravila morajo ustrezati src/lib/secrets.ts) ──
const KNOWN_BAD = [
  "default_secret_key_please_change_this_in_production",
  "spremeni_me_v_produkciji_abc123",
  "energy_cron_secret_123",
  "energy_pass_123",
];
function secretProblem(v, minLen) {
  if (!v) return "ni nastavljena";
  if (v.length < minLen) return `je prekratka (min. ${minLen} znakov)`;
  const l = v.toLowerCase();
  if (KNOWN_BAD.includes(l)) return "je znana privzeta vrednost";
  if (l.includes("change_me") || l.includes("changeme") || l.includes("spremeni_me")) return "je še vedno vzorčna vrednost";
  return null;
}
function checkSecrets() {
  const errors = [];
  const jwt = secretProblem(process.env.JWT_SECRET, 32);
  if (jwt) errors.push(`JWT_SECRET ${jwt}`);
  const cron = secretProblem(process.env.CRON_SECRET, 16);
  if (cron) errors.push(`CRON_SECRET ${cron}`);
  if (errors.length) {
    console.error("\n❌ Neveljavna konfiguracija:");
    errors.forEach((e) => console.error("   - " + e));
    console.error("   Ustvari vrednosti z:  openssl rand -hex 32   in jih vpiši v .env\n");
    process.exit(1);
  }
}

// ── 2. Migracije ──
async function migrate(pool) {
  const dir = path.join(__dirname, "..", "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT NOW())"
    );
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`  ✅ migracija ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migracija ${f} ni uspela: ${e.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}

// ── 3. Začetni podatki ──
const BASE_COLUMNS = [
  ["toplotna", "Toplotna", 1, "formula", "{toplotna_ogrevanje} + {toplotna_sanitarna}", false],
  ["toplotna_ogrevanje", "Topl. ogrevanje", 2, "melcloud", null, true],
  ["toplotna_sanitarna", "Topl. san. voda", 3, "melcloud", null, true],
  ["avto", "Avto", 4, "manual", null, true],
  ["gospodinjstvo", "Gospodinjstvo", 5, "formula", "{skupna_poraba} - {avto} - {toplotna_ogrevanje} - {toplotna_sanitarna}", false],
  ["solarna", "Sončna elektr.", 6, "solaredge", null, true],
  ["skupna_poraba", "Skupna poraba", 7, "solaredge", null, true],
  ["visek_manjko", "Višek/Manjko", 8, "formula", "{solarna} - {skupna_poraba}", false],
];
const ME_COLUMNS = [
  ["me_blok1", "MojElektro blok 1"],
  ["me_blok2", "MojElektro blok 2"],
  ["me_blok3", "MojElektro blok 3"],
  ["me_blok4", "MojElektro blok 4"],
  ["me_blok5", "MojElektro blok 5"],
  ["me_uvoz", "MojElektro uvoz"],
  ["me_oddaja", "MojElektro oddaja"],
];

const SE_COLUMNS = [1, 2, 3, 4, 5].map((b) => [`se_samo_blok${b}`, `SolarEdge samooskrba blok ${b}`]);

const SE_KUP_COLUMNS = [1, 2, 3, 4, 5].map((b) => [`se_kup_blok${b}`, `SolarEdge uvoz blok ${b}`]);

async function seedAdmin(pool) {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE is_admin = true");
  if (rows[0].n > 0) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  let password = process.env.ADMIN_PASSWORD || "";
  let generated = false;
  if (password && (password.length < 10 || Buffer.byteLength(password) > 72)) {
    console.warn("  ⚠️  ADMIN_PASSWORD je prekratek (min. 10) ali predolg (max 72 bajtov) – generiram naključno geslo.");
    password = "";
  }
  if (!password) {
    password = crypto.randomBytes(12).toString("base64url");
    generated = true;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash, is_admin, must_change_password)
     VALUES ($1, $2, true, true) ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, is_admin = true, must_change_password = true`,
    [username, hash]
  );
  console.log("\n  ┌──────────────────────────────────────────────────────────┐");
  console.log(`  │ Ustvarjen skrbnik:  ${username}`);
  if (generated) {
    console.log(`  │ Začetno geslo:      ${password}`);
    console.log("  │ (prikazano samo enkrat – ob prvi prijavi ga boš moral zamenjati)");
  } else {
    console.log("  │ Geslo: iz ADMIN_PASSWORD (ob prvi prijavi ga boš moral zamenjati)");
  }
  console.log("  └──────────────────────────────────────────────────────────┘\n");
}

async function seedColumns(pool) {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM column_configs");
  if (rows[0].n === 0) {
    for (const [key, label, order, src, formula, editable] of BASE_COLUMNS) {
      await pool.query(
        `INSERT INTO column_configs (key, label, display_order, source_type, formula, unit, editable)
         VALUES ($1,$2,$3,$4,$5,'kWh',$6) ON CONFLICT (key) DO NOTHING`,
        [key, label, order, src, formula, editable]
      );
    }
    console.log("  ✅ ustvarjenih 8 privzetih stolpcev");
  }
  // MojElektro stolpci (skriti) – samo enkrat, da jih ob brisanju ne ustvarjamo znova
  const flag = await pool.query("SELECT 1 FROM app_settings WHERE key = 'seed_me_columns_v1'");
  if (flag.rowCount === 0) {
    let order = 20;
    for (const [key, label] of ME_COLUMNS) {
      await pool.query(
        `INSERT INTO column_configs (key, label, display_order, source_type, unit, editable, visible)
         VALUES ($1,$2,$3,'mojelektro','kWh',true,false) ON CONFLICT (key) DO NOTHING`,
        [key, label, order++]
      );
    }
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('seed_me_columns_v1','1') ON CONFLICT (key) DO NOTHING");
    console.log("  ✅ dodani (skriti) stolpci MojElektro");
  }
  // SolarEdge samooskrba po blokih (skriti stolpci)
  const seFlag = await pool.query("SELECT 1 FROM app_settings WHERE key = 'seed_se_columns_v1'");
  if (seFlag.rowCount === 0) {
    let order = 30;
    for (const [key, label] of SE_COLUMNS) {
      await pool.query(
        `INSERT INTO column_configs (key, label, display_order, source_type, unit, editable, visible)
         VALUES ($1,$2,$3,'solaredge','kWh',true,false) ON CONFLICT (key) DO NOTHING`,
        [key, label, order++]
      );
    }
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('seed_se_columns_v1','1') ON CONFLICT (key) DO NOTHING");
    console.log("  ✅ dodani (skriti) stolpci SolarEdge samooskrba po blokih");
  }
  // SolarEdge uvoz po blokih (kontrola proti MojElektro, skriti stolpci)
  const kupFlag = await pool.query("SELECT 1 FROM app_settings WHERE key = 'seed_se_kup_columns_v1'");
  if (kupFlag.rowCount === 0) {
    let order = 40;
    for (const [key, label] of SE_KUP_COLUMNS) {
      await pool.query(
        `INSERT INTO column_configs (key, label, display_order, source_type, unit, editable, visible)
         VALUES ($1,$2,$3,'solaredge','kWh',true,false) ON CONFLICT (key) DO NOTHING`,
        [key, label, order++]
      );
    }
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('seed_se_kup_columns_v1','1') ON CONFLICT (key) DO NOTHING");
    console.log("  ✅ dodani (skriti) stolpci SolarEdge uvoz po blokih");
  }
}

// ── 4. Staro privzeto geslo "admin" ──
async function flagDefaultPasswords(pool) {
  const { rows } = await pool.query("SELECT id, username, password_hash FROM users WHERE must_change_password = false");
  for (const u of rows) {
    if (await bcrypt.compare("admin", u.password_hash)) {
      await pool.query("UPDATE users SET must_change_password = true, token_version = token_version + 1 WHERE id = $1", [u.id]);
      console.log(`  ⚠️  uporabnik '${u.username}' ima privzeto geslo – ob prijavi bo moral nastaviti novo`);
    }
  }
}

(async () => {
  checkSecrets();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(pool);
    await seedAdmin(pool);
    await seedColumns(pool);
    await flagDefaultPasswords(pool);
    console.log("  ✅ baza pripravljena");
  } catch (e) {
    console.error("  ❌ " + e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
