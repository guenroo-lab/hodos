# HODOS — Módulo 1: Carga por lote + Generación de etiquetas

**Fecha:** 2026-07-27
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Contexto

Leroy Merlín envía a tienda pedidos cliente sin gasto de envío, que Generix/SIE no puede
procesar ni trazar. HODOS es el sistema paralelo de Taisa Logistics que da esa trazabilidad,
desde el registro del pedido hasta la confirmación de llegada a tienda.

Este documento cubre solo el **primer módulo**: la interfaz donde se registra un lote de
pedidos y se generan sus etiquetas. El resto del flujo (carga de camión con escaneo, panel
del gestor, vista de tiendas, documentación a tiendas, integración con Carta de Portes SIE)
se aborda en fases posteriores — ver "Fuera de alcance" y "Integración futura".

## Alcance del Módulo 1

- Pegar una lista de pedidos (uno por línea)
- Elegir un origen (+ subtipo si es Taisa) y un destino, comunes a todo el lote
- Registrar el lote (persistencia real en Sheet, no una demo efímera)
- Generar una etiqueta por pedido con ID único, código de barras CODE128 y todos los
  campos de la especificación
- Imprimir el lote completo de una vez, en formato 150mm x 100mm para Zebra

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Código de barras | Generado en servidor (GAS), CODE128 propio | Sin dependencia de CDN externo; robusto en el dominio corporativo |
| Orígenes/tiendas | Fijos en código | Módulo 1 más simple y rápido; cambiarlos es un ajuste de código pequeño |
| Formato de ID único | Correlativo `HODOS-000123` | Fácil de leer y decir en voz alta/por radio |
| Número de pedido | **Sin normalizar a 6 dígitos.** 6 dígitos es lo normal, pero no se fuerza ni se valida — se guarda tal cual se pega (solo trim de espacios) | El usuario indicó explícitamente que no debe ser una condición |
| HODOS vs Carta de Portes SIE | Apps independientes, unidas por botones cruzados + carpeta Drive compartida | Evita acoplar dos sistemas grandes que gestionan universos de pedidos distintos (con/sin gasto de envío); no arriesga el envío de email que ya funciona en producción |
| Pedidos repetidos en el mismo lote | Se tratan como varios **soportes** del mismo pedido (no como reenvíos) | El usuario indicó que un pedido puede necesitar más de un soporte/palet; cada línea repetida en la misma lista pegada es un soporte adicional, no una nueva expedición |
| Logo Leroy Merlin en la etiqueta | Pendiente del archivo — el usuario solo ha proporcionado el logo de Taisa | No se fabrica un logo de una marca real sin el archivo oficial; en cuanto se reciba se integra igual que el de Taisa |

## Arquitectura

Proyecto GAS standalone, gestionado con clasp, en `Desktop\Proyectos\hodos` — mismo patrón
que `hub-herramientas` y `lm_produccion`. Vinculado a una Google Sheet nueva ("HODOS -
Pedidos", en Drive) que hace de base de datos. Sin repositorio git (los proyectos hermanos
tampoco lo usan).

### Estructura de archivos

```
hodos/
  appsscript.json
  .clasp.json
  .claspignore
  CLAUDE.md              — reglas del proyecto para sesiones futuras
  EstructuraSheets.gs    — crea/valida la pestaña ETIQUETAS
  Backend.gs             — doGet, registrarLote(), ID correlativo con LockService
  Barcode.gs             — encoder CODE128 (SVG), sin CDN externo
  Index.html             — UI: formulario + grid de etiquetas + selector de tema
  docs/
    superpowers/specs/   — este documento y los siguientes
```

## Modelo de datos — pestaña `ETIQUETAS`

| columna | contenido |
|---|---|
| idUnico | `HODOS-000123` — correlativo, permite reenvíos del mismo pedido |
| numeroPedido | tal cual se pegó (trim de espacios, sin normalizar longitud) |
| soporteNum / soporteTotal | posición y total de soportes de ese pedido **dentro del mismo lote** (ej. 2/3 si el número aparece 3 veces en la lista pegada — no es un reenvío, son varios soportes/palets del mismo pedido) |
| origen | MECO / Valencia / Torija / Antequera / Taisa |
| subtipo | Devolución / Inventario / Demarca / Petición Reserva (vacío si origen ≠ Taisa) |
| origenTexto | texto formateado para etiqueta/barcode, ej. `TAISA - DEVOLUCIÓN` |
| destino | Málaga / Marbella / Mijas / Granada |
| fechaCreacion | timestamp del registro del lote |
| loteId | agrupa las etiquetas registradas juntas (permite reimprimir un lote entero) |
| creadoPor | email de quien registra (`Session.getActiveUser()`) |
| estado | `REGISTRADO` (único valor por ahora) |
| bateaId | **vacío, reservado** — lo rellenará el módulo de carga de camión (fase 3) |
| fechaEnvio | **vacío, reservado** — fecha real de envío, independiente de `fechaCreacion` |

