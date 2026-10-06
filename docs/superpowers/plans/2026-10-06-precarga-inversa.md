# Precarga Inversa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar en HODOS "torres" de soportes (mezcla de tipos) con etiqueta, y bipar esas etiquetas desde la app de Plataforma al cargar el camión de Torija, de modo que se sumen solas al conteo del camión y desaparezcan de HODOS.

**Architecture:** HODOS gana una tabla `torres_inversa` en Supabase, una pestaña "Precarga Inversa" (crear / imprimir / editar / borrar torres) y dos acciones nuevas en su webhook (`consumirTorreInversa` borra la torre atómicamente y devuelve su contenido; `devolverTorreInversa` la recrea). La app de Plataforma (proyecto Apps Script aparte) gana un bloque "Bipar torre" dentro del camión de Torija, con lector por pistola/teclado y un escáner de cámara continuo (modelo de Kairos), que llama a ese webhook. Un interruptor (dos propiedades del script) mantiene Plataforma idéntica a hoy hasta activarlo.

**Tech Stack:** Google Apps Script (clasp 2.5.0, V8), Supabase/PostgREST (proyecto `dbxlrnupiwemnarlxmcv`), Firebase Realtime Database (solo lo usa Plataforma), `node --test` con `vm` para probar los `.gs`/`.js`, Chrome headless para ver las pantallas con datos simulados.

**Spec:** `docs/superpowers/specs/2026-10-06-precarga-inversa-design.md`

---

## Ajustes respecto al diseño aprobado

Detalles que el diseño dejaba abiertos y que este plan fija. Al terminar (Task 16) se anotan también en el spec.

1. **Líneas de una torre (`normalizarLineasTorre_`):** casilla vacía, 0 o negativa → no cuenta; cantidad no entera (`2.5`, `abc`) → error; tipo que no está en el catálogo → error (no se descarta en silencio); tipos repetidos se suman; el nombre siempre sale del catálogo, nunca del cliente; sin ningún soporte → error.
2. **Borrar un camión de Torija con torres bipadas:** si HODOS no acepta de vuelta alguna torre, **el camión no se borra** y se avisa de qué torres fallaron (así no se pierden). Si no hay torres bipadas, se borra como hoy.
3. **Reautorización de Plataforma:** Plataforma ya usa `UrlFetchApp` (avisos a Google Chat) y `DriveApp`, así que su token OAuth ya lleva los permisos necesarios. Puede que **no** pida reautorizar; se comprueba en la Task 14 (si lo pide, se hace una vez).
4. **Escáner:** admite un parámetro `continuo` (por defecto `true`). Con `false` la pestaña se cierra tras la primera lectura confirmada (modo Kairos tal cual). Es la vuelta atrás si el modo continuo no funciona en la tablet.

## Estructura de archivos

**HODOS** (`C:\Users\30081048\Desktop\Proyectos\hodos`, repo git, `.claspignore` ya admite `*.gs` e `Index.html`):

| Archivo | Responsabilidad |
| --- | --- |
| `PrecargaInversa.gs` (nuevo) | Todo lo de la Precarga Inversa: lógica pura (validar id, catálogo, líneas), capa de datos Supabase, etiqueta, funciones para `google.script.run` y el enrutado del webhook. |
| `Backend.gs` (2 líneas) | `envolverEtiquetasHtml_` admite un segundo parámetro opcional de CSS extra. |
| `IntegracionIncpc.gs` (3 líneas) | `doPost` enruta las dos acciones nuevas a `procesarAccionInversa_`. |
| `Index.html` | Botón de barra lateral + vista + CSS + JS de la pestaña, insignia numérica. |
| `test/precargaInversa.test.js` (nuevo) | Núcleo puro. |
| `test/precargaInversaDatos.test.js` (nuevo) | Catálogo y capa de datos. |
| `test/precargaInversaEtiqueta.test.js` (nuevo) | Etiqueta y `envolverEtiquetasHtml_`. |
| `test/precargaInversaWebhook.test.js` (nuevo) | Acciones del webhook. |
| `test/indexInversa.test.js` (nuevo) | Bloque JS e ids de `Index.html`. |

**Plataforma** (carpeta nueva `C:\Users\30081048\Desktop\Proyectos\Plataforma`, repo git local sin remoto, `clasp` con `rootDir: src`):

| Archivo | Responsabilidad |
| --- | --- |
| `src/Backend_InversaHodos.js` (nuevo) | Servidor: interruptor (`bipadoInversaDisponible`) y llamadas al webhook de HODOS. |
| `src/JS_Inversa.html` (nuevo) | Cliente: bloque 1 = funciones puras y escáner (testeable); bloque 2 = interfaz y eventos. |
| `src/Modulo_Plataforma.html` | Bloque visual "Bipar torre" dentro de `#torija-carga` + modal de confirmación propio. |
| `src/JS_Plataforma.html` | 4 enganches mínimos (entrar, refrescar, salir, borrar camión). |
| `src/Index.html` | Un `include('JS_Inversa')`. |
| `test/*.test.js` (nuevos) | Pruebas de lo anterior. |

## Reglas de trabajo para quien ejecute el plan

- **Chat en español.** Código, tests, commits y documentos en prosa normal.
- **No hay `bash` en este entorno** (falla con "bash.exe not found"): usar PowerShell. `node --test` se ejecuta con ruta de archivo (`node --test test/archivo.test.js`) o sin argumento; **nunca** `node --test test/` (da un error raro en Windows).
- **No se usan agentes de revisión ni Workflows** (decisión del usuario para todos sus proyectos): las pruebas y las comprobaciones se hacen aquí, a mano.
- **Nada de `alert()`, `confirm()` ni `prompt()` nuevos.** Se usan los modales propios de cada app.
- **Ningún select ni casilla viene preseleccionada** (regla del usuario).
- **Otras sesiones editan HODOS a la vez.** Antes de cada commit: `git status --short`. Solo se hace `git add` de archivos propios. Si un archivo compartido (`Backend.gs`, `IntegracionIncpc.gs`, `Index.html`) aparece con cambios que no son de este plan, **parar y avisar al usuario** (en este entorno no se puede hacer `git add -p`).
- **Todos los commits de este plan llevan `[precarga-inversa]` en el asunto** (el despliegue se apoya en eso) y terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Producción (Supabase y despliegues) solo en las tareas 12 a 15, y solo con el OK del usuario** indicado en cada una.

---

## Task 0: Comprobaciones previas

**Files:** ninguno (solo lectura).

- [ ] **Step 1: Estado del repo y de las herramientas**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git log --oneline | Select-Object -First 5
node --version
clasp --version
```

Expected: `node` v24.x, `clasp` 2.5.0. Anota qué archivos aparecen en `git status` (si hay alguno modificado que no sea tuyo, no lo toques).

- [ ] **Step 2: Línea base de tests**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
node --test
```

Expected: todo en verde (`ℹ fail 0`). Apunta el número de `pass` (se compara al final de la Task 6). Si hay fallos previos, **no seguir**: avisar al usuario con el nombre de los tests que fallan.

---

## Task 1: Núcleo puro de `PrecargaInversa.gs`

**Files:**
- Create: `PrecargaInversa.gs`
- Test: `test/precargaInversa.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/precargaInversa.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargar(extra) {
  const ctx = Object.assign({}, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PrecargaInversa.gs'), 'utf8'), ctx);
  return ctx;
}

// Los objetos creados dentro del .gs cargado por vm viven en otro realm: deepStrictEqual los
// trata como distintos aunque el contenido sea idéntico. El viaje por JSON los trae al local.
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

const CATALOGO = [
  { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' },
  { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' },
  { id: 'S16', nombre: 'JAULA', tipo: 'Jaula Completa' }
];

test('validarIdTorreInversa_: acepta INV- con 6 o más dígitos, normaliza y rechaza el resto', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.validarIdTorreInversa_(' inv-000123 '), 'INV-000123');
  assert.strictEqual(ctx.validarIdTorreInversa_('INV-1234567'), 'INV-1234567');
  ['', null, undefined, 'HODOS-000123', 'INV-123', 'INV-12345A', '00184000227900315462'].forEach((malo) => {
    assert.throws(() => ctx.validarIdTorreInversa_(malo), /Código de torre no válido/, String(malo));
  });
});

test('parsearCatalogoSoportes_: salta la cabecera, recorta, excluye piezas sueltas y repetidos', () => {
  const ctx = cargar();
  const filas = [
    ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
    [' S01 ', ' EUROPEO ', 'x', '1.440', 'Palet'],
    ['S17', 'SVR (Completo)', 'x', '2.667', 'Jaula Completa'],
    ['S17_L', 'SVR_LAT (Lateral)', 'x', '1.310', 'Pieza Suelta'],
    ['S19_LSVP_LAT_DO', 'basura', '', '', ''],
    ['', 'sin id', '', '', 'Palet'],
    ['S01', 'EUROPEO repetido', '', '', 'Palet'],
    ['S99', '', '', '', '']
  ];
  assert.deepStrictEqual(aLocal(ctx.parsearCatalogoSoportes_(filas)), [
    { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' },
    { id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa' },
    { id: 'S99', nombre: 'S99', tipo: 'Otros' }
  ]);
});

test('normalizarLineasTorre_: suma repetidos, ignora vacíos/cero/negativos y usa el nombre del catálogo', () => {
  const ctx = cargar();
  const r = ctx.normalizarLineasTorre_([
    { id: 'S01', cantidad: '5', nombre: 'LO QUE MANDE EL CLIENTE' },
    { id: 'S16', cantidad: 5 },
    { id: 'S02', cantidad: '' },
    { id: 'S02', cantidad: 0 },
    { id: 'S02', cantidad: -3 },
    { id: 'S01', cantidad: 2 }
  ], CATALOGO);
  assert.deepStrictEqual(aLocal(r), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 7 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
});

test('normalizarLineasTorre_: cantidad no entera es un error, no se redondea', () => {
  const ctx = cargar();
  [2.5, 'abc', '1,5'].forEach((mala) => {
    assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S01', cantidad: mala }], CATALOGO), /Cantidad no válida/, String(mala));
  });
});

test('normalizarLineasTorre_: tipo fuera del catálogo es un error', () => {
  const ctx = cargar();
  assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S77', cantidad: 1 }], CATALOGO), /Tipo de soporte desconocido: S77/);
});

test('normalizarLineasTorre_: sin ningún soporte (o sin lista) es un error', () => {
  const ctx = cargar();
  assert.throws(() => ctx.normalizarLineasTorre_([], CATALOGO), /ningún soporte/);
  assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S01', cantidad: 0 }, { id: 'S02', cantidad: '' }], CATALOGO), /ningún soporte/);
  assert.throws(() => ctx.normalizarLineasTorre_(null, CATALOGO), /Faltan los soportes/);
});

test('totalSoportesTorre_: suma las cantidades', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.totalSoportesTorre_([{ cantidad: 5 }, { cantidad: 12 }]), 17);
  assert.strictEqual(ctx.totalSoportesTorre_([]), 0);
});

test('resumenPorTipoTorres_: agrega por tipo entre todas las torres, ordenado por id', () => {
  const ctx = cargar();
  const torres = [
    { lineas: [{ id: 'S16', nombre: 'JAULA', cantidad: 5 }, { id: 'S01', nombre: 'EUROPEO', cantidad: 5 }] },
    { lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 17 }] }
  ];
  assert.deepStrictEqual(aLocal(ctx.resumenPorTipoTorres_(torres)), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 22 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.deepStrictEqual(aLocal(ctx.resumenPorTipoTorres_([])), []);
});

test('fechaIsoONulo_: devuelve ISO si la fecha es válida y null si no', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.fechaIsoONulo_('2026-10-06T08:15:00Z'), '2026-10-06T08:15:00.000Z');
  assert.strictEqual(ctx.fechaIsoONulo_('no es fecha'), null);
  assert.strictEqual(ctx.fechaIsoONulo_(null), null);
  assert.strictEqual(ctx.fechaIsoONulo_(''), null);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
node --test test/precargaInversa.test.js
```

Expected: FAIL (`ENOENT ... PrecargaInversa.gs`).

- [ ] **Step 3: Implementar el núcleo**

Crea `PrecargaInversa.gs`:

```js
// PrecargaInversa.gs — Precarga Inversa: torres de soportes para la inversa a Torija.
// Spec: docs/superpowers/specs/2026-10-06-precarga-inversa-design.md
//
// Una "torre" es un montón de soportes (mezcla de tipos del catálogo de Plataforma) con una
// sola etiqueta INV-000123. Se registra aquí, se imprime, y se ELIMINA cuando la app de
// Plataforma la bipa al cargar el camión (webhook al final de este archivo). HODOS no guarda
// rastro de lo cargado: ese histórico lo escribe Plataforma en su control de soportes.

var PREFIJO_TORRE_INVERSA_ = 'INV-';
var REGEX_ID_TORRE_INVERSA_ = /^INV-[0-9]{6,}$/;

// Piezas sueltas que la pantalla de Torija de Plataforma ya no ofrece (barras y laterales de
// jaula) más dos ids basura que el lector de catálogo de Plataforma también descarta.
var IDS_SOPORTE_EXCLUIDOS_INVERSA_ = ['S17_L', 'S17_B', 'S18_L', 'S18_B', 'S19_B', 'S19_L', 'S19_LSVP_LAT_DO'];

function validarIdTorreInversa_(id) {
  var limpio = String(id == null ? '' : id).trim().toUpperCase();
  if (!REGEX_ID_TORRE_INVERSA_.test(limpio)) throw new Error('Código de torre no válido: "' + id + '"');
  return limpio;
}

// filas: valores de la pestaña CATALOGO_SOPORTES (primera fila = cabecera).
// Columnas: A id, B nombre, C imagen, D volumen, E tipo.
function parsearCatalogoSoportes_(filas) {
  var resultado = [];
  var vistos = {};
  for (var i = 1; i < filas.length; i++) {
    var fila = filas[i];
    var id = String(fila[0] == null ? '' : fila[0]).trim();
    if (!id || IDS_SOPORTE_EXCLUIDOS_INVERSA_.indexOf(id) !== -1 || vistos[id]) continue;
    vistos[id] = true;
    resultado.push({
      id: id,
      nombre: String(fila[1] == null ? '' : fila[1]).trim() || id,
      tipo: String(fila[4] == null ? '' : fila[4]).trim() || 'Otros'
    });
  }
  return resultado;
}

// Reglas: casilla vacía / 0 / negativa no cuenta; cantidad no entera es un error; tipo fuera del
// catálogo es un error; tipos repetidos se suman; el nombre sale SIEMPRE del catálogo.
function normalizarLineasTorre_(lineas, catalogo) {
  if (!Array.isArray(lineas)) throw new Error('Faltan los soportes de la torre');
  var porId = {};
  catalogo.forEach(function (c) { porId[c.id] = c; });
  var acumulado = {};
  var orden = [];
  lineas.forEach(function (l) {
    var id = String(l && l.id != null ? l.id : '').trim();
    var bruto = l ? l.cantidad : '';
    if (bruto === '' || bruto == null) return;
    var cantidad = Number(bruto);
    if (!isFinite(cantidad) || Math.floor(cantidad) !== cantidad) {
      throw new Error('Cantidad no válida para ' + (id || 'un soporte') + ': ' + bruto);
    }
    if (cantidad <= 0) return;
    if (!porId[id]) throw new Error('Tipo de soporte desconocido: ' + id);
    if (acumulado[id] === undefined) { acumulado[id] = 0; orden.push(id); }
    acumulado[id] += cantidad;
  });
  if (orden.length === 0) throw new Error('La torre no tiene ningún soporte');
  return orden.map(function (id) {
    return { id: id, nombre: porId[id].nombre, cantidad: acumulado[id] };
  });
}

function totalSoportesTorre_(lineas) {
  return lineas.reduce(function (suma, l) { return suma + (Number(l.cantidad) || 0); }, 0);
}

// Total por tipo entre todas las torres pendientes (el resumen "Total precargado").
function resumenPorTipoTorres_(torres) {
  var porId = {};
  torres.forEach(function (t) {
    (t.lineas || []).forEach(function (l) {
      if (!porId[l.id]) porId[l.id] = { id: l.id, nombre: l.nombre, cantidad: 0 };
      porId[l.id].cantidad += Number(l.cantidad) || 0;
    });
  });
  return Object.keys(porId).sort().map(function (id) { return porId[id]; });
}

function fechaIsoONulo_(valor) {
  if (!valor) return null;
  var d = new Date(valor);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```powershell
node --test test/precargaInversa.test.js
```

Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git add PrecargaInversa.gs test/precargaInversa.test.js
git commit -m @'
feat(hodos): nucleo de la Precarga Inversa (validar id, catalogo, lineas de torre) [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

---

## Task 2: Catálogo (lectura con caché) y capa de datos Supabase

**Files:**
- Modify: `PrecargaInversa.gs` (añadir al final)
- Test: `test/precargaInversaDatos.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/precargaInversaDatos.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '', 'Palet'],
  ['S02', 'PALETINA', '', '', 'Palet'],
  ['S16', 'JAULA', '', '', 'Jaula Completa']
];

function cargarDatos(extra) {
  const llamadas = { insertar: [], actualizar: [], borrar: [], get: [], rpc: [] };
  const ctx = Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'ana@taisa.test' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    supaRpc_: (nombre) => { llamadas.rpc.push(nombre); return 'INV-000007'; },
    supaInsertar_: (tabla, filas) => {
      llamadas.insertar.push({ tabla: tabla, filas: filas });
      return filas.map((f) => Object.assign({ fecha_creacion: '2026-10-06T08:00:00Z' }, f));
    },
    supaActualizar_: (tabla, filtro, cambios) => {
      llamadas.actualizar.push({ tabla: tabla, filtro: filtro, cambios: cambios });
      return [{ id_unico: 'INV-000007', lineas: cambios.lineas, total_soportes: cambios.total_soportes, creado_por: 'x', fecha_creacion: '2026-10-06T08:00:00Z' }];
    },
    supaBorrar_: (tabla, filtro) => { llamadas.borrar.push({ tabla: tabla, filtro: filtro }); return [{ id_unico: 'INV-000007' }]; },
    supaGet_: (tabla, filtro, columnas) => { llamadas.get.push({ tabla: tabla, filtro: filtro, columnas: columnas }); return []; }
  }, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PrecargaInversa.gs'), 'utf8'), ctx);
  // Funciones que define el propio .gs: se sustituyen DESPUÉS de cargarlo.
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, llamadas: llamadas };
}

const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

test('obtenerCatalogoInversa: lee la hoja, parsea y guarda en caché 6 horas', () => {
  let guardado = null;
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => null, put: (clave, valor, seg) => { guardado = { clave: clave, valor: valor, seg: seg }; } }) }
  });
  const catalogo = ctx.obtenerCatalogoInversa();
  assert.strictEqual(catalogo.length, 3);
  assert.strictEqual(guardado.seg, 21600);
  assert.strictEqual(JSON.parse(guardado.valor).length, 3);
});

test('obtenerCatalogoInversa: si hay caché no vuelve a leer la hoja', () => {
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => JSON.stringify([{ id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' }]), put: () => {} }) }
  });
  let hojaLeida = 0;
  ctx.leerFilasCatalogoInversa_ = () => { hojaLeida++; return FILAS_CATALOGO; };
  assert.strictEqual(ctx.obtenerCatalogoInversa().length, 1);
  assert.strictEqual(hojaLeida, 0);
});

test('obtenerCatalogoInversa: un catálogo vacío es un error y no se cachea', () => {
  let puesto = false;
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => { puesto = true; } }) }
  });
  ctx.leerFilasCatalogoInversa_ = () => [['ID_Soporte', 'Nombre_Soporte']];
  assert.throws(() => ctx.obtenerCatalogoInversa(), /catálogo de soportes está vacío/);
  assert.strictEqual(puesto, false);
});

