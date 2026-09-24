# Fusión de Carta de Portes SIE en HODOS

Diseño para que el flujo de refill SIE (escaneo de palés SSCC, hoy en la app separada
`CartadePortesSIE`, backend Sheets) pase a vivir dentro de HODOS (backend Supabase), como
una capacidad más de la misma app — no una app aparte enlazada por URL, que es como
funcionan hoy (ver `?vista=operario&tienda&fecha&horario` / `?tienda&fecha&horario` en
`Backend.gs:3-21` y `CartaPortes.gs:98-111`).

Decisión del usuario: el escaneo de SSCC comparte el mismo cuadro de escaneo que ya usa
HODOS para soportes de pedido cliente (`escanearSoporte`), no una pestaña aparte.

---

## Decisiones de alcance (confirmadas por el usuario)

- **Fusión total, no solo cross-link más profundo.** El objetivo explícito es "que todo se
  haga desde HODOS", con el documento de cierre reflejando ambos flujos cuando coincidan en
  el mismo camión.
- **Migración por fases, con rollback trivial en cada una** — a diferencia de la migración
  Sheets→Supabase de HODOS (que fue reemplazo directo porque HODOS estaba en modo prueba),
  aquí SÍ hay datos y usuarios reales en producción diaria en ambos lados. Se sigue expandir →
  migrar → verificar → contraer (esta última fase, fuera de alcance de este documento).
- **Lo que NO migra**: el documento B2B externo de Leroy Merlin (contrato ajeno, sigue en
  Sheets); el cotejo contra el `.xlsx` diario de Drive (agnóstico de backend); el puente
  Android HTTP Shortcuts de ubicaciones RC1 (vive en el dispositivo).

---

## 1. Hallazgo clave: `cargas` ya es compartible entre flujos

`cargas` (`EstructuraCargas.gs`) no tiene columna de tipo de flujo — solo
`destino/fecha_entrega/horario`, y `obtenerOCrearCarga` (`Backend.gs:482`) ya deduplica por
esa terna exacta. Confirmado contra `ConfigEntregas.gs:54-61`: los horarios de
`HORARIOS_ENTREGA_TIENDA` para Marbella/Mijas son **byte-idénticos** a `HORARIOS_CAMIONES`
de CartaPortesSIE — un refill SIE y un pedido cliente para la misma tienda+fecha+horario ya
caen en la misma fila `cargas` sin cambio ninguno. De ahí sale gratis el documento
combinado: basta con que `htmlInformeCarga` (`ReporteCarga.gs`) lea también los palets de
esa carga.

`etiquetas.origen` es texto libre, ya extendido varias veces (MECO/Valencia/Torija/
Antequera) sin tocar el esquema — mismo patrón de extensión que se usa aquí.

## 2. Esquema nuevo — tabla `palets`

Creada en Supabase (proyecto `HODOS`, `dbxlrnupiwemnarlxmcv`), 2026-09-15:

```sql
create table public.palets (
  id bigint generated always as identity primary key,
  sscc text not null,
  codigo_lm text,
  seccion text,
  encontrado boolean,
  batea_id text references public.cargas(id_carga),
  creado_por text,
  fecha_creacion timestamptz not null default now()
);
```

Puramente aditiva — no toca `cargas`/`etiquetas`/`contenido`. `encontrado` nulo = pendiente
de cotejo (igual que SIE marcaba "Pendiente de cotejo" antes de pulsar "Generar carta").
**No hay tabla "Borrador" equivalente**: escribir la fila al escanear (igual que `etiquetas`
ya protege sus escaneos) es la propia protección anti-pérdida.

Acceso vía `EstructuraPaletes.gs` (mismo patrón que `EstructuraContenido.gs`/
`EstructuraCargas.gs`, reusa `supaInsertar_/supaGet_/supaActualizar_/supaBorrar_` de
`SupabaseCliente.gs` — nada de acceso a Supabase fuera de ese archivo).

## 3. Rama residual en `escanearSoporte` — verificado contra el código real

`Backend.gs:570-613` no tiene dos ramas con `return` propio; es un único flujo dentro de un
bucle de reintento por concurrencia optimista. El punto de inserción exacto es
`Backend.gs:591`:

```js
var resultado = seleccionarSoporteAEscanear(candidatas, valorEscaneado, destinoCarga);
if (!resultado.ok) return resultado;
```

`seleccionarSoporteAEscanear` (`Utilidades.gs:114-134`) devuelve
`{ok:false, motivo:'NO_ENCONTRADO'}` cuando nada coincide ni por `id_unico` ni por
`numero_pedido`. Cambio mínimo:

```js
if (!resultado.ok) {
  if (resultado.motivo === 'NO_ENCONTRADO' && esFormatoSSCC_(valorEscaneado)) {
    return escanearPaletSSCC_(idCarga, valorEscaneado); // sale del bucle, es un INSERT, no hay conflicto que reintentar
  }
  return resultado;
}
```

