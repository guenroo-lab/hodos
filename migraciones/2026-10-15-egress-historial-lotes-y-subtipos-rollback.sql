-- Vuelta atrás de 2026-10-15-egress-historial-lotes-y-subtipos.sql.
-- Solo borra las dos funciones nuevas (no tocan datos). Hacerlo DESPUÉS de volver al código
-- anterior (`clasp deploy ... -V 100`, la versión de HODOS anterior a este cambio), porque el
-- código nuevo las necesita.
drop function if exists public.historial_lotes(integer);
drop function if exists public.subtipos_taisa_usados();
