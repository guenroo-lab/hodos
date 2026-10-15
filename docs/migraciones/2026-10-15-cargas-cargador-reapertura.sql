-- Cargas: quién realiza la carga y reapertura de cargas cerradas.
--   cargador       personas que han cargado el camión, texto «A, B» (lista de Cargas/Descargas)
--   reabierta_por  cuenta de Google que reabrió la carga la última vez
--   reabierta_en   cuándo se reabrió por última vez (null = nunca reabierta)
--   b2b_conteo     palets SIE por sección (1-13) que se sumaron al B2B de Leroy Merlin en el último
--                  cierre, para que al cerrar otra vez solo se aplique la diferencia (null = nada aplicado)
--
-- Solo AÑADE columnas que admiten nulos (instantáneo, no reescribe la tabla ni toca permisos ni RLS).
-- Aplicar ANTES de desplegar la versión de HODOS que las usa: al abrir una carga se escribe `cargador`.
-- La versión anterior de HODOS sigue funcionando con las columnas puestas (no las lee ni las escribe).

alter table public.cargas
  add column if not exists cargador      text,
  add column if not exists reabierta_por text,
  add column if not exists reabierta_en  timestamptz,
  add column if not exists b2b_conteo    jsonb;

-- Comprobación (debe devolver las 4 columnas, todas nulables):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'cargas'
--      and column_name in ('cargador', 'reabierta_por', 'reabierta_en', 'b2b_conteo') order by column_name;

-- Vuelta atrás (borra solo esas columnas):
--   alter table public.cargas
--     drop column if exists cargador, drop column if exists reabierta_por,
--     drop column if exists reabierta_en, drop column if exists b2b_conteo;
