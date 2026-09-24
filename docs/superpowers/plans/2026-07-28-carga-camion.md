# HODOS — Fase 3: Carga de camión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escanear soportes al cargar el camión, validar que el destino coincide con la
carga, marcarlos "en ruta" (rellena `bateaId`/`fechaEnvio` reservados en `ETIQUETAS`), y
al cerrar la carga generar un informe PDF con el estilo visual de `CartaPortes.gs` y
enviarlo por email a los mismos destinatarios que la Carta de Portes diaria.

**Architecture:** Nueva pestaña `CARGAS` (una fila = una carga de camión, ciclo
ABIERTA→CERRADA). El barcode de la etiqueta lleva el número de pedido, no el ID único
(no se cambia — invalidaría etiquetas ya impresas), así que la selección de qué fila de
`ETIQUETAS` marcar al escanear es una función pura y crítica
(`seleccionarSoporteAEscanear`, FIFO por fecha de creación entre las filas pendientes de
ese pedido+destino) — se testea a fondo con `node --test` antes de tocar nada de GAS. El
informe reutiliza la técnica ya probada de `CartaPortes.gs` (HTML → archivo temporal en
Drive → `getAs('application/pdf')`) y sus mismas listas de destinatarios/horarios por
tienda (copiadas, con Málaga/Granada pendientes de datos reales).

**Tech Stack:** Igual que el resto de HODOS (GAS V8 + HtmlService + clasp). Lógica pura
testeada con `node --test`; lógica de Sheets/email verificada con `Pruebas.gs` desde el
editor (el envío real de email necesita autorización manual la primera vez).

**Referencias:**
- Diseño: `docs/superpowers/specs/2026-07-28-carga-camion-design.md`
- Estilo de informe a replicar: `CartadePortesSIE/CartaPortes.gs` función `buildPDFHtml`
  (línea ~930) y las constantes `EMAILS_CARTA_TIENDA`/`EMAILS_CARTA_CC`/`HORARIOS_CAMIONES`
  (líneas 28-77)

---

## Task 1: `Utilidades.gs` — `formatearIdCarga` + `seleccionarSoporteAEscanear` (TDD)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Utilidades.gs`
- Modify: `Desktop/Proyectos/hodos/test/utilidades.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/utilidades.test.js`:
```js
test('formatearIdCarga compone el correlativo con prefijo CARGA-', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearIdCarga(1), 'CARGA-000001');
  assert.strictEqual(ctx.formatearIdCarga(23), 'CARGA-000023');
});

test('seleccionarSoporteAEscanear: NO_ENCONTRADO si no hay ninguna fila con ese pedido', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.seleccionarSoporteAEscanear([], '260707', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'NO_ENCONTRADO' });
});

test('seleccionarSoporteAEscanear: DESTINO_INCORRECTO si el pedido existe pero para otra tienda', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Marbella', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'DESTINO_INCORRECTO');
  assert.strictEqual(r.detalle.destinoReal, 'Marbella');
});

test('seleccionarSoporteAEscanear: YA_ESCANEADO si todas las filas del destino correcto ya están EN_RUTA', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'YA_ESCANEADO' });
});

test('seleccionarSoporteAEscanear: escoge el soporte pendiente más antiguo (FIFO), ignorando los ya escaneados', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000003', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T12:00:00.000Z' },
    { idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' },
    { idUnico: 'HODOS-000002', numeroPedido: '260707', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: '2026-07-27T11:00:00.000Z' }
  ];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idUnico, 'HODOS-000001');
});

test('seleccionarSoporteAEscanear: ignora filas de otros números de pedido', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' },
    { idUnico: 'HODOS-000002', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' }
  ];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idUnico, 'HODOS-000002');
});
```

- [ ] **Step 2: Ejecutar y confirmar que fallan**

Run: `cd Desktop/Proyectos/hodos && node --test test/utilidades.test.js`
Expected: FAIL — `formatearIdCarga`/`seleccionarSoporteAEscanear` no existen.

- [ ] **Step 3: Implementar en `Utilidades.gs`**

