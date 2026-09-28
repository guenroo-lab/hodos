# LDAP + motivo de Kairos en la Carta de Portes — Design

## Contexto

CartaPortesSIE ya no se usa (confirmado por el usuario): refill y pedido
cliente/cesión se cargan hoy enteros por HODOS (`htmlInformeCarga`, mismo
documento de cierre de carga). El usuario quiere que ese documento
también muestre, por cada línea, **quién la pidió (LDAP) y por qué
(motivo)** — dato que hoy vive en Kairos, no en HODOS.

Precedente directo a tener en cuenta: 2026-09-15 se construyó y hubo que
revertir un puente Kairos↔CartaPortesSIE por asumir una relación sin
confirmar. Esta vez la relación la pide el usuario explícitamente y está
verificada contra datos reales (no asumida):

- `preparacion.peticiones` ya tiene `solicitante_ldap`, `motivo` (relleno
  en refill) y `comentario` (relleno en pedido_cliente/cesión).
- Pedido cliente/cesión → `etiquetas.id_unico` = `preparacion.lineas.hodos_id`
  → `lineas.peticion_id` → `peticiones` (mismo hilo que ya usa Pieza 3 de
  Kairos para disparar la etiqueta).
- Refill → por SSCC: `preparacion.lineas.sscc` (formato `"sscc (Xud)"` o
  `"sscc1 (Xud) + sscc2 (Yud)"`, tras el fix de Kairos Pieza 13) vs
  `public.palets.sscc` (el que se escanea en el muelle al cerrar la
  carga). Mismo SSCC físico en las dos tablas.
- **Gap real a cerrar primero**: `hodos/SupabaseCliente.gs` no tiene
  soporte multi-esquema — siempre pega contra `public` (sin cabecera
  `Accept-Profile`), así que no puede leer `preparacion.*` todavía.
  `kairos-portal/Supabase.js` ya resuelve esto igual en sentido
  contrario (`Accept-Profile: <schema>`, parámetro opcional) — se copia
  el mismo patrón.

## Objetivo

En `hodos/ReporteCarga.gs` (`htmlInformeCarga`), añadir una columna
**"Solicitado por"** (LDAP + motivo) a la tabla de pedidos y a la de
palets refill, cruzando contra `preparacion.*` de Kairos. Sin match
(petición de otro origen: MECO, cesión manual antigua, etc.) → columna
vacía, nunca error ni bloqueo del documento.

No se toca `htmlPendientesTienda` (documento distinto, no pedido).

## Cambios

### 1. `hodos/SupabaseCliente.gs` — soporte multi-esquema

`supaGet_` gana un 5º parámetro opcional `schema` (default `'public'`,
comportamiento actual sin cambio si no se pasa). `supaCabeceras_` gana
un parámetro opcional del mismo tipo:

```js
function supaCabeceras_(schema) {
  var cfg = supaConfig_();
  var h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
  if (schema) h['Accept-Profile'] = schema;
  return h;
}

function supaGet_(tabla, filtroPostgrest, columnas, schema) {
  var cfg = supaConfig_();
  var select = 'select=' + (columnas || '*');
  var filtro = filtroPostgrest || '';

  if (/(^|&)limit=/.test(filtro)) {
    var urlAcotada = cfg.url + '/rest/v1/' + tabla + '?' + select + (filtro ? '&' + filtro : '');
    var respAcotada = UrlFetchApp.fetch(urlAcotada, { method: 'get', headers: supaCabeceras_(schema), muteHttpExceptions: true });
    if (respAcotada.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + respAcotada.getContentText());
    return JSON.parse(respAcotada.getContentText());
  }

  var url = cfg.url + '/rest/v1/' + tabla + '?' + select + (filtro ? '&' + filtro : '');
  var todas = [];
  var desde = 0;
  while (true) {
    var cabeceras = supaCabeceras_(schema);
    cabeceras.Range = desde + '-' + (desde + SUPA_PAGE_SIZE_ - 1);
    cabeceras.Prefer = 'count=exact';
    var resp = UrlFetchApp.fetch(url, { method: 'get', headers: cabeceras, muteHttpExceptions: true });
    if (resp.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + resp.getContentText());
    var pagina = JSON.parse(resp.getContentText());
    todas = todas.concat(pagina);
    if (pagina.length === 0) break;
    var cabecerasResp = resp.getHeaders ? resp.getHeaders() : {};
    var contentRange = cabecerasResp['Content-Range'] || cabecerasResp['content-range'] || '';
    var totalConocido = /\/(\d+)$/.exec(contentRange);
    if (totalConocido) { if (todas.length >= Number(totalConocido[1])) break; }
    else if (pagina.length < SUPA_PAGE_SIZE_) { break; }
    desde += pagina.length;
  }
  return todas;
}
```

