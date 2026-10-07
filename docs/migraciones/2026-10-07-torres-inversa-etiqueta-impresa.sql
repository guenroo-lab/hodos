-- Precarga Inversa: cuándo se imprimió la etiqueta de cada torre (null = todavía sin imprimir).
-- Permite crear torres sin sacar la etiqueta e imprimir después las que faltan, todas o por selección.
--
-- Solo AÑADE una columna que admite nulos (instantáneo, no reescribe la tabla ni toca permisos).
-- Aplicar ANTES de desplegar la versión de HODOS que la usa; la versión anterior de HODOS sigue
-- funcionando con la columna puesta (no la lee ni la escribe).

alter table public.torres_inversa
  add column if not exists etiqueta_impresa_en timestamptz;

-- Hasta hoy toda torre se creaba imprimiendo su etiqueta al momento: las que ya existen figuran como
-- impresas el día que se crearon (si no, todas saldrían como «sin imprimir» de golpe).
update public.torres_inversa
   set etiqueta_impresa_en = fecha_creacion
 where etiqueta_impresa_en is null;

-- Comprobación (debe devolver la columna y 0 torres sin fecha de impresión):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'torres_inversa' and column_name = 'etiqueta_impresa_en';
--   select count(*) as sin_imprimir from public.torres_inversa where etiqueta_impresa_en is null;

-- Vuelta atrás (borra solo esa columna):
--   alter table public.torres_inversa drop column if exists etiqueta_impresa_en;
