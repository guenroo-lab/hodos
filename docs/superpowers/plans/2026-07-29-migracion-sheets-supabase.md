# Migración Sheets → Supabase (HODOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir Google Sheets por Supabase (Postgres/PostgREST) como capa de persistencia de HODOS, sin tocar `Index.html`/`doGet`/`ConfigEntregas.gs` ni ninguna función pura de `Utilidades.gs`.

**Architecture:** `EstructuraSheets.gs`/`EstructuraCargas.gs`/`EstructuraContenido.gs` pasan de leer/escribir `SpreadsheetApp` a hablar con Supabase vía un cliente REST genérico nuevo (`SupabaseCliente.gs`), usando la clave `service_role` legacy. Las funciones de `Backend.gs` que hoy hacen `getRange`/`setValues` a mano se reescriben para usar los helpers nuevos. `escanearSoporte` gana un bucle de reintento con concurrencia optimista (PATCH condicionado) para la única carrera real de la migración.

**Tech Stack:** Google Apps Script (V8), clasp, Supabase (Postgres + PostgREST), `node --test` para lógica pura.

**Nota sobre control de versiones:** este proyecto no usa git (ver `CLAUDE.md`: "Sin git, igual que los demás proyectos GAS de Taisa"). Donde el formato estándar de esta skill pondría un paso de `git commit`, aquí se sustituye por `clasp push -f` (sincronizar con Apps Script) y/o una verificación manual en el editor — nunca hay un paso de commit.

**Spec:** `docs/superpowers/specs/2026-07-29-migracion-sheets-supabase-design.md`

---

## Estructura de archivos

**Crear:**
- `SupabaseCliente.gs` — cliente REST genérico contra PostgREST (config, headers, get/insertar/actualizar/borrar/rpc). Único archivo que llama a `UrlFetchApp` para hablar con Supabase.
- `test/estructuraCargas.test.js` — TDD de los mappers de `cargas`.
- `test/estructuraSheets.test.js` — TDD de los mappers de `etiquetas`.
- `test/estructuraContenido.test.js` — TDD de los mappers de `contenido`.

**Reescribir por completo (se borra el contenido actual basado en Sheets):**
- `EstructuraCargas.gs` — mappers camelCase↔snake_case + CRUD contra tabla `cargas`.
- `EstructuraSheets.gs` — mappers camelCase↔snake_case + CRUD contra tabla `etiquetas`.
- `EstructuraContenido.gs` — mappers + CRUD contra tabla `contenido`.

**Modificar (funciones puntuales, el resto del archivo no cambia):**
- `Backend.gs` — `registrarLote`, `obtenerEtiquetasPorLote_`, `obtenerHistorialLotes`, `buscarEtiquetas`, `obtenerMapaCargas_`, `obtenerMapaContenido_`, `guardarContenidoSoporte`, `crearCarga`, `listarCargasAbiertas`, `obtenerOCrearCarga`, `obtenerCarga`, `escanearSoporte`, `cerrarCarga`. Se eliminan `reservarBloqueIds_` y `PROP_CONTADOR_ID` (ya no hacen falta). `htmlEtiquetas`/`htmlUnaEtiqueta_`/`esc_`/`obtenerEtiquetasPorLote_` (la parte de generación de HTML) **no cambian** — ya son puras respecto a su entrada.
- `Pruebas.gs` — solo el primer bloque `try` de `verificarSistema()` (comprobación de acceso a la hoja → comprobación de conexión a Supabase). El resto de la función no cambia ni una línea (llama a funciones cuya firma/forma de retorno se preserva exactamente).

**No se tocan:** `Utilidades.gs`, `Barcode.gs`, `Index.html`, `ConfigEntregas.gs`, `ReporteCarga.gs`, `appsscript.json`, `test/utilidades.test.js`, `test/barcode.test.js`.

---

### Task 1: DDL en Supabase (tablas, índices, secuencias, funciones RPC)

**Archivos:** ninguno en el repo — se ejecuta directamente en el SQL Editor del proyecto Supabase `HODOS` (`https://supabase.com/dashboard/project/dbxlrnupiwemnarlxmcv/sql/new`).

- [ ] **Step 1: Confirmar con el usuario antes de ejecutar**

Este paso modifica el proyecto Supabase real (aunque de forma no destructiva: solo crea objetos nuevos en una base vacía). Antes de pulsar "Run", confirmar explícitamente con el usuario que se puede ejecutar.

- [ ] **Step 2: Ejecutar el DDL completo**

