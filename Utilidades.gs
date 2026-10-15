// Utilidades.gs — funciones puras, sin dependencias de servicios de Google.

function parsearLotePedidos(textoPegado) {
  if (!textoPegado) return [];
  return textoPegado
    .split('\n')
    .map(function (linea) { return linea.trim(); })
    .filter(function (linea) { return linea.length > 0; });
}

// Valores únicos (como texto) de una lista, sin vacíos/null/undefined — para armar listas
// `in.(...)` de ids sin repetir (Fase 2 del recorte de egress, 2026-10-06).
function distintosTexto_(valores) {
  var vistos = {};
  var out = [];
  (valores || []).forEach(function (v) {
    if (v === null || v === undefined || v === '') return;
    var k = String(v);
    if (!vistos[k]) { vistos[k] = true; out.push(k); }
  });
  return out;
}

function formatearOrigenTexto(origen, detalle) {
  // "detalle" es el subtipo cuando origen es Taisa, o la tienda de origen cuando
  // origen es Cesión (transferencia entre tiendas del circuito) — mismo parámetro,
  // significado distinto según el origen.
  if (origen === 'Taisa' || origen === 'Cesión') {
    return origen.toUpperCase() + ' - ' + String(detalle || '').toUpperCase();
  }
  return String(origen).toUpperCase();
}

// Separador entre el origen y su línea de abajo opcional ("ANTEQUERA · PED. PROV. 81406165"). Es un carácter que
// ningún origen/subtipo/tienda usa, así que partir por él nunca corta un origenTexto de los de siempre.
var SEPARADOR_SUFIJO_ORIGEN_ = ' · ';

function origenTextoConSufijo(origenTexto, sufijo) {
  var s = String(sufijo == null ? '' : sufijo).replace(/\s+/g, ' ').trim();
  return s ? origenTexto + SEPARADOR_SUFIJO_ORIGEN_ + s : origenTexto;
}

function mensajeCesionInvalida_(motivo) {
  var mensajes = {
    ORIGEN_IGUAL_DESTINO: 'La tienda de origen y la de destino de la cesión no pueden ser la misma',
    DESTINO_INVALIDO: 'La tienda de destino de la cesión no es válida',
    ORIGEN_INVALIDO: 'La tienda de origen de la cesión no es válida'
  };
  return mensajes[motivo] || 'Cesión no válida';
}

