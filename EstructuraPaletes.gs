// EstructuraPaletes.gs — mappers y acceso a la tabla `palets` en Supabase (refill SIE,
// fusión con CartaPortesSIE). Mismo patrón que EstructuraCargas.gs: mapea a camelCase,
// usa los helpers genéricos de SupabaseCliente.gs, nada de UrlFetchApp aquí.
//
// `palets` es puramente aditiva: no toca `cargas`/`etiquetas`/`contenido`. Cada fila es
// un SSCC escaneado, ligado a una carga por `batea_id` (mismo nombre de columna que ya
// usa `etiquetas.batea_id`, por consistencia). No hay tabla "Borrador" separada — igual
// que `etiquetas` ya protege el escaneo escribiendo cada fila en el momento (no en un
// paso posterior), aquí cada palé se inserta al escanear, con encontrado=null hasta el
// cotejo. Eso ES la protección anti-pérdida: no hace falta una tabla puente aparte.

function filaPaleteDesdeSupabase_(f) {
  return {
    id: f.id,
    sscc: f.sscc,
    codigoLm: f.codigo_lm,
    seccion: f.seccion,
    // Código numérico de sección (1-13), DISTINTO de `seccion` (nombre legible del
    // departamento, p.ej. "CARPINTERIA Y MADERA" — el que se enseña en el informe de
    // cierre). `codSeccion` es el que se usa para sumar en la columna correcta del B2B
    // externo de Leroy Merlin (bug real 2026-09-24: antes se intentaba sacar un número
    // del NOMBRE del departamento con una regex, y desde que el CSV de inventario trae
    // nombres en vez de números no encontraba ninguno — la fuente real del número
    // siempre estuvo disponible en Cod_Seccion/departmentCode, solo no se leía).
    codSeccion: f.cod_seccion,
    encontrado: f.encontrado,
    bateaId: f.batea_id,
    creadoPor: f.creado_por,
    fechaCreacion: f.fecha_creacion
  };
}

function filaPaleteHaciaSupabase_(obj) {
  var fila = {};
  if (obj.sscc !== undefined) fila.sscc = obj.sscc;
  if (obj.codigoLm !== undefined) fila.codigo_lm = obj.codigoLm;
  if (obj.seccion !== undefined) fila.seccion = obj.seccion;
  if (obj.codSeccion !== undefined) fila.cod_seccion = obj.codSeccion;
  if (obj.encontrado !== undefined) fila.encontrado = obj.encontrado;
  if (obj.bateaId !== undefined) fila.batea_id = obj.bateaId;
  if (obj.creadoPor !== undefined) fila.creado_por = obj.creadoPor;
  return fila;
}

function insertarPalet_(bateaId, sscc, creadoPor) {
  var fila = filaPaleteHaciaSupabase_({ sscc: sscc, bateaId: bateaId, creadoPor: creadoPor, encontrado: null });
  var insertadas = supaInsertar_('palets', [fila]);
  if (insertadas.length === 0) throw new Error('insertarPalet_: Supabase no devolvió la fila insertada');
  return filaPaleteDesdeSupabase_(insertadas[0]);
}

function leerPaletesPorCarga_(idCarga) {
  return supaGet_('palets', 'batea_id=eq.' + encodeURIComponent(idCarga) + '&order=fecha_creacion.asc').map(filaPaleteDesdeSupabase_);
}

// Wrapper público para Index.html — al reabrir una carga ya empezada, recupera los
// SSCC ya escaneados (igual que obtenerCarga ya hace con los pedidos vía escaneados).
function obtenerPaletesCarga(idCarga) {
  return leerPaletesPorCarga_(idCarga).map(function (p) { return p.sscc; });
}

// Quitar un palet SIE mal escaneado de la carga actual. Sin equivalente a "REGISTRADO"
// (un palet es solo un registro de escaneo, no un pedido con vida propia), así que a
// diferencia de quitarSoporteDeCarga (Backend.gs) aquí sí se borra la fila entera —
// volver a escanear el mismo SSCC (en esta u otra carga) simplemente crea una nueva.
function quitarPaletDeCarga(idCarga, sscc) {
  var carga = obtenerCargaCacheada_(idCarga);
  if (carga.estado !== 'ABIERTA') throw new Error('Esta carga ya está cerrada');
  var coincidencias = leerPaletesPorCarga_(idCarga).filter(function (p) { return p.sscc === sscc; });
  if (coincidencias.length === 0) throw new Error('No se encontró ese palet en esta carga');
  coincidencias.forEach(function (p) { borrarPalet_(p.id); });
  return { ok: true };
}

function actualizarPalet_(id, cambios) {
  var actualizadas = supaActualizar_('palets', 'id=eq.' + encodeURIComponent(id), filaPaleteHaciaSupabase_(cambios));
  if (actualizadas.length === 0) throw new Error('actualizarPalet_: no se encontró el palet ' + id);
  return filaPaleteDesdeSupabase_(actualizadas[0]);
}

function borrarPalet_(id) {
  supaBorrar_('palets', 'id=eq.' + encodeURIComponent(id));
}

