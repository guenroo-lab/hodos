# Integración INCPC → HODOS — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando en INCPC (hoja "Incidencias") se marca el check de la columna N con la columna M en "sí" (cualquier variante), se crea automáticamente una etiqueta en HODOS (origen Taisa, destino/pedido/subtipo/contenido mapeados desde la fila), visible en una pestaña nueva "INCPC" para imprimir en lote; al imprimir, desaparece de esa pestaña y pasa a comportarse como cualquier etiqueta normal.

**Architecture:** Trigger instalable `onEdit` en INCPC (Código.js) llama, vía `UrlFetchApp` con un token compartido, a un `doPost` nuevo en el Web App de HODOS (Backend.gs) que reutiliza `registrarLote`/`guardarContenidoSoporte` y marca la etiqueta con un flag `pendiente_impresion_incpc` en Supabase. Una vista nueva `?vista=incpc` en HODOS lista y permite imprimir en lote esas etiquetas, limpiando el flag al imprimir.

**Tech Stack:** Google Apps Script (V8), HTML/JS vanilla, Supabase (Postgres/PostgREST), clasp CLI. Sin git en ninguno de los dos proyectos (convención ya establecida) — el "commit" de cada tarea es `clasp push -f`.

**Spec de referencia:** [`docs/superpowers/specs/2026-08-05-integracion-incpc-hodos-design.md`](../specs/2026-08-05-integracion-incpc-hodos-design.md)

**Proyectos involucrados:**
- HODOS: `C:\Users\30081048\Desktop\Proyectos\hodos` (deployment producción: `AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ`, URL `https://script.google.com/macros/s/AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ/exec`)
- INCPC: `C:\Users\30081048\Desktop\Proyectos\INCPC` (script contenedor de la hoja "Incidencias" — las automatizaciones de trigger no necesitan deployment, solo `clasp push -f`)

**Autenticación entre proyectos:** en vez de abrir un segundo deployment público, INCPC llama al Web App de HODOS (que sigue restringido a `DOMAIN`) adjuntando `Authorization: Bearer <ScriptApp.getOAuthToken()>` — un token OAuth válido de un usuario del mismo dominio Google Workspace autentica la petición igual que una sesión de navegador. Así no se abre ningún acceso público nuevo ni se toca el deployment que ya usan los operarios. Sobre eso, una capa adicional de aplicación: un token compartido de 43 caracteres en el cuerpo de la petición, guardado en Propiedades del Script de ambos proyectos (nunca en código):

```
z0VyOXrMXB4x41FOt8M85xAA3WWsoeZHDummzNs7VY
```

Si en la verificación final (Task 13) la respuesta que INCPC recibe no es JSON limpio sino HTML de login de Google, es que el bearer token OAuth no fue aceptado — en ese caso, contingencia documentada en Task 13.

---

### Task 1: Supabase — columna `pendiente_impresion_incpc` (PASO MANUAL, lo ejecuta el usuario)

**Por qué es manual:** Apps Script/PostgREST no pueden ejecutar DDL (`ALTER TABLE`). Mismo proceso ya usado para añadir `razon_flujo` en v32 (ver `CLAUDE.md` líneas 405-410): el SQL se pega a mano en el SQL Editor de Supabase, **antes** de desplegar cualquier código que dependa de la columna nueva — si el código empezara a mandar esa clave antes de que exista la columna, rompería todos los inserts, no solo los de INCPC.

- [ ] **Paso 1: el usuario ejecuta este SQL en el SQL Editor de Supabase del proyecto HODOS** (`https://supabase.com/dashboard/project/dbxlrnupiwemnarlxmcv/sql/new` — confirmar que el project ref sigue siendo `dbxlrnupiwemnarlxmcv`; si ha cambiado, usar el que corresponda)

```sql
alter table etiquetas
  add column pendiente_impresion_incpc boolean not null default false;
```

Resultado esperado: "Success. No rows returned".

- [ ] **Paso 2: verificar la columna existe**

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'etiquetas' and column_name = 'pendiente_impresion_incpc';
```

Resultado esperado: una fila, `data_type = boolean`, `column_default = false`.

No continuar con el Task 2 hasta confirmar que este paso está hecho.

---

### Task 2: HODOS — `EstructuraSheets.gs`: mapeo del flag + `supaGet_` con columnas opcionales + subtipo dinámico

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\SupabaseCliente.gs:24-30`
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\EstructuraSheets.gs` (líneas 3-22, 24-43)
- Test: `C:\Users\30081048\Desktop\Proyectos\hodos\test\estructura-sheets.test.js` (nuevo)

- [ ] **Step 1: escribir el test que falla (mapeo del campo nuevo)**

Crear `C:\Users\30081048\Desktop\Proyectos\hodos\test\estructura-sheets.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGs(nombre) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

test('filaEtiquetaDesdeSupabase_ mapea pendiente_impresion_incpc -> pendienteImpresionIncpc', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const fila = { id_unico: 'HODOS-000001', pendiente_impresion_incpc: true };
  assert.strictEqual(ctx.filaEtiquetaDesdeSupabase_(fila).pendienteImpresionIncpc, true);
});

test('filaEtiquetaHaciaSupabase_ mapea pendienteImpresionIncpc -> pendiente_impresion_incpc', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const obj = { idUnico: 'HODOS-000001', pendienteImpresionIncpc: false };
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_(obj).pendiente_impresion_incpc, false);
});