function validarCesionEntreTiendas(origenTienda, destino) {
  // "origen y destino solo pueden ser de las tiendas que tengo en circuito" — registrarLote
  // valida el destino como campo genérico (no vacío) para CUALQUIER origen, pero para una
  // Cesión concretamente hace falta comprobar que el destino TAMBIÉN esté en el circuito,
  // no solo que sea distinto del origen (si no, un destino inválido pasaría igual).
  var origenValido = validarTienda(origenTienda);
  if (!origenValido) return { ok: false, motivo: 'ORIGEN_INVALIDO' };
  if (!validarTienda(destino)) return { ok: false, motivo: 'DESTINO_INVALIDO' };
  if (origenValido === destino) return { ok: false, motivo: 'ORIGEN_IGUAL_DESTINO' };
  return { ok: true };
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

var TIENDAS_VALIDAS = ['Málaga', 'Marbella', 'Mijas', 'Granada'];
var VISTAS_VALIDAS = ['carga', 'interno', 'tienda', 'operario', 'incpc'];

function validarTienda(tienda) {
  if (TIENDAS_VALIDAS.indexOf(tienda) === -1) return '';
  return tienda;
}

function validarVista(vista) {
  if (VISTAS_VALIDAS.indexOf(vista) === -1) return 'carga';
  return vista;
}

function subtipoEfectivo(origen, subtipo) {
  // El subtipo solo tiene sentido cuando el origen es Taisa. Se ignora cualquier
  // valor recibido para otros orígenes (defensa server-side, aunque el cliente
  // también deja de enviarlo).
  return origen === 'Taisa' ? String(subtipo || '') : '';
}

var OPCIONES_RAZON_FLUJO_ = ['Sobrante', 'Soporte No documentado cargado', 'Anulado', 'Libre Servicio'];

function razonFlujoEfectiva(origen, razonFlujo) {
  // Para Taisa este campo no aplica: esos motivos ya se cubren con el subtipo de
  // Taisa (que tiene su propia lista, incluyendo casos que se solapan como Sobrante
  // o Anulado). Para cualquier otro origen es opcional y nunca viene por defecto, así
  // que cualquier valor vacío o fuera de la lista cerrada se descarta (defensa
  // server-side, aunque el cliente también deja de enviarlo).
  if (origen === 'Taisa') return '';
  var valor = String(razonFlujo || '').trim();
  return OPCIONES_RAZON_FLUJO_.indexOf(valor) !== -1 ? valor : '';
}

function fechaComoTexto(valor) {
  // google.script.run devuelve null de forma silenciosa cuando el valor que cruza de
  // servidor a cliente incluye objetos Date dentro de un array de objetos (limitación
  // conocida del puente cliente-servidor de Apps Script). Por eso toda fecha que salga
  // de una función expuesta al cliente (buscarEtiquetas, obtenerHistorialLotes) se
  // convierte a texto ISO aquí, nunca se devuelve un Date crudo.
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') return valor.toISOString();
  return String(valor);
}

function formatearIdCarga(numero) {
  var texto = String(numero);
  while (texto.length < 6) {
    texto = '0' + texto;
  }
  return 'CARGA-' + texto;
}

function seleccionarSoporteAEscanear(filas, valorEscaneado, destinoCarga) {
  // El barcode de la etiqueta codifica el idUnico (único por fila/soporte SIEMPRE,
  // incluso para etiquetas agrupadas con "+"), así que un escaneo real ya identifica
  // exactamente una fila — sin ambigüedad. Se mantiene un modo manual por si el
  // operario teclea el número de pedido a mano en vez de escanear (o el pedido no
  // está agrupado y prefiere teclearlo): ese modo sigue resolviendo por FIFO entre
  // los soportes pendientes de ese pedido+destino, igual que antes de introducir el
  // idUnico en el barcode.
  if (/^HODOS-/.test(valorEscaneado)) {
    var fila = filas.filter(function (f) { return f.idUnico === valorEscaneado; })[0];
    if (!fila) return { ok: false, motivo: 'NO_ENCONTRADO' };
    if (fila.destino !== destinoCarga) {
      return { ok: false, motivo: 'DESTINO_INCORRECTO', detalle: { destinoReal: fila.destino } };
    }
    if (fila.estado === 'EN_RUTA') return { ok: false, motivo: 'YA_ESCANEADO' };
    return { ok: true, idUnico: fila.idUnico };
  }

  var coincidencias = filas.filter(function (f) { return f.numeroPedido === valorEscaneado; });
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

function tokensPedido_(campoNumeroPedido) {
  // Una etiqueta agrupada guarda varios números de pedido juntos separados por "+"
  // (ej. "100200+100300+100450" = 1 soporte físico con 3 pedidos). Para comprobar
  // pedidos incompletos hay que mirar cada número por separado, no el campo entero.
  return String(campoNumeroPedido).split('+').map(function (t) { return t.trim(); }).filter(Boolean);
}

// 2026-08-21: la etiqueta física apila cada número de un grupo en una línea a fuente
// reducida (.numero-pedido-grupo, htmlUnaEtiqueta_ en Backend.gs) — con demasiados
// pedidos en el mismo soporte la lista no cabe y se sale del borde de la etiqueta
// (confirmado en real: foto de una etiqueta de Mijas con 12 pedidos desbordando). Por
// encima de este umbral, se sustituye la lista completa por un resumen con el
// recuento en vez de intentar encajar más líneas — decisión explícita del usuario.
var UMBRAL_AGRUPACION_ETIQUETA_ = 5;

function lineasNumeroPedidoEtiqueta(pedidos) {
  if (pedidos.length > UMBRAL_AGRUPACION_ETIQUETA_) {
    return ['AGRUPACIÓN (' + pedidos.length + ')'];
  }
  return pedidos;
}

// 2026-08-21: agrupar soportes YA EXISTENTES (selección múltiple en Interno/INCPC/
// Preparación) en una sola etiqueta nueva. Solo se permite entre soportes que ya son
// "compatibles" — mismo destino, origen, tienda de origen (Cesión) y razón del flujo —
// para evitar crear una etiqueta que mezcle, por ejemplo, un pedido con destino Mijas
// con uno de Málaga bajo una única categoría engañosa. También exige que todos sigan
// REGISTRADO (no se puede agrupar un soporte que ya salió en un camión, mismo criterio
// que borrarSoporteAdmin/actualizarSoporteAdmin).
//
// CORREGIDO (2026-08-21, mismo día): el subtipo SÍ se dejaba comparar al principio,
// pero el usuario pidió explícitamente quitarlo — dos soportes Taisa con subtipos
// distintos (p.ej. "Devolución" y "Rotura") deben poder agruparse igual. La etiqueta
// resultante hereda el subtipo/origenTexto del PRIMER soporte seleccionado
// (agruparSoportesAdmin, Backend.gs) — es una elección arbitraria entre los subtipos
// presentes, no una fusión de ambos; si hace falta reflejar el subtipo real de cada
// pedido agrupado, sigue disponible en el histórico (los soportes originales quedan
// registrados en `creadoPor`/logs aunque se borren de la tabla `etiquetas`).
var CAMPOS_AGRUPACION_ = ['destino', 'origen', 'origenTienda', 'razonFlujo'];

function validarAgrupacion(etiquetas) {
  if (!etiquetas || etiquetas.length < 2) {
    return { ok: false, motivo: 'Selecciona al menos 2 soportes para agrupar' };
  }
  var noRegistrados = etiquetas.filter(function (e) { return e.estado !== 'REGISTRADO'; });
  if (noRegistrados.length > 0) {
    return { ok: false, motivo: 'Solo se pueden agrupar soportes que aún no se han cargado en un camión (REGISTRADO)' };
  }
  var primero = etiquetas[0];
  var camposDistintos = CAMPOS_AGRUPACION_.filter(function (campo) {
    return etiquetas.some(function (e) { return e[campo] !== primero[campo]; });
  });
  if (camposDistintos.length > 0) {
    return { ok: false, motivo: 'Todos los soportes deben tener el mismo destino, origen y razón del flujo (difieren: ' + camposDistintos.join(', ') + ')' };
  }
  return { ok: true };
}

// Une los números de pedido de cada soporte seleccionado en un único campo "+", igual
// que un grupo creado de una vez en Cargar Lote. Si alguno de los soportes YA era un
// grupo (numeroPedido con "+" de una agrupación anterior), se aplana en vez de anidar —
// tokensPedido_ ya separa por "+", así que basta con concatenar sus resultados. No se
// deduplica: dos soportes distintos con el mismo número de pedido son dos piezas físicas
// reales, no una repetición a limpiar.
function numeroPedidoAgrupado(etiquetas) {
  var todos = [];
  etiquetas.forEach(function (e) {
    todos = todos.concat(tokensPedido_(e.numeroPedido));
  });
  return todos.join('+');
}

// Bug real (2026-09-22): numeroPedido puede repetirse por casualidad entre registros
// totalmente independientes (misma numeración, llegada por distinta expedición/día —
// ver comentario sobre MacroArrastres en IntegracionIncpc.gs). Antes se agrupaba por
// numeroPedido+destino en TODA la tabla sin más, así que un pedido de un solo soporte
// quedaba bloqueado por otro registro sin relación real. Requisito explícito del
// usuario: el bloqueo de cierre solo aplica a soportes DECLARADOS multi-soporte, es
// decir soporteTotal > 1 (calcularSoportes, calculado dentro del mismo lote pegado).
// Se acepta perder el aviso legado de "agrupaste soportes con + y dejaste uno suelto
// sin agrupar" (una etiqueta agrupada nace con soporteTotal=1, agruparSoportesAdmin en
// Backend.gs, así que ya no participa) — no hay forma de distinguir ese caso de una
// coincidencia real de numeroPedido sin este campo.
function pedidosPendientesEnCarga(filas, idCarga) {
  // Se filtra ANTES de tokenizar, no después: además de excluir soporteTotal<=1,
  // también evita que dos filas de LOTES DISTINTOS que cada una declaró su propio
  // multi-soporte coincidan por casualidad en numeroPedido+destino (loteId las separa).
  var filasMultiSoporte = filas.filter(function (f) { return f.soporteTotal > 1; });

  // Un pedido con varios soportes (declarados juntos en el mismo lote) debe viajar
  // completo en la misma carga. Si ya se escaneó AL MENOS un soporte que contiene un
  // pedido en esta carga, ningún otro soporte HERMANO (mismo loteId) que contenga ese
  // mismo pedido+destino puede seguir REGISTRADO (sin escanear todavía) — si lo está,
  // la carga no debería poder cerrarse. No se cuentan como pendientes los soportes que
  // ya están EN_RUTA en OTRA carga (ya salieron, cerrar esta no lo arregla).
  var enEstaCarga = {};
  filasMultiSoporte.forEach(function (f) {
    if (f.bateaId === idCarga) {
      tokensPedido_(f.numeroPedido).forEach(function (token) {
        enEstaCarga[token + '|' + f.destino + '|' + f.loteId] = true;
      });
    }
  });

  var pendientesPorPedido = {};
  filasMultiSoporte.forEach(function (f) {
    if (f.estado !== 'REGISTRADO') return;
    tokensPedido_(f.numeroPedido).forEach(function (token) {
      var clave = token + '|' + f.destino + '|' + f.loteId;
      if (enEstaCarga[clave]) {
        if (!pendientesPorPedido[token]) pendientesPorPedido[token] = [];
        // idUnico/origenTexto identifican exactamente qué fila falta (no solo cuántas),
        // para que quien cierre la carga pueda buscar ese soporte concreto en el
        // Buscador Interno en vez de solo saber "falta 1" sin más pistas.
        pendientesPorPedido[token].push({ idUnico: f.idUnico, origenTexto: f.origenTexto });
      }
    });
  });

  return Object.keys(pendientesPorPedido).map(function (numeroPedido) {
    var soportes = pendientesPorPedido[numeroPedido];
    return { numeroPedido: numeroPedido, soportesPendientes: soportes.length, soportes: soportes };
  });
}

function soportesMecoPendientesEnCarga(filas, idCarga) {
  // El origen MECO viaja siempre completo por tienda destino: si esta carga ya
  // lleva AL MENOS un soporte de origen MECO para una tienda, ningún otro soporte
  // MECO de esa MISMA tienda puede seguir REGISTRADO — si lo está, la carga no
  // debería poder cerrarse (no se puede partir un envío MECO entre camiones). A
  // diferencia de pedidosPendientesEnCarga (que agrupa por número de pedido), aquí
  // el "grupo" es todo el origen MECO de esa tienda, sin importar el pedido.
  var destinosMecoEnEstaCarga = {};
  filas.forEach(function (f) {
    if (f.bateaId === idCarga && f.origen === 'MECO') {
      destinosMecoEnEstaCarga[f.destino] = true;
    }
  });

  return filas
    .filter(function (f) {
      return f.origen === 'MECO' && f.estado === 'REGISTRADO' && destinosMecoEnEstaCarga[f.destino];
    })
    .map(function (f) {
      return { idUnico: f.idUnico, numeroPedido: f.numeroPedido, destino: f.destino };
    });
}

function nivelAvisoPorHoras(horas, umbralHoras) {
  // Escalada visual hacia la alerta: por debajo del 60% del umbral no hay aviso,
  // entre 60% y 85% amarillo, entre 85% y 100% naranja, a partir del 100% (el mismo
  // umbral que ya usa "alerta") rojo. Todo expresado como fracción del umbral para
  // que la escalada se ajuste sola si UMBRAL_ALERTA_HORAS_ cambia en el futuro.
  if (horas >= umbralHoras) return 'rojo';
  if (horas >= umbralHoras * 0.85) return 'naranja';
  if (horas >= umbralHoras * 0.6) return 'amarillo';
  return 'ok';
}

function horasLaborablesTranscurridas(fechaCreacion, ahora) {
  // Horas transcurridas entre fechaCreacion y ahora, sin contar los tramos que caen
  // en sábado o domingo (no excluye horas nocturnas dentro de un día laborable, solo
  // fines de semana completos — así lo pidió el usuario). El día se calcula con el
  // mismo desfase fijo GMT+1 sin DST que ya usa el resto de la app
  // (Utilities.formatDate(..., 'GMT+1', ...) en Backend.gs), para que un soporte
  // creado, p.ej., un viernes a las 23:00 en hora española cuente como creado en
  // viernes y no en sábado.
  var OFFSET_MS = 60 * 60 * 1000;
  var DIA_MS = 24 * OFFSET_MS;
  var inicio = new Date(fechaCreacion).getTime();
  var fin = new Date(ahora).getTime();
  if (fin <= inicio) return 0;

  var cursor = inicio;
  var totalMs = 0;
  while (cursor < fin) {
    var cursorLocal = cursor + OFFSET_MS;
    var finDiaLocal = Math.floor(cursorLocal / DIA_MS) * DIA_MS + DIA_MS;
    var finDia = finDiaLocal - OFFSET_MS;
    var tramoFin = Math.min(fin, finDia);
    var diaSemana = new Date(cursorLocal).getUTCDay(); // 0=domingo … 6=sábado
    if (diaSemana !== 0 && diaSemana !== 6) {
      totalMs += tramoFin - cursor;
    }
    cursor = tramoFin;
  }
  return totalMs / (60 * 60 * 1000);
}

function formatearHorasTexto(horas) {
  // Mismo criterio de formato que el equivalente en Index.html (formatearAntiguedad_,
  // solo en cliente) — se repite aquí porque el informe imprimible se genera en
  // servidor (ver ReporteCarga.gs), sin acceso al JS del cliente.
  if (horas < 1) return Math.round(horas * 60) + ' min';
  if (horas < 24) return (Math.round(horas * 10) / 10) + ' h';
  var dias = Math.floor(horas / 24);
  var resto = Math.round(horas - dias * 24);
  return dias + 'd ' + resto + 'h';
}

function prepararLineasContenido(items) {
  // Descarta líneas sin descripción (el usuario puede dejar filas vacías a medio
  // rellenar en el mini-formulario) y normaliza cantidad a número (0 si no es válida).
  return (items || [])
    .filter(function (it) { return it && String(it.descripcion || '').trim() !== ''; })
    .map(function (it) {
      return { descripcion: String(it.descripcion).trim(), cantidad: Number(it.cantidad) || 0 };
    });
}

// ── Cargas: cargador, hora de llegada y reapertura (2026-10-15) ──────────────────────────

// Personas que realizan las cargas. COPIA de la lista del proyecto «Cargas/Descargas Plataforma
// Málaga» (proyecto_cargas/src/CargasDescargas.gs: OPERARIOS_CARGAS = principales y CARGADORES_AUX =
// auxiliares). Si allí cambia la lista hay que actualizarla aquí: test/cargasReapertura.test.js
// compara las dos cuando el otro proyecto está en el equipo.
var CARGADORES_PRINCIPALES_ = ['Manuel Rosas', 'Sergio Sánchez', 'Antonio Sánchez', 'Juanlu'];
var CARGADORES_AUXILIARES_ = [
  'Alberto', 'Daniel.Arrastio', 'Daniel.Simo', 'Sebas', 'Fran P', 'Rafa Perez',
  'David Planas', 'Brunelli', 'Francisco', 'Jesus Seco', 'JM Bonamigo', 'Campana',
  'Carlos Gutierrez', 'Salva', 'Carlos. Osuna', 'Alex. Rios', 'Jose Antonio',
  'Luciano', 'Pablo', 'Daniel Cano', 'Paqui', 'Alejandro Giner', 'Pedro Serrano',
  'Edson', 'Antonio M.', 'Oscar'
];
var MAX_CARGADORES_POR_CARGA_ = 2;

// Devuelve la lista limpia (sin repetidos, sin espacios) o lanza un error legible para el operario.
function validarCargadores_(valor) {
  var lista = Array.isArray(valor) ? valor : String(valor == null ? '' : valor).split(',');
  var limpios = [];
  lista.forEach(function (n) {
    var nombre = String(n == null ? '' : n).trim();
    if (nombre && limpios.indexOf(nombre) === -1) limpios.push(nombre);
  });
  if (limpios.length === 0) throw new Error('Indica quién carga (elige a una o dos personas de la lista).');
  var permitidos = CARGADORES_PRINCIPALES_.concat(CARGADORES_AUXILIARES_);
  limpios.forEach(function (nombre) {
    if (permitidos.indexOf(nombre) === -1) throw new Error('Cargador no válido, no está en la lista de Cargas/Descargas: ' + nombre + '.');
  });
  if (limpios.length > MAX_CARGADORES_POR_CARGA_) throw new Error('Máximo ' + MAX_CARGADORES_POR_CARGA_ + ' personas por carga.');
  return limpios;
}

// «A, B» + [B, C] -> «A, B, C»: cada vez que alguien abre o reabre la carga se anota sin borrar a los anteriores.
function unirCargadores_(actual, nuevos) {
  var vistos = [];
  String(actual == null ? '' : actual).split(',').concat(nuevos || []).forEach(function (n) {
    var nombre = String(n == null ? '' : n).trim();
    if (nombre && vistos.indexOf(nombre) === -1) vistos.push(nombre);
  });
  return vistos.join(', ');
}

// Horario de verano de la UE: del último domingo de marzo (01:00 UTC) al último de octubre (01:00 UTC).
function _ultimoDomingoUtc_(anio, mes) {
  var ultimoDia = new Date(Date.UTC(anio, mes + 1, 0));
  return ultimoDia.getUTCDate() - ultimoDia.getUTCDay();
}

function _enVeranoMadrid_(instanteUtcMs) {
  var anio = new Date(instanteUtcMs).getUTCFullYear();
  var inicio = Date.UTC(anio, 2, _ultimoDomingoUtc_(anio, 2), 1, 0);
  var fin = Date.UTC(anio, 9, _ultimoDomingoUtc_(anio, 9), 1, 0);
  return instanteUtcMs >= inicio && instanteUtcMs < fin;
}

// Fecha (yyyy-MM-dd) en Madrid de un instante UTC en milisegundos.
function fechaMadridISO_(instanteUtcMs) {
  var horas = _enVeranoMadrid_(instanteUtcMs) ? 2 : 1;
  return new Date(instanteUtcMs + horas * 3600000).toISOString().slice(0, 10);
}

// Hora de llegada de una carga = fecha de entrega + horario, en hora de Madrid. Devuelve milisegundos UTC
// (o null si la fecha no es válida). Un horario que no es una hora («Envío único diario», Granada) cuenta
// hasta el final de ese día.
function fechaLlegadaCarga_(fechaEntrega, horario) {
  var f = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaEntrega || ''));
  if (!f) return null;
  var h = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(horario || ''));
  var minutos = h ? Number(h[1]) * 60 + Number(h[2]) : 24 * 60 - 1;
  var relojDePared = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), 0, minutos); // hora local como si fuera UTC
  var horasMadrid = _enVeranoMadrid_(relojDePared - 2 * 3600000) ? 2 : 1;
  return relojDePared - horasMadrid * 3600000;
}

