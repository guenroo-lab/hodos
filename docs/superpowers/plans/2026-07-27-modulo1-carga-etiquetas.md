# HODOS Módulo 1 — Carga por lote + Etiquetas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el módulo de HODOS que registra un lote de pedidos pegado desde un
Sheet y genera/imprime sus etiquetas (150mm×100mm, CODE128, logo Taisa, logo Leroy
Merlin, soportes múltiples por pedido).

**Architecture:** Proyecto Google Apps Script standalone (clasp), vinculado a una Sheet
nueva ("HODOS - Pedidos") que hace de base de datos. La lógica pura (parseo de lote,
formateo de textos, encoder CODE128) se desarrolla con TDD real usando el runner de Node
integrado (`node --test`) cargando cada `.gs` con `vm` — no hace falta pytest ni npm
install, y no se puede ejecutar GAS en local. La lógica que depende de servicios de Google
(Sheets, LockService, HtmlService) se verifica con funciones de humo ejecutables desde el
editor de Apps Script tras cada `clasp push`, siguiendo el mismo patrón ya usado en
`lm_produccion` y `hub-herramientas`.

**Tech Stack:** Google Apps Script (V8), HTML/CSS/JS servido por HtmlService, clasp 2.5.0,
Node.js 24 (solo como entorno de test local para la lógica pura, vía `node --test` + `vm`
— nada de esto se despliega).

**Referencias:**
- Diseño: `docs/superpowers/specs/2026-07-27-modulo1-carga-etiquetas-design.md`
- Especificación original: `docs/HODOS_especificacion.md`
- Demo de referencia visual: `docs/demo_referencia_diseno.html`
- Logo Taisa (PNG original): `assets/logo_taisa.png` / base64 precalculado: `assets/logo_taisa.b64.txt`
- Logo Leroy Merlin: **pendiente** — el usuario debe proporcionar el archivo. Task 6 Step 1
  bis queda bloqueado hasta recibirlo; el resto del plan no depende de él.

---

## Cómo se testea cada tipo de código en este proyecto

Google Apps Script **no se puede ejecutar en local** (confirmado en proyectos hermanos:
`lm_produccion`, `hub-herramientas`) — no hay runtime de `SpreadsheetApp`, `LockService`,
`HtmlService`, etc. fuera del editor de Apps Script real. Por eso este plan usa dos
estrategias distintas según el tipo de código:

1. **Lógica pura** (sin llamar a ningún servicio de Google: parseo de texto, formateo,
   encoder CODE128) — SÍ se puede testear en local. Cada archivo `.gs` de este tipo se
   escribe como funciones globales normales (compatibles con Apps Script, que no tiene
   sistema de módulos). El test de Node carga el archivo `.gs` tal cual con
   `vm.runInContext` (sin `require`/`module.exports`, porque Apps Script no los soporta) y
   llama a las funciones globales resultantes. Se ejecuta con `node --test`, que viene
   incluido en Node 24 — no hace falta instalar nada.
2. **Lógica que depende de servicios de Google** (Sheets, LockService, PropertiesService,
   HtmlService, Session) — no testeable en local. Se verifica con funciones de humo en
   `Pruebas.gs`, ejecutadas manualmente por el usuario desde el editor de Apps Script tras
   desplegar (Task 8), igual que `verificarSistema()` en `lm_produccion`.

---

## Task 1: Scaffolding del proyecto

**Files:**
- Create: `Desktop/Proyectos/hodos/appsscript.json`
- Create: `Desktop/Proyectos/hodos/.claspignore`
- Create: `Desktop/Proyectos/hodos/CLAUDE.md`

- [ ] **Step 1: Crear el proyecto Apps Script con clasp**

Run (desde `Desktop/Proyectos/hodos`):
```bash
clasp create --type sheets --title "HODOS - Pedidos" --rootDir .
```
Expected: crea `.clasp.json` con un `scriptId` nuevo, un `appsscript.json` por defecto, y
**una Google Sheet nueva** ("HODOS - Pedidos") con el script adjunto. Usamos `--type sheets`
(no `standalone`): todo el backend está escrito alrededor de
`SpreadsheetApp.getActiveSpreadsheet()`, que solo devuelve algo cuando el script está
vinculado a una hoja concreta — con `standalone` devolvería `null`. Confirma con
`cat .clasp.json` que `scriptId` no está vacío.

Clasp genera además un `Code.gs` de plantilla vacío — borrarlo (`rm Code.gs`), ya que este
proyecto usa `Backend.gs`/`EstructuraSheets.gs`/etc. en su lugar.

- [ ] **Step 2: Configurar `appsscript.json`**

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

- [ ] **Step 3: Crear `.claspignore`**

```
**/**
!appsscript.json
!*.gs
!Index.html
```

(Esto excluye `docs/`, `assets/`, `README`, `CLAUDE.md` y los tests de Node del push a
Apps Script — igual que hace `hub-herramientas` con `.claspignore` excluyendo `*.md`.)

- [ ] **Step 4: Crear `CLAUDE.md` con las reglas del proyecto**