test('filaEtiquetaHaciaSupabase_ omite pendiente_impresion_incpc si no viene en el objeto', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const obj = { idUnico: 'HODOS-000001' };
  assert.strictEqual('pendiente_impresion_incpc' in ctx.filaEtiquetaHaciaSupabase_(obj), false);
});
```

- [ ] **Step 2: ejecutar y confirmar que falla**

Run: `node --test test/estructura-sheets.test.js`
Expected: FAIL — `pendienteImpresionIncpc` es `undefined`, no `true`/`false`.

- [ ] **Step 3: añadir el campo a los dos mappers**

En `EstructuraSheets.gs`, `filaEtiquetaDesdeSupabase_` (líneas 3-22) — añadir tras la línea `razonFlujo: f.razon_flujo`:

```javascript
function filaEtiquetaDesdeSupabase_(f) {
  return {
    idUnico: f.id_unico,
    numeroPedido: f.numero_pedido,
    soporteNum: f.soporte_num,
    soporteTotal: f.soporte_total,
    origen: f.origen,
    subtipo: f.subtipo,
    origenTexto: f.origen_texto,
    destino: f.destino,
    fechaCreacion: f.fecha_creacion,
    loteId: f.lote_id,
    creadoPor: f.creado_por,
    estado: f.estado,
    bateaId: f.batea_id,
    fechaEnvio: f.fecha_envio,
    origenTienda: f.origen_tienda,
    razonFlujo: f.razon_flujo,
    pendienteImpresionIncpc: f.pendiente_impresion_incpc
  };
}
```

Y en `filaEtiquetaHaciaSupabase_` (líneas 24-43) — añadir tras la línea `if (obj.razonFlujo !== undefined) fila.razon_flujo = obj.razonFlujo;`:

```javascript
function filaEtiquetaHaciaSupabase_(obj) {
  var fila = {};
  if (obj.idUnico !== undefined) fila.id_unico = obj.idUnico;
  if (obj.numeroPedido !== undefined) fila.numero_pedido = obj.numeroPedido;
  if (obj.soporteNum !== undefined) fila.soporte_num = obj.soporteNum;
  if (obj.soporteTotal !== undefined) fila.soporte_total = obj.soporteTotal;
  if (obj.origen !== undefined) fila.origen = obj.origen;
  if (obj.subtipo !== undefined) fila.subtipo = obj.subtipo;
  if (obj.origenTexto !== undefined) fila.origen_texto = obj.origenTexto;
  if (obj.destino !== undefined) fila.destino = obj.destino;
  if (obj.fechaCreacion !== undefined) fila.fecha_creacion = obj.fechaCreacion;
  if (obj.loteId !== undefined) fila.lote_id = obj.loteId;
  if (obj.creadoPor !== undefined) fila.creado_por = obj.creadoPor;
  if (obj.estado !== undefined) fila.estado = obj.estado;
  if (obj.bateaId !== undefined) fila.batea_id = obj.bateaId;
  if (obj.fechaEnvio !== undefined) fila.fecha_envio = obj.fechaEnvio;
  if (obj.origenTienda !== undefined) fila.origen_tienda = obj.origenTienda;
  if (obj.razonFlujo !== undefined) fila.razon_flujo = obj.razonFlujo;
  if (obj.pendienteImpresionIncpc !== undefined) fila.pendiente_impresion_incpc = obj.pendienteImpresionIncpc;
  return fila;
}
```

- [ ] **Step 4: ejecutar y confirmar que pasa**

Run: `node --test test/estructura-sheets.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: `supaGet_` acepta columnas opcionales (sin romper los 4 callers existentes)**

En `SupabaseCliente.gs`, reemplazar (líneas 24-30):

```javascript
function supaGet_(tabla, filtroPostgrest) {
  var cfg = supaConfig_();
  var url = cfg.url + '/rest/v1/' + tabla + '?select=*' + (filtroPostgrest ? '&' + filtroPostgrest : '');
  var resp = UrlFetchApp.fetch(url, { method: 'get', headers: supaCabeceras_(), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
```

por:

```javascript
function supaGet_(tabla, filtroPostgrest, columnas) {
  var cfg = supaConfig_();
  var url = cfg.url + '/rest/v1/' + tabla + '?select=' + (columnas || '*') + (filtroPostgrest ? '&' + filtroPostgrest : '');
  var resp = UrlFetchApp.fetch(url, { method: 'get', headers: supaCabeceras_(), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
```

Los 4 callers existentes (`Pruebas.gs:273`, `EstructuraCargas.gs:41`, `EstructuraContenido.gs:17`, `EstructuraSheets.gs:46`) llaman con 2 argumentos — `columnas` queda `undefined` y cae al `|| '*'`, comportamiento idéntico a hoy.

- [ ] **Step 6: subtipo dinámico — `obtenerSubtiposConocidos()`**

Añadir al final de `EstructuraSheets.gs`:

```javascript
var OPCIONES_SUBTIPO_BASE_ = ['Devolución', 'Inventario', 'Demarca', 'Petición Reserva', 'Sobrante', 'Ean Erroneo', 'Anulado', 'Rotura', 'Pedido cliente'];

function obtenerSubtiposConocidos() {
  var filas = supaGet_('etiquetas', 'origen=eq.Taisa&subtipo=not.is.null', 'subtipo');
  var vistos = {};
  var todos = OPCIONES_SUBTIPO_BASE_.slice();
  filas.forEach(function (f) {
    var s = f.subtipo;
    if (s && !vistos[s] && todos.indexOf(s) === -1) {
      vistos[s] = true;
      todos.push(s);
    }
  });
  return todos;
}
```

- [ ] **Step 7: correr toda la suite de tests del proyecto**

