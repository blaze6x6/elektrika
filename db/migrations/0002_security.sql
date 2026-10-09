-- 0002: varnostne razširitve (razveljavitev sej, prisilna menjava gesla, indeksi)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

-- uporabniška imena niso občutljiva na velikost črk; če v bazi že obstajajo
-- dvojniki, indeks preskočimo (aplikacija vseeno preverja dvojnike pri ustvarjanju)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'users_username_lower_idx preskočen: obstajajo uporabniki, ki se razlikujejo samo po velikosti črk';
END $$;
