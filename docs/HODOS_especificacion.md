# HODOS — Sistema de Trazabilidad de Pedidos Cliente

## Contexto del problema

Leroy Merlín envía pedidos a tienda que **no tienen gasto de envío**. Al no tener gasto de envío, el sistema propio de Leroy Merlín (Generix/SIE) no puede procesarlos ni darles trazabilidad. Actualmente no existe ningún sistema que registre estos pedidos, cuándo se generan, cuándo se envían, ni en qué transporte llegan a cada tienda.

**HODOS** es el sistema paralelo que da esa trazabilidad: desde el registro del pedido hasta la confirmación de que ha llegado a tienda.

Un pedido puede registrarse en HODOS un día y no enviarse hasta días después — el sistema debe reflejar ambos momentos (creación vs. envío) de forma independiente.

---

## Orígenes de los pedidos

Cada pedido registrado en HODOS tiene un **origen**, que puede ser:

- **MECO** (plataforma)
- **Valencia** (plataforma)
- **Torija** (plataforma)
- **Antequera** (plataforma)
- **Taisa** (gestión propia) — requiere un **subtipo** obligatorio:
  - Devolución
  - Inventario
  - Demarca
  - Petición Reserva

Cuando el origen es Taisa, en la etiqueta y en el sistema debe reflejarse como **"TAISA - [SUBTIPO]"** (ej: `TAISA - DEVOLUCIÓN`).

---

## Tiendas destino

- Málaga
- Marbella
- Mijas
- Granada

**Nota importante:** Málaga no tiene retenciones de recepción propias, pero sí puede recibir devoluciones de pedido cliente, por lo que debe estar incluida igualmente en el sistema.

---

## Flujo completo

### 1. Registro por lote

- Interfaz de entrada donde se pega una **lista de pedidos** (un pedido por línea), típicamente copiada desde un Google Sheet
- Se selecciona **un origen** (+ subtipo si es Taisa) y **un destino** común para todo el lote
- El número de pedido **siempre es de 6 dígitos** — si llega con menos dígitos, se debe normalizar (rellenar con ceros a la izquierda)
- Al confirmar, se registra el lote completo y se genera automáticamente una etiqueta por cada pedido

### 2. Generación de etiquetas

Cada pedido genera una etiqueta individual con:

- **ID único** por etiqueta (permite reenviar el mismo número de pedido varias veces sin conflicto, ej. por incidencias o devoluciones repetidas)
- **Fecha de creación de la etiqueta** (no la fecha de envío) — esquina superior derecha, junto al logo
- **Logo de Taisa Logistics** — esquina superior izquierda (archivo adjunto: ver `logo_taisa.png`)
- **Tienda destino** — grande, justo encima del número de pedido
- **Número de pedido** — centro de la etiqueta, el elemento más grande, siempre 6 dígitos
- **Origen** — grande, justo debajo del número de pedido (ej: `MECO`, `TORIJA`, `TAISA - DEVOLUCIÓN`)
- **Código de barras** (CODE128) — con el número de pedido, para escaneo posterior

**Formato físico:** 15 cm de ancho x 10 cm de alto (horizontal, más ancha que alta). Diseñada para impresora Zebra.

**Impresión:** debe poder imprimirse el lote completo de una sola vez.

### 3. Carga en camión — validación de destino

- Al cargar el camión, se escanea el código de barras de cada pedido
- El sistema debe comparar el **destino registrado** en esa etiqueta contra el **destino/camión** que se está cargando en ese momento
- Si no coinciden → **alerta inmediata** (ej: "Este pedido es de Marbella, no de Málaga")
- Al escanear correctamente, el pedido queda marcado como **"en ruta"** hacia su tienda destino, junto con fecha/hora de ese evento (esto es lo que luego se mostrará como "batea" a las tiendas)

### 4. Integración con Carta de Portes SIE

- HODOS y la app de Generador de Carta de Portes SIE son **sistemas independientes**
- Ambas apps deben tener una opción para **"añadir el flujo de la otra"**, de forma bidireccional
- Objetivo: gestionar una carga completa sin tener que saltar manualmente entre Generix, HODOS y Carta de Portes SIE

### 5. Documentación a tiendas

- Se genera un documento **"Pedido Cliente"**, con diseño similar a la Carta de Portes SIE existente
- Se envía como **adjunto junto a la Carta de Portes SIE**, mostrando todos los pedidos cliente que van a llegar a esa tienda ese día

### 6. Vista/panel propio (para el gestor — Pedro)

- Visualización en tiempo real de todos los pedidos registrados, en cualquier momento
- Backend/almacenamiento en Google Drive

### 7. Vista para tiendas (solo lectura)

- Acceso **exclusivamente de consulta** — las tiendas no pueden modificar ni confirmar nada
- Buscador con filtros por:
  - Fecha
  - ID único
  - Número de pedido
- Por cada pedido, debe mostrar en qué **batea** (transporte/expedición concreta) llegó y cuándo.
  Ejemplo: pedido `286676` → llegó en la batea del `27/07/2026 18:00`

---

## Identidad visual

- Nombre de la aplicación: **HODOS**
- Empresa: Taisa Logistics (logo adjunto)
- Tres temas visuales a soportar (seleccionables):
  1. **Black Edition**: fondo `#080a10`, acento rojo `#e30613` (línea Taisa corporativa existente)
  2. **Rojo/Verde vivo**: fondo blanco, acentos en rojo y verde vivos
  3. **Gris/Blanco**: minimalista, fondo blanco, acentos en gris

Nota: el resto de herramientas GAS de Pedro ya usan el sistema Black Edition (`#080a10` + `#e30613`, tipografía Bebas Neue + DM Sans), por si se quiere mantener coherencia entre HODOS y el resto del ecosistema.

---

## Stack técnico — a decidir con Claude Code

Puntos a tener en cuenta para la decisión de stack:

- Entorno corporativo restringido (Google Workspace, sin Node.js/clasp en el PC corporativo, OAuth de terceros bloqueado)
- Fuente de datos de entrada: Google Sheets
- Almacenamiento/visualización deseado: Google Drive
- Integración bidireccional con otra herramienta ya existente (Carta de Portes SIE, construida en Google Apps Script)
- Necesidad de impresión directa a Zebra (formato de etiqueta 15x10 cm horizontal)
- Generación de códigos de barra (CODE128)
- Posible uso desde móvil/tablet para el escaneo en la carga del camión

Referencia de estilo de trabajo: Pedro no tiene background de programación, construye de forma iterativa con asistencia de IA. Prefiere archivos completos listos para pegar, cambios quirúrgicos que no rompan funcionalidad existente, sin relleno.

---

## Adjuntos de referencia

- `logo_taisa.png` — logo de Taisa Logistics para la etiqueta
- Demos HTML previas ya validadas por Pedro (interfaz de carga por lote + etiqueta con 3 temas) — usar como referencia de UX/diseño, no como código final de producción