Run: `node --test`
Expected: todos los tests existentes (110+) siguen en PASS, más los 3 nuevos.

- [ ] **Step 8: push**

```bash
clasp push -f
```

---

### Task 3: HODOS — `Backend.gs`: `registrarLote`/`guardarContenidoSoporte` aceptan `creadoPor` explícito

**Por qué:** ambas funciones usan `Session.getActiveUser().getEmail()` incondicionalmente — en una llamada servidor-a-servidor desde `doPost` (sin usuario de Google interactivo) eso da cadena vacía y cae a `'desconocido'`. Necesitamos que quede constancia de que la etiqueta vino de INCPC.

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\Backend.gs:42, 71`

- [ ] **Step 1: `registrarLote` — línea 42**

Reemplazar:
```javascript
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
```
por:
```javascript
  var creadoPor = datos.creadoPor || (Session.getActiveUser().getEmail() || 'desconocido');
```

- [ ] **Step 2: `guardarContenidoSoporte` — línea 66 y 71**

Reemplazar:
```javascript
function guardarContenidoSoporte(idUnico, items) {
  if (!idUnico) throw new Error('Falta el idUnico');
  var lineas = prepararLineasContenido(items);
  borrarContenidoPorIdUnico_(idUnico);
  if (lineas.length === 0) return { idUnico: idUnico, cantidad: 0 };
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
  insertarContenido_(idUnico, lineas, creadoPor);
  return { idUnico: idUnico, cantidad: lineas.length };
}
```
por:
```javascript
function guardarContenidoSoporte(idUnico, items, creadoPorOverride) {
  if (!idUnico) throw new Error('Falta el idUnico');
  var lineas = prepararLineasContenido(items);
  borrarContenidoPorIdUnico_(idUnico);
  if (lineas.length === 0) return { idUnico: idUnico, cantidad: 0 };
  var creadoPor = creadoPorOverride || (Session.getActiveUser().getEmail() || 'desconocido');
  insertarContenido_(idUnico, lineas, creadoPor);
  return { idUnico: idUnico, cantidad: lineas.length };
}
```

Ambos cambios son compatibles hacia atrás: ningún caller existente (Index.html, Pruebas.gs) pasa `datos.creadoPor` ni un 3er argumento, así que su comportamiento no cambia.

- [ ] **Step 3: correr los tests (no hay test unitario específico de esto — Session/PropertiesService no son testeables en Node; se verifica en el smoke test de Task 8)**

Run: `node --test`
Expected: sigue en PASS (regresión, ningún test debería verse afectado).

- [ ] **Step 4: push**

```bash
clasp push -f
```

---

### Task 4: HODOS — nuevo archivo `IntegracionIncpc.gs`

**Files:**
- Create: `C:\Users\30081048\Desktop\Proyectos\hodos\IntegracionIncpc.gs`
- Test: `C:\Users\30081048\Desktop\Proyectos\hodos\test\integracion-incpc.test.js` (nuevo)

- [ ] **Step 1: escribir el test que falla (normalización de destino, la única lógica pura de este archivo)**

Crear `C:\Users\30081048\Desktop\Proyectos\hodos\test\integracion-incpc.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGs(nombre) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

test('normalizarDestinoIncpc_ colapsa variantes de Malaga a Málaga', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga 1'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga 2'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga Sabado'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('MALAGA'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('málaga'), 'Málaga');
});

test('normalizarDestinoIncpc_ reconoce Marbella/Granada/Mijas sin importar mayúsculas', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('marbella'), 'Marbella');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('GRANADA'), 'Granada');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(' Mijas '), 'Mijas');
});

test('normalizarDestinoIncpc_ devuelve cadena vacía si no reconoce el valor', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Sevilla'), '');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(''), '');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(undefined), '');
});
```

- [ ] **Step 2: ejecutar y confirmar que falla**

Run: `node --test test/integracion-incpc.test.js`
Expected: FAIL — el archivo `IntegracionIncpc.gs` no existe todavía.

- [ ] **Step 3: crear `IntegracionIncpc.gs` completo**

```javascript
// IntegracionIncpc.gs — recibe peticiones del proyecto INCPC (Taisa Málaga,
// C:\Users\30081048\Desktop\Proyectos\INCPC) para crear etiquetas HODOS
// automáticamente a partir de incidencias/devoluciones marcadas para envío.
// Ver docs/superpowers/specs/2026-08-05-integracion-incpc-hodos-design.md.