```markdown
# HODOS — Módulo 1 (Carga por lote + Etiquetas)

Sistema de trazabilidad de pedidos cliente de Taisa Logistics. Proyecto GAS standalone,
gestionado con clasp. Sin git (igual que los demás proyectos GAS de Taisa).

## Reglas de oro (aprendidas en lm_producción, aplican aquí igual)

- **Nunca** poner `<style>`, `<script>`, `<!DOCTYPE>`, `<head>` o `<body>` (ni sus cierres)
  como texto literal dentro de un `<script>` inline servido por HtmlService — rompe la
  ejecución de TODO el JS de la página. El HTML de las etiquetas se genera siempre en el
  servidor (`Backend.gs`), nunca como plantilla literal en `Index.html`.
- No se puede ejecutar GAS en local. La lógica pura (parseo, formateo, CODE128) se testea
  con `node --test` (ver `test/`). La lógica con servicios de Google se verifica con
  `Pruebas.gs` desde el editor, tras `clasp push`.
- Tras cualquier cambio aprobado: `clasp push -f`. Para publicar una versión nueva:
  `clasp deploy -i <deploymentId>` (ver `.clasp.json` / `clasp deployments`).
- El número de pedido **no se normaliza a 6 dígitos**. 6 dígitos es lo normal pero no es
  una condición — se guarda tal cual se pega (solo trim de espacios).
- Un número de pedido repetido **dentro del mismo lote pegado** NO es un reenvío: son
  varios soportes/palets del mismo pedido (`calcularSoportes` en `Utilidades.gs`). Se
  numeran en orden de aparición y la etiqueta muestra "SOPORTE X/Y" solo si hay más de 1.
- El logo de Leroy Merlin (`LOGO_LM_B64` en `Backend.gs`) está pendiente del archivo
  oficial del usuario — mientras no llegue, se deja `''` y el `<img>` no pinta nada.

## Estructura

- `EstructuraSheets.gs` — pestaña `ETIQUETAS` (esquema en el spec de diseño)
- `Utilidades.gs` — funciones puras (parseo de lote, formateo de textos, IDs)
- `Barcode.gs` — encoder CODE128-B propio, sin CDN
- `Backend.gs` — `doGet`, `registrarLote`, `htmlEtiquetas`
- `Index.html` — UI (3 temas, formulario, grid de etiquetas, impresión)
- `Pruebas.gs` — funciones de humo para ejecutar desde el editor

## Documentación

- Spec: `docs/superpowers/specs/2026-07-27-modulo1-carga-etiquetas-design.md`
- Plan: `docs/superpowers/plans/2026-07-27-modulo1-carga-etiquetas.md`
```

- [ ] **Step 5: Confirmar estructura**

Run: `ls Desktop/Proyectos/hodos`
Expected: `.clasp.json`, `appsscript.json`, `.claspignore`, `CLAUDE.md`, `assets/`, `docs/`

---

## Task 2: Encoder CODE128-B (TDD en Node)

El código de barras se genera en servidor, sin librería externa. La tabla de patrones de
barras es la tabla estándar de la simbología Code 128 (subset B), verificada contra dos
fuentes independientes (Wikipedia y la librería open-source JsBarcode) antes de escribir
este plan.

**Files:**
- Create: `Desktop/Proyectos/hodos/Barcode.gs`
- Test: `Desktop/Proyectos/hodos/test/barcode.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `test/barcode.test.js`:
```js
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

// vm.createContext crea un realm nuevo: los arrays que devuelve tienen un Array
// distinto al de este archivo, y deepStrictEqual los rechaza aunque el contenido sea
// idéntico ("same structure but are not reference-equal"). El round-trip por JSON
// reconstruye el valor con el Array de este realm antes de comparar.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('code128Checksum_ calcula el checksum correcto para un solo carácter', () => {
  const ctx = cargarGs('Barcode.gs');
  // '5' -> charCode 53 -> valor 53-32=21. checksum = 104 (START_B) + 21*1 = 125. 125 % 103 = 22.
  const checksum = ctx.code128Checksum_(ctx.code128ValoresDesdeTexto_('5'));
  assert.strictEqual(checksum, 22);
});

test('code128Secuencia incluye START_B, valores, checksum y STOP', () => {
  const ctx = cargarGs('Barcode.gs');
  const secuencia = ctx.code128Secuencia('5');
  assert.deepStrictEqual(aRealmLocal(secuencia), [104, 21, 22, 106]);
});

test('code128Anchos: la suma de anchos coincide con el nº de módulos esperado (11*n+35)', () => {
  const ctx = cargarGs('Barcode.gs');
  const texto = '286676';
  const anchos = ctx.code128Anchos(texto);
  const total = anchos.reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 11 * texto.length + 35);
});

test('code128Anchos: decodificar los anchos reconstruye exactamente los patrones de PATRONES_CODE128', () => {
  const ctx = cargarGs('Barcode.gs');
  const texto = 'AB12';
  const secuencia = ctx.code128Secuencia(texto);
  const bitsEsperados = secuencia.map((v) => ctx.PATRONES_CODE128[v]).join('');
  const anchos = ctx.code128Anchos(texto);
  // Reconstruir el bitstring a partir de los anchos (empieza en barra='1')
  let bitsReconstruidos = '';
  let bit = '1';
  anchos.forEach((ancho) => {
    bitsReconstruidos += bit.repeat(ancho);
    bit = bit === '1' ? '0' : '1';
  });
  assert.strictEqual(bitsReconstruidos, bitsEsperados);
});

test('code128ValoresDesdeTexto_ rechaza caracteres fuera de ASCII 32-127', () => {
  const ctx = cargarGs('Barcode.gs');
  assert.throws(() => ctx.code128ValoresDesdeTexto_('ñ'), /ASCII 32-127/);
});