Las dos últimas columnas se reservan ahora para no tener que migrar el esquema más
adelante: la especificación pide explícitamente que creación y envío se reflejen como
momentos independientes, y `fechaEnvio` es también el dato que necesitará la futura
integración con Carta de Portes SIE (el documento "Pedido Cliente" agrupa por fecha de
*llegada* a tienda, no de creación).

## Backend

- **ID único:** `LockService.getScriptLock()` + contador en `PropertiesService`, reserva
  un bloque de N correlativos para todo el lote de una vez (atómico aunque dos personas
  registren a la vez).
- **Código de barras:** encoder CODE128 propio en `Barcode.gs`, genera el SVG de barras
  a partir del número de pedido, sin librería externa.
- **Generación de etiquetas:** el HTML de la hoja de etiquetas se construye **en el
  servidor** (`htmlEtiquetas(loteId)`), no en el cliente. Regla heredada de
  `lm_produccion`: nunca poner literalmente `<style>`/`<script>`/`<!DOCTYPE>` dentro de un
  `<script>` inline servido por HtmlService — rompe la ejecución de JS de toda la página.
- **Flujo de impresión:** `window.open()` síncrono en el clic (evita que el navegador
  bloquee el pop-up), se rellena con placeholder de texto plano, y se completa con el HTML
  generado por el servidor en el `.then()`.

## Frontend

- Reutiliza el layout de la demo validada (formulario a la izquierda, grid de etiquetas a
  la derecha), con mejoras: validación visual de líneas problemáticas, estado de carga
  mientras se registra en el Sheet, historial real (últimos lotes leídos del Sheet, no
  simulado en memoria).
- Tres temas idénticos a la demo — Black Edition (`#080a10` / `#e30613`, por defecto,
  coherente con el resto del ecosistema Taisa), Rojo/Verde vivo, Gris/Blanco —
  seleccionables, con `localStorage` para recordar la preferencia por dispositivo.
- Etiqueta 150mm×100mm: logo Taisa real arriba-izquierda (`logo_taisa.png`), fecha de
  creación + ID único arriba-derecha, tienda destino grande, número de pedido enorme
  centrado, badge "SOPORTE X/Y" debajo del número **solo si `soporteTotal` > 1** (la
  mayoría de pedidos son de un único soporte y no deben mostrar el badge), origen (con
  subtipo si aplica) en rojo debajo, y abajo logo de Leroy Merlin a la izquierda +
  barcode CODE128 (pendiente del archivo del logo LM — se integra en cuanto se reciba).

## Fuera de alcance de este módulo

Escaneo/validación de carga de camión (fase 3), panel en tiempo real para el gestor
(fase 6), vista de solo lectura para tiendas (fase 7), documento "Pedido Cliente" y su
envío junto a la Carta de Portes SIE (fase 5).

## Integración futura con Carta de Portes SIE (acordada, no implementada aún)

Las dos apps permanecen **independientes**. Unión mediante:

1. Botones cruzados con contexto por URL (`?tienda=X&fecha=Y`) para saltar de una app a
   la otra ya posicionado.
2. Una **carpeta de Drive compartida** (ID guardado como constante en ambos proyectos)
   donde HODOS deposita el PDF "Pedido Cliente" del día, generado con la misma técnica
   que ya usa `CartaPortes.gs` (HTML → archivo temporal → `getAs('application/pdf')`).
3. Nombrado consistente con el de Carta de Portes: `PedidoCliente_LM<Tienda>_<fecha>.pdf`.
4. Cambio pequeño y no disruptivo en `CartaPortes.gs`: antes de `MailApp.sendEmail`,
   buscar en la carpeta compartida el archivo esperado y, si existe, añadirlo a
   `mailOpts.attachments` junto al PDF de la carta. Si no existe, se envía igual que hoy.

Sin llamadas en vivo entre scripts (evita problemas de auth/OAuth entre dos webapps del
mismo dominio, ya conocidos en este entorno). Solo dato compartido vía Drive.

## Pendiente detectado (no bloquea este módulo)

Existen **dos copias divergentes** del proyecto Carta de Portes SIE apuntando al mismo
`scriptId`: la oficial en `Desktop\Proyectos\CartadePortesSIE` (con `CLAUDE.md`/`README`/
`docs/`) y una segunda en `Desktop\CartadePortesSIE` (creada 24/07/2026, sin esos
archivos, y con `cartaPortes.html` ya divergido). Habrá que reconciliarlas antes de tocar
`CartaPortes.gs` para la integración de la fase 5.