// Regla del usuario: una carga se puede añadir/quitar/reabrir hasta que se cumple su hora y día de llegada.
function cargaModificablePorLlegada_(carga, ahoraMs) {
  var llegada = fechaLlegadaCarga_(carga && carga.fechaEntrega, carga && carga.horario);
  if (llegada == null) return false; // sin fecha válida, lado seguro: no se toca
  return ahoraMs < llegada;
}

function textoLlegadaCarga_(carga) {
  var f = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((carga && carga.fechaEntrega) || ''));
  var fecha = f ? f[3] + '/' + f[2] + '/' + f[1] : String((carga && carga.fechaEntrega) || '');
  return fecha + ' ' + ((carga && carga.horario) || '');
}

// Un camión (destino+fecha+horario) = una carga. Si por datos antiguos hay varias del mismo camión (salieron de
// abrir la pantalla otra vez con la carga ya cerrada, cuando solo se buscaban las abiertas) manda la que lleva
// mercancía (`contenidos` = {idCarga: soportes + palets}); a igualdad, la abierta y, a igualdad, la más reciente.
// Sin `contenidos` solo cuentan abierta y reciente. Las demás se ignoran: no se crean, no se muestran, no se tocan.
function elegirCargaExistente_(cargas, contenidos) {
  var puntos = function (c) {
    return ((contenidos && Number(contenidos[c.idCarga]) > 0) ? 2 : 0) + (c.estado === 'ABIERTA' ? 1 : 0);
  };
  var mejor = null;
  (cargas || []).forEach(function (c) {
    if (c.estado !== 'ABIERTA' && c.estado !== 'CERRADA') return;
    if (!mejor) { mejor = c; return; }
    var pc = puntos(c);
    var pm = puntos(mejor);
    if (pc > pm || (pc === pm && String(c.fechaCreacion || '') > String(mejor.fechaCreacion || ''))) mejor = c;
  });
  return mejor;
}