(Resto de `supaGet_` sin cambios — solo se añade el parámetro y se pasa
a `supaCabeceras_`. `supaInsertar_`/`supaActualizar_`/`supaBorrar_` no
lo necesitan para esta pieza, no se tocan.)

### 2. `hodos/ReporteCarga.gs` — cruce con Kairos

Archivo nuevo `hodos/SolicitantesKairos.gs` (aislado, no mezcla lógica
de render con lógica de cruce — mismo criterio de separación que ya usa
el proyecto entre `Backend.gs`/`EstructuraPaletes.gs`/`ReporteCarga.gs`):

```js
// SolicitantesKairos.gs — cruce de solo lectura contra el esquema
// `preparacion` de Kairos (mismo proyecto Supabase) para mostrar quién
// pidió cada soporte/palet en la Carta de Portes. Aditivo: si algo falla
// o no hay match, se degrada a "—", nunca rompe el documento.

var TIENDA_KAIROS_POR_NOMBRE_ = { 'Marbella': '014', 'Mijas': '279' };

function _bareSscc_(valorSscc) {
  return String(valorSscc || '').split(' + ').map(function (parte) {
    var m = parte.trim().match(/^(.+?)\s*\(/);
    return m ? m[1].trim() : parte.trim();
  });
}

function _textoSolicitante_(peticion) {
  if (!peticion) return null;
  var motivo = peticion.tipo === 'refill' ? peticion.motivo : peticion.comentario;
  return { ldap: peticion.solicitanteLdap, motivo: motivo || null };
}

/** idsUnico: array de etiquetas.id_unico de esta carga.
 *  Devuelve mapa idUnico -> {ldap, motivo} (ausente si no hay match). */
function _solicitantesPorIdUnico_(idsUnico) {
  if (!idsUnico.length) return {};
  try {
    var lineas = supaGet_('lineas', 'hodos_id=in.(' + idsUnico.map(encodeURIComponent).join(',') + ')',
      'hodos_id,peticion_id', 'preparacion');
    if (!lineas.length) return {};
    var idsPeticion = lineas.map(function (l) { return l.peticion_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var peticiones = supaGet_('peticiones', 'id=in.(' + idsPeticion.map(encodeURIComponent).join(',') + ')',
      'id,tipo,solicitante_ldap,motivo,comentario', 'preparacion');
    var porPeticion = {};
    peticiones.forEach(function (p) {
      porPeticion[p.id] = _textoSolicitante_({ tipo: p.tipo, solicitanteLdap: p.solicitante_ldap, motivo: p.motivo, comentario: p.comentario });
    });
    var mapa = {};
    lineas.forEach(function (l) { if (porPeticion[l.peticion_id]) mapa[l.hodos_id] = porPeticion[l.peticion_id]; });
    return mapa;
  } catch (err) {
    Logger.log('AVISO: no se pudo cruzar solicitantes Kairos (pedidos): ' + err);
    return {};
  }
}

/** destino: carga.destino (nombre de tienda HODOS, p.ej. "Marbella").
 *  ssccList: array de public.palets.sscc de esta carga.
 *  Devuelve mapa sscc -> {ldap, motivo}. Sin match si la tienda no es de
 *  Kairos (Málaga/Granada no tienen refill Kairos hoy) o no hay palets. */
function _solicitantesPorSscc_(destino, ssccList) {
  var tienda = TIENDA_KAIROS_POR_NOMBRE_[destino];
  if (!tienda || !ssccList.length) return {};
  try {
    var lineas = supaGet_('lineas',
      'sscc=not.is.null&peticiones.tipo=eq.refill&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) +
      '&select=sscc,peticion_id,peticiones!inner(tienda_origen,tipo)',
      null, 'preparacion');
    if (!lineas.length) return {};
    var idsPeticion = lineas.map(function (l) { return l.peticion_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var peticiones = supaGet_('peticiones', 'id=in.(' + idsPeticion.map(encodeURIComponent).join(',') + ')',
      'id,tipo,solicitante_ldap,motivo,comentario', 'preparacion');
    var porPeticion = {};
    peticiones.forEach(function (p) {
      porPeticion[p.id] = _textoSolicitante_({ tipo: p.tipo, solicitanteLdap: p.solicitante_ldap, motivo: p.motivo, comentario: p.comentario });
    });
    var porBareSscc = {};
    lineas.forEach(function (l) {
      var info = porPeticion[l.peticion_id];
      if (!info) return;
      _bareSscc_(l.sscc).forEach(function (bare) { porBareSscc[bare] = info; });
    });
    var mapa = {};
    ssccList.forEach(function (s) { if (porBareSscc[s]) mapa[s] = porBareSscc[s]; });
    return mapa;
  } catch (err) {
    Logger.log('AVISO: no se pudo cruzar solicitantes Kairos (refill): ' + err);
    return {};
  }
}
```