function doPost(e) {
  var respuesta;
  try {
    var datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
    if (!tokenEsperado || datos.token !== tokenEsperado) {
      respuesta = { ok: false, error: 'Token inválido' };
    } else {
      var idUnico = crearEtiquetaDesdeIncpc_(datos);
      respuesta = { ok: true, idUnico: idUnico };
    }
  } catch (err) {
    respuesta = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

function crearEtiquetaDesdeIncpc_(datos) {
  var destino = normalizarDestinoIncpc_(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  if (!datos.pedido) throw new Error('Falta el número de pedido');
  if (!datos.tipo) throw new Error('Falta el tipo de incidencia');

  var creadoPor = 'INCPC · ' + (datos.operario || 'desconocido');

  var resultado = registrarLote({
    origen: 'Taisa',
    subtipo: String(datos.tipo).trim(),
    destino: destino,
    pedidosTexto: String(datos.pedido).trim(),
    creadoPor: creadoPor
  });
  var idUnico = resultado.ids[0];

  var referencia = String(datos.referencia || '').trim();
  if (referencia) {
    guardarContenidoSoporte(idUnico, [{ descripcion: referencia, cantidad: Number(datos.cantidad) || 0 }], creadoPor);
  }

  actualizarEtiquetaCondicional_(idUnico, { pendienteImpresionIncpc: true });

  return idUnico;
}

// Normaliza el valor bruto de la columna "Tienda/Batea" de INCPC (que puede llegar
// como "Malaga 1", "Malaga Sabado", con o sin acentos/mayúsculas) a una de las 4
// tiendas válidas de HODOS. Cualquier variante que empiece por "malaga" colapsa a
// "Málaga" (deliberado: en INCPC, Málaga tiene varias bateas/turnos, pero en HODOS
// solo existe una tienda Málaga). Devuelve '' si no reconoce el valor.
function normalizarDestinoIncpc_(valorBruto) {
  var limpio = String(valorBruto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  if (limpio.indexOf('malaga') === 0) return 'Málaga';
  if (limpio === 'marbella') return 'Marbella';
  if (limpio === 'granada') return 'Granada';
  if (limpio === 'mijas') return 'Mijas';
  return '';
}

// ── Pestaña "INCPC" en Index.html: etiquetas creadas por esta integración,
// pendientes de imprimirse en lote. ──

function obtenerEtiquetasPendientesIncpc() {
  var filas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&order=fecha_creacion.asc');
  var mapaContenido = obtenerMapaContenido_();
  return filas.map(function (f) {
    return {
      idUnico: f.idUnico, numeroPedido: f.numeroPedido, origen: f.origen, subtipo: f.subtipo,
      origenTexto: f.origenTexto, destino: f.destino, fechaCreacion: fechaComoTexto(f.fechaCreacion),
      contenido: mapaContenido[f.idUnico] || []
    };
  });
}

function htmlPendientesIncpc() {
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de INCPC pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasIncpc() {
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true', { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}
```

- [ ] **Step 4: ejecutar y confirmar que pasa**

Run: `node --test test/integracion-incpc.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: correr toda la suite**

Run: `node --test`
Expected: todos en PASS.

- [ ] **Step 6: push**

```bash
clasp push -f
```

---

### Task 5: HODOS — `Utilidades.gs`: registrar la vista `incpc`

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\Utilidades.gs:63`
- Test: `C:\Users\30081048\Desktop\Proyectos\hodos\test\utilidades.test.js`

- [ ] **Step 1: escribir el test que falla**

Añadir a `test/utilidades.test.js`:

```javascript
test('validarVista acepta "incpc"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarVista('incpc'), 'incpc');
});
```

- [ ] **Step 2: confirmar que falla**

Run: `node --test test/utilidades.test.js`
Expected: FAIL — `validarVista('incpc')` devuelve `'carga'` (no está en la lista).

- [ ] **Step 3: añadir 'incpc' a la lista**

Reemplazar (línea 63):
```javascript
var VISTAS_VALIDAS = ['carga', 'interno', 'tienda', 'operario'];
```
por:
```javascript
var VISTAS_VALIDAS = ['carga', 'interno', 'tienda', 'operario', 'incpc'];
```

- [ ] **Step 4: confirmar que pasa**

Run: `node --test test/utilidades.test.js`
Expected: PASS.

- [ ] **Step 5: push**

```bash
clasp push -f
```

---

### Task 6: HODOS — `Index.html`: nueva pestaña "INCPC"

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\Index.html` (nav ~línea 285-299, contenedor tras vistaInterno ~línea 439, `cambiarPestana` líneas 1485-1495, `iniciarVista` líneas 1518-1547)

- [ ] **Step 1: añadir el botón de navegación**

En el `<nav id="tabBar">` (líneas 285-299), justo antes del `</nav>` de cierre (tras el botón `data-tab="pendientes"`), añadir:

```html
    <button data-tab="incpc" onclick="cambiarPestana('incpc')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <span>INCPC</span>
    </button>
```

- [ ] **Step 2: añadir el contenedor de la vista**

Inmediatamente después del `</div>` que cierra `<div id="vistaInterno">` (tras la línea 439), añadir:

```html
<!-- ══════════ VISTA: INCPC (pendientes de imprimir) ══════════ -->
<div id="vistaIncpc" class="vista-oculta">
  <div class="busqueda-form">
    <span id="contadorIncpc" class="hint-texto">Cargando…</span>
    <button type="button" class="btn-imprimir" id="btnImprimirIncpc" onclick="imprimirTodasIncpc_()" disabled>
      Imprimir todas
    </button>
  </div>
  <div class="resultados-wrap"><div id="resultadosIncpc"></div></div>
</div>
```

- [ ] **Step 3: `cambiarPestana` — añadir el toggle e inicialización**

Reemplazar (líneas 1485-1495):
```javascript
function cambiarPestana(nombre) {
  // "camion" ya no vive en el panel de administración (tiene su propia URL
  // ?vista=operario, sin sidebar) — aquí solo quedan carga/interno/pendientes.
  document.getElementById('vistaCarga').classList.toggle('vista-oculta', nombre !== 'carga');
  document.getElementById('vistaInterno').classList.toggle('vista-oculta', nombre !== 'interno');
  document.getElementById('vistaPendientes').classList.toggle('vista-oculta', nombre !== 'pendientes');
  document.querySelectorAll('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nombre); });
  if (nombre === 'interno') { buscarYMostrar('interno'); }
  if (nombre === 'carga') { cargarHistorial(); }
  if (nombre === 'pendientes') { cargarPendientes_(); }
}
```
por:
```javascript
function cambiarPestana(nombre) {
  // "camion" ya no vive en el panel de administración (tiene su propia URL
  // ?vista=operario, sin sidebar) — aquí solo quedan carga/interno/pendientes/incpc.
  document.getElementById('vistaCarga').classList.toggle('vista-oculta', nombre !== 'carga');
  document.getElementById('vistaInterno').classList.toggle('vista-oculta', nombre !== 'interno');
  document.getElementById('vistaPendientes').classList.toggle('vista-oculta', nombre !== 'pendientes');
  document.getElementById('vistaIncpc').classList.toggle('vista-oculta', nombre !== 'incpc');
  document.querySelectorAll('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nombre); });
  if (nombre === 'interno') { buscarYMostrar('interno'); }
  if (nombre === 'carga') { cargarHistorial(); }
  if (nombre === 'pendientes') { cargarPendientes_(); }
  if (nombre === 'incpc') { cargarIncpc_(); }
}
```

- [ ] **Step 4: `iniciarVista` — permitir `?vista=incpc` directo por URL**

Dentro de `iniciarVista()` (líneas 1518-1547), reemplazar el bloque `else` final:
```javascript
  } else {
    document.getElementById('vistaCamion').classList.add('vista-oculta');
    cambiarPestana(VISTA === 'interno' ? 'interno' : 'carga');
  }
```
por:
```javascript
  } else {
    document.getElementById('vistaCamion').classList.add('vista-oculta');
    if (VISTA === 'interno') { cambiarPestana('interno'); }
    else if (VISTA === 'incpc') { cambiarPestana('incpc'); }
    else { cambiarPestana('carga'); }
  }
```

- [ ] **Step 5: funciones de carga/renderizado/impresión — añadir junto a `cargarPendientes_`**

```javascript
function cargarIncpc_() {
  document.getElementById('resultadosIncpc').innerHTML = '<p class="cargando-resultados">Cargando…</p>';
  gas('obtenerEtiquetasPendientesIncpc').then(function (filas) {
    renderizarResultadosIncpc_(filas);
  }).catch(function (err) {
    document.getElementById('resultadosIncpc').innerHTML =
      '<p class="sin-resultados" style="color:var(--color-error);">Error al cargar: ' + (err && err.message ? err.message : err) + '</p>';
  });
}

function renderizarResultadosIncpc_(filas) {
  var cont = document.getElementById('resultadosIncpc');
  document.getElementById('btnImprimirIncpc').disabled = !filas || filas.length === 0;
  document.getElementById('contadorIncpc').textContent =
    (filas ? filas.length : 0) + ' etiqueta(s) de INCPC pendiente(s) de imprimir';
  if (!filas || filas.length === 0) {
    cont.innerHTML = '<p class="sin-resultados">No hay etiquetas de INCPC pendientes de imprimir.</p>';
    return;
  }
  var filasHtml = filas.map(function (f) {
    var contenido = (f.contenido && f.contenido.length > 0)
      ? f.contenido.map(function (c) { return c.cantidad + 'x ' + c.descripcion; }).join(', ')
      : '—';
    return '<tr>' +
      '<td data-label="Nº Pedido">' + f.numeroPedido + '</td>' +
      '<td data-label="Destino">' + f.destino + '</td>' +
      '<td data-label="Origen">' + f.origenTexto + '</td>' +
      '<td data-label="Contenido">' + contenido + '</td>' +
      '<td data-label="Creado">' + formatearFecha(f.fechaCreacion) + '</td>' +
      '<td data-label="ID único">' + f.idUnico + '</td>' +
      '</tr>';
  }).join('');
  cont.innerHTML = '<table class="resultados-tabla"><thead><tr>' +
    '<th>Nº Pedido</th><th>Destino</th><th>Origen</th><th>Contenido</th><th>Creado</th><th>ID único</th>' +
    '</tr></thead><tbody>' + filasHtml + '</tbody></table>';
}

function imprimirTodasIncpc_() {
  gas('htmlPendientesIncpc').then(function (html) {
    imprimirHtmlEtiquetas_(Promise.resolve(html));
    return gas('marcarImpresasIncpc');
  }).then(function () {
    cargarIncpc_();
  }).catch(function (err) {
    alert('Error al imprimir: ' + (err && err.message ? err.message : err));
  });
}
```

- [ ] **Step 6: verificación manual en navegador (no hay test automático para HTML/JS de cliente en este proyecto)**

No aplica `node --test` a este Task — Index.html no tiene arnés de test de UI. La verificación real ocurre en el Task 13 (checklist end-to-end).

- [ ] **Step 7: push**

```bash
clasp push -f
```

---

### Task 7: HODOS — `Index.html`: subtipo dinámico en los desplegables

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\Index.html` (líneas ~997, y tras `iniciarVista();` ~línea 1549)

- [ ] **Step 1: sincronizar el `<select id="subtipoTaisa">` con la lista que llegue del servidor**

Añadir esta función junto a `opcionesSelect_` (línea ~1001-1005):

```javascript
function sincronizarSelectSubtipoTaisa_() {
  var select = document.getElementById('subtipoTaisa');
  if (!select) return;
  var existentes = Array.prototype.map.call(select.options, function (o) { return o.value; });
  OPCIONES_SUBTIPO_.forEach(function (valor) {
    if (existentes.indexOf(valor) === -1) {
      var opt = document.createElement('option');
      opt.value = valor;
      opt.textContent = valor;
      select.appendChild(opt);
    }
  });
}
```

- [ ] **Step 2: cargar la lista dinámica al iniciar la app**

Justo después de la llamada `iniciarVista();` (línea ~1549), añadir:

```javascript
gas('obtenerSubtiposConocidos').then(function (lista) {
  OPCIONES_SUBTIPO_ = lista;
  sincronizarSelectSubtipoTaisa_();
}).catch(function (err) {
  console.error('No se pudo cargar la lista dinámica de subtipos:', err);
});
```

`OPCIONES_SUBTIPO_` (línea 997) sigue existiendo con su valor hardcodeado como fallback inicial — este código solo la amplía tras la respuesta del servidor, sin quitar nada. `editarSoporteUI_` (línea 1027) ya lee `OPCIONES_SUBTIPO_` en el momento de construir cada select, así que se beneficia automáticamente sin tocarla.

- [ ] **Step 3: verificación manual (ver Task 13)**

- [ ] **Step 4: push**

```bash
clasp push -f
```

---

### Task 8: HODOS — `Pruebas.gs`: smoke test de la integración

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\Pruebas.gs` (dentro de `verificarSistema()`, antes de la línea `Logger.log(resultados.join('\n'));`)

- [ ] **Step 1: añadir un bloque de prueba nuevo**

Insertar, dentro de `verificarSistema()`, justo antes del bloque de la prueba "modo prueba" (línea ~229) o después — el orden entre bloques `try/catch` independientes no importa, cada uno es autocontenido:

```javascript
    try {
      // Integración INCPC: crearEtiquetaDesdeIncpc_ debe normalizar el destino,
      // crear la etiqueta con origen Taisa + el subtipo recibido, guardar el
      // contenido (referencia/cantidad) y marcar pendiente_impresion_incpc=true.
      // Se llama directamente (sin pasar por doPost/token) porque aquí solo se
      // verifica la lógica de negocio, no el transporte HTTP — ese lo verifica
      // el usuario en el Task 13 con una fila real en INCPC.
      var pedidoIncpc = 'TESTINCPC' + new Date().getTime();
      var idIncpc = crearEtiquetaDesdeIncpc_({
        destino: 'Malaga 1',
        pedido: pedidoIncpc,
        tipo: 'Rotura transportista',
        referencia: '12345-EAN',
        cantidad: '3',
        operario: 'Test'
      });
      var etqIncpc = buscarEtiquetas({ idUnico: idIncpc })[0];
      var okIncpc = etqIncpc
        && etqIncpc.destino === 'Málaga'
        && etqIncpc.subtipo === 'Rotura transportista'
        && etqIncpc.origenTexto === 'TAISA - ROTURA TRANSPORTISTA'
        && etqIncpc.creadoPor === 'INCPC · Test'
        && etqIncpc.contenido.length === 1
        && etqIncpc.contenido[0].descripcion === '12345-EAN'
        && etqIncpc.contenido[0].cantidad === 3;
      resultados.push(okIncpc
        ? 'OK: crearEtiquetaDesdeIncpc_ normaliza destino, fija subtipo/creadoPor y guarda contenido'
        : 'ERROR crearEtiquetaDesdeIncpc_: ' + JSON.stringify(etqIncpc));

      var pendientesAntes = obtenerEtiquetasPendientesIncpc();
      var estaPendiente = pendientesAntes.some(function (p) { return p.idUnico === idIncpc; });
      resultados.push(estaPendiente
        ? 'OK: la etiqueta creada por INCPC aparece en obtenerEtiquetasPendientesIncpc'
        : 'ERROR: la etiqueta INCPC no aparece como pendiente de imprimir');

      var htmlIncpc = htmlPendientesIncpc();
      resultados.push(htmlIncpc.indexOf(idIncpc) !== -1
        ? 'OK: htmlPendientesIncpc incluye la etiqueta pendiente'
        : 'ERROR: htmlPendientesIncpc no incluye ' + idIncpc);

      marcarImpresasIncpc();
      var pendientesDespues = obtenerEtiquetasPendientesIncpc();
      var yaNoEstaPendiente = !pendientesDespues.some(function (p) { return p.idUnico === idIncpc; });
      resultados.push(yaNoEstaPendiente
        ? 'OK: marcarImpresasIncpc limpia el flag y la etiqueta desaparece de la pestaña INCPC'
        : 'ERROR: marcarImpresasIncpc no limpió el flag');

      // La etiqueta sigue existiendo normal (Buscar interno) tras marcarse impresa.
      var siguExistiendo = buscarEtiquetas({ idUnico: idIncpc })[0];
      resultados.push(siguExistiendo
        ? 'OK: la etiqueta sigue existiendo en buscarEtiquetas tras marcarse impresa'
        : 'ERROR CRÍTICO: la etiqueta desapareció de buscarEtiquetas tras marcarse impresa');
    } catch (e) {
      resultados.push('ERROR prueba integración INCPC: ' + e.toString());
    }

    try {
      // Normalización de destino: variantes de Málaga deben colapsar, valores
      // desconocidos deben rechazarse con un error explícito (no crear la etiqueta
      // con un destino vacío/incorrecto).
      var rechazadoDestino = false;
      try {
        crearEtiquetaDesdeIncpc_({ destino: 'Sevilla', pedido: '999999', tipo: 'Test', operario: 'Test' });
      } catch (eDestino) {
        rechazadoDestino = eDestino.message.indexOf('no reconocida') !== -1;
      }
      resultados.push(rechazadoDestino
        ? 'OK: crearEtiquetaDesdeIncpc_ rechaza una tienda destino no reconocida'
        : 'ERROR CRÍTICO: se aceptó un destino inválido desde INCPC');
    } catch (e) {
      resultados.push('ERROR prueba destino inválido INCPC: ' + e.toString());
    }
```

- [ ] **Step 2: push**

```bash
clasp push -f
```

- [ ] **Step 3: recordatorio — este smoke test se ejecuta manualmente**

`verificarSistema()` requiere auth de Google y se ejecuta desde el editor de Apps Script (no hay forma de correrlo desde aquí) — el usuario lo ejecutará como parte del Task 13.

---

### Task 9: HODOS — Script Properties + despliegue a producción (PASO MANUAL + comandos)

- [ ] **Step 1 (MANUAL, lo ejecuta el usuario): añadir el token compartido**

En el editor de Apps Script de HODOS (`clasp open` desde `C:\Users\30081048\Desktop\Proyectos\hodos`, o `Configuración del proyecto` ⚙️ → "Propiedades del script" → "Añadir propiedad del script"):

- Propiedad: `INCPC_SHARED_TOKEN`
- Valor: `z0VyOXrMXB4x41FOt8M85xAA3WWsoeZHDummzNs7VY`

(Mismo mecanismo ya usado para `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` — ver `SupabaseCliente.gs`.)

- [ ] **Step 2: desplegar a producción**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\hodos" && clasp deploy -i "AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ" -d "v38: integracion INCPC - creacion automatica de etiquetas + pestana INCPC + subtipo dinamico"
```

- [ ] **Step 3: verificar el despliegue**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\hodos" && clasp deployments
```

Expected: la línea `@37` pasa a `@38` con la descripción del Step 2.

- [ ] **Step 4: actualizar `CLAUDE.md`**

Añadir al changelog de `C:\Users\30081048\Desktop\Proyectos\hodos\CLAUDE.md` (siguiendo el formato de las entradas v34-v37 ya existentes) una entrada v38 resumiendo: integración con INCPC (doPost + token compartido, sin abrir acceso público — bearer OAuth sobre el deployment DOMAIN existente), columna Supabase `pendiente_impresion_incpc`, pestaña nueva "INCPC", subtipo dinámico. Actualizar también la línea de "Despliegue actual… versión 37" a "versión 38".

---

### Task 10: INCPC — `Código.js`: trigger de automatización

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\INCPC\Código.js` (extender `onOpen`, líneas 603-608; añadir funciones nuevas)

- [ ] **Step 1: extender el menú `onOpen`**

Reemplazar (líneas 603-608):
```javascript
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Buscador Pedidos')
    .addItem('Buscar pedido', 'mostrarBuscadorPedido')
    .addToUi();
}
```
por:
```javascript
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Buscador Pedidos')
    .addItem('Buscar pedido', 'mostrarBuscadorPedido')
    .addSeparator()
    .addItem('⚙️ Instalar automatización HODOS', 'instalarTriggerIncpcHodos_')
    .addToUi();
}
```

- [ ] **Step 2: función de instalación del trigger (idempotente — se puede ejecutar varias veces sin duplicar)**

Añadir al final del archivo:

```javascript
function instalarTriggerIncpcHodos_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onEditIncpcHodos_'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('onEditIncpcHodos_')
    .forSpreadsheet(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID))
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert(
    'Automatización instalada.\n\nA partir de ahora, cuando en una fila (fila 3 en adelante) el check de la columna N esté marcado y la columna M diga "sí" (en cualquier variante), se creará automáticamente la etiqueta en HODOS y el ID quedará escrito en la columna O.'
  );
}
```

- [ ] **Step 3: el trigger instalable — disparo + llamada a HODOS**

Añadir al final del archivo:

```javascript
var COL_HODOS_ID_INCPC_ = 15; // O — no está en CONFIG porque es específica de esta automatización

function onEditIncpcHodos_(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 3) return;
  if (col !== CONFIG.COL_DEV_M && col !== CONFIG.COL_CHECKBOX_N) return;

  var fila = sheet.getRange(row, 1, 1, COL_HODOS_ID_INCPC_).getValues()[0];

  var yaTieneId = _texto(fila[COL_HODOS_ID_INCPC_ - 1]);
  if (yaTieneId) return; // ya procesada — evita duplicados si se vuelve a tocar N/M

  var checkN = fila[CONFIG.COL_CHECKBOX_N - 1] === true;
  var valorM = _normalizarSiNoIncpc_(fila[CONFIG.COL_DEV_M - 1]);
  if (!checkN || valorM !== 'si') return;

  var payload = {
    destino: _texto(fila[CONFIG.COL_TIENDA - 1]),
    pedido: _texto(fila[CONFIG.COL_PEDIDO - 1]),
    tipo: _texto(fila[CONFIG.COL_TIPO - 1]),
    referencia: _texto(fila[CONFIG.COL_LM - 1]),
    cantidad: _texto(fila[CONFIG.COL_UNIDADES - 1]),
    operario: _texto(fila[CONFIG.COL_OPERARIO - 1])
  };

  try {
    var idUnico = enviarEtiquetaAHodos_(payload);
    sheet.getRange(row, COL_HODOS_ID_INCPC_).setValue(idUnico);
  } catch (err) {
    Logger.log('onEditIncpcHodos_ fila ' + row + ': ' + err.message);
  }
}