```sql
create table cargas (
  id_carga       text primary key,
  destino        text not null,
  fecha_entrega  text not null,
  horario        text not null,
  estado         text not null default 'ABIERTA',
  creada_por     text,
  fecha_creacion timestamptz not null default now(),
  cerrada_por    text,
  fecha_cierre   timestamptz,
  pdf_url        text,
  email_enviado  text
);
create index idx_cargas_estado on cargas (estado);
create index idx_cargas_destino_fecha_horario on cargas (destino, fecha_entrega, horario);

create table etiquetas (
  id_unico       text primary key,
  numero_pedido  text not null,
  soporte_num    integer not null,
  soporte_total  integer not null,
  origen         text not null,
  subtipo        text,
  origen_texto   text not null,
  destino        text not null,
  fecha_creacion timestamptz not null default now(),
  lote_id        text not null,
  creado_por     text,
  estado         text not null default 'REGISTRADO',
  batea_id       text references cargas (id_carga),
  fecha_envio    timestamptz,
  origen_tienda  text
);
create index idx_etiquetas_lote on etiquetas (lote_id);
create index idx_etiquetas_pedido on etiquetas (numero_pedido);
create index idx_etiquetas_batea on etiquetas (batea_id);

create table contenido (
  id_unico       text not null references etiquetas (id_unico) on delete cascade,
  descripcion    text not null,
  cantidad       numeric not null,
  creado_por     text,
  fecha_creacion timestamptz not null default now()
);
create index idx_contenido_id_unico on contenido (id_unico);

create sequence seq_etiquetas_id start 1;
create sequence seq_cargas_id start 1;

create or replace function siguiente_bloque_ids_etiquetas(p_cantidad integer)
returns text[] language plpgsql as $$
declare resultado text[] := '{}'; i integer; n bigint;
begin
  for i in 1..p_cantidad loop
    n := nextval('seq_etiquetas_id');
    resultado := array_append(resultado, 'HODOS-' || lpad(n::text, 6, '0'));
  end loop;
  return resultado;
end $$;

create or replace function siguiente_id_carga()
returns text language plpgsql as $$
declare n bigint;
begin
  n := nextval('seq_cargas_id');
  return 'CARGA-' || lpad(n::text, 6, '0');
end $$;
```

Expected: "Success. No rows returned" (o equivalente) en el SQL Editor de Supabase.

- [ ] **Step 3: Verificar las tablas creadas**

```sql
select table_name from information_schema.tables where table_schema = 'public' order by table_name;
```

Expected: 3 filas — `cargas`, `contenido`, `etiquetas`.

- [ ] **Step 4: Verificar las funciones RPC**

```sql
select siguiente_id_carga();
select siguiente_bloque_ids_etiquetas(2);
```

Expected: `'CARGA-000001'` y `{HODOS-000001,HODOS-000002}` respectivamente. Si PostgREST responde `PGRST202` (función no encontrada) al llamarlas más adelante vía REST, esperar ~1 minuto a que se recargue el schema cache de la API, o forzarlo desde Database → API → "Reload schema".

---

### Task 2: `SupabaseCliente.gs` — cliente REST genérico + `testConexionSupabase()`

**Archivos:**
- Create: `SupabaseCliente.gs`
- Modify: `Pruebas.gs` (añadir `testConexionSupabase`, no tocar `verificarSistema` todavía — eso es la Task 9)

- [ ] **Step 1: Crear `SupabaseCliente.gs`**

```javascript
// SupabaseCliente.gs — cliente REST genérico contra PostgREST (Supabase). Ningún otro
// archivo debe llamar a UrlFetchApp para hablar con Supabase: todo pasa por aquí.

function supaConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('SUPABASE_URL');
  var key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL/SUPABASE_SERVICE_KEY en Propiedades del script');
  return { url: url, key: key };
}

function supaCabeceras_() {
  var cfg = supaConfig_();
  return { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
}

function supaGet_(tabla, filtroPostgrest) {
  var cfg = supaConfig_();
  var url = cfg.url + '/rest/v1/' + tabla + '?select=*' + (filtroPostgrest ? '&' + filtroPostgrest : '');
  var resp = UrlFetchApp.fetch(url, { method: 'get', headers: supaCabeceras_(), muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function supaInsertar_(tabla, filas) {
  var cfg = supaConfig_();
  var cabeceras = supaCabeceras_();
  cabeceras.Prefer = 'return=representation';
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla, {
    method: 'post',
    headers: cabeceras,
    payload: JSON.stringify(filas),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaInsertar_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function supaActualizar_(tabla, filtroPostgrest, cambios) {
  var cfg = supaConfig_();
  var cabeceras = supaCabeceras_();
  cabeceras.Prefer = 'return=representation';
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla + '?' + filtroPostgrest, {
    method: 'patch',
    headers: cabeceras,
    payload: JSON.stringify(cambios),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaActualizar_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function supaBorrar_(tabla, filtroPostgrest) {
  var cfg = supaConfig_();
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla + '?' + filtroPostgrest, {
    method: 'delete',
    headers: supaCabeceras_(),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaBorrar_(' + tabla + '): ' + resp.getContentText());
}

function supaRpc_(nombreFuncion, parametros) {
  var cfg = supaConfig_();
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + nombreFuncion, {
    method: 'post',
    headers: supaCabeceras_(),
    payload: JSON.stringify(parametros || {}),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaRpc_(' + nombreFuncion + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
```

- [ ] **Step 2: Añadir `testConexionSupabase()` a `Pruebas.gs`**

Añadir esta función al final de `Pruebas.gs` (antes de `autorizarYProbarCorreo`, o después — el orden no importa):

```javascript
function testConexionSupabase() {
  var filas = supaGet_('cargas', 'limit=1');
  Logger.log('OK: conexión con Supabase — tabla cargas accesible (' + filas.length + ' fila(s) de muestra)');
  return true;
}
```

- [ ] **Step 3: `clasp push -f`**

```bash
clasp push -f
```

Expected: lista de archivos subidos, incluyendo `SupabaseCliente.gs`.

- [ ] **Step 4: Ejecutar `testConexionSupabase` desde el editor de Apps Script**

Abrir el proyecto (`clasp open`), seleccionar la función `testConexionSupabase` en el desplegable, pulsar Ejecutar. La primera vez pedirá autorizar el scope de `UrlFetchApp` (conceder acceso).