Añadir al final del archivo:
```js
function formatearIdCarga(numero) {
  var texto = String(numero);
  while (texto.length < 6) {
    texto = '0' + texto;
  }
  return 'CARGA-' + texto;
}

function seleccionarSoporteAEscanear(filas, numeroPedido, destinoCarga) {
  // El barcode de la etiqueta lleva el número de pedido, no el ID único, así que un
  // pedido con varios soportes (o reenviado en otro lote) comparte el mismo código de
  // barras entre varias filas de ETIQUETAS. Cada escaneo marca la fila pendiente más
  // antigua (FIFO) de ese pedido+destino — no importa si la repetición viene de
  // soportes del mismo lote o de un reenvío en otro lote: cada fila es una unidad
  // física independiente que espera exactamente un escaneo.
  var coincidencias = filas.filter(function (f) { return f.numeroPedido === numeroPedido; });
  if (coincidencias.length === 0) {
    return { ok: false, motivo: 'NO_ENCONTRADO' };
  }
  var deDestinoCorrecto = coincidencias.filter(function (f) { return f.destino === destinoCarga; });
  if (deDestinoCorrecto.length === 0) {
    return { ok: false, motivo: 'DESTINO_INCORRECTO', detalle: { destinoReal: coincidencias[0].destino } };
  }
  var pendientes = deDestinoCorrecto.filter(function (f) { return f.estado !== 'EN_RUTA'; });
  if (pendientes.length === 0) {
    return { ok: false, motivo: 'YA_ESCANEADO' };
  }
  pendientes.sort(function (a, b) { return new Date(a.fechaCreacion) - new Date(b.fechaCreacion); });
  return { ok: true, idUnico: pendientes[0].idUnico };
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `cd Desktop/Proyectos/hodos && node --test`
Expected: `pass 28` (22 anteriores + 6 nuevos), `fail 0`.

---

## Task 2: `ConfigEntregas.gs` — destinatarios y horarios (copiados de Carta de Portes)

**Files:**
- Create: `Desktop/Proyectos/hodos/ConfigEntregas.gs`

- [ ] **Step 1: Implementar**

```js
// ConfigEntregas.gs — destinatarios y horarios del informe de cierre de carga.
// Copiado literal de CartaPortes.gs (EMAILS_CARTA_TIENDA / EMAILS_CARTA_CC /
// HORARIOS_CAMIONES) para mantener coherencia con quién recibe hoy la Carta de Portes.
// Málaga y Granada quedan sin datos hasta que el usuario los proporcione — el cierre de
// carga para esas tiendas seguirá funcionando (genera el PDF igual) pero avisará de que
// no hay destinatarios/horario configurados en vez de fallar en silencio.

var EMAILS_PEDIDO_CLIENTE_TIENDA = {
  'Marbella': [
    'francisco-damian.sedeno@leroymerlin.es',
    'miguel-angel.gonzalez5@leroymerlin.es',
    'logistica.marbella@leroymerlin.es'
  ],
  'Mijas': [
    'hector.andres@leroymerlin.es',
    'salvador.gonzalez2@leroymerlin.es',
    'carlos.fuentes@leroymerlin.es',
    'logistica.mijas@leroymerlin.es',
    'carlos.verastegui2@leroymerlin.es',
    'daniel.arrastio@ext.leroymerlin.es',
    'daniel.simo@ext.leroymerlin.es',
    'david.jimenez2@leroymerlin.es',
    'david.martin4@leroymerlin.es',
    'diego-jose.ramos@leroymerlin.es',
    'estefania.barranco@leroymerlin.es',
    'estefania.fortuna@leroymerlin.es',
    'francisco-javier.camara@ext.leroymerlin.es',
    'francisco-javier.valero@leroymerlin.es',
    'gema-pilar.arredondo@leroymerlin.es',
    'hugo-miguel.ponce@leroymerlin.es',
    'ignacio.lorite@leroymerlin.es',
    'maite.perez@leroymerlin.es',
    'marta.diaz@leroymerlin.es',
    'paola-valeria.rodriguez@leroymerlin.es',
    'patricia.vilchez@leroymerlin.es',
    'pedro.guzman@leroymerlin.es',
    'purificacion.estepa@leroymerlin.es',
    'sandra.longhi@leroymerlin.es',
    'sebastian.gelvis@ext.leroymerlin.es',
    'vicente.amador@leroymerlin.es'
  ],
  'Málaga': [],  // PENDIENTE: pedir a Pedro los correos de Málaga
  'Granada': []  // PENDIENTE: pedir a Pedro los correos de Granada
};

var EMAILS_PEDIDO_CLIENTE_CC = [
  'administracion.alm-malaga@leroymerlin.es',
  'jose-manuel.lachambre@leroymerlin.es',
  'pedro.gil@ext.leroymerlin.es',
  'david.delcampo@ext.leroymerlin.es',
  'jose-antonio.alcaide@ext.leroymerlin.es'
];

var HORARIOS_ENTREGA_TIENDA = {
  'Marbella': ['16:00', '17:30', '19:00', '22:00'],
  'Mijas': ['6:30', '8:00', '10:00', '13:00'],
  'Málaga': [],  // PENDIENTE: pedir a Pedro los horarios de Málaga
  'Granada': []  // PENDIENTE: pedir a Pedro los horarios de Granada
};
```

- [ ] **Step 2: Push a Apps Script**

Run: `cd Desktop/Proyectos/hodos && clasp push -f`

---

## Task 3: `EstructuraCargas.gs` — esquema de la pestaña CARGAS

**Files:**
- Create: `Desktop/Proyectos/hodos/EstructuraCargas.gs`

- [ ] **Step 1: Implementar**

```js
// EstructuraCargas.gs — esquema y acceso a la pestaña CARGAS.

var NOMBRE_HOJA_CARGAS = 'CARGAS';

var COLUMNAS_CARGAS = [
  'idCarga', 'destino', 'fechaEntrega', 'horario', 'estado', 'creadaPor',
  'fechaCreacion', 'cerradaPor', 'fechaCierre', 'pdfUrl', 'emailEnviado'
];