// Reemplaza a la hoja "Resumen Diario" de CartaPortesSIE: en vez de una agregación que
// se va sumando en una fila por día+tienda, se consulta directo — reutiliza leerCargas_
// (ya existe, EstructuraCargas.gs) para encontrar las cargas de esa tienda+fecha, y trae
// los palets de todas ellas de una sola vez.
function leerPaletesPorTiendaFecha_(destino, fecha) {
  var cargas = leerCargas_('destino=eq.' + encodeURIComponent(destino) + '&fecha_entrega=eq.' + encodeURIComponent(fecha));
  if (cargas.length === 0) return [];
  var ids = cargas.map(function (c) { return c.idCarga; });
  return supaGet_('palets', 'batea_id=in.(' + ids.map(encodeURIComponent).join(',') + ')').map(filaPaleteDesdeSupabase_);
}

// ── Buscador de refill (2026-10-19): SOLO LECTURA ───────────────────────────────────────────────────────────
// Busca palets SIE por SSCC y/o código LM («contiene», para poder teclear solo el final) y dice en qué punto está
// cada uno según su carga. No abre ni cambia nada: es el camino para mirar un refill sin reabrir su carga.
// `filtros` = { sscc, codigoLm, destino }: con `destino` (la vista de una tienda) solo salen los refill de esa tienda.
var MAX_RESULTADOS_REFILL_ = 50;
var MIN_CARACTERES_REFILL_ = 4;
var COLUMNAS_PALET_REFILL_ = 'id,sscc,codigo_lm,seccion,encontrado,batea_id,fecha_creacion';
var COLUMNAS_CARGA_REFILL_ = 'id_carga,destino,fecha_entrega,horario,estado,cargador,reabierta_en,fecha_creacion';

function buscarRefill(filtros) {
  filtros = filtros || {};
  var sscc = normalizarSsccBusqueda_(filtros.sscc);
  var codigoLm = normalizarCodigoLmBusqueda_(filtros.codigoLm);
  if (!sscc && !codigoLm) throw new Error('Escribe un SSCC o un código LM para buscar el refill.');
  if (sscc && sscc.length < MIN_CARACTERES_REFILL_) throw new Error('El SSCC necesita al menos ' + MIN_CARACTERES_REFILL_ + ' dígitos.');
  if (codigoLm && codigoLm.length < MIN_CARACTERES_REFILL_) throw new Error('El código LM necesita al menos ' + MIN_CARACTERES_REFILL_ + ' caracteres.');

  // Desde la vista de una tienda se busca solo entre SUS refill: el filtro va en la consulta (palets.batea_id enlaza con
  // cargas.id_carga), no después, para que el límite de 50 cuente solo los de esa tienda. Una tienda que no es del circuito
  // es un error: nunca se cae a buscar en todas.
  var destino = String(filtros.destino == null ? '' : filtros.destino).trim();
  if (destino && validarTienda(destino) === '') throw new Error('Tienda no válida.');

  var partes = [];
  if (sscc) partes.push('sscc=ilike.' + encodeURIComponent('*' + sscc + '*'));
  if (codigoLm) partes.push('codigo_lm=ilike.' + encodeURIComponent('*' + codigoLm + '*'));
  if (destino) partes.push('cargas.destino=eq.' + encodeURIComponent(destino));
  partes.push('order=fecha_creacion.desc,id.desc');
  partes.push('limit=' + (MAX_RESULTADOS_REFILL_ + 1)); // uno de más: así se sabe si hay más de los que se enseñan
  var palets = supaGet_('palets', partes.join('&'), destino ? COLUMNAS_PALET_REFILL_ + ',cargas!inner(destino)' : COLUMNAS_PALET_REFILL_).map(filaPaleteDesdeSupabase_);
  var hayMas = palets.length > MAX_RESULTADOS_REFILL_;
  if (hayMas) palets = palets.slice(0, MAX_RESULTADOS_REFILL_);

  // Las cargas de esos palets, en trozos por el límite de 2 KB de la URL de UrlFetchApp.
  var idsCarga = distintosTexto_(palets.map(function (p) { return p.bateaId; }));
  var cargas = {};
  for (var i = 0; i < idsCarga.length; i += LOTE_IDS_CARGAS_) {
    var trozo = idsCarga.slice(i, i + LOTE_IDS_CARGAS_);
    leerCargas_('id_carga=in.(' + trozo.map(function (id) { return encodeURIComponent(id); }).join(',') + ')', COLUMNAS_CARGA_REFILL_).forEach(function (c) { cargas[c.idCarga] = c; });
  }

  // «Solicitado por» de Kairos, igual que en el informe de cierre (si Kairos no lo tiene, queda vacío).
  var porDestino = {};
  palets.forEach(function (p) {
    var c = cargas[p.bateaId];
    if (c) (porDestino[c.destino] = porDestino[c.destino] || []).push(p.sscc);
  });
  var solicitantes = {};
  Object.keys(porDestino).forEach(function (destino) {
    var mapa = _solicitantesPorSscc_(destino, porDestino[destino]);
    Object.keys(mapa).forEach(function (s) { solicitantes[destino + '|' + s] = mapa[s]; });
  });

  var ahora = Date.now();
  return {
    hayMas: hayMas,
    resultados: palets.map(function (p) {
      var c = cargas[p.bateaId] || null;
      var estado = estadoRefill_(c, ahora);
      var sol = c ? solicitantes[c.destino + '|' + p.sscc] : null;
      var llegadaMs = c ? fechaLlegadaCarga_(c.fechaEntrega, c.horario) : null;
      return {
        sscc: p.sscc,
        codigoLm: p.codigoLm || '',
        seccion: p.seccion || '',
        cotejo: p.encontrado === true ? 'COINCIDE' : (p.encontrado === false ? 'NO_ENCONTRADO' : 'SIN_COTEJAR'),
        escaneadoEn: fechaComoTexto(p.fechaCreacion),
        idCarga: p.bateaId || '',
        destino: c ? c.destino : '',
        fechaEntrega: c ? fechaComoTexto(c.fechaEntrega) : '',
        horario: c ? (c.horario || '') : '',
        llegadaEn: llegadaMs == null ? '' : new Date(llegadaMs).toISOString(), // instante UTC de la llegada prevista
        cargaEmpezadaEn: c ? fechaComoTexto(c.fechaCreacion) : '',
        estado: estado.codigo,
        estadoTexto: estado.texto,
        cargador: c && c.cargador ? c.cargador : '',
        solicitadoPor: sol ? { ldap: sol.ldap || '', motivo: sol.motivo || '' } : null
      };
    })
  };
}