Expected en el log: `OK: conexión con Supabase — tabla cargas accesible (0 fila(s) de muestra)`.

---

### Task 3: `EstructuraCargas.gs` — mappers + CRUD contra tabla `cargas`

**Archivos:**
- Modify (reescritura completa): `EstructuraCargas.gs`
- Create: `test/estructuraCargas.test.js`

- [ ] **Step 1: Escribir el test que falla**

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

function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('filaCargaDesdeSupabase_ convierte snake_case a camelCase', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  const fila = {
    id_carga: 'CARGA-000001', destino: 'Mijas', fecha_entrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creada_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z',
    cerrada_por: null, fecha_cierre: null, pdf_url: null, email_enviado: null
  };
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaDesdeSupabase_(fila)), {
    idCarga: 'CARGA-000001', destino: 'Mijas', fechaEntrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creadaPor: 'a@b.com', fechaCreacion: '2026-07-29T10:00:00Z',
    cerradaPor: null, fechaCierre: null, pdfUrl: null, emailEnviado: null
  });
});

test('filaCargaHaciaSupabase_ convierte camelCase a snake_case, solo campos presentes', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaHaciaSupabase_({
    idCarga: 'CARGA-000001', destino: 'Mijas', fechaEntrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creadaPor: 'a@b.com'
  })), {
    id_carga: 'CARGA-000001', destino: 'Mijas', fecha_entrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creada_por: 'a@b.com'
  });
});