function obtenerHojaCargas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOMBRE_HOJA_CARGAS);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_CARGAS);
  }
  var cabeceraActual = hoja.getRange(1, 1, 1, COLUMNAS_CARGAS.length).getValues()[0];
  var cabeceraOk = COLUMNAS_CARGAS.every(function (col, i) { return cabeceraActual[i] === col; });
  if (!cabeceraOk) {
    hoja.getRange(1, 1, 1, COLUMNAS_CARGAS.length).setValues([COLUMNAS_CARGAS]);
  }
  return hoja;
}

function indiceColumnasCargas_() {
  var idx = {};
  COLUMNAS_CARGAS.forEach(function (col, i) { idx[col] = i; });
  return idx;
}
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Verificación manual (usuario, editor de Apps Script)**

Ejecutar `obtenerHojaCargas` una vez desde el editor. Confirmar que aparece una pestaña
`CARGAS` nueva con las 11 cabeceras.

---

## Task 4: `Backend.gs` — `crearCarga`, `listarCargasAbiertas`, `obtenerCarga`

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs`

- [ ] **Step 1: Implementar**

Añadir al final de `Backend.gs`:
```js
// ── Cargas de camión (fase 3: escaneo + validación de destino) ──

var PROP_CONTADOR_CARGA = 'HODOS_CONTADOR_CARGA';

function crearCarga(destino, fechaEntrega, horario) {
  if (!destino) throw new Error('Falta el destino');
  if (!fechaEntrega) throw new Error('Falta la fecha de entrega');
  if (!horario) throw new Error('Falta el horario');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var idCarga;
  try {
    var props = PropertiesService.getScriptProperties();
    var actual = parseInt(props.getProperty(PROP_CONTADOR_CARGA) || '0', 10);
    idCarga = formatearIdCarga(actual + 1);
    props.setProperty(PROP_CONTADOR_CARGA, String(actual + 1));
  } finally {
    lock.releaseLock();
  }

  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
  var fila = [idCarga, destino, fechaEntrega, horario, 'ABIERTA', creadoPor, new Date(), '', '', '', ''];
  var hoja = obtenerHojaCargas();
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, COLUMNAS_CARGAS.length).setValues([fila]);

  return { idCarga: idCarga };
}

function listarCargasAbiertas() {
  var hoja = obtenerHojaCargas();
  var datos = hoja.getDataRange().getValues();
  var idx = indiceColumnasCargas_();
  return datos.slice(1)
    .filter(function (f) { return f[idx.estado] === 'ABIERTA'; })
    .map(function (f) {
      return {
        idCarga: f[idx.idCarga],
        destino: f[idx.destino],
        fechaEntrega: fechaComoTexto(f[idx.fechaEntrega]),
        horario: f[idx.horario],
        fechaCreacion: fechaComoTexto(f[idx.fechaCreacion])
      };
    });
}

function obtenerCarga(idCarga) {
  var hojaCargas = obtenerHojaCargas();
  var datosCargas = hojaCargas.getDataRange().getValues();
  var idxC = indiceColumnasCargas_();
  var filaCarga = datosCargas.slice(1).filter(function (f) { return f[idxC.idCarga] === idCarga; })[0];
  if (!filaCarga) throw new Error('Carga no encontrada: ' + idCarga);

  var hojaEtq = obtenerHojaEtiquetas();
  var datosEtq = hojaEtq.getDataRange().getValues();
  var idxE = indiceColumnas_();
  var escaneados = datosEtq.slice(1)
    .filter(function (f) { return f[idxE.bateaId] === idCarga; })
    .map(function (f) {
      return {
        idUnico: f[idxE.idUnico],
        numeroPedido: f[idxE.numeroPedido],
        origenTexto: f[idxE.origenTexto],
        fechaEnvio: fechaComoTexto(f[idxE.fechaEnvio])
      };
    })
    .sort(function (a, b) { return new Date(a.fechaEnvio) - new Date(b.fechaEnvio); });

  return {
    idCarga: filaCarga[idxC.idCarga],
    destino: filaCarga[idxC.destino],
    fechaEntrega: fechaComoTexto(filaCarga[idxC.fechaEntrega]),
    horario: filaCarga[idxC.horario],
    estado: filaCarga[idxC.estado],
    escaneados: escaneados
  };
}
```

> **Nota:** todos los campos de fecha devueltos se pasan por `fechaComoTexto()` — regla
> de oro del proyecto (`google.script.run` devuelve `null` en silencio si se devuelve un
> `Date` crudo dentro de un array/objeto).

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Verificación manual (usuario, editor de Apps Script)**

```js
function _pruebaManualCrearCarga() {
  var r = crearCarga('Málaga', '2026-07-29', '10:00');
  Logger.log(JSON.stringify(r));
  Logger.log(JSON.stringify(listarCargasAbiertas()));
  Logger.log(JSON.stringify(obtenerCarga(r.idCarga)));
}
```
Expected: sin errores; `listarCargasAbiertas` incluye la carga recién creada;
`obtenerCarga` devuelve `escaneados: []`.

---

## Task 5: `Backend.gs` — `escanearSoporte`

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs`

