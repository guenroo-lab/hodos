# Integración INCPC → HODOS (generación automática de etiquetas)

## Contexto

INCPC (`C:\Users\30081048\Desktop\Proyectos\INCPC`) es la app de incidencias/devoluciones de pedido cliente que usan los operarios de Taisa Málaga. Todo lo que registran (incidencias y devoluciones) cae en la hoja **"Incidencias"** del spreadsheet `1AWfwBTcYxqqJQEnDjjir_LshBaMFTDGNu3LSSbNJEd8`, filas desde la 3, la más nueva siempre arriba (`insertRowBefore(3)`).

Cuando alguien revisa una fila y decide que esa incidencia/devolución debe generar una etiqueta física para el camión, hoy no hay ningún puente: hay que ir a HODOS y registrarla a mano. Esta integración automatiza ese paso.

## Disparador

En la hoja "Incidencias":

- **Columna M** — Sí/No (desplegable con validación cuando la fila es una devolución; en incidencias es una celda libre donde también se puede escribir "sí" a mano).
- **Columna N** — checkbox (ya existe; hoy solo colorea la fila A:N en verde/blanco vía el `onEdit(e)` simple actual — eso no cambia).

**Condición de disparo:** N = marcado **y** M coincide con "sí" en cualquier variante (mayúsculas/minúsculas/con o sin acento/espacios — `si`, `Si`, `SÍ`, `sí `, etc.). Se evalúa tanto si el usuario toca N como si toca M (cualquiera de las dos ediciones puede completar la condición). Aplica a **cualquier fila** de la hoja, sea incidencia o devolución.

## Mapeo de columnas

| INCPC | Contenido real (verificado en código) | Destino en HODOS |
|---|---|---|
| B | Tienda/Batea: `Malaga 1`, `Malaga 2`, `Malaga Sabado`, `Marbella`, `Granada`, `Mijas` (variantes "Malaga N" solo posibles en el formulario de incidencias; devoluciones solo ofrece `Malaga` a secas) | `destino` — normalizado: cualquier valor cuya forma sin acentos/mayúsculas empiece por `malaga` → `Málaga`; el resto por coincidencia exacta normalizada contra `Marbella`/`Granada`/`Mijas` |
| E | Nº de pedido | `numeroPedido` (se registra vía el mismo `registrarLote` que usa el alta manual, así que hereda el mismo formateo/validación) |
| H | Tipo de incidencia (10 opciones fijas) o tipo de devolución (8 opciones fijas) — texto libre en la celda, sin lista cerrada en servidor | `subtipo`, con `origen = 'Taisa'` |
| F | LM/EAN | `contenido[].descripcion` (vía `guardarContenidoSoporte`, igual que el contenido opcional manual existente) |
| G | Unidades | `contenido[].cantidad` |

La etiqueta se crea **siempre nueva** (nunca se intenta enganchar a una etiqueta existente del mismo pedido) — es el mismo comportamiento que ya tiene HODOS para reenvíos/repeticiones del mismo número de pedido.

## Subtipo dinámico

`subtipoEfectivo()` en `Utilidades.gs` ya acepta cualquier texto cuando `origen === 'Taisa'` — no hay lista cerrada en servidor. La única lista cerrada hoy es `OPCIONES_SUBTIPO_`, hardcodeada en `Index.html` para los desplegables manuales (alta y edición admin).

Cambio: `OPCIONES_SUBTIPO_` deja de ser solo la lista hardcodeada y pasa a ser **lista base + subtipos distintos ya existentes en Supabase** (consulta de valores únicos de `subtipo` donde `origen = 'Taisa'`), calculada al cargar la vista admin/registro. Así, en cuanto INCPC crea la primera etiqueta con un tipo nuevo (ej. "Rotura transportista"), ese valor queda disponible como opción seleccionable sin tocar código.

## Arquitectura técnica

