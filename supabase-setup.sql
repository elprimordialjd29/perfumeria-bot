-- ══════════════════════════════════════════════════════════
-- SCRIPT DE CONFIGURACIÓN SUPABASE - Perfumería Bot
-- ══════════════════════════════════════════════════════════
-- 1. Entra a https://supabase.com → tu proyecto
-- 2. Ve a SQL Editor
-- 3. Pega TODO este script y dale "Run"
-- ══════════════════════════════════════════════════════════

-- ── Ventas registradas por el bot ────────────────────────
CREATE TABLE IF NOT EXISTS ventas (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendedor    TEXT NOT NULL,
  producto    TEXT NOT NULL,
  precio      DECIMAL(12,2) NOT NULL,
  cantidad    INTEGER DEFAULT 1,
  total       DECIMAL(12,2) NOT NULL,
  fecha       TIMESTAMPTZ DEFAULT NOW(),
  chat        TEXT DEFAULT '',
  fuente      TEXT DEFAULT 'bot'   -- 'bot' | 'manual' | 'vectorpos'
);

-- ── Catálogo de productos ─────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      TEXT UNIQUE NOT NULL,
  precio      DECIMAL(12,2) NOT NULL,
  stock       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Configuración del bot ─────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Valores iniciales de config
INSERT INTO config (key, value) VALUES
  ('negocio',     'Perfumería'),
  ('adminNumber', ''),
  ('metaMensual', '10000000')
ON CONFLICT (key) DO NOTHING;

-- ── Datos diarios importados de VectorPOS ─────────────────
CREATE TABLE IF NOT EXISTS ventas_pos (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha               DATE UNIQUE NOT NULL,
  total_dia           DECIMAL(12,2) DEFAULT 0,
  num_transacciones   INTEGER DEFAULT 0,
  raw_data            JSONB,
  importado_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices para consultas rápidas ───────────────────────
CREATE INDEX IF NOT EXISTS idx_ventas_fecha     ON ventas (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor  ON ventas (vendedor);
CREATE INDEX IF NOT EXISTS idx_ventas_pos_fecha ON ventas_pos (fecha DESC);

-- ── Vista: resumen de ventas por día ─────────────────────
CREATE OR REPLACE VIEW resumen_diario AS
SELECT
  DATE(fecha) AS dia,
  COUNT(*)    AS num_ventas,
  SUM(total)  AS total_bot
FROM ventas
GROUP BY DATE(fecha)
ORDER BY dia DESC;

-- ══════════════════════════════════════════════════════════
-- ✅ Script completado. Ahora configura tu .env con:
--    SUPABASE_URL  = (Settings → API → Project URL)
--    SUPABASE_KEY  = (Settings → API → anon key)
-- ══════════════════════════════════════════════════════════