test('crearTorreInversa: pide el id, inserta con el nombre del catálogo y devuelve la torre', () => {
  const { ctx, llamadas } = cargarDatos();
  const torre = aLocal(ctx.crearTorreInversa([
    { id: 'S01', cantidad: '5', nombre: 'LO QUE MANDE EL CLIENTE' },
    { id: 'S16', cantidad: 5 }
  ]));
  assert.deepStrictEqual(llamadas.rpc, ['siguiente_id_torre_inversa']);
  assert.strictEqual(llamadas.insertar[0].tabla, 'torres_inversa');
  const fila = llamadas.insertar[0].filas[0];
  assert.strictEqual(fila.id_unico, 'INV-000007');
  assert.strictEqual(fila.total_soportes, 10);
  assert.strictEqual(fila.creado_por, 'ana@taisa.test');
  assert.deepStrictEqual(aLocal(fila.lineas), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 5 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.strictEqual(torre.idUnico, 'INV-000007');
  assert.strictEqual(torre.total, 10);
  assert.strictEqual(torre.fechaCreacion, '2026-10-06T08:00:00Z');
});

test('crearTorreInversa: con líneas inválidas no pide id ni inserta', () => {
  const { ctx, llamadas } = cargarDatos();
  assert.throws(() => ctx.crearTorreInversa([{ id: 'S01', cantidad: '' }]), /ningún soporte/);
  assert.throws(() => ctx.crearTorreInversa([{ id: 'S77', cantidad: 2 }]), /desconocido/);
  assert.strictEqual(llamadas.rpc.length, 0);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('listarTorresInversa: devuelve las torres (más antigua primero) y el resumen por tipo', () => {
  const { ctx, llamadas } = cargarDatos({
    supaGet_: (tabla, filtro) => {
      assert.strictEqual(tabla, 'torres_inversa');
      assert.strictEqual(filtro, 'order=fecha_creacion.asc,id_unico.asc');
      return [
        { id_unico: 'INV-000001', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 17 }], total_soportes: 17, creado_por: 'a', fecha_creacion: '2026-10-06T07:00:00Z' },
        { id_unico: 'INV-000002', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 5 }], total_soportes: 10, creado_por: 'a', fecha_creacion: '2026-10-06T08:00:00Z' }
      ];
    }
  });
  const r = aLocal(ctx.listarTorresInversa());
  assert.strictEqual(r.torres.length, 2);
  assert.strictEqual(r.torres[0].idUnico, 'INV-000001');
  assert.deepStrictEqual(r.resumen, [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 22 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.strictEqual(llamadas.get.length, 0, 'supaGet_ propio del test no debe contarse en llamadas');
});

test('actualizarTorreInversa: reemplaza el contenido y avisa si la torre ya no existe', () => {
  const { ctx, llamadas } = cargarDatos();
  const torre = aLocal(ctx.actualizarTorreInversa('inv-000007', [{ id: 'S02', cantidad: 4 }]));
  assert.strictEqual(llamadas.actualizar[0].filtro, 'id_unico=eq.INV-000007');
  assert.strictEqual(llamadas.actualizar[0].cambios.total_soportes, 4);
  assert.strictEqual(torre.total, 4);

  const { ctx: ctx2 } = cargarDatos({ supaActualizar_: () => [] });
  assert.throws(() => ctx2.actualizarTorreInversa('INV-000007', [{ id: 'S02', cantidad: 4 }]), /ya no existe/);
});

test('borrarTorreInversa: borra por id y avisa si ya no existe; id inválido ni llama', () => {
  const { ctx, llamadas } = cargarDatos();
  assert.deepStrictEqual(aLocal(ctx.borrarTorreInversa('INV-000007')), { ok: true });
  assert.strictEqual(llamadas.borrar[0].filtro, 'id_unico=eq.INV-000007');

  const { ctx: ctx2, llamadas: ll2 } = cargarDatos({ supaBorrar_: () => [] });
  assert.throws(() => ctx2.borrarTorreInversa('INV-000007'), /ya no existe/);
  assert.throws(() => ctx2.borrarTorreInversa('HODOS-000001'), /no válido/);
  assert.strictEqual(ll2.borrar.length, 0);
});

test('contarTorresInversaPendientes: pide solo la columna id_unico y cuenta filas', () => {
  let pedido = null;
  const { ctx } = cargarDatos({
    supaGet_: (tabla, filtro, columnas) => { pedido = { tabla: tabla, filtro: filtro, columnas: columnas }; return [{ id_unico: 'a' }, { id_unico: 'b' }, { id_unico: 'c' }]; }
  });
  assert.strictEqual(ctx.contarTorresInversaPendientes(), 3);
  assert.strictEqual(pedido.tabla, 'torres_inversa');
  assert.strictEqual(pedido.columnas, 'id_unico');
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
node --test test/precargaInversaDatos.test.js
```

Expected: FAIL (`ctx.obtenerCatalogoInversa is not a function`).

- [ ] **Step 3: Implementar catálogo y capa de datos**

Añade al final de `PrecargaInversa.gs`:

```js

// ── Catálogo de soportes (el mismo documento que usa Plataforma) ──────────────────────────

var CATALOGO_INVERSA_SHEET_ID_ = '1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY';
var CATALOGO_INVERSA_PESTANA_ = 'CATALOGO_SOPORTES';
var CATALOGO_INVERSA_CACHE_CLAVE_ = 'catalogo_inversa_v1';
var CATALOGO_INVERSA_CACHE_SEGUNDOS_ = 21600; // 6 h, el máximo de CacheService

// Capa fina sobre SpreadsheetApp (los tests la sustituyen).
function leerFilasCatalogoInversa_() {
  var hoja = SpreadsheetApp.openById(CATALOGO_INVERSA_SHEET_ID_).getSheetByName(CATALOGO_INVERSA_PESTANA_);
  if (!hoja) throw new Error('No se encontró la pestaña ' + CATALOGO_INVERSA_PESTANA_ + ' en el documento de soportes de Plataforma');
  return hoja.getDataRange().getDisplayValues();
}

function obtenerCatalogoInversa() {
  var cache = CacheService.getScriptCache();
  try {
    var guardado = cache.get(CATALOGO_INVERSA_CACHE_CLAVE_);
    if (guardado) return JSON.parse(guardado);
  } catch (e) {
    // Una caché ilegible no debe impedir leer la hoja.
  }
  var catalogo = parsearCatalogoSoportes_(leerFilasCatalogoInversa_());
  if (catalogo.length === 0) throw new Error('El catálogo de soportes está vacío o no se pudo leer');
  try {
    cache.put(CATALOGO_INVERSA_CACHE_CLAVE_, JSON.stringify(catalogo), CATALOGO_INVERSA_CACHE_SEGUNDOS_);
  } catch (e2) {
    // Sin caché solo se pierde velocidad.
  }
  return catalogo;
}

// Para forzar la relectura si el equipo de Plataforma añade un tipo nuevo (se ejecuta a mano
// desde el editor; si no, el catálogo nuevo llega solo en un máximo de 6 horas).
function limpiarCacheCatalogoInversa() {
  CacheService.getScriptCache().remove(CATALOGO_INVERSA_CACHE_CLAVE_);
}

// ── Datos de torres (tabla public.torres_inversa) ─────────────────────────────────────────
// Una fila existe SOLO mientras la torre está pendiente: cargarla es borrarla.

function torreDesdeSupabase_(f) {
  return {
    idUnico: f.id_unico,
    lineas: f.lineas,
    total: f.total_soportes,
    creadoPor: f.creado_por,
    fechaCreacion: f.fecha_creacion
  };
}

function crearTorreInversa(lineas) {
  var limpias = normalizarLineasTorre_(lineas, obtenerCatalogoInversa());
  var idUnico = supaRpc_('siguiente_id_torre_inversa', {});
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
  var filas = supaInsertar_('torres_inversa', [{
    id_unico: idUnico,
    lineas: limpias,
    total_soportes: totalSoportesTorre_(limpias),
    creado_por: creadoPor
  }]);
  if (filas.length === 0) throw new Error('crearTorreInversa: Supabase no devolvió la torre insertada');
  return torreDesdeSupabase_(filas[0]);
}

function listarTorresInversa() {
  var filas = supaGet_('torres_inversa', 'order=fecha_creacion.asc,id_unico.asc');
  var torres = filas.map(torreDesdeSupabase_);
  return { torres: torres, resumen: resumenPorTipoTorres_(torres) };
}

function actualizarTorreInversa(idUnico, lineas) {
  var id = validarIdTorreInversa_(idUnico);
  var limpias = normalizarLineasTorre_(lineas, obtenerCatalogoInversa());
  var filas = supaActualizar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id), {
    lineas: limpias,
    total_soportes: totalSoportesTorre_(limpias)
  });
  if (filas.length === 0) throw new Error('Esa torre ya no existe (puede que ya se haya cargado en un camión)');
  return torreDesdeSupabase_(filas[0]);
}

function borrarTorreInversa(idUnico) {
  var id = validarIdTorreInversa_(idUnico);
  var borradas = supaBorrar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id));
  if (borradas.length === 0) throw new Error('Esa torre ya no existe (puede que ya se haya cargado en un camión)');
  return { ok: true };
}

