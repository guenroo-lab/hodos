# HODOS — Fase 3: Carga de camión (escaneo + validación de destino + informe)

**Fecha:** 2026-07-28
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Depende de:** Módulo 1 (carga por lote + etiquetas) y Cabecera+Buscadores, ya en producción (v12).

## Contexto

Sección 3 de la especificación original: al cargar el camión se escanea el código de
barras de cada soporte, se valida que su destino coincide con la tienda/camión que se
está cargando, y al escanear correctamente el pedido queda marcado como "en ruta" — esto
es la **batea** que luego verán las tiendas en su buscador. Esta fase rellena las
columnas `bateaId`/`fechaEnvio` que el Módulo 1 dejó reservadas vacías.

Además, al cerrar una carga se genera un informe (PDF + email) con el mismo estilo
visual que ya usa `CartaPortes.gs`, y se envía a los mismos destinatarios que la carta de
portes diaria.

## Problema detectado y decisión de diseño

El código de barras de la etiqueta lleva el **número de pedido**, no el ID único —
correcto para que la tienda pueda buscar por número de pedido, pero significa que si un
pedido tiene 3 soportes, sus 3 etiquetas comparten el mismo código de barras. **No se
cambia el barcode** (invalidaría las etiquetas ya impresas y complicaría otros usos) —
en su lugar, cada escaneo de un número de pedido marca **el primer soporte pendiente de
ese pedido y destino, por orden de creación** (FIFO). Esto también resuelve de forma
natural el caso de reenvíos entre lotes distintos (mismo número de pedido, distinto
`idUnico`, registrados en momentos distintos): cada fila de `ETIQUETAS` es una unidad
física independiente que espera exactamente un escaneo, sin importar si la repetición
viene del mismo lote (soporte) o de un lote posterior (reenvío).

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Escaneo | Lector físico (keyboard-wedge) sobre un campo de texto siempre enfocado | Mismo patrón ya validado en `CartaPortes.gs` (hint `.hint-zebra`); más rápido que cámara |
| Entrega del informe | Email automático | Mismo criterio que Carta de Portes SIE — coherencia de ecosistema |
| Identificación de la carga | Destino + fecha + horario de entrega (igual que Carta de Portes: `fechaDescarga` + `horarioCamion`) | El usuario lo pidió explícitamente igual que SIE |
| Destino incorrecto al escanear | Alerta y **no se añade** | Tal cual pide la especificación original |
| Destinatarios del informe | Mismas listas que Carta de Portes por tienda (`EMAILS_CARTA_TIENDA`/`EMAILS_CARTA_CC`) | Reutilizar exactamente lo que ya funciona en producción |
| Horarios de entrega | Desplegable fijo por tienda, igual que `HORARIOS_CAMIONES` de Carta de Portes | El usuario prefiere desplegable a campo libre |

**Huecos de datos pendientes (bloquean solo a Málaga y Granada, no a Marbella/Mijas):**
`EMAILS_CARTA_TIENDA` y `HORARIOS_CAMIONES` en `CartaPortes.gs` **solo tienen configuradas
Marbella y Mijas**. Se copian esas dos tal cual; Málaga y Granada quedan con arrays vacíos
y un comentario `// PENDIENTE: pedir a Pedro` — hasta que el usuario dé esos datos, crear
una carga para esas dos tiendas seguirá funcionando pero el cierre avisará que no hay
destinatarios/horarios configurados en vez de fallar en silencio.

**Aviso de permisos de email:** enviar correo requiere el scope `script.send_mail`, que
necesita consentimiento explícito del usuario. En `lm_produccion` esto no bastó con
añadirlo al manifest — hubo que **quitar el bloque `oauthScopes` para autodetección** y
**revocar el acceso previo del proyecto en `myaccount.google.com/permissions`** antes de
que Google ofreciera la pantalla de consentimiento completa. Se deja preparada
`autorizarYProbarCorreo()` en `Pruebas.gs` para que el usuario ejecute ese proceso de
forma controlada la primera vez; hasta entonces, cerrar una carga genera el PDF en Drive
igualmente, pero el envío de email fallará de forma visible (no silenciosa).

## Modelo de datos — nueva pestaña `CARGAS`

| columna | contenido |
|---|---|
| idCarga | `CARGA-000001` — correlativo (mismo patrón que `idUnico`, contador propio) |
| destino | Málaga / Marbella / Mijas / Granada |
| fechaEntrega | fecha de entrega elegida al crear la carga |
| horario | horario elegido del desplegable fijo por tienda |
| estado | `ABIERTA` / `CERRADA` |
| creadaPor | email de quien abrió la carga |
| fechaCreacion | timestamp de apertura |
| cerradaPor | email de quien cerró la carga (vacío mientras esté abierta) |
| fechaCierre | timestamp de cierre (vacío mientras esté abierta) |
| pdfUrl | URL del PDF del informe (vacío hasta el cierre) |
| emailEnviado | `SI`/`NO` — si el correo se envió correctamente al cerrar |