test('filaCargaHaciaSupabase_ con objeto parcial (cierre de carga) solo mapea esos campos', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaHaciaSupabase_({
    estado: 'CERRADA', cerradaPor: 'a@b.com', fechaCierre: '2026-07-29T12:00:00Z', pdfUrl: 'https://x', emailEnviado: 'SI'
  })), {
    estado: 'CERRADA', cerrada_por: 'a@b.com', fecha_cierre: '2026-07-29T12:00:00Z', pdf_url: 'https://x', email_enviado: 'SI'
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --test test/estructuraCargas.test.js`
Expected: FAIL — `ctx.filaCargaDesdeSupabase_ is not a function`.

- [ ] **Step 3: Reescribir `EstructuraCargas.gs` por completo**

```javascript
// EstructuraCargas.gs — mappers y acceso a la tabla `cargas` en Supabase.

function filaCargaDesdeSupabase_(f) {
  return {
    idCarga: f.id_carga,
    destino: f.destino,
    fechaEntrega: f.fecha_entrega,
    horario: f.horario,
    estado: f.estado,
    creadaPor: f.creada_por,
    fechaCreacion: f.fecha_creacion,
    cerradaPor: f.cerrada_por,
    fechaCierre: f.fecha_cierre,
    pdfUrl: f.pdf_url,
    emailEnviado: f.email_enviado
  };
}

function filaCargaHaciaSupabase_(obj) {
  var fila = {};
  if (obj.idCarga !== undefined) fila.id_carga = obj.idCarga;
  if (obj.destino !== undefined) fila.destino = obj.destino;
  if (obj.fechaEntrega !== undefined) fila.fecha_entrega = obj.fechaEntrega;
  if (obj.horario !== undefined) fila.horario = obj.horario;
  if (obj.estado !== undefined) fila.estado = obj.estado;
  if (obj.creadaPor !== undefined) fila.creada_por = obj.creadaPor;
  if (obj.cerradaPor !== undefined) fila.cerrada_por = obj.cerradaPor;
  if (obj.fechaCierre !== undefined) fila.fecha_cierre = obj.fechaCierre;
  if (obj.pdfUrl !== undefined) fila.pdf_url = obj.pdfUrl;
  if (obj.emailEnviado !== undefined) fila.email_enviado = obj.emailEnviado;
  return fila;
}

function insertarCarga_(datosCarga) {
  var insertadas = supaInsertar_('cargas', [filaCargaHaciaSupabase_(datosCarga)]);
  return filaCargaDesdeSupabase_(insertadas[0]);
}

function leerCargas_(filtroPostgrest) {
  return supaGet_('cargas', filtroPostgrest).map(filaCargaDesdeSupabase_);
}

function actualizarCarga_(idCarga, cambios) {
  var actualizadas = supaActualizar_('cargas', 'id_carga=eq.' + encodeURIComponent(idCarga), filaCargaHaciaSupabase_(cambios));
  if (actualizadas.length === 0) throw new Error('actualizarCarga_: no se encontró la carga ' + idCarga);
  return filaCargaDesdeSupabase_(actualizadas[0]);
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --test test/estructuraCargas.test.js`
Expected: PASS (3 tests).

---

### Task 4: `EstructuraSheets.gs` — mappers + CRUD contra tabla `etiquetas`

**Archivos:**
- Modify (reescritura completa): `EstructuraSheets.gs`
- Create: `test/estructuraSheets.test.js`

- [ ] **Step 1: Escribir el test que falla**

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

function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('filaEtiquetaDesdeSupabase_ convierte snake_case a camelCase', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const fila = {
    id_unico: 'HODOS-000001', numero_pedido: '100200', soporte_num: 1, soporte_total: 1,
    origen: 'Taisa', subtipo: 'Inventario', origen_texto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fecha_creacion: '2026-07-29T10:00:00Z', lote_id: 'uuid-1', creado_por: 'a@b.com',
    estado: 'REGISTRADO', batea_id: null, fecha_envio: null, origen_tienda: ''
  };
  assert.deepStrictEqual(aRealmLocal(ctx.filaEtiquetaDesdeSupabase_(fila)), {
    idUnico: 'HODOS-000001', numeroPedido: '100200', soporteNum: 1, soporteTotal: 1,
    origen: 'Taisa', subtipo: 'Inventario', origenTexto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fechaCreacion: '2026-07-29T10:00:00Z', loteId: 'uuid-1', creadoPor: 'a@b.com',
    estado: 'REGISTRADO', bateaId: null, fechaEnvio: null, origenTienda: ''
  });
});

test('filaEtiquetaHaciaSupabase_ mapea un objeto completo (registrarLote)', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const resultado = ctx.filaEtiquetaHaciaSupabase_({
    idUnico: 'HODOS-000001', numeroPedido: '100200', soporteNum: 1, soporteTotal: 1,
    origen: 'Taisa', subtipo: 'Inventario', origenTexto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fechaCreacion: '2026-07-29T10:00:00Z', loteId: 'uuid-1', creadoPor: 'a@b.com',
    estado: 'REGISTRADO', bateaId: null, fechaEnvio: null, origenTienda: ''
  });
  assert.deepStrictEqual(aRealmLocal(resultado), {
    id_unico: 'HODOS-000001', numero_pedido: '100200', soporte_num: 1, soporte_total: 1,
    origen: 'Taisa', subtipo: 'Inventario', origen_texto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fecha_creacion: '2026-07-29T10:00:00Z', lote_id: 'uuid-1', creado_por: 'a@b.com',
    estado: 'REGISTRADO', batea_id: null, fecha_envio: null, origen_tienda: ''
  });
});

test('filaEtiquetaHaciaSupabase_ con objeto parcial (escaneo) solo mapea esos campos', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaEtiquetaHaciaSupabase_({
    estado: 'EN_RUTA', bateaId: 'CARGA-000001', fechaEnvio: '2026-07-29T12:00:00Z'
  })), {
    estado: 'EN_RUTA', batea_id: 'CARGA-000001', fecha_envio: '2026-07-29T12:00:00Z'
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --test test/estructuraSheets.test.js`
Expected: FAIL — `ctx.filaEtiquetaDesdeSupabase_ is not a function`.

- [ ] **Step 3: Reescribir `EstructuraSheets.gs` por completo**

```javascript
// EstructuraSheets.gs — mappers y acceso a la tabla `etiquetas` en Supabase.

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
    origenTienda: f.origen_tienda
  };
}

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
  return fila;
}

function leerEtiquetas_(filtroPostgrest) {
  return supaGet_('etiquetas', filtroPostgrest).map(filaEtiquetaDesdeSupabase_);
}

function insertarEtiquetas_(filasEtiquetas) {
  var filas = filasEtiquetas.map(filaEtiquetaHaciaSupabase_);
  return supaInsertar_('etiquetas', filas).map(filaEtiquetaDesdeSupabase_);
}

function actualizarEtiquetaCondicional_(idUnico, cambios, filtroExtra) {
  var filtro = 'id_unico=eq.' + encodeURIComponent(idUnico) + (filtroExtra ? '&' + filtroExtra : '');
  return supaActualizar_('etiquetas', filtro, filaEtiquetaHaciaSupabase_(cambios)).map(filaEtiquetaDesdeSupabase_);
}

function siguienteBloqueIdsEtiquetas_(cantidad) {
  return supaRpc_('siguiente_bloque_ids_etiquetas', { p_cantidad: cantidad });
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --test test/estructuraSheets.test.js`
Expected: PASS (3 tests).

---

### Task 5: `EstructuraContenido.gs` — mappers + CRUD contra tabla `contenido`

**Archivos:**
- Modify (reescritura completa): `EstructuraContenido.gs`
- Create: `test/estructuraContenido.test.js`

- [ ] **Step 1: Escribir el test que falla**

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

function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('filaContenidoDesdeSupabase_ se queda solo con descripcion y cantidad', () => {
  const ctx = cargarGs('EstructuraContenido.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaContenidoDesdeSupabase_({
    id_unico: 'HODOS-000001', descripcion: 'Tornillos', cantidad: 5, creado_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z'
  })), { descripcion: 'Tornillos', cantidad: 5 });
});