// Para la insignia de la barra lateral: solo la columna id_unico (el egress de Supabase
// importa: el proyecto está en plan Free).
function contarTorresInversaPendientes() {
  return supaGet_('torres_inversa', 'order=id_unico.asc', 'id_unico').length;
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```powershell
node --test test/precargaInversaDatos.test.js test/precargaInversa.test.js
```

Expected: todos en verde, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git add PrecargaInversa.gs test/precargaInversaDatos.test.js
git commit -m @'
feat(hodos): catalogo de soportes con cache y capa de datos de torres [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

---

## Task 3: Etiqueta de la torre

**Files:**
- Modify: `PrecargaInversa.gs` (añadir al final)
- Modify: `Backend.gs` (2 líneas de `envolverEtiquetasHtml_`)
- Test: `test/precargaInversaEtiqueta.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/precargaInversaEtiqueta.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Utilidades, Barcode y Backend son los de verdad (puros); lo de Google y Supabase, stubs.
function cargarEtiqueta(extra) {
  const ctx = Object.assign({
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.c' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  }, extra);
  vm.createContext(ctx);
  ['Utilidades.gs', 'Barcode.gs', 'Backend.gs', 'PrecargaInversa.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  });
  return ctx;
}

const lineas = (n) => Array.from({ length: n }, (_, i) => ({ id: 'S' + (i + 1), nombre: 'TIPO ' + (i + 1), cantidad: i + 1 }));
const torre = (ls) => ({
  idUnico: 'INV-000007',
  lineas: ls,
  total: ls.reduce((s, l) => s + l.cantidad, 0),
  fechaCreacion: '2026-10-06T08:00:00Z'
});

test('claseTamanoLineasInversa_: letra más pequeña cuantas más líneas', () => {
  const ctx = cargarEtiqueta();
  [1, 2, 3, 4].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-g', String(n)));
  [5, 6].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-m', String(n)));
  [7, 8, 9].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-p', String(n)));
  [10, 14, 30].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-xp', String(n)));
});

test('htmlUnaTorreInversa_: id, destino, desglose, total y código de barras', () => {
  const ctx = cargarEtiqueta();
  const html = ctx.htmlUnaTorreInversa_(torre([
    { id: 'S01', nombre: 'EUROPEO', cantidad: 5 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]), '06/10/2026');
  assert.match(html, /INV-000007/);
  assert.match(html, /INVERSA · TORIJA/);
  assert.match(html, /<span class="inv-cant">5<\/span><span class="inv-nom">EUROPEO<\/span>/);
  assert.match(html, /<span class="inv-cant">5<\/span><span class="inv-nom">JAULA<\/span>/);
  assert.match(html, /TOTAL: 10 SOPORTES/);
  assert.match(html, /Creada: 06\/10\/2026/);
  assert.match(html, /<svg/);
  assert.match(html, /class="inv-lista inv-g"/);
  assert.ok(!/inv-dos-col/.test(html));
});

test('htmlUnaTorreInversa_: singular, dos columnas y letra pequeña con muchas líneas', () => {
  const ctx = cargarEtiqueta();
  assert.match(ctx.htmlUnaTorreInversa_(torre([{ id: 'S01', nombre: 'EUROPEO', cantidad: 1 }]), 'x'), /TOTAL: 1 SOPORTE</);
  const nueve = ctx.htmlUnaTorreInversa_(torre(lineas(9)), 'x');
  assert.match(nueve, /class="inv-lista inv-p inv-dos-col"/);
  const doce = ctx.htmlUnaTorreInversa_(torre(lineas(12)), 'x');
  assert.match(doce, /class="inv-lista inv-xp inv-dos-col"/);
});

test('htmlUnaTorreInversa_: escapa el nombre de los soportes', () => {
  const ctx = cargarEtiqueta();
  const html = ctx.htmlUnaTorreInversa_(torre([{ id: 'S01', nombre: '<b>MALO</b>', cantidad: 2 }]), 'x');
  assert.ok(!/<b>MALO/.test(html));
  assert.match(html, /&lt;b&gt;MALO&lt;\/b&gt;/);
});

test('htmlEtiquetasTorresInversa: pide las torres por id e incluye el CSS propio de la torre', () => {
  let pedido = null;
  const ctx = cargarEtiqueta({
    supaGet_: (tabla, filtro) => {
      pedido = { tabla: tabla, filtro: filtro };
      return [{ id_unico: 'INV-000007', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 3 }], total_soportes: 3, creado_por: 'a', fecha_creacion: '2026-10-06T08:00:00Z' }];
    }
  });
  const html = ctx.htmlEtiquetasTorresInversa(['inv-000007']);
  assert.strictEqual(pedido.tabla, 'torres_inversa');
  assert.strictEqual(pedido.filtro, 'id_unico=in.(INV-000007)&order=id_unico.asc');
  assert.match(html, /@page\{size:100mm 150mm;margin:0;\}/);
  assert.match(html, /\.inv-lista\{/);
  assert.match(html, /INV-000007/);
});

test('htmlEtiquetasTorresInversa: sin ids o sin torres encontradas es un error legible', () => {
  const ctx = cargarEtiqueta({ supaGet_: () => [] });
  assert.throws(() => ctx.htmlEtiquetasTorresInversa([]), /Faltan las torres/);
  assert.throws(() => ctx.htmlEtiquetasTorresInversa(['INV-000007']), /ya no existen/);
  assert.throws(() => ctx.htmlEtiquetasTorresInversa(['HODOS-000001']), /no válido/);
});

test('envolverEtiquetasHtml_: sin CSS extra la salida no cambia; con CSS extra lo añade dentro del <style>', () => {
  const ctx = cargarEtiqueta();
  const base = ctx.envolverEtiquetasHtml_('<x>');
  assert.ok(!/EXTRA/.test(base));
  const conExtra = ctx.envolverEtiquetasHtml_('<x>', '.EXTRA{color:red;}');
  assert.ok(conExtra.indexOf('.EXTRA{color:red;}') > conExtra.indexOf('.barcode-wrap'));
  assert.ok(conExtra.indexOf('.EXTRA{color:red;}') < conExtra.indexOf('</style>'));
  assert.strictEqual(conExtra.replace('.EXTRA{color:red;}', ''), base);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
node --test test/precargaInversaEtiqueta.test.js
```

Expected: FAIL (`ctx.claseTamanoLineasInversa_ is not a function`).

- [ ] **Step 3: Ampliar `envolverEtiquetasHtml_` en `Backend.gs`**

En `Backend.gs`, cambia la firma y la línea del `<style>` (dos ediciones, ambas únicas en el archivo):

Antes:

```js
function envolverEtiquetasHtml_(tarjetas) {
```

Después:

```js
function envolverEtiquetasHtml_(tarjetas, estiloExtra) {
```

Antes:

```js
  partes.push('<' + 'style>' + estilo + '<' + '/style>');
```

Después:

```js
  partes.push('<' + 'style>' + estilo + (estiloExtra || '') + '<' + '/style>');
```

- [ ] **Step 4: Añadir la etiqueta al final de `PrecargaInversa.gs`**

```js

// ── Etiqueta Zebra 100x150 de la torre ────────────────────────────────────────────────────
// Usa el mismo marco de impresión que el resto de etiquetas (envolverEtiquetasHtml_, @page
// 100x150 con el contenido rotado). Aquí solo se define el interior y su CSS propio.

var ESTILO_ETIQUETA_TORRE_INVERSA_ = [
  '.inv-lista{display:grid;grid-template-columns:1fr;gap:1mm 6mm;align-content:center;padding:0 4mm;}',
  '.inv-lista.inv-dos-col{grid-template-columns:1fr 1fr;}',
  '.inv-linea{display:flex;align-items:baseline;gap:3mm;font-weight:800;}',
  '.inv-cant{min-width:12mm;text-align:right;font-size:1.25em;}',
  '.inv-nom{text-transform:uppercase;}',
  '.inv-g{font-size:24px;}.inv-m{font-size:19px;}.inv-p{font-size:15px;}.inv-xp{font-size:12px;}',
  '.inv-total{font-size:20px;font-weight:900;text-align:center;border-top:2px solid #000;padding-top:1mm;}'
].join('');

// Cuantas más líneas, más pequeña la letra; a partir de 7 se reparten en dos columnas.
function claseTamanoLineasInversa_(n) {
  if (n <= 4) return 'inv-g';
  if (n <= 6) return 'inv-m';
  if (n <= 9) return 'inv-p';
  return 'inv-xp';
}

function htmlUnaTorreInversa_(torre, fechaTxt) {
  var n = torre.lineas.length;
  var barcodeSvg = code128SVG(String(torre.idUnico), { anchoModulo: 2, alto: 60 });
  var lineasHtml = torre.lineas.map(function (l) {
    return '<div class="inv-linea"><span class="inv-cant">' + esc_(l.cantidad) + '</span><span class="inv-nom">' + esc_(l.nombre) + '</span></div>';
  }).join('');
  var clases = 'inv-lista ' + claseTamanoLineasInversa_(n) + (n > 6 ? ' inv-dos-col' : '');
  return '' +
    '<div class="etiqueta-wrapper"><div class="etiqueta">' +
    '<div class="etiqueta-top">' +
    '<img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" class="logo-taisa">' +
    '<div class="fecha-id">Creada: ' + esc_(fechaTxt) + '<div class="id-unico">' + esc_(torre.idUnico) + '</div></div>' +
    '</div>' +
    '<div class="tienda-destino">INVERSA · TORIJA</div>' +
    '<div class="' + clases + '">' + lineasHtml + '</div>' +
    '<div class="inv-total">TOTAL: ' + esc_(torre.total) + (Number(torre.total) === 1 ? ' SOPORTE' : ' SOPORTES') + '</div>' +
    '<div class="etiqueta-bottom"><div class="barcode-wrap">' + barcodeSvg + '</div></div>' +
    '</div></div>';
}

function htmlEtiquetasTorresInversa(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Faltan las torres a imprimir');
  var limpios = ids.map(validarIdTorreInversa_);
  var filas = supaGet_('torres_inversa', 'id_unico=in.(' + limpios.map(encodeURIComponent).join(',') + ')&order=id_unico.asc');
  if (filas.length === 0) throw new Error('Esas torres ya no existen (puede que ya se hayan cargado en un camión)');
  var tarjetas = filas.map(function (f) {
    var torre = torreDesdeSupabase_(f);
    var fechaTxt = Utilities.formatDate(new Date(torre.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaTorreInversa_(torre, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas, ESTILO_ETIQUETA_TORRE_INVERSA_);
}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```powershell
node --test test/precargaInversaEtiqueta.test.js test/backendAdmin.test.js
```

Expected: todo en verde (`backendAdmin` comprueba que el cambio de `envolverEtiquetasHtml_` no rompe las etiquetas actuales).

- [ ] **Step 6: Comprobar a ojo cómo queda la etiqueta**

Crea `$env:TEMP\inversa_preview\render_etiquetas.js` (fuera del repo):

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\inversa_preview" | Out-Null
@'
const fs = require('fs');
const vm = require('vm');
const raiz = 'C:/Users/30081048/Desktop/Proyectos/hodos/';
const ctx = { Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } };
vm.createContext(ctx);
['Utilidades.gs', 'Barcode.gs', 'Backend.gs', 'PrecargaInversa.gs'].forEach((f) => vm.runInContext(fs.readFileSync(raiz + f, 'utf8'), ctx));
const nombres = ['EUROPEO', 'PALETINA', 'JAULA', 'SVR (COMPLETO)', 'SVP (COMPLETO)', 'CESTAS PLEGABLES', 'MAGNUM', 'MAXI-PACK', 'LEAN', 'CARRO', 'BOX PALET', 'AMERICANO', 'CONCERTINA', 'MANURACK'];
const torre = (n) => {
  const ls = nombres.slice(0, n).map((nombre, i) => ({ id: 'S' + i, nombre: nombre, cantidad: i === 0 ? 17 : i + 1 }));
  return { idUnico: 'INV-0000' + (10 + n), lineas: ls, total: ls.reduce((s, l) => s + l.cantidad, 0), fechaCreacion: '2026-10-06T08:00:00Z' };
};
const tarjetas = [1, 3, 8, 14].map((n) => ctx.htmlUnaTorreInversa_(torre(n), '06/10/2026')).join('\n');
fs.writeFileSync(process.env.TEMP + '/inversa_preview/etiquetas.html', ctx.envolverEtiquetasHtml_(tarjetas, ctx.ESTILO_ETIQUETA_TORRE_INVERSA_));
console.log('ok');
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\render_etiquetas.js"
node "$env:TEMP\inversa_preview\render_etiquetas.js"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --screenshot="$env:TEMP\inversa_preview\etiquetas.png" --window-size=420,2400 --virtual-time-budget=3000 "file:///$($env:TEMP -replace '\\','/')/inversa_preview/etiquetas.html"
```

Expected: imprime `ok` y se crea `etiquetas.png`. Ábrelo con la herramienta de lectura de imágenes: deben verse 4 etiquetas (1, 3, 8 y 14 líneas), apaisadas (giradas 90° respecto al lienzo, como en papel), sin texto cortado ni solapado entre el desglose, el total y el código de barras. **Si alguna línea se corta o el total pisa el código de barras**, baja los tamaños de `.inv-g/.inv-m/.inv-p/.inv-xp` (p. ej. 24→22, 19→17, 15→14, 12→11) en `ESTILO_ETIQUETA_TORRE_INVERSA_`, regenera y vuelve a mirar. Ajusta solo CSS, no la lógica.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git diff --stat Backend.gs
git add PrecargaInversa.gs Backend.gs test/precargaInversaEtiqueta.test.js
git commit -m @'
feat(hodos): etiqueta Zebra de la torre y CSS extra opcional en envolverEtiquetasHtml_ [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

(`git diff --stat Backend.gs` debe mostrar solo 2 líneas cambiadas; si muestra más, hay cambios ajenos: parar y avisar.)

---

## Task 4: Webhook `consumirTorreInversa` / `devolverTorreInversa`

**Files:**
- Modify: `PrecargaInversa.gs` (añadir al final)
- Modify: `IntegracionIncpc.gs` (3 líneas en `doPost`)
- Test: `test/precargaInversaWebhook.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/precargaInversaWebhook.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '', 'Palet'],
  ['S16', 'JAULA', '', '', 'Jaula Completa']
];

// Tabla en memoria: permite probar el consumo único de verdad (la segunda llamada no encuentra nada).
function cargarConTabla(filasIniciales, extra) {
  const tabla = filasIniciales.slice();
  const llamadas = { borrar: [], insertar: [] };
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '06/10/2026' },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    supaBorrar_: (nombreTabla, filtro) => {
      llamadas.borrar.push({ tabla: nombreTabla, filtro: filtro });
      const id = decodeURIComponent(filtro.split('eq.')[1]);
      const i = tabla.findIndex((f) => f.id_unico === id);
      return i === -1 ? [] : tabla.splice(i, 1);
    },
    supaInsertar_: (nombreTabla, filas) => {
      llamadas.insertar.push({ tabla: nombreTabla, filas: filas });
      filas.forEach((f) => {
        if (tabla.some((t) => t.id_unico === f.id_unico)) {
          throw new Error('supaInsertar_(torres_inversa): {"code":"23505","message":"duplicate key value violates unique constraint"}');
        }
        tabla.push(f);
      });
      return filas;
    }
  }, extra);
  vm.createContext(ctx);
  ['Utilidades.gs', 'PrecargaInversa.gs', 'IntegracionIncpc.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  });
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, tabla: tabla, llamadas: llamadas };
}

function llamarDoPost(ctx, cuerpo) {
  const resp = ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(resp.getContent());
}

const TORRE = {
  id_unico: 'INV-000007',
  lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 5 }],
  total_soportes: 10,
  creado_por: 'ana@taisa.test',
  fecha_creacion: '2026-10-06T08:00:00.000Z'
};

test('consumirTorreInversa: borra la torre y devuelve su contenido', () => {
  const { ctx, tabla, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'inv-000007' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.id, 'INV-000007');
  assert.strictEqual(r.total, 10);
  assert.strictEqual(r.lineas.length, 2);
  assert.strictEqual(r.lineas[0].nombre, 'EUROPEO');
  assert.strictEqual(r.creadaEn, '2026-10-06T08:00:00.000Z');
  assert.strictEqual(tabla.length, 0);
  assert.strictEqual(llamadas.borrar[0].tabla, 'torres_inversa');
  assert.strictEqual(llamadas.borrar[0].filtro, 'id_unico=eq.INV-000007');
});

test('consumirTorreInversa: dos bips de la misma torre — solo el primero la consume', () => {
  const { ctx } = cargarConTabla([Object.assign({}, TORRE)]);
  const primero = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000007' });
  const segundo = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000007' });
  assert.strictEqual(primero.ok, true);
  assert.strictEqual(segundo.ok, false);
  assert.strictEqual(segundo.motivo, 'NO_EXISTE');
});

test('consumirTorreInversa: torre inexistente -> NO_EXISTE', () => {
  const { ctx } = cargarConTabla([]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000999' });
  assert.deepStrictEqual(r, { ok: false, motivo: 'NO_EXISTE' });
});

test('consumirTorreInversa: código que no es de torre -> error legible y no toca Supabase', () => {
  const { ctx, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'HODOS-000001' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no válido/);
  assert.strictEqual(llamadas.borrar.length, 0);
});

test('consumir/devolver: token inválido no ejecuta nada', () => {
  const { ctx, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  ['consumirTorreInversa', 'devolverTorreInversa'].forEach((accion) => {
    const r = llamarDoPost(ctx, { accion: accion, token: 'malo', id: 'INV-000007', lineas: TORRE.lineas });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /[Tt]oken/);
  });
  assert.strictEqual(llamadas.borrar.length, 0);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('devolverTorreInversa: recrea la torre con el mismo id, validando contra el catálogo', () => {
  const { ctx, tabla, llamadas } = cargarConTabla([]);
  const r = llamarDoPost(ctx, {
    accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007',
    lineas: [{ id: 'S01', nombre: 'LO QUE SEA', cantidad: 5 }, { id: 'S16', cantidad: 5 }],
    creadaEn: '2026-10-06T08:00:00Z'
  });
  assert.deepStrictEqual(r, { ok: true, id: 'INV-000007' });
  assert.strictEqual(tabla.length, 1);
  const fila = llamadas.insertar[0].filas[0];
  assert.strictEqual(fila.id_unico, 'INV-000007');
  assert.strictEqual(fila.total_soportes, 10);
  assert.strictEqual(fila.fecha_creacion, '2026-10-06T08:00:00.000Z');
  assert.strictEqual(fila.lineas[0].nombre, 'EUROPEO', 'el nombre sale del catálogo, no del cliente');
});

test('devolverTorreInversa: si la torre ya existe -> YA_EXISTE y no la toca', () => {
  const { ctx, tabla } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007', lineas: [{ id: 'S01', cantidad: 1 }] });
  assert.deepStrictEqual(r, { ok: false, motivo: 'YA_EXISTE' });
  assert.strictEqual(tabla.length, 1);
  assert.strictEqual(tabla[0].total_soportes, 10);
});

test('devolverTorreInversa: líneas inválidas o tipo desconocido -> error y no inserta', () => {
  const { ctx, llamadas } = cargarConTabla([]);
  const mal = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007', lineas: [{ id: 'S77', cantidad: 1 }] });
  assert.strictEqual(mal.ok, false);
  assert.match(mal.error, /desconocido/);
  const sin = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007' });
  assert.strictEqual(sin.ok, false);
  assert.match(sin.error, /Faltan los soportes/);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('devolverTorreInversa: sin fecha válida no manda fecha_creacion (la pone la base)', () => {
  const { ctx, llamadas } = cargarConTabla([]);
  llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000008', lineas: [{ id: 'S01', cantidad: 2 }], creadaEn: 'basura' });
  assert.ok(!('fecha_creacion' in llamadas.insertar[0].filas[0]));
});

test('devolverTorreInversa: un error de Supabase distinto de duplicado sube como error', () => {
  const { ctx } = cargarConTabla([], {
    supaInsertar_: () => { throw new Error('supaInsertar_(torres_inversa): connection refused'); }
  });
  const r = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000009', lineas: [{ id: 'S01', cantidad: 2 }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /connection refused/);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
node --test test/precargaInversaWebhook.test.js
```

Expected: FAIL (el `doPost` actual responde con la rama final `crearEtiquetaDesdeIncpc_` y los tests no cuadran).

- [ ] **Step 3: Implementar `procesarAccionInversa_`**

Añade al final de `PrecargaInversa.gs`:

```js

// ── Webhook para la app de Plataforma ─────────────────────────────────────────────────────
// doPost (IntegracionIncpc.gs) valida el token compartido y delega aquí estas dos acciones.
//
//  consumirTorreInversa {id}            -> borra la torre y devuelve su contenido. El DELETE con
//                                           return=representation es atómico: si dos bips llegan a
//                                           la vez, solo uno recibe la fila; el otro, NO_EXISTE.
//  devolverTorreInversa {id,lineas,creadaEn} -> deshace un consumo recreando la torre con el MISMO
//                                           id (la etiqueta física sigue siendo válida).
function procesarAccionInversa_(datos) {
  var id = validarIdTorreInversa_(datos.id);

  if (datos.accion === 'consumirTorreInversa') {
    var borradas = supaBorrar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id));
    if (borradas.length === 0) return { ok: false, motivo: 'NO_EXISTE' };
    var torre = torreDesdeSupabase_(borradas[0]);
    return { ok: true, id: torre.idUnico, lineas: torre.lineas, total: torre.total, creadaEn: torre.fechaCreacion };
  }

  if (datos.accion === 'devolverTorreInversa') {
    var lineas = normalizarLineasTorre_(datos.lineas, obtenerCatalogoInversa());
    var fila = {
      id_unico: id,
      lineas: lineas,
      total_soportes: totalSoportesTorre_(lineas),
      creado_por: 'devuelta desde Plataforma'
    };
    var creadaEn = fechaIsoONulo_(datos.creadaEn);
    if (creadaEn) fila.fecha_creacion = creadaEn;
    try {
      supaInsertar_('torres_inversa', [fila]);
    } catch (e) {
      if (/23505|duplicate key/i.test(String(e && e.message))) return { ok: false, motivo: 'YA_EXISTE' };
      throw e;
    }
    return { ok: true, id: id };
  }

  throw new Error('Acción de inversa desconocida: ' + datos.accion);
}
```

- [ ] **Step 4: Enrutar en `doPost` (`IntegracionIncpc.gs`)**

Antes:

```js
    } else if (datos.accion === 'marcarImpresasPreparacion') {
      respuesta = { ok: true, resultado: marcarImpresasPreparacionPorIds_(datos.idsUnicos) };
    } else {
```

Después:

```js
    } else if (datos.accion === 'marcarImpresasPreparacion') {
      respuesta = { ok: true, resultado: marcarImpresasPreparacionPorIds_(datos.idsUnicos) };
    // Precarga Inversa (2026-10-06): la app de Plataforma consume/devuelve torres al
    // bipar su etiqueta en el camión de Torija. Ver PrecargaInversa.gs.
    } else if (datos.accion === 'consumirTorreInversa' || datos.accion === 'devolverTorreInversa') {
      respuesta = procesarAccionInversa_(datos);
    } else {
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

```powershell
node --test test/precargaInversaWebhook.test.js test/integracionArrastresWebhook.test.js test/contarPendientesPorPestana.test.js
```

Expected: todo en verde (los otros dos comprueban que el enrutado existente sigue igual).

- [ ] **Step 6: Prueba de mutación del consumo atómico**

Comprueba que el test detecta una implementación incorrecta:

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
Copy-Item PrecargaInversa.gs "$env:TEMP\PrecargaInversa.gs.bak"
(Get-Content PrecargaInversa.gs -Raw) -replace "if \(borradas\.length === 0\) return \{ ok: false, motivo: 'NO_EXISTE' \};", "" | Set-Content -NoNewline -Encoding utf8 PrecargaInversa.gs
node --test test/precargaInversaWebhook.test.js
```

Expected: FALLA (al menos "dos bips de la misma torre" y "torre inexistente"). Restaura el original y comprueba que vuelve a pasar:

```powershell
Copy-Item "$env:TEMP\PrecargaInversa.gs.bak" PrecargaInversa.gs -Force
node --test test/precargaInversaWebhook.test.js
git diff --stat PrecargaInversa.gs
```

Expected: tests en verde y `git diff --stat` muestra solo las líneas añadidas en el Step 3 (sin cambios por la mutación).

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git diff --stat IntegracionIncpc.gs
git add PrecargaInversa.gs IntegracionIncpc.gs test/precargaInversaWebhook.test.js
git commit -m @'
feat(hodos): acciones consumirTorreInversa y devolverTorreInversa en el webhook [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

(`git diff --stat IntegracionIncpc.gs` debe mostrar 4 líneas añadidas y 0 borradas; si no, parar y avisar.)

---

## Task 5: Pestaña "Precarga Inversa" en `Index.html`

**Files:**
- Modify: `Index.html`
- Test: `test/indexInversa.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/indexInversa.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

// El JS de la pestaña va entre dos marcas para poder probarlo aparte.
function bloqueInversa() {
  const m = /\/\/ ══ PRECARGA INVERSA: inicio ══([\s\S]*?)\/\/ ══ PRECARGA INVERSA: fin ══/.exec(html);
  assert.ok(m, 'faltan las marcas de inicio/fin del bloque JS de Precarga Inversa');
  return m[1];
}

const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

test('Index.html: botón de la barra lateral, insignia y vista de la Precarga Inversa', () => {
  assert.match(html, /data-tab="inversa"/);
  assert.match(html, /onclick="cambiarPestana\('inversa'\)"/);
  assert.match(html, /id="badge-inversa"/);
  assert.match(html, /id="vistaInversa" class="vista-oculta"/);
  ['inversaFormulario', 'inversaCatalogo', 'inversaTotalForm', 'btnInversaGuardar', 'btnInversaCancelarEdicion',
    'inversaContador', 'inversaResumenTipos', 'inversaListaTorres'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'falta id=' + id);
  });
});

test('cambiarPestana: muestra/oculta la vista inversa y carga sus datos', () => {
  assert.match(html, /getElementById\('vistaInversa'\)\.classList\.toggle\('vista-oculta', nombre !== 'inversa'\)/);
  assert.match(html, /if \(nombre === 'inversa'\) \{ cargarPestanaInversa_\(\); \}/);
});

test('el bloque JS de la Precarga Inversa parsea y no usa diálogos nativos', () => {
  const codigo = bloqueInversa();
  assert.doesNotThrow(() => new Function(codigo));
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(codigo), 'no debe usar alert/confirm/prompt');
});

test('pintarBadge_ admite un título propio y actualizarBadges_ cuenta también las torres', () => {
  assert.match(html, /function pintarBadge_\(tab, cantidad, titulo\)/);
  assert.match(html, /el\.title = titulo \|\| \(n \+ ' etiqueta\(s\) pendiente\(s\) de imprimir'\);/);
  assert.match(html, /gas\('contarTorresInversaPendientes'\)/);
});

test('agruparCatalogoInversa_ agrupa por tipo en el orden en que aparecen', () => {
  // El bloque engancha tres eventos al cargar: un document de mentira basta para ejecutarlo en vm.
  const ctx = { document: { getElementById: () => ({ addEventListener: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(bloqueInversa(), ctx);
  const grupos = aLocal(ctx.agruparCatalogoInversa_([
    { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' },
    { id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa' },
    { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' }
  ]));
  assert.deepStrictEqual(grupos, [
    { tipo: 'Palet', items: [{ id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' }, { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' }] },
    { tipo: 'Jaula Completa', items: [{ id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa' }] }
  ]);
});

test('textoDesgloseInversa_ junta las líneas con "cantidad × nombre"', () => {
  // El bloque engancha tres eventos al cargar: un document de mentira basta para ejecutarlo en vm.
  const ctx = { document: { getElementById: () => ({ addEventListener: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(bloqueInversa(), ctx);
  assert.strictEqual(
    ctx.textoDesgloseInversa_([{ nombre: 'EUROPEO', cantidad: 5 }, { nombre: 'JAULA', cantidad: 5 }]),
    '5 × EUROPEO · 5 × JAULA'
  );
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
node --test test/indexInversa.test.js
```

Expected: FAIL (no existe `data-tab="inversa"`).

- [ ] **Step 3: Aplicar los cambios a `Index.html` con un script que verifica cada ancla**

Crea `$env:TEMP\inversa_preview\inversa_index.py` (cada sustitución exige exactamente 1 aparición del texto original: si el archivo cambió de forma inesperada, el script se detiene sin editar a ciegas):

```powershell
@'
import sys
ruta = sys.argv[1]
s = open(ruta, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

def uno(viejo, nuevo):
    global s
    viejo = viejo.replace('\n', nl)
    nuevo = nuevo.replace('\n', nl)
    c = s.count(viejo)
    assert c == 1, (viejo[:80], 'esperaba 1, hay', c)
    s = s.replace(viejo, nuevo)

# 1) botón de la barra lateral (después de Antequera)
uno("""      <span class="tab-badge vista-oculta" id="badge-antequera"></span>
    </button>
  </nav>""",
"""      <span class="tab-badge vista-oculta" id="badge-antequera"></span>
    </button>
    <div class="sidebar-rotulo">Inversa</div>
    <button class="sub" data-tab="inversa" onclick="cambiarPestana('inversa')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="17" width="16" height="4" rx="1"/></svg>
      <span>Precarga Inversa</span>
      <span class="tab-badge vista-oculta" id="badge-inversa"></span>
    </button>
  </nav>""")

# 2) la vista (antes de Pendientes)
uno("""    <div id="vistaPendientes" class="vista-oculta">""",
"""    <!-- ══════════ VISTA: PRECARGA INVERSA ══════════
         Torres de soportes (mezcla de tipos) para la inversa a Torija. Se imprimen con
         etiqueta y desaparecen de aquí cuando la app de Plataforma las bipa al cargar. -->
    <div id="vistaInversa" class="vista-oculta">
      <div class="section" id="inversaFormulario">
        <h2 id="inversaTituloForm">Nueva torre</h2>
        <p class="hint-texto">Indica cuántos soportes de cada tipo lleva la torre. Las casillas vacías no cuentan.</p>
        <div id="inversaCatalogo"><p class="cargando-resultados">Cargando catálogo…</p></div>
        <div class="inversa-resumen-form">Total de la torre: <strong id="inversaTotalForm">0</strong> soportes</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button type="button" class="btn-secundario vista-oculta" id="btnInversaCancelarEdicion" onclick="cancelarEdicionInversa_()">Cancelar edición</button>
          <button type="button" class="btn-primary" id="btnInversaGuardar" onclick="guardarTorreUI_()" style="flex:1;margin-top:0;">Crear e imprimir etiqueta</button>
        </div>
      </div>
      <div class="section" style="margin-top:20px;">
        <h2 style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <span>Torres precargadas <span class="pendientes-contador" id="inversaContador"></span></span>
          <button type="button" class="btn-link" onclick="cargarTorresInversa_()" title="Actualizar">Actualizar</button>
        </h2>
        <div id="inversaResumenTipos" class="inversa-resumen-tipos"></div>
        <div class="resultados-wrap"><div id="inversaListaTorres"></div></div>
      </div>
    </div>

    <div id="vistaPendientes" class="vista-oculta">""")

# 3) CSS (antes de .vista-oculta)
uno("""    .vista-oculta { display:none !important; }""",
"""    /* Precarga Inversa */
    .inversa-grupo { margin-bottom:18px; }
    .inversa-grupo h3 { font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-accent-text); margin:0 0 8px; }
    .inversa-fila { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px; border:1px solid var(--input-border); border-radius:8px; background:var(--input-bg); margin-bottom:6px; }
    .inversa-fila.con-cantidad { border-color:var(--color-accent); }
    .inversa-nombre { font-weight:600; font-size:14px; }
    .inversa-cantidad { display:flex; align-items:center; gap:6px; }
    .inversa-fila input[type=number] { width:72px; text-align:center; font-size:16px; padding:8px; }
    .inversa-paso { width:38px; height:38px; border-radius:8px; border:1px solid var(--input-border); background:var(--bg-panel); color:var(--text-primary); font-size:20px; cursor:pointer; }
    .inversa-resumen-form { margin:14px 0; font-size:14px; }
    .inversa-resumen-tipos { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
    .inversa-chip { border:1px solid var(--input-border); border-radius:999px; padding:4px 12px; font-size:12.5px; background:var(--bg-panel); }
    .inversa-chip strong { color:var(--color-accent-text); }
    .inversa-desglose { font-size:13px; }
    .inversa-acciones { display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap; }
    .vista-oculta { display:none !important; }""")

# 4) pintarBadge_ con título opcional
uno("""  function pintarBadge_(tab, cantidad) {""", """  function pintarBadge_(tab, cantidad, titulo) {""")
uno("""    el.title = n + ' etiqueta(s) pendiente(s) de imprimir';""",
    """    el.title = titulo || (n + ' etiqueta(s) pendiente(s) de imprimir');""")

# 5) actualizarBadges_ cuenta también las torres
uno("""    var inicio = ++secuenciaBadges_;
    gas('contarEtiquetasPendientesPorPestana').then(function (cuentas) {""",
"""    var inicio = ++secuenciaBadges_;
    gas('contarTorresInversaPendientes').then(function (n) {
      // Igual que las demás: si la lista se cargó mientras esta consulta estaba en vuelo, manda la lista.
      if ((badgeDeListaSeq_.inversa || 0) > inicio) return;
      pintarBadgeInversa_(n, false);
    }).catch(function (err) {
      console.error('No se pudo contar las torres de la Precarga Inversa:', err);
    });
    gas('contarEtiquetasPendientesPorPestana').then(function (cuentas) {""")

# 6) cambiarPestana
uno("""    document.getElementById('vistaAntequera').classList.toggle('vista-oculta', nombre !== 'antequera');""",
"""    document.getElementById('vistaAntequera').classList.toggle('vista-oculta', nombre !== 'antequera');
    document.getElementById('vistaInversa').classList.toggle('vista-oculta', nombre !== 'inversa');""")
uno("""    if (ARRASTRES_[nombre]) { cargarArrastre_(nombre); }""",
"""    if (ARRASTRES_[nombre]) { cargarArrastre_(nombre); }
    if (nombre === 'inversa') { cargarPestanaInversa_(); }""")

# 7) bloque JS (antes de cargarIncpc_)
BLOQUE_JS = open(sys.argv[2], encoding='utf-8-sig').read()  # utf-8-sig: PowerShell escribe el archivo con BOM y no debe colarse en Index.html
uno("""  function cargarIncpc_() {""", BLOQUE_JS.rstrip('\n') + "\n\n  function cargarIncpc_() {")

open(ruta, 'w', encoding='utf-8', newline='').write(s)
print('TODO APLICADO', ruta)
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\inversa_index.py"
```

Crea el bloque JS en `$env:TEMP\inversa_preview\bloque_inversa.js` (será el texto insertado en `Index.html`):

```powershell
@'
  // ══ PRECARGA INVERSA: inicio ══
  // Pestaña "Precarga Inversa": crear torres de soportes (mezcla de tipos del catálogo de
  // Plataforma), imprimir su etiqueta y gestionar las pendientes. Una torre desaparece de aquí
  // cuando la app de Plataforma la bipa al cargar el camión de Torija. HODOS no genera informe.
  // Spec: docs/superpowers/specs/2026-10-06-precarga-inversa-design.md
  var catalogoInversa_ = null;         // [{id, nombre, tipo}], se pide una vez
  var formularioInversaPintado_ = false;
  var torreEnEdicionInversa_ = null;   // idUnico de la torre que se edita, o null
  var torresInversa_ = [];             // última lista recibida del servidor

  function agruparCatalogoInversa_(catalogo) {
    var grupos = [];
    var porTipo = {};
    catalogo.forEach(function (c) {
      if (!porTipo[c.tipo]) { porTipo[c.tipo] = { tipo: c.tipo, items: [] }; grupos.push(porTipo[c.tipo]); }
      porTipo[c.tipo].items.push(c);
    });
    return grupos;
  }

  function textoDesgloseInversa_(lineas) {
    return lineas.map(function (l) { return l.cantidad + ' × ' + l.nombre; }).join(' · ');
  }

  function buscarInputInversa_(id) {
    var inputs = document.querySelectorAll('#inversaCatalogo input[data-id]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute('data-id') === id) return inputs[i];
    }
    return null;
  }

  function pintarBadgeInversa_(cantidad, desdeLista) {
    if (desdeLista) badgeDeListaSeq_.inversa = ++secuenciaBadges_;
    pintarBadge_('inversa', cantidad, (Number(cantidad) || 0) + ' torre(s) pendiente(s) de cargar');
  }

  function pintarFormularioInversa_() {
    if (formularioInversaPintado_) return Promise.resolve();
    var cont = document.getElementById('inversaCatalogo');
    return gas('obtenerCatalogoInversa').then(function (catalogo) {
      catalogoInversa_ = catalogo;
      cont.innerHTML = agruparCatalogoInversa_(catalogo).map(function (g) {
        return '<div class="inversa-grupo"><h3>' + escapeHtml_(g.tipo) + '</h3>' + g.items.map(function (c) {
          var id = escapeHtml_(c.id);
          return '<div class="inversa-fila">' +
            '<span class="inversa-nombre">' + escapeHtml_(c.nombre) + '</span>' +
            '<span class="inversa-cantidad">' +
              '<button type="button" class="inversa-paso" data-id="' + id + '" data-paso="-1" aria-label="Quitar uno de ' + escapeHtml_(c.nombre) + '">−</button>' +
              '<input type="number" inputmode="numeric" min="0" step="1" data-id="' + id + '" aria-label="Cantidad de ' + escapeHtml_(c.nombre) + '">' +
              '<button type="button" class="inversa-paso" data-id="' + id + '" data-paso="1" aria-label="Añadir uno de ' + escapeHtml_(c.nombre) + '">+</button>' +
            '</span></div>';
        }).join('') + '</div>';
      }).join('');
      formularioInversaPintado_ = true;
    });
  }

  function leerLineasFormularioInversa_() {
    var lineas = [];
    document.querySelectorAll('#inversaCatalogo input[data-id]').forEach(function (inp) {
      if (inp.value !== '') lineas.push({ id: inp.getAttribute('data-id'), cantidad: inp.value });
    });
    return lineas;
  }

  function recalcularTotalInversa_() {
    var total = 0;
    document.querySelectorAll('#inversaCatalogo input[data-id]').forEach(function (inp) {
      var n = Number(inp.value);
      var cuenta = inp.value !== '' && isFinite(n) && n > 0;
      if (cuenta) total += Math.floor(n);
      inp.closest('.inversa-fila').classList.toggle('con-cantidad', cuenta);
    });
    document.getElementById('inversaTotalForm').textContent = String(total);
  }

  function pasoInversa_(id, delta) {
    var inp = buscarInputInversa_(id);
    if (!inp) return;
    var nuevo = Math.max(0, (Number(inp.value) || 0) + delta);
    inp.value = nuevo === 0 ? '' : String(nuevo);
    recalcularTotalInversa_();
  }

  document.getElementById('inversaCatalogo').addEventListener('click', function (ev) {
    var b = ev.target.closest('.inversa-paso');
    if (!b) return;
    pasoInversa_(b.getAttribute('data-id'), Number(b.getAttribute('data-paso')));
  });
  document.getElementById('inversaCatalogo').addEventListener('input', recalcularTotalInversa_);

  function limpiarFormularioInversa_() {
    document.querySelectorAll('#inversaCatalogo input[data-id]').forEach(function (inp) { inp.value = ''; });
    torreEnEdicionInversa_ = null;
    document.getElementById('inversaTituloForm').textContent = 'Nueva torre';
    document.getElementById('btnInversaGuardar').textContent = 'Crear e imprimir etiqueta';
    document.getElementById('btnInversaCancelarEdicion').classList.add('vista-oculta');
    recalcularTotalInversa_();
  }

  function cancelarEdicionInversa_() { limpiarFormularioInversa_(); }

  function cargarPestanaInversa_() {
    pintarFormularioInversa_().then(function () {
      cargarTorresInversa_();
    }).catch(function (err) {
      document.getElementById('inversaCatalogo').innerHTML =
        '<p class="sin-resultados" style="color:var(--color-error);">No se pudo cargar el catálogo de soportes: ' + escapeHtml_(err && err.message ? err.message : err) + '</p>';
    });
  }

  function cargarTorresInversa_() {
    document.getElementById('inversaListaTorres').innerHTML = '<p class="cargando-resultados">Cargando…</p>';
    gas('listarTorresInversa').then(renderizarTorresInversa_).catch(function (err) {
      document.getElementById('inversaListaTorres').innerHTML =
        '<p class="sin-resultados" style="color:var(--color-error);">Error al cargar las torres: ' + escapeHtml_(err && err.message ? err.message : err) + '</p>';
    });
  }

  function renderizarTorresInversa_(datos) {
    torresInversa_ = datos.torres || [];
    var n = torresInversa_.length;
    pintarBadgeInversa_(n, true);
    document.getElementById('inversaContador').textContent = n + ' pendiente' + (n !== 1 ? 's' : '');
    document.getElementById('inversaResumenTipos').innerHTML = (datos.resumen || []).map(function (r) {
      return '<span class="inversa-chip"><strong>' + escapeHtml_(r.cantidad) + '</strong> ' + escapeHtml_(r.nombre) + '</span>';
    }).join('');
    var cont = document.getElementById('inversaListaTorres');
    if (n === 0) { cont.innerHTML = '<p class="sin-resultados">No hay torres precargadas.</p>'; return; }
    cont.innerHTML = '<table class="resultados-tabla"><thead><tr><th>Torre</th><th>Contenido</th><th>Total</th><th></th></tr></thead><tbody>' +
      torresInversa_.map(function (t) {
        var id = escapeHtml_(t.idUnico);
        return '<tr>' +
          '<td data-label="Torre"><strong>' + id + '</strong><span class="pendientes-id-unico">' + escapeHtml_(formatearFechaHora(t.fechaCreacion)) + '</span></td>' +
          '<td data-label="Contenido" class="inversa-desglose">' + escapeHtml_(textoDesgloseInversa_(t.lineas)) + '</td>' +
          '<td data-label="Total">' + escapeHtml_(t.total) + '</td>' +
          '<td data-label=""><div class="inversa-acciones">' +
            '<button type="button" class="btn-secundario" data-accion="reimprimir" data-id="' + id + '">Reimprimir</button>' +
            '<button type="button" class="btn-secundario" data-accion="editar" data-id="' + id + '">Editar</button>' +
            '<button type="button" class="btn-secundario" data-accion="borrar" data-id="' + id + '">Borrar</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  document.getElementById('inversaListaTorres').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-accion]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var accion = b.getAttribute('data-accion');
    if (accion === 'reimprimir') imprimirHtmlEtiquetas_(gas('htmlEtiquetasTorresInversa', [id]));
    else if (accion === 'editar') editarTorreInversa_(id);
    else if (accion === 'borrar') borrarTorreInversaUI_(id);
  });

  function editarTorreInversa_(id) {
    var torre = torresInversa_.filter(function (t) { return t.idUnico === id; })[0];
    if (!torre) return;
    limpiarFormularioInversa_();
    var sinCasilla = [];
    torre.lineas.forEach(function (l) {
      var inp = buscarInputInversa_(l.id);
      if (inp) inp.value = String(l.cantidad); else sinCasilla.push(l.nombre);
    });
    torreEnEdicionInversa_ = id;
    document.getElementById('inversaTituloForm').textContent = 'Editando ' + id;
    document.getElementById('btnInversaGuardar').textContent = 'Guardar cambios';
    document.getElementById('btnInversaCancelarEdicion').classList.remove('vista-oculta');
    recalcularTotalInversa_();
    document.getElementById('inversaFormulario').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (sinCasilla.length) {
      mostrarModalAviso_('Tipos que ya no están en el catálogo', 'Esta torre lleva ' + sinCasilla.join(', ') + ', que ya no está en el catálogo de soportes. Si guardas, se quitará de la torre.');
    }
  }

  function borrarTorreInversaUI_(id) {
    mostrarConfirmacion_('¿Borrar la torre ' + id + '? Su etiqueta dejará de valer.', function () {
      gas('borrarTorreInversa', id).then(function () {
        if (torreEnEdicionInversa_ === id) limpiarFormularioInversa_();
        cargarTorresInversa_();
      }).catch(function (err) {
        mostrarModalAviso_('No se pudo borrar la torre', err && err.message ? err.message : String(err));
        cargarTorresInversa_();
      });
    }, 'Borrar torre');
  }

  function guardarTorreUI_() {
    var lineas = leerLineasFormularioInversa_();
    var hayAlguna = lineas.some(function (l) { return Number(l.cantidad) > 0; });
    if (!hayAlguna) {
      mostrarModalAviso_('Torre vacía', 'Indica la cantidad de al menos un tipo de soporte.');
      return;
    }
    var btn = document.getElementById('btnInversaGuardar');
    var editando = torreEnEdicionInversa_;
    btn.disabled = true;
    function terminar() { btn.disabled = false; }
    if (editando) {
      gas('actualizarTorreInversa', editando, lineas).then(function (torre) {
        limpiarFormularioInversa_();
        cargarTorresInversa_();
        mostrarModalAviso_('Torre actualizada', torre.idUnico + ' guardada. Reimprime su etiqueta para que coincida con lo guardado.');
      }).catch(function (err) {
        mostrarModalAviso_('No se pudo guardar la torre', err && err.message ? err.message : String(err));
      }).then(terminar);
      return;
    }
    // La ventana de impresión se abre YA (dentro del clic) y se rellena cuando la torre está creada:
    // si se abriera después de la respuesta del servidor, el navegador podría bloquearla.
    imprimirHtmlEtiquetas_(
      gas('crearTorreInversa', lineas).then(function (torre) {
        limpiarFormularioInversa_();
        cargarTorresInversa_();
        return gas('htmlEtiquetasTorresInversa', [torre.idUnico]);
      }).catch(function (err) {
        mostrarModalAviso_('No se pudo crear la torre', err && err.message ? err.message : String(err));
        throw err;
      }).then(function (htmlEtiquetas) { terminar(); return htmlEtiquetas; }, function (err) { terminar(); throw err; })
    );
  }
  // ══ PRECARGA INVERSA: fin ══
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\bloque_inversa.js"
```

Ejecuta el script sobre `Index.html`:

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
python "$env:TEMP\inversa_preview\inversa_index.py" Index.html "$env:TEMP\inversa_preview\bloque_inversa.js"
```

Expected: `TODO APLICADO Index.html`. Si falla con `AssertionError ... esperaba 1, hay 0`, el archivo cambió desde que se escribió este plan: **parar**, mirar el trozo que no encuentra y adaptar el ancla (no editar a ciegas).

- [ ] **Step 4: Ejecutar los tests**

```powershell
node --test test/indexInversa.test.js test/temasIndex.test.js
```

Expected: todo en verde (`temasIndex` comprueba que no se rompió el tema).

- [ ] **Step 5: Ver la pestaña con datos simulados (Chrome headless)**

```powershell
@'
const fs = require('fs');
const raiz = 'C:/Users/30081048/Desktop/Proyectos/hodos/';
let html = fs.readFileSync(raiz + 'Index.html', 'utf8');
html = html.replace(/<\?!?=\s*[\w.]+\s*\?>/g, '');
const mock = '<script>' +
  'window.__torres = [' +
  '{idUnico:"INV-000012",lineas:[{id:"S01",nombre:"EUROPEO",cantidad:5},{id:"S16",nombre:"JAULA",cantidad:5}],total:10,creadoPor:"a",fechaCreacion:"2026-10-06T08:15:00Z"},' +
  '{idUnico:"INV-000013",lineas:[{id:"S01",nombre:"EUROPEO",cantidad:17}],total:17,creadoPor:"a",fechaCreacion:"2026-10-06T09:40:00Z"},' +
  '{idUnico:"INV-000014",lineas:[{id:"S02",nombre:"PALETINA",cantidad:4},{id:"S17",nombre:"SVR (Completo)",cantidad:2},{id:"S21",nombre:"CESTAS PLEGABLES",cantidad:3}],total:9,creadoPor:"a",fechaCreacion:"2026-10-06T10:05:00Z"}];' +
  'window.__mock=function(n,a){switch(n){' +
  'case "obtenerCatalogoInversa":return [{id:"S01",nombre:"EUROPEO",tipo:"Palet"},{id:"S02",nombre:"PALETINA",tipo:"Palet"},{id:"S05",nombre:"AMERICANO",tipo:"Palet"},{id:"S16",nombre:"JAULA",tipo:"Jaula Completa"},{id:"S17",nombre:"SVR (Completo)",tipo:"Jaula Completa"},{id:"S21",nombre:"CESTAS PLEGABLES",tipo:"Otros"}];' +
  'case "listarTorresInversa":return {torres:window.__torres,resumen:[{id:"S01",nombre:"EUROPEO",cantidad:22},{id:"S02",nombre:"PALETINA",cantidad:4},{id:"S16",nombre:"JAULA",cantidad:5},{id:"S17",nombre:"SVR (Completo)",cantidad:2},{id:"S21",nombre:"CESTAS PLEGABLES",cantidad:3}]};' +
  'case "contarTorresInversaPendientes":return 3;' +
  'case "contarEtiquetasPendientesPorPestana":return {incpc:0,preparacion:0,meco:0,valencia:0,torija:0,antequera:0};' +
  'default:return [];}};' +
  'function crear(ok,fail){return new Proxy({},{get:function(_,n){' +
  'if(n==="withSuccessHandler")return function(f){return crear(f,fail);};' +
  'if(n==="withFailureHandler")return function(f){return crear(ok,f);};' +
  'return function(){var a=Array.prototype.slice.call(arguments);setTimeout(function(){try{ok(window.__mock(n,a));}catch(e){fail&&fail({message:e.message});}},20);};}});}' +
  'window.google={script:{run:crear(function(){},function(){})}};' +
  '</script>';
html = html.replace('<script>', mock + '<script>');
const final = '<script>cambiarPestana("inversa");setTimeout(function(){var i=document.querySelectorAll("#inversaCatalogo input[data-id]");if(i[0]){i[0].value="5";}if(i[3]){i[3].value="5";}recalcularTotalInversa_();},400);</script>';
const iFin = html.lastIndexOf('</body>');
html = html.slice(0, iFin) + final + html.slice(iFin);
fs.writeFileSync(process.env.TEMP + '/inversa_preview/hodos_inversa.html', html);
console.log('ok');
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\preview_hodos.js"
node "$env:TEMP\inversa_preview\preview_hodos.js"
$u = "file:///$($env:TEMP -replace '\\','/')/inversa_preview/hodos_inversa.html"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --screenshot="$env:TEMP\inversa_preview\hodos_inversa_escritorio.png" --window-size=1280,1500 --virtual-time-budget=6000 $u
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --screenshot="$env:TEMP\inversa_preview\hodos_inversa_movil.png" --window-size=390,2200 --virtual-time-budget=6000 $u
```

Expected: se crean las dos capturas. Ábrelas con la herramienta de imágenes y comprueba: (a) en la barra lateral aparece "Inversa → Precarga Inversa" con la insignia **3**; (b) el formulario muestra los tipos agrupados (Palet / Jaula Completa / Otros) con casillas vacías salvo las dos rellenadas por el script (EUROPEO 5 y JAULA 5) y "Total de la torre: 10 soportes"; (c) abajo, 3 torres con su desglose, el resumen por tipo en "chips" y los botones Reimprimir / Editar / Borrar; (d) en móvil la tabla se convierte en tarjetas sin scroll horizontal. Si algo se ve mal, corrige el CSS/HTML en `Index.html` (no en el bloque con marcas salvo que el fallo sea de lógica) y repite.

- [ ] **Step 6: Comprobar que no quedan errores de consola**

```powershell
$u = "file:///$($env:TEMP -replace '\\','/')/inversa_preview/hodos_inversa.html"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --enable-logging=stderr --v=0 --dump-dom --virtual-time-budget=6000 $u 2>&1 | Select-String -Pattern "Uncaught|SyntaxError|ReferenceError" | Select-Object -First 5
```

Expected: sin salida (ningún `Uncaught`, `SyntaxError` ni `ReferenceError`). Si aparece alguno, resolverlo antes de seguir.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git diff --stat Index.html
git add Index.html test/indexInversa.test.js
git commit -m @'
feat(hodos): pestana Precarga Inversa (crear, imprimir, editar y borrar torres) con insignia [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

(`git diff --stat Index.html` debe mostrar solo adiciones y 2 líneas modificadas de `pintarBadge_`; si hay más, parar y avisar.)

---

## Task 6: Pasada completa de HODOS (local)

**Files:** ninguno.

- [ ] **Step 1: Toda la batería**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
node --test
```

Expected: `ℹ fail 0`, y el número de `pass` = el de la Task 0 + 41 tests nuevos (9 + 9 + 7 + 10 + 6). Lo que importa es `fail 0`.

- [ ] **Step 2: Estado del repo**

```powershell
git status --short
git log --oneline | Select-Object -First 8
```

Expected: nada pendiente de este plan; los 5 commits `[precarga-inversa]` visibles. Si hay archivos modificados que no son tuyos, déjalos como están.

---

## Task 7: Repositorio local de Plataforma

**Files:**
- Create: carpeta `C:\Users\30081048\Desktop\Proyectos\Plataforma` (repo git local, sin remoto)

- [ ] **Step 1: Comprobar acceso y versión de producción**

```powershell
New-Item -ItemType Directory -Force C:\Users\30081048\Desktop\Proyectos\Plataforma | Out-Null
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
clasp clone 1EdYXurp0WqrgwqAV-GQZRqt8FeaxvzaNch9ZLsd5VYCQhghHptwrb0NS --rootDir src
clasp deployments
clasp versions
```

Expected: `Cloned 23 files` bajo `src\`; `clasp deployments` lista los despliegues (apunta el id y la versión del despliegue que sirve la app a los operarios, el que lleva `@<n>` y no `@HEAD`); `clasp versions` lista las versiones. **Anota el id del despliegue y el número de versión de producción.**

(El clon de HEAD puede diferir de la versión desplegada si alguien editó sin desplegar: en el siguiente step se baja la versión de producción para asegurar la línea base.)

- [ ] **Step 2: Línea base = la versión que ven los operarios**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
clasp pull --versionNumber <VERSION_DE_PRODUCCION_ANOTADA>
Get-ChildItem src | Select-Object Name, Length | Format-Table -AutoSize
```

Expected: 23 archivos en `src\` (los mismos de antes). Esta es la línea base.

- [ ] **Step 3: Inicializar git y fijar la línea base**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
@'
node_modules/
*.log
'@ | Set-Content -Encoding utf8 .gitignore
@'
# Plataforma (app de recepción y expedición de camiones, Taisa Málaga)

Copia local del proyecto Apps Script `1EdYXurp0WqrgwqAV-GQZRqt8FeaxvzaNch9ZLsd5VYCQhghHptwrb0NS`.
Repositorio SOLO LOCAL: no subir a ningún remoto (Codigo.js lleva webhooks de Google Chat con token en claro).

- `src/` es el código Apps Script (clasp, rootDir = src). `test/` son pruebas con `node --test` y NO se sube a Google.
- Línea base: versión de producción en el momento de crear este repositorio (ver el primer commit).
- Precarga Inversa: ver `Desktop\Proyectos\hodos\docs\superpowers\specs\2026-10-06-precarga-inversa-design.md`.
'@ | Set-Content -Encoding utf8 README.md
git init
git add -A
git commit -m @'
chore: linea base (version de produccion de Plataforma antes de la Precarga Inversa)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
git tag base-produccion
git log --oneline
```

Expected: un commit y la etiqueta `base-produccion`.

---

## Task 8: Lógica pura y escáner de Plataforma (`JS_Inversa.html`, bloque 1)

**Files:**
- Create: `src/JS_Inversa.html` (bloque 1 ahora; bloque 2 en la Task 10)
- Test: `test/jsInversaPuro.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/jsInversaPuro.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'JS_Inversa.html'), 'utf8');
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

function cargarPuro() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(bloques[0], ctx);
  return ctx;
}
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

test('el archivo no contiene secuencias que HtmlService estropea', () => {
  assert.ok(!html.includes('/*'), 'no usar "/*" (ni comentarios de bloque ni image/*): corta la página en HtmlService');
  assert.ok(!html.includes('<?'), 'no usar scriptlets en un archivo incluido con include()');
});

test('hay al menos el bloque 1 (puro) y parsea', () => {
  assert.ok(bloques.length >= 1);
  assert.doesNotThrow(() => new Function(bloques[0]));
});

test('inversaEsCodigoTorre_ / inversaNormalizarCodigo_', () => {
  const ctx = cargarPuro();
  assert.strictEqual(ctx.inversaNormalizarCodigo_('  inv-000123 '), 'INV-000123');
  assert.strictEqual(ctx.inversaEsCodigoTorre_('inv-000123'), true);
  assert.strictEqual(ctx.inversaEsCodigoTorre_('INV-1234567'), true);
  ['', null, 'HODOS-000123', 'INV-123', '00184000227900315462', 'INV-00012A'].forEach((malo) => {
    assert.strictEqual(ctx.inversaEsCodigoTorre_(malo), false, String(malo));
  });
});

test('inversaLineasComoArray_: acepta array u objeto de Firebase y descarta lo inservible', () => {
  const ctx = cargarPuro();
  assert.deepStrictEqual(aLocal(ctx.inversaLineasComoArray_([{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }])), [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }]);
  assert.deepStrictEqual(aLocal(ctx.inversaLineasComoArray_({ 0: { id: 'S01', nombre: 'EUROPEO', cantidad: '5' }, 2: { id: 'S16', cantidad: 3 } })), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 5 },
    { id: 'S16', nombre: 'S16', cantidad: 3 }
  ]);
  assert.deepStrictEqual(aLocal(ctx.inversaLineasComoArray_(null)), []);
  assert.deepStrictEqual(aLocal(ctx.inversaLineasComoArray_([{ id: 'S01', cantidad: 0 }, { cantidad: 4 }, null])), []);
});

test('inversaAplicarLineas_: suma, resta, recorta en cero y avisa', () => {
  const ctx = cargarPuro();
  const suma = aLocal(ctx.inversaAplicarLineas_({ S01: 3 }, [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 2 }], 1));
  assert.deepStrictEqual(suma.soportes, { S01: 8, S16: 2 });
  assert.deepStrictEqual(suma.avisos, []);

  const resta = aLocal(ctx.inversaAplicarLineas_({ S01: 8, S16: 2 }, [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 2 }], -1));
  assert.deepStrictEqual(resta.soportes, { S01: 3 });

  const recorte = aLocal(ctx.inversaAplicarLineas_({ S01: 2 }, [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }], -1));
  assert.deepStrictEqual(recorte.soportes, {});
  assert.deepStrictEqual(recorte.avisos, [{ id: 'S01', nombre: 'EUROPEO', habia: 2, quitar: 5 }]);
});

test('inversaAplicarLineas_: no modifica el objeto original', () => {
  const ctx = cargarPuro();
  const original = { S01: 3 };
  ctx.inversaAplicarLineas_(original, [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }], 1);
  assert.deepStrictEqual(aLocal(original), { S01: 3 });
});

test('inversaBuscarTorreEnCamiones_: encuentra en qué flete está la torre', () => {
  const ctx = cargarPuro();
  const camiones = { A1: { soportes: {}, torres: { 'INV-000001': {} } }, B2: { soportes: {} }, C3: { torres: { 'INV-000002': {}, 'INV-000003': {} } } };
  assert.strictEqual(ctx.inversaBuscarTorreEnCamiones_(camiones, 'INV-000003'), 'C3');
  assert.strictEqual(ctx.inversaBuscarTorreEnCamiones_(camiones, 'INV-000001'), 'A1');
  assert.strictEqual(ctx.inversaBuscarTorreEnCamiones_(camiones, 'INV-000009'), null);
  assert.strictEqual(ctx.inversaBuscarTorreEnCamiones_(null, 'INV-000009'), null);
});

test('inversaResumenLineas_ y inversaTextoMotivo_', () => {
  const ctx = cargarPuro();
  assert.strictEqual(ctx.inversaResumenLineas_([{ nombre: 'EUROPEO', cantidad: 5 }, { nombre: 'JAULA', cantidad: 5 }]), '5 × EUROPEO + 5 × JAULA');
  assert.match(ctx.inversaTextoMotivo_('NO_EXISTE', 'INV-000007'), /No existe la torre INV-000007 en HODOS/);
  assert.match(ctx.inversaTextoMotivo_('OTRA_COSA', 'INV-000007'), /INV-000007/);
});

test('control de lectura: envía, espera respuesta y no repite el mismo código enseguida', () => {
  const ctx = cargarPuro();
  const c = ctx.inversaCrearControlLectura_();
  assert.deepStrictEqual(aLocal(c.evaluar('inv-000007', 1000)), { accion: 'enviar', codigo: 'INV-000007' });
  assert.strictEqual(c.ocupado(), true);
  assert.deepStrictEqual(aLocal(c.evaluar('INV-000008', 1100)), { accion: 'espera' });
  c.ack();
  assert.strictEqual(c.ocupado(), false);
  assert.deepStrictEqual(aLocal(c.evaluar('INV-000007', 2000)), { accion: 'ignorar' });
  assert.deepStrictEqual(aLocal(c.evaluar('INV-000007', 5500)), { accion: 'enviar', codigo: 'INV-000007' });
});

test('control de lectura: un código que no es de torre se avisa una vez y luego se ignora', () => {
  const ctx = cargarPuro();
  const c = ctx.inversaCrearControlLectura_();
  assert.deepStrictEqual(aLocal(c.evaluar('8412345678905', 1000)), { accion: 'invalido', codigo: '8412345678905' });
  assert.deepStrictEqual(aLocal(c.evaluar('8412345678905', 1500)), { accion: 'ignorar' });
  assert.strictEqual(c.ocupado(), false);
});

test('control de lectura: sin respuesta se bloquea hasta reintentar; una respuesta tardía desbloquea', () => {
  const ctx = cargarPuro();
  const c = ctx.inversaCrearControlLectura_();
  c.evaluar('INV-000007', 1000);
  c.sinRespuesta();
  assert.strictEqual(c.ocupado(), true);
  assert.deepStrictEqual(aLocal(c.evaluar('INV-000008', 20000)), { accion: 'espera' });
  c.reintentar();
  assert.strictEqual(c.ocupado(), false);
  assert.deepStrictEqual(aLocal(c.evaluar('INV-000007', 30000)), { accion: 'enviar', codigo: 'INV-000007' });
  c.sinRespuesta();
  c.ack();
  assert.strictEqual(c.ocupado(), false);
});

test('inversaEscanerHtml_: la página del escáner es HTML completo y su script parsea', () => {
  const ctx = cargarPuro();
  [true, false].forEach((continuo) => {
    const pagina = ctx.inversaEscanerHtml_('i1_abc', continuo);
    assert.match(pagina, /^<!doctype html>/);
    assert.match(pagina, /Inversa · Escanear torres/);
    const scripts = [...pagina.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.strictEqual(scripts.length, 1);
    assert.doesNotThrow(() => new Function(scripts[0]));
    assert.ok(scripts[0].indexOf('inversaEscanerPopup_("i1_abc",' + (continuo ? 'true' : 'false') + ')') !== -1);
    assert.ok(scripts[0].indexOf('function inversaCrearControlLectura_') !== -1);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test test/jsInversaPuro.test.js
```

Expected: FAIL (`ENOENT ... JS_Inversa.html`).

- [ ] **Step 3: Crear `src/JS_Inversa.html` con el bloque 1**

```html
<script>
  // ============================================================================
  // PRECARGA INVERSA (HODOS) — BLOQUE 1: funciones puras y escáner de cámara.
  // Sin acceso al DOM al cargar: se prueba con node --test (test/jsInversaPuro.test.js).
  // Spec: Desktop\Proyectos\hodos\docs\superpowers\specs\2026-10-06-precarga-inversa-design.md
  // ============================================================================

  var INVERSA_REGEX_CODIGO_ = /^INV-[0-9]{6,}$/;

  function inversaNormalizarCodigo_(bruto) {
    return String(bruto == null ? '' : bruto).trim().toUpperCase();
  }

  function inversaEsCodigoTorre_(codigo) {
    return INVERSA_REGEX_CODIGO_.test(inversaNormalizarCodigo_(codigo));
  }

  // Firebase devuelve los arrays como objetos {0:..,2:..} cuando faltan huecos: se aceptan ambas formas.
  function inversaLineasComoArray_(valor) {
    if (!valor) return [];
    var lista = Array.isArray(valor) ? valor : Object.keys(valor).map(function (k) { return valor[k]; });
    return lista
      .filter(function (l) { return l && l.id; })
      .map(function (l) { return { id: String(l.id), nombre: String(l.nombre || l.id), cantidad: Number(l.cantidad) || 0 }; })
      .filter(function (l) { return l.cantidad > 0; });
  }

  // signo = 1 suma, -1 resta. Devuelve un objeto NUEVO (no toca el original) y los avisos de recorte
  // (se quiso restar más de lo que había: se deja en 0).
  function inversaAplicarLineas_(soportes, lineas, signo) {
    var nuevo = {};
    Object.keys(soportes || {}).forEach(function (k) { nuevo[k] = Number(soportes[k]) || 0; });
    var avisos = [];
    lineas.forEach(function (l) {
      var actual = nuevo[l.id] || 0;
      var resultado = actual + signo * l.cantidad;
      if (resultado < 0) {
        avisos.push({ id: l.id, nombre: l.nombre, habia: actual, quitar: l.cantidad });
        resultado = 0;
      }
      if (resultado === 0) delete nuevo[l.id]; else nuevo[l.id] = resultado;
    });
    return { soportes: nuevo, avisos: avisos };
  }

  // Devuelve el flete del camión (abierto) en el que ya está la torre, o null.
  function inversaBuscarTorreEnCamiones_(camiones, id) {
    var fletes = Object.keys(camiones || {});
    for (var i = 0; i < fletes.length; i++) {
      var camion = camiones[fletes[i]];
      if (camion && camion.torres && camion.torres[id]) return fletes[i];
    }
    return null;
  }

  function inversaResumenLineas_(lineas) {
    return lineas.map(function (l) { return l.cantidad + ' × ' + l.nombre; }).join(' + ');
  }

  function inversaTextoMotivo_(motivo, id) {
    if (motivo === 'NO_EXISTE') return 'No existe la torre ' + id + ' en HODOS (puede que ya esté cargada). Añádela a mano si hace falta.';
    return 'HODOS no pudo darme la torre ' + id + (motivo ? ' (' + motivo + ')' : '') + '. Añádela a mano.';
  }

  // Máquina de estados de la lectura continua (la usa la pestaña del escáner): decide qué hacer con
  // cada código que ve la cámara. Se inyecta tal cual en la página del escáner (toString), por eso
  // no puede depender de nada de fuera.
  function inversaCrearControlLectura_(opciones) {
    var ventanaRepetidoMs = (opciones && opciones.repetidoMs) || 4000;
    var ultimo = null;
    var tUltimo = 0;
    var esperando = false;
    var bloqueado = false;
    return {
      evaluar: function (bruto, ahora) {
        var c = String(bruto == null ? '' : bruto).trim().toUpperCase();
        if (esperando || bloqueado) return { accion: 'espera' };
        var repetido = (c === ultimo && ahora - tUltimo < ventanaRepetidoMs);
        if (!/^INV-[0-9]{6,}$/.test(c)) {
          if (repetido) return { accion: 'ignorar' };
          ultimo = c; tUltimo = ahora;
          return { accion: 'invalido', codigo: c };
        }
        if (repetido) return { accion: 'ignorar' };
        ultimo = c; tUltimo = ahora; esperando = true;
        return { accion: 'enviar', codigo: c };
      },
      ocupado: function () { return esperando || bloqueado; },
      ack: function () { esperando = false; bloqueado = false; },
      sinRespuesta: function () { esperando = false; bloqueado = true; },
      reintentar: function () { esperando = false; bloqueado = false; ultimo = null; }
    };
  }

  // Código de la pestaña del escáner (se escribe con document.write en una pestaña nueva, porque el
  // iframe de Apps Script bloquea la cámara en directo; mismo método que el portal de Kairos).
  // Habla con Plataforma por postMessage: envía {inversaEscaner:ID, codigo, seq} y espera
  // {inversaEscanerAck:ID, ok, texto}. Si continuo es false, se cierra tras la primera lectura correcta.
  function inversaEscanerPopup_(ID, continuo) {
    var control = inversaCrearControlLectura_();
    var video = document.querySelector('video');
    var elEstado = document.getElementById('estado');
    var elCuenta = document.getElementById('cuenta');
    var elRegistro = document.getElementById('registro');
    var btnLinterna = document.getElementById('linterna');
    var btnReintentar = document.getElementById('reintentar');
    var terminado = false;
    var seq = 0;
    var cuenta = 0;
    var stream = null;
    var timerAck = null;
    var audioCtx = null;
    var wake = null;

    function avisarOpener(datos) {
      try {
        if (window.opener) window.opener.postMessage(Object.assign({ inversaEscaner: ID }, datos), '*');
      } catch (e) {}
    }
    function pararStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (wake) { try { wake.release(); } catch (e) {} wake = null; }
    }
    function terminar() {
      if (terminado) return;
      terminado = true;
      clearTimeout(timerAck);
      avisarOpener({ fin: true });
      pararStream();
      window.close();
    }
    window.addEventListener('pagehide', function () {
      if (terminado) return;
      terminado = true;
      avisarOpener({ fin: true });
      pararStream();
    });
    document.getElementById('terminar').onclick = terminar;

    function estadoNormal(texto) { elEstado.classList.remove('error'); elEstado.textContent = texto; }
    function estadoError(texto) { elEstado.classList.add('error'); elEstado.textContent = texto; }

    function pitido(ok) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          if (!audioCtx) audioCtx = new AC();
          if (audioCtx.state === 'suspended') audioCtx.resume();
          var o = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          o.frequency.value = ok ? 1100 : 220;
          g.gain.value = 0.15;
          o.connect(g);
          g.connect(audioCtx.destination);
          o.start();
          o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.35));
        }
      } catch (e) {}
      try { if (navigator.vibrate) navigator.vibrate(ok ? 80 : [120, 60, 120]); } catch (e2) {}
    }
    function destello(ok) {
      document.body.classList.remove('flash-ok', 'flash-error');
      void document.body.offsetWidth;
      document.body.classList.add(ok ? 'flash-ok' : 'flash-error');
    }
    function registrar(ok, texto) {
      var li = document.createElement('li');
      li.className = ok ? 'ok' : 'error';
      li.textContent = (ok ? '✔ ' : '✖ ') + texto;
      elRegistro.insertBefore(li, elRegistro.firstChild);
      while (elRegistro.children.length > 5) elRegistro.removeChild(elRegistro.lastChild);
      if (ok) { cuenta++; elCuenta.textContent = String(cuenta); }
      destello(ok);
      pitido(ok);
    }

    function zxingPromesa() {
      if (window.ZXing) return Promise.resolve(window.ZXing);
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
        s.onload = function () { if (window.ZXing) resolve(window.ZXing); else reject(new Error('sin ZXing')); };
        s.onerror = function () { reject(new Error('no se pudo cargar el lector')); };
        document.head.appendChild(s);
      });
    }
    function lectorZxing() {
      return zxingPromesa().then(function (ZX) {
        var hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_128]);
        hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        var lector = new ZX.MultiFormatReader();
        lector.setHints(hints);
        var cv = document.createElement('canvas');
        var cx = cv.getContext('2d', { willReadFrequently: true });
        return function (v) {
          var w = v.videoWidth;
          var h = v.videoHeight;
          if (!w || !h) return Promise.resolve(null);
          var cw = Math.round(w * 0.85);
          var ch = Math.round(h * 0.5);
          cv.width = cw;
          cv.height = ch;
          cx.drawImage(v, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
          try {
            var bm = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(cv)));
            var r = lector.decodeWithState(bm);
            return Promise.resolve(r ? r.getText() : null);
          } catch (e) {
            return Promise.resolve(null);
          }
        };
      });
    }
    function crearLector() {
      if (!('BarcodeDetector' in window)) return lectorZxing();
      var soportados = BarcodeDetector.getSupportedFormats ? BarcodeDetector.getSupportedFormats() : Promise.resolve(['code_128']);
      return Promise.resolve(soportados).then(function (lista) {
        if (lista.indexOf('code_128') < 0) throw new Error('sin code_128');
        var det = new BarcodeDetector({ formats: ['code_128'] });
        return function (v) {
          return det.detect(v).then(function (c) { return c && c.length ? c[0].rawValue : null; });
        };
      }).catch(function () { return lectorZxing(); });
    }

    var ERRORES = {
      NotAllowedError: 'La cámara está bloqueada para esta pestaña. Actívala en los permisos del navegador y reintenta.',
      SecurityError: 'La cámara está bloqueada para esta pestaña. Actívala en los permisos del navegador y reintenta.',
      NotFoundError: 'No se encuentra ninguna cámara.',
      OverconstrainedError: 'No se encuentra ninguna cámara.',
      NotReadableError: 'La cámara la está usando otra app. Ciérrala y reintenta.'
    };
    function errorCamara(e) {
      pararStream();
      estadoError((e && ERRORES[e.name]) || 'No se pudo abrir la cámara.');
      document.getElementById('visor').style.display = 'none';
      btnReintentar.hidden = false;
    }

    function sinRespuesta() {
      control.sinRespuesta();
      estadoError('Plataforma no responde. Vuelve a ella, comprueba la conexión y pulsa Reintentar.');
      btnReintentar.hidden = false;
    }
    function manejar(codigo) {
      var r = control.evaluar(codigo, Date.now());
      if (r.accion === 'enviar') {
        seq++;
        estadoNormal('Enviando ' + r.codigo + '…');
        avisarOpener({ codigo: r.codigo, seq: seq });
        timerAck = setTimeout(sinRespuesta, 10000);
      } else if (r.accion === 'invalido') {
        registrar(false, 'No es una torre de HODOS: ' + r.codigo);
      }
    }
    function bucle(lector) {
      if (terminado) return;
      if (control.ocupado()) { setTimeout(function () { bucle(lector); }, 150); return; }
      lector(video).then(function (codigo) {
        if (terminado) return;
        if (codigo) manejar(codigo);
        setTimeout(function () { bucle(lector); }, 120);
      }, function () { setTimeout(function () { bucle(lector); }, 250); });
    }

    window.addEventListener('message', function (ev) {
      if (ev.source !== window.opener || !ev.data || ev.data.inversaEscanerAck !== ID) return;
      clearTimeout(timerAck);
      control.ack();
      if (stream) btnReintentar.hidden = true;
      estadoNormal('Apunta al código de la torre');
      registrar(!!ev.data.ok, String(ev.data.texto || ''));
      if (!continuo && ev.data.ok) setTimeout(terminar, 900);
    });

    function arrancar() {
      btnReintentar.hidden = true;
      document.getElementById('visor').style.display = 'block';
      estadoNormal('Abriendo cámara…');
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      }).then(function (s) {
        stream = s;
        video.srcObject = s;
        return Promise.resolve(video.play()).then(function () {
          var pista = s.getVideoTracks()[0];
          var cap = {};
          try { cap = (pista.getCapabilities && pista.getCapabilities()) || {}; } catch (e) {}
          if (cap.focusMode && cap.focusMode.indexOf('continuous') >= 0) {
            pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
          }
          if (cap.torch) {
            var on = false;
            btnLinterna.hidden = false;
            btnLinterna.onclick = function () {
              on = !on;
              btnLinterna.textContent = on ? 'Apagar linterna' : 'Linterna';
              pista.applyConstraints({ advanced: [{ torch: on }] }).catch(function () { btnLinterna.hidden = true; });
            };
          }
          estadoNormal('Apunta al código de la torre');
          try {
            if (navigator.wakeLock && navigator.wakeLock.request) {
              navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
            }
          } catch (e2) {}
          return crearLector();
        });
      }).then(bucle).catch(errorCamara);
    }
    btnReintentar.onclick = function () {
      control.reintentar();
      btnReintentar.hidden = true;
      if (!stream) arrancar(); else estadoNormal('Apunta al código de la torre');
    };
    arrancar();
  }

  function inversaEscanerHtml_(id, continuo) {
    var css = '*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif;overflow:hidden}' +
      '.visor{position:fixed;inset:0}.visor video{width:100%;height:100%;object-fit:cover;display:block}' +
      '.marco{position:absolute;left:7%;right:7%;top:22%;bottom:42%;border:2px solid #3fb54a;border-radius:14px;box-shadow:0 0 0 100vmax rgba(0,0,0,.45)}' +
      '.linea{position:absolute;left:6%;right:6%;top:50%;height:2px;background:#3fb54a;box-shadow:0 0 12px #3fb54a;animation:bar 1.8s ease-in-out infinite alternate}' +
      '@keyframes bar{from{transform:translateY(-40%)}to{transform:translateY(40%)}}' +
      '@media (prefers-reduced-motion: reduce){.linea{animation:none}}' +
      'body.flash-ok .marco{border-color:#7dff8a;box-shadow:0 0 0 100vmax rgba(30,140,50,.55)}' +
      'body.flash-error .marco{border-color:#ff7d7d;box-shadow:0 0 0 100vmax rgba(160,30,30,.55)}' +
      '.estado{position:fixed;left:0;right:0;top:0;padding:12px 16px;text-align:center;font-size:15px}.estado.error{color:#ffb4b4}' +
      '.panel{position:fixed;left:0;right:0;bottom:76px;padding:8px 16px;background:rgba(0,0,0,.6)}' +
      '.contador{font-size:15px;margin-bottom:6px}.contador strong{font-size:20px}' +
      '#registro{list-style:none;margin:0;padding:0;font-size:14px;max-height:30vh;overflow:hidden}' +
      '#registro li{padding:3px 0;border-top:1px solid rgba(255,255,255,.12)}#registro li.ok{color:#9be8a4}#registro li.error{color:#ffb4b4}' +
      '.acciones{position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:12px 16px}' +
      '.btn{flex:1 1 40%;min-height:48px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:15px;font-weight:600}' +
      '.btn[hidden]{display:none}.btn-cerrar{background:#fff;color:#111;border-color:#fff}';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
      '<title>Inversa · Escanear torres</title><style>' + css + '</style></head><body>' +
      '<div class="visor" id="visor"><video playsinline muted autoplay></video><div class="marco"><span class="linea"></span></div></div>' +
      '<p class="estado" id="estado">Abriendo cámara…</p>' +
      '<div class="panel"><div class="contador"><strong id="cuenta">0</strong> torres añadidas</div><ul id="registro"></ul></div>' +
      '<div class="acciones"><button class="btn" id="linterna" hidden>Linterna</button><button class="btn" id="reintentar" hidden>Reintentar</button><button class="btn btn-cerrar" id="terminar">Terminar</button></div>' +
      '<scr' + 'ipt>' + inversaCrearControlLectura_.toString() + ';' + inversaEscanerPopup_.toString() +
      ';inversaEscanerPopup_(' + JSON.stringify(id) + ',' + (continuo ? 'true' : 'false') + ');</scr' + 'ipt></body></html>';
  }
</script>
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test test/jsInversaPuro.test.js
```

Expected: `ℹ pass 12`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
git add src/JS_Inversa.html test/jsInversaPuro.test.js
git commit -m @'
feat: logica pura del bipado de torres y escaner de camara continuo (modelo Kairos)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

---

## Task 9: Servidor de Plataforma (`Backend_InversaHodos.js`)

**Files:**
- Create: `src/Backend_InversaHodos.js`
- Test: `test/backendInversaHodos.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/backendInversaHodos.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargar(props, respuestaTexto, capturadas) {
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    ScriptApp: { getOAuthToken: () => 'tok-oauth' },
    UrlFetchApp: {
      fetch: (url, opts) => {
        capturadas.push({ url: url, opts: opts });
        return { getContentText: () => respuestaTexto };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Backend_InversaHodos.js'), 'utf8'), ctx);
  return ctx;
}
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));
const PROPS = { HODOS_WEBAPP_URL: 'https://hodos.test/exec', HODOS_SHARED_TOKEN: 'secreto' };

test('bipadoInversaDisponible: solo si están las dos propiedades', () => {
  assert.strictEqual(cargar(PROPS, '{}', []).bipadoInversaDisponible(), true);
  assert.strictEqual(cargar({ HODOS_WEBAPP_URL: 'x' }, '{}', []).bipadoInversaDisponible(), false);
  assert.strictEqual(cargar({ HODOS_SHARED_TOKEN: 'x' }, '{}', []).bipadoInversaDisponible(), false);
  assert.strictEqual(cargar({}, '{}', []).bipadoInversaDisponible(), false);
});

test('consumirTorreEnHodos: manda token, acción e id con el token OAuth y devuelve la respuesta', () => {
  const capturadas = [];
  const ctx = cargar(PROPS, JSON.stringify({ ok: true, id: 'INV-000007', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }], total: 5, creadaEn: '2026-10-06T08:00:00.000Z' }), capturadas);
  const r = aLocal(ctx.consumirTorreEnHodos('INV-000007'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 5);
  assert.strictEqual(capturadas.length, 1);
  assert.strictEqual(capturadas[0].url, 'https://hodos.test/exec');
  assert.strictEqual(capturadas[0].opts.method, 'post');
  assert.strictEqual(capturadas[0].opts.headers.Authorization, 'Bearer tok-oauth');
  assert.strictEqual(capturadas[0].opts.muteHttpExceptions, true);
  assert.deepStrictEqual(JSON.parse(capturadas[0].opts.payload), { token: 'secreto', accion: 'consumirTorreInversa', id: 'INV-000007' });
});

test('consumirTorreEnHodos: un NO_EXISTE se devuelve (no es un error)', () => {
  const ctx = cargar(PROPS, JSON.stringify({ ok: false, motivo: 'NO_EXISTE' }), []);
  assert.deepStrictEqual(aLocal(ctx.consumirTorreEnHodos('INV-000007')), { ok: false, motivo: 'NO_EXISTE' });
});

test('devolverTorreEnHodos: manda id, líneas y fecha de creación', () => {
  const capturadas = [];
  const ctx = cargar(PROPS, JSON.stringify({ ok: true, id: 'INV-000007' }), capturadas);
  const lineas = [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }];
  assert.deepStrictEqual(aLocal(ctx.devolverTorreEnHodos('INV-000007', lineas, '2026-10-06T08:00:00.000Z')), { ok: true, id: 'INV-000007' });
  assert.deepStrictEqual(JSON.parse(capturadas[0].opts.payload), {
    token: 'secreto', accion: 'devolverTorreInversa', id: 'INV-000007', lineas: lineas, creadaEn: '2026-10-06T08:00:00.000Z'
  });
  ctx.devolverTorreEnHodos('INV-000008', lineas);
  assert.strictEqual(JSON.parse(capturadas[1].opts.payload).creadaEn, null);
});

test('un error de HODOS sin motivo (token malo, id inválido...) sube como Error legible', () => {
  const ctx = cargar(PROPS, JSON.stringify({ ok: false, error: 'Token inválido' }), []);
  assert.throws(() => ctx.consumirTorreEnHodos('INV-000007'), /Token inválido/);
});

test('una respuesta que no es JSON (p.ej. página de login) sube como Error legible', () => {
  const ctx = cargar(PROPS, '<html><body>Inicia sesión</body></html>', []);
  assert.throws(() => ctx.consumirTorreEnHodos('INV-000007'), /HODOS no respondió como se esperaba/);
});

test('sin propiedades configuradas ni siquiera intenta llamar', () => {
  const capturadas = [];
  const ctx = cargar({}, '{}', capturadas);
  assert.throws(() => ctx.consumirTorreEnHodos('INV-000007'), /no está activado/);
  assert.strictEqual(capturadas.length, 0);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test test/backendInversaHodos.test.js
```

Expected: FAIL (`ENOENT ... Backend_InversaHodos.js`).

- [ ] **Step 3: Implementar**

Crea `src/Backend_InversaHodos.js`:

```js
// Backend_InversaHodos.js — bipado de torres de la Precarga Inversa de HODOS.
// Spec: Desktop\Proyectos\hodos\docs\superpowers\specs\2026-10-06-precarga-inversa-design.md
//
// Plataforma NO guarda nada de las torres: al bipar una etiqueta INV-000123 le pide a HODOS su
// contenido (HODOS la borra de su lista al dársela) y lo suma al conteo del camión de Torija.
//
// INTERRUPTOR: el bloque "Bipar torre" solo aparece si en Propiedades del script están
//   HODOS_WEBAPP_URL   (la misma URL de HODOS que ya usa INCPC)
//   HODOS_SHARED_TOKEN (el mismo valor que INCPC_SHARED_TOKEN en las propiedades de HODOS)
// Sin ellas la app se comporta exactamente como antes. Quitarlas apaga el bipado al instante.

function inversaPropiedadesHodos_() {
  var props = PropertiesService.getScriptProperties();
  return { url: props.getProperty('HODOS_WEBAPP_URL'), token: props.getProperty('HODOS_SHARED_TOKEN') };
}

// Lo llama el cliente al cargar para saber si debe enseñar el bloque de bipado.
function bipadoInversaDisponible() {
  var p = inversaPropiedadesHodos_();
  return !!(p.url && p.token);
}

function llamarHodosInversa_(cuerpo) {
  var p = inversaPropiedadesHodos_();
  if (!p.url || !p.token) throw new Error('El bipado de torres no está activado en esta app.');
  var resp = UrlFetchApp.fetch(p.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(Object.assign({ token: p.token }, cuerpo)),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var texto = resp.getContentText();
  var json;
  try {
    json = JSON.parse(texto);
  } catch (e) {
    throw new Error('HODOS no respondió como se esperaba (¿permisos?): ' + String(texto).substring(0, 120));
  }
  // {ok:false, motivo:...} es una respuesta normal (p.ej. NO_EXISTE) y la gestiona el cliente;
  // {ok:false, error:...} es un fallo de verdad (token malo, código inválido, Supabase caído).
  if (json.ok === false && !json.motivo) throw new Error(json.error || 'HODOS rechazó la petición');
  return json;
}

function consumirTorreEnHodos(id) {
  return llamarHodosInversa_({ accion: 'consumirTorreInversa', id: id });
}

function devolverTorreEnHodos(id, lineas, creadaEn) {
  return llamarHodosInversa_({ accion: 'devolverTorreInversa', id: id, lineas: lineas, creadaEn: creadaEn || null });
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

```powershell
node --test test/backendInversaHodos.test.js test/jsInversaPuro.test.js
```

Expected: todo en verde, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
git add src/Backend_InversaHodos.js test/backendInversaHodos.test.js
git commit -m @'
feat: llamadas de Plataforma al webhook de HODOS (consumir/devolver torre) con interruptor por propiedades

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

---

## Task 10: Interfaz de Plataforma y enganches mínimos

**Files:**
- Modify: `src/JS_Inversa.html` (añadir el bloque 2)
- Modify: `src/Modulo_Plataforma.html` (bloque visual + modal)
- Modify: `src/JS_Plataforma.html` (4 enganches)
- Modify: `src/Index.html` (1 include)
- Test: `test/interfazInversa.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Crea `test/interfazInversa.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const jsInversa = leer('JS_Inversa.html');
const modulo = leer('Modulo_Plataforma.html');
const jsPlataforma = leer('JS_Plataforma.html');
const indexHtml = leer('Index.html');

test('JS_Inversa.html tiene dos bloques <script> y ambos parsean', () => {
  const bloques = [...jsInversa.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.strictEqual(bloques.length, 2);
  bloques.forEach((b) => assert.doesNotThrow(() => new Function(b)));
});

test('el bloque 2 no usa diálogos nativos', () => {
  const bloque2 = [...jsInversa.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(bloque2));
});

test('Index.html incluye JS_Inversa justo después de JS_Plataforma', () => {
  assert.match(indexHtml, /<\?!= include\('JS_Plataforma'\); \?>\s*<\?!= include\('JS_Inversa'\); \?>/);
});

test('Modulo_Plataforma.html: bloque de bipado dentro de la carga de Torija, oculto por defecto, y modal propio', () => {
  const iTorija = modulo.indexOf('id="torija-carga"');
  const iBloque = modulo.indexOf('id="inversa-bloque"');
  const iGrid = modulo.indexOf('id="grid-contenedor-torija"');
  assert.ok(iTorija !== -1 && iBloque > iTorija && iBloque < iGrid, 'el bloque debe estar entre la cabecera del camión y la cuadrícula');
  assert.match(modulo, /id="inversa-bloque" style="display:none;/);
  ['inversa-input-codigo', 'btn-inversa-anadir', 'btn-inversa-escanear', 'inversa-mensaje', 'inversa-contador', 'inversa-lista',
    'modal-inversa-confirmar', 'btn-inversa-confirmar-si', 'btn-inversa-confirmar-no'].forEach((id) => {
    assert.ok(modulo.indexOf('id="' + id + '"') !== -1, 'falta id=' + id);
  });
});

test('JS_Plataforma.html: los cuatro enganches están y son tolerantes si falta JS_Inversa', () => {
  assert.match(jsPlataforma, /if \(typeof inversaAlEntrarCamion_ === "function"\) inversaAlEntrarCamion_\(flete\);/);
  assert.match(jsPlataforma, /if \(typeof inversaRepintar_ === "function"\) inversaRepintar_\(\);/);
  assert.match(jsPlataforma, /if \(typeof inversaAlSalirCamion_ === "function"\) inversaAlSalirCamion_\(\);/);
  assert.match(jsPlataforma, /inversaDevolverTodas_\(flete\)\.then\(function\(res\)/);
});

test('JS_Plataforma.html: borrar un camión sin JS_Inversa sigue borrando como antes', () => {
  const m = /function borrarCamionTorija\(flete\) \{[\s\S]*?\n  \}/.exec(jsPlataforma);
  assert.ok(m);
  assert.match(m[0], /else \{ borrar\(\); \}/);
  assert.match(m[0], /delete CamionesTorijaAbiertos\[flete\];/);
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test test/interfazInversa.test.js
```

Expected: FAIL (solo hay 1 bloque `<script>`; no existe `inversa-bloque`, etc.).

- [ ] **Step 3: Añadir el bloque 2 (interfaz) al final de `src/JS_Inversa.html`**

Añade esto **después** del `</script>` del bloque 1 (en el mismo archivo):

```html

<script>
  // ============================================================================
  // PRECARGA INVERSA (HODOS) — BLOQUE 2: interfaz y eventos (usa el DOM y las variables de
  // JS_Plataforma.html: CamionesTorijaAbiertos, FleteTorijaActivo, SoportesSeleccionadosTorija,
  // guardarMemoriaTorija, refrescarSoportesTorijaEnPantalla, mostrarNotificacion).
  // ============================================================================

  var INVERSA_DISPONIBLE_ = false;       // lo fija bipadoInversaDisponible() (interruptor del servidor)
  var INVERSA_ESCANER_CONTINUO_ = true;  // false = la pestaña de la cámara se cierra tras cada torre (modo Kairos)
  var inversaEnVuelo_ = {};
  var inversaEscanerSeq_ = 0;

  function inversaEsc_(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inversaLlamar_(nombre) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(function (err) { reject(err); })
        [nombre].apply(null, args);
    });
  }

  function inversaMensaje_(texto, ok) {
    var el = document.getElementById('inversa-mensaje');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? '#e8f5e9' : '#ffebee';
    el.style.color = ok ? '#2e7d32' : '#c62828';
    el.textContent = texto;
  }

  function inversaConfirmar_(titulo, texto, textoSi, alConfirmar) {
    document.getElementById('inversa-confirmar-titulo').textContent = titulo;
    document.getElementById('inversa-confirmar-texto').textContent = texto;
    document.getElementById('btn-inversa-confirmar-si').textContent = textoSi;
    var modal = document.getElementById('modal-inversa-confirmar');
    modal.style.display = 'flex';
    document.getElementById('btn-inversa-confirmar-si').onclick = function () { modal.style.display = 'none'; alConfirmar(); };
    document.getElementById('btn-inversa-confirmar-no').onclick = function () { modal.style.display = 'none'; };
  }

  // Suma (signo 1) o resta (signo -1) las líneas al camión indicado y repinta sus casillas si es el
  // que se está viendo. Devuelve los avisos de recorte.
  function inversaAplicarAlCamion_(flete, lineas, signo) {
    var camion = CamionesTorijaAbiertos[flete];
    var r = inversaAplicarLineas_(camion.soportes || {}, lineas, signo);
    camion.soportes = r.soportes;
    if (flete === FleteTorijaActivo) {
      SoportesSeleccionadosTorija = Object.assign({}, r.soportes);
      refrescarSoportesTorijaEnPantalla();
    }
    return r.avisos;
  }

  // Procesa un código leído (pistola, teclado o cámara). Siempre resuelve {ok, texto}: nunca rechaza.
  function inversaProcesarCodigo_(bruto) {
    var flete = FleteTorijaActivo;
    if (!flete || !CamionesTorijaAbiertos[flete]) {
      return Promise.resolve({ ok: false, texto: 'Abre primero un camión de Torija.' });
    }
    var id = inversaNormalizarCodigo_(bruto);
    if (!inversaEsCodigoTorre_(id)) {
      return Promise.resolve({ ok: false, texto: 'Ese código no es de una torre de la Precarga Inversa (debe empezar por INV-).' });
    }
    var donde = inversaBuscarTorreEnCamiones_(CamionesTorijaAbiertos, id);
    if (donde) {
      return Promise.resolve({ ok: false, texto: donde === flete ? id + ' ya está en este camión.' : id + ' ya está en el camión ' + donde + '.' });
    }
    if (inversaEnVuelo_[id]) return Promise.resolve({ ok: false, texto: 'Ya se está leyendo ' + id + '…' });
    inversaEnVuelo_[id] = true;

    return inversaLlamar_('consumirTorreEnHodos', id).then(function (r) {
      if (!r || !r.ok) return { ok: false, texto: inversaTextoMotivo_(r && r.motivo, id) };
      var lineas = inversaLineasComoArray_(r.lineas);
      var creadaEn = r.creadaEn || null;
      var camion = CamionesTorijaAbiertos[flete];
      if (!camion) {
        // El camión desapareció mientras se leía: la torre vuelve a HODOS para no perderla.
        return inversaLlamar_('devolverTorreEnHodos', id, lineas, creadaEn).then(function () {
          return { ok: false, texto: 'El camión ' + flete + ' se cerró mientras se leía ' + id + '; la torre se ha devuelto a HODOS.' };
        }, function () {
          return { ok: false, texto: 'El camión ' + flete + ' se cerró y no se pudo devolver ' + id + ' a HODOS. Créala de nuevo en HODOS.' };
        });
      }
      try {
        inversaAplicarAlCamion_(flete, lineas, 1);
        if (!camion.torres) camion.torres = {};
        camion.torres[id] = { lineas: lineas, creadaEn: creadaEn, hora: Date.now() };
        guardarMemoriaTorija();
        inversaRepintar_();
      } catch (e) {
        return inversaLlamar_('devolverTorreEnHodos', id, lineas, creadaEn).then(function () {
          return { ok: false, texto: 'No se pudo sumar ' + id + ' al camión (' + e.message + '). La torre sigue en HODOS.' };
        }, function () {
          return { ok: false, texto: 'No se pudo sumar ' + id + ' y tampoco devolverla a HODOS. Créala de nuevo en HODOS.' };
        });
      }
      return { ok: true, texto: id + ' · ' + inversaResumenLineas_(lineas) };
    }).catch(function (err) {
      return { ok: false, texto: 'No se pudo leer la torre en HODOS (' + (err && err.message ? err.message : err) + '). Añádela a mano.' };
    }).then(function (res) {
      delete inversaEnVuelo_[id];
      return res;
    });
  }

  function inversaAnadirDesdeInput_() {
    var input = document.getElementById('inversa-input-codigo');
    var valor = input.value;
    if (!inversaNormalizarCodigo_(valor)) return;
    var teniaFoco = (document.activeElement === input);
    input.value = '';
    inversaProcesarCodigo_(valor).then(function (res) {
      inversaMensaje_(res.texto, res.ok);
      if (teniaFoco) input.focus();
    });
  }

  function inversaQuitarTorre_(id) {
    var flete = FleteTorijaActivo;
    var camion = flete ? CamionesTorijaAbiertos[flete] : null;
    var torre = camion && camion.torres ? camion.torres[id] : null;
    if (!torre) return;
    var lineas = inversaLineasComoArray_(torre.lineas);
    inversaConfirmar_('Quitar torre ' + id, 'Se restará ' + inversaResumenLineas_(lineas) + ' de este camión y la torre volverá a HODOS.', 'Sí, quitar', function () {
      inversaLlamar_('devolverTorreEnHodos', id, lineas, torre.creadaEn || null).then(function (r) {
        if (!r || (!r.ok && r.motivo !== 'YA_EXISTE')) {
          mostrarNotificacion('No se pudo devolver', 'HODOS no aceptó la torre ' + id + '. No se ha quitado del camión.', '❌');
          return;
        }
        var vivo = CamionesTorijaAbiertos[flete];
        if (!vivo) return;
        var avisos = inversaAplicarAlCamion_(flete, lineas, -1);
        if (vivo.torres) delete vivo.torres[id];
        guardarMemoriaTorija();
        inversaRepintar_();
        inversaMensaje_(id + ' devuelta a HODOS.' + (avisos.length ? ' Ojo: había menos cantidad de la que se quitó (se dejó en 0).' : ''), true);
      }).catch(function (err) {
        mostrarNotificacion('No se pudo devolver', 'No se pudo hablar con HODOS (' + (err && err.message ? err.message : err) + '). No se ha quitado del camión.', '❌');
      });
    });
  }

  // Antes de borrar un camión se devuelven todas sus torres a HODOS. Si alguna no se puede devolver,
  // el camión NO se borra (así no se pierden). Resuelve {ok, fallidas}.
  function inversaDevolverTodas_(flete) {
    var camion = CamionesTorijaAbiertos[flete];
    var torres = camion && camion.torres ? camion.torres : {};
    var fallidas = [];
    return Object.keys(torres).reduce(function (cadena, id) {
      return cadena.then(function () {
        var t = torres[id];
        return inversaLlamar_('devolverTorreEnHodos', id, inversaLineasComoArray_(t.lineas), t.creadaEn || null).then(function (r) {
          if (!r || (!r.ok && r.motivo !== 'YA_EXISTE')) fallidas.push(id);
        }, function () { fallidas.push(id); });
      });
    }, Promise.resolve()).then(function () {
      return { ok: fallidas.length === 0, fallidas: fallidas };
    });
  }

  // Pestaña del escáner de cámara (modelo del portal de Kairos). window.open va PRIMERO y dentro del
  // clic: si no, Android bloquea la ventana.
  function inversaAbrirEscaner_() {
    if (!INVERSA_DISPONIBLE_) return;
    var ventana = window.open('', '_blank');
    if (!ventana) {
      inversaMensaje_('El navegador bloqueó la ventana de la cámara. Permite las ventanas emergentes de esta página o teclea el código.', false);
      return;
    }
    var id = 'i' + (++inversaEscanerSeq_) + '_' + Math.random().toString(36).slice(2);
    var vigilar = null;
    function limpiar() {
      window.removeEventListener('message', alMensaje);
      clearInterval(vigilar);
    }
    function alMensaje(ev) {
      if (ev.source !== ventana || !ev.data || ev.data.inversaEscaner !== id) return;
      if (ev.data.fin) { limpiar(); return; }
      if (!ev.data.codigo) return;
      inversaProcesarCodigo_(ev.data.codigo).then(function (res) {
        try { ventana.postMessage({ inversaEscanerAck: id, seq: ev.data.seq, ok: res.ok, texto: res.texto }, '*'); } catch (e) {}
        inversaMensaje_(res.texto, res.ok);
      });
    }
    window.addEventListener('message', alMensaje);
    vigilar = setInterval(function () { if (ventana.closed) limpiar(); }, 700);
    ventana.document.open();
    ventana.document.write(inversaEscanerHtml_(id, INVERSA_ESCANER_CONTINUO_));
    ventana.document.close();
  }

  // Repinta el bloque según el camión que se está viendo (se llama al entrar, al refrescar desde
  // Firebase y tras cada cambio).
  function inversaRepintar_() {
    var bloque = document.getElementById('inversa-bloque');
    if (!bloque) return;
    var camion = FleteTorijaActivo ? CamionesTorijaAbiertos[FleteTorijaActivo] : null;
    var visible = INVERSA_DISPONIBLE_ && !!camion;
    bloque.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    var torres = camion.torres || {};
    var ids = Object.keys(torres).sort(function (a, b) { return (torres[b].hora || 0) - (torres[a].hora || 0); });
    document.getElementById('inversa-contador').textContent = String(ids.length);
    var cont = document.getElementById('inversa-lista');
    if (ids.length === 0) {
      cont.innerHTML = '<p style="color:#777; font-size:14px; margin:6px 0;">Aún no has bipado ninguna torre en este camión.</p>';
      return;
    }
    cont.innerHTML = ids.map(function (id) {
      var lineas = inversaLineasComoArray_(torres[id].lineas);
      return '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border:1px solid #ffe0b2; border-radius:6px; margin-bottom:6px; background:#fffaf3;">' +
        '<div><strong style="color:#e65100;">' + inversaEsc_(id) + '</strong>' +
        '<div style="font-size:13px; color:#555; margin-top:2px;">' + inversaEsc_(inversaResumenLineas_(lineas)) + '</div></div>' +
        '<button type="button" data-inversa-quitar="' + inversaEsc_(id) + '" style="background:#ffebee; border:1px solid #ffcdd2; color:#d32f2f; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer;">Quitar</button>' +
        '</div>';
    }).join('');
  }

  function inversaAlEntrarCamion_(flete) {
    var msg = document.getElementById('inversa-mensaje');
    if (msg) msg.style.display = 'none';
    inversaRepintar_();
  }

  function inversaAlSalirCamion_() {
    var msg = document.getElementById('inversa-mensaje');
    if (msg) msg.style.display = 'none';
    inversaRepintar_();
  }

  function inversaIniciar_() {
    var input = document.getElementById('inversa-input-codigo');
    if (!input) return;
    input.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      inversaAnadirDesdeInput_();
    });
    document.getElementById('btn-inversa-anadir').addEventListener('click', inversaAnadirDesdeInput_);
    document.getElementById('btn-inversa-escanear').addEventListener('click', inversaAbrirEscaner_);
    document.getElementById('inversa-lista').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-inversa-quitar]');
      if (b) inversaQuitarTorre_(b.getAttribute('data-inversa-quitar'));
    });
    // El interruptor lo decide el servidor (propiedades del script). Hasta que contesta, el bloque no se ve.
    google.script.run.withSuccessHandler(function (activo) {
      INVERSA_DISPONIBLE_ = !!activo;
      inversaRepintar_();
    }).withFailureHandler(function () {
      INVERSA_DISPONIBLE_ = false;
    }).bipadoInversaDisponible();
  }

  inversaIniciar_();
</script>
```

- [ ] **Step 4: Añadir el bloque visual y el modal en `src/Modulo_Plataforma.html`**

Crea `$env:TEMP\inversa_preview\inversa_plataforma_html.py` y ejecútalo (cada anclaje debe aparecer exactamente una vez):

```powershell
@'
import re, sys
raiz = sys.argv[1]

def leer(nombre):
    return open(raiz + '/' + nombre, encoding='utf-8', newline='').read()

def escribir(nombre, texto):
    open(raiz + '/' + nombre, 'w', encoding='utf-8', newline='').write(texto)

# ---- Modulo_Plataforma.html ----
s = leer('Modulo_Plataforma.html')
nl = '\r\n' if '\r\n' in s else '\n'

BLOQUE = """      <!-- PRECARGA INVERSA (HODOS): bipado de torres. Oculto hasta que el servidor confirma que el bipado está activado. -->
      <div id="inversa-bloque" style="display:none; background:#fff; border:2px solid #ffcc80; border-radius:8px; padding:18px; margin-bottom:25px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          <h3 style="margin:0; color:#e65100; font-size:20px;">Torres de la Precarga (HODOS)</h3>
          <span style="color:#777; font-size:14px;">Bipadas: <strong id="inversa-contador">0</strong></span>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:stretch;">
          <input type="text" id="inversa-input-codigo" placeholder="Bipa o teclea INV-000123" autocomplete="off" autocapitalize="characters" style="flex:1; min-width:200px; padding:14px; border:2px solid #ffcc80; border-radius:6px; font-size:18px; font-weight:bold; text-transform:uppercase; box-sizing:border-box;">
          <button type="button" id="btn-inversa-anadir" style="background:#ef6c00; color:white; border:none; padding:14px 22px; border-radius:6px; font-weight:bold; font-size:16px; cursor:pointer;">Añadir</button>
          <button type="button" id="btn-inversa-escanear" style="background:#1565c0; color:white; border:none; padding:14px 22px; border-radius:6px; font-weight:bold; font-size:16px; cursor:pointer;">Escanear con cámara</button>
        </div>
        <div id="inversa-mensaje" style="display:none; margin-top:12px; padding:12px; border-radius:6px; font-size:15px; font-weight:bold;"></div>
        <div id="inversa-lista" style="margin-top:14px;"></div>
      </div>

""".replace('\n', nl)

ancla = '      <!-- Cuadrícula Gigante Torija -->'
assert s.count(ancla) == 1, ('ancla de la cuadrícula', s.count(ancla))
s = s.replace(ancla, BLOQUE + ancla)

MODAL = """

<!-- Confirmación propia del bipado de torres (quitar una torre del camión). -->
<div id="modal-inversa-confirmar" class="modal" style="display:none; z-index: 8000;">
  <div class="modal-content" style="max-width: 360px; text-align: center; padding: 30px 20px;">
    <h3 id="inversa-confirmar-titulo" style="margin-top: 0; color: #e65100; font-size: 18px;">Quitar torre</h3>
    <p id="inversa-confirmar-texto" style="color: #555; font-size: 14px; margin-bottom: 25px; line-height: 1.4;"></p>
    <div style="display: flex; gap: 10px;">
      <button type="button" id="btn-inversa-confirmar-no" style="flex:1; padding:12px; background:#f8f9fa; border:1px solid #ccc; border-radius:6px; cursor:pointer; color:#333; font-weight:bold; font-size:14px;">Cancelar</button>
      <button type="button" id="btn-inversa-confirmar-si" style="flex:1; padding:12px; background:#ef6c00; border:none; border-radius:6px; cursor:pointer; color:white; font-weight:bold; font-size:14px;">Sí, quitar</button>
    </div>
  </div>
</div>
""".replace('\n', nl)
s = s.rstrip() + MODAL
escribir('Modulo_Plataforma.html', s)

# ---- Index.html ----
s = leer('Index.html')
nl = '\r\n' if '\r\n' in s else '\n'
viejo = "  <?!= include('JS_Plataforma'); ?>"
assert s.count(viejo) == 1, ('include JS_Plataforma', s.count(viejo))
s = s.replace(viejo, viejo + nl + "  <?!= include('JS_Inversa'); ?>")
escribir('Index.html', s)

# ---- JS_Plataforma.html: cuatro enganches (regex tolerante al espaciado, exige 1 coincidencia) ----
s = leer('JS_Plataforma.html')
nl = '\r\n' if '\r\n' in s else '\n'

def sub1(patron, repl):
    global s
    nuevo, n = re.subn(patron, repl, s, count=0, flags=re.S)
    assert n == 1, (patron[:70], 'esperaba 1, hay', n)
    s = nuevo

sub1(r"(function entrarCamionTorija\(flete\) \{.*?dibujarCuadriculaTorija\(\);\s*refrescarSoportesTorijaEnPantalla\(\);)(\s*\})",
     lambda m: m.group(1) + nl + '    if (typeof inversaAlEntrarCamion_ === "function") inversaAlEntrarCamion_(flete);' + m.group(2))

sub1(r"(function refrescarSoportesTorijaEnPantalla\(\) \{.*?actualizarSoporteTorija\(item\.id, cantidad\);\s*\}\);)(\s*\})",
     lambda m: m.group(1) + nl + '    if (typeof inversaRepintar_ === "function") inversaRepintar_();' + m.group(2))

sub1(r"(function volverAMuellesTorija\(\) \{.*?document\.getElementById\('torija-dashboard'\)\.style\.display = 'block';\s*dibujarTarjetasTorija\(\);)(\s*\})",
     lambda m: m.group(1) + nl + '    if (typeof inversaAlSalirCamion_ === "function") inversaAlSalirCamion_();' + m.group(2))

NUEVO_BORRAR = """
      document.getElementById('modal-borrar-camion').style.display = 'none';
      var borrar = function() {
        delete CamionesTorijaAbiertos[flete];
        guardarMemoriaTorija();
        dibujarTarjetasTorija();
      };
      // Precarga Inversa: antes de borrar el camión se devuelven sus torres bipadas a HODOS; si alguna
      // no se puede devolver, el camión NO se borra para no perderlas.
      if (typeof inversaDevolverTodas_ === "function") {
        inversaDevolverTodas_(flete).then(function(res) {
          if (res.ok) { borrar(); }
          else { mostrarNotificacion("Camión no eliminado", "No se pudieron devolver a HODOS estas torres: " + res.fallidas.join(", ") + ". Reintenta; mientras HODOS no responda, el camión sigue abierto para no perderlas.", "⚠️"); }
        });
      } else { borrar(); }""".replace('\n', nl)

def reemplazo_borrar(m):
    assert 'delete CamionesTorijaAbiertos[flete]' in m.group(2), 'cuerpo inesperado de borrarCamionTorija'
    return m.group(1) + NUEVO_BORRAR + m.group(3)

sub1(r"(function borrarCamionTorija\(flete\) \{.*?btn\.onclick = function\(\) \{)(.*?)(\s*\};\s*document\.getElementById\('modal-borrar-camion'\)\.style\.display = 'flex';)",
     reemplazo_borrar)
escribir('JS_Plataforma.html', s)
print('TODO APLICADO')
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\inversa_plataforma_html.py"
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
python "$env:TEMP\inversa_preview\inversa_plataforma_html.py" src
```

Expected: `TODO APLICADO`. Si falla con `AssertionError ... esperaba 1`, la versión de producción cambió respecto al clon: **parar** y revisar el trozo que no se encuentra (no editar a ciegas).

- [ ] **Step 5: Ejecutar los tests**

```powershell
node --test
```

Expected: todo en verde (`jsInversaPuro`, `backendInversaHodos`, `interfazInversa`).

- [ ] **Step 6: Ver la pantalla con Firebase y servidor simulados (Chrome headless)**

```powershell
@'
const fs = require('fs');
const raiz = 'C:/Users/30081048/Desktop/Proyectos/Plataforma/src/';
let html = fs.readFileSync(raiz + 'Index.html', 'utf8');
html = html.replace(/<\?!=\s*include\('([^']+)'\);\s*\?>/g, (m, f) => fs.readFileSync(raiz + f + '.html', 'utf8'));
html = html.replace(/<\?=?[^?]*\?>/g, '');
html = html.replace(/<script[^>]*src="https:\/\/(www\.gstatic\.com|unpkg\.com)[^"]*"[^>]*><\/script>/g, '');
const mock = '<script>' +
  'window.firebase={apps:[1],initializeApp:function(){},database:function(){return {ref:function(){return {on:function(ev,cb){setTimeout(function(){cb({val:function(){return window.__nube;}});},50);},set:function(v){window.__fbset=v;},child:function(){return {set:function(){},remove:function(){}};}};}};}};' +
  'window.__nube={"PRUEBA-INV":{flete:"PRUEBA-INV",soportes:{S01:5,S16:5},torres:{"INV-000012":{lineas:[{id:"S01",nombre:"EUROPEO",cantidad:5},{id:"S16",nombre:"JAULA",cantidad:5}],creadaEn:"2026-10-06T08:00:00Z",hora:1}}}};' +
  'window.__mock=function(n,a){switch(n){' +
  'case "bipadoInversaDisponible":return true;' +
  'case "obtenerCatalogoSoportes":return [{id:"S01",nombre:"EUROPEO",imagenUrl:"",volumen:"1",tipo:"Palet"},{id:"S02",nombre:"PALETINA",imagenUrl:"",volumen:"1",tipo:"Palet"},{id:"S16",nombre:"JAULA",imagenUrl:"",volumen:"1",tipo:"Jaula"}];' +
  'case "consumirTorreEnHodos":return {ok:true,id:a[0],lineas:[{id:"S02",nombre:"PALETINA",cantidad:4}],total:4,creadaEn:"2026-10-06T09:00:00Z"};' +
  'case "devolverTorreEnHodos":return {ok:true,id:a[0]};' +
  'default:return {exito:true,operarios:[],pendientes:[]};}};' +
  'function crear(ok,fail){return new Proxy({},{get:function(_,n){' +
  'if(n==="withSuccessHandler")return function(f){return crear(f,fail);};' +
  'if(n==="withFailureHandler")return function(f){return crear(ok,f);};' +
  'return function(){var a=Array.prototype.slice.call(arguments);setTimeout(function(){try{ok(window.__mock(n,a));}catch(e){fail&&fail({message:e.message});}},20);};}});}' +
  'window.google={script:{run:crear(function(){},function(){}),url:{getLocation:function(cb){cb({parameter:{rol:"Plataforma"}});}}}};' +
  '</script>';
html = html.replace(/<body[^>]*>/, function (m) { return m + mock; });
// OJO: el primer "</body>" del texto está dentro de una cadena de JS (la página del escáner); hay que
// insertar antes del ÚLTIMO.
const final = '<script>setTimeout(function(){abrirSeccionPlataforma("expedicion");entrarCamionTorija("PRUEBA-INV");inversaProcesarCodigo_("INV-000099").then(function(r){inversaMensaje_(r.texto,r.ok);});},600);</script>';
const iFin = html.lastIndexOf('</body>');
html = html.slice(0, iFin) + final + html.slice(iFin);
fs.writeFileSync(process.env.TEMP + '/inversa_preview/plataforma_inversa.html', html);
console.log('ok');
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\preview_plataforma.js"
node "$env:TEMP\inversa_preview\preview_plataforma.js"
$u2 = "file:///$($env:TEMP -replace '\\','/')/inversa_preview/plataforma_inversa.html"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --screenshot="$env:TEMP\inversa_preview\plataforma_inversa.png" --window-size=1100,1300 --virtual-time-budget=8000 $u2
```

Expected: se crea `plataforma_inversa.png`. Ábrelo: dentro de "Destino: Almacén Torija / Nº Flete PRUEBA-INV" debe verse el bloque naranja "Torres de la Precarga (HODOS)" con "Bipadas: 2" (la de Firebase `INV-000012` + la bipada simulada `INV-000099`), el campo, los botones "Añadir" y "Escanear con cámara", un mensaje verde con `INV-000099 · 4 × PALETINA`, y en la lista las dos torres con su botón "Quitar". Las casillas de abajo deben mostrar EUROPEO 5, JAULA 5 y PALETINA 4. Si algo no cuadra, corregir el HTML/JS y repetir.

- [ ] **Step 7: Comprobar que la app sigue idéntica con el interruptor apagado**

Repite el Step 6 cambiando en `preview_plataforma.js` `case "bipadoInversaDisponible":return true;` por `return false;`, regenera y captura. Expected: la pantalla del camión **no** muestra el bloque "Torres de la Precarga" (el resto igual que antes).

- [ ] **Step 8: Commit**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
git status --short
git add -A
git commit -m @'
feat: bloque Bipar torre en el camion de Torija y enganches minimos (interruptor por propiedades)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
git diff base-produccion --stat -- src
```

Expected: cambios solo en `src/JS_Inversa.html`, `src/Backend_InversaHodos.js` (nuevos), `src/Modulo_Plataforma.html`, `src/JS_Plataforma.html` (pocas líneas) y `src/Index.html` (1 línea).

---

## Task 11: Pasada completa de Plataforma (local)

**Files:** ninguno.

- [ ] **Step 1: Todo en verde y diferencias acotadas**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test
git diff base-produccion -- src/JS_Plataforma.html
```

Expected: `ℹ fail 0`. El diff de `JS_Plataforma.html` debe contener **solo** las 4 modificaciones (3 líneas `if (typeof inversa...` y el cuerpo nuevo del botón de `borrarCamionTorija`). Si hay más, deshacerlo.

---

## Task 12: Migración de Supabase (producción) — *requiere OK del usuario*

**Files:** ninguno (base de datos).

- [ ] **Step 1: Pedir el OK al usuario**

Escribe al usuario, en lenguaje llano: "Voy a crear en el Supabase de producción **una tabla nueva** (`torres_inversa`), **una secuencia** y **una función** para los números de torre. No toca ninguna tabla existente. Si algo fuera mal se borra con tres líneas. ¿Lo ejecuto?" **No continuar sin un sí explícito.**

- [ ] **Step 2: Aplicar la migración**

Con la herramienta de Supabase `apply_migration` (si no está cargada, cárgala con ToolSearch: `select:mcp__149af093-a1c0-4d42-a426-fe769018596e__apply_migration`; project_id `dbxlrnupiwemnarlxmcv`, name `precarga_inversa_torres`) y esta consulta:

```sql
create sequence if not exists public.seq_torres_inversa_id;

create table public.torres_inversa (
  id_unico       text primary key,
  lineas         jsonb not null,
  total_soportes integer not null,
  creado_por     text,
  fecha_creacion timestamptz not null default now(),
  constraint torres_inversa_lineas_array check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) > 0),
  constraint torres_inversa_total_positivo check (total_soportes > 0)
);

alter table public.torres_inversa enable row level security;

create or replace function public.siguiente_id_torre_inversa() returns text
language plpgsql as $$
declare n bigint;
begin
  n := nextval('seq_torres_inversa_id');
  return 'INV-' || lpad(n::text, 6, '0');
end $$;

revoke execute on function public.siguiente_id_torre_inversa() from public, anon, authenticated;
grant  execute on function public.siguiente_id_torre_inversa() to service_role;
```

Expected: éxito sin errores.

- [ ] **Step 3: Verificar (solo lectura)**

Con `execute_sql`:

```sql
select to_regclass('public.torres_inversa') is not null as tabla,
       to_regclass('public.seq_torres_inversa_id') is not null as secuencia,
       (select relrowsecurity from pg_class where oid = 'public.torres_inversa'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'torres_inversa') as politicas,
       has_function_privilege('anon', 'public.siguiente_id_torre_inversa()', 'execute') as anon_ejecuta,
       has_function_privilege('service_role', 'public.siguiente_id_torre_inversa()', 'execute') as service_ejecuta,
       (select count(*) from public.torres_inversa) as filas;
```

Expected: `tabla=true, secuencia=true, rls=true, politicas=0, anon_ejecuta=false, service_ejecuta=true, filas=0`. **No llamar a la función** (gastaría el número 1).

- [ ] **Step 4: Asesor de seguridad**

Con `get_advisors` (type `security`): comprobar que no aparece ningún aviso **nuevo y grave** sobre `torres_inversa` (un aviso informativo de "RLS activado sin políticas" es el mismo que ya tienen las otras tablas y es lo esperado).

- [ ] **Step 5: Vuelta atrás (solo si hiciera falta)**

```sql
drop function if exists public.siguiente_id_torre_inversa();
drop table if exists public.torres_inversa;
drop sequence if exists public.seq_torres_inversa_id;
```

---

## Task 13: Desplegar HODOS — *requiere OK del usuario*

**Files:** ninguno (despliegue). El método parte SIEMPRE de la versión de producción y aplica solo los commits de este plan, para no arrastrar cambios de otras sesiones.

- [ ] **Step 1: Pedir el OK al usuario**

Escribe: "La migración está lista. Voy a subir HODOS con la pestaña nueva y las dos acciones nuevas del webhook. Las acciones no se usan hasta que Plataforma las llame, y la pestaña solo aparece en el panel. Si algo falla, vuelvo a la versión anterior en un comando. ¿Lo subo?" **No continuar sin un sí explícito.**

- [ ] **Step 2: Ver cuál es la versión de producción**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
clasp deployments
```

Expected: una línea para `AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ @<N>`. **Anota `<N>`** (versión de producción actual).

- [ ] **Step 3: Preparar las ayudas y bajar la versión de producción a una carpeta aparte**

Cada bloque de PowerShell arranca limpio (no conserva variables ni funciones del anterior), así que las rutas y la función de comparación van en un archivo de ayudas que cada bloque carga con `. "$env:TEMP\inversa_preview\ayudas.ps1"`:

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\inversa_preview" | Out-Null
@'
$hodos  = 'C:\Users\30081048\Desktop\Proyectos\hodos'
$plat   = 'C:\Users\30081048\Desktop\Proyectos\Plataforma'
$prod   = Join-Path $env:TEMP 'hodos_prod_inversa'
$deploy = Join-Path $env:TEMP 'hodos_deploy_inversa'
$verif  = Join-Path $env:TEMP 'hodos_verif_inversa'
# Hash del contenido con los saltos de línea normalizados (el repo local puede tener CRLF y Google LF).
function Hash-Norm($ruta) {
  $t = [IO.File]::ReadAllText($ruta).Replace("`r`n", "`n")
  [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($t)))
}
'@ | Set-Content -Encoding utf8 "$env:TEMP\inversa_preview\ayudas.ps1"
. "$env:TEMP\inversa_preview\ayudas.ps1"
if (Test-Path $prod) { Remove-Item -Recurse -Force $prod }
New-Item -ItemType Directory $prod | Out-Null
Copy-Item "$hodos\.clasp.json", "$hodos\.claspignore" $prod
Set-Location $prod
clasp pull --versionNumber <N>
Get-ChildItem $prod -File | Select-Object Name | Format-Table -AutoSize
```

Expected: los `.gs`, `Index.html` y `appsscript.json` de producción.

- [ ] **Step 4: Comprobar que lo único que difiere entre producción y el repo son los archivos de este plan**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
$archivos = Get-ChildItem $prod -File | Where-Object { $_.Name -match '\.(gs|html|json)$' }
foreach ($a in $archivos) {
  $local = Join-Path $hodos $a.Name
  if (-not (Test-Path $local)) { "SOLO EN PRODUCCION: $($a.Name)" }
  elseif ((Hash-Norm $a.FullName) -ne (Hash-Norm $local)) { "DIFIERE: $($a.Name)" }
}
Get-ChildItem $hodos -File | Where-Object { $_.Name -match '\.(gs|html)$' } | ForEach-Object {
  if (-not (Test-Path (Join-Path $prod $_.Name))) { "SOLO LOCAL: $($_.Name)" }
}
```

Expected: **solo** estas líneas: `DIFIERE: Backend.gs`, `DIFIERE: IntegracionIncpc.gs`, `DIFIERE: Index.html`, `SOLO LOCAL: PrecargaInversa.gs`. **Si aparece cualquier otro archivo**, otra sesión cambió algo (desplegado o no): **parar y avisar al usuario** con la lista; no desplegar.

- [ ] **Step 5: Construir la carpeta de despliegue = producción + solo los commits de este plan**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
if (Test-Path $deploy) { Remove-Item -Recurse -Force $deploy }
Copy-Item $prod $deploy -Recurse
$parches = Join-Path $env:TEMP 'inversa_parches'
if (Test-Path $parches) { Remove-Item -Recurse -Force $parches }
New-Item -ItemType Directory $parches | Out-Null
Set-Location $hodos
# Un parche por commit de este plan, solo con los 4 archivos de producción que tocan (git los escribe
# directo a archivo: pasar el parche por la tubería de PowerShell estropearía los saltos de línea).
$n = 0
foreach ($c in (git log --grep='\[precarga-inversa\]' --reverse --format=%H)) {
  $n++
  git format-patch -1 $c -o ("{0}\{1:D2}" -f $parches, $n) -- PrecargaInversa.gs Backend.gs IntegracionIncpc.gs Index.html | Out-Null
}
Set-Location $deploy
foreach ($p in (Get-ChildItem $parches -Recurse -Filter *.patch | Sort-Object FullName)) {
  git apply --check $p.FullName
  if ($LASTEXITCODE -ne 0) { "NO APLICA: $($p.FullName)"; break }
  git apply $p.FullName
  "aplicado: $($p.Name)"
}
Get-ChildItem $deploy -File | Select-Object Name | Format-Table -AutoSize
```

Expected: una línea `aplicado: ...` por cada commit de este plan que toca esos archivos (los de las Tasks 1 a 5; los que solo tocan tests o docs no generan parche) y `PrecargaInversa.gs` presente en `$deploy`. Si algún parche falla con `NO APLICA`, repetir ese `git apply` con `--ignore-whitespace` (diferencias de saltos de línea); si falla por contenido, **parar** y avisar.

- [ ] **Step 6: Tests sobre lo que se va a subir**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
Set-Location $deploy
New-Item -ItemType Directory "$deploy\test" | Out-Null
foreach ($t in 'precargaInversa', 'precargaInversaDatos', 'precargaInversaEtiqueta', 'precargaInversaWebhook', 'indexInversa',
               'integracionArrastresWebhook', 'contarPendientesPorPestana', 'backendAdmin', 'temasIndex', 'utilidades') {
  Copy-Item "$hodos\test\$t.test.js" "$deploy\test\"
}
node --test
Remove-Item -Recurse -Force "$deploy\test"
```

Expected: `ℹ fail 0`. Son los tests de este plan más los de regresión de lo que se toca (webhook, insignias, `Backend.gs`, temas, utilidades), ejecutados contra el código exacto que se sube. Si falla alguno, **parar** y avisar (no es seguro seguir).

- [ ] **Step 7: Subir, versionar y desplegar**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
Set-Location $deploy
clasp push --force
clasp version "Precarga Inversa: pestana y acciones del webhook"
clasp versions
```

Anota el número de la versión nueva (`<N2>`). Después:

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
Set-Location $deploy
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ -V <N2> -d "Precarga Inversa"
clasp deployments
```

Expected: el despliegue estable pasa a `@<N2>`.

- [ ] **Step 8: Verificar lo desplegado**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
if (Test-Path $verif) { Remove-Item -Recurse -Force $verif }
New-Item -ItemType Directory $verif | Out-Null
Copy-Item "$hodos\.clasp.json", "$hodos\.claspignore" $verif
Set-Location $verif
clasp pull --versionNumber <N2>
foreach ($a in (Get-ChildItem $verif -File | Where-Object { $_.Name -match '\.(gs|html|json)$' })) {
  $dep = Join-Path $deploy $a.Name
  $pro = Join-Path $prod $a.Name
  $igualDeploy = (Test-Path $dep) -and ((Hash-Norm $a.FullName) -eq (Hash-Norm $dep))
  $igualProd = (Test-Path $pro) -and ((Hash-Norm $a.FullName) -eq (Hash-Norm $pro))
  "{0,-28} igual-a-lo-subido={1,-5} igual-a-produccion-anterior={2}" -f $a.Name, $igualDeploy, $igualProd
}
```

Expected: todos `igual-a-lo-subido=True`; `igual-a-produccion-anterior=False` solo en `Backend.gs`, `IntegracionIncpc.gs`, `Index.html`, `PrecargaInversa.gs`.

- [ ] **Step 9: Comprobación en la app real (el usuario)**

Pide al usuario que abra el panel de HODOS → barra lateral → **Inversa → Precarga Inversa** y compruebe: (a) carga el catálogo de soportes con los tipos agrupados; (b) la lista de torres dice "No hay torres precargadas" y no hay insignia; (c) el resto de pestañas siguen igual. Si el catálogo da error de permisos, es que la cuenta que despliega HODOS no tiene acceso al documento de soportes de Plataforma: avisar al usuario (hay que compartírselo) y no seguir.

- [ ] **Step 10: Vuelta atrás (solo si hiciera falta)**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ -V <N>
```

---

## Task 14: Desplegar Plataforma con el interruptor apagado — *requiere OK del usuario*

**Files:** ninguno (despliegue).

- [ ] **Step 1: Pedir el OK al usuario**

Escribe: "Voy a subir la app de Plataforma con el bipado **apagado**: los operarios la verán exactamente igual que hoy hasta que activemos las dos propiedades. Conviene hacerlo cuando no haya camiones abiertos en Torija. ¿Lo subo ahora?" **No continuar sin un sí explícito.**

- [ ] **Step 2: Comprobar que producción no ha cambiado desde la línea base**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
clasp deployments
```

Anota el despliegue que usan los operarios y su versión actual `<P>`. Después:

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
$base = Join-Path $env:TEMP 'plataforma_prod_ahora'
$etiqueta = Join-Path $env:TEMP 'plataforma_linea_base'
if (Test-Path $base) { Remove-Item -Recurse -Force $base }
if (Test-Path $etiqueta) { git -C $plat worktree remove --force $etiqueta }
New-Item -ItemType Directory $base | Out-Null
Copy-Item "$plat\.clasp.json" $base
Set-Location $base
clasp pull --versionNumber <P>
# La línea base (etiqueta base-produccion) se saca a una carpeta temporal con git worktree, sin tocar el repo.
git -C $plat worktree add --detach $etiqueta base-produccion
foreach ($f in (Get-ChildItem "$base\src" -File)) {
  $b = Join-Path "$etiqueta\src" $f.Name
  if (-not (Test-Path $b)) { "NUEVO EN PRODUCCION: $($f.Name)" }
  elseif ((Hash-Norm $b) -ne (Hash-Norm $f.FullName)) { "CAMBIO EN PRODUCCION: $($f.Name)" }
}
foreach ($f in (Get-ChildItem "$etiqueta\src" -File)) {
  if (-not (Test-Path (Join-Path "$base\src" $f.Name))) { "BORRADO EN PRODUCCION: $($f.Name)" }
}
git -C $plat worktree remove --force $etiqueta
```

Expected: sin ninguna línea (producción == línea base). Si aparece alguna, alguien modificó Plataforma después de crear la línea base: **parar y avisar**; habría que integrar su cambio antes de subir.

- [ ] **Step 3: Tests y subida**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
node --test
clasp push --force
clasp version "Precarga Inversa: bipado de torres (apagado por defecto)"
clasp versions
```

Anota la versión nueva `<P2>`. Después, con el id del despliegue anotado en el Step 2:

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
clasp deploy -i <ID_DESPLIEGUE_OPERARIOS> -V <P2> -d "Precarga Inversa (apagada)"
clasp deployments
```

Expected: el despliegue de los operarios pasa a `@<P2>`.

- [ ] **Step 4: Verificar lo desplegado**

```powershell
. "$env:TEMP\inversa_preview\ayudas.ps1"
$verifP = Join-Path $env:TEMP 'plataforma_verif'
if (Test-Path $verifP) { Remove-Item -Recurse -Force $verifP }
New-Item -ItemType Directory $verifP | Out-Null
Copy-Item "$plat\.clasp.json" $verifP
Set-Location $verifP
clasp pull --versionNumber <P2>
foreach ($f in (Get-ChildItem "$verifP\src" -File)) {
  $loc = Join-Path "$plat\src" $f.Name
  "{0,-30} igual-a-local={1}" -f $f.Name, ((Test-Path $loc) -and ((Hash-Norm $f.FullName) -eq (Hash-Norm $loc)))
}
```

Expected: todos `igual-a-local=True`.

- [ ] **Step 5: Comprobar con el usuario que la app sigue igual y si pide permisos**

Pide al usuario que abra la app de Plataforma (el mismo enlace de siempre): debe verse **igual que ayer**, incluida "Expedición a Torija", y no debe salir el bloque de bipado. Pregúntale también si Google le pidió autorizar permisos nuevos; si lo pidió, que los acepte (se hace una sola vez). Si algo no funciona como antes, vuelta atrás:

```powershell
cd C:\Users\30081048\Desktop\Proyectos\Plataforma
clasp deploy -i <ID_DESPLIEGUE_OPERARIOS> -V <P>
```

---

## Task 15: Prueba real, a una hora tranquila — *requiere OK del usuario*

**Files:** ninguno.

- [ ] **Step 1: Pedir el OK y fijar el momento**

Escribe: "Voy a hacer la prueba real contigo. Hace falta un rato **sin camiones abiertos en Torija** y la tablet. Usaré un camión de prueba con el flete `PRUEBA-INV`: durante unos minutos se verá en la pantalla de Torija y en la Torre de Control, y **nunca pulsaremos Finalizar** en él (escribiría en el control de soportes y mandaría el correo). ¿Cuándo te viene bien?" **No continuar sin un sí y un momento acordado.**

- [ ] **Step 2: Activar el bipado (el usuario, en el editor de Plataforma)**

Indica al usuario, paso a paso y sin pegar secretos en el chat: abrir el proyecto de Plataforma en Apps Script → **Configuración del proyecto** → **Propiedades del script** → añadir:
- `HODOS_WEBAPP_URL`: copiar el valor de la propiedad del mismo nombre del proyecto **INCPC**.
- `HODOS_SHARED_TOKEN`: copiar el valor de `INCPC_SHARED_TOKEN` de las propiedades del proyecto **HODOS**.

Después, recargar la app de Plataforma.

- [ ] **Step 3: Preparar la prueba**

1. En **Plataforma → Expedición a Torija → Abrir Nuevo Camión**: flete `PRUEBA-INV`. Debe aparecer el bloque naranja "Torres de la Precarga (HODOS)" con "Bipadas: 0".
2. En **HODOS → Inversa → Precarga Inversa**, crear la torre **A** (3 EUROPEO + 2 JAULA) y la torre **B** (4 PALETINA). Cada una abre la ventana de impresión: imprimir en la Zebra.
3. Mirar las dos etiquetas impresas: legibles, desglose completo, total correcto, código de barras nítido. La insignia de la barra lateral de HODOS marca 2.

- [ ] **Step 4: Recorrido de la prueba (marcar cada punto en la tablet)**

1. Bipar **A** con la pistola (o tecleando el código) → mensaje verde; las casillas del camión pasan a EUROPEO 3 y JAULA 2; "Bipadas: 1". En HODOS, pulsar Actualizar: **A ya no está** y la insignia baja a 1.
2. Bipar **A** otra vez → mensaje rojo "ya está en este camión". No cambia nada.
3. Abrir **Escanear con cámara** y bipar **B** con la cámara: ✔ en la pestaña del escáner, suena/vibra, y **la pestaña sigue abierta** (modo continuo). Volver a poner la cámara sobre **B** → no se vuelve a enviar. Pulsar **Terminar**. En Plataforma: PALETINA 4, "Bipadas: 2".
4. En HODOS: no queda ninguna torre; insignia a 0.
5. Pulsar **Quitar** en **B** → confirmar → PALETINA vuelve a 0 y "Bipadas: 1"; en HODOS **B reaparece** (mismo código; su etiqueta física sigue valiendo).
6. Bipar **B** otra vez (cámara) → vuelve a sumar.
7. Probar con la cámara un código de barras cualquiera (p. ej. una etiqueta de HODOS normal `HODOS-…`) → en el escáner sale ✖ "No es una torre de HODOS".
8. Teclear `INV-999999` → rojo "No existe la torre … en HODOS".
9. Tocar a mano una casilla (sumar 1 EUROPEO a mano) → sigue funcionando como siempre.
10. Pulsar el cubo 🗑️ del camión `PRUEBA-INV` → confirmar → las torres **A y B vuelven a HODOS** y el camión desaparece. En HODOS comprobar que A y B están otra vez. **Borrar A y B en HODOS** (limpieza).

- [ ] **Step 5: Si el modo continuo de la cámara no funciona bien**

Síntomas: el escáner dice "Plataforma no responde" aunque la app esté bien, o las torres no se suman hasta volver a la pestaña de Plataforma. Vuelta atrás **sin tocar HODOS**: en `Plataforma\src\JS_Inversa.html` cambiar `var INVERSA_ESCANER_CONTINUO_ = true;` por `false;`, volver a pasar `node --test`, subir con el mismo método de la Task 14 (pasos 2-4, versión nueva) y repetir los puntos 3 y 6 de la prueba. Anotar en el spec que en esa tablet se usa una lectura por pulsación.

- [ ] **Step 6: Apagar si hace falta**

Si algo grave falla en cualquier momento: quitar `HODOS_WEBAPP_URL` y `HODOS_SHARED_TOKEN` de las propiedades de Plataforma (el bipado desaparece al recargar). Las torres que estuvieran bipadas en un camión abierto: borrarlas con 🗑️ **antes** de apagar (si no, no se devuelven) o recrearlas en HODOS.

- [ ] **Step 7: Criterio de éxito**

Todos los puntos del Step 4 se cumplen, `PRUEBA-INV` ya no existe, A y B ya no están en HODOS, y **no** se escribió ninguna fila en el control de soportes ni se mandó ningún correo. Pedir al usuario que lo confirme; después queda activado para el primer camión real (con lo manual como respaldo).

---

## Task 16: Cierre

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-precarga-inversa-design.md` (HODOS)
- Modify: `CLAUDE.md` (HODOS)
- Memoria del proyecto

- [ ] **Step 1: Anotar en el spec los ajustes de la Task "Ajustes respecto al diseño"**

Añade al final del spec, en prosa, una sección `## Ajustes hechos durante la implementación` con los cuatro puntos de "Ajustes respecto al diseño aprobado" de este plan y, si procede, el resultado de la prueba real (p. ej. si el modo continuo funcionó o se recortó).

- [ ] **Step 2: Actualizar `CLAUDE.md` de HODOS**

En la lista "Estructura" añade `PrecargaInversa.gs` (descripción: torres de la Precarga Inversa: catálogo, datos, etiqueta y webhook para Plataforma). En "Documentación" añade las rutas del spec y de este plan. Añade un párrafo en las reglas (en prosa) con lo no obvio:
- una torre existe solo mientras está pendiente (cargar = borrar, sin rastro);
- el webhook `consumirTorreInversa` es atómico gracias a `DELETE ... return=representation` (`supaBorrar_` devuelve las filas borradas);
- `devolverTorreInversa` recrea la torre con el mismo id;
- el catálogo se lee del documento `1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY` con caché de 6 h (`limpiarCacheCatalogoInversa()` fuerza la relectura);
- el despliegue de Plataforma tiene interruptor por propiedades del script.

- [ ] **Step 3: Commit de la documentación de HODOS**

```powershell
cd C:\Users\30081048\Desktop\Proyectos\hodos
git status --short
git add CLAUDE.md docs/superpowers/specs/2026-10-06-precarga-inversa-design.md docs/superpowers/plans/2026-10-06-precarga-inversa.md
git commit -m @'
docs(hodos): Precarga Inversa documentada (CLAUDE.md, ajustes del spec y plan) [precarga-inversa]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 4: Memoria**

Crea `C:\Users\30081048\.claude\projects\C--Users-30081048-Desktop-skills\memory\hodos-precarga-inversa.md` con la descripción del proyecto (qué es, dónde está el spec y el plan, que Plataforma vive en `Desktop\Proyectos\Plataforma` con interruptor por propiedades, versiones desplegadas de HODOS y Plataforma, resultado de la prueba real y vueltas atrás) y añade una línea en `MEMORY.md`: `- [HODOS · Precarga Inversa](hodos-precarga-inversa.md) — torres con etiqueta + bipado desde Plataforma; spec/plan en hodos/docs; interruptor por propiedades en Plataforma`. Enlaza con `[[hodos-app-cargas-etiquetas]]`.

- [ ] **Step 5: Resumen final al usuario**

Informa en español, con lo que se desplegó (versión de HODOS y de Plataforma), cómo se apaga (quitar las dos propiedades), cómo se vuelve atrás (los dos comandos de la Task 13 Step 10 y Task 14 Step 5) y lo que quedó pendiente (por ejemplo, el primer camión real).

---

## Cobertura del diseño

| Requisito del spec | Tarea |
| --- | --- |
| Torre mixta con una etiqueta | 1, 3 |
| Tipos = catálogo de Plataforma sin piezas sueltas | 1, 2 |
| Sin preselección en el formulario | 5 |
| Etiqueta Zebra 100×150 con id, desglose, total, fecha y código de barras | 3 |
| Lista de pendientes con resumen por tipo, reimprimir, editar, borrar | 2, 5 |
| Insignia numérica en la barra lateral | 5 |
| Tabla `torres_inversa` aditiva, RLS sin políticas, secuencia y función | 12 |
| Consumo atómico (borrar al bipar) y `NO_EXISTE` | 4 |
| Devolver recreando con el mismo id; `YA_EXISTE` | 4 |
| Sin informe/PDF/email/rastro en HODOS | (ausencia: ninguna tarea los crea) |
| Plataforma: campo Bipar torre, pistola y teclado | 8, 10 |
| Escáner de cámara continuo (modelo Kairos) con respuesta y aviso de "no responde" | 8, 10 |
| Lista "Torres bipadas" con Quitar (resta y devuelve) | 10 |
| Detección de duplicados en este camión y en otros abiertos | 8, 10 |
| Borrar camión devuelve las torres (y no se borra si fallan) | 10 |
| Interruptor por propiedades del script | 9, 10, 15 |
| Finalizar/PDF/SALIDAS_A sin cambios | (ausencia: solo 4 enganches mínimos) |
| Pruebas con mutación del consumo atómico | 4 |
| Despliegue por pasos con vuelta atrás y prueba real | 12–15 |
| Documentación y memoria | 16 |