function _normalizarSiNoIncpc_(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

function enviarEtiquetaAHodos_(payload) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('HODOS_WEBAPP_URL');
  var token = props.getProperty('INCPC_SHARED_TOKEN');
  if (!url || !token) throw new Error('Faltan HODOS_WEBAPP_URL o INCPC_SHARED_TOKEN en Propiedades del script');

  payload.token = token;

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  var texto = resp.getContentText();
  var json;
  try {
    json = JSON.parse(texto);
  } catch (eParse) {
    throw new Error('Respuesta no válida de HODOS (¿problema de autenticación?): ' + texto.substring(0, 200));
  }
  if (!json.ok) throw new Error('HODOS rechazó la etiqueta: ' + json.error);
  return json.idUnico;
}
```

`_texto` ya existe en el archivo (líneas 594-597) y se reutiliza tal cual.

- [ ] **Step 4: no hay test automático para este archivo**

Este proyecto no tiene arnés `node --test` (a diferencia de HODOS, no tiene funciones puras separadas en un archivo tipo `Utilidades.gs`, y añadir uno solo para este cambio sería desproporcionado). La verificación es manual, Task 13.

- [ ] **Step 5: push**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\INCPC" && clasp push -f
```

No hace falta `clasp deploy`: `onOpen`/`onEdit`/triggers instalables ejecutan siempre el código HEAD del proyecto, no dependen de un deployment de Web App (eso solo afecta a `doGet`, que aquí no se toca).