Preserva `DESTINO_INCORRECTO`, `YA_ESCANEADO` y cualquier `NO_ENCONTRADO` sin forma de SSCC
exactamente igual que hoy. Un `numero_pedido` real siempre se comprueba primero.

### Gate de colisión SSCC vs `numero_pedido` (ejecutado 2026-09-15)

Contra las 4260 etiquetas reales en producción: **1 colisión de forma** (`numero_pedido`
`030176010452797723`, 18 dígitos, origen Valencia, estado `EN_RUTA`). No es un riesgo real:
mientras esa fila exista en `etiquetas`, `escanearSoporte` siempre la resuelve por el camino
normal (`YA_ESCANEADO`) — nunca llega a `NO_ENCONTRADO`, así que nunca alcanza la rama
residual. Por curiosidad, esa fila también pasa la validación de dígito de control GS1
(`suma=117, check=3`) — coincidencia de 1 entre 10, no descarta el caso por sí sola, pero el
razonamiento de "solo importa si sigue devolviendo NO_ENCONTRADO" ya lo neutraliza. Se
implementa la validación GS1 en `esFormatoSSCC_` (`EstructuraPaletes.gs`) como defensa
adicional igualmente, reduciendo further el margen para un futuro `numero_pedido` con esa
forma.

## 4. Cotejo de inventario — puerto sin cambios de lógica

`CotejoInventarioSIE.gs` porta `leerInventarioDrive`/`cotejarSSCC`
(`CartadePortesSIE/CartaPortes.gs:251-354`) tal cual. Igual que en SIE, el cotejo se hace en
bloque (una sola apertura del Excel) — aquí en `cotejarPaletesDeCarga_(idCarga, tienda)`,
llamado al cerrar la carga (`cerrarCarga`), no en cada escaneo individual (abrir/convertir
el `.xlsx` en cada escaneo sería demasiado lento).

## 5. Documento combinado

`ReporteCarga.gs` / `htmlInformeCarga(idCarga)`: si `leerPaletesPorCarga_(idCarga)` devuelve
filas, se añade una segunda tabla (#/SSCC/Código LM/Sección, mismo `esc_()`/estilo
zebra/banda de color que ya usa el archivo) debajo de la tabla de pedidos existente. Sin
filas, salida idéntica a hoy.

`ConfigEntregas.gs` gana `EMAILS_CARTA_TIENDA`/`EMAILS_CARTA_CC` (mismo patrón hardcodeado
que `EMAILS_PEDIDO_CLIENTE_*`). En `cerrarCarga`: sin palets, destinatarios de hoy sin
cambio; con palets, unión de ambas listas por tienda.

`IntegracionB2B.gs` porta `actualizarB2B` sin cambios de lógica — sigue escribiendo en el
Sheets externo de Leroy Merlin, solo cambia la forma de entrada (filas `palets` en vez de
la lista en memoria de SIE, mismos campos `sscc/encontrado/seccion`).

## 6. Fases

Ver plan de implementación (`C:\Users\30081048\.claude\plans\mellow-hatching-music.md` al
momento de escribir esto, o el historial de la sesión) para el detalle fase por fase
(expandir → migrar piloto → corte completo → contraer aparte). Resumen:

- **Fase 0-1 (aprobada, en curso)**: verificación + tabla `palets` + módulos nuevos
  inertes (`EstructuraPaletes.gs`, `CotejoInventarioSIE.gs`, `IntegracionB2B.gs`). Cero
  cambio de comportamiento — nada existente se toca ni se conecta todavía.
- **Fase 2**: conectar la rama residual + documento combinado, solo en deployment de
  pruebas.
- **Fase 3**: piloto en una tienda+horario, con el UX Zebra completo de SIE portado
  (debounce, foco continuo, modal "sin prisa").
- **Fase 4**: corte completo, incluyendo repuntar el acceso directo de Pedro a la URL
  nueva de HODOS.
- **Contraer** (autorización aparte, no planificada aquí): dar de baja CartaPortesSIE.

**Rollback en cualquier fase**: CartaPortesSIE nunca se modifica ni se detiene durante
expandir/migrar/verificar — volver es solo re-apuntar una URL.

## Riesgos abiertos

- Listas de destinatarios solapadas/divergentes entre `EMAILS_CARTA_*` y
  `EMAILS_PEDIDO_CLIENTE_*` por tienda — revisar antes del piloto (Fase 3).
- Reconsentimiento OAuth por los scopes Drive/Sheets nuevos en `appsscript.json` — resolver
  antes del corte de Fase 4, no durante un turno real.
- Confirmar con Pedro si algo más aparte de CartaPortesSIE lee hoy "Resumen Diario"/"Cartas
  de Portes" antes de dar por completamente sustituible esa lectura por
  `leerPaletesPorTiendaFecha_`.