test('filaContenidoHaciaSupabase_ añade id_unico/creado_por/fecha_creacion a la línea', () => {
  const ctx = cargarGs('EstructuraContenido.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaContenidoHaciaSupabase_(
    'HODOS-000001', { descripcion: 'Tornillos', cantidad: 5 }, 'a@b.com', '2026-07-29T10:00:00Z'
  )), {
    id_unico: 'HODOS-000001', descripcion: 'Tornillos', cantidad: 5, creado_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z'
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --test test/estructuraContenido.test.js`
Expected: FAIL — `ctx.filaContenidoDesdeSupabase_ is not a function`.

- [ ] **Step 3: Reescribir `EstructuraContenido.gs` por completo**

```javascript
// EstructuraContenido.gs — mappers y acceso a la tabla `contenido` en Supabase.

function filaContenidoDesdeSupabase_(f) {
  return { descripcion: f.descripcion, cantidad: f.cantidad };
}

function filaContenidoHaciaSupabase_(idUnico, linea, creadoPor, fechaCreacion) {
  return { id_unico: idUnico, descripcion: linea.descripcion, cantidad: linea.cantidad, creado_por: creadoPor, fecha_creacion: fechaCreacion };
}

function leerTodoContenidoCrudo_() {
  // Nombre "Crudo" a propósito: a diferencia de sus hermanas (leerCargas_/leerEtiquetas_),
  // esta NO mapea a camelCase. obtenerMapaContenido_ (Backend.gs) necesita id_unico
  // (snake_case) como clave del mapa, y filaContenidoDesdeSupabase_ lo descarta a
  // propósito. No "arreglar" añadiendo .map(filaContenidoDesdeSupabase_) aquí.
  return supaGet_('contenido', null);
}

function borrarContenidoPorIdUnico_(idUnico) {
  supaBorrar_('contenido', 'id_unico=eq.' + encodeURIComponent(idUnico));
}

function insertarContenido_(idUnico, lineas, creadoPor) {
  // El caller (guardarContenidoSoporte, Backend.gs) debe garantizar lineas no vacío;
  // este guard es solo una red de seguridad para evitar un POST vacío a Supabase.
  if (!lineas.length) return;
  var ahora = new Date().toISOString();
  var filas = lineas.map(function (l) { return filaContenidoHaciaSupabase_(idUnico, l, creadoPor, ahora); });
  supaInsertar_('contenido', filas);
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --test test/estructuraContenido.test.js`
Expected: PASS (2 tests).

---

### Task 6: `Backend.gs` — lotes, etiquetas y búsqueda

**Archivos:** Modify: `Backend.gs`

- [ ] **Step 1: Eliminar `reservarBloqueIds_` y `PROP_CONTADOR_ID`**

Borrar estas líneas (líneas 3 y 21-36 en la versión actual):

```javascript
var PROP_CONTADOR_ID = 'HODOS_CONTADOR_ID';
```
```javascript
function reservarBloqueIds_(cantidad) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var actual = parseInt(props.getProperty(PROP_CONTADOR_ID) || '0', 10);
    var ids = [];
    for (var i = 1; i <= cantidad; i++) {
      ids.push(formatearIdUnico(actual + i));
    }
    props.setProperty(PROP_CONTADOR_ID, String(actual + cantidad));
    return ids;
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Reemplazar `registrarLote`**

```javascript
function registrarLote(datos) {
  var lineas = parsearLotePedidos(datos.pedidosTexto);
  if (lineas.length === 0) {
    throw new Error('No hay pedidos en la lista');
  }
  if (!datos.origen) throw new Error('Falta el origen');
  if (datos.origen === 'Taisa' && !datos.subtipo) throw new Error('Falta el subtipo de Taisa');
  if (!datos.destino) throw new Error('Falta la tienda destino');

  var subtipo = subtipoEfectivo(datos.origen, datos.subtipo);
  var origenTienda = '';
  if (datos.origen === 'Cesión') {
    var validacionCesion = validarCesionEntreTiendas(datos.origenTienda, datos.destino);
    if (!validacionCesion.ok) {
      var mensajesCesion = {
        ORIGEN_IGUAL_DESTINO: 'La tienda de origen y la de destino de la cesión no pueden ser la misma',
        DESTINO_INVALIDO: 'La tienda de destino de la cesión no es válida',
        ORIGEN_INVALIDO: 'La tienda de origen de la cesión no es válida'
      };
      throw new Error(mensajesCesion[validacionCesion.motivo] || 'Cesión no válida');
    }
    origenTienda = validarTienda(datos.origenTienda);
  }
  var origenTexto = formatearOrigenTexto(datos.origen, datos.origen === 'Cesión' ? origenTienda : subtipo);
  var soportes = calcularSoportes(lineas);
  var ids = siguienteBloqueIdsEtiquetas_(lineas.length);
  var loteId = Utilities.getUuid();
  var fecha = new Date().toISOString();
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';

  var filas = soportes.map(function (s, i) {
    return {
      idUnico: ids[i], numeroPedido: s.numeroPedido, soporteNum: s.soporteNum, soporteTotal: s.soporteTotal,
      origen: datos.origen, subtipo: subtipo, origenTexto: origenTexto, destino: datos.destino,
      fechaCreacion: fecha, loteId: loteId, creadoPor: creadoPor, estado: 'REGISTRADO',
      bateaId: null, fechaEnvio: null, origenTienda: origenTienda
    };
  });

  insertarEtiquetas_(filas);

  var items = soportes.map(function (s, i) {
    return { idUnico: ids[i], numeroPedido: s.numeroPedido, soporteNum: s.soporteNum, soporteTotal: s.soporteTotal };
  });

  return { loteId: loteId, cantidad: filas.length, ids: ids, items: items };
}
```

- [ ] **Step 3: Reemplazar `obtenerEtiquetasPorLote_`**

```javascript
function obtenerEtiquetasPorLote_(loteId) {
  return leerEtiquetas_('lote_id=eq.' + encodeURIComponent(loteId) + '&order=soporte_num.asc');
}
```

(`htmlEtiquetas`/`htmlUnaEtiqueta_` que la usan no cambian — ya consumen la forma camelCase que devuelve.)

- [ ] **Step 4: Reemplazar `obtenerHistorialLotes`**

```javascript
function obtenerHistorialLotes(limite) {
  limite = limite || 10;
  var filas = leerEtiquetas_('order=fecha_creacion.asc');
  var porLote = {};
  var orden = [];
  filas.forEach(function (f) {
    if (!porLote[f.loteId]) {
      porLote[f.loteId] = { loteId: f.loteId, cantidad: 0, origenTexto: f.origenTexto, destino: f.destino, fecha: fechaComoTexto(f.fechaCreacion) };
      orden.push(f.loteId);
    }
    porLote[f.loteId].cantidad++;
  });
  return orden.slice(-limite).reverse().map(function (id) { return porLote[id]; });
}
```

Nota: `order=fecha_creacion.asc` es necesario porque, a diferencia de una hoja de Sheets, PostgREST no garantiza el orden de inserción si no se pide explícitamente.

- [ ] **Step 5: Reemplazar `obtenerMapaCargas_`**

```javascript
function obtenerMapaCargas_() {
  var filas = leerCargas_(null);
  var mapa = {};
  filas.forEach(function (f) {
    mapa[f.idCarga] = { fechaEntrega: fechaComoTexto(f.fechaEntrega), horario: f.horario };
  });
  return mapa;
}
```

- [ ] **Step 6: Reemplazar `obtenerMapaContenido_`**

```javascript
function obtenerMapaContenido_() {
  var filas = leerTodoContenidoCrudo_();
  var mapa = {};
  filas.forEach(function (f) {
    if (!mapa[f.id_unico]) mapa[f.id_unico] = [];
    mapa[f.id_unico].push({ descripcion: f.descripcion, cantidad: f.cantidad });
  });
  return mapa;
}
```

- [ ] **Step 7: Reemplazar `buscarEtiquetas`**

```javascript
function buscarEtiquetas(filtros) {
  filtros = filtros || {};
  var filas = leerEtiquetas_(null);
  var mapaCargas = obtenerMapaCargas_();
  var mapaContenido = obtenerMapaContenido_();

  var resultado = filas.filter(function (f) {
    if (filtros.destino && f.destino !== filtros.destino) return false;
    if (filtros.origen && f.origen !== filtros.origen) return false;
    if (filtros.estado && f.estado !== filtros.estado) return false;
    if (filtros.idUnico && String(f.idUnico).indexOf(filtros.idUnico) === -1) return false;
    if (filtros.numeroPedido && String(f.numeroPedido).indexOf(filtros.numeroPedido) === -1) return false;
    if (filtros.fecha) {
      var fechaFila = Utilities.formatDate(new Date(f.fechaCreacion), 'GMT+1', 'yyyy-MM-dd');
      if (fechaFila !== filtros.fecha) return false;
    }
    return true;
  }).map(function (f) {
    var carga = f.bateaId ? mapaCargas[f.bateaId] : null;
    return {
      idUnico: f.idUnico, numeroPedido: f.numeroPedido, soporteNum: f.soporteNum, soporteTotal: f.soporteTotal,
      origenTexto: f.origenTexto, destino: f.destino, fechaCreacion: fechaComoTexto(f.fechaCreacion),
      estado: f.estado, bateaId: f.bateaId, fechaCargado: fechaComoTexto(f.fechaEnvio),
      fechaLlegada: carga ? carga.fechaEntrega : '', horarioLlegada: carga ? carga.horario : '',
      contenido: mapaContenido[f.idUnico] || []
    };
  });

  resultado.sort(function (a, b) { return new Date(b.fechaCreacion) - new Date(a.fechaCreacion); });
  return resultado;
}
```

- [ ] **Step 8: `clasp push -f`**

```bash
clasp push -f
```

Expected: sin errores de sintaxis (el push falla si hay un error de JS). `escanearSoporte`/`cerrarCarga`/`crearCarga` etc. todavía usan código Sheets viejo en este punto — es intencional, se corrige en la Task 8. No ejecutar `verificarSistema()` todavía.

---

### Task 7: `Backend.gs` — contenido opcional por soporte

**Archivos:** Modify: `Backend.gs`

- [ ] **Step 1: Reemplazar `guardarContenidoSoporte`**

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

- [ ] **Step 2: `clasp push -f`**

```bash
clasp push -f
```

Expected: sin errores de sintaxis.

---

### Task 8: `Backend.gs` — cargas, escaneo con reintento y cierre

**Archivos:** Modify: `Backend.gs`

- [ ] **Step 1: Reemplazar `crearCarga`**

```javascript
function crearCarga(destino, fechaEntrega, horario) {
  if (!destino) throw new Error('Falta el destino');
  if (!fechaEntrega) throw new Error('Falta la fecha de entrega');
  if (!horario) throw new Error('Falta el horario');

  var idCarga = supaRpc_('siguiente_id_carga', {});
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
  insertarCarga_({ idCarga: idCarga, destino: destino, fechaEntrega: fechaEntrega, horario: horario, estado: 'ABIERTA', creadaPor: creadoPor });
  return { idCarga: idCarga };
}
```

- [ ] **Step 2: Reemplazar `listarCargasAbiertas`**

```javascript
function listarCargasAbiertas() {
  return leerCargas_('estado=eq.ABIERTA').map(function (c) {
    return {
      idCarga: c.idCarga,
      destino: c.destino,
      fechaEntrega: fechaComoTexto(c.fechaEntrega),
      horario: c.horario,
      fechaCreacion: fechaComoTexto(c.fechaCreacion)
    };
  });
}
```

- [ ] **Step 3: `obtenerOCrearCarga` no cambia de cuerpo** (solo depende de las dos funciones ya reescritas arriba, confirmar que sigue tal cual):

```javascript
function obtenerOCrearCarga(destino, fechaEntrega, horario) {
  var abiertas = listarCargasAbiertas();
  var existente = abiertas.filter(function (c) {
    return c.destino === destino && c.fechaEntrega === fechaEntrega && c.horario === horario;
  })[0];
  if (existente) {
    return { idCarga: existente.idCarga, reutilizada: true };
  }
  var nueva = crearCarga(destino, fechaEntrega, horario);
  return { idCarga: nueva.idCarga, reutilizada: false };
}
```

- [ ] **Step 4: Reemplazar `obtenerCarga`**

```javascript
function obtenerCarga(idCarga) {
  var cargas = leerCargas_('id_carga=eq.' + encodeURIComponent(idCarga));
  if (cargas.length === 0) throw new Error('Carga no encontrada: ' + idCarga);
  var filaCarga = cargas[0];

  var mapaContenidoCarga = obtenerMapaContenido_();
  var escaneados = leerEtiquetas_('batea_id=eq.' + encodeURIComponent(idCarga))
    .map(function (f) {
      return {
        idUnico: f.idUnico, numeroPedido: f.numeroPedido, origenTexto: f.origenTexto,
        fechaEnvio: fechaComoTexto(f.fechaEnvio), contenido: mapaContenidoCarga[f.idUnico] || []
      };
    })
    .sort(function (a, b) { return new Date(a.fechaEnvio) - new Date(b.fechaEnvio); });

  return {
    idCarga: filaCarga.idCarga, destino: filaCarga.destino,
    fechaEntrega: fechaComoTexto(filaCarga.fechaEntrega), horario: filaCarga.horario,
    estado: filaCarga.estado, escaneados: escaneados
  };
}
```

- [ ] **Step 5: Reemplazar `escanearSoporte` con reintento de concurrencia optimista**

```javascript
var ESCANEO_MAX_REINTENTOS = 5;

function escanearSoporte(idCarga, valorEscaneado) {
  valorEscaneado = String(valorEscaneado || '').trim();
  if (!valorEscaneado) throw new Error('Valor escaneado vacío');

  var cargas = leerCargas_('id_carga=eq.' + encodeURIComponent(idCarga));
  if (cargas.length === 0) throw new Error('Carga no encontrada: ' + idCarga);
  if (cargas[0].estado !== 'ABIERTA') throw new Error('Esta carga ya está cerrada');
  var destinoCarga = cargas[0].destino;

  for (var intento = 0; intento < ESCANEO_MAX_REINTENTOS; intento++) {
    var filtro = /^HODOS-/.test(valorEscaneado)
      ? 'id_unico=eq.' + encodeURIComponent(valorEscaneado)
      : 'numero_pedido=eq.' + encodeURIComponent(valorEscaneado);
    var candidatas = leerEtiquetas_(filtro);

    var resultado = seleccionarSoporteAEscanear(candidatas, valorEscaneado, destinoCarga);
    if (!resultado.ok) return resultado;

    var actualizadas = actualizarEtiquetaCondicional_(
      resultado.idUnico,
      { estado: 'EN_RUTA', bateaId: idCarga, fechaEnvio: new Date().toISOString() },
      'estado=eq.REGISTRADO'
    );
    if (actualizadas.length > 0) {
      return { ok: true, idUnico: resultado.idUnico, numeroPedido: actualizadas[0].numeroPedido };
    }
    // Alguien más se llevó ese soporte entre la lectura y la escritura: reintentar.
  }
  return { ok: false, motivo: 'REINTENTOS_AGOTADOS' };
}
```

Nota de paridad: igual que en la versión Sheets, el filtro por `numero_pedido` es una coincidencia EXACTA — un soporte agrupado ("100200+100300") solo se encuentra tecleando el string completo o escaneando su `idUnico`, nunca por un componente suelto del grupo. Esto no es una regresión: la versión Sheets tenía la misma limitación.

- [ ] **Step 6: Reemplazar `cerrarCarga`**

```javascript
function cerrarCarga(idCarga) {
  var cargas = leerCargas_('id_carga=eq.' + encodeURIComponent(idCarga));
  if (cargas.length === 0) throw new Error('Carga no encontrada: ' + idCarga);
  if (cargas[0].estado !== 'ABIERTA') throw new Error('Esta carga ya está cerrada');

  var filasChk = leerEtiquetas_(null).map(function (f) {
    return { numeroPedido: f.numeroPedido, destino: f.destino, estado: f.estado, bateaId: f.bateaId };
  });
  var pendientes = pedidosPendientesEnCarga(filasChk, idCarga);
  if (pendientes.length > 0) {
    var detalle = pendientes.map(function (p) { return p.numeroPedido + ' (faltan ' + p.soportesPendientes + ' soporte(s) por escanear)'; }).join(', ');
    throw new Error('No se puede cerrar la carga: hay pedidos incompletos — ' + detalle);
  }

  var carga = obtenerCarga(idCarga);
  var htmlPdf = htmlInformeCarga(idCarga);
  var fechaArchivo = carga.fechaEntrega.split('T')[0];
  var nombrePdf = 'HODOS_PedidoCliente_' + carga.destino + '_' + fechaArchivo + '_' + idCarga + '.pdf';

  var tempFile = DriveApp.getRootFolder().createFile('_temp_hodos_informe.html', htmlPdf, 'text/html');
  var pdfFile = tempFile.getAs('application/pdf');
  pdfFile.setName(nombrePdf);
  var pdfGuardado = DriveApp.getRootFolder().createFile(pdfFile);
  DriveApp.getFileById(tempFile.getId()).setTrashed(true);
  var pdfUrl = pdfGuardado.getUrl();

  var destinatarios = EMAILS_PEDIDO_CLIENTE_TIENDA[carga.destino] || [];
  var emailEnviado = 'NO';
  if (modoPruebaActivo()) {
    emailEnviado = 'MODO_PRUEBA (no enviado)';
  } else if (destinatarios.length > 0) {
    try {
      MailApp.sendEmail({
        to: destinatarios.join(','),
        cc: EMAILS_PEDIDO_CLIENTE_CC.join(','),
        subject: 'HODOS · Pedido Cliente · ' + carga.destino + ' · ' + fechaArchivo + (carga.horario ? ' · ' + carga.horario : ''),
        htmlBody: htmlPdf,
        attachments: [pdfFile]
      });
      emailEnviado = 'SI';
    } catch (e) {
      emailEnviado = 'ERROR: ' + e.message;
    }
  }

  actualizarCarga_(idCarga, {
    estado: 'CERRADA',
    cerradaPor: Session.getActiveUser().getEmail() || 'desconocido',
    fechaCierre: new Date().toISOString(),
    pdfUrl: pdfUrl,
    emailEnviado: emailEnviado
  });

  return {
    idCarga: idCarga, cantidad: carga.escaneados.length, pdfUrl: pdfUrl,
    emailEnviado: emailEnviado, destinatariosConfigurados: destinatarios.length
  };
}
```

- [ ] **Step 7: `clasp push -f`**

```bash
clasp push -f
```

Expected: sin errores de sintaxis. Todo `Backend.gs` es ahora consistente (ya no queda ninguna llamada a `SpreadsheetApp`/`obtenerHoja*`/`LockService` de IDs).

---

### Task 9: `Pruebas.gs` — apuntar la comprobación de acceso a Supabase

**Archivos:** Modify: `Pruebas.gs`

- [ ] **Step 1: Reemplazar el primer bloque de `verificarSistema()`**

Cambiar (líneas 6-11 actuales):

```javascript
  try {
    var hoja = obtenerHojaEtiquetas();
    resultados.push('OK: hoja ETIQUETAS accesible (' + hoja.getLastRow() + ' filas)');
  } catch (e) {
    resultados.push('ERROR hoja: ' + e.toString());
  }
```

por:

```javascript
  try {
    testConexionSupabase();
    resultados.push('OK: conexión con Supabase accesible (tabla cargas responde)');
  } catch (e) {
    resultados.push('ERROR conexión Supabase: ' + e.toString());
  }
```

El resto de `verificarSistema()` (líneas 13-234) **no cambia ni una línea** — todas las funciones que llama (`registrarLote`, `htmlEtiquetas`, `buscarEtiquetas`, `obtenerHistorialLotes`, `crearCarga`, `escanearSoporte`, `cerrarCarga`, `listarCargasAbiertas`, `obtenerOCrearCarga`, `guardarContenidoSoporte`, `modoPruebaActivo`) conservan exactamente la misma firma y forma de retorno tras la migración.

- [ ] **Step 2: `clasp push -f`**

```bash
clasp push -f
```

Expected: sin errores de sintaxis.

---

### Task 10: Verificación final y despliegue

**Archivos:** ninguno (solo ejecución/verificación)

- [ ] **Step 1: Ejecutar `verificarSistema()` desde el editor de Apps Script**

Abrir el proyecto (`clasp open`), seleccionar `verificarSistema` en el desplegable, Ejecutar. Revisar el log (`Ver → Registros` o `Ctrl+Enter`).

Expected: todas las líneas empiezan por `OK:` — ninguna por `ERROR`. Si algo falla, diagnosticar contra ese mensaje concreto (no asumir causa) y volver a la task correspondiente antes de seguir.

- [ ] **Step 2: Repetir `verificarSistema()` una segunda vez**

Igual que en la migración de Sheets, esto corre sobre la misma base persistente — repetir una vez más confirma que las salvaguardas de auto-limpieza (identificadores por timestamp, cierre de cargas de prueba) siguen aguantando sin acumular filas huérfanas ni bloquear la segunda ejecución.

Expected: de nuevo todo `OK:`.

- [ ] **Step 3: Desplegar nueva versión**

```bash
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ --description "v25: migración Sheets -> Supabase"
```

(deploymentId tomado de `CLAUDE.md` — confirmar con `clasp deployments` si ha cambiado.)

Expected: confirmación de nueva versión desplegada (v25).

- [ ] **Step 4: Checklist manual end-to-end en el navegador**

Con la vista `carga` real:
1. Registrar un lote con 2-3 pedidos (alguno repetido para generar soporte 1/2).
2. Imprimir/ver la etiqueta generada (`htmlEtiquetas`) — confirmar que el barcode y el diseño se ven igual que antes.
3. Añadir contenido a un soporte y confirmar que aparece en la búsqueda interna.
4. Crear una carga, escanear los soportes del lote (por idUnico y por número de pedido tecleado).
5. Registrar una cesión entre dos tiendas del circuito y confirmar el `origenTexto`.
6. Cerrar la carga y confirmar que el PDF se genera y que, en modo prueba, no se envía email real.
7. Repetir la búsqueda (vista interno y vista tienda) y confirmar que "Cargado"/"Llegó"/"Contenido" se muestran correctamente.

Expected: comportamiento idéntico al que había con Sheets, ahora respaldado por Supabase.

---

## Ejecución

**Subagent-Driven (recomendado)** — un subagente fresco por task, con revisión entre tasks, iteración rápida.

**Inline Execution** — ejecución por lotes en esta misma sesión con checkpoints de revisión.