---

### Task 11: INCPC — Script Properties (PASO MANUAL, lo ejecuta el usuario)

- [ ] **Step 1: abrir el editor de Apps Script de INCPC**

```bash
cd "C:\Users\30081048\Desktop\Proyectos\INCPC" && clasp open
```

- [ ] **Step 2: añadir dos propiedades del script** (⚙️ Configuración del proyecto → Propiedades del script → Añadir propiedad del script)

| Propiedad | Valor |
|---|---|
| `INCPC_SHARED_TOKEN` | `z0VyOXrMXB4x41FOt8M85xAA3WWsoeZHDummzNs7VY` (el mismo valor exacto que en el Task 9 de HODOS) |
| `HODOS_WEBAPP_URL` | `https://script.google.com/macros/s/AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ/exec` |

---

### Task 12: INCPC — hoja de cálculo (PASO MANUAL, lo ejecuta el usuario)

- [ ] **Step 1: añadir la cabecera de la columna O**

Abrir la hoja "Incidencias" del spreadsheet `1AWfwBTcYxqqJQEnDjjir_LshBaMFTDGNu3LSSbNJEd8` y escribir **"HODOS ID"** en la columna O, fila 2 (junto al resto de cabeceras — no se hace por código para no arriesgarse a romper el formato de celdas combinadas que ya tienen las cabeceras existentes).

