# HODOS — Cabecera + Buscadores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cabecera profesional (logo Taisa + "HODOS") y dos pantallas de búsqueda de solo
lectura — una para el equipo interno (sin restricción, más filtros) y otra por tienda
(restringida por enlace) — sobre el Módulo 1 ya desplegado.

**Architecture:** Todo dentro del mismo proyecto/deployment de HODOS. `doGet` pasa a usar
una plantilla (`createTemplateFromFile`) para inyectar `vista`/`tienda` desde la URL. Un
único `Index.html` con tres secciones que se muestran/ocultan por JS según esos parámetros
— mismo patrón que `lm_produccion` (operario/admin por `?vista=`). Una función nueva,
`buscarEtiquetas`, filtra la pestaña `ETIQUETAS` ya existente; no se toca el esquema ni el
registro de lotes.

**Tech Stack:** Igual que el Módulo 1 (GAS V8 + HtmlService + clasp). Validación de
`tienda`/`vista` es lógica pura, testeada con `node --test` igual que el resto.

**Referencias:**
- Diseño: `docs/superpowers/specs/2026-07-27-cabecera-y-buscadores-design.md`
- Depende de: Módulo 1 ya desplegado (versión 2, con logo Leroy Merlin)

---

## Task 1: `Utilidades.gs` — validación de tienda/vista (TDD en Node)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Utilidades.gs`
- Modify: `Desktop/Proyectos/hodos/test/utilidades.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test/utilidades.test.js` (al final, antes del cierre del archivo):
```js
test('validarTienda acepta solo las 4 tiendas conocidas', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarTienda('Málaga'), 'Málaga');
  assert.strictEqual(ctx.validarTienda('Marbella'), 'Marbella');
  assert.strictEqual(ctx.validarTienda('otra-cosa'), '');
  assert.strictEqual(ctx.validarTienda(undefined), '');
  assert.strictEqual(ctx.validarTienda(''), '');
});

test('validarVista acepta solo carga/interno/tienda, por defecto carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarVista('carga'), 'carga');
  assert.strictEqual(ctx.validarVista('interno'), 'interno');
  assert.strictEqual(ctx.validarVista('tienda'), 'tienda');
  assert.strictEqual(ctx.validarVista('otra-cosa'), 'carga');
  assert.strictEqual(ctx.validarVista(undefined), 'carga');
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `cd Desktop/Proyectos/hodos && node --test test/utilidades.test.js`
Expected: FAIL — `validarTienda`/`validarVista` no existen todavía.

- [ ] **Step 3: Implementar en `Utilidades.gs`**

Añadir al final del archivo:
```js
var TIENDAS_VALIDAS = ['Málaga', 'Marbella', 'Mijas', 'Granada'];
var VISTAS_VALIDAS = ['carga', 'interno', 'tienda'];

function validarTienda(tienda) {
  if (TIENDAS_VALIDAS.indexOf(tienda) === -1) return '';
  return tienda;
}