test('code128SVG produce un elemento <svg> con al menos un <rect>', () => {
  const ctx = cargarGs('Barcode.gs');
  const svg = ctx.code128SVG('123456');
  assert.match(svg, /^<svg /);
  assert.match(svg, /<rect /);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `cd Desktop/Proyectos/hodos && node --test`
Expected: FAIL — `Barcode.gs` no existe todavía (`ENOENT`).

- [ ] **Step 3: Implementar `Barcode.gs`**

```js
// Barcode.gs — Encoder CODE128 (subset B), SVG. Sin dependencias externas.
// Tabla de patrones estándar de la simbología Code 128 (107 símbolos: 103 datos +
// START A/B/C + STOP). Verificada contra la librería JsBarcode y Wikipedia.

var PATRONES_CODE128 = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","1100011101011"
];

var CODE128_START_B = 104;
var CODE128_STOP = 106;

function code128ValoresDesdeTexto_(texto) {
  var valores = [];
  for (var i = 0; i < texto.length; i++) {
    var codigo = texto.charCodeAt(i);
    if (codigo < 32 || codigo > 127) {
      throw new Error('CODE128-B solo admite ASCII 32-127: carácter no válido "' + texto[i] + '"');
    }
    valores.push(codigo - 32);
  }
  return valores;
}

function code128Checksum_(valores) {
  var suma = CODE128_START_B;
  for (var i = 0; i < valores.length; i++) {
    suma += valores[i] * (i + 1);
  }
  return suma % 103;
}

function code128Secuencia(texto) {
  if (!texto) throw new Error('code128Secuencia: texto vacío');
  var valores = code128ValoresDesdeTexto_(texto);
  var checksum = code128Checksum_(valores);
  return [CODE128_START_B].concat(valores, [checksum, CODE128_STOP]);
}

function code128Anchos(texto) {
  var secuencia = code128Secuencia(texto);
  var bits = secuencia.map(function (valor) { return PATRONES_CODE128[valor]; }).join('');
  var anchos = [];
  var actual = bits.charAt(0);
  var contador = 0;
  for (var i = 0; i < bits.length; i++) {
    if (bits.charAt(i) === actual) {
      contador++;
    } else {
      anchos.push(contador);
      actual = bits.charAt(i);
      contador = 1;
    }
  }
  anchos.push(contador);
  return anchos;
}

function code128SVG(texto, opciones) {
  opciones = opciones || {};
  var anchoModulo = opciones.anchoModulo || 2;
  var alto = opciones.alto || 60;
  var anchos = code128Anchos(texto);
  var x = 0;
  var barras = '';
  var esBarra = true; // el bitstring completo siempre empieza en barra ('1')
  anchos.forEach(function (ancho) {
    var anchoPx = ancho * anchoModulo;
    if (esBarra) {
      barras += '<rect x="' + x + '" y="0" width="' + anchoPx + '" height="' + alto + '" fill="#000"/>';
    }
    x += anchoPx;
    esBarra = !esBarra;
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' ' + alto +
    '" width="' + x + '" height="' + alto + '">' + barras + '</svg>';
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `cd Desktop/Proyectos/hodos && node --test`
Expected: `pass 6`, `fail 0`

- [ ] **Step 5: Verificación física (no automatizable)**

Anotar en la Task 9 (checklist final del usuario): imprimir una etiqueta de prueba y
escanearla con el móvil o un lector físico para confirmar que decodifica el número de
pedido correctamente. Esto es lo único que ninguna de las dos formas de test cubre.

- [ ] **Step 6: Commit**

No hay git en este proyecto (ver CLAUDE.md) — omitir este paso. Continuar directamente a
la Task 3.

---

## Task 3: Utilidades puras (TDD en Node)

**Files:**
- Create: `Desktop/Proyectos/hodos/Utilidades.gs`
- Test: `Desktop/Proyectos/hodos/test/utilidades.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `test/utilidades.test.js`:
```js
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

// Ver la nota en test/barcode.test.js: vm.createContext crea un realm nuevo, así que
// los arrays que devuelve necesitan este round-trip antes de deepStrictEqual.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('parsearLotePedidos separa por líneas, recorta espacios y quita vacías', () => {
  const ctx = cargarGs('Utilidades.gs');
  const entrada = '  286676 \n\n123456\n   \n007890\n';
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos(entrada)), ['286676', '123456', '007890']);
});

test('parsearLotePedidos NO normaliza a 6 dígitos (decisión explícita del proyecto)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos('42\nABC123\n1234567')), ['42', 'ABC123', '1234567']);
});

test('parsearLotePedidos con texto vacío devuelve array vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos('   \n  \n')), []);
});

test('formatearOrigenTexto para Taisa compone "TAISA - SUBTIPO"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearOrigenTexto('Taisa', 'Devolución'), 'TAISA - DEVOLUCIÓN');
});

test('formatearOrigenTexto para plataforma normal usa el nombre en mayúsculas', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearOrigenTexto('Torija', ''), 'TORIJA');
});

test('formatearIdUnico compone el correlativo con padding a 6 dígitos', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearIdUnico(123), 'HODOS-000123');
  assert.strictEqual(ctx.formatearIdUnico(7), 'HODOS-000007');
  assert.strictEqual(ctx.formatearIdUnico(1234567), 'HODOS-1234567');
});

test('calcularSoportes: pedido único -> soporte 1 de 1', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.calcularSoportes(['200']);
  assert.deepStrictEqual(aRealmLocal(r), [{ numeroPedido: '200', soporteNum: 1, soporteTotal: 1 }]);
});

test('calcularSoportes: un pedido repetido en el lote son varios soportes, numerados en orden de aparición', () => {
  const ctx = cargarGs('Utilidades.gs');
  // Un pedido repetido en la MISMA lista pegada no es un reenvío: son varios soportes/palets del mismo pedido.
  const r = ctx.calcularSoportes(['100', '100', '200', '100']);
  assert.deepStrictEqual(aRealmLocal(r), [
    { numeroPedido: '100', soporteNum: 1, soporteTotal: 3 },
    { numeroPedido: '100', soporteNum: 2, soporteTotal: 3 },
    { numeroPedido: '200', soporteNum: 1, soporteTotal: 1 },
    { numeroPedido: '100', soporteNum: 3, soporteTotal: 3 }
  ]);
});

test('calcularSoportes con lista vacía devuelve array vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.calcularSoportes([])), []);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `cd Desktop/Proyectos/hodos && node --test test/utilidades.test.js`
Expected: FAIL — `Utilidades.gs` no existe.

- [ ] **Step 3: Implementar `Utilidades.gs`**

```js
// Utilidades.gs — funciones puras, sin dependencias de servicios de Google.

function parsearLotePedidos(textoPegado) {
  if (!textoPegado) return [];
  return textoPegado
    .split('\n')
    .map(function (linea) { return linea.trim(); })
    .filter(function (linea) { return linea.length > 0; });
}

function formatearOrigenTexto(origen, subtipo) {
  if (origen === 'Taisa') {
    return 'TAISA - ' + String(subtipo || '').toUpperCase();
  }
  return String(origen).toUpperCase();
}

function formatearIdUnico(numero) {
  var texto = String(numero);
  while (texto.length < 6) {
    texto = '0' + texto;
  }
  return 'HODOS-' + texto;
}

function calcularSoportes(lineas) {
  // Un número de pedido repetido DENTRO DEL MISMO LOTE no es un reenvío: significa que
  // ese pedido tiene varios soportes/palets. Se numeran en el orden en que aparecen.
  var totales = {};
  lineas.forEach(function (l) { totales[l] = (totales[l] || 0) + 1; });
  var contadores = {};
  return lineas.map(function (l) {
    contadores[l] = (contadores[l] || 0) + 1;
    return { numeroPedido: l, soporteNum: contadores[l], soporteTotal: totales[l] };
  });
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `cd Desktop/Proyectos/hodos && node --test`
Expected: `pass 15` (6 de Barcode + 9 de Utilidades), `fail 0`

- [ ] **Step 5: Commit**

Sin git en este proyecto — omitir.

---

## Task 4: `EstructuraSheets.gs` — esquema de la pestaña ETIQUETAS

Esta y las siguientes tareas dependen de `SpreadsheetApp`/`LockService`/etc., que no
existen fuera de Apps Script — no hay test de Node aquí. Se verifican con `Pruebas.gs` en
la Task 8, tras el primer `clasp push`.

**Files:**
- Create: `Desktop/Proyectos/hodos/EstructuraSheets.gs`

- [ ] **Step 1: Implementar**

```js
// EstructuraSheets.gs — esquema y acceso a la pestaña ETIQUETAS.

var NOMBRE_HOJA_ETIQUETAS = 'ETIQUETAS';

var COLUMNAS_ETIQUETAS = [
  'idUnico', 'numeroPedido', 'soporteNum', 'soporteTotal', 'origen', 'subtipo',
  'origenTexto', 'destino', 'fechaCreacion', 'loteId', 'creadoPor', 'estado',
  'bateaId', 'fechaEnvio'
];

function obtenerHojaEtiquetas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOMBRE_HOJA_ETIQUETAS);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_ETIQUETAS);
  }
  var cabeceraActual = hoja.getRange(1, 1, 1, COLUMNAS_ETIQUETAS.length).getValues()[0];
  var cabeceraOk = COLUMNAS_ETIQUETAS.every(function (col, i) { return cabeceraActual[i] === col; });
  if (!cabeceraOk) {
    hoja.getRange(1, 1, 1, COLUMNAS_ETIQUETAS.length).setValues([COLUMNAS_ETIQUETAS]);
  }
  return hoja;
}

function indiceColumnas_() {
  var idx = {};
  COLUMNAS_ETIQUETAS.forEach(function (col, i) { idx[col] = i; });
  return idx;
}
```

- [ ] **Step 2: Push a Apps Script**

Run: `cd Desktop/Proyectos/hodos && clasp push -f`
Expected: `└─ EstructuraSheets.gs` listado en la salida, sin errores.

- [ ] **Step 3: Verificación manual (usuario, en el editor de Apps Script)**

Ejecutar `obtenerHojaEtiquetas` una vez desde el editor (seleccionar la función en el
desplegable de arriba → ▶ Ejecutar). Autorizar permisos si se solicita. Confirmar en el
Spreadsheet vinculado que aparece una pestaña `ETIQUETAS` con las 14 cabeceras.

---

## Task 5: `Backend.gs` — registro del lote e ID correlativo

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs` (crear)

- [ ] **Step 1: Implementar**

```js
// Backend.gs — punto de entrada y lógica de registro de lotes.

var PROP_CONTADOR_ID = 'HODOS_CONTADOR_ID';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('HODOS - Carga de pedidos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

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

function registrarLote(datos) {
  // datos: {pedidosTexto, origen, subtipo, destino}
  var lineas = parsearLotePedidos(datos.pedidosTexto);
  if (lineas.length === 0) {
    throw new Error('No hay pedidos en la lista');
  }
  if (!datos.origen) throw new Error('Falta el origen');
  if (datos.origen === 'Taisa' && !datos.subtipo) throw new Error('Falta el subtipo de Taisa');
  if (!datos.destino) throw new Error('Falta la tienda destino');

  var origenTexto = formatearOrigenTexto(datos.origen, datos.subtipo);
  var soportes = calcularSoportes(lineas); // pedidos repetidos en el lote = varios soportes, no reenvíos
  var ids = reservarBloqueIds_(lineas.length);
  var loteId = Utilities.getUuid();
  var fecha = new Date();
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';

  var filas = soportes.map(function (s, i) {
    return [
      ids[i], s.numeroPedido, s.soporteNum, s.soporteTotal, datos.origen, datos.subtipo || '',
      origenTexto, datos.destino, fecha, loteId, creadoPor, 'REGISTRADO', '', ''
    ];
  });

  var hoja = obtenerHojaEtiquetas();
  hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, COLUMNAS_ETIQUETAS.length).setValues(filas);

  return { loteId: loteId, cantidad: filas.length, ids: ids };
}

function obtenerHistorialLotes(limite) {
  limite = limite || 10;
  var hoja = obtenerHojaEtiquetas();
  var datos = hoja.getDataRange().getValues();
  var idx = indiceColumnas_();
  var filas = datos.slice(1);
  var porLote = {};
  var orden = [];
  filas.forEach(function (f) {
    var loteId = f[idx.loteId];
    if (!porLote[loteId]) {
      porLote[loteId] = { loteId: loteId, cantidad: 0, origenTexto: f[idx.origenTexto], destino: f[idx.destino], fecha: f[idx.fechaCreacion] };
      orden.push(loteId);
    }
    porLote[loteId].cantidad++;
  });
  return orden.slice(-limite).reverse().map(function (id) { return porLote[id]; });
}
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Verificación manual (usuario, editor de Apps Script)**

Ejecutar desde el editor:
```js
function _pruebaManualRegistrarLote() {
  // 286676 aparece dos veces -> debe registrarse como soporte 1/2 y 2/2, no como reenvío.
  var r = registrarLote({ pedidosTexto: '286676\n123456\n286676', origen: 'Torija', subtipo: '', destino: 'Málaga' });
  Logger.log(JSON.stringify(r));
}
```
Expected en el log: `{"loteId":"...","cantidad":3,"ids":["HODOS-000001","HODOS-000002","HODOS-000003"]}`
(los números pueden variar si ya se había ejecutado antes). Confirmar en la Sheet que
aparecen 3 filas nuevas en `ETIQUETAS`: las dos filas de `286676` con `soporteNum` 1 y 2
y `soporteTotal` 2, y la de `123456` con `soporteNum` 1 y `soporteTotal` 1.

---

## Task 6: `Backend.gs` — generación del HTML de etiquetas para impresión

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs:` (añadir al final)

- [ ] **Step 1: Obtener el base64 del logo Taisa**

El archivo `assets/logo_taisa.b64.txt` ya contiene el base64 exacto del logo (precalculado
con `[Convert]::ToBase64String`). Leer su contenido:

Run: `cat Desktop/Proyectos/hodos/assets/logo_taisa.b64.txt`

Copiar el resultado completo (una sola línea, ~5456 caracteres) para el siguiente paso.

- [ ] **Step 1 bis: Logo de Leroy Merlin — BLOQUEADO hasta recibir el archivo**

El usuario debe proporcionar el PNG/SVG oficial del logo de Leroy Merlin (no se fabrica un
logo de una marca real sin el archivo). En cuanto se reciba:
1. Copiarlo a `Desktop/Proyectos/hodos/assets/logo_leroymerlin.png`.
2. Generar su base64 igual que se hizo con el de Taisa:
   `powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('assets/logo_leroymerlin.png')) | Set-Content -NoNewline -Encoding ascii 'assets/logo_leroymerlin.b64.txt'"`
3. Usar ese contenido como `LOGO_LM_B64` en el Step 2 siguiente (ahora mismo lleva el
   placeholder `<<PENDIENTE_LOGO_LM>>` — mientras no se reciba el archivo, dejar
   `LOGO_LM_B64 = ''` y el `<img>` correspondiente simplemente no pintará nada, sin romper
   el resto de la etiqueta).

- [ ] **Step 2: Implementar la generación de HTML**

Añadir a `Backend.gs` (sustituir `<<PEGAR_BASE64_AQUI>>` por el contenido copiado en el
Step 1, y `<<PENDIENTE_LOGO_LM>>` por el base64 del Step 1 bis en cuanto exista — si aún
no existe, dejar `LOGO_LM_B64 = '';`):

```js
var LOGO_TAISA_B64 = '<<PEGAR_BASE64_AQUI>>';
var LOGO_LM_B64 = '<<PENDIENTE_LOGO_LM>>'; // '' hasta que el usuario proporcione el archivo

function esc_(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function obtenerEtiquetasPorLote_(loteId) {
  var hoja = obtenerHojaEtiquetas();
  var datos = hoja.getDataRange().getValues();
  var idx = indiceColumnas_();
  return datos.slice(1)
    .filter(function (f) { return f[idx.loteId] === loteId; })
    .map(function (f) {
      return {
        idUnico: f[idx.idUnico],
        numeroPedido: f[idx.numeroPedido],
        soporteNum: f[idx.soporteNum],
        soporteTotal: f[idx.soporteTotal],
        origenTexto: f[idx.origenTexto],
        destino: f[idx.destino],
        fechaCreacion: f[idx.fechaCreacion]
      };
    });
}

function htmlUnaEtiqueta_(e, fechaTxt) {
  var barcodeSvg = code128SVG(String(e.numeroPedido), { anchoModulo: 2, alto: 60 });
  // El badge de soporte SOLO se muestra si el pedido tiene más de un soporte en este
  // lote (la mayoría son de un único soporte y no deben mostrar nada aquí).
  var soporteHtml = (e.soporteTotal > 1)
    ? '<div class="soporte-badge">SOPORTE ' + esc_(e.soporteNum) + '/' + esc_(e.soporteTotal) + '</div>'
    : '';
  var logoLmHtml = LOGO_LM_B64
    ? '<img src="data:image/png;base64,' + LOGO_LM_B64 + '" class="logo-lm">'
    : '';
  return '' +
    '<div class="etiqueta-wrapper"><div class="etiqueta">' +
    '<div class="etiqueta-top">' +
    '<img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" class="logo-taisa">' +
    '<div class="fecha-id">Creada: ' + esc_(fechaTxt) + '<div class="id-unico">' + esc_(e.idUnico) + '</div></div>' +
    '</div>' +
    '<div class="tienda-destino">' + esc_(e.destino) + '</div>' +
    '<div class="numero-pedido-h">' + esc_(e.numeroPedido) + '</div>' +
    soporteHtml +
    '<div class="origen-info">' + esc_(e.origenTexto) + '</div>' +
    '<div class="etiqueta-bottom">' + logoLmHtml + '<div class="barcode-wrap">' + barcodeSvg + '</div></div>' +
    '</div></div>';
}

function htmlEtiquetas(loteId) {
  var etiquetas = obtenerEtiquetasPorLote_(loteId);
  if (etiquetas.length === 0) throw new Error('Lote no encontrado: ' + loteId);
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');

  var estilo = [
    'body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;}',
    '.etiqueta-wrapper{page-break-after:always;}',
    '.etiqueta{width:150mm;height:100mm;padding:5mm 8mm;border:2px solid #000;',
    'display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;}',
    '.etiqueta-top{display:flex;justify-content:space-between;align-items:flex-start;}',
    '.logo-taisa{height:12mm;width:auto;}',
    '.fecha-id{text-align:right;font-size:9px;color:#333;}',
    '.fecha-id .id-unico{font-weight:bold;font-size:10px;margin-top:1mm;}',
    '.tienda-destino{font-size:30px;font-weight:900;text-transform:uppercase;text-align:center;}',
    '.numero-pedido-h{font-size:46px;font-weight:900;text-align:center;letter-spacing:2mm;}',
    '.soporte-badge{font-size:14px;font-weight:700;text-align:center;color:#333;margin-top:-2mm;}',
    '.origen-info{font-size:26px;font-weight:900;color:#e30613;text-transform:uppercase;text-align:center;}',
    '.etiqueta-bottom{display:flex;align-items:center;justify-content:space-between;}',
    '.logo-lm{height:10mm;width:auto;}',
    '.barcode-wrap{flex:1;display:flex;justify-content:center;}'
  ].join('');

  var partes = [];
  partes.push('<' + '!DOCTYPE html>');
  partes.push('<html><head><meta charset="UTF-8">');
  partes.push('<' + 'style>' + estilo + '<' + '/style>');
  partes.push('</head><body>');
  partes.push(tarjetas);
  partes.push('</body></html>');
  return partes.join('');
}
```

> **Nota de la regla de oro:** este HTML se genera y se devuelve como texto plano desde el
> servidor — nunca se escribe `<style>` ni `<!DOCTYPE>` literal dentro de un `<script>` de
> `Index.html`. Por eso aquí se construyen concatenando `'<' + 'style>'` — es solo cinturón
> y tirantes dentro del propio `.gs` (que no tiene este problema, pero mantiene la
> convención visible y evita que un futuro copy-paste de este bloque a un `.html` rompa
> algo).

- [ ] **Step 3: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 4: Verificación manual (usuario, editor de Apps Script)**

Ejecutar:
```js
function _pruebaManualHtmlEtiquetas() {
  // 999001 repetido -> su etiqueta debe llevar el badge "SOPORTE 1/2" y "SOPORTE 2/2".
  var r = registrarLote({ pedidosTexto: '999001\n999002\n999001', origen: 'MECO', subtipo: '', destino: 'Granada' });
  var html = htmlEtiquetas(r.loteId);
  Logger.log(html.length); // confirmar que no está vacío / no lanza error
  Logger.log(html.indexOf('SOPORTE 1/2') > -1 && html.indexOf('SOPORTE 2/2') > -1); // debe dar true
  Logger.log(html.indexOf('SOPORTE') > -1 && html.split('SOPORTE').length - 1 === 2); // 999002 no debe llevar badge
}
```
Expected: un número > 0 en el log, `true` en la segunda línea, `true` en la tercera (el
badge aparece exactamente 2 veces — solo en las dos etiquetas de 999001 — y no en la de
999002), sin excepciones.

---

## Task 7: `Index.html` — interfaz de usuario

**Files:**
- Create: `Desktop/Proyectos/hodos/Index.html`

- [ ] **Step 1: Implementar**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HODOS - Carga de pedidos</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding:20px; }
    .tema-selector { text-align:center; margin-bottom:30px; }
    .tema-selector button { padding:10px 20px; margin:0 10px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:14px; }
    .tema-selector button.active { transform:scale(1.05); box-shadow:0 4px 12px rgba(0,0,0,0.2); }
    body.tema-black { --bg-primary:#080a10; --color-accent:#e30613; --text-primary:#fff; --input-bg:#1a1d2e; --input-border:#333; }
    body.tema-vivid { --bg-primary:#fff; --color-accent:#ff0000; --text-primary:#000; --input-bg:#f9f9f9; --input-border:#00aa00; }
    body.tema-gray  { --bg-primary:#fff; --color-accent:#555; --text-primary:#000; --input-bg:#f0f0f0; --input-border:#ccc; }
    .tema-selector button.black { background:#080a10; color:#e30613; border:2px solid #e30613; }
    .tema-selector button.vivid { background:linear-gradient(135deg,#ff0000,#00aa00); color:#fff; }
    .tema-selector button.gray  { background:#555; color:#fff; border:2px solid #555; }
    .container { max-width:1700px; margin:0 auto; display:grid; grid-template-columns:1fr 1.3fr; gap:40px; }
    .section { background:var(--bg-primary); color:var(--text-primary); border-radius:8px; padding:30px; box-shadow:0 4px 12px rgba(0,0,0,0.15); }
    .section h2 { color:var(--color-accent); margin-bottom:20px; font-size:20px; border-bottom:2px solid var(--color-accent); padding-bottom:12px; }
    .form-group { margin-bottom:16px; }
    label { display:block; margin-bottom:8px; font-size:14px; font-weight:600; }
    input, select, textarea { width:100%; padding:12px; border:2px solid var(--input-border); background:var(--input-bg); color:var(--text-primary); border-radius:6px; font-size:14px; font-family:inherit; }
    textarea { resize:vertical; min-height:120px; font-family:'Courier New',monospace; }
    .subtipo-taisa { display:none; margin-top:-6px; }
    .subtipo-taisa.visible { display:block; }
    .btn-primary, .btn-imprimir { width:100%; padding:14px; background:var(--color-accent); color:var(--bg-primary); border:none; border-radius:6px; font-size:14px; font-weight:700; cursor:pointer; margin-top:10px; }
    .btn-primary:disabled { opacity:0.5; cursor:wait; }
    .contador-pedidos { font-size:12px; opacity:0.7; margin-top:4px; }
    .aviso-error { color:#ff6b6b; font-size:13px; margin-top:8px; }
    .lista-pedidos { margin-top:25px; max-height:220px; overflow-y:auto; }
    .lista-pedidos h3 { font-size:13px; margin-bottom:12px; color:var(--color-accent); }
    .pedido-item { background:var(--input-bg); padding:10px; margin-bottom:8px; border-radius:4px; border-left:3px solid var(--color-accent); font-size:12px; display:flex; justify-content:space-between; }
    .etiquetas-preview { margin-top:15px; padding:15px; background:var(--input-bg); border-radius:8px; font-size:13px; max-height:300px; overflow-y:auto; }
  </style>
</head>
<body class="tema-black">

<div class="tema-selector">
  <button class="black active" onclick="cambiarTema('black')">Black Edition</button>
  <button class="vivid" onclick="cambiarTema('vivid')">Rojo/Verde Vivo</button>
  <button class="gray" onclick="cambiarTema('gray')">Gris/Blanco</button>
</div>

<div class="container">
  <div class="section">
    <h2>Registrar Lote de Pedidos</h2>

    <div class="form-group">
      <label for="listaPedidos">Lista de Pedidos (uno por línea, pegado desde Sheet)</label>
      <textarea id="listaPedidos" placeholder="286676&#10;123456"></textarea>
      <div class="contador-pedidos" id="contadorPedidos">0 pedidos detectados</div>
    </div>

    <div class="form-group">
      <label for="origen">Plataforma/Origen</label>
      <select id="origen" onchange="toggleSubtipoTaisa()">
        <option value="MECO">MECO</option>
        <option value="Valencia">Valencia</option>
        <option value="Torija">Torija</option>
        <option value="Antequera">Antequera</option>
        <option value="Taisa">Taisa</option>
      </select>
    </div>

    <div class="form-group subtipo-taisa" id="subtipoTaisaGroup">
      <label for="subtipoTaisa">Subtipo Taisa</label>
      <select id="subtipoTaisa">
        <option value="Devolución">Devolución</option>
        <option value="Inventario">Inventario</option>
        <option value="Demarca">Demarca</option>
        <option value="Petición Reserva">Petición Reserva</option>
      </select>
    </div>

    <div class="form-group">
      <label for="destino">Tienda Destino</label>
      <select id="destino">
        <option value="Málaga">Málaga</option>
        <option value="Marbella">Marbella</option>
        <option value="Mijas">Mijas</option>
        <option value="Granada">Granada</option>
      </select>
    </div>

    <button class="btn-primary" id="btnGenerar" onclick="generarLoteEtiquetas()">Generar Etiquetas del Lote</button>
    <div class="aviso-error" id="avisoError"></div>

    <div class="lista-pedidos">
      <h3>Historial reciente</h3>
      <div id="historialPedidos"></div>
    </div>
  </div>

  <div class="section">
    <h2>Etiquetas Generadas</h2>
    <div class="etiquetas-preview" id="etiquetasPreview">Genera un lote para ver aquí el resumen.</div>
    <button class="btn-imprimir" id="btnImprimir" onclick="imprimirLote()" disabled>Imprimir Lote (Zebra)</button>
  </div>
</div>

<script>
  var loteActualId = null;

  function gas(nombreFuncion) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(function (err) { reject(err); })
        [nombreFuncion].apply(null, args);
    });
  }

  function toggleSubtipoTaisa() {
    var origen = document.getElementById('origen').value;
    document.getElementById('subtipoTaisaGroup').classList.toggle('visible', origen === 'Taisa');
  }

  document.getElementById('listaPedidos').addEventListener('input', function () {
    var lineas = this.value.split('\n').filter(function (l) { return l.trim() !== ''; });
    document.getElementById('contadorPedidos').textContent = lineas.length + ' pedido' + (lineas.length !== 1 ? 's' : '') + ' detectado' + (lineas.length !== 1 ? 's' : '');
  });

  function cambiarTema(tema) {
    document.body.className = 'tema-' + tema;
    document.querySelectorAll('.tema-selector button').forEach(function (b) { b.classList.remove('active'); });
    event.target.classList.add('active');
    localStorage.setItem('hodosTema', tema);
  }

  function generarLoteEtiquetas() {
    var pedidosTexto = document.getElementById('listaPedidos').value;
    var origen = document.getElementById('origen').value;
    var subtipo = document.getElementById('subtipoTaisa').value;
    var destino = document.getElementById('destino').value;
    var btn = document.getElementById('btnGenerar');
    var aviso = document.getElementById('avisoError');
    aviso.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    gas('registrarLote', { pedidosTexto: pedidosTexto, origen: origen, subtipo: subtipo, destino: destino })
      .then(function (resultado) {
        loteActualId = resultado.loteId;
        document.getElementById('etiquetasPreview').innerHTML =
          '<strong>' + resultado.cantidad + ' etiquetas generadas</strong><br>IDs: ' + resultado.ids.join(', ');
        document.getElementById('btnImprimir').disabled = false;
        cargarHistorial();
      })
      .catch(function (err) {
        aviso.textContent = 'Error: ' + (err && err.message ? err.message : err);
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Generar Etiquetas del Lote';
      });
  }

  function imprimirLote() {
    if (!loteActualId) return;
    var ventana = window.open('', '_blank');
    ventana.document.write('Generando etiquetas...');
    gas('htmlEtiquetas', loteActualId).then(function (html) {
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
      ventana.print();
    });
  }

  function cargarHistorial() {
    gas('obtenerHistorialLotes', 10).then(function (lotes) {
      var cont = document.getElementById('historialPedidos');
      cont.innerHTML = lotes.map(function (l) {
        return '<div class="pedido-item"><span><strong>' + l.cantidad + ' pedidos</strong> | ' + l.origenTexto + ' &rarr; ' + l.destino + '</span></div>';
      }).join('');
    });
  }

  (function iniciar() {
    var temaGuardado = localStorage.getItem('hodosTema');
    if (temaGuardado) {
      document.body.className = 'tema-' + temaGuardado;
      document.querySelectorAll('.tema-selector button').forEach(function (b) {
        b.classList.toggle('active', b.classList.contains(temaGuardado));
      });
    }
    cargarHistorial();
  })();
</script>
</body>
</html>
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Verificación manual (usuario, navegador real)**

No verificable desde el entorno de Claude (el webapp requiere sesión de Google del
dominio corporativo). El usuario debe:
1. `clasp deploy` (ver Task 8) para obtener una URL `/exec`.
2. Abrir esa URL, pegar unos pedidos de prueba, generar el lote, confirmar que aparecen
   en el resumen y en el historial.
3. Pulsar "Imprimir Lote" y confirmar que se abre una ventana con las etiquetas
   correctamente maquetadas a 150mm×100mm.

---

## Task 8: `Pruebas.gs` y primer despliegue

**Files:**
- Create: `Desktop/Proyectos/hodos/Pruebas.gs`

- [ ] **Step 1: Implementar funciones de humo**

```js
// Pruebas.gs — funciones de humo, se ejecutan manualmente desde el editor de Apps Script.

function verificarSistema() {
  var resultados = [];

  try {
    var hoja = obtenerHojaEtiquetas();
    resultados.push('OK: hoja ETIQUETAS accesible (' + hoja.getLastRow() + ' filas)');
  } catch (e) {
    resultados.push('ERROR hoja: ' + e.toString());
  }

  try {
    // TEST-001 repetido: verifica también el cálculo de soportes en el camino completo.
    var r = registrarLote({ pedidosTexto: 'TEST-001\nTEST-002\nTEST-001', origen: 'Taisa', subtipo: 'Inventario', destino: 'Mijas' });
    resultados.push('OK: registrarLote -> ' + r.cantidad + ' etiquetas, ids ' + r.ids.join(','));

    var html = htmlEtiquetas(r.loteId);
    resultados.push('OK: htmlEtiquetas -> ' + html.length + ' caracteres generados');

    var badges = (html.match(/SOPORTE \d+\/\d+/g) || []).length;
    resultados.push(badges === 2 ? 'OK: badge de soporte aparece 2 veces (TEST-001 x2)' : 'ERROR soportes: se esperaban 2 badges, hay ' + badges);
  } catch (e) {
    resultados.push('ERROR registrarLote/htmlEtiquetas: ' + e.toString());
  }

  try {
    var historial = obtenerHistorialLotes(5);
    resultados.push('OK: obtenerHistorialLotes -> ' + historial.length + ' lotes');
  } catch (e) {
    resultados.push('ERROR historial: ' + e.toString());
  }

  Logger.log(resultados.join('\n'));
  return resultados;
}
```

- [ ] **Step 2: Push y primer despliegue**

Run:
```bash
clasp push -f
clasp deploy --description "v1 - modulo carga y etiquetas"
```
Expected: salida con un `deploymentId` nuevo y una URL `.../exec`.

- [ ] **Step 3: Ejecutar `verificarSistema` desde el editor**

Seleccionar `verificarSistema` en el desplegable → ▶ Ejecutar → autorizar permisos la
primera vez → revisar el log (Ver → Registros). Expected: todas las líneas empiezan con
`OK:`. Si alguna dice `ERROR:`, corregir antes de continuar.

- [ ] **Step 4: Borrar las filas de prueba de la Sheet**

Las filas `TEST-001`/`TEST-002` (y las de las verificaciones manuales de Tasks 5 y 6) son
datos de prueba — borrarlas manualmente de la pestaña `ETIQUETAS` antes de un uso real.

---

## Task 9: Checklist final de verificación end-to-end (usuario)

Nada de esto lo puede ejecutar Claude directamente (requiere sesión de Google del dominio
y una impresora Zebra física). Marcar cada punto tras probarlo en el navegador real:

- [ ] Abrir la URL `/exec` del despliegue (Task 8) con una cuenta del dominio.
- [ ] Pegar una lista de 3-5 pedidos con distinta longitud de dígitos (para confirmar que
      NO se fuerzan a 6 dígitos), **repitiendo uno de ellos dos veces**, elegir origen
      "Taisa" + un subtipo, y una tienda.
- [ ] Generar el lote — confirmar que el resumen muestra la cantidad correcta y los IDs
      `HODOS-000NNN`.
- [ ] Confirmar en la Sheet "HODOS - Pedidos" (pestaña `ETIQUETAS`) que las filas
      coinciden: número de pedido tal cual se pegó, `soporteNum`/`soporteTotal` correctos
      (el pedido repetido con 1/2 y 2/2, el resto con 1/1), origen/subtipo, `origenTexto` =
      "TAISA - <SUBTIPO>", destino, `creadoPor` = tu email.
- [ ] Pulsar "Imprimir Lote", confirmar que se abre la vista de impresión con una etiqueta
      por pedido, logo Taisa arriba-izquierda, badge "SOPORTE X/Y" visible **solo** en las
      dos etiquetas del pedido repetido (no en las demás), logo de Leroy Merlin
      abajo-izquierda (si ya se integró — ver Task 6 Step 1 bis), y que el diálogo de
      impresión del navegador permite seleccionar la impresora Zebra.
- [ ] Imprimir (o exportar a PDF) una etiqueta y **escanear el código de barras con el
      móvil** — confirmar que decodifica exactamente el número de pedido.
- [ ] Recargar la página y confirmar que el "Historial reciente" muestra el lote que
      acabas de crear.
- [ ] Cambiar entre los 3 temas y confirmar que se aplican correctamente y que se recuerda
      el elegido al recargar (`localStorage`).

---

## Self-review

**Cobertura del spec:** registro por lote ✅ (Task 5), ID único con reenvío soportado ✅
(Task 5, correlativo nunca se reutiliza), fecha de creación en la etiqueta ✅ (Task 6),
logo Taisa real ✅ (Task 6), tienda/número/origen en la etiqueta con los tamaños/orden de
la spec ✅ (Task 6/7), CODE128 ✅ (Task 2), 150mm×100mm ✅ (Task 6), impresión del lote
completo de una vez ✅ (Task 7 `imprimirLote`), 3 temas seleccionables ✅ (Task 7), número
de pedido sin normalizar a 6 dígitos ✅ (Task 3, test explícito). Columnas reservadas
`bateaId`/`fechaEnvio` para las fases 3/5 futuras ✅ (Task 4). Pedidos repetidos en el
mismo lote tratados como soportes múltiples (no reenvíos), numerados y reflejados en la
etiqueta con badge condicional ✅ (Task 3 `calcularSoportes`, Task 4 columnas
`soporteNum`/`soporteTotal`, Task 5, Task 6 badge, Task 8/9 verificación explícita). Logo
de Leroy Merlin abajo-izquierda ✅ diseñado y con hueco reservado en el layout (Task 6),
pendiente únicamente del archivo real del usuario. Fuera de alcance explícitamente (carga
de camión, panel, vista tienda, Carta de Portes SIE) — no implementado en este plan, como
se acordó en el diseño.

**Placeholders:** `<<PEGAR_BASE64_AQUI>>` (Task 6 Step 1) es un dato real que el propio
step indica cómo obtener — no es una decisión de diseño pendiente. `<<PENDIENTE_LOGO_LM>>`
(Task 6 Step 1 bis/2) SÍ depende de un archivo que el usuario aún no ha entregado; el plan
lo deja explícitamente bloqueado con una alternativa segura (`LOGO_LM_B64 = ''`, sin logo
en el `<img>`) para no bloquear el resto del módulo — no es un placeholder de "implementar
luego", es una dependencia externa real y así queda anotada.

**Consistencia de tipos:** `parsearLotePedidos`, `formatearOrigenTexto`,
`formatearIdUnico`, `calcularSoportes` (Utilidades.gs) se usan con los mismos nombres en
`Backend.gs`; el objeto `{numeroPedido, soporteNum, soporteTotal}` que devuelve
`calcularSoportes` se consume con esas mismas tres claves en `registrarLote`.
`code128SVG`/`code128Anchos`/`code128Secuencia`/`code128Checksum_`/
`code128ValoresDesdeTexto_`/`PATRONES_CODE128` (Barcode.gs) se usan igual en Backend.gs y
en los tests. `COLUMNAS_ETIQUETAS`/`obtenerHojaEtiquetas`/`indiceColumnas_`
(EstructuraSheets.gs) se reutilizan igual en Backend.gs. `registrarLote`, `htmlEtiquetas`,
`obtenerHistorialLotes` son los tres nombres llamados desde `Index.html` vía `gas(...)` —
coinciden exactamente con las funciones definidas en `Backend.gs`.
