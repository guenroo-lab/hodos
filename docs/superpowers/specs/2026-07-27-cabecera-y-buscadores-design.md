# HODOS — Cabecera profesional + Buscadores (tienda / interno)

**Fecha:** 2026-07-27
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Depende de:** `2026-07-27-modulo1-carga-etiquetas-design.md` (Módulo 1, ya implementado y desplegado)

## Contexto

El Módulo 1 (carga de lote + etiquetas) ya está en producción. Esta iteración añade:
1. Una cabecera más profesional (logo Taisa + nombre "HODOS") a la interfaz existente.
2. Dos pantallas de búsqueda nuevas, ya previstas en la especificación original
   (secciones 6 y 7): una para el equipo interno ("nosotros mismos") y otra de solo
   lectura para cada tienda.

No se toca la lógica de registro de lotes ni el esquema de la Sheet — todo lo nuevo lee de
la pestaña `ETIQUETAS` ya existente.

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Alcance ahora vs. esperar a fase 3 (carga de camión) | Construir ya, `bateaId`/`fechaEnvio` muestran "Pendiente" | El usuario quiere que tienda y equipo interno puedan buscar por lo demás (fecha, pedido, origen, destino, estado) desde ya; la batea se rellenará sola cuando exista la fase 3, sin tocar esta pantalla |
| Restricción de la vista de tienda | Por enlace (`?vista=tienda&tienda=Malaga`), sin selector | Simplicidad; cada tienda tiene su propio enlace. Ver aviso de seguridad más abajo |
| Capacidades de la vista interna | Solo consulta, con más filtros (origen, destino, estado) | Coherente con el alcance del proyecto; no abre la puerta a modificar el histórico ya registrado |
| Estructura de pantallas | Un único `Index.html` con vistas por parámetro de URL (`?vista=`) | Patrón ya validado en `lm_produccion` (operario/admin); mismo despliegue y URL base |

**Aviso de seguridad honesto:** la restricción por enlace es de conveniencia, no de
seguridad real — cualquiera que cambie el parámetro `tienda` en la URL puede ver otra
tienda. El webapp ya está limitado a cuentas del dominio (`access: DOMAIN`), y ninguna
otra herramienta del ecosistema Taisa tiene credenciales por tienda tampoco, así que esto
es coherente con cómo se trabaja hoy — pero queda anotado por si se quiere cerrar más
adelante (ej. comprobar `Session.getActiveUser()` contra una lista de emails por tienda).

## Cabecera (las tres vistas)

Barra superior fija: logo Taisa (`LOGO_TAISA_B64`, ya existe) a la izquierda + "HODOS"
(Bebas Neue, grande, color de acento) con "Taisa Logistics" como subtítulo pequeño debajo.
El selector de 3 temas se reubica a la derecha de esa misma barra, en formato compacto
(píldoras pequeñas), sustituyendo el bloque centrado actual.

## Rutas por URL

`doGet(e)` pasa de `createHtmlOutputFromFile` a `HtmlService.createTemplateFromFile('Index')`,
inyectando en la plantilla:
- `vista`: `e.parameter.vista || 'carga'`
- `tiendaFiltro`: `e.parameter.tienda`, **validado contra la lista fija de tiendas**
  (Málaga/Marbella/Mijas/Granada) antes de inyectarlo en el HTML — si no es una de esas
  cuatro, se trata como vacío. Esto evita cualquier inyección vía el parámetro de URL.

Vistas:
- `?vista=carga` (por defecto): formulario de carga de lote ya existente.
- `?vista=interno`: buscador sin restricción — filtros fecha / ID único / nº pedido /
  origen / destino / estado. Solo consulta.
- `?vista=tienda&tienda=Malaga`: buscador restringido a esa tienda (destino fijo, sin
  selector) — filtros fecha / ID único / nº pedido, tal cual pide la especificación
  original.

`carga` e `interno` comparten pantalla con una barra de pestañas (Cargar / Buscar) para
el equipo interno. `tienda` es una pantalla propia — sin pestaña de carga, las tiendas no
deben verla ni tener acceso a ella.

## Backend: `buscarEtiquetas(filtros)`

Nueva función en `Backend.gs`. `filtros` puede incluir: `fecha` (yyyy-MM-dd), `idUnico`,
`numeroPedido`, `origen`, `destino`, `estado`. Cuando la llamada viene de la vista tienda,
el cliente siempre manda `destino` fijo al valor de `tiendaFiltro` (no editable en la UI).

Devuelve, por cada etiqueta que cumpla los filtros: `idUnico`, `numeroPedido`,
`soporteNum`/`soporteTotal`, `origenTexto`, `destino`, `fechaCreacion`, `estado`,
`bateaId`, `fechaEnvio` — ordenado por fecha de creación descendente. En el HTML de
resultados, si `bateaId` está vacío se muestra **"Pendiente"**; si no, se muestra
`"Llegó: <fechaEnvio formateada>"`, igual que el ejemplo de la especificación ("pedido
286676 → llegó en la batea del 27/07/2026 18:00").

## Frontend

- Componente de cabecera compartido entre las tres vistas.
- Vista `tienda`: formulario de búsqueda (fecha, ID único, nº pedido) + tabla de
  resultados: Nº pedido, Soporte, Origen, ID único, Fecha creación, Batea. Sin pestaña de
  carga, sin selector de tienda.
- Vista `interno`: mismo formulario + filtros de origen/destino/estado + tabla con las
  mismas columnas más Destino y Estado. Pestañas Cargar / Buscar.
- Los 3 temas (Black Edition, Rojo/Verde vivo, Gris/Blanco) se aplican igual en las tres
  vistas, con la misma persistencia en `localStorage`.

## Fuera de alcance

Cualquier acción de escritura desde las vistas de búsqueda (edición, borrado, confirmación
de llegada) — ambas son de solo lectura, tal como se decidió. La fase 3 (carga de camión
con escaneo, que rellena `bateaId`/`fechaEnvio`) sigue sin implementarse; estas pantallas
ya están preparadas para mostrar esos datos en cuanto existan.
