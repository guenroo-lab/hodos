-- HODOS · recorte de egress de Supabase (2026-10-15)
-- Proyecto Supabase dbxlrnupiwemnarlxmcv (compartido con Kairos, esquema `preparacion`).
-- Esta migración es ADITIVA: crea dos funciones de solo lectura sobre public.etiquetas.
-- No toca tablas, datos, índices ni las funciones que ya existen.
--
-- Por qué:
--   * obtenerHistorialLotes (Backend.gs) bajaba TODA la tabla `etiquetas` (4 columnas, 7.246
--     filas el 15/10, 8 viajes de 1.000) para agrupar por lote_id y quedarse con los 10 últimos
--     lotes. ~35 llamadas/día = ~251.000 filas/día, ≈25 % de los bytes brutos de HODOS.
--   * obtenerSubtiposConocidos (EstructuraSheets.gs) bajaba la columna `subtipo` de todas las
--     etiquetas Taisa (2.508 filas, 3 viajes) para quedarse con 26 valores distintos. ~107
--     llamadas/día.
--
-- Orden de despliegue: PRIMERO esta migración, DESPUÉS `clasp push` del código nuevo (el código
-- nuevo llama a estas funciones; el viejo no las necesita, así que la migración sola no cambia
-- nada visible). Vuelta atrás: migraciones/2026-10-15-egress-historial-lotes-y-subtipos-rollback.sql

-- ─── 1. Historial de lotes ────────────────────────────────────────────────────────────────
-- Devuelve los `p_limite` lotes más recientes, del más reciente al más antiguo, con:
--   cantidad       = nº de etiquetas del lote
--   origen_texto,
--   destino,
--   fecha_creacion = los del PRIMER registro del lote
-- Es exactamente lo que calculaba el código viejo en JS (agrupar por lote_id en orden de
-- fecha_creacion ascendente, quedarse con el primer registro de cada lote, cortar los N últimos
-- y darles la vuelta).
--
-- Desempate (DECISIÓN, ver informe): todas las etiquetas de un lote se insertan a la vez, así que
-- comparten fecha_creacion. Si además tienen origen_texto/destino distintos (16 de 2.418 lotes
-- el 15/10: las llegadas de Antequera, cuyo origen_texto lleva «· PED. PROV. n» por soporte),
-- «el primer registro» dependía del orden en que Postgres ordenaba los empates, que no está
-- definido. Aquí el primer registro es el de menor id_unico (el primer soporte), que es el mismo
-- criterio de desempate que ya usa escanearSoporte (fecha_creacion asc, id_unico asc).
create or replace function public.historial_lotes(p_limite integer default 10)
returns table (
  lote_id        text,
  cantidad       integer,
  origen_texto   text,
  destino        text,
  fecha_creacion timestamptz
)
language sql
stable
set search_path = public
as $$
  with primeros as (
    select distinct on (e.lote_id)
           e.lote_id, e.origen_texto, e.destino, e.fecha_creacion, e.id_unico as primer_id
    from public.etiquetas e
    order by e.lote_id, e.fecha_creacion asc, e.id_unico asc
  ),
  ultimos as (
    select p.lote_id, p.origen_texto, p.destino, p.fecha_creacion, p.primer_id
    from primeros p
    order by p.fecha_creacion desc, p.primer_id desc
    limit greatest(coalesce(p_limite, 10), 1)
  )
  select u.lote_id,
         (select count(*) from public.etiquetas c where c.lote_id = u.lote_id)::integer,
         u.origen_texto, u.destino, u.fecha_creacion
  from ultimos u
  order by u.fecha_creacion desc, u.primer_id desc
$$;

-- ─── 2. Subtipos Taisa ya usados ─────────────────────────────────────────────────────────
-- Un valor por cada subtipo distinto de las etiquetas de origen Taisa (sin NULL), en el orden de
-- su PRIMERA aparición en la tabla (ctid = posición física). Es el mismo orden en que los veía
-- el código viejo, que leía la columna sin ORDER BY y se quedaba con la primera aparición de cada
-- valor; así el desplegable de «Subtipo» conserva su orden. (min(tid) existe desde Postgres 14.)
create or replace function public.subtipos_taisa_usados()
returns table (subtipo text)
language sql
stable
set search_path = public
as $$
  select e.subtipo
  from public.etiquetas e
  where e.origen = 'Taisa' and e.subtipo is not null
  group by e.subtipo
  order by min(e.ctid)
$$;

-- ─── 3. Permisos ──────────────────────────────────────────────────────────────────────────
-- Igual que siguiente_id_torre_inversa: solo la clave service_role (la que usa Apps Script) puede
-- ejecutarlas. Sin esto Supabase las expone a `anon` por defecto.
revoke execute on function public.historial_lotes(integer) from public, anon, authenticated;
grant  execute on function public.historial_lotes(integer) to service_role;
revoke execute on function public.subtipos_taisa_usados() from public, anon, authenticated;
grant  execute on function public.subtipos_taisa_usados() to service_role;