```
INCPC (Código.js)                          HODOS (Backend.gs)
─────────────────                          ──────────────────
Trigger instalable onEdit
(nuevo, NO toca el onEdit simple
actual que colorea filas)
        │
        │ N=✓ y M="sí" → lee fila completa
        ▼
UrlFetchApp.fetch(HODOS_WEBAPP_URL + '?accion=incpc',
  { method:'post',
    payload: JSON.stringify({token, destino, pedido,
                              tipo, referencia, cantidad, operario}) })
        │                                          │
        └──────────────────────────────────────────▶ doPost(e)
                                                     valida token (Script Properties,
                                                     no en código)
                                                          │
                                                          ▼
                                            normaliza destino (col B)
                                            llama registrarLote(...) con
                                              origen='Taisa', subtipo=<tipo>,
                                              destino normalizado,
                                              pedidosTexto=<pedido>
                                                          │
                                                          ▼
                                            guardarContenidoSoporte(idUnico,
                                              [{descripcion:<F>, cantidad:<G>}])
                                            (creadoPor de la etiqueta se fija a
                                            'INCPC · <operario col.D>', no al email
                                            de sesión — la llamada es servidor-a-
                                            servidor, sin usuario de Google logueado)
                                                          │
                                                          ▼
                                            UPDATE etiquetas SET
                                              pendiente_impresion_incpc = true
                                              WHERE id_unico = <idUnico>
                                                          │
                                            responde { ok:true, idUnico }
        ┌──────────────────────────────────────────┘
        ▼
Escribe idUnico en columna O de esa fila
("HODOS ID" — nueva cabecera)
```

**Por qué un trigger instalable aparte:** el `onEdit(e)` simple que ya existe en INCPC no puede hacer llamadas de red (restricción de Google Apps Script para triggers simples — no tienen autorización completa). Se añade un trigger instalable (`ScriptApp.newTrigger(...).onEdit().create()`, configurado una vez) dedicado solo a esta automatización.

**Autenticación:** token compartido guardado en Propiedades del Script de ambos proyectos (`PropertiesService.getScriptProperties()`), nunca en el código fuente. HODOS rechaza cualquier petición sin el token correcto.

**Idempotencia / evitar duplicados:** antes de llamar a HODOS, el trigger comprueba si la columna O de esa fila ya tiene un valor. Si ya tiene un `idUnico`, no vuelve a crear nada (protege contra desmarcar/remarcar N, o editar M varias veces).

**Manejo de errores:** si la llamada a HODOS falla (sin red, HODOS caído, token inválido), la columna O se queda vacía — la fila queda "pendiente" de forma visible, y basta con volver a tocar N o M para reintentar. No se guarda ningún estado de error en la hoja (mantenerlo simple: la ausencia de valor en O ya es la señal).

## Pestaña nueva "INCPC" en HODOS

- Campo nuevo en la tabla `etiquetas` de Supabase: `pendiente_impresion_incpc boolean default false`.
- Nueva vista `?vista=incpc` en `Index.html`, mismo nivel de acceso que el Buscador Interno (uso interno/gestor, no visible para tiendas).
- Lista todas las etiquetas con `pendiente_impresion_incpc = true`: pedido, destino, subtipo, contenido (referencia + cantidad), fecha de creación.
- Un único botón **"Imprimir todas"**: genera el HTML de todas las etiquetas pendientes con el mismo formato físico Zebra (15×10 cm + código de barras CODE128) que ya usa el resto de HODOS (`htmlUnaEtiqueta_` / `envolverEtiquetasHtml_`, reutilizados sin cambios), y en la misma acción limpia el flag (`pendiente_impresion_incpc = false`) de todas las que se acaban de imprimir.
- Tras imprimir, esas etiquetas desaparecen de la pestaña "INCPC" pero siguen existiendo como cualquier otra etiqueta normal: visibles en Búsqueda/Pendientes, reimprimibles individualmente desde el Buscador Interno como ya es posible hoy.

La columna O (hoy libre) recibe la cabecera **"HODOS ID"** en las filas 1-2 de encabezado, junto al resto.

## Fuera de alcance

- No se modifica el flujo de carga de camión, el cierre de carga, ni ningún otro subtipo/origen existente.
- No se añade validación de que el pedido de INCPC exista en ningún sistema externo (Generix/SIE) — se registra tal cual venga en la columna E, igual que hace hoy el alta manual.
- No se toca el `onEdit(e)` simple existente de INCPC (coloreado de filas) ni las columnas L, R, S.
