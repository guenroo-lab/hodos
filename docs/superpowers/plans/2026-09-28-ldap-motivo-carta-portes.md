# LDAP + motivo de Kairos en la Carta de Portes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar LDAP + motivo del solicitante de Kairos en la Carta de
Portes de HODOS (pedidos y palets refill), sin tocar Kairos.

**Architecture:** `SupabaseCliente.gs` gana lectura multi-esquema
(`Accept-Profile`). Archivo nuevo `SolicitantesKairos.gs` hace el cruce
de solo lectura contra `preparacion.*`, con degradación silenciosa a
"—" ante cualquier fallo. `ReporteCarga.gs` añade una columna con esos
datos a las dos tablas del informe.

**Tech Stack:** Google Apps Script (V8), Supabase Postgres (cross-schema
`public`↔`preparacion`, mismo proyecto), `clasp`.

**Spec:** `docs/superpowers/specs/2026-09-28-ldap-motivo-carta-portes-design.md`

**Nota de proceso:** sin test runner en este proyecto — verificación por
(a) `node -e "new Function(...)"` por archivo antes de cada push, (b)
**revisión de Codex CLI** sobre el código nuevo antes de desplegar (el
usuario lo pidió explícitamente; además es el patrón ya establecido en
este ecosistema — ver comentarios "revisión con Codex CLI" en
`kairos-operario/StockAsignacion.js`), (c) verificación manual E2E tras
desplegar. Directo sobre `main`, sin rama nueva (mismo estilo que el
resto de la sesión).

---

### Task 1: `SupabaseCliente.gs` — soporte multi-esquema

**Files:**
- Modify: `hodos/SupabaseCliente.gs:19-21` (`supaCabeceras_`)
- Modify: `hodos/SupabaseCliente.gs:34-104` (`supaGet_`)

- [ ] **Step 1: Añadir parámetro `schema` a `supaCabeceras_`**

```js
function supaCabeceras_(schema) {
  var cfg = supaConfig_();
  var h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
  if (schema) h['Accept-Profile'] = schema;
  return h;
}
```

- [ ] **Step 2: Añadir parámetro `schema` a `supaGet_`, pasarlo a las 2 llamadas a `supaCabeceras_()` que ya tiene la función**

No cambia nada más de la lógica de paginación — solo sustituir las dos
llamadas `supaCabeceras_()` por `supaCabeceras_(schema)` y añadir
`schema` a la firma: `function supaGet_(tabla, filtroPostgrest, columnas, schema) {`.

- [ ] **Step 3: Verificar sintaxis**

```bash
node -e "new Function(require('fs').readFileSync('hodos/SupabaseCliente.gs','utf8')); console.log('OK sintaxis')"
```

- [ ] **Step 4: Comprobación de no-regresión**

`grep -n "supaGet_(" hodos/*.gs` — confirmar que ninguna llamada
existente pasa ya un 4º argumento por posición (si alguna lo hiciera,
este cambio la rompería). Con la spec actual no debería haber ninguna,
pero se verifica contra el código real antes de continuar, no se asume.

- [ ] **Step 5: Commit**

```bash
git add hodos/SupabaseCliente.gs
git commit -m "feat(hodos): soporte multi-esquema en supaGet_ (Accept-Profile)"
```

---

### Task 2: `SolicitantesKairos.gs` — cruce de solo lectura

**Files:**
- Create: `hodos/SolicitantesKairos.gs`

- [ ] **Step 1: Escribir el archivo**

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

- [ ] **Step 2: Verificar sintaxis**

```bash
node -e "new Function(require('fs').readFileSync('hodos/SolicitantesKairos.gs','utf8')); console.log('OK sintaxis')"
```

- [ ] **Step 3: Prueba de humo aislada (Node, sin desplegar)**

Simular `_bareSscc_` y `_textoSolicitante_` contra los formatos reales
de Kairos antes de dar el archivo por bueno:

```bash
node -e "
const code = require('fs').readFileSync('hodos/SolicitantesKairos.gs','utf8');
const fn = new Function(code + '; return {_bareSscc_, _textoSolicitante_};')();
console.log(fn._bareSscc_('ABC123 (5ud)'));
console.log(fn._bareSscc_('ABC123 (3ud) + DEF456 (2ud)'));
console.log(fn._textoSolicitante_({tipo:'refill', solicitanteLdap:'12345', motivo:'reposicion', comentario:null}));
console.log(fn._textoSolicitante_({tipo:'pedido_cliente', solicitanteLdap:'12345', motivo:null, comentario:'urgente'}));
"
```

Esperado: `['ABC123']`, `['ABC123','DEF456']`, `{ldap:'12345',motivo:'reposicion'}`, `{ldap:'12345',motivo:'urgente'}`.

- [ ] **Step 4: Commit**

```bash
git add hodos/SolicitantesKairos.gs
git commit -m "feat(hodos): cruce de solicitante LDAP/motivo contra preparacion.* de Kairos"
```

---

### Task 3: `ReporteCarga.gs` — columna nueva en el informe

**Files:**
- Modify: `hodos/ReporteCarga.gs` (`htmlInformeCarga`)

- [ ] **Step 1: Calcular los mapas de solicitantes**

Justo después de `var palets = leerPaletesPorCarga_(idCarga);` (línea 17):

```js
var solicitantesPedidos = _solicitantesPorIdUnico_(carga.escaneados.map(function (e) { return e.idUnico; }));
var solicitantesPalets = _solicitantesPorSscc_(carga.destino, palets.map(function (p) { return p.sscc; }));
```