- [ ] **Step 2: instalar el trigger**

Recargar la hoja de cálculo (para que el `onOpen` actualizado cree el menú nuevo), abrir **🔍 Buscador Pedidos → ⚙️ Instalar automatización HODOS**, y confirmar el mensaje de éxito.

---

### Task 13: Verificación end-to-end (PASO MANUAL, lo ejecuta el usuario)

- [ ] **Step 1: ejecutar el smoke test de HODOS**

Desde el editor de Apps Script de HODOS (`clasp open`), ejecutar `verificarSistema()` (menú Ejecutar, o seleccionar la función y pulsar ▶). Revisar el log: todas las líneas nuevas de la Task 8 deben empezar por "OK:" — si alguna dice "ERROR", no continuar sin resolverla.

- [ ] **Step 2: prueba real con una fila de INCPC**

En la hoja "Incidencias" de INCPC, en cualquier fila de datos (fila 3 o superior) de una **devolución** (para que la columna M tenga el desplegable Sí/No):
1. Rellenar M = "Sí".
2. Marcar el check de N.
3. Esperar unos segundos y comprobar que la columna O de esa fila se rellena con un ID tipo `HODOS-000XXX`.

Si O se queda vacía: abrir **Extensiones → Apps Script → Ejecuciones** en INCPC y mirar el log de `onEditIncpcHodos_` para el mensaje de error concreto.

