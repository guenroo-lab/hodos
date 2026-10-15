'use strict';
/**
 * Mutaciones de la Fase 2 del recorte de egress de HODOS: cada una planta UN error
 * típico en el código NUEVO y herramientas/pruebas-egress-fase2.js exige que el
 * banco lo detecte (algún escenario debe dar un resultado distinto del código
 * viejo). Formato: [nombre, archivo, s => s.replace(textoExacto, textoMutado)].
 * Si el código cambia y el texto ya no existe, el banco avisa de que la mutación
 * "no se aplicó" y hay que actualizarla aquí.
 */
module.exports = [
  // --- pre-filtro de buscarEtiquetas
  ['buscarEtiquetas: el filtro de destino pide el origen', 'Backend.gs', s => s
    .replace("if (filtros.destino) partes.push('destino=eq.' + encodeURIComponent(filtros.destino));", "if (filtros.destino) partes.push('origen=eq.' + encodeURIComponent(filtros.destino));")],
  ['buscarEtiquetas: el filtro de estado pide siempre REGISTRADO', 'Backend.gs', s => s
    .replace("if (filtros.estado) partes.push('estado=eq.' + encodeURIComponent(filtros.estado));", "if (filtros.estado) partes.push('estado=eq.REGISTRADO');")],
  ['buscarEtiquetas: idUnico solo por prefijo', 'Backend.gs', s => s
    .replace("partes.push('id_unico=ilike.' + encodeURIComponent('*' + String(filtros.idUnico) + '*'));", "partes.push('id_unico=ilike.' + encodeURIComponent(String(filtros.idUnico) + '*'));")],
  ['buscarEtiquetas: idUnico distingue mayúsculas', 'Backend.gs', s => s
    .replace("partes.push('id_unico=ilike.' + encodeURIComponent('*' + String(filtros.idUnico) + '*'));", "partes.push('id_unico=like.' + encodeURIComponent('*' + String(filtros.idUnico) + '*'));")],
  ['buscarEtiquetas: numeroPedido solo por igualdad exacta', 'Backend.gs', s => s
    .replace("return 'numero_pedido.ilike.' + encodeURIComponent('*' + t + '*'); });", "return 'numero_pedido.eq.' + encodeURIComponent(t); });")
    .replace("'numero_pedido=ilike.' + encodeURIComponent('*' + tokens[0] + '*')", "'numero_pedido=eq.' + encodeURIComponent(tokens[0])")],
  ['buscarEtiquetas: numeroPedido solo mira el primer pedido pegado', 'Backend.gs', s => s
    .replace("var tokens = parsearLotePedidos(filtros.numeroPedido);\n    if (tokens.length >= 1", "var tokens = parsearLotePedidos(filtros.numeroPedido).slice(0, 1);\n    if (tokens.length >= 1")],
  ['buscarEtiquetas: pendiente true pide los NO pendientes', 'Backend.gs', s => s
    .replace("partes.push('pendiente_impresion_incpc=eq.true');", "partes.push('pendiente_impresion_incpc=eq.false');")],
  ['buscarEtiquetas: fecha sin margen de zona horaria', 'Backend.gs', s => s
    .replace("encodeURIComponent(new Date(dia - DIA_MS).toISOString())", "encodeURIComponent(new Date(dia).toISOString())")
    .replace("encodeURIComponent(new Date(dia + DIA_MS).toISOString())", "encodeURIComponent(new Date(dia + DIA_MS - 3600000).toISOString())")],
  // --- mapas de contenido / cargas
  ['obtenerMapaContenidoDe_: solo pide el contenido de la primera etiqueta', 'Backend.gs', s => s
    .replace("agruparContenidoPorIdUnico_(leerContenidoCrudoPorIds_(ids))", "agruparContenidoPorIdUnico_(leerContenidoCrudoPorIds_(ids.slice(0, 1)))")],
  ['leerContenidoCrudoPorIds_: se salta una etiqueta al cambiar de lote', 'EstructuraContenido.gs', s => s
    .replace("for (var i = 0; i < ids.length; i += LOTE_IDS_CONTENIDO_) {", "for (var i = 0; i < ids.length; i += LOTE_IDS_CONTENIDO_ + 1) {")],
  ['obtenerMapaCargasDe_: busca las cargas por estado en vez de por id', 'Backend.gs', s => s
    .replace("leerCargas_('id_carga=in.(' +", "leerCargas_('estado=in.(' +")],
  ['obtenerMapaCargasDe_: devuelve vacío', 'Backend.gs', s => s
    .replace("var ids = distintosTexto_(idsCarga);\n  if (ids.length === 0) return {};", "var ids = distintosTexto_(idsCarga);\n  return {};")],
  // --- cerrarCarga
  ['cerrarCarga: no mira las etiquetas REGISTRADO', 'Backend.gs', s => s
    .replace("enCarga.concat(registradas).forEach(", "enCarga.concat([]).forEach(")],
  ['cerrarCarga: no mira las etiquetas de ESTA carga', 'Backend.gs', s => s
    .replace("enCarga.concat(registradas).forEach(", "[].concat(registradas).forEach(")],
  ['cerrarCarga: mira las de OTRA carga', 'Backend.gs', s => s
    .replace("leerEtiquetas_('batea_id=eq.' + encodeURIComponent(idCarga) + '&order=id_unico.asc', COLUMNAS)", "leerEtiquetas_('batea_id=neq.' + encodeURIComponent(idCarga) + '&order=id_unico.asc', COLUMNAS)")],
  ['cerrarCarga: sin la columna soporte_total', 'Backend.gs', s => s
    .replace("estado,batea_id,soporte_total,lote_id';", "estado,batea_id,lote_id';")],
  ['cerrarCarga: sin la columna origen', 'Backend.gs', s => s
    .replace("'id_unico,numero_pedido,origen,origen_texto,destino,estado,batea_id,soporte_total,lote_id'", "'id_unico,numero_pedido,origen_texto,destino,estado,batea_id,soporte_total,lote_id'")],
  // --- otras
  // --- historial de lotes y subtipos (RPC en Postgres, migraciones/2026-10-15-*.sql)
  ['obtenerHistorialLotes: pide un lote de más', 'Backend.gs', s => s
    .replace("{ p_limite: n }", "{ p_limite: n + 1 }")],
  ['obtenerHistorialLotes: ignora el límite pedido', 'Backend.gs', s => s
    .replace("{ p_limite: n }", "{ p_limite: 10 }")],
  ['obtenerHistorialLotes: pierde el destino al mapear', 'Backend.gs', s => s
    .replace("destino: f.destino, fecha: fechaComoTexto(f.fecha_creacion)", "destino: '', fecha: fechaComoTexto(f.fecha_creacion)")],
  ['obtenerHistorialLotes: cantidad siempre 1', 'Backend.gs', s => s
    .replace("cantidad: f.cantidad,", "cantidad: 1,")],
  ['obtenerHistorialLotes: pone la fecha de otro campo', 'Backend.gs', s => s
    .replace("fecha: fechaComoTexto(f.fecha_creacion)", "fecha: fechaComoTexto(f.origen_texto)")],
  ['obtenerHistorialLotes: el más antiguo primero', 'Backend.gs', s => s
    .replace("return supaRpc_('historial_lotes', { p_limite: n }).map(", "return supaRpc_('historial_lotes', { p_limite: n }).reverse().map(")],
  ['obtenerHistorialLotes: el tope baja de 1000 a 500', 'Backend.gs', s => s
    .replace("|| 10, 1), 1000);", "|| 10, 1), 500);")],
  ['obtenerHistorialLotes: el límite como texto («4») se ignora', 'Backend.gs', s => s
    .replace("Math.floor(Number(limite)) || 10", "Math.floor(limite) === limite ? limite : 10")],
  ['obtenerSubtiposConocidos: no descarta los de la lista base', 'EstructuraSheets.gs', s => s
    .replace("if (s && !vistos[s] && todos.indexOf(s) === -1) {", "if (s && !vistos[s]) {")],
  ['obtenerSubtiposConocidos: llama a la RPC del historial', 'EstructuraSheets.gs', s => s
    .replace("supaRpc_('subtipos_taisa_usados', {})", "supaRpc_('historial_lotes', {})")],
  ['obtenerSubtiposConocidos: solo el primer subtipo', 'EstructuraSheets.gs', s => s
    .replace("var filas = supaRpc_('subtipos_taisa_usados', {});", "var filas = supaRpc_('subtipos_taisa_usados', {}).slice(0, 1);")],
  ['obtenerCarga: solo el contenido de la primera etiqueta', 'Backend.gs', s => s
    .replace("obtenerMapaContenidoDe_(filasEscaneadas.map(function (f) { return f.idUnico; }))", "obtenerMapaContenidoDe_(filasEscaneadas.slice(0, 1).map(function (f) { return f.idUnico; }))")],
  ['agruparSoportesAdmin: no lee el contenido de los originales', 'Backend.gs', s => s
    .replace("obtenerMapaContenidoDe_(filas.map(function (f) { return f.idUnico; }))", "obtenerMapaContenidoDe_([])")]
];