`htmlInformeCarga` (`ReporteCarga.gs`): calcular los dos mapas justo
después de `var palets = leerPaletesPorCarga_(idCarga);`:

```js
var solicitantesPedidos = _solicitantesPorIdUnico_(carga.escaneados.map(function (e) { return e.idUnico; }));
var solicitantesPalets = _solicitantesPorSscc_(carga.destino, palets.map(function (p) { return p.sscc; }));
```

Columna nueva en la tabla de pedidos (celda por fila, dentro del
`.map` que construye `filas`):

```js
var sol = solicitantesPedidos[e.idUnico];
var solHtml = '<td style="padding:8px 12px;font-size:10px;color:#666;border-bottom:1px solid #eee;">' +
  (sol ? '<b>' + esc_(sol.ldap) + '</b>' + (sol.motivo ? '<br><span style="color:#999;">' + esc_(sol.motivo) + '</span>' : '') : '—') +
  '</td>';
```

(se añade `+ solHtml` al final de la fila, y `<th>...SOLICITADO POR</th>`
a la cabecera de esa tabla). Misma idea en la tabla de palets, con
`solicitantesPalets[p.sscc]`.

### 3. Casos sin match — nunca error

- Petición de otro origen (MECO, alta manual): sin fila en `lineas` con
  ese `hodos_id` → columna "—".
- Carta de Portes de Málaga/Granada: `_solicitantesPorSscc_` devuelve
  `{}` de inmediato (tienda no está en `TIENDA_KAIROS_POR_NOMBRE_`) —
  cero llamadas a Supabase de más.
- Fallo de red/Supabase al cruzar: `catch` interno, log de aviso,
  documento se genera igual sin esa columna rellena — nunca bloquea el
  cierre de carga.

## Testing (manual E2E)

1. Cerrar una carga real de Marbella/Mijas con pedidos cliente creados
   desde Kairos: confirmar LDAP+comentario correctos en la columna
   nueva.
2. Misma carga con líneas de refill: confirmar LDAP+motivo correctos,
   cruzando por SSCC.
3. Carga con algún soporte de otro origen (MECO): confirmar que esa fila
   sale con "—", sin romper el resto del documento.
4. Carga de Málaga o Granada: confirmar que la tabla de palets (si
   tuviera alguno, caso raro) no intenta cruzar contra Kairos y no
   lanza error.
5. Forzar un fallo simulado (p.ej. cortar temporalmente el acceso)
   para confirmar que el documento se genera igual, sin la columna,
   en vez de romper el cierre de carga.

## Fuera de alcance

- `htmlPendientesTienda` no se toca.
- No se cambia nada en Kairos — todos los campos que se leen
  (`solicitante_ldap`, `motivo`, `comentario`, `sscc`, `hodos_id`) ya
  existen tal cual.