function validarVista(vista) {
  if (VISTAS_VALIDAS.indexOf(vista) === -1) return 'carga';
  return vista;
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `cd Desktop/Proyectos/hodos && node --test`
Expected: `pass 17` (15 anteriores + 2 nuevos), `fail 0` — verificado.

---

## Task 2: `Backend.gs` — `doGet` con plantilla + `buscarEtiquetas`

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs`

- [ ] **Step 1: Sustituir `doGet` por la versión con plantilla**

Reemplazar la función `doGet` actual por:
```js
function doGet(e) {
  var params = (e && e.parameter) || {};
  var tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.vista = validarVista(params.vista);
  tmpl.tiendaFiltro = validarTienda(params.tienda);
  return tmpl.evaluate()
    .setTitle('HODOS - Taisa Logistics')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

- [ ] **Step 2: Añadir `buscarEtiquetas` al final de `Backend.gs`**

```js
function buscarEtiquetas(filtros) {
  filtros = filtros || {};
  var hoja = obtenerHojaEtiquetas();
  var datos = hoja.getDataRange().getValues();
  var idx = indiceColumnas_();
  var filas = datos.slice(1);

  var resultado = filas.filter(function (f) {
    if (filtros.destino && f[idx.destino] !== filtros.destino) return false;
    if (filtros.origen && f[idx.origen] !== filtros.origen) return false;
    if (filtros.estado && f[idx.estado] !== filtros.estado) return false;
    if (filtros.idUnico && String(f[idx.idUnico]).indexOf(filtros.idUnico) === -1) return false;
    if (filtros.numeroPedido && String(f[idx.numeroPedido]).indexOf(filtros.numeroPedido) === -1) return false;
    if (filtros.fecha) {
      var fechaFila = Utilities.formatDate(new Date(f[idx.fechaCreacion]), 'GMT+1', 'yyyy-MM-dd');
      if (fechaFila !== filtros.fecha) return false;
    }
    return true;
  }).map(function (f) {
    return {
      idUnico: f[idx.idUnico],
      numeroPedido: f[idx.numeroPedido],
      soporteNum: f[idx.soporteNum],
      soporteTotal: f[idx.soporteTotal],
      origenTexto: f[idx.origenTexto],
      destino: f[idx.destino],
      fechaCreacion: f[idx.fechaCreacion],
      estado: f[idx.estado],
      bateaId: f[idx.bateaId],
      fechaEnvio: f[idx.fechaEnvio]
    };
  });

  resultado.sort(function (a, b) { return new Date(b.fechaCreacion) - new Date(a.fechaCreacion); });
  return resultado;
}
```

- [ ] **Step 3: Push a Apps Script**

Run: `cd Desktop/Proyectos/hodos && clasp push -f`

- [ ] **Step 4: Verificación manual (usuario, editor de Apps Script)**

Ejecutar desde el editor (reutiliza el lote de prueba de `verificarSistema`, o crea uno):
```js
function _pruebaManualBusqueda() {
  registrarLote({ pedidosTexto: '555001\n555002', origen: 'MECO', subtipo: '', destino: 'Mijas' });
  registrarLote({ pedidosTexto: '555003', origen: 'Torija', subtipo: '', destino: 'Granada' });
  var soloMijas = buscarEtiquetas({ destino: 'Mijas' });
  var porPedido = buscarEtiquetas({ numeroPedido: '555003' });
  Logger.log('Mijas: ' + soloMijas.length + ' (esperado 2)');
  Logger.log('555003: ' + porPedido.length + ' (esperado 1), destino=' + porPedido[0].destino + ' (esperado Granada)');
}
```
Expected: `Mijas: 2 (esperado 2)` y `555003: 1 (esperado 1), destino=Granada (esperado Granada)`.

---

## Task 3: `Index.html` — cabecera compartida y reestructuración en 3 vistas

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html` (reescritura completa)

- [ ] **Step 1: Reemplazar todo el contenido de `Index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HODOS - Taisa Logistics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding:0 20px 20px; }
    body.tema-black { --bg-primary:#080a10; --color-accent:#e30613; --text-primary:#fff; --input-bg:#1a1d2e; --input-border:#333; }
    body.tema-vivid { --bg-primary:#fff; --color-accent:#ff0000; --text-primary:#000; --input-bg:#f9f9f9; --input-border:#00aa00; }
    body.tema-gray  { --bg-primary:#fff; --color-accent:#555; --text-primary:#000; --input-bg:#f0f0f0; --input-border:#ccc; }

    .app-header { display:flex; align-items:center; justify-content:space-between; padding:16px 10px; margin-bottom:20px; border-bottom:2px solid var(--color-accent); }
    .app-header .brand { display:flex; align-items:center; gap:14px; }
    .app-header .logo-header { height:38px; width:auto; }
    .app-header .titulo { font-family:'Bebas Neue', sans-serif; font-size:32px; letter-spacing:1px; color:var(--text-primary); line-height:1; }
    .app-header .subtitulo { font-size:11px; color:var(--text-primary); opacity:0.6; letter-spacing:0.5px; }
    .tema-selector-compact { display:flex; gap:8px; }
    .tema-selector-compact button { width:26px; height:26px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
    .tema-selector-compact button.black { background:#080a10; }
    .tema-selector-compact button.vivid { background:linear-gradient(135deg,#ff0000,#00aa00); }
    .tema-selector-compact button.gray  { background:#555; }
    .tema-selector-compact button.active { border-color:var(--color-accent); transform:scale(1.15); }

    .tab-bar { display:flex; gap:10px; margin-bottom:20px; }
    .tab-bar button { padding:10px 22px; border:2px solid var(--color-accent); background:transparent; color:var(--text-primary); border-radius:6px; cursor:pointer; font-weight:600; font-size:14px; }
    .tab-bar button.active { background:var(--color-accent); color:var(--bg-primary); }

    .vista-oculta { display:none !important; }

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

    .busqueda-form { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:14px; align-items:end; margin-bottom:20px; background:var(--bg-primary); color:var(--text-primary); padding:24px; border-radius:8px; }
    .busqueda-form .form-group { margin-bottom:0; }
    .busqueda-form button { padding:12px; background:var(--color-accent); color:var(--bg-primary); border:none; border-radius:6px; font-weight:700; cursor:pointer; }
    .resultados-tabla { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px; }
    .resultados-tabla th, .resultados-tabla td { padding:10px; text-align:left; border-bottom:1px solid var(--input-border); }
    .resultados-tabla th { color:var(--color-accent); text-transform:uppercase; font-size:11px; }
    .batea-pendiente { opacity:0.6; }
    .batea-ok { color:var(--color-accent); font-weight:700; }
    .sin-resultados { opacity:0.6; padding:20px; text-align:center; }
    .aviso-tienda-invalida { max-width:600px; margin:60px auto; text-align:center; padding:30px; background:var(--input-bg); border-radius:8px; }

    @media (max-width:1300px) { .container { grid-template-columns:1fr; } }
  </style>
</head>
<body class="tema-black">

<div class="app-header">
  <div class="brand">
    <img src="data:image/png;base64,<?= LOGO_TAISA_B64 ?>" class="logo-header" alt="Taisa Logistics">
    <div>
      <div class="titulo">HODOS</div>
      <div class="subtitulo">Taisa Logistics</div>
    </div>
  </div>
  <div class="tema-selector-compact">
    <button class="black active" title="Black Edition" onclick="cambiarTema('black')"></button>
    <button class="vivid" title="Rojo/Verde Vivo" onclick="cambiarTema('vivid')"></button>
    <button class="gray" title="Gris/Blanco" onclick="cambiarTema('gray')"></button>
  </div>
</div>

<div id="avisoTiendaInvalida" class="aviso-tienda-invalida vista-oculta">
  <h2>Enlace no válido</h2>
  <p>Falta especificar la tienda en el enlace (ej. <code>?vista=tienda&amp;tienda=Malaga</code>).</p>
</div>

<div id="tabBar" class="tab-bar">
  <button data-tab="carga" class="active" onclick="cambiarPestana('carga')">Cargar lote</button>
  <button data-tab="interno" onclick="cambiarPestana('interno')">Buscar</button>
</div>

<!-- ══════════ VISTA: CARGAR LOTE ══════════ -->
<div id="vistaCarga" class="container">
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

<!-- ══════════ VISTA: BUSCADOR INTERNO ══════════ -->
<div id="vistaInterno" class="vista-oculta">
  <div class="busqueda-form">
    <div class="form-group"><label>Fecha</label><input type="date" id="internoFecha"></div>
    <div class="form-group"><label>ID único</label><input type="text" id="internoIdUnico" placeholder="HODOS-000123"></div>
    <div class="form-group"><label>Nº Pedido</label><input type="text" id="internoNumeroPedido"></div>
    <div class="form-group"><label>Origen</label>
      <select id="internoOrigen">
        <option value="">Todos los orígenes</option>
        <option value="MECO">MECO</option>
        <option value="Valencia">Valencia</option>
        <option value="Torija">Torija</option>
        <option value="Antequera">Antequera</option>
        <option value="Taisa">Taisa</option>
      </select>
    </div>
    <div class="form-group"><label>Destino</label>
      <select id="internoDestino">
        <option value="">Todas las tiendas</option>
        <option value="Málaga">Málaga</option>
        <option value="Marbella">Marbella</option>
        <option value="Mijas">Mijas</option>
        <option value="Granada">Granada</option>
      </select>
    </div>
    <div class="form-group"><label>Estado</label>
      <select id="internoEstado">
        <option value="">Todos los estados</option>
        <option value="REGISTRADO">Registrado</option>
      </select>
    </div>
    <button onclick="buscarYMostrar('interno')">Buscar</button>
  </div>
  <div id="resultadosInterno"></div>
</div>

<!-- ══════════ VISTA: BUSCADOR TIENDA ══════════ -->
<div id="vistaTienda" class="vista-oculta">
  <h2 id="tituloTienda" style="margin-bottom:16px;"></h2>
  <div class="busqueda-form">
    <div class="form-group"><label>Fecha</label><input type="date" id="tiendaFecha"></div>
    <div class="form-group"><label>ID único</label><input type="text" id="tiendaIdUnico" placeholder="HODOS-000123"></div>
    <div class="form-group"><label>Nº Pedido</label><input type="text" id="tiendaNumeroPedido"></div>
    <button onclick="buscarYMostrar('tienda')">Buscar</button>
  </div>
  <div id="resultadosTienda"></div>
</div>

<script>
  var VISTA = '<?= vista ?>';
  var TIENDA_FILTRO = '<?= tiendaFiltro ?>';
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
    document.querySelectorAll('.tema-selector-compact button').forEach(function (b) { b.classList.remove('active'); });
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

  function formatearFecha(valor) {
    if (!valor) return '';
    var d = new Date(valor);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  function formatearFechaHora(valor) {
    if (!valor) return '';
    var d = new Date(valor);
    return formatearFecha(valor) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function renderizarResultados(contenedorId, resultados) {
    var cont = document.getElementById(contenedorId);
    if (!resultados || resultados.length === 0) {
      cont.innerHTML = '<p class="sin-resultados">Sin resultados.</p>';
      return;
    }
    var esInterno = contenedorId === 'resultadosInterno';
    var cabeceraExtra = esInterno ? '<th>Destino</th><th>Estado</th>' : '';
    var filas = resultados.map(function (r) {
      var soporte = r.soporteTotal > 1 ? (r.soporteNum + '/' + r.soporteTotal) : '—';
      var batea = r.bateaId ? ('Llegó: ' + formatearFechaHora(r.fechaEnvio)) : 'Pendiente';
      var extra = esInterno ? ('<td>' + r.destino + '</td><td>' + r.estado + '</td>') : '';
      return '<tr><td>' + r.numeroPedido + '</td><td>' + soporte + '</td><td>' + r.origenTexto + '</td>' + extra +
        '<td>' + r.idUnico + '</td><td>' + formatearFecha(r.fechaCreacion) + '</td>' +
        '<td class="' + (r.bateaId ? 'batea-ok' : 'batea-pendiente') + '">' + batea + '</td></tr>';
    }).join('');
    cont.innerHTML = '<table class="resultados-tabla"><thead><tr><th>Nº Pedido</th><th>Soporte</th><th>Origen</th>' +
      cabeceraExtra + '<th>ID único</th><th>Creado</th><th>Batea</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function buscarYMostrar(modo) {
    var filtros = {};
    if (modo === 'tienda') {
      filtros.destino = TIENDA_FILTRO;
      filtros.fecha = document.getElementById('tiendaFecha').value || undefined;
      filtros.idUnico = document.getElementById('tiendaIdUnico').value.trim() || undefined;
      filtros.numeroPedido = document.getElementById('tiendaNumeroPedido').value.trim() || undefined;
    } else {
      filtros.fecha = document.getElementById('internoFecha').value || undefined;
      filtros.idUnico = document.getElementById('internoIdUnico').value.trim() || undefined;
      filtros.numeroPedido = document.getElementById('internoNumeroPedido').value.trim() || undefined;
      filtros.origen = document.getElementById('internoOrigen').value || undefined;
      filtros.destino = document.getElementById('internoDestino').value || undefined;
      filtros.estado = document.getElementById('internoEstado').value || undefined;
    }
    gas('buscarEtiquetas', filtros).then(function (resultados) {
      renderizarResultados(modo === 'tienda' ? 'resultadosTienda' : 'resultadosInterno', resultados);
    });
  }

  function cambiarPestana(nombre) {
    document.getElementById('vistaCarga').classList.toggle('vista-oculta', nombre !== 'carga');
    document.getElementById('vistaInterno').classList.toggle('vista-oculta', nombre !== 'interno');
    document.querySelectorAll('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nombre); });
    if (nombre === 'interno') { buscarYMostrar('interno'); }
    if (nombre === 'carga') { cargarHistorial(); }
  }

  function iniciarVista() {
    var temaGuardado = localStorage.getItem('hodosTema');
    if (temaGuardado) {
      document.body.className = 'tema-' + temaGuardado;
      document.querySelectorAll('.tema-selector-compact button').forEach(function (b) {
        b.classList.toggle('active', b.classList.contains(temaGuardado));
      });
    }

    if (VISTA === 'tienda') {
      document.getElementById('tabBar').classList.add('vista-oculta');
      document.getElementById('vistaCarga').classList.add('vista-oculta');
      document.getElementById('vistaInterno').classList.add('vista-oculta');
      if (!TIENDA_FILTRO) {
        document.getElementById('avisoTiendaInvalida').classList.remove('vista-oculta');
        return;
      }
      document.getElementById('vistaTienda').classList.remove('vista-oculta');
      document.getElementById('tituloTienda').textContent = 'Buscador — ' + TIENDA_FILTRO;
      buscarYMostrar('tienda');
    } else {
      cambiarPestana(VISTA === 'interno' ? 'interno' : 'carga');
    }
  }

  iniciarVista();
</script>
</body>
</html>
```

- [ ] **Step 2: Push a Apps Script**

Run: `cd Desktop/Proyectos/hodos && clasp push -f`

---

## Task 4: Redesplegar y verificación manual (usuario, navegador real)

**Files:** ninguno (solo despliegue)

- [ ] **Step 1: Publicar nueva versión sobre el mismo deployment**

Run:
```bash
cd Desktop/Proyectos/hodos
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ --description "v3 - cabecera y buscadores"
```
(mismo deployment de siempre — comprobar con `clasp deployments` si hay duda; mantiene la
misma URL `/exec`.)

- [ ] **Step 2: Checklist de verificación (usuario, no automatizable)**

- [ ] Abrir la URL sin parámetros (`.../exec`) — debe verse la cabecera nueva (logo Taisa +
      "HODOS") y la pestaña "Cargar lote" activa por defecto, funcionando igual que antes.
- [ ] Cambiar a la pestaña "Buscar" — debe listar todos los pedidos registrados hasta
      ahora, con columnas Destino/Estado incluidas. Probar los filtros de origen/destino y
      confirmar que reducen los resultados correctamente.
- [ ] Abrir `.../exec?vista=tienda&tienda=Malaga` — debe verse **solo** el buscador,
      titulado "Buscador — Málaga", sin pestaña de carga, y los resultados ya deben venir
      filtrados a Málaga sin tener que buscar manualmente.
- [ ] Abrir `.../exec?vista=tienda` (sin `tienda`) — debe mostrar el aviso "Enlace no
      válido" en vez de una pantalla rota o datos de otra tienda.
- [ ] Confirmar que un pedido sin batea (todos, por ahora) muestra "Pendiente", y que los 3
      temas se aplican igual en las tres vistas.
- [ ] Borrar de la Sheet las filas de prueba `555001`/`555002`/`555003` de la Task 2.