- [ ] **Step 1: Implementar**

Añadir tras `obtenerCarga`:
```js
function escanearSoporte(idCarga, numeroPedido) {
  numeroPedido = String(numeroPedido || '').trim();
  if (!numeroPedido) throw new Error('Número de pedido vacío');

  var hojaCargas = obtenerHojaCargas();
  var datosCargas = hojaCargas.getDataRange().getValues();
  var idxC = indiceColumnasCargas_();
  var carga = null;
  for (var i = 1; i < datosCargas.length; i++) {
    if (datosCargas[i][idxC.idCarga] === idCarga) { carga = datosCargas[i]; break; }
  }
  if (!carga) throw new Error('Carga no encontrada: ' + idCarga);
  if (carga[idxC.estado] !== 'ABIERTA') throw new Error('Esta carga ya está cerrada');
  var destinoCarga = carga[idxC.destino];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var hojaEtq = obtenerHojaEtiquetas();
    var datosEtq = hojaEtq.getDataRange().getValues();
    var idxE = indiceColumnas_();
    var filas = datosEtq.slice(1).map(function (f, i2) {
      return {
        _filaSheet: i2 + 2,
        idUnico: f[idxE.idUnico],
        numeroPedido: f[idxE.numeroPedido],
        destino: f[idxE.destino],
        estado: f[idxE.estado],
        fechaCreacion: f[idxE.fechaCreacion]
      };
    });

    var resultado = seleccionarSoporteAEscanear(filas, numeroPedido, destinoCarga);
    if (!resultado.ok) {
      return resultado;
    }

    var filaElegida = filas.filter(function (f) { return f.idUnico === resultado.idUnico; })[0];
    var ahora = new Date();
    hojaEtq.getRange(filaElegida._filaSheet, idxE.estado + 1).setValue('EN_RUTA');
    hojaEtq.getRange(filaElegida._filaSheet, idxE.bateaId + 1).setValue(idCarga);
    hojaEtq.getRange(filaElegida._filaSheet, idxE.fechaEnvio + 1).setValue(ahora);

    return { ok: true, idUnico: resultado.idUnico, numeroPedido: numeroPedido };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Verificación manual (usuario, editor de Apps Script)**

```js
function _pruebaManualEscanearSoporte() {
  var lote = registrarLote({ pedidosTexto: '900001\n900001\n900002', origen: 'MECO', subtipo: '', destino: 'Málaga' });
  var carga = crearCarga('Málaga', '2026-07-29', '10:00');

  Logger.log('1er escaneo 900001 (debe marcar el soporte 1/2): ' + JSON.stringify(escanearSoporte(carga.idCarga, '900001')));
  Logger.log('2º escaneo 900001 (debe marcar el soporte 2/2): ' + JSON.stringify(escanearSoporte(carga.idCarga, '900001')));
  Logger.log('3er escaneo 900001 (ya no quedan soportes, YA_ESCANEADO): ' + JSON.stringify(escanearSoporte(carga.idCarga, '900001')));
  Logger.log('escaneo 900002 en carga de Marbella (debe dar DESTINO_INCORRECTO): ' + JSON.stringify(escanearSoporte(crearCarga('Marbella', '2026-07-29', '16:00').idCarga, '900002')));
  Logger.log('escaneo de un pedido inexistente (NO_ENCONTRADO): ' + JSON.stringify(escanearSoporte(carga.idCarga, '999999')));
}
```
Expected: los 5 logs coinciden exactamente con lo que dice cada comentario.

---

## Task 6: `ReporteCarga.gs` — informe de cierre + `cerrarCarga`

**Files:**
- Create: `Desktop/Proyectos/hodos/ReporteCarga.gs`
- Modify: `Desktop/Proyectos/hodos/Backend.gs`

- [ ] **Step 1: Implementar `ReporteCarga.gs`**

```js
// ReporteCarga.gs — informe de cierre de carga, mismo estilo visual que
// CartadePortesSIE/CartaPortes.gs (buildPDFHtml): cabecera oscura con logo Taisa,
// banda de color con tienda/fecha/horario, tabla de pedidos, aviso si no hay nada.

