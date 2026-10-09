-- 0001: osnovna shema (idempotentno – varno tudi na bazah, ustvarjenih s starim entrypointom)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS column_configs (
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
);

CREATE TABLE IF NOT EXISTS daily_values (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  column_key VARCHAR(100) NOT NULL,
  value DOUBLE PRECISION DEFAULT 0,
  is_manual BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT date_column_unique UNIQUE (date, column_key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