Al escanear correctamente un soporte, en su fila de `ETIQUETAS` se actualiza:
`estado` → `EN_RUTA`, `bateaId` → `idCarga`, `fechaEnvio` → timestamp del escaneo.

## Backend (nuevos ficheros/funciones)

- **`EstructuraCargas.gs`** — `obtenerHojaCargas()` (mismo patrón que
  `obtenerHojaEtiquetas()`), columnas fijas, cabecera autoreparable.
- **`Utilidades.gs`** (añadir, pura/testeable):
  - `formatearIdCarga(numero)` → `CARGA-000001`.
  - `seleccionarSoporteAEscanear(filas, numeroPedido, destinoCarga)` — la lógica crítica
    de selección FIFO + detección de errores, descrita arriba. Recibe TODAS las filas de
    `ETIQUETAS` que coinciden con ese número de pedido (cualquier destino/estado) y
    devuelve `{ok:true, idUnico}` o `{ok:false, motivo:'NO_ENCONTRADO'|'DESTINO_INCORRECTO'|'YA_ESCANEADO', detalle}`.
- **`Backend.gs`** (añadir):
  - `crearCarga(destino, fechaEntrega, horario)` — reserva `idCarga` con
    `LockService`+`PropertiesService` (mismo patrón que los IDs de etiqueta), crea fila en
    `CARGAS` con estado `ABIERTA`.
  - `listarCargasAbiertas()` — para poder retomar una carga si se recarga la página.
  - `obtenerCarga(idCarga)` — datos de la carga + lista de soportes ya escaneados.
  - `escanearSoporte(idCarga, numeroPedido)` — llama a `seleccionarSoporteAEscanear`,
    actualiza la fila de `ETIQUETAS` si es válido, devuelve el resultado (éxito + qué se
    añadió, o el motivo del rechazo) para que la UI lo muestre.
  - `cerrarCarga(idCarga)` — marca la carga como `CERRADA`, genera el informe (ver
    abajo), guarda el PDF en Drive, envía el email si hay destinatarios configurados para
    esa tienda, y devuelve el resultado (incluye si el email se envió o no y por qué).
- **`ReporteCarga.gs`** (nuevo) — `htmlInformeCarga(idCarga)`: adapta la plantilla visual
  de `buildPDFHtml` de `CartaPortes.gs` (cabecera oscura con logo Taisa, banda de color
  con tienda + fecha/horario, tabla de pedidos con nº de pedido / ID único / origen / hora
  de escaneo, aviso destacado si algo quedó pendiente) al contenido de una carga de HODOS.
  Reutiliza la técnica HTML → archivo temporal en Drive → `getAs('application/pdf')`.
- **`ConfigEntregas.gs`** (nuevo) — `EMAILS_PEDIDO_CLIENTE_TIENDA` (Marbella/Mijas
  copiadas de `CartaPortes.gs`; Málaga/Granada vacías y marcadas `PENDIENTE`),
  `EMAILS_PEDIDO_CLIENTE_CC` (misma lista de plataforma), `HORARIOS_ENTREGA_TIENDA`
  (misma estructura, mismo hueco pendiente).

## Frontend

Nueva entrada "Cargar camión" en el sidebar (junto a Cargar lote / Buscar), con 3 pasos
en la misma pantalla:

1. **Crear carga**: selects de destino + fecha + horario (deshabilitado/con aviso si esa
   tienda no tiene horarios configurados todavía) → botón "Abrir carga".
2. **Escanear**: campo de texto siempre enfocado (igual que el hint `.hint-zebra` de
   Carta de Portes) donde cada lectura del lector añade un pedido; lista en vivo de lo
   escaneado hasta ahora; alerta roja inmediata y sonora (si el navegador lo permite) si
   el destino no coincide, si no se encuentra, o si ya estaba escaneado.
3. **Cerrar carga**: botón que llama a `cerrarCarga`, muestra el resumen (cuántos
   soportes, si el email se envió) y un enlace al PDF en Drive.

Mismos 3 temas, mismo shell responsive ya existente.

## Fuera de alcance de esta fase

Panel en tiempo real para el gestor (fase 6), vista de solo lectura para tiendas ya
existe (Cabecera+Buscadores) pero su columna "Batea" ya queda automáticamente rellena por
esta fase sin tocar esa vista. Documento "Pedido Cliente" adjunto a la Carta de Portes
SIE vía carpeta Drive compartida (fase 5, distinto de este informe de cierre de carga)
sigue pendiente — este informe es el de **cierre de carga de HODOS**, no el que se
adjunta al email de Carta de Portes SIE.