- [ ] **Step 2: Columna en la tabla de pedidos**

Dentro del `.map` que construye `filas` (línea 19-35), añadir antes del
`return`:

```js
var sol = solicitantesPedidos[e.idUnico];
var solHtml = '<td style="padding:8px 12px;font-size:10px;color:#666;border-bottom:1px solid #eee;">' +
  (sol ? '<b>' + esc_(sol.ldap) + '</b>' + (sol.motivo ? '<br><span style="color:#999;">' + esc_(sol.motivo) + '</span>' : '') : '—') +
  '</td>';
```

y añadir `+ solHtml` justo antes del `+ '</tr>';` final de esa fila.
Cabecera: añadir `<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">SOLICITADO POR</th>` al final de la fila de `<th>` de la tabla de pedidos (línea ~117-121).

- [ ] **Step 3: Columna en la tabla de palets refill**

Mismo patrón dentro de `filasSie` (línea 62-73):

```js
var sol = solicitantesPalets[p.sscc];
var solHtml = '<td style="padding:8px 12px;font-size:10px;color:#666;border-bottom:1px solid #eee;">' +
  (sol ? '<b>' + esc_(sol.ldap) + '</b>' + (sol.motivo ? '<br><span style="color:#999;">' + esc_(sol.motivo) + '</span>' : '') : '—') +
  '</td>';
```

añadir `+ solHtml` antes del `+ '</tr>';`, y `<th>SOLICITADO POR</th>` a
la cabecera de esa tabla (línea ~81-84).

- [ ] **Step 4: Verificar sintaxis**

```bash
node -e "new Function(require('fs').readFileSync('hodos/ReporteCarga.gs','utf8')); console.log('OK sintaxis')"
```

- [ ] **Step 5: Commit**

```bash
git add hodos/ReporteCarga.gs
git commit -m "feat(hodos): columna Solicitado por (LDAP+motivo) en la Carta de Portes"
```

---

### Task 4: Revisión de Codex CLI

**Pedido explícito del usuario** — antes de desplegar, pasar por Codex
el código nuevo/modificado de las Tasks 1-3
(`SupabaseCliente.gs`, `SolicitantesKairos.gs`, `ReporteCarga.gs`).

- [ ] **Step 1: Comprobar que Codex CLI está listo**

Usar el skill `codex:setup` para verificar el estado (equivalente a
`codex --version`/login) antes de pedir la revisión.

- [ ] **Step 2: Ejecutar la revisión**

Usar el skill `codex:rescue` (agente `codex:codex-rescue`) pidiendo
explícitamente una revisión de código (no una implementación) sobre los
3 archivos de este plan, con foco en:
- Inyección/escape en el filtro `in.(...)` de PostgREST (los `idUnico`/
  `peticion_id` van por `encodeURIComponent`, pero conviene que Codex
  confirme que no hay forma de que un `idUnico` con `,` o `)` rompa el
  filtro).
- Concurrencia/seguridad del nuevo `Accept-Profile` (¿algún otro sitio
  del proyecto podría verse afectado por pasar `schema` por posición?).
- Que la degradación a "—" cubre de verdad TODOS los fallos posibles
  (Supabase caído, columna inesperada, `peticiones!inner` sin filas)
  sin dejar pasar una excepción no capturada hacia `htmlInformeCarga`.

- [ ] **Step 3: Aplicar lo que Codex encuentre**

Si Codex señala algo real, corregirlo en los archivos de las Tasks 1-3,
repetir verificación de sintaxis (Node) del archivo tocado, y commitear
el fix por separado (`fix(hodos): <lo que corrija>`, con crédito a la
revisión en el mensaje, mismo estilo que los comentarios ya existentes
"revisión con Codex CLI" en `StockAsignacion.js`).

---

### Task 5: Push, deploy y verificación E2E

**Files:** ninguno nuevo — despliegue de lo ya committeado.

- [ ] **Step 1: Push**

```bash
cd hodos
clasp push --force
```

- [ ] **Step 2: Deploy a producción**

```bash
clasp deploy -i AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ -d "feat: LDAP+motivo de Kairos en la Carta de Portes"
```

- [ ] **Step 3: Verificación manual E2E**

1. Cerrar (o reabrir) una carga real de Marbella/Mijas con pedidos
   cliente creados desde Kairos: confirmar LDAP+comentario en la
   columna nueva.
2. Misma carga con líneas de refill: confirmar LDAP+motivo correctos
   por SSCC.
3. Soporte de otro origen (MECO) en la misma carga: confirmar "—", sin
   romper el resto del documento.
4. Carga de Málaga/Granada (si hay alguna con palets, caso raro):
   confirmar que no lanza error.

- [ ] **Step 4: Commit final si hubo ajustes post-verificación**

Solo si la verificación E2E revela algo que corregir — si todo sale
bien a la primera, no hay nada que commitear aquí.

---

### Task 6: Cierre

- [ ] **Step 1: Actualizar memoria del proyecto**

Añadir a `hodos-app-cargas-etiquetas` (memoria) que la Carta de Portes
ahora muestra LDAP+motivo de las peticiones Kairos, con fecha y
referencia a este plan.

- [ ] **Step 2: `superpowers:finishing-a-development-branch`**

Repo normal, sin worktree — directo sobre `main`, mismo estilo que el
resto de la sesión. Confirmar con el usuario si esto se queda tal cual
en `main` (ya commiteado por tasks) o prefiere PR.