// Llamado desde la rama residual de escanearSoporte (Backend.gs) cuando el valor
// escaneado no coincide con ningún soporte de pedido cliente y tiene forma de SSCC.
// Forma de respuesta distinta a la de un soporte (tipo:'palet') para que Index.html
// pueda renderizar el feedback correcto sin ambigüedad.
function escanearPaletSSCC_(idCarga, valorEscaneado) {
  // Sin esta comprobación, reintentar el mismo SSCC (p.ej. porque la pantalla no
  // confirmaba visualmente el escaneo anterior) crea una fila duplicada por cada
  // intento — a diferencia de los pedidos, que ya rechazan el reintento (YA_ESCANEADO).
  //
  // Bug real (2026-09-23, revisión de seguridad): leer+comprobar+insertar sin lock es
  // check-then-act — dos escaneos casi simultáneos del mismo SSCC (doble tap real en
  // una pantalla lenta, la misma razón por la que existe esta comprobación) podían
  // pasar ambos el filtro de "no existe todavía" y crear dos filas duplicadas (sin
  // UNIQUE en `sscc` a nivel de Supabase), duplicando el palet en el informe de cierre
  // y en el conteo por sección que se escribe en el B2B externo de Leroy Merlin. A
  // diferencia de obtenerOCrearCarga (una vez por camión), un escaneo de palé puede
  // repetirse varias veces seguidas en la misma carga — LockService.getScriptLock()
  // aquí sigue siendo barato (no es por-cada-pedido como escanearSoporte) y cierra la
  // ventana del todo.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var existentes = leerPaletesPorCarga_(idCarga);
    var yaEscaneado = existentes.filter(function (p) { return p.sscc === valorEscaneado; })[0];
    if (yaEscaneado) return { ok: true, tipo: 'palet', sscc: yaEscaneado.sscc, repetido: true };

    var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
    var palet = insertarPalet_(idCarga, valorEscaneado, creadoPor);
    return { ok: true, tipo: 'palet', sscc: palet.sscc };
  } finally {
    lock.releaseLock();
  }
}

// ── Detección de SSCC (rama residual de escanearSoporte, Backend.gs) ────────────────
//
// Gate de colisión ejecutado contra producción (2026-09-15, 4260 etiquetas reales):
// solo 1 numero_pedido tenía forma "18-20 dígitos" (030176010452797723, ya EN_RUTA).
// Esa fila nunca puede alcanzar la rama residual: mientras exista en `etiquetas`,
// escanearSoporte siempre la encuentra por el camino normal (YA_ESCANEADO), así que
// jamás llega a NO_ENCONTRADO. La validación de dígito de control GS1 de aquí abajo es
// una defensa extra (reduce further el margen para un futuro numero_pedido de esa forma),
// no la única barrera.
function esFormatoSSCC_(valor) {
  var s = String(valor || '').trim();
  if (/^[0-9]{20}$/.test(s) && s.substring(0, 2) === '00') s = s.substring(2); // quita AI "00" de GS1-128
  if (!/^[0-9]{18}$/.test(s)) return false;

  var suma = 0;
  for (var i = 0; i < 17; i++) {
    var peso = ((16 - i) % 2 === 0) ? 3 : 1; // dígito más a la derecha de los 17 (índice 16) pesa 3
    suma += peso * Number(s.charAt(i));
  }
  var digitoControl = (10 - (suma % 10)) % 10;
  return digitoControl === Number(s.charAt(17));
}