**Contingencia si el error es de autenticación** (la respuesta que `enviarEtiquetaAHodos_` recibe no es JSON — el mensaje de error empezará por "Respuesta no válida de HODOS"): el bearer token OAuth no fue aceptado por el deployment `DOMAIN` de HODOS. Solución de respaldo (no implementada por defecto, solo si hace falta): crear un segundo deployment de HODOS con acceso "Cualquier usuario" dedicado a esta integración, y apuntar `HODOS_WEBAPP_URL` (Task 11) a esa nueva URL en vez de a la de producción — el `doPost` sigue exigiendo el token compartido igualmente, así que la protección real no depende del nivel de acceso de la plataforma.

- [ ] **Step 3: comprobar la pestaña "INCPC" en HODOS**

Abrir HODOS (`https://script.google.com/macros/s/AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ/exec`), pestaña **INCPC** en el sidebar. Debe aparecer la etiqueta recién creada con el pedido, destino, subtipo y contenido correctos.

- [ ] **Step 4: imprimir y comprobar que desaparece**

Pulsar "Imprimir todas". Confirmar que se abre el diálogo de impresión con la etiqueta en formato Zebra. Volver a la pestaña INCPC (o recargar): la etiqueta ya no debe aparecer ahí.

- [ ] **Step 5: comprobar que sigue existiendo como etiqueta normal**

Ir a la pestaña **Buscar**, buscar por ese número de pedido: debe aparecer con estado REGISTRADO, reimprimible desde ahí como cualquier otra etiqueta.

- [ ] **Step 6: comprobar el subtipo dinámico**

Si el "Tipo" usado en la fila de prueba (columna H de INCPC) no estaba ya en la lista de subtipos de HODOS, comprobar que aparece como opción seleccionable en el desplegable "Subtipo" del formulario de alta (pestaña Cargar lote, origen Taisa) tras recargar la página.