// Un camión = destino + fecha de entrega + horario.
function claveCamionCarga_(c) {
  return [c.destino, String(c.fechaEntrega || '').slice(0, 10), c.horario].join('|');
}

// Reparte las cargas de la pantalla del muelle en tres listas que NO se mezclan (2026-10-15):
//   abiertas   = la carga de cada camión que sigue abierta y cuyo camión aún no ha llegado
//   cerradas   = cargas cerradas de hoy en adelante: se pueden reabrir hasta la llegada del camión y, ya
//                llegado, quedan solo de consulta hasta que acaba el día
//   porRevisar = lo que se quedó sin terminar: cargas abiertas cuyo camión YA llegó (hay que cerrarlas o, si
//                están vacías, descartarlas) y cargas abiertas REPETIDAS de un camión que ya tiene la suya
// Un camión tiene UNA carga que manda (elegirCargaExistente_, con `contenidos` = {idCarga: soportes + palets});
// las demás abiertas del mismo camión van a «por revisar» como repetidas. Las cerradas repetidas y las
// descartadas no se muestran. Devuelve las filas tal cual (sin recuentos); `hoyISO` = yyyy-MM-dd de hoy en Madrid.
function clasificarCargasPanel_(cargas, contenidos, ahoraMs, hoyISO) {
  var porCamion = {};
  var claves = [];
  (cargas || []).forEach(function (c) {
    var k = claveCamionCarga_(c);
    if (!porCamion[k]) { porCamion[k] = []; claves.push(k); }
    porCamion[k].push(c);
  });
  var resultado = { abiertas: [], cerradas: [], porRevisar: [] };
  claves.forEach(function (k) {
    var grupo = porCamion[k];
    var principal = elegirCargaExistente_(grupo, contenidos);
    if (!principal) return;
    if (principal.estado === 'ABIERTA') {
      if (cargaModificablePorLlegada_(principal, ahoraMs)) resultado.abiertas.push(principal);
      else resultado.porRevisar.push({ carga: principal, motivo: 'LLEGO', principal: '' });
    } else if (String(principal.fechaEntrega || '').slice(0, 10) >= hoyISO) {
      resultado.cerradas.push(principal);
    }
    grupo.forEach(function (c) {
      if (c === principal || c.estado !== 'ABIERTA') return;
      var tieneMercancia = !!contenidos && Number(contenidos[c.idCarga]) > 0;
      resultado.porRevisar.push({ carga: c, motivo: tieneMercancia ? 'REPETIDA_CON_MERCANCIA' : 'REPETIDA', principal: principal.idCarga });
    });
  });
  return resultado;
}
