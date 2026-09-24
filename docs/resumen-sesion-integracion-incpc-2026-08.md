# Integración INCPC → HODOS (Taisa Logistics) — Resumen de sesión

**Qué hace:** cuando en la hoja "Incidencias" de INCPC se marca el check de la columna N con la columna M en "sí" (cualquier variante, incidencia o devolución), se crea automáticamente una etiqueta en HODOS (origen Taisa, destino/pedido/subtipo/contenido mapeados) y aparece en una pestaña nueva "INCPC" de HODOS lista para imprimir en lote.

## Proyectos

- **HODOS**: `C:\Users\30081048\Desktop\Proyectos\hodos` — scriptId `1DzQtDtLFjcMWfdUCpVUM6FNkbcQZHwONADMKyN8U6nzy8hFvqwIRPwe-`, deployment producción `AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ`, actualmente en **v46**.
- **INCPC**: `C:\Users\30081048\Desktop\Proyectos\INCPC` — scriptId `1gUV-TzJrfNgmfTw014ADIDh8R1svsNIUpaL094KRsch6h6z7C2H4CoZb` (proyecto contenedor de Sheet, sin deployment propio para esto — los triggers usan siempre el código HEAD).
- **Supabase**: proyecto `dbxlrnupiwemnarlxmcv`, tabla `etiquetas`.
- **Token compartido** entre ambos (Propiedades del Script): `INCPC_SHARED_TOKEN` = `z0VyOXrMXB4x41FOt8M85xAA3WWsoeZHDummzNs7VY`. En INCPC además `HODOS_WEBAPP_URL` con la URL del deployment de arriba.

## Arquitectura

Trigger instalable `onEditIncpcHodos_` en INCPC (`Código.js`) llama por `UrlFetchApp` a un `doPost` nuevo en HODOS (`IntegracionIncpc.gs`), autenticado con `Authorization: Bearer` (OAuth del propio INCPC) contra el deployment `DOMAIN` existente — **sin abrir ningún acceso público nuevo** — más el token compartido como segunda capa.

Documentado en:
- `docs/superpowers/specs/2026-08-05-integracion-incpc-hodos-design.md`
- `docs/superpowers/plans/2026-08-05-integracion-incpc-hodos.md`

## Bugs reales encontrados y arreglados

1. **Token nunca guardado**: el paso manual de HODOS (Task 9 del plan) no se había completado; se añadió directamente entrando a Propiedades del Script con el navegador.
2. **532 rangos protegidos duplicados** en la hoja de INCPC (basura acumulada, no relacionada con esta integración) — limpiados con `quitarProtecciones()`.
3. **Filas inmovilizadas de más** — arreglado con `arreglarInmovilizadoFilas_()` → solo queda inmovilizada la fila 1.
4. **Etiquetas duplicadas** (bug real, confirmado con capturas): marcar M y N en dos ediciones separadas disparaba el trigger dos veces; como la llamada a HODOS tarda varios segundos, la 2ª ejecución veía la columna O aún vacía antes de que la 1ª terminara de escribir. Arreglado con `LockService.getScriptLock()` en `onEditIncpcHodos_` (mismo patrón que ya usaba `guardarIncidencia`).
5. **Logo Taisa no se veía en el cuerpo del email** de cierre de carga (sí en el PDF adjunto) — Gmail/Outlook bloquean `data:` URI en el body del email. Arreglado con imagen inline CID real (`inlineImages` de `MailApp.sendEmail`).

## Features añadidas en HODOS esta sesión (v38 → v46)

- Pestaña **INCPC**: lista de etiquetas pendientes, "Imprimir todas", editar/borrar/reimprimir individual (reutiliza el mismo mecanismo que "Buscar"), "Borrar seleccionados".
- **Subtipo Taisa dinámico**: `obtenerSubtiposConocidos()` combina lista base + valores ya usados en Supabase, para que un tipo nuevo aparezca seleccionable sin tocar código.
- Botón **"Actualizar"** en Cargar lote / Pendientes / INCPC.
- Columna "Creado" ahora muestra hora, no solo fecha.
- **Cierre forzado oculto**: pulsación larga (2s) en "Cerrar carga" + confirmación explícita salta el bloqueo de pedidos incompletos/MECO sin completar, dejando constancia en el resumen de cierre (nunca en silencio).
- **Banda de color por tienda** en el informe de cierre de carga (Málaga verde `#147638`, Marbella azul `#1f5b83`, Mijas morado `#5d356d`, Granada naranja `#925e0b` — mismos colores que los botones de selección de tienda).
- **Búsqueda masiva de pedidos** (pegar varios, uno por línea) + **filtro de orden** (más nueva/antigua) + botón **"Copiar resultados"** (formato TSV, pegar en Excel/Sheets) en Buscador Interno.

## Notas técnicas para la próxima sesión

- Los cambios en `Código.js` de INCPC **no necesitan `clasp deploy`**, solo `clasp push -f` (los triggers usan siempre el código HEAD).
- Los cambios en HODOS **sí necesitan `clasp deploy -i <deploymentId>`** además del push, o no llegan nunca a producción.
- Pendiente sin resolver (no urgente): `.btn-link` en HODOS tiene área clicable por debajo de 44×44px — vale para uso desktop, revisar si algún día se usa más desde móvil.
