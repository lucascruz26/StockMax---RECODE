-- StockMax — esquema PostgreSQL (Neon). Executado automaticamente ao iniciar o servidor.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'Operador' CHECK (role IN ('Admin', 'Operador')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS suppliers (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(150) NOT NULL,
  doc   VARCHAR(20),   -- CNPJ/CPF
  phone VARCHAR(30),
  email VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  category    VARCHAR(80)  NOT NULL DEFAULT '',
  unit        VARCHAR(10)  NOT NULL DEFAULT 'un',
  cost        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  price       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  qty         INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  min_qty     INT NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  supplier_id INT REFERENCES suppliers(id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE          -- soft delete
);

CREATE TABLE IF NOT EXISTS movements (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  user_id    INT NOT NULL REFERENCES users(id),
  kind       VARCHAR(10) NOT NULL CHECK (kind IN ('entrada', 'saida', 'ajuste')),
  qty        INT NOT NULL CHECK (qty >= 0),
  reason     VARCHAR(255) NOT NULL CHECK (length(trim(reason)) > 0),  -- motivo obrigatório
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements (created_at DESC);

-- Auditoria inviolável: movimentações nunca podem ser alteradas nem apagadas.
CREATE OR REPLACE FUNCTION bloquear_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela movements é imutável (trilha de auditoria).';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movements_imutavel ON movements;
CREATE TRIGGER trg_movements_imutavel BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao();

-- Produtos ativos no mínimo ou abaixo (usada no painel de alertas).
CREATE OR REPLACE VIEW v_estoque_alerta AS
  SELECT id, sku, name, qty, min_qty, is_active FROM products WHERE is_active AND qty <= min_qty;
