#!/bin/sh
set -e

echo "=========================================="
echo "  Energy Dashboard - Docker Entrypoint"
echo "=========================================="
echo "DATABASE_URL: ${DATABASE_URL:+nastavljeno}"

# ── 1. Wait for PostgreSQL to be ready ──
echo ""
echo "⏳ Čakam, da se PostgreSQL zažene..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query('SELECT 1')
    .then(() => { console.log('  DB ping OK'); pool.end(); process.exit(0); })
    .catch((e) => { pool.end(); process.exit(1); });
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "❌ PostgreSQL ni dosegljiv po ${MAX_RETRIES} poskusih!"
    echo "   Preveri DATABASE_URL in ali je baza zagnana."
    exit 1
  fi
  echo "   Poskus $RETRY/$MAX_RETRIES..."
  sleep 2
done
echo "✅ PostgreSQL je pripravljen!"

# ── 2. Create tables ──
echo ""
echo "📦 Ustvarjam tabele..."
node <<'MIGRATE_EOF'
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const queries = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS column_configs (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    source_type VARCHAR(50) NOT NULL DEFAULT 'manual',
    formula TEXT,
    unit VARCHAR(50) DEFAULT 'kWh',
    editable BOOLEAN DEFAULT true,
    visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_values (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    column_key VARCHAR(100) NOT NULL,
    value DOUBLE PRECISION DEFAULT 0,
    is_manual BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    CONSTRAINT date_column_unique UNIQUE (date, column_key)
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`
];

(async () => {
  for (const q of queries) {
    await pool.query(q);
  }
  console.log('  ✅ Tabele pripravljene');
  await pool.end();
})().catch(e => {
  console.error('  ❌ Napaka pri ustvarjanju tabel:', e.message);
  process.exit(1);
});
MIGRATE_EOF

# ── 3. Seed default data ──
echo ""
echo "🌱 Preverjam privzete podatke..."
node <<'SEED_EOF'
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // ── Admin user ──
  const { rows } = await pool.query("SELECT id FROM users WHERE username = 'admin'");
  if (rows.length === 0) {
    const hash = await bcrypt.hash('admin', 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true)',
      ['admin', hash]
    );
    console.log('  ✅ Admin uporabnik ustvarjen (admin/admin)');
  } else {
    console.log('  ℹ️  Admin uporabnik že obstaja');
  }

  // ── Column configs ──
  const colCheck = await pool.query('SELECT count(*)::int as cnt FROM column_configs');
  if (colCheck.rows[0].cnt === 0) {
    const columns = [
      { key: 'toplotna',            label: 'Toplotna',         order: 1, src: 'formula',   formula: '{toplotna_ogrevanje} + {toplotna_sanitarna}',                              editable: false },
      { key: 'toplotna_ogrevanje',  label: 'Topl. ogrevanje',  order: 2, src: 'melcloud',  formula: null,                                                                       editable: true  },
      { key: 'toplotna_sanitarna',  label: 'Topl. san. voda',  order: 3, src: 'melcloud',  formula: null,                                                                       editable: true  },
      { key: 'avto',                label: 'Avto',              order: 4, src: 'manual',    formula: null,                                                                       editable: true  },
      { key: 'gospodinjstvo',       label: 'Gospodinjstvo',     order: 5, src: 'formula',   formula: '{skupna_poraba} - {avto} - {toplotna_ogrevanje} - {toplotna_sanitarna}',    editable: false },
      { key: 'solarna',             label: 'Sončna elektr.',    order: 6, src: 'solaredge', formula: null,                                                                       editable: true  },
      { key: 'skupna_poraba',       label: 'Skupna poraba',     order: 7, src: 'solaredge', formula: null,                                                                       editable: true  },
      { key: 'visek_manjko',        label: 'Višek/Manjko',      order: 8, src: 'formula',   formula: '{solarna} - {skupna_poraba}',                                              editable: false },
    ];

    for (const c of columns) {
      await pool.query(
        'INSERT INTO column_configs (key, label, display_order, source_type, formula, unit, editable) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO NOTHING',
        [c.key, c.label, c.order, c.src, c.formula, 'kWh', c.editable]
      );
    }
    console.log('  ✅ 8 stolpcev ustvarjenih');
  } else {
    console.log('  ℹ️  Stolpci že obstajajo (' + colCheck.rows[0].cnt + ')');
  }

  await pool.end();
})().catch(e => {
  console.error('  ❌ Napaka pri seedu:', e.message);
  process.exit(1);
});
SEED_EOF

# ── 4. Start app ──
echo ""
echo "=========================================="
echo "🚀 Energy Dashboard zagnan!"
echo "   http://localhost:${PORT:-3000}"
echo ""
echo "   Prijava: admin / admin"
echo "=========================================="
exec node server.js