function htmlInformeCarga(idCarga) {
  var carga = obtenerCarga(idCarga);

  var filas = carga.escaneados.map(function (e, i) {
    var bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    var hora = e.fechaEnvio ? Utilities.formatDate(new Date(e.fechaEnvio), 'GMT+1', 'HH:mm') : '';
    return '<tr style="background:' + bg + ';">'
      + '<td style="padding:8px 10px;font-size:11px;text-align:center;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;width:32px;">' + (i + 1) + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:12px;font-weight:bold;color:#1a1a2e;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.numeroPedido) + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:10px;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.idUnico) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.origenTexto) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-bottom:1px solid #eee;">' + hora + '</td>'
      + '</tr>';
  }).join('');

  var avisoVacio = carga.escaneados.length === 0
    ? '<tr><td colspan="2" style="padding:12px 20px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fdf2f2;border:1px solid #f5c6c6;border-left:4px solid #e30613;padding:10px 14px;font-size:11px;color:#c0392b;"><strong>Carga cerrada sin ningún soporte escaneado.</strong></td></tr></table></td></tr>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
    + '<style>body{margin:0;padding:0;font-family:Arial,sans-serif;font-size:12px;}table{border-collapse:collapse;}</style>'
    + '</head><body style="background:#ffffff;margin:0;padding:20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd;">'
    + '<tr><td style="background:#080a10;padding:16px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="width:140px;"><img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" height="30" style="background:white;padding:4px 12px;display:block;"></td>'
    + '<td style="text-align:right;"><span style="font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">HODOS &middot; Pedido Cliente</span><br>'
    + '<span style="font-size:8px;color:#6b7899;letter-spacing:1px;">Taisa Logistics</span></td>'
    + '</tr></table></td></tr>'
    + '<tr><td style="background:#e30613;padding:14px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:3px;text-transform:uppercase;">' + esc_(carga.destino) + '</td>'
    + '<td style="text-align:right;font-size:11px;color:rgba(255,255,255,0.9);line-height:1.8;">'
    + '<strong>Fecha entrega:</strong> ' + esc_(Utilities.formatDate(new Date(carga.fechaEntrega), 'GMT+1', 'dd/MM/yyyy'))
    + (carga.horario ? '<br><strong>Horario:</strong> ' + esc_(carga.horario) : '')
    + '</td></tr></table></td></tr>'
    + avisoVacio
    + '<tr><td style="padding:10px 20px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0">'
    + '<tr style="background:#f3f4f6;"><th style="padding:8px 10px;font-size:10px;color:#888;">#</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">Nº PEDIDO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">ID ÚNICO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">ORIGEN</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">HORA</th></tr>'
    + filas
    + '</table></td></tr>'
    + '<tr><td style="padding:10px 20px;font-size:10px;color:#999;">Total soportes: ' + carga.escaneados.length + ' &middot; Carga ' + esc_(idCarga) + '</td></tr>'
    + '</table></body></html>';
}
```

- [ ] **Step 2: Añadir `cerrarCarga` a `Backend.gs`**

```js
function cerrarCarga(idCarga) {
  var hojaCargas = obtenerHojaCargas();
  var datosCargas = hojaCargas.getDataRange().getValues();
  var idxC = indiceColumnasCargas_();
  var filaCargaNum = -1;
  for (var i = 1; i < datosCargas.length; i++) {
    if (datosCargas[i][idxC.idCarga] === idCarga) { filaCargaNum = i + 1; break; }
  }
  if (filaCargaNum === -1) throw new Error('Carga no encontrada: ' + idCarga);
  if (datosCargas[filaCargaNum - 1][idxC.estado] !== 'ABIERTA') throw new Error('Esta carga ya está cerrada');

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
  if (destinatarios.length > 0) {
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

  var ahora = new Date();
  hojaCargas.getRange(filaCargaNum, idxC.estado + 1).setValue('CERRADA');
  hojaCargas.getRange(filaCargaNum, idxC.cerradaPor + 1).setValue(Session.getActiveUser().getEmail() || 'desconocido');
  hojaCargas.getRange(filaCargaNum, idxC.fechaCierre + 1).setValue(ahora);
  hojaCargas.getRange(filaCargaNum, idxC.pdfUrl + 1).setValue(pdfUrl);
  hojaCargas.getRange(filaCargaNum, idxC.emailEnviado + 1).setValue(emailEnviado);

  return {
    idCarga: idCarga,
    cantidad: carga.escaneados.length,
    pdfUrl: pdfUrl,
    emailEnviado: emailEnviado,
    destinatariosConfigurados: destinatarios.length
  };
}
```

- [ ] **Step 3: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 4: Verificación manual (usuario, editor de Apps Script)**

```js
function _pruebaManualCerrarCarga() {
  registrarLote({ pedidosTexto: '900101\n900102', origen: 'Torija', subtipo: '', destino: 'Mijas' });
  var carga = crearCarga('Mijas', '2026-07-29', '8:00');
  escanearSoporte(carga.idCarga, '900101');
  escanearSoporte(carga.idCarga, '900102');
  var r = cerrarCarga(carga.idCarga);
  Logger.log(JSON.stringify(r));
}
```
Expected: `cantidad: 2`, `pdfUrl` con una URL de Drive real, `emailEnviado` en `"SI"` **solo
si ya autorizaste el envío de correo** (Task 8) — si no, `emailEnviado` será una cadena
`"ERROR: ..."`, lo cual es el comportamiento esperado hasta autorizar. Abrir `pdfUrl` en
el navegador y confirmar que el PDF tiene el aspecto de Carta de Portes (cabecera oscura,
banda roja con "MIJAS", tabla con los 2 pedidos).

---

## Task 7: `Index.html` — vista "Cargar camión"

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html`

- [ ] **Step 1: Añadir la entrada al sidebar**

En el bloque `<nav id="tabBar" class="app-sidebar">`, añadir un tercer botón después de
"Buscar":
```html
<button data-tab="camion" onclick="cambiarPestana('camion')">
  <svg class="icon" viewBox="0 0 24 24"><rect x="1" y="7" width="15" height="10" rx="1"/><path d="M16 10h3l3 3v4h-6z"/><circle cx="6" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg>
  <span>Cargar camión</span>
</button>
```

- [ ] **Step 2: Añadir el bloque de la vista**

Justo después de `<div id="vistaInterno" ...>...</div>` (antes de `<div id="vistaTienda"`):
```html
<!-- ══════════ VISTA: CARGAR CAMIÓN ══════════ -->
<div id="vistaCamion" class="vista-oculta">
  <div id="camionPaso1" class="busqueda-form">
    <div class="form-group"><label>Tienda destino</label>
      <select id="camionDestino">
        <option value="Málaga">Málaga</option>
        <option value="Marbella">Marbella</option>
        <option value="Mijas">Mijas</option>
        <option value="Granada">Granada</option>
      </select>
    </div>
    <div class="form-group"><label>Fecha de entrega</label><input type="date" id="camionFecha"></div>
    <div class="form-group"><label>Horario</label><select id="camionHorario"></select></div>
    <button onclick="crearCargaUI()">Abrir carga</button>
  </div>

  <div id="camionPaso2" class="vista-oculta">
    <div class="section" style="margin-bottom:20px;">
      <h2 id="camionTitulo"></h2>
      <div class="form-group">
        <label>Escanea aquí (lector de código de barras)</label>
        <input type="text" id="camionEscaneo" autocomplete="off" placeholder="Esperando lectura...">
      </div>
      <div id="camionAviso"></div>
    </div>
    <div class="resultados-wrap"><div id="camionLista"></div></div>
    <button class="btn-primary" style="margin-top:16px;" onclick="cerrarCargaUI()">Cerrar carga</button>
  </div>

  <div id="camionPaso3" class="vista-oculta">
    <div class="section">
      <h2>Carga cerrada</h2>
      <div id="camionResumen"></div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Añadir el JS**

Añadir dentro de `<script>`, antes de `iniciarVista()`:
```js
var HORARIOS_POR_TIENDA = {
  'Málaga': [], 'Marbella': ['16:00', '17:30', '19:00', '22:00'],
  'Mijas': ['6:30', '8:00', '10:00', '13:00'], 'Granada': []
};
var cargaActualId = null;

function poblarHorarios_() {
  var destino = document.getElementById('camionDestino').value;
  var sel = document.getElementById('camionHorario');
  var horarios = HORARIOS_POR_TIENDA[destino] || [];
  if (horarios.length === 0) {
    sel.innerHTML = '<option value="">(sin horarios configurados para ' + destino + ')</option>';
  } else {
    sel.innerHTML = horarios.map(function (h) { return '<option value="' + h + '">' + h + '</option>'; }).join('');
  }
}

function crearCargaUI() {
  var destino = document.getElementById('camionDestino').value;
  var fecha = document.getElementById('camionFecha').value;
  var horario = document.getElementById('camionHorario').value;
  if (!fecha) { alert('Elige una fecha de entrega'); return; }
  if (!horario) { alert('No hay horario seleccionable para ' + destino + ' (falta configurar)'); return; }
  gas('crearCarga', destino, fecha, horario).then(function (r) {
    cargaActualId = r.idCarga;
    document.getElementById('camionPaso1').classList.add('vista-oculta');
    document.getElementById('camionPaso2').classList.remove('vista-oculta');
    document.getElementById('camionTitulo').textContent = r.idCarga + ' — ' + destino + ' ' + fecha + ' ' + horario;
    document.getElementById('camionLista').innerHTML = '';
    var input = document.getElementById('camionEscaneo');
    input.value = '';
    input.focus();
  }).catch(function (err) { alert('Error al abrir la carga: ' + err.message); });
}

function renderizarListaCamion_(escaneados) {
  var cont = document.getElementById('camionLista');
  if (!escaneados || escaneados.length === 0) {
    cont.innerHTML = '<p class="sin-resultados">Ningún soporte escaneado todavía.</p>';
    return;
  }
  var filas = escaneados.map(function (e, i) {
    return '<tr><td data-label="#">' + (i + 1) + '</td><td data-label="Nº Pedido">' + e.numeroPedido +
      '</td><td data-label="Origen">' + e.origenTexto + '</td><td data-label="ID único">' + e.idUnico + '</td></tr>';
  }).join('');
  cont.innerHTML = '<table class="resultados-tabla"><thead><tr><th>#</th><th>Nº Pedido</th><th>Origen</th><th>ID único</th></tr></thead><tbody>' + filas + '</tbody></table>';
}

function mostrarAvisoCamion_(mensaje, esError) {
  var aviso = document.getElementById('camionAviso');
  aviso.textContent = mensaje;
  aviso.className = esError ? 'aviso-error' : '';
  aviso.style.color = esError ? '' : 'var(--color-accent)';
  setTimeout(function () { aviso.textContent = ''; }, 4000);
}

document.getElementById('camionDestino').addEventListener('change', poblarHorarios_);

document.getElementById('camionEscaneo').addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter') return;
  var numeroPedido = this.value.trim();
  this.value = '';
  if (!numeroPedido || !cargaActualId) return;
  gas('escanearSoporte', cargaActualId, numeroPedido).then(function (r) {
    if (r.ok) {
      mostrarAvisoCamion_('Añadido: ' + r.numeroPedido, false);
      gas('obtenerCarga', cargaActualId).then(function (c) { renderizarListaCamion_(c.escaneados); });
    } else if (r.motivo === 'DESTINO_INCORRECTO') {
      mostrarAvisoCamion_('Este pedido es de ' + r.detalle.destinoReal + ', no coincide con esta carga', true);
    } else if (r.motivo === 'YA_ESCANEADO') {
      mostrarAvisoCamion_('Este pedido ya fue escaneado antes', true);
    } else {
      mostrarAvisoCamion_('Pedido no encontrado: ' + numeroPedido, true);
    }
  }).catch(function (err) { mostrarAvisoCamion_('Error: ' + err.message, true); });
});

function cerrarCargaUI() {
  if (!cargaActualId) return;
  if (!confirm('¿Cerrar la carga y enviar el informe?')) return;
  gas('cerrarCarga', cargaActualId).then(function (r) {
    document.getElementById('camionPaso2').classList.add('vista-oculta');
    document.getElementById('camionPaso3').classList.remove('vista-oculta');
    var estadoEmail = r.emailEnviado === 'SI' ? 'Email enviado correctamente.' :
      (r.destinatariosConfigurados === 0 ? 'Sin destinatarios configurados para esta tienda — solo se generó el PDF.' : 'No se pudo enviar el email (' + r.emailEnviado + ').');
    document.getElementById('camionResumen').innerHTML =
      '<p>' + r.cantidad + ' soportes cargados.</p><p>' + estadoEmail + '</p><p><a href="' + r.pdfUrl + '" target="_blank">Abrir informe PDF</a></p>';
    cargaActualId = null;
  }).catch(function (err) { alert('Error al cerrar la carga: ' + err.message); });
}
```

- [ ] **Step 2: Actualizar `cambiarPestana` para incluir la tercera pestaña**

Reemplazar la función `cambiarPestana` existente:
```js
function cambiarPestana(nombre) {
  document.getElementById('vistaCarga').classList.toggle('vista-oculta', nombre !== 'carga');
  document.getElementById('vistaInterno').classList.toggle('vista-oculta', nombre !== 'interno');
  document.getElementById('vistaCamion').classList.toggle('vista-oculta', nombre !== 'camion');
  document.querySelectorAll('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nombre); });
  if (nombre === 'interno') { buscarYMostrar('interno'); }
  if (nombre === 'carga') { cargarHistorial(); }
  if (nombre === 'camion') { poblarHorarios_(); }
}
```

- [ ] **Step 3: Push a Apps Script**

Run: `clasp push -f`

---

## Task 8: `Pruebas.gs` — smoke test de la fase 3 + `autorizarYProbarCorreo`

**Files:**
- Modify: `Desktop/Proyectos/hodos/Pruebas.gs`

- [ ] **Step 1: Añadir a `verificarSistema()`**

```js
  try {
    registrarLote({ pedidosTexto: '910001\n910001', origen: 'MECO', subtipo: '', destino: 'Granada' });
    var cargaTest = crearCarga('Granada', '2026-07-29', '12:00');
    var r1 = escanearSoporte(cargaTest.idCarga, '910001');
    var r2 = escanearSoporte(cargaTest.idCarga, '910001');
    var r3 = escanearSoporte(cargaTest.idCarga, '910001');
    var okFase3 = r1.ok && r2.ok && !r3.ok && r3.motivo === 'YA_ESCANEADO';
    resultados.push(okFase3
      ? 'OK: fase 3 escaneo FIFO (2 soportes marcados, 3er escaneo -> YA_ESCANEADO)'
      : 'ERROR fase 3 escaneo: ' + JSON.stringify([r1, r2, r3]));

    var cierre = cerrarCarga(cargaTest.idCarga);
    resultados.push('OK: cerrarCarga -> ' + cierre.cantidad + ' soportes, pdfUrl=' + (cierre.pdfUrl ? 'generada' : 'FALTA') + ', emailEnviado=' + cierre.emailEnviado);
  } catch (e) {
    resultados.push('ERROR fase 3: ' + e.toString());
  }
```

- [ ] **Step 2: Añadir función de autorización de email**

Añadir al final de `Pruebas.gs`:
```js
/**
 * Ejecutar UNA VEZ desde el editor para autorizar el envío de correo. Si tras
 * ejecutarla no aparece la pantalla de permisos completa (con "enviar correo en tu
 * nombre"), sigue el mismo proceso que en lm_producción: quitar el bloque
 * "oauthScopes" de appsscript.json (autodetección) y revocar el acceso de este
 * proyecto en myaccount.google.com/permissions antes de reintentar.
 */
function autorizarYProbarCorreo() {
  var destino = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: destino,
    subject: 'HODOS - Prueba de autorización de correo',
    htmlBody: '<p>Si ves este correo, el envío de emails desde HODOS ya está autorizado.</p>'
  });
  Logger.log('Correo de prueba enviado a ' + destino);
}
```

- [ ] **Step 3: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 4: Verificación manual (usuario, editor de Apps Script)**

1. Ejecutar `autorizarYProbarCorreo` — la primera vez pedirá autorizar permisos; conceder
   todos. Confirmar que llega el correo de prueba a tu bandeja.
2. Ejecutar `verificarSistema` — confirmar que todas las líneas empiezan por `OK:`,
   incluida la de `emailEnviado=SI` (si Málaga tuviera destinatarios — hoy no los tiene,
   así que lo esperado es `emailEnviado=NO` con 0 destinatarios configurados, **eso
   también cuenta como OK**, no como fallo).
3. Borrar de las Sheets las filas/cargas de prueba (`910001`, `900001`/`900002`,
   `900101`/`900102`, y las cargas de test en `CARGAS`).

---

## Task 9: Desplegar y checklist final (usuario)

- [ ] **Step 1: Publicar nueva versión**

```bash
cd Desktop/Proyectos/hodos
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ --description "v13 - fase 3: carga de camion (escaneo + validacion destino + informe)"
```

- [ ] **Step 2: Checklist (usuario, navegador real + lector de código de barras)**

- [ ] Pestaña "Cargar camión" visible en el sidebar, con icono.
- [ ] Crear una carga para Marbella o Mijas (las que sí tienen horario configurado) —
      confirmar que el desplegable de horario muestra las horas correctas.
- [ ] Intentar crear una carga para Málaga/Granada — debe avisar de que no hay horario
      configurado en vez de dejar crear la carga con un valor vacío.
- [ ] Con el lector físico (o tecleando + Enter), escanear un pedido real registrado para
      esa tienda — debe aparecer en la lista al instante.
- [ ] Escanear un pedido de otra tienda — debe salir la alerta roja de destino
      incorrecto y NO añadirse a la lista.
- [ ] Escanear el mismo pedido dos veces seguidas (de uno con un solo soporte) — la
      segunda vez debe avisar "ya fue escaneado".
- [ ] Cerrar la carga — confirmar el resumen, abrir el PDF generado y comprobar que se
      parece visualmente a un email de Carta de Portes (cabecera oscura + banda de color
      + tabla).
- [ ] Ir al buscador (`?vista=tienda&tienda=Malaga` o la vista interna) y confirmar que
      los pedidos recién cargados ahora muestran "Llegó: <fecha/hora>" en vez de
      "Pendiente".
- [ ] Cuando tengas los correos/horarios reales de Málaga y Granada, pásamelos para
      rellenar `ConfigEntregas.gs` (hoy están vacíos a propósito).

---

## Self-review

**Cobertura del spec:** escaneo con lector físico ✅ (Task 7, input siempre enfocado),
validación de destino con alerta y sin añadir ✅ (Task 1 `DESTINO_INCORRECTO` + Task 7 UI),
marcado "en ruta" con fecha/hora ✅ (Task 5, rellena `estado`/`bateaId`/`fechaEnvio`
reservados desde el Módulo 1), informe con estilo de Carta de Portes ✅ (Task 6,
adaptado de `buildPDFHtml`), envío por email a mismos destinatarios ✅ (Task 2 + Task 6),
identificación de carga por destino+fecha+horario igual que SIE ✅ (Task 3/4). Huecos de
datos (Málaga/Granada) documentados y con comportamiento explícito de aviso, no fallo
silencioso.

**Placeholders:** ninguno salvo los arrays vacíos `'Málaga': []`/`'Granada': []` en
`ConfigEntregas.gs`, que son datos reales pendientes del usuario (marcados
`PENDIENTE`), no decisiones de diseño sin resolver.

**Consistencia de tipos:** `seleccionarSoporteAEscanear` se usa con la misma forma de
fila (`idUnico`/`numeroPedido`/`destino`/`estado`/`fechaCreacion`) en el test de Node y
en `escanearSoporte` (Backend.gs). `formatearIdCarga`/`obtenerHojaCargas`/
`indiceColumnasCargas_`/`COLUMNAS_CARGAS` se usan igual en `EstructuraCargas.gs`,
`Backend.gs` y `ReporteCarga.gs`. `crearCarga`, `listarCargasAbiertas`, `obtenerCarga`,
`escanearSoporte`, `cerrarCarga` son los cinco nombres llamados desde `Index.html` vía
`gas(...)` — coinciden exactamente con las funciones definidas en `Backend.gs`. Todas las
fechas devueltas a cliente pasan por `fechaComoTexto()` (regla de oro ya documentada).
