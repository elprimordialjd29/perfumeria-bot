/**
 * agente.js — Chu, asistente personal de ventas
 * Entiende lenguaje natural y ejecuta acciones reales en VectorPOS
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const monitor = require('./monitor-pos');
const db = require('./database');
const fs = require('fs');
const os = require('os');
const path = require('path');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Groq es opcional — si no hay key, se usa solo Claude
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const historial = [];

/**
 * Ejecuta una función de inventario y, si retorna 0 productos,
 * adjunta el diagnóstico de scraping directamente en el mensaje.
 */
async function withInvDiag(fn) {
  const resultado = await fn();
  const diag = monitor.obtenerDiagInventario();
  if (diag) {
    const txt = typeof resultado === 'string' ? resultado : (resultado || '');
    return txt + '\n\n' + diag;
  }
  return resultado;
}

function formatFechaHora(fechaStr) {
  if (!fechaStr) return '';
  const match = fechaStr.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return fechaStr;
  let h = parseInt(match[2]);
  const m = match[3];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${match[1]} ${h}:${m} ${ampm}`;
}

const SYSTEM_PROMPT = `Eres Chu, asistente personal de ventas de una perfumería colombiana en Colombia.
Eres inteligente, directo y amable. Solo respondes en español colombiano.
Tienes conexión en tiempo real a VectorPOS (ventas, inventario, cajeros).

━━━ REGLA DE ORO — NUNCA INVENTES DATOS ━━━
JAMÁS inventes ni adivines cifras del negocio: ventas, inventario, unidades, tickets, cajeros, gastos.
Si te preguntan algo con números del negocio, SIEMPRE usa una etiqueta para consultar VectorPOS.
Inventar datos confunde al dueño y destruye la confianza. Si no hay etiqueta disponible, di:
"Déjame consultar el sistema" y usa [INVENTARIO] o [REPORTE_HOY] según corresponda.

━━━ ACCIÓN INMEDIATA — SIN PREGUNTAS ━━━
Cuando el usuario mencione una categoría o tipo de consulta, EJECUTA LA ETIQUETA DE INMEDIATO.
NO hagas preguntas de seguimiento. NO expliques lo que vas a hacer. NO pidas confirmación.
Una sola palabra como "esencias", "envases", "originales", "ventas", "hoy" → dispara la etiqueta directamente.
Ejemplos de acción inmediata:
"esencias" → [INVENTARIO_CAT:ESENCIAS]
"envases" → [INVENTARIO_CAT:ENVASE]
"ventas hoy" → [REPORTE_HOY]
"originales" → [INVENTARIO_CAT:ORIGINALES]
Tu respuesta debe COMENZAR con la etiqueta, nada antes.

━━━ ETIQUETAS — USA UNA AL INICIO cuando necesites datos del negocio ━━━

[REPORTE_GENERAL]   → reporte general, resumen completo, dame todo, cómo vamos, estado general, reporte matutino
[REPORTE_HOY]       → ventas hoy, cómo vamos hoy, resumen hoy
[REPORTE_MES]       → este mes, meta mensual, avance del mes
[REPORTE_MES_ANT]   → mes pasado
[REPORTE_SEMANA]    → esta semana
[REPORTE_RANGO:YYYY-MM-DD:YYYY-MM-DD] → rango de fechas. Convierte DD-MM-YYYY → YYYY-MM-DD. Una sola fecha: úsala como desde y hasta. NUNCA pidas fechas de nuevo si ya las dio.
[PRODUCTOS_MES]     → productos más/menos vendidos del mes, ranking perfumes
[PRODUCTOS_HOY]     → productos vendidos hoy
[MEDIOS_PAGO_HOY]   → efectivo/transferencias hoy
[MEDIOS_PAGO_MES]   → efectivo/transferencias del mes
[QUIEN_TRABAJO]     → quién trabajó hoy
[RANKING_HOY]       → ranking cajeros hoy
[RANKING_SEM]       → ranking cajeros semana
[RANKING_MES]       → ranking cajeros mes
[INVENTARIO]        → inventario general, stock total, alertas de productos bajos (SIN costos)
[INVENTARIO_CAT:categoria] → stock e inventario bajo de UNA categoría. Mapeo EXACTO:
  "esencias" / "todas las esencias" / "esencias juntas" → [INVENTARIO_CAT:ESENCIAS]
  "esencias masculinas" / "masculinas" / "hombre" → [INVENTARIO_CAT:ESENCIAS M]
  "esencias femeninas" / "femeninas" / "mujer" → [INVENTARIO_CAT:ESENCIAS F]
  "esencias unisex" / "unisex" / "esencias u" / "la u" / "neutras" / "u" → [INVENTARIO_CAT:ESENCIAS U]
  "réplicas" / "replicas" / "1.1" → [INVENTARIO_CAT:REPLICA 1.1]
  "originales" → [INVENTARIO_CAT:ORIGINALES]
  "envases" / "envase" → [INVENTARIO_CAT:ENVASE]
  "insumos" / "alcohol" / "insumos varios" → [INVENTARIO_CAT:INSUMOS VARIOS]
  "cremas" / "crema corporal" → [INVENTARIO_CAT:CREMA CORPORAL]
[RESTOCK]           → qué falta, qué se acabó, qué no hay, qué se agotó — SOLO productos con saldo = 0
[RESTOCK_TODO]      → todo el restock, restock completo, todos los bajos, cuánto costaría reponer todo, inversión total para restock
[INVENTARIO_TODO]   → todo el inventario, inventario completo, todos los productos con su stock, estock total
[VENTAS_INVENTARIO] → reporte completo ventas vs inventario de TODOS los productos: stock actual + vendido este mes, ordenado por más vendido
[FALTANTES]         → cruce ventas vs inventario POR CATEGORÍA (envases, esencias, originales, réplicas, insumos). Detecta inconsistencias: productos vendidos que no aparecen en inventario, vendido > stock actual (posible faltante/pérdida). Úsalo cuando pregunten por faltantes de mercancía, si las ventas cuadran, si se está perdiendo mercancía, si los envases/esencias/originales cuadran
[BALANCE]           → balance crítico de inventario: productos que se van a agotar pronto según ritmo actual de ventas. Úsalo cuando pregunten cuánto dura el stock, qué se va a acabar, alertas de velocidad, qué reponer urgente
[CRUCE_PRODUCTO:texto] → cruce ventas+inventario de UN producto este mes y hoy. Extrae el término clave. Ej: "cuánto queda de tapa plana 10ml" → [CRUCE_PRODUCTO:tapa plana 10ml] | "single color" → [CRUCE_PRODUCTO:singler color] | "tapa plana 50ml vendido y stock" → [CRUCE_PRODUCTO:tapa plana 50ml]
[CRUCE_PRODUCTO_RANGO:texto:YYYY-MM-DD:YYYY-MM-DD] → cuánto se vendió de un producto en un período específico + stock actual. Convierte fechas relativas a YYYY-MM-DD. Ej:
  "cuánto se vendió de singler color ayer" → [CRUCE_PRODUCTO_RANGO:singler color:AYER:AYER]
  "tapa plana 50ml la semana pasada" → [CRUCE_PRODUCTO_RANGO:tapa plana 50ml:LUNES:HOY]
  "cuánto se vendió de lattafa el mes pasado" → [CRUCE_PRODUCTO_RANGO:lattafa:INICIO_MES_ANT:FIN_MES_ANT]
  "singler color del 1 al 7 de abril" → [CRUCE_PRODUCTO_RANGO:singler color:2026-04-01:2026-04-07]
  USA las variables HOY/AYER/ANTIER/LUNES/INICIO_MES_ANT/FIN_MES_ANT que el sistema reemplaza automáticamente.
[CAJERO_HOY:nombre]              → cuánto vendió [nombre] hoy. Ej: "cuánto vendió Michelle hoy" → [CAJERO_HOY:michelle]
[CAJERO_SEM:nombre]              → cuánto vendió [nombre] esta semana. Ej: "cuánto vendió Moisés esta semana" → [CAJERO_SEM:moises]
[CAJERO_MES:nombre]              → cuánto vendió [nombre] este mes. Ej: "ventas de Laura este mes" → [CAJERO_MES:laura]
[CAJERO_MES_ANT:nombre]         → cuánto vendió [nombre] el mes pasado. Ej: "cuánto vendió Moisés el mes pasado" → [CAJERO_MES_ANT:moises]
[CAJERO_RANGO:nombre:YYYY-MM-DD:YYYY-MM-DD] → cuánto vendió [nombre] en un rango. Ej: "ventas de Michelle del 1 al 7 de abril" → [CAJERO_RANGO:michelle:2026-04-01:2026-04-07]
[GASTOS]            → gastos, egresos, nómina
[CAJA_HOY]          → movimiento de caja hoy
[CAJA_SEM]          → movimiento de caja esta semana
[CAJA_MES]          → movimiento de caja este mes, cierres del mes
[CAJA_RANGO:YYYY-MM-DD:YYYY-MM-DD] → movimiento de caja en un rango de fechas
[CAJA_PERSONA:nombre:YYYY-MM-DD:YYYY-MM-DD] → movimiento de caja de una persona. Las fechas son opcionales (default: este mes). Ej: "caja de Moises esta semana" → [CAJA_PERSONA:moises:LUNES:HOY] | "caja de Michelle este mes" → [CAJA_PERSONA:michelle]
[CAJA]              → igual que [CAJA_MES]
[VENTAS_HORA]       → ventas por hora, hora pico
[REQUERIMIENTO]     → crear requerimiento, nota, tarea
[VER_REQS]          → ver requerimientos pendientes
[EXPORTAR_EXCEL]    → exportar Excel, CSV, archivo
[AGREGAR_USUARIO:chatid:nombre] → agregar usuario autorizado. Ej: "agrega al usuario 123456 como Laura" → [AGREGAR_USUARIO:123456:Laura] (SOLO ADMIN)
[VER_USUARIOS]      → ver usuarios autorizados, quién tiene acceso (SOLO ADMIN)
[QUITAR_USUARIO:chatid] → quitar acceso a un usuario (SOLO ADMIN)
[MENU]              → saludos: hola, buenos días, buenas, hey

━━━ CATEGORÍAS DEL NEGOCIO ━━━
El inventario se organiza en estas categorías:
- ESENCIAS M → esencias masculinas (perfumes hombre)
- ESENCIAS F → esencias femeninas (perfumes mujer)
- ESENCIAS U → esencias unisex
- REPLICA 1.1 → réplicas/clones de perfumes de marca
- ORIGINALES → perfumes originales de marca
- ENVASE → envases, frascos, tapaderas (tapa plana, singler, beirut, bomba, cartier, etc.)
- INSUMOS VARIOS → alcohol, materiales de producción, maletines, perfumeros
- CREMA CORPORAL → cremas y lociones

Cuando el usuario pregunte por una categoría, usa el nombre exacto: "esencias masculinas" → ESENCIAS M, "esencias u" / "unisex" / "neutras" → ESENCIAS U, "réplicas" → REPLICA 1.1, "envases" → ENVASE, etc.

━━━ CONOCIMIENTO PROPIO (SIN etiqueta, SIN inventar datos del negocio) ━━━
Responde directamente SOLO para:
- Perfumes árabes y marcas: Lattafa, Al Haramain, Ajmal, Rasasi, Swiss Arabian, Armaf, Nabeel
- Clones/dupes: Lattafa Asad ≈ Sauvage, Khamrah ≈ Spicebomb, etc.
- Recomendaciones por género, ocasión, presupuesto, notas olfativas
- Ingredientes: oud, musk, sándalo, bergamota, rosa, jazmín, ámbar
- Consejos de venta y cómo describir fragancias

━━━ EJEMPLOS CORRECTOS ━━━
"todo el inventario" → [INVENTARIO_TODO]
"inventario completo" → [INVENTARIO_TODO]
"todos los productos" → [INVENTARIO_TODO]
"estock total" → [INVENTARIO_TODO]
"qué perfumes tenemos en inventario" → [INVENTARIO]
"alertas de inventario" → [INVENTARIO]
"qué falta de ENVASE" → [INVENTARIO_CAT:ENVASE]
"qué falta de esencias" → [INVENTARIO_CAT:ESENCIAS]
"esencias masculinas bajas" → [INVENTARIO_CAT:ESENCIAS M]
"esencias femeninas bajas" → [INVENTARIO_CAT:ESENCIAS F]
"réplicas bajas" → [INVENTARIO_CAT:REPLICA 1.1]
"qué falta de originales" → [INVENTARIO_CAT:ORIGINALES]
"insumos bajos" → [INVENTARIO_CAT:INSUMOS VARIOS]
"cremas bajas" → [INVENTARIO_CAT:CREMA CORPORAL]
"qué falta" → [RESTOCK]
"qué se acabó" → [RESTOCK]
"qué no hay" → [RESTOCK]
"todo el restock" → [RESTOCK_TODO]
"restock completo" → [RESTOCK_TODO]
"qué falta y cuánto cuesta todo" → [RESTOCK_TODO]
"cuánto necesito para reponer el inventario" → [RESTOCK_TODO]
"cuánto costaría el restock" → [RESTOCK_TODO]
"ventas vs inventario de todo" → [VENTAS_INVENTARIO]
"dame el estado del inventario" → [VENTAS_INVENTARIO]
"estado del inventario" → [VENTAS_INVENTARIO]
"ventas vs inventario" → [VENTAS_INVENTARIO]
"cuadra el inventario" → [FALTANTES]
"faltante de mercancía" → [FALTANTES]
"falta de envases" → [FALTANTES]
"falta de esencias" → [FALTANTES]
"falta de originales" → [FALTANTES]
"se está perdiendo mercancía" → [FALTANTES]
"las ventas cuadran" → [FALTANTES]
"balance" → [BALANCE]
"balance crítico" → [BALANCE]
"qué se va a acabar" → [BALANCE]
"pérdidas potenciales" → [BALANCE]
"qué debo reponer urgente" → [BALANCE]
"cuántas unidades de Lattafa quedan" → [CRUCE_PRODUCTO:lattafa]
"tapa plana de 10ml" → [CRUCE_PRODUCTO:tapa plana 10ml]
"single color" → [CRUCE_PRODUCTO:singler color]
"dame el estado de singler color" → [CRUCE_PRODUCTO:singler color]
"dame el estado de envase singler" → [CRUCE_PRODUCTO:singler]
"estado de tapa plana 50ml" → [CRUCE_PRODUCTO:tapa plana 50ml]
"cómo va la singler color" → [CRUCE_PRODUCTO:singler color]
"cuánto alcohol queda" → [CRUCE_PRODUCTO:alcohol]
"originales cuántos quedan y cuántos se vendieron" → [CRUCE_PRODUCTO:original]
"tapa plana 50ml vendido y stock" → [CRUCE_PRODUCTO:tapa plana 50ml]
"cuánto se vendió de singler color ayer" → [CRUCE_PRODUCTO_RANGO:singler color:AYER:AYER]
"cuánto se vendió de tapa plana 50ml la semana pasada" → [CRUCE_PRODUCTO_RANGO:tapa plana 50ml:LUNES:HOY]
"lattafa el mes pasado" → [CRUCE_PRODUCTO_RANGO:lattafa:INICIO_MES_ANT:FIN_MES_ANT]
"singler color esta semana" → [CRUCE_PRODUCTO_RANGO:singler color:LUNES:HOY]
"estado de singler color ayer" → [CRUCE_PRODUCTO_RANGO:singler color:AYER:AYER]
"cómo va la tapa plana esta semana" → [CRUCE_PRODUCTO_RANGO:tapa plana:LUNES:HOY]
"qué se vendió más este mes" → [PRODUCTOS_MES]
"ventas de hoy" → [REPORTE_HOY]
"gastos del mes" → [GASTOS]
"cuál es el mejor perfume árabe" → (responde con conocimiento, sin inventar stock)
"hola" → [MENU]
"ventas del 1 al 7 de abril" → [REPORTE_RANGO:2026-04-01:2026-04-07]
"cuánto vendió Michelle hoy" → [CAJERO_HOY:michelle]
"cuánto vendió Moisés esta semana" → [CAJERO_SEM:moises]
"ventas de Laura este mes" → [CAJERO_MES:laura]
"cuánto vendió Moisés el mes pasado" → [CAJERO_MES_ANT:moises]
"ventas de Michelle del 1 al 7 de abril" → [CAJERO_RANGO:michelle:2026-04-01:2026-04-07]

━━━ REDES SOCIALES ━━━
"checklist de hoy" / "qué toca publicar hoy" → [CONTENIDO_HOY]
"checklist de la semana" / "cómo va el contenido esta semana" → [CONTENIDO_SEMANA]
"ya publiqué en whatsapp" / "listo instagram" / "subí tiktok" → [CONTENIDO_MARCAR:whatsapp] / [CONTENIDO_MARCAR:instagram] / [CONTENIDO_MARCAR:tiktok]

━━━ ANÁLISIS LIBRE CON CLAUDE ━━━
Cuando el usuario pida algo que NO encaja en ninguna etiqueta anterior (análisis comparativos, preguntas complejas, proyecciones, estrategias de negocio, combinaciones de datos, "crea un reporte de...", "analiza...", "compara...", "cuánto necesito para...", "si vendiera X qué pasaría", etc.) → usa:
[ANALISIS:consulta completa del usuario tal como la escribió]

Ejemplos de cuándo usar [ANALISIS:]:
"¿cuánto tendría que vender cada día para llegar a la meta?" → [ANALISIS:cuánto tendría que vender cada día para llegar a la meta]
"compara las ventas de esta semana con la semana pasada" → [ANALISIS:compara ventas semana actual vs semana pasada]
"dame un análisis de rentabilidad del mes" → [ANALISIS:análisis de rentabilidad del mes]
"cuántos días me dura el stock si sigo vendiendo igual" → [ANALISIS:días de stock restantes a ritmo actual]
"qué perfumes árabes son los más rentables" → [ANALISIS:perfumes árabes más rentables]
"crea un reporte de cajeros del mes con comparativo" → [ANALISIS:reporte cajeros mes con comparativo]
"analiza si es bueno pedir más esencias ahora" → [ANALISIS:análisis si conviene pedir más esencias]
"tengo $500.000 para invertir en inventario, qué compro" → [ANALISIS:inversión de $500.000 en inventario qué comprar]
SOLO usa [ANALISIS:] cuando genuinamente no haya otra etiqueta más específica. Es el último recurso para preguntas complejas que necesitan razonamiento.`;


// ──────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ──────────────────────────────────────────────

// Estado de conversación
let esperandoEleccion      = false;
let esperandoRequerimiento = false;

function activarEsperaEleccion() {
  esperandoEleccion = true;
}

// Mapa de números/letras de menú a acciones directas
const MENU_ACCIONES = {
  // ── VENTAS ──
  '1':  '[REPORTE_HOY]',
  '2':  '[REPORTE_MES]',
  '3':  '[REPORTE_MES_ANT]',
  '4':  '[REPORTE_SEMANA]',
  '5':  '[REPORTE_RANGO]',
  '6':  '[REPORTE_GENERAL]',
  // ── CAJEROS ──
  '7':  '[QUIEN_TRABAJO]',
  '8':  '[RANKING_MES]',
  '9':  '[VENTAS_HORA]',
  '10': '[MEDIOS_PAGO_HOY]',
  // ── CAJA ──
  '11': '[CAJA_HOY]',
  '12': '[CAJA_SEM]',
  '13': '[CAJA_MES]',
  // ── PRODUCTOS ──
  '14': '[PRODUCTOS_MES]',
  '15': '[VENTAS_INVENTARIO]',
  // ── INVENTARIO ──
  '16': '[INVENTARIO]',
  '17': '[INVENTARIO_CAT:ESENCIAS]',
  '28': '[INVENTARIO_CAT:ESENCIAS M]',
  '29': '[INVENTARIO_CAT:ESENCIAS F]',
  '30': '[INVENTARIO_CAT:ESENCIAS U]',
  '18': '[INVENTARIO_CAT:ENVASE]',
  '19': '[INVENTARIO_CAT:ORIGINALES]',
  '20': '[INVENTARIO_CAT:REPLICA 1.1]',
  '21': '[RESTOCK_TODO]',
  // ── ANÁLISIS / CRUCE ──
  '25': '[FALTANTES]',
  '26': '[BALANCE]',
  '27': '[ANALISIS:análisis completo del negocio: ventas, inventario, proyecciones y recomendaciones]',
  // ── GASTOS ──
  '22': '[GASTOS]',
  // ── REDES SOCIALES ──
  '23': '[CONTENIDO_HOY]',
  '24': '[CONTENIDO_SEMANA]',
  // ── ADMIN ──
  'r':  '[REQUERIMIENTO]',
  'R':  '[REQUERIMIENTO]',
  'v':  '[VER_REQS]',
  'V':  '[VER_REQS]',
  'e':  '[EXPORTAR_EXCEL]',
  'E':  '[EXPORTAR_EXCEL]',
};

/** Retorna objeto con fechas de referencia relativas */
// Colombia = UTC-5 (sin horario de verano)
function ahoraColombia() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000);
}

function fechasRelativas() {
  const hoy   = ahoraColombia();
  const ayer  = new Date(hoy); ayer.setUTCDate(hoy.getUTCDate() - 1);
  const antier= new Date(hoy); antier.setUTCDate(hoy.getUTCDate() - 2);
  const diasDesdeElLunes = hoy.getUTCDay() === 0 ? 6 : hoy.getUTCDay() - 1;
  const lunes = new Date(hoy); lunes.setUTCDate(hoy.getUTCDate() - diasDesdeElLunes);
  const fmt = d => d.toISOString().split('T')[0];
  return { hoy: fmt(hoy), ayer: fmt(ayer), antier: fmt(antier), lunes: fmt(lunes) };
}

/**
 * Detecta expresiones de fecha relativa y retorna el tag [REPORTE_RANGO:...] listo
 * para ejecutar sin pasar por Groq.
 */
function detectarFechaRelativa(texto) {
  const t = texto.toLowerCase().trim();
  const r = fechasRelativas();

  // Patrones relativos simples
  const patrones = [
    // ayer (con o sin "ventas", "reporte", "de")
    [/^(reporte\s+)?(ventas?\s+)?(de\s+|del?\s+)?ayer(\s+nada\s+m[aá]s)?$/, r.ayer, r.ayer],
    [/(ventas?\s+)?(del?\s+)?ayer\s+y\s+hoy/,           r.ayer, r.hoy],
    [/(ventas?\s+)?(del?\s+)?ayer\s+(a|hasta|y)\s+hoy/, r.ayer, r.hoy],
    // antier
    [/^(reporte\s+)?(ventas?\s+)?(de\s+)?antier$/, r.antier, r.antier],
    [/antier\s+(a|hasta|y)\s+hoy/,   r.antier, r.hoy],
    [/antier\s+(a|hasta|y)\s+ayer/,  r.antier, r.ayer],
    // hoy explícito
    [/^(reporte\s+)?(ventas?\s+)?(de\s+)?hoy$/, r.hoy, r.hoy],
  ];

  for (const [regex, desde, hasta] of patrones) {
    if (regex.test(t)) return `[REPORTE_RANGO:${desde}:${hasta}]`;
  }
  return null;
}

/**
 * Extrae fechas de texto en varios formatos:
 * - DD-MM-YYYY / DD/MM/YYYY  → convierte a YYYY-MM-DD
 * - YYYY-MM-DD  → ya en formato correcto
 * Retorna { desde, hasta } o null
 */
function parsearFechasDeTexto(texto) {
  // YYYY-MM-DD
  const isoMatches = [...texto.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
  if (isoMatches.length >= 2) return { desde: isoMatches[0], hasta: isoMatches[1] };
  if (isoMatches.length === 1) return { desde: isoMatches[0], hasta: isoMatches[0] };

  // DD-MM-YYYY o DD/MM/YYYY
  const dmyMatches = [...texto.matchAll(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g)];
  if (dmyMatches.length >= 2) {
    const f1 = `${dmyMatches[0][3]}-${dmyMatches[0][2].padStart(2,'0')}-${dmyMatches[0][1].padStart(2,'0')}`;
    const f2 = `${dmyMatches[1][3]}-${dmyMatches[1][2].padStart(2,'0')}-${dmyMatches[1][1].padStart(2,'0')}`;
    return { desde: f1, hasta: f2 };
  }
  if (dmyMatches.length === 1) {
    const f = `${dmyMatches[0][3]}-${dmyMatches[0][2].padStart(2,'0')}-${dmyMatches[0][1].padStart(2,'0')}`;
    return { desde: f, hasta: f };
  }
  return null;
}

async function procesarMensaje(texto, esAdmin = true) {
  const t = texto.trim();

  // ── Estado: esperando descripción de un requerimiento ──
  if (esperandoRequerimiento) {
    esperandoRequerimiento = false;
    return await guardarNuevoRequerimiento(texto);
  }

  // ── Elección inicial (después del saludo de bienvenida) ──
  if (esperandoEleccion) {
    esperandoEleccion = false;
    if (t === '1') {
      return mensajeMenu();
    }
    if (t === '2') {
      return '¡Perfecto! Pregúntame lo que necesites 😊\n\n_Puedes pedirme ventas, inventario, cajeros, gastos, o cualquier duda sobre perfumes._';
    }
    // Si escribió otra cosa, dejar que siga el flujo normal abajo
  }

  const tLow = t.toLowerCase().trim();

  // Atajo directo por número de menú
  if (MENU_ACCIONES[t]) {
    const accion = MENU_ACCIONES[t];
    historial.push({ role: 'user', content: texto });
    historial.push({ role: 'assistant', content: accion });
    return await ejecutarAccion(accion);
  }

  // ── Palabras rápidas ──
  const palabrasRapidas = {
    'hoy':        '[REPORTE_HOY]',
    'mes':        '[REPORTE_MES]',
    'semana':     '[REPORTE_SEMANA]',
    'inventario': '[INVENTARIO]',
    'restock':    '[RESTOCK]',
    'gastos':     '[GASTOS]',
    'cajeros':        '[RANKING_MES]',
    'caja':           '[CAJA_HOY]',
    'menu':           '[MENU]',
    'menú':           '[MENU]',
    'esencias':       '[INVENTARIO_CAT:ESENCIAS]',
    'envases':        '[INVENTARIO_CAT:ENVASE]',
    'originales':     '[INVENTARIO_CAT:ORIGINALES]',
    'replicas':       '[INVENTARIO_CAT:REPLICA 1.1]',
    'réplicas':       '[INVENTARIO_CAT:REPLICA 1.1]',
    'redes':          '[CONTENIDO_HOY]',
    'balance':        '[BALANCE]',
    'faltantes':      '[FALTANTES]',
    'analisis':       '[ANALISIS:análisis completo del negocio hoy]',
    'análisis':       '[ANALISIS:análisis completo del negocio hoy]',
    'analiza':        '[ANALISIS:análisis completo del negocio hoy]',
    // Comandos slash mapeados directamente
    'mes anterior':   '[REPORTE_MES_ANT]',
    'mesanterior':    '[REPORTE_MES_ANT]',
    'reporte general':'[REPORTE_GENERAL]',
    'general':        '[REPORTE_GENERAL]',
    'hora pico':      '[VENTAS_HORA]',
    'horapico':       '[VENTAS_HORA]',
    'productos más vendidos': '[PRODUCTOS_MES]',
    'productos':      '[PRODUCTOS_MES]',
    'restock completo': '[RESTOCK_TODO]',
  };
  if (palabrasRapidas[tLow]) {
    const accion = palabrasRapidas[tLow];
    historial.push({ role: 'user', content: texto });
    historial.push({ role: 'assistant', content: accion });
    return await ejecutarAccion(accion);
  }

  // Detectar "ayer", "antier", "ayer y hoy", "antier a hoy" directamente
  const tagRelativo = detectarFechaRelativa(texto);
  if (tagRelativo) {
    historial.push({ role: 'user', content: texto });
    historial.push({ role: 'assistant', content: tagRelativo });
    return await ejecutarAccion(tagRelativo);
  }

  // ── Detección directa: CAJA con período ──
  if (/^caja\s+(de\s+)?hoy$/.test(tLow))                           return await ejecutarAccion('[CAJA_HOY]');
  if (/^caja\s+(de\s+)?ayer$/.test(tLow)) {
    const r = fechasRelativas();
    return await ejecutarAccion(`[CAJA_RANGO:${r.ayer}:${r.ayer}]`);
  }
  if (/^caja\s+(de\s+)?(esta\s+)?semana$/.test(tLow))              return await ejecutarAccion('[CAJA_SEM]');
  if (/^caja\s+(de\s+)?(este\s+)?mes$/.test(tLow))                 return await ejecutarAccion('[CAJA_MES]');
  if (/^caja\s+(de\s+)?antier$/.test(tLow)) {
    const r = fechasRelativas();
    return await ejecutarAccion(`[CAJA_RANGO:${r.antier}:${r.antier}]`);
  }

  // ── Detección directa: checklist de contenido ──

  // "plan de redes la otra semana / próxima semana / siguiente semana"
  if (/plan.*redes.*(otra|pr[oó]xima|siguiente)\s+semana|(otra|pr[oó]xima|siguiente)\s+semana.*redes/.test(tLow)) {
    return await planContenidoSemana(7);
  }
  // "redes sociales para esta semana" / "plan de redes" → PLAN con copies
  if (/redes\s+sociales|plan.*redes|redes.*semana/.test(tLow)) {
    return await planContenidoSemana();
  }
  // "checklist semana" → estado de publicaciones
  if (/checklist.*(semana)|contenido.*semana|semana.*contenido/.test(tLow)) {
    return await checklistContenidoSemana();
  }
  // "checklist hoy" / "contenido de hoy" / "qué toca hoy" (sin "semana")
  if (/checklist|contenido\s+(de\s+)?hoy|publicar\s+hoy|qu[eé]\s+toca\s+hoy/.test(tLow) && !/semana/.test(tLow)) {
    return await checklistContenidoHoy();
  }
  // "mañana" → contenido de mañana
  if (/^(contenido\s+(de\s+)?)?ma[ñn]ana$/.test(tLow)) {
    return await checklistContenidoDia(1);
  }
  // "pasado mañana" → contenido en 2 días
  if (/pasado\s+ma[ñn]ana/.test(tLow)) {
    return await checklistContenidoDia(2);
  }
  // Marcar como publicado: "listo whatsapp", "ya publiqué en instagram", etc.
  const marcarMatch = tLow.match(/(?:listo|ya\s+public[oó]?|public[aó]|mont[oó]|subi[oó]).*?(whatsapp|instagram|tiktok|insta|wha?t?s?)/i)
    || tLow.match(/(whatsapp|instagram|tiktok|insta)\s*(?:listo|ya|ok|done|✓|✅)/i);
  if (marcarMatch) {
    const redRaw = (marcarMatch[1] || marcarMatch[2] || '').toLowerCase();
    const red = redRaw.startsWith('insta') ? 'instagram' : redRaw.startsWith('wha') ? 'whatsapp' : 'tiktok';
    return await marcarContenidoDirecto(red);
  }

  // ── Detección directa: ventas por período ──
  if (/ventas?\s+(de\s+)?(este\s+)?mes/.test(tLow))                   return await ejecutarAccion('[REPORTE_MES]');
  if (/ventas?\s+(de\s+)?(esta\s+)?semana/.test(tLow))                return await ejecutarAccion('[REPORTE_SEMANA]');
  if (/ventas?\s+(de\s+)?hoy/.test(tLow))                             return await ejecutarAccion('[REPORTE_HOY]');
  if (/ventas?\s+(de\s+)?ayer/.test(tLow)) {
    const r = fechasRelativas();
    return await ejecutarAccion(`[REPORTE_RANGO:${r.ayer}:${r.ayer}]`);
  }

  // ── Detección directa: cruce ventas vs inventario / faltantes ──
  if (/ventas?\s*(vs?\.?\s*|versus\s*|contra\s*)inventario|cruce.*inventario|inventario.*ventas|cuadra.*inventario|inventario.*cuadra/.test(tLow)) {
    return await ejecutarAccion('[VENTAS_INVENTARIO]');
  }
  if (/faltante.*mercanc[ií]a|mercanc[ií]a.*faltante|se.*perdi[oó].*mercanc[ií]a|p[eé]rdida.*mercanc[ií]a|falta.*envase|falta.*esencia|falta.*original|cuadra.*ventas|ventas.*cuadra/.test(tLow)) {
    return await cruceFaltantesCategorias();
  }

  // ── Detección directa: balance crítico / inventario urgente ──
  if (/^balance$|balance\s+(cr[ií]tico|inventario|total)|faltantes?\s+cr[ií]ticos?|p[eé]rdidas?\s+potenciales?|qu[eé]\s+se\s+va\s+a?\s+acabar|alertas?\s+de\s+velocidad|reponer\s+urgente/.test(tLow)) {
    return await ejecutarAccion('[BALANCE]');
  }

  // ── Detección directa: preguntas sobre el bot mismo / capacidades ──
  if (/qu[eé]\s+(puedes?|sab[eé]s?|hac[eé]s?)|c[oó]mo\s+(te\s+)?(uso|utilizo|configuro|coloco|pongo|funciona)|qu[eé]\s+comandos?|ayuda|help|capacidades?|qu[eé]\s+tienes?/.test(tLow)) {
    agente.activarEsperaEleccion && agente.activarEsperaEleccion();
    esperandoEleccion = true;
    return mensajeBienvenida();
  }

  // Fix [REPORTE_RANGO]: si el bot estaba esperando fechas, extráelas directamente
  const ultimoBot = [...historial].reverse().find(h => h.role === 'assistant');
  if (ultimoBot && (ultimoBot.content.includes('REPORTE_RANGO') || ultimoBot.content.includes('rango de fechas'))) {
    const fechas = parsearFechasDeTexto(texto);
    if (fechas) {
      historial.push({ role: 'user', content: texto });
      const tag = `[REPORTE_RANGO:${fechas.desde}:${fechas.hasta}]`;
      historial.push({ role: 'assistant', content: tag });
      return await ejecutarAccion(tag);
    }
  }

  historial.push({ role: 'user', content: texto });
  if (historial.length > 14) historial.shift();

  const r = fechasRelativas();
  const contextoFechas = `\n\nCONTEXTO ACTUAL: Hoy es ${r.hoy} (${new Date().toLocaleDateString('es-CO',{weekday:'long'})}). Ayer fue ${r.ayer}. Antier fue ${r.antier}. Esta semana va del lunes ${r.lunes} al ${r.hoy}.`;
  const restriccion = esAdmin ? '' : '\n\nNOTA: Este usuario NO es el administrador. NO uses etiquetas de administración: [AGREGAR_USUARIO], [VER_USUARIOS], [QUITAR_USUARIO], [REQUERIMIENTO], [VER_REQS], [EXPORTAR_EXCEL].';
  const systemFull = SYSTEM_PROMPT + contextoFechas + restriccion;

  // ── Intentar Claude Haiku primero ──
  try {
    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: systemFull,
      messages: historial,
    });
    const raw = resp.content[0].text.trim();
    historial.push({ role: 'assistant', content: raw });
    return await ejecutarAccion(raw);
  } catch (e) {
    if (e?.status === 429) return '⏳ Demasiadas consultas. Espera unos segundos.';
    console.error('⚠️ Claude Haiku falló:', e?.message, '— intentando Groq...');
  }

  // ── Fallback: Groq si Claude falla ──
  if (groq) {
    try {
      const gr = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemFull },
          ...historial,
        ],
      });
      const raw = gr.choices[0]?.message?.content?.trim() || '';
      if (raw) {
        historial.push({ role: 'assistant', content: raw });
        return await ejecutarAccion(raw);
      }
    } catch (eg) {
      console.error('⚠️ Groq también falló:', eg?.message);
    }
  }

  // ── Último recurso: respuesta directa sin API ──
  return `Lo siento, no pude procesar eso ahora mismo.\n\nEscribe *menú* o / para ver qué puedo hacer por ti.`;
}

async function ejecutarAccion(rawOriginal) {
    // Normalizar: si Claude omitió los corchetes, agregarlos
    let raw = rawOriginal.trim();
    if (!raw.startsWith('[')) {
      // Buscar si empieza con un tag conocido sin corchetes
      const tagMatch = raw.match(/^(REPORTE_RANGO|REPORTE_HOY|REPORTE_MES|REPORTE_SEMANA|REPORTE_MES_ANT|REPORTE_GENERAL|INVENTARIO_CAT|INVENTARIO|RESTOCK|VENTAS_INVENTARIO|CRUCE_PRODUCTO_RANGO|CRUCE_PRODUCTO|CAJERO_HOY|CAJERO_SEM|CAJERO_MES|CAJERO_MES_ANT|CAJERO_RANGO|PRODUCTOS_MES|PRODUCTOS_HOY|MEDIOS_PAGO_HOY|MEDIOS_PAGO_MES|QUIEN_TRABAJO|RANKING_HOY|RANKING_SEM|RANKING_MES|GASTOS|CAJA|VENTAS_HORA|REQUERIMIENTO|VER_REQS|EXPORTAR_EXCEL|AGREGAR_USUARIO|VER_USUARIOS|QUITAR_USUARIO|MENU|AYUDA|CONTENIDO_HOY|CONTENIDO_SEMANA|CONTENIDO_MARCAR)[:|\]]/);
      if (tagMatch) raw = '[' + raw + (raw.includes(']') ? '' : ']');
    }

    // ── Contenido redes sociales ──
    if (raw.startsWith('[CONTENIDO_HOY]')) return await checklistContenidoHoy();
    if (raw.startsWith('[CONTENIDO_SEMANA]')) return await checklistContenidoSemana();
    if (raw.startsWith('[CONTENIDO_MARCAR:')) {
      const red = raw.match(/\[CONTENIDO_MARCAR:(\w+)\]/)?.[1];
      if (red) return await marcarContenidoDirecto(red);
    }

    if (raw.startsWith('[REPORTE_GENERAL]')) {
      return await reporteGeneral();
    }

    if (raw.startsWith('[REPORTE_HOY]')) {
      // Solo ventas de HOY (no el reporte mensual)
      return await reporteRango(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[REPORTE_MES]')) {
      let datos = await monitor.monitorearVentasDiarias();
      if (!datos) {
        console.log('🔄 [REPORTE_MES] intento 2/3...');
        await new Promise(r => setTimeout(r, 8000));
        datos = await monitor.monitorearVentasDiarias();
      }
      if (!datos) {
        console.log('🔄 [REPORTE_MES] intento 3/3...');
        await new Promise(r => setTimeout(r, 10000));
        datos = await monitor.monitorearVentasDiarias();
      }
      if (!datos) return '❌ VectorPOS no respondió. Intenta en unos segundos.';
      return monitor.generarMensajeMeta(datos);
    }

    if (raw.startsWith('[REPORTE_MES_ANT]')) {
      return await reportesMesAnterior();
    }

    if (raw.startsWith('[REPORTE_SEMANA]')) {
      return await reporteSemana();
    }

    if (raw.startsWith('[REPORTE_RANGO')) {
      // Extraer fechas si las hay: [REPORTE_RANGO:2026-03-01:2026-03-31]
      const match = raw.match(/\[REPORTE_RANGO:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/);
      if (match) {
        return await reporteRango(match[1], match[2]);
      }
      // Sin fechas específicas, pedir aclaración
      return '📅 ¿Para qué rango de fechas quieres el reporte?\nEjemplo: _"ventas del 1 al 15 de marzo"_';
    }

    if (raw.startsWith('[INVENTARIO_TODO]')) {
      return await withInvDiag(() => reporteInventarioTodo());
    }

    if (raw.startsWith('[INVENTARIO]')) {
      return await withInvDiag(async () => {
        // Usar inventario completo para mostrar todos los productos:
        // ESENCIAS → alertas + conteo OK | ORIGINALES/ENVASES/RÉPLICAS → todos
        const todoInv = await monitor.consultarTodoInventario();
        return monitor.generarMensajeAlertasCompleto(todoInv);
      });
    }

    if (raw.startsWith('[RANKING_HOY]')) {
      return await reporteRankingPOS(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[RANKING_SEM]')) {
      const hoy = new Date();
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
      return await reporteRankingPOS(lunes.toISOString().split('T')[0], monitor.fechaHoy(), 'ESTA SEMANA');
    }

    if (raw.startsWith('[RANKING_MES]') || raw.startsWith('[CAJEROS]')) {
      return await reporteRankingPOS(monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[MEDIOS_PAGO_HOY]')) {
      return await reporteMediosPago(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[MEDIOS_PAGO_MES]')) {
      return await reporteMediosPago(monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[QUIEN_TRABAJO]')) {
      return await reporteQuienTrabajo();
    }

    if (raw.startsWith('[PRODUCTOS_MES]')) {
      return await reporteProductos(monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[PRODUCTOS_HOY]')) {
      return await reporteProductos(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[GASTOS]')) {
      return await reporteGastos(monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[CAJA_PERSONA:')) {
      const match = raw.match(/\[CAJA_PERSONA:([^:\]]+)(?::([^:\]]+))?(?::([^\]]+))?\]/);
      const nombre = match?.[1]?.trim() || '';
      const desde  = match?.[2]?.trim() || monitor.fechaInicioMes();
      const hasta  = match?.[3]?.trim() || monitor.fechaHoy();
      return await reporteCierresCaja(desde, hasta, nombre);
    }

    if (raw.startsWith('[CAJA_HOY]')) {
      return await reporteCierresCaja(monitor.fechaHoy(), monitor.fechaHoy());
    }

    if (raw.startsWith('[CAJA_SEM]')) {
      const hoy = new Date();
      const diasLunes = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasLunes);
      return await reporteCierresCaja(lunes.toISOString().split('T')[0], monitor.fechaHoy());
    }

    if (raw.startsWith('[CAJA_MES]') || raw.startsWith('[CAJA]')) {
      return await reporteCierresCaja(monitor.fechaInicioMes(), monitor.fechaHoy());
    }

    if (raw.startsWith('[CAJA_RANGO:')) {
      const match = raw.match(/\[CAJA_RANGO:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/);
      if (match) return await reporteCierresCaja(match[1], match[2]);
      return '📅 Formato: "caja del 1 al 7 de abril"';
    }

    if (raw.startsWith('[VENTAS_HORA]')) {
      return await reporteVentasPorHora(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[CAJERO_HOY:')) {
      const nombre = raw.match(/\[CAJERO_HOY:([^\]]+)\]/)?.[1]?.trim();
      return await reporteCajeroIndividual(nombre, monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[CAJERO_SEM:')) {
      const nombre = raw.match(/\[CAJERO_SEM:([^\]]+)\]/)?.[1]?.trim();
      const hoy = new Date();
      const diasDesdeElLunes = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasDesdeElLunes);
      return await reporteCajeroIndividual(nombre, lunes.toISOString().split('T')[0], monitor.fechaHoy(), 'ESTA SEMANA');
    }

    if (raw.startsWith('[CAJERO_MES:')) {
      const nombre = raw.match(/\[CAJERO_MES:([^\]]+)\]/)?.[1]?.trim();
      return await reporteCajeroIndividual(nombre, monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[CAJERO_MES_ANT:')) {
      const nombre = raw.match(/\[CAJERO_MES_ANT:([^\]]+)\]/)?.[1]?.trim();
      const hoy = new Date();
      const primerDia = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      const mes = primerDia.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
      return await reporteCajeroIndividual(nombre, primerDia.toISOString().split('T')[0], ultimoDia.toISOString().split('T')[0], `MES ANTERIOR — ${mes.toUpperCase()}`);
    }

    if (raw.startsWith('[CAJERO_RANGO:')) {
      const match = raw.match(/\[CAJERO_RANGO:([^:]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/);
      if (match) return await reporteCajeroIndividual(match[1].trim(), match[2], match[3], `${match[2]} → ${match[3]}`);
      return '📅 No entendí el rango. Ejemplo: _"ventas de Michelle del 1 al 7 de abril"_';
    }

    if (raw.startsWith('[INVENTARIO_CAT:')) {
      const match = raw.match(/\[INVENTARIO_CAT:([^\]]+)\]/);
      const cat = match ? match[1].trim() : '';
      return await withInvDiag(() => reporteInventarioCategoria(cat));
    }

    if (raw.startsWith('[VENTAS_INVENTARIO]')) {
      return await withInvDiag(() => reporteVentasVsInventario());
    }

    if (raw.startsWith('[FALTANTES]')) {
      return await withInvDiag(() => cruceFaltantesCategorias());
    }

    if (raw.startsWith('[BALANCE]')) {
      return await withInvDiag(() => balanceCritico());
    }

    if (raw.startsWith('[RESTOCK_TODO]')) {
      return await withInvDiag(() => reporteRestock(false));
    }

    if (raw.startsWith('[RESTOCK]')) {
      return await withInvDiag(() => reporteRestock(true));
    }

    if (raw.startsWith('[CRUCE_PRODUCTO_RANGO:')) {
      const match = raw.match(/\[CRUCE_PRODUCTO_RANGO:([^:]+):([^:\]]+):([^\]]+)\]/);
      if (!match) return '❌ No entendí el producto o las fechas.';
      const query  = match[1].trim();
      const r = fechasRelativas();
      const hoy = ahoraColombia();
      const primerDiaMesAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().split('T')[0];
      const ultimoDiaMesAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0)).toISOString().split('T')[0];
      const resolver = s => s
        .replace('HOY', r.hoy).replace('AYER', r.ayer).replace('ANTIER', r.antier)
        .replace('LUNES', r.lunes)
        .replace('INICIO_MES_ANT', primerDiaMesAnt).replace('FIN_MES_ANT', ultimoDiaMesAnt);
      const desde = resolver(match[2].trim());
      const hasta = resolver(match[3].trim());
      return await cruzarProductoRango(query, desde, hasta);
    }

    if (raw.startsWith('[CRUCE_PRODUCTO:')) {
      const match = raw.match(/\[CRUCE_PRODUCTO:([^\]]+)\]/);
      const query = match ? match[1].trim() : raw.replace('[CRUCE_PRODUCTO:', '').replace(']', '').trim();
      return await cruzarProducto(query);
    }

    if (raw.startsWith('[REQUERIMIENTO]')) {
      esperandoRequerimiento = true;
      return '📝 *Nuevo requerimiento*\n\n¿Qué necesitas? Describe el requerimiento:';
    }

    if (raw.startsWith('[VER_REQS]')) {
      return await verRequerimientos();
    }

    if (raw.startsWith('[EXPORTAR_EXCEL]')) {
      return await exportarExcelMes();
    }

    if (raw.startsWith('[AGREGAR_USUARIO:')) {
      const match = raw.match(/\[AGREGAR_USUARIO:([^:]+):([^\]]+)\]/);
      if (!match) return '❌ Formato: _"agrega al usuario 123456 como Laura"_';
      return await agregarUsuarioAutorizado(match[1].trim(), match[2].trim());
    }

    if (raw.startsWith('[VER_USUARIOS]')) {
      return await verUsuariosAutorizados();
    }

    if (raw.startsWith('[QUITAR_USUARIO:')) {
      const match = raw.match(/\[QUITAR_USUARIO:([^\]]+)\]/);
      if (!match) return '❌ Dime el ID del usuario a quitar.';
      return await quitarUsuarioAutorizado(match[1].trim());
    }

    if (raw.startsWith('[AYUDA]') || raw.startsWith('[MENU]')) {
      esperandoEleccion = true;
      return mensajeBienvenida();
    }

    // ── Análisis libre con Claude Sonnet + datos reales ──
    if (raw.startsWith('[ANALISIS:')) {
      const match = raw.match(/\[ANALISIS:([^\]]+)\]/);
      const query = match ? match[1].trim() : raw.replace('[ANALISIS:', '').replace(']', '').trim();
      return await analizarLibre(query);
    }

    // Si la respuesta parece una pregunta de negocio sin tag → analizar libre
    const parecePreguntaNegocio = /vend|ingres|meta|profit|ganancia|rentab|promedio|tendencia|compara|proyect|cuanto.*dia|dia.*cuanto|analiz|calcul|estrat|invierto|presupuest/i.test(raw);
    if (parecePreguntaNegocio && !raw.startsWith('[') && raw.length < 300) {
      return await analizarLibre(raw);
    }

    return raw.replace(/\[.*?\]/g, '').trim() || raw;
}

// ──────────────────────────────────────────────
// REPORTE GENERAL (mismo del matutino, bajo demanda)
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// ANÁLISIS LIBRE CON CLAUDE SONNET + DATOS REALES
// Se activa con [ANALISIS:query] cuando ninguna etiqueta cubre la pregunta
// ──────────────────────────────────────────────

async function analizarLibre(query) {
  try {
    console.log(`🧠 Análisis libre: "${query.substring(0, 60)}"`);

    const r = fechasRelativas();
    const meta = parseInt(process.env.META_MENSUAL) || 10000000;
    const hoyDate = ahoraColombia();
    const diasEnMes = new Date(hoyDate.getUTCFullYear(), hoyDate.getUTCMonth() + 1, 0).getDate();
    const diasTranscurridos = hoyDate.getUTCDate();
    const diasRestantes = Math.max(1, diasEnMes - diasTranscurridos);

    // ── Construir contexto de datos ──
    let ctx = `📅 Fecha: ${r.hoy} (${hoyDate.toLocaleDateString('es-CO',{weekday:'long'})})\n`;
    ctx += `📆 Día ${diasTranscurridos}/${diasEnMes} del mes | ${diasRestantes} días restantes\n`;
    ctx += `🎯 Meta mensual: $${meta.toLocaleString('es-CO')}\n\n`;

    // Obtener datos en paralelo: POS session + mes + inventario
    let browser = null;
    const [resMes, resInventario] = await Promise.allSettled([
      monitor.monitorearVentasDiarias().catch(() => null),
      monitor.consultarAlertasInventario().catch(() => null),
    ]);

    // Sesión POS para datos de hoy + productos del mes
    let ventasHoyTotal = 0, ventasHoyTickets = 0, cajerosHoy = [], productosTop = [];
    try {
      const sesion = await monitor.crearSesionPOS();
      browser = sesion.browser;
      const pg = sesion.page;
      const inicioMes = monitor.fechaInicioMes();

      const [ventasGen, cajerosData, prodData] = await Promise.allSettled([
        monitor.extraerVentasGenerales(pg, r.hoy, r.hoy),
        monitor.extraerVentasCajero(pg, r.hoy, r.hoy),
        monitor.extraerVentasProducto(pg, inicioMes, r.hoy),
      ]);

      if (ventasGen.value) {
        ventasHoyTotal   = ventasGen.value.total   || 0;
        ventasHoyTickets = ventasGen.value.tickets || 0;
      }
      if (cajerosData.value) cajerosHoy = cajerosData.value || [];
      if (prodData.value)    productosTop = (prodData.value || []).filter(p => {
        const n = (p.nombre||'').trim().toLowerCase();
        return !/^preparac|^prep\b|^recarga(\s+\d|\s*$)|^alcohol\b/i.test(n);
      }).sort((a,b) => b.cantidad - a.cantidad).slice(0, 10);

      await browser.close();
      browser = null;
    } catch(e) {
      if (browser) { await browser.close().catch(()=>{}); browser = null; }
      console.log('⚠️ Datos POS para análisis no disponibles:', e.message.substring(0,60));
    }

    const datosMes   = resMes.value;
    const inventario = resInventario.value;

    // Ventas hoy
    if (ventasHoyTotal > 0 || cajerosHoy.length > 0) {
      ctx += `📊 VENTAS HOY: $${ventasHoyTotal.toLocaleString('es-CO')} | ${ventasHoyTickets} tickets`;
      if (ventasHoyTickets > 0) ctx += ` | promedio $${Math.round(ventasHoyTotal/ventasHoyTickets).toLocaleString('es-CO')}/ticket`;
      ctx += '\n';
      if (cajerosHoy.length) ctx += `   Cajeros hoy: ${cajerosHoy.map(c=>`${c.cajero} $${c.total?.toLocaleString('es-CO')}`).join(' | ')}\n`;
    }

    // Ventas mes
    if (datosMes) {
      const totalMes = datosMes.totalMes || 0;
      const faltaMeta = Math.max(0, meta - totalMes);
      const pct = ((totalMes / meta) * 100).toFixed(1);
      const promDiario = diasTranscurridos > 0 ? Math.round(totalMes / diasTranscurridos) : 0;
      const proyeccion = Math.round(promDiario * diasEnMes);
      ctx += `\n📈 VENTAS DEL MES: $${totalMes.toLocaleString('es-CO')} (${pct}% de meta)\n`;
      ctx += `   Promedio diario real: $${promDiario.toLocaleString('es-CO')}\n`;
      ctx += `   Proyección fin de mes a ritmo actual: $${proyeccion.toLocaleString('es-CO')}\n`;
      if (faltaMeta > 0) {
        ctx += `   Falta para meta: $${faltaMeta.toLocaleString('es-CO')} (necesario $${Math.round(faltaMeta/diasRestantes).toLocaleString('es-CO')}/día)\n`;
      } else {
        ctx += `   ✅ META CUMPLIDA con $${(totalMes-meta).toLocaleString('es-CO')} de excedente\n`;
      }
      if (datosMes.cajerosMes?.length) {
        ctx += `   Ranking cajeros mes: ${datosMes.cajerosMes.map((c,i)=>`${i+1}.${c.cajero} $${c.total?.toLocaleString('es-CO')} (${c.tickets} tkt)`).join(' | ')}\n`;
      }
    }

    // Top productos
    if (productosTop.length > 0) {
      ctx += `\n🏆 TOP ${productosTop.length} PRODUCTOS (mes):\n`;
      productosTop.forEach((p, i) => {
        ctx += `   ${i+1}. ${p.nombre}: ${p.cantidad} uds`;
        if (p.valor) ctx += ` ($${p.valor.toLocaleString('es-CO')})`;
        ctx += '\n';
      });
    }

    // Inventario
    if (inventario) {
      const alertasAll = [...(inventario.alertasGramos||[]), ...(inventario.alertasUnidades||[])];
      const agotados = alertasAll.filter(p => p.saldo <= 0);
      const criticos = alertasAll.filter(p => p.saldo > 0);
      ctx += `\n⚠️ INVENTARIO: ${agotados.length} agotados | ${criticos.length} con stock bajo\n`;
      if (agotados.length > 0) ctx += `   Agotados: ${agotados.slice(0,8).map(p=>p.nombre).join(', ')}\n`;
      if (criticos.length > 0) ctx += `   Stock bajo: ${criticos.slice(0,5).map(p=>`${p.nombre}(${p.saldo}${p.medida||''})`).join(', ')}\n`;
    }

    // ── Llamar a Claude Sonnet con todos los datos ──
    const systemAnalisis = `Eres Chu, asistente inteligente de una perfumería colombiana. El dueño te acaba de dar datos reales del negocio y te hace una pregunta o pide un análisis específico.

Tu rol: Analizar los datos y crear el reporte o análisis que pide. Sé directo, usa emojis relevantes, formato Markdown para Telegram (negrita con *texto*, no con **). Responde en español colombiano informal pero profesional.

Reglas:
- USA SOLO los datos que tienes. No inventes cifras que no aparecen en el contexto.
- Si los datos no son suficientes para responder algo, dilo claramente.
- Cuando calcules proyecciones o estimados, muestra el razonamiento brevemente.
- Máximo 800 palabras. Sé conciso pero completo.
- Termina con 1 recomendación accionable si es relevante.`;

    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemAnalisis,
      messages: [{
        role: 'user',
        content: `DATOS ACTUALES DEL NEGOCIO:\n${ctx}\n\nPREGUNTA / SOLICITUD: ${query}`,
      }],
    });

    const respuesta = resp.content[0].text.trim();
    console.log(`✅ Análisis libre completado (${respuesta.length} chars)`);
    return respuesta;

  } catch(e) {
    console.error('❌ Error análisis libre:', e.message);
    return `❌ No pude completar el análisis: ${e.message.substring(0,100)}. Intenta de nuevo.`;
  }
}

async function reporteGeneral() {
  try {
    const hoy   = new Date();
    const ayer  = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const fAyer = ayer.toISOString().split('T')[0];
    const meta  = parseInt(process.env.META_MENSUAL) || 10000000;
    const labelAyer = ayer.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(1, diasEnMes - hoy.getDate());
    const metaDiaria = Math.round(meta / diasEnMes);
    const medallas = ['🥇', '🥈', '🥉'];

    // Ventas de ayer
    const { browser, page } = await monitor.crearSesionPOS();
    const cajerosAyer = await monitor.extraerVentasCajero(page, fAyer, fAyer);
    await browser.close();

    const totalAyer   = cajerosAyer.reduce((s, c) => s + c.total,   0);
    const ticketsAyer = cajerosAyer.reduce((s, c) => s + c.tickets, 0);

    // Avance del mes
    const datosMes   = await monitor.monitorearVentasDiarias();
    const totalMes   = datosMes?.totalMes   || 0;
    const cajerosMes = datosMes?.cajerosMes || [];
    const faltaMeta  = Math.max(0, meta - totalMes);
    const pctMeta    = ((totalMes / meta) * 100).toFixed(1);
    const promNecesario = Math.round(faltaMeta / diasRestantes);
    const barra  = Math.min(Math.round(Number(pctMeta) / 10), 10);
    const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);

    let msg = `📋 *REPORTE GENERAL*\n_${hoy.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}_\n\n`;

    msg += `📅 *VENTAS DE AYER (${labelAyer.toUpperCase()})*\n`;
    msg += `💰 Total: *$${totalAyer.toLocaleString('es-CO')}* | 🎫 ${ticketsAyer} tickets\n`;
    if (totalAyer > 0 && ticketsAyer > 0) msg += `💵 Promedio: $${Math.round(totalAyer / ticketsAyer).toLocaleString('es-CO')}\n`;
    if (cajerosAyer.length > 0) {
      cajerosAyer.forEach((c, i) => {
        msg += `   ${medallas[i] || `${i+1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${c.tickets} tkt)\n`;
      });
    } else { msg += `_Sin ventas ayer_\n`; }

    msg += `\n📊 *AVANCE DEL MES*\n`;
    msg += `${progreso} ${pctMeta}%\n`;
    msg += `💰 Vendido: *$${totalMes.toLocaleString('es-CO')}* / $${meta.toLocaleString('es-CO')}\n`;
    if (faltaMeta > 0) {
      msg += `📉 Falta: *$${faltaMeta.toLocaleString('es-CO')}*\n`;
      msg += `📌 Necesario/día: $${promNecesario.toLocaleString('es-CO')} | Meta/día: $${metaDiaria.toLocaleString('es-CO')}\n`;
      msg += `📆 Días restantes: ${diasRestantes}\n`;
    } else { msg += `🏆 *¡META CUMPLIDA!*\n`; }

    if (cajerosMes.length > 0) {
      const totalGen = cajerosMes.reduce((s, c) => s + c.total, 0);
      msg += `\n👥 *Ranking del mes:*\n`;
      cajerosMes.forEach((c, i) => {
        const pct = totalGen > 0 ? ((c.total / totalGen) * 100).toFixed(0) : 0;
        msg += `   ${medallas[i] || `${i+1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${pct}%)\n`;
      });
    }

    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;

    // Inventario completo organizado por M/F/U
    const partesMsgs = [msg];
    try {
      const todoInv = await monitor.consultarTodoInventario();
      const resultado = monitor.generarMensajeAlertasCompleto(todoInv);
      const partesInv = resultado?.tipo === 'mensajes'
        ? resultado.partes
        : (typeof resultado === 'string' ? [resultado] : []);
      partesMsgs.push(...partesInv);
    } catch(e) { /* inventario opcional */ }

    if (partesMsgs.length === 1) return partesMsgs[0];
    return { tipo: 'mensajes', partes: partesMsgs };
  } catch(e) {
    console.error('Error reporte general:', e.message);
    return '❌ No pude generar el reporte general. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// HELPER: BLOQUE DE META
// ──────────────────────────────────────────────

function bloquesMeta(total, desde, hasta) {
  const meta = parseInt(process.env.META_MENSUAL) || 10000000;

  // Calcular días del período
  const dDesde = new Date((desde || new Date().toISOString().split('T')[0]) + 'T12:00:00');
  const dHasta = new Date((hasta  || new Date().toISOString().split('T')[0]) + 'T12:00:00');
  const numDias = Math.max(1, Math.round((dHasta - dDesde) / 86400000) + 1);

  // Días del mes de referencia (para la proporción)
  const diasEnMes = new Date(dDesde.getFullYear(), dDesde.getMonth() + 1, 0).getDate();

  // Meta proporcional al período
  const metaDiaria  = Math.round(meta / diasEnMes);
  const metaPeriodo = Math.round(metaDiaria * numDias);

  const pct      = ((total / metaPeriodo) * 100).toFixed(1);
  const faltante = metaPeriodo - total;
  const promDiarioLogrado   = Math.round(total / numDias);
  const barra    = Math.min(Math.round(Number(pct) / 10), 10);
  const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);

  const labelPeriodo =
    numDias === 1  ? 'DÍA' :
    numDias <= 7   ? 'SEMANA' :
    numDias <= 15  ? 'QUINCENA' :
    numDias <= 22  ? `${numDias} DÍAS` : 'MES';

  let bloque = `\n🎯 *META ${labelPeriodo}: $${metaPeriodo.toLocaleString('es-CO')}*`;
  bloque += ` _(${numDias} día${numDias > 1 ? 's' : ''} × $${metaDiaria.toLocaleString('es-CO')}/día)_\n`;
  bloque += `${progreso} ${pct}%\n`;

  if (faltante > 0) {
    bloque += `📉 Faltó: *$${faltante.toLocaleString('es-CO')}*\n`;
  } else {
    bloque += `🏆 ¡Meta cumplida! +$${Math.abs(faltante).toLocaleString('es-CO')}\n`;
  }

  if (numDias > 1) {
    bloque += `📊 Promedio diario logrado: $${promDiarioLogrado.toLocaleString('es-CO')} | Necesario: $${metaDiaria.toLocaleString('es-CO')}\n`;
  }

  return bloque;
}

// ──────────────────────────────────────────────
// REPORTES VECTORPOS POR PERÍODO
// ──────────────────────────────────────────────

async function reportesMesAnterior() {
  const hoy = ahoraColombia();
  const primerDiaMesAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  const ultimoDiaMesAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0));
  const desde = primerDiaMesAnt.toISOString().split('T')[0];
  const hasta = ultimoDiaMesAnt.toISOString().split('T')[0];
  const nombreMes = primerDiaMesAnt.toLocaleString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return await reporteRango(desde, hasta, `MES ANTERIOR — ${nombreMes.toUpperCase()}`);
}

async function reporteSemana() {
  const hoy = ahoraColombia();
  const diasDesdeElLunes = hoy.getUTCDay() === 0 ? 6 : hoy.getUTCDay() - 1;
  const lunes = new Date(hoy); lunes.setUTCDate(hoy.getUTCDate() - diasDesdeElLunes);
  const desde = lunes.toISOString().split('T')[0];
  const hasta = monitor.fechaHoy();
  return await reporteRango(desde, hasta, 'ESTA SEMANA');
}

// ──────────────────────────────────────────────
// PROCESAR FACTURAS → PRODUCTOS CON VALORES EXACTOS
// ──────────────────────────────────────────────

/**
 * Agrupa facturas (con detalle de items) por producto,
 * distribuyendo servicios (recarga/preparación) y descuentos
 * proporcionalmente dentro de cada factura.
 * @returns {Array} [{nombre, cantidad, valorProd, valorServicio, descuento, valorNeto}]
 */
function procesarFacturasParaProductos(facturas) {
  // Servicios/consumibles: PREPARAC, PREP, RECARGA sola, ALCOHOL
  const esServ = (n) => {
    const s = (n || '').trim().toLowerCase();
    if (/^preparac|^prep\b/.test(s)) return true;
    if (/^recarga(\s+\d|\s*$)/.test(s)) return true;
    if (/^alcohol\b/.test(s)) return true;
    return false;
  };
  const mapa = {};

  facturas.forEach(factura => {
    if (!factura.items || factura.items.length === 0) return;
    const prods = factura.items.filter(i => !esServ(i.nombre));
    const servs = factura.items.filter(i =>  esServ(i.nombre));
    const totalServs = servs.reduce((s, i) => s + i.valor, 0);
    const totalProds = prods.reduce((s, i) => s + i.valor, 0);

    prods.forEach(prod => {
      const key = prod.nombre.toLowerCase().trim();
      if (!mapa[key]) mapa[key] = { nombre: prod.nombre, cantidad: 0, valorProd: 0, valorServicio: 0, descuento: 0 };

      // Servicio proporcional al valor del producto dentro de la factura
      const srvProp  = totalProds > 0 && totalServs > 0
        ? Math.round((prod.valor / totalProds) * totalServs) : 0;
      // Descuento proporcional al subtotal (prod + serv)
      const base      = totalProds + totalServs;
      const descProp  = base > 0 && factura.descuento > 0
        ? Math.round(((prod.valor + srvProp) / base) * factura.descuento) : 0;

      mapa[key].cantidad     += prod.cantidad;
      mapa[key].valorProd    += prod.valor;
      mapa[key].valorServicio += srvProp;
      mapa[key].descuento    += descProp;
    });
  });

  return Object.values(mapa)
    .map(p => ({ ...p, valorNeto: p.valorProd + p.valorServicio - p.descuento }))
    .sort((a, b) => b.valorNeto - a.valorNeto);
}

async function reporteRango(desde, hasta, titulo) {
  const tituloFinal = titulo || `${desde} al ${hasta}`;
  const esDiaUnico  = desde === hasta;
  try {
    const hoyStr = monitor.fechaHoy();
    const { browser: br1, page: pg1 } = await monitor.crearSesionPOS();
    const ventas    = await monitor.extraerVentasGenerales(pg1, desde, hasta);
    const cajeros   = await monitor.extraerVentasCajero(pg1, desde, hasta);
    const prodRaw   = await monitor.extraerVentasProducto(pg1, desde, hasta);
    const horasData = await monitor.extraerVentasPorHora(pg1, desde, hasta);

    // Solo para HOY: extrae facturas con ítems desde el sidebar Lista facturas del POS.
    // Para días pasados (ayer, semana, mes…) no se scarapean facturas aquí —
    // ese detalle solo aplica en reporteCierresCaja.
    let facturas = [];
    if (esDiaUnico && desde === hoyStr) {
      facturas = await monitor.extraerFacturasConSesion(pg1, desde, true)
        .catch(e => { console.error('⚠️ Facturas hoy:', e.message); return []; });
    }
    await br1.close();

    // "RECARGA" sola = servicio; "RECARGA SHANTAL 33gr..." = producto
    // "ALCOHOL" / "PREPARAC" = consumibles/servicios, no se listan como productos
    const esServicio = (nombre) => {
      const s = (nombre || '').trim().toLowerCase();
      if (/^preparac|^prep\b/.test(s)) return true;
      if (/^recarga(\s+\d|\s*$)/.test(s)) return true;
      if (/^alcohol\b/.test(s)) return true;
      return false;
    };
    const preparaciones      = prodRaw.filter(p => esServicio(p.nombre));
    const totalPreparaciones = preparaciones.reduce((s, p) => s + (p.valor || 0), 0);

    const prodsPOS = prodRaw
      .filter(p => !esServicio(p.nombre))
      .sort((a, b) => b.cantidad - a.cantidad);

    const primeraHoraRango = horasData.filter(h => h.total > 0).sort((a, b) => a.hora - b.hora)[0] || null;

    const totalDeCajeros   = cajeros.reduce((s, c) => s + c.total,   0);
    const ticketsDeCajeros = cajeros.reduce((s, c) => s + c.tickets, 0);
    const totalDeVentas    = ventas.reduce((s, v)  => s + v.totalVentas, 0);
    const ticketsDeVentas  = ventas.reduce((s, v)  => s + v.tickets,     0);
    const totalDeProductos = prodRaw.reduce((s, p) => s + p.valor, 0);

    // prodRaw (ventas/producto) incluye TODO: productos + preparaciones + alcohol
    // cajeros excluye servicios → da total menor al real
    const totalDeFacturas = facturas.reduce((s, f) => s + (f.total || f.venta || 0), 0);
    const total   = totalDeFacturas    > 0 ? totalDeFacturas
                  : totalDeProductos   > 0 ? totalDeProductos
                  : totalDeCajeros     > 0 ? totalDeCajeros
                  : totalDeVentas;
    const tickets = ticketsDeCajeros > 0 ? ticketsDeCajeros : ticketsDeVentas > 0 ? ticketsDeVentas : 0;
    const haySales = total > 0;
    const medallas = ['🥇', '🥈', '🥉'];
    const fp2 = monitor.formatPesos;

    const efectivo = cajeros.reduce((s, c) => s + (c.efectivo    || 0), 0);
    const banco    = cajeros.reduce((s, c) => s + (c.bancolombia || 0), 0);
    const nequi    = cajeros.reduce((s, c) => s + (c.nequi       || 0), 0);
    const totalDescFacturas = facturas.reduce((s, f) => s + (f.descuento || 0), 0);

    let msg = `📊 *REPORTE — ${tituloFinal}*\n`;
    msg += `_${desde} → ${hasta}_\n\n`;
    msg += `💰 *Total: $${fp2(total)}*\n`;
    if (totalDescFacturas > 0) msg += `🏷️ Descuentos aplicados: $${fp2(totalDescFacturas)}\n`;
    if (tickets > 0) {
      msg += `🎫 Tickets: ${tickets}\n`;
      msg += `💵 Promedio ticket: $${fp2(total / tickets)}\n`;
    }
    if (efectivo > 0) msg += `💵 Efectivo: $${fp2(efectivo)}\n`;
    if (banco > 0)    msg += `🏦 Transferencia: $${fp2(banco)}\n`;
    if (nequi > 0)    msg += `📱 Nequi: $${fp2(nequi)}\n`;

    if (cajeros.length > 0 && totalDeCajeros > 0) {
      msg += `\n👥 *RANKING CAJEROS:*\n`;
      cajeros.forEach((c, i) => {
        const pct = total > 0 ? ((c.total / total) * 100).toFixed(0) : 0;
        msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*: $${fp2(c.total)} (${pct}%) | ${c.tickets} tickets\n`;
      });
    }

    if (haySales) {
      if (primeraHoraRango) {
        const h = primeraHoraRango.hora;
        const ampm = h >= 12 ? 'PM' : 'AM';
        msg += `\n🕐 *Primera venta:* ${h % 12 || 12}:00 ${ampm}\n`;
      }

      // ── Decidir fuente de datos de productos ──
      // Si facturas tienen detalle (items), usar datos exactos; si no, distribución proporcional
      const facturasConItems = facturas.filter(f => f.items?.length > 0);
      const usarFacturas = facturasConItems.length > 0;

      let productosAMostrar = [];
      if (usarFacturas) {
        productosAMostrar = procesarFacturasParaProductos(facturasConItems); // todos
      } else {
        const sumaProd = prodsPOS.reduce((s, p) => s + (p.valor || 0), 0);
        productosAMostrar = prodsPOS.map(p => {
          const srvProp = sumaProd > 0 && totalPreparaciones > 0
            ? Math.round((p.valor / sumaProd) * totalPreparaciones) : 0;
          return {
            nombre: p.nombre, cantidad: p.cantidad,
            valorProd: p.valor, valorServicio: srvProp, descuento: 0,
            valorNeto: p.valor + srvProp,
          };
        });
      }

      if (productosAMostrar.length > 0) {
        const medallas2 = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
        const posEmoji = (i) => i < medallas2.length ? medallas2[i] : `${i + 1}.`;
        msg += `\n📦 *Productos vendidos (${productosAMostrar.length}):*\n`;
        productosAMostrar.forEach((p, i) => {
          const cat = monitor.inferirCategoria(p.nombre);
          const uni = cat.startsWith('ESENCIAS') ? 'gr' : 'uds';
          msg += `${posEmoji(i)} *${p.nombre}*: ${p.cantidad} ${uni}\n`;
        });
      }
    }

    msg += bloquesMeta(total, desde, hasta);
    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch (e) {
    console.error('Error reporte rango:', e.message);
    // Si es un error de conexión/browser (cold start), indicar que reintente
    const esConexion = /timeout|navigation|net::|ECONNREFUSED|browser|Protocol/i.test(e.message);
    if (esConexion) {
      return '⏳ VectorPOS tardó en responder. Intenta de nuevo en unos segundos.';
    }
    return '❌ No pude generar el reporte. Verifica la conexión a VectorPOS.';
  }
}

async function reporteCajeroIndividual(nombre, desde, hasta, titulo) {
  if (!nombre) return '❌ No entendí el nombre del cajero.';
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    await browser.close();

    // Buscar por nombre parcial (insensible a mayúsculas/tildes)
    // Busca en ambas direcciones: el nombre contiene la búsqueda O la búsqueda contiene el primer nombre
    const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const busqueda = normalizar(nombre);
    const encontrado = cajeros.find(c => {
      const nombreN = normalizar(c.cajero);
      const primerNombre = nombreN.split(' ')[0];
      return nombreN.includes(busqueda) || busqueda.includes(primerNombre);
    });

    if (!encontrado) {
      const lista = cajeros.map(c => `• ${c.cajero}`).join('\n');
      return `❌ No encontré a *${nombre}* en el período.\n\nCajeros con actividad:\n${lista || 'Ninguno'}`;
    }

    const totalPeriodo = cajeros.reduce((s, c) => s + c.total, 0);
    const pct = totalPeriodo > 0 ? ((encontrado.total / totalPeriodo) * 100).toFixed(1) : 0;
    const promTicket = encontrado.tickets > 0 ? Math.round(encontrado.total / encontrado.tickets) : 0;

    let msg = `👤 *${encontrado.cajero} — ${titulo}*\n`;
    msg += `_${desde} → ${hasta}_\n\n`;
    msg += `💰 *Total vendido: $${encontrado.total.toLocaleString('es-CO')}*\n`;
    msg += `🎫 Tickets: ${encontrado.tickets}\n`;
    if (promTicket > 0) msg += `💵 Promedio ticket: $${promTicket.toLocaleString('es-CO')}\n`;
    msg += `📊 Participación: ${pct}% del total del negocio\n`;
    if (encontrado.efectivo > 0)    msg += `\n💵 Efectivo: $${encontrado.efectivo.toLocaleString('es-CO')}`;
    if (encontrado.bancolombia > 0) msg += `\n🏦 Bancolombia: $${encontrado.bancolombia.toLocaleString('es-CO')}`;
    if (encontrado.nequi > 0)       msg += `\n📱 Nequi: $${encontrado.nequi.toLocaleString('es-CO')}`;
    msg += `\n`;
    msg += bloquesMeta(encontrado.total, desde, hasta);
    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch (e) {
    console.error('Error cajero individual:', e.message);
    return '❌ No pude consultar los datos. Intenta de nuevo.';
  }
}

async function reporteRankingPOS(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);

    // Desglose por día si el período es mayor a 1 día
    const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
    const numDias = diasEntre(desde, hasta);
    let porDia = []; // [{ fecha, label, cajeros: [{cajero, total, tickets}] }]

    if (numDias > 0) {
      const dias = [];
      for (let i = 0; i <= numDias; i++) {
        const d = new Date(desde);
        d.setDate(d.getDate() + i);
        dias.push(d.toISOString().split('T')[0]);
      }
      for (const dia of dias) {
        const datosDia = await monitor.extraerVentasCajero(page, dia, dia);
        if (datosDia.length > 0) {
          const label = new Date(dia + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
          porDia.push({ fecha: dia, label, cajeros: datosDia });
        }
      }
    }

    await browser.close();

    const totalGeneral = cajeros.reduce((s, c) => s + c.total, 0);
    const medallas = ['🥇', '🥈', '🥉'];

    if (!cajeros.length) return `📊 Sin datos de cajeros para ${titulo}.`;

    let msg = `👥 *RANKING ${titulo}*\n\n`;
    cajeros.forEach((c, i) => {
      const pct = totalGeneral > 0 ? ((c.total / totalGeneral) * 100).toFixed(0) : 0;
      msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*\n`;
      msg += `   💰 $${c.total.toLocaleString('es-CO')} (${pct}%) | 🎫 ${c.tickets} tickets\n`;

      // Desglose por día para este cajero
      if (porDia.length > 0) {
        const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const nombreN = normalizar(c.cajero);
        porDia.forEach(d => {
          const enc = d.cajeros.find(x => normalizar(x.cajero) === nombreN);
          if (enc && enc.total > 0) {
            msg += `   📅 ${d.label}: $${enc.total.toLocaleString('es-CO')} (${enc.tickets} tkt)\n`;
          }
        });
      }
      msg += '\n';
    });

    msg += `💵 *Total: $${totalGeneral.toLocaleString('es-CO')}*\n`;
    msg += bloquesMeta(totalGeneral, desde, hasta);
    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch (e) {
    console.error('Error ranking:', e.message);
    return '❌ No pude consultar el ranking en VectorPOS.';
  }
}

// ──────────────────────────────────────────────
// AYUDA
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// CHECKLIST CONTENIDO REDES SOCIALES
// ──────────────────────────────────────────────

// Elimina menciones de precios del texto de contenido (ej: $5.000, $190.000, $5k)
function quitarPrecios(texto) {
  if (!texto) return texto;
  return texto
    .replace(/desde\s+\*?\$[\d.,]+k?\*?/gi, '')   // "desde $5.000"
    .replace(/\*?\$[\d.,]+k?\*?/g, '')             // "$190.000" o "*$5.000*"
    .replace(/[ \t]*—[ \t]*(\n|$)/gm, '$1')        // guiones solos al final de línea
    .replace(/\n{3,}/g, '\n\n')                    // líneas vacías extra
    .trim();
}

async function planContenidoSemana(offsetDias = 0) {
  const contenido = require('./contenido');
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const diasDesdelunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasDesdelunes + offsetDias);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);

  const fmt = d => d.toISOString().split('T')[0];
  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const semLabel = `${lunes.getDate()} ${MESES[lunes.getMonth()]} — ${domingo.getDate()} ${MESES[domingo.getMonth()]}`;
  const letraSemana = contenido.getLetraSemana(fmt(lunes));

  const partes = [];
  let msg = `📋 *PLAN SEMANA ${semLabel}* _(${letraSemana})_\n`;
  msg += `_SALMA PERFUM_\n\n`;

  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
    const fecha = fmt(dia);
    const diaKey = contenido.DIAS_ES[dia.getDay()];
    const cal = contenido.getContenidoDe(fecha);
    const nombre = contenido.getNombreDia(diaKey);
    const esHoy = fecha === fmt(hoy);

    let bloque = `*${nombre}${esHoy ? ' (hoy)' : ''}*\n`;
    bloque += `📌 _${cal.tema}_\n\n`;

    bloque += `📱 *WhatsApp:*\n${quitarPrecios(cal.whatsapp)}\n\n`;

    if (cal.instagram) {
      bloque += `📸 *Instagram — ${cal.instagram.tipo}:*\n`;
      bloque += `💡 ${quitarPrecios(cal.instagram.idea)}\n`;
      bloque += `_Copy:_ ${quitarPrecios(cal.instagram.copy)}\n\n`;
    } else {
      bloque += `📸 Instagram: ➖ _No toca_\n\n`;
    }

    if (cal.tiktok) {
      bloque += `🎵 *TikTok — ${cal.tiktok.tipo}:*\n`;
      bloque += `💡 ${quitarPrecios(cal.tiktok.idea)}\n`;
      bloque += `_Copy:_ ${quitarPrecios(cal.tiktok.copy)}\n\n`;
    } else {
      bloque += `🎵 TikTok: ➖ _No toca_\n\n`;
    }

    bloque += `─────────────────\n`;

    if ((msg + bloque).length > 3800) {
      partes.push(msg);
      msg = `📋 _(continuación)_\n\n`;
    }
    msg += bloque;
  }

  partes.push(msg);
  if (partes.length === 1) return partes[0];
  return { tipo: 'mensajes', partes };
}

async function checklistContenidoHoy() {
  const contenido = require('./contenido');
  const db = require('./database');
  const hoy = new Date().toISOString().split('T')[0];
  const diaKey = contenido.getDiaKey(hoy);
  const cal = contenido.getContenidoDe(hoy);
  const estado = await db.obtenerEstadoContenido(hoy);

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date();
  const fechaLabel = `${contenido.getNombreDia(diaKey)} ${d.getDate()} de ${MESES[d.getMonth()]}`;

  let msg = `📋 *CHECKLIST HOY — ${fechaLabel}*\n`;
  msg += `📌 _${cal.tema}_\n`;
  msg += `─────────────────\n`;

  const redes = [
    { key: 'whatsapp', emoji: '📱', label: 'WhatsApp' },
    { key: 'instagram', emoji: '📸', label: 'Instagram' },
    { key: 'tiktok',   emoji: '🎵', label: 'TikTok' },
  ];

  for (const r of redes) {
    if (!cal[r.key]) {
      msg += `${r.emoji} ${r.label}: ➖ _No toca hoy_\n`;
    } else if (estado[r.key]?.done) {
      msg += `${r.emoji} ${r.label}: ✅ _Publicado a las ${estado[r.key].hora}_\n`;
    } else {
      msg += `${r.emoji} ${r.label}: ⬜ _Pendiente_\n`;
    }
  }

  const publicados = redes.filter(r => cal[r.key] && estado[r.key]?.done).length;
  const requeridos = redes.filter(r => cal[r.key]).length;
  const pct = requeridos > 0 ? Math.round((publicados / requeridos) * 100) : 100;
  const barra = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

  msg += `─────────────────\n`;
  msg += `${barra} ${pct}%\n`;
  if (publicados === requeridos) {
    msg += `🎉 _¡Contenido del día completo!_`;
  } else {
    msg += `_Faltan ${requeridos - publicados} publicación(es)_`;
  }

  return msg;
}

async function checklistContenidoSemana() {
  const contenido = require('./contenido');
  const db = require('./database');

  const hoy = new Date();
  // Calcular lunes de esta semana
  const diaSemana = hoy.getDay(); // 0=dom, 1=lun...
  const diasDesdelunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasDesdelunes);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);

  const fmt = d => d.toISOString().split('T')[0];
  const estadoSemana = await db.obtenerEstadoSemana(fmt(lunes), fmt(domingo));

  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const semLabel = `${lunes.getDate()} ${MESES[lunes.getMonth()]} — ${domingo.getDate()} ${MESES[domingo.getMonth()]}`;

  let msg = `📋 *CONTENIDO SEMANA — ${semLabel}*\n\n`;

  let totalReq = 0, totalPub = 0;

  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
    const fecha = fmt(dia);
    const diaKey = contenido.DIAS_ES[dia.getDay()];
    const cal = contenido.getContenidoDe(fecha);
    const estado = estadoSemana[fecha] || {};
    const esPasado = dia <= hoy;

    const nombreDia = contenido.getNombreDia(diaKey);
    const esHoy = fecha === fmt(hoy);
    msg += `*${nombreDia}${esHoy ? ' (hoy)' : ''}*\n`;

    const redes = [
      { key: 'whatsapp', emoji: '📱' },
      { key: 'instagram', emoji: '📸' },
      { key: 'tiktok',   emoji: '🎵' },
    ];

    for (const r of redes) {
      if (!cal[r.key]) continue;
      totalReq++;
      if (estado[r.key]?.done) {
        totalPub++;
        msg += `  ${r.emoji} ✅ ${r.key} — _${estado[r.key].hora}_\n`;
      } else if (esPasado) {
        msg += `  ${r.emoji} ⚠️ ${r.key} — _sin publicar_\n`;
      } else {
        msg += `  ${r.emoji} ⬜ ${r.key}\n`;
      }
    }
    msg += `\n`;
  }

  const pct = totalReq > 0 ? Math.round((totalPub / totalReq) * 100) : 0;
  const barra = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  msg += `─────────────────\n`;
  msg += `${barra} ${pct}%\n`;
  msg += `✅ ${totalPub}/${totalReq} publicaciones completadas`;

  return msg;
}

async function checklistContenidoDia(diasOffset) {
  const contenido = require('./contenido');
  const d = new Date(); d.setDate(d.getDate() + diasOffset);
  const fecha = d.toISOString().split('T')[0];
  const diaKey = contenido.getDiaKey(fecha);
  const cal = contenido.getContenidoDe(fecha);

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const fechaLabel = `${contenido.getNombreDia(diaKey)} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  const label = diasOffset === 1 ? 'MAÑANA' : `EN ${diasOffset} DÍAS`;

  let msg = `📋 *CONTENIDO ${label} — ${fechaLabel}*\n`;
  msg += `📌 _${cal.tema}_\n`;
  msg += `─────────────────\n`;

  const redes = [
    { key: 'whatsapp', emoji: '📱', label: 'WhatsApp' },
    { key: 'instagram', emoji: '📸', label: 'Instagram' },
    { key: 'tiktok',   emoji: '🎵', label: 'TikTok' },
  ];

  for (const r of redes) {
    if (!cal[r.key]) {
      msg += `${r.emoji} ${r.label}: ➖ _No toca_\n`;
    } else {
      msg += `${r.emoji} ${r.label}: ⬜ _Programado_\n`;
      if (r.key === 'whatsapp') {
        msg += `\n_Copy WhatsApp:_\n${cal.whatsapp}\n\n`;
      } else {
        const info = cal[r.key];
        msg += `   💡 _${info.tipo}_\n`;
        msg += `   📌 _${info.idea}_\n`;
      }
    }
  }

  return msg;
}

async function marcarContenidoDirecto(red) {
  const db = require('./database');
  const contenido = require('./contenido');
  const hoy = new Date().toISOString().split('T')[0];
  const cal = contenido.getContenidoHoy();

  if (!cal || !cal[red]) {
    const nombres = { whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok' };
    return `ℹ️ Hoy no toca publicar en ${nombres[red] || red}.`;
  }

  await db.marcarContenidoPublicado(hoy, red);
  const nombres = { whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok' };
  const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `✅ *${nombres[red]}* marcado como publicado a las ${hora}\n\n${await checklistContenidoHoy()}`;
}

// ──────────────────────────────────────────────
// PRODUCTOS MÁS/MENOS VENDIDOS
// ──────────────────────────────────────────────

async function reporteProductos(desde, hasta, titulo) {
  try {
    // Lanzar sesión POS y catálogo en paralelo
    const [{ browser, page }, mapaCateg] = await Promise.all([
      monitor.crearSesionPOS(),
      monitor.obtenerCategoriaProductos(),
    ]);
    const raw = await monitor.extraerVentasProducto(page, desde, hasta);
    await browser.close();

    if (!raw.length) return `📦 Sin ventas de productos para ${titulo}.`;

    const fp = monitor.formatPesos;
    const icons = ['🥇','🥈','🥉','4️⃣','5️⃣'];

    // 1. Excluir PREPARACIÓN/RECARGA sola (mano de obra); "RECARGA [marca]" = producto real
    const _esSrvInv = (n) => { const s=(n||'').trim().toLowerCase(); return /^preparac|^prep\b/.test(s) || /^recarga(\s+\d|\s*$)/.test(s); };
    const productos = raw.filter(p => !_esSrvInv(p.nombre));

    // 2. Resolver categoría: catálogo VectorPOS primero, luego inferir
    const resolverCategoria = (nombre) => {
      const key = nombre.toLowerCase();
      return mapaCateg[key] || monitor.inferirCategoria(nombre);
    };

    // 3. Clasificar por categoría real (ESENCIAS M / F / U separadas)
    const grupos = {
      'ESENCIAS M':  [],
      'ESENCIAS F':  [],
      'ESENCIAS U':  [],
      'ENVASE':      [],
      'ORIGINALES':  [],
      'REPLICA 1.1': [],
      'OTROS':       [],
    };
    for (const p of productos) {
      const cat = resolverCategoria(p.nombre);
      if      (cat === 'ESENCIAS M')   grupos['ESENCIAS M'].push(p);
      else if (cat === 'ESENCIAS F')   grupos['ESENCIAS F'].push(p);
      else if (cat === 'ESENCIAS U')   grupos['ESENCIAS U'].push(p);
      else if (cat.startsWith('ESENCIAS')) grupos['ESENCIAS M'].push(p); // fallback sin género
      else if (cat === 'ENVASE')       grupos.ENVASE.push(p);
      else if (cat === 'ORIGINALES')   grupos.ORIGINALES.push(p);
      else if (cat === 'REPLICA 1.1')  grupos['REPLICA 1.1'].push(p);
      else                             grupos.OTROS.push(p);
    }

    const totalValor    = productos.reduce((s, p) => s + p.valor, 0);
    const totalCantidad = productos.reduce((s, p) => s + p.cantidad, 0);

    // Unidad: esencias → gr, resto → uds
    const unidadCat = (cat) => cat.startsWith('ESENCIAS') ? 'gr' : 'uds';
    const unidadProd = (p) => unidadCat(resolverCategoria(p.nombre));

    const partes = [];
    let msg = `📦 *PRODUCTOS — ${titulo}*\n`;
    msg += `_${productos.length} productos | $${fp(totalValor)} | ${totalCantidad} uds vendidos_\n\n`;

    // Helper: bloque por categoría
    const bloqueCategoria = (emoji, nombre, lista, cat) => {
      if (!lista.length) return;
      const top = lista.slice(0, 5);
      const totalCat = lista.reduce((s, p) => s + p.valor, 0);
      const uni = unidadCat(cat || nombre);
      msg += `${emoji} *${nombre}* — $${fp(totalCat)}\n`;
      top.forEach((p, i) => {
        const precioUnd = p.cantidad > 0 ? Math.round(p.valor / p.cantidad) : 0;
        msg += `${icons[i]} *${p.nombre}*\n`;
        msg += `   💰 $${fp(p.valor)} | ${p.cantidad} ${uni} | ~$${fp(precioUnd)}/${uni === 'gr' ? 'g' : 'u'}\n`;
      });
      if (lista.length > 5) msg += `   _+${lista.length - 5} más_\n`;
      msg += `\n`;
      if (msg.length > 3500) { partes.push(msg); msg = `📦 _(continuación)_\n\n`; }
    };

    bloqueCategoria('🧪', 'ESENCIAS M',    grupos['ESENCIAS M'],  'ESENCIAS M');
    bloqueCategoria('🌸', 'ESENCIAS F',    grupos['ESENCIAS F'],  'ESENCIAS F');
    bloqueCategoria('🌀', 'ESENCIAS U',    grupos['ESENCIAS U'],  'ESENCIAS U');
    bloqueCategoria('🧴', 'ENVASES',       grupos.ENVASE,         'ENVASE');
    bloqueCategoria('✨', 'ORIGINALES',    grupos.ORIGINALES,     'ORIGINALES');
    bloqueCategoria('🔁', 'RÉPLICAS 1.1', grupos['REPLICA 1.1'], 'REPLICA 1.1');
    if (grupos.OTROS.length) bloqueCategoria('📦', 'OTROS', grupos.OTROS, 'OTROS');

    // Menos vendidos (global, sin preparación)
    const bottom5 = [...productos].sort((a, b) => a.valor - b.valor).slice(0, 5);
    msg += `📉 *MENOS VENDIDOS:*\n`;
    bottom5.forEach(p => {
      const precioUnd = p.cantidad > 0 ? Math.round(p.valor / p.cantidad) : 0;
      const uni = unidadProd(p);
      msg += `• *${p.nombre}*: ${p.cantidad} ${uni} — $${fp(p.valor)} (~$${fp(precioUnd)}/${uni === 'gr' ? 'g' : 'u'})\n`;
    });

    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    partes.push(msg);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };
  } catch(e) {
    console.error('Error productos:', e.message);
    return '❌ No pude consultar los productos.';
  }
}

// ──────────────────────────────────────────────
// ANÁLISIS INTELIGENTE CON IA (datos + pregunta)
// ──────────────────────────────────────────────

async function analizarConIA(pregunta, datos) {
  if (!groq) return null;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Eres Chu, asistente de ventas de una perfumería colombiana. Analiza los datos proporcionados y responde la pregunta de forma concisa, útil y en español. Usa emojis ocasionalmente. Máximo 300 palabras.' },
        { role: 'user', content: `Pregunta: ${pregunta}\n\n<<<DATOS>>>\n${datos}\n<<<FIN_DATOS>>>` }
      ],
      max_tokens: 400,
      temperature: 0.6,
    });
    return resp.choices[0].message.content.trim();
  } catch(e) {
    return null;
  }
}

// ──────────────────────────────────────────────
// MEDIOS DE PAGO
// ──────────────────────────────────────────────

async function reporteMediosPago(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    await browser.close();

    if (!cajeros.length) return `💳 Sin ventas registradas para ${titulo}.`;

    const totales = cajeros.reduce((acc, c) => {
      acc.efectivo    += c.efectivo    || 0;
      acc.bancolombia += c.bancolombia || 0;
      acc.nequi       += c.nequi       || 0;
      acc.total       += c.total       || 0;
      return acc;
    }, { efectivo: 0, bancolombia: 0, nequi: 0, total: 0 });

    const transferencias = totales.bancolombia + totales.nequi;
    const pctEfectivo = totales.total > 0 ? ((totales.efectivo / totales.total) * 100).toFixed(0) : 0;
    const pctTransf   = totales.total > 0 ? ((transferencias   / totales.total) * 100).toFixed(0) : 0;

    let msg = `💳 *MEDIOS DE PAGO — ${titulo}*\n\n`;
    msg += `💰 *Total vendido:* $${totales.total.toLocaleString('es-CO')}\n\n`;
    msg += `💵 *Efectivo:* $${totales.efectivo.toLocaleString('es-CO')} (${pctEfectivo}%)\n`;
    msg += `🏦 *Transferencias:* $${transferencias.toLocaleString('es-CO')} (${pctTransf}%)\n`;
    if (totales.bancolombia > 0) msg += `   • Bancolombia: $${totales.bancolombia.toLocaleString('es-CO')}\n`;
    if (totales.nequi > 0)       msg += `   • Nequi: $${totales.nequi.toLocaleString('es-CO')}\n`;
    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch(e) {
    return '❌ No pude consultar los medios de pago.';
  }
}

// ──────────────────────────────────────────────
// QUIÉN TRABAJÓ HOY
// ──────────────────────────────────────────────

async function reporteQuienTrabajo() {
  try {
    const hoy = monitor.fechaHoy();
    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros = await monitor.extraerVentasCajero(page, hoy, hoy);
    await browser.close();

    const activos = cajeros.filter(c => c.tickets > 0);

    if (!activos.length) {
      return `👥 *¿QUIÉN TRABAJÓ HOY? — ${hoy}*\n\nNo hay cajeros con ventas registradas hoy.`;
    }

    const medallas = ['🥇', '🥈', '🥉'];
    let msg = `👥 *¿QUIÉN TRABAJÓ HOY? — ${hoy}*\n\n`;
    msg += `_${activos.length} cajero${activos.length > 1 ? 's' : ''} activo${activos.length > 1 ? 's' : ''} hoy_\n\n`;

    activos.forEach((c, i) => {
      msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*\n`;
      msg += `   🎫 ${c.tickets} tickets | 💰 $${c.total.toLocaleString('es-CO')}\n`;
      msg += `   💵 Efectivo: $${(c.efectivo||0).toLocaleString('es-CO')} | 🏦 Transfer: $${((c.bancolombia||0)+(c.nequi||0)).toLocaleString('es-CO')}\n\n`;
    });

    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch(e) {
    return '❌ No pude consultar quién trabajó hoy.';
  }
}

// ──────────────────────────────────────────────
// GASTOS
// ──────────────────────────────────────────────

async function reporteGastos(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const gastos = await monitor.extraerGastos(page, desde, hasta);
    await browser.close();

    if (!gastos.length) return `💸 Sin gastos registrados para ${titulo}.`;

    const fp = monitor.formatPesos;
    const totalGastos = gastos.reduce((s, g) => s + g.valor, 0);

    // ── Agrupar por Documento + Proveedor ──
    const porPersona = {};
    for (const g of gastos) {
      const key = `${g.documento}||${g.proveedor}`;
      if (!porPersona[key]) {
        porPersona[key] = { documento: g.documento, proveedor: g.proveedor, pagos: [], total: 0 };
      }
      porPersona[key].pagos.push(g);
      porPersona[key].total += g.valor;
    }
    const personas = Object.values(porPersona).sort((a, b) => b.total - a.total);

    const partes = [];
    let msg = `💸 *GASTOS — ${titulo}*\n`;
    msg += `_${desde} → ${hasta}_ | _${gastos.length} registros_\n\n`;

    personas.forEach(p => {
      let bloque = `👤 *${p.proveedor || 'Sin proveedor'}*\n`;
      if (p.documento) bloque += `📄 Doc: ${p.documento}\n`;
      bloque += `💰 *Total: $${fp(p.total)}*\n\n`;

      // Pagos por día ordenados
      const pagosOrdenados = [...p.pagos].sort((a, b) => a.fecha.localeCompare(b.fecha));
      pagosOrdenados.forEach(g => {
        bloque += `  📅 ${formatFechaHora(g.fecha)}\n`;
        bloque += `  • *${g.concepto}*: $${fp(g.valor)}`;
        if (g.detalle) bloque += ` — ${g.detalle}`;
        if (g.medioPago) bloque += ` | 💳 ${g.medioPago}`;
        bloque += `\n`;
      });
      bloque += `\n`;

      if ((msg + bloque).length > 3800) { partes.push(msg); msg = `💸 _(continuación)_\n\n`; }
      msg += bloque;
    });

    msg += `─────────────────\n`;
    msg += `💰 *TOTAL GASTOS: $${fp(totalGastos)}*\n`;
    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    partes.push(msg);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };
  } catch (e) {
    console.error('Error gastos:', e.message);
    return '❌ No pude consultar los gastos.';
  }
}

// ──────────────────────────────────────────────
// CIERRES DE CAJA
// ──────────────────────────────────────────────

async function reporteCierresCaja(desde, hasta, filtroCajero = '') {
  try {
    const hoy = monitor.fechaHoy();
    const fp = monitor.formatPesos;
    const meta = parseInt(process.env.META_MENSUAL) || 10000000;
    const diasEnMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const metaDiaria = Math.round(meta / diasEnMes);
    const filtro = filtroCajero.toLowerCase().trim();

    const esDiaUnico = desde === hasta;

    // POS primero — cerrar antes de abrir app.vectorpos.com.co (un browser a la vez)
    const { browser: br2, page: pg2 } = await monitor.crearSesionPOS();
    const cierres      = await monitor.extraerCierresCaja(pg2, desde, hasta);
    const cajerosRango = await monitor.extraerVentasCajero(pg2, desde, hasta);
    const cajerosHoy   = desde === hasta && desde === hoy
      ? cajerosRango
      : await monitor.extraerVentasCajero(pg2, hoy, hoy);
    const productosRaw = await monitor.extraerVentasProducto(pg2, desde, hasta);
    const ventasHora   = await monitor.extraerVentasPorHora(pg2, desde, hasta);

    // HOY → Lista facturas sidebar POS (misma sesión)
    // AYER/PASADO → cerrar POS primero, luego app.vectorpos.com.co
    let facturas = [];
    if (esDiaUnico) {
      if (desde === hoy) {
        facturas = await monitor.extraerFacturasConSesion(pg2, desde, true)
          .catch(e => { console.error('⚠️ Facturas caja hoy:', e.message); return []; });
        await br2.close();
      } else {
        await br2.close();
        facturas = await monitor.extraerHistoricoFacturas(desde, hasta, true)
          .catch(e => { console.error('⚠️ Facturas caja:', e.message); return []; });
      }
    } else {
      await br2.close();
    }
    const totalDescFacturas = facturas.reduce((s, f) => s + (f.descuento || 0), 0);

    // Servicios/consumibles: PREPARAC, PREP, RECARGA sola, ALCOHOL
    const esServicioCaja = (n) => {
      const s = (n || '').trim().toLowerCase();
      if (/^preparac|^prep\b/.test(s)) return true;
      if (/^recarga(\s+\d|\s*$)/.test(s)) return true;
      if (/^alcohol\b/.test(s)) return true;
      return false;
    };
    const productos = productosRaw
      .filter(p => !esServicioCaja(p.nombre))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);

    // Primera hora con ventas > 0
    const primeraHora = ventasHora.length
      ? ventasHora.filter(h => h.total > 0).sort((a, b) => a.hora - b.hora)[0]
      : null;

    const titulo = filtro
      ? `🏧 *CAJA — ${filtro.toUpperCase()}*\n_${desde} → ${hasta}_\n\n`
      : `🏧 *MOVIMIENTO DE CAJA*\n_${desde} → ${hasta}_\n\n`;

    const partes = [];
    let msg = titulo;

    // ── Cajeros del período (filtrando por nombre si aplica) ──
    const cajerosF = cajerosRango.filter(c =>
      !filtro || c.cajero.toLowerCase().includes(filtro)
    );

    // ── Día único: mostrar estado completo ──
    if (desde === hasta) {
      const fecha = desde;
      const esHoy = fecha === hoy;
      msg += `📅 *${esHoy ? 'HOY' : fecha} — ${fecha}*\n\n`;

      // productosRaw (ventas/producto) incluye TODO: productos + preparaciones + alcohol = total real
      // cajerosF excluye servicios → da valor menor ($38.750 en vez de $50.000)
      const totalFacturas   = facturas.reduce((s, f) => s + (f.total || f.venta || 0), 0);
      const totalTodosProds = productosRaw.reduce((s, p) => s + (p.valor || 0), 0);
      const totalCajeros    = cajerosF.reduce((s, c) => s + c.total, 0);
      const totalReal       = totalFacturas   > 0 ? totalFacturas
                            : totalTodosProds > 0 ? totalTodosProds
                            : totalCajeros;
      const efectivoF    = cajerosF.reduce((s, c) => s + (c.efectivo    || 0), 0);
      const bancoF       = cajerosF.reduce((s, c) => s + (c.bancolombia || 0), 0);
      const nequiF       = cajerosF.reduce((s, c) => s + (c.nequi       || 0), 0);
      const ticketsF     = cajerosF.reduce((s, c) => s + c.tickets, 0);

      if (totalReal === 0) {
        msg += `_Sin ventas registradas_\n\n`;
      } else {
        if (cajerosF.length > 0) {
          cajerosF.forEach(c => {
            msg += `👤 *${c.cajero}* | 🎫 ${c.tickets} tickets\n`;
          });
          msg += `\n`;
        }
        msg += `💰 Total: *$${fp(totalReal)}*\n`;
        if (ticketsF > 0)  msg += `🎫 Tickets: ${ticketsF}\n`;
        if (efectivoF > 0) msg += `💵 Efectivo: $${fp(efectivoF)}\n`;
        if (bancoF > 0)    msg += `🏦 Transferencia: $${fp(bancoF)}\n`;
        if (nequiF > 0)    msg += `📱 Nequi: $${fp(nequiF)}\n`;
        msg += `\n`;

        if (esHoy) {
          const pct      = Math.min(100, Math.round((totalReal / metaDiaria) * 100));
          const barra    = Math.min(Math.ceil(pct / 10), 10);
          const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);
          const falta    = Math.max(0, metaDiaria - totalReal);
          msg += `🎯 *Meta del día: $${fp(metaDiaria)}*\n`;
          msg += `${progreso} ${pct}%\n`;
          msg += falta > 0 ? `📉 Falta: *$${fp(falta)}*\n` : `🏆 *¡Meta cumplida!*\n`;
        }
      }

      // Cierres del día
      const cierresDia = cierres.filter(c => c.fecha === fecha);
      if (cierresDia.length > 0) {
        msg += `\n📋 *Turno${cierresDia.length > 1 ? 's' : ''}:*\n`;
        cierresDia.forEach(c => {
          const hora = c.turnos?.match(/\d{2}:\d{2}:\d{2}/)?.[0] || '';
          const cajero = (c.turnos || '').split(' ').slice(-2).join(' ');
          msg += `   ⏰ ${hora} — ${cajero}\n`;
        });
      }

    } else {
      // ── Rango múltiple: cierres por día ──
      if (cierres.length > 0) {
        msg += `📋 *Turnos:*\n\n`;
        for (const c of cierres) {
          const partesTurno = (c.turnos || '').split(' ');
          const nombreCajero = partesTurno.slice(-2).join(' ');
          if (filtro && !nombreCajero.toLowerCase().includes(filtro)) continue;
          const hora = c.turnos?.match(/\d{2}:\d{2}:\d{2}/)?.[0] || '';
          msg += `📅 *${c.fecha}* — 👤 ${nombreCajero} ⏰ ${hora}\n`;
          if (msg.length > 3500) { partes.push(msg); msg = `🏧 _(continuación)_\n\n`; }
        }
        msg += `\n`;
      }

      // ── Totales del período ──
      if (cajerosF.length > 0) {
        const totalP    = cajerosF.reduce((s, c) => s + c.total, 0);
        const efectivoP = cajerosF.reduce((s, c) => s + (c.efectivo || 0), 0);
        const bancoP    = cajerosF.reduce((s, c) => s + (c.bancolombia || 0), 0);
        const nequiP    = cajerosF.reduce((s, c) => s + (c.nequi || 0), 0);
        const ticketsP  = cajerosF.reduce((s, c) => s + c.tickets, 0);

        msg += `─────────────────\n`;
        msg += `📊 *TOTAL DEL PERÍODO*\n`;
        msg += `💰 *$${fp(totalP)}* | 🎫 ${ticketsP} tickets\n`;
        if (efectivoP > 0) msg += `💵 Efectivo: $${fp(efectivoP)}\n`;
        if (bancoP > 0)    msg += `🏦 Bancolombia: $${fp(bancoP)}\n`;
        if (nequiP > 0)    msg += `📱 Nequi: $${fp(nequiP)}\n`;
        if (cajerosF.length > 1) {
          msg += `\n👥 *Por cajero:*\n`;
          cajerosF.forEach(c => {
            msg += `• *${c.cajero}*: $${fp(c.total)} (${c.tickets} tkt)\n`;
            if (c.efectivo > 0)    msg += `   💵 $${fp(c.efectivo)}\n`;
            if (c.bancolombia > 0) msg += `   🏦 $${fp(c.bancolombia)}\n`;
            if (c.nequi > 0)       msg += `   📱 $${fp(c.nequi)}\n`;
          });
        }
      }
    } // fin else rango múltiple

    // ── Primera venta y productos — solo si hay ventas reales ──
    const totalCaja = cajerosF.reduce((s, c) => s + c.total, 0) ||
                      productosRaw.reduce((s, p) => s + (p.valor || 0), 0);
    if (totalCaja > 0) {
      if (primeraHora) {
        const h = primeraHora.hora;
        const ampm = h >= 12 ? 'PM' : 'AM';
        msg += `\n🕐 *Primera venta:* ${h % 12 || 12}:00 ${ampm}\n`;
      }
      if (totalDescFacturas > 0) {
        msg += `🏷️ Descuentos del período: $${fp(totalDescFacturas)}\n`;
      }

      // Usar facturas con detalle si están disponibles
      const facturasConItems = facturas.filter(f => f.items?.length > 0);
      if (facturasConItems.length > 0) {
        const prods = procesarFacturasParaProductos(facturasConItems).slice(0, 10);
        if (prods.length > 0) {
          msg += `\n📦 *Productos vendidos:*\n`;
          const medallas = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
          prods.forEach((p, i) => {
            const cat = monitor.inferirCategoria(p.nombre);
            const uni = cat.startsWith('ESENCIAS') ? 'gr' : 'uds';
            msg += `${medallas[i]} *${p.nombre}*: ${p.cantidad} ${uni}\n`;
          });
        }
      } else if (productos.length > 0) {
        // Fallback: mostrar productos con distribución proporcional de servicios
        const esServicioCaja2 = (n) => { const s=(n||'').trim().toLowerCase(); return /^preparac|^prep\b/.test(s) || /^recarga(\s+\d|\s*$)/.test(s); };
        const preparacionesTotal = productosRaw.filter(p => esServicioCaja2(p.nombre))
                                               .reduce((s, p) => s + (p.valor || 0), 0);
        const sumaProd = productos.reduce((s, p) => s + (p.valor || 0), 0);
        msg += `\n📦 *Productos vendidos:*\n`;
        const medallas = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
        productos.forEach((p, i) => {
          const cat = monitor.inferirCategoria(p.nombre);
          const uni = cat.startsWith('ESENCIAS') ? 'gr' : 'uds';
          msg += `${medallas[i]} *${p.nombre}*: ${p.cantidad} ${uni}\n`;
        });
      }
    }

    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    partes.push(msg);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };
  } catch (e) {
    console.error('Error cierres:', e.message);
    return '❌ No pude consultar el movimiento de caja.';
  }
}

// ──────────────────────────────────────────────
// VENTAS POR HORA
// ──────────────────────────────────────────────

async function reporteVentasPorHora(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const porHora = await monitor.extraerVentasPorHora(page, desde, hasta);
    await browser.close();

    const activas = porHora.filter(h => h.total > 0);
    if (!activas.length) return `⏰ Sin ventas por hora para ${titulo}.`;

    const pico = activas.reduce((max, h) => h.total > max.total ? h : max, activas[0]);
    const total = activas.reduce((s, h) => s + h.total, 0);

    let msg = `⏰ *VENTAS POR HORA — ${titulo}*\n\n`;
    msg += `🏆 *Hora pico: ${pico.hora}:00 — $${pico.total.toLocaleString('es-CO')}*\n\n`;

    activas.forEach(h => {
      const barras = Math.round((h.total / pico.total) * 10);
      const barra = '█'.repeat(barras) + '░'.repeat(10 - barras);
      const pct = ((h.total / total) * 100).toFixed(0);
      msg += `\`${String(h.hora).padStart(2,'0')}:00\` ${barra} $${h.total.toLocaleString('es-CO')} (${pct}%)\n`;
    });

    msg += `\n💰 Total: $${total.toLocaleString('es-CO')}`;
    msg += `\n─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch (e) {
    console.error('Error ventas hora:', e.message);
    return '❌ No pude consultar las ventas por hora.';
  }
}

// ──────────────────────────────────────────────
// INVENTARIO POR CATEGORÍA
// ──────────────────────────────────────────────

async function reporteInventarioTodo() {
  try {
    const inventario = await monitor.consultarTodoInventario() || [];
    if (!inventario.length) return '📦 No se encontraron productos en el inventario.';

    const fp = monitor.formatPesos;
    const ORDEN_CATS = ['ESENCIAS M','ESENCIAS F','ESENCIAS U','ENVASE','ORIGINALES','REPLICA 1.1','CREMA CORPORAL','INSUMOS VARIOS'];

    // Agrupar por categoría
    const grupos = {};
    for (const p of inventario) {
      const cat = (p.categoria || 'OTROS').toUpperCase();
      if (!grupos[cat]) grupos[cat] = [];
      grupos[cat].push(p);
    }

    const partes = [];
    let msg = `📦 *INVENTARIO COMPLETO*\n_${inventario.length} productos_\n\n`;

    const cats = [
      ...ORDEN_CATS.filter(c => grupos[c]),
      ...Object.keys(grupos).filter(c => !ORDEN_CATS.includes(c)),
    ];

    for (const cat of cats) {
      const lista = grupos[cat].sort((a, b) => b.saldo - a.saldo);
      const esEsencia = cat.startsWith('ESENCIAS');
      const uni = esEsencia ? 'gr' : 'u';
      msg += `━━━ *${cat}* (${lista.length})\n`;
      lista.forEach(p => {
        const nivelStr = monitor.getNivelAlerta(p.nombre, p.medida, p.saldo, p.categoria);
        const nivel = nivelStr.includes('AGOTADO') ? '🚨' : nivelStr.includes('CRÍTICO') ? '🔴' : nivelStr.includes('BAJO') ? '🟡' : '🟢';
        msg += `${nivel} *${p.nombre}*: ${p.saldo} ${uni}\n`;
        if ((msg).length > 3800) { partes.push(msg); msg = `📦 _(continuación)_\n\n`; }
      });
      msg += `\n`;
    }

    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    partes.push(msg);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };
  } catch(e) {
    console.error('Error inventario todo:', e.message);
    return '❌ No pude consultar el inventario completo.';
  }
}

async function reporteInventarioCategoria(categoria) {
  if (!categoria) return '❌ Especifica una categoría. Ej: "qué falta de ENVASE"';
  try {
    const productos = await monitor.consultarInventarioPorCategoria(categoria);
    if (!productos) return '❌ No pude conectar al inventario.';

    const catN = categoria.toUpperCase();
    const umbrales = monitor.UMBRALES;

    // Detectar umbral aplicable
    const umbralKey = Object.keys(umbrales).find(k => catN.includes(k) || k.includes(catN));
    const umbral = umbralKey ? umbrales[umbralKey] : { alerta: 500, critico: 50, restock: true };

    const bajos    = productos.filter(p => p.saldo < umbral.alerta);
    const normales = productos.filter(p => p.saldo >= umbral.alerta);
    const fp       = monitor.formatPesos;

    if (!productos.length) return `📦 No encontré productos en la categoría *${catN}*.`;

    const agotados  = bajos.filter(p => p.saldo <= 0);
    const criticos  = bajos.filter(p => p.saldo > 0 && p.saldo <= umbral.critico);
    const alertaBaj = bajos.filter(p => p.saldo > umbral.critico);

    let totalRestock = 0;
    const lineas = [];

    const agregarProducto = (p) => {
      const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= umbral.critico ? '🔴 CRÍTICO' : '🟡 BAJO';
      let linea = `${nivel} *${p.nombre}*: ${p.saldo} ${p.medida}\n`;
      if (p.costoUnidad > 0 && umbral.restock) {
        const reponer = Math.max(0, umbral.alerta - p.saldo);
        const costo = reponer * p.costoUnidad;
        totalRestock += costo;
        linea += `   💵 $${fp(p.costoUnidad)}/u → reponer ${reponer}: *$${fp(costo)}*\n`;
      }
      lineas.push(linea);
    };

    agotados.forEach(agregarProducto);
    criticos.forEach(agregarProducto);
    alertaBaj.forEach(agregarProducto);

    const enc = `📦 *INVENTARIO — ${catN}*\n` +
      `_${productos.length} productos | ${bajos.length} bajo mínimo_\n` +
      (agotados.length ? `🚨 *${agotados.length} AGOTADOS*\n` : '') +
      (umbral.restock ? `_Mínimo recomendado: ${umbral.alerta} ${umbral.medida}_\n` : '') + `\n`;

    const partes = [];
    let parte = enc;
    for (const l of lineas) {
      if ((parte + l).length > 3500) { partes.push(parte); parte = `📦 _(continuación)_\n\n`; }
      parte += l;
    }

    if (normales.length > 0) {
      parte += `\n✅ *${normales.length} productos OK (sobre el mínimo):*\n`;
      normales.forEach(p => {
        parte += `🟢 *${p.nombre}*: ${p.saldo} ${p.medida}\n`;
        if ((parte).length > 3500) { partes.push(parte); parte = `📦 _(productos OK — continuación)_\n\n`; }
      });
    }
    if (umbral.restock && totalRestock > 0) parte += `\n💰 *Inversión estimada: $${fp(totalRestock)}*\n`;
    parte += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    partes.push(parte);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };
  } catch(e) {
    console.error('Error inventario categoría:', e.message);
    return '❌ No pude consultar la categoría. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// REPORTE RESTOCK — costo de reponer inventario bajo
// ──────────────────────────────────────────────

async function reporteRestock(soloAgotados = true) {
  try {
    const inventario = await monitor.consultarTodoInventario() || [];

    // Filtrar según modo
    const bajos = inventario.filter(p => {
      if (soloAgotados) {
        // ORIGINALES y RÉPLICAS: solo si saldo = 0 (independiente de medida)
        const cat = (p.categoria || '').toUpperCase();
        if (cat.includes('ORIGINAL') || cat.includes('REPLICA')) {
          return p.saldo <= 0;
        }
        // Esencias, envases y demás: agotado o crítico según umbral real
        const nivel = monitor.getNivelAlerta(p.nombre, p.medida, p.saldo, p.categoria);
        return nivel.includes('AGOTADO') || nivel.includes('CRÍTICO');
      }
      // Todos los bajos según umbrales
      if (p.medida && (p.medida.toLowerCase().includes('gr') || p.medida.toLowerCase().includes('ml'))) {
        return p.saldo < 500;
      }
      return p.saldo < 20;
    }).sort((a, b) => a.saldo - b.saldo);

    if (!bajos.length) return soloAgotados
      ? '✅ No hay productos agotados ni críticos.'
      : '✅ *Restock:* Todos los productos tienen stock suficiente.';

    const fp = monitor.formatPesos;
    let totalRestock = 0;

    const ORDEN_CATS = ['ESENCIAS M','ESENCIAS F','ESENCIAS U','ESENCIAS','ENVASE','ORIGINALES','REPLICA 1.1','CREMA CORPORAL','INSUMOS VARIOS','OTROS'];
    const CAT_EMOJI = {
      'ESENCIAS M': '🧪', 'ESENCIAS F': '🌸', 'ESENCIAS U': '🌀',
      'ESENCIAS': '🧪', 'ENVASE': '🧴', 'ORIGINALES': '✨',
      'REPLICA 1.1': '🔁', 'CREMA CORPORAL': '💆', 'INSUMOS VARIOS': '🔧', 'OTROS': '📦',
    };

    // Agrupar por categoría
    const grupos = {};
    bajos.forEach(p => {
      const cat = (p.categoria || 'OTROS').toUpperCase().trim();
      const catKey = ORDEN_CATS.find(k => cat.includes(k)) || 'OTROS';
      if (!grupos[catKey]) grupos[catKey] = [];
      grupos[catKey].push(p);
    });

    // Construir líneas por categoría
    const bloquesCat = [];
    const costoPorCat = {};
    const cats = [...ORDEN_CATS.filter(c => grupos[c])];
    for (const catKey of cats) {
      const lista = grupos[catKey].sort((a, b) => a.saldo - b.saldo);
      const emoji = CAT_EMOJI[catKey] || '📦';
      let costoCat = 0;
      let bloqueCat = `${emoji} *${catKey}* (${lista.length})\n`;
      lista.forEach(p => {
        const umbral = monitor.getUmbral(p.nombre, p.medida, p.categoria);
        const esRestock = umbral.restock !== false;
        const nivelStr = monitor.getNivelAlerta(p.nombre, p.medida, p.saldo, p.categoria);
        const nivelEmoji = nivelStr.includes('AGOTADO') ? '🚨' : nivelStr.includes('CRÍTICO') ? '🔴' : '🟡';
        bloqueCat += `${nivelEmoji} *${p.nombre}*: ${p.saldo} ${p.medida || 'u'}\n`;
        if (p.costoUnidad > 0 && esRestock) {
          const reponer = Math.max(0, umbral.alerta - p.saldo);
          const costoReponer = Math.round(reponer * p.costoUnidad);
          totalRestock += costoReponer;
          costoCat += costoReponer;
          if (reponer > 0) bloqueCat += `   🛒 Reponer ${reponer} → *$${fp(costoReponer)}*\n`;
        }
      });
      if (costoCat > 0) {
        costoPorCat[catKey] = costoCat;
        bloqueCat += `   💵 _Subtotal ${catKey}: $${fp(costoCat)}_\n`;
      }
      bloqueCat += `\n`;
      bloquesCat.push(bloqueCat);
    }

    const encabezado = soloAgotados
      ? `🚨 *LO QUE FALTA (${bajos.length} productos)*\n\n`
      : `💰 *RESTOCK COMPLETO (${bajos.length} productos bajos)*\n\n`;
    const partes = [];
    let parteActual = encabezado;
    for (const bloque of bloquesCat) {
      if ((parteActual + bloque).length > 3500) {
        partes.push(parteActual);
        parteActual = `🚨 _(continuación)_\n\n`;
      }
      parteActual += bloque;
    }

    let pie = ``;
    if (totalRestock > 0) {
      pie += `━━━ *RESUMEN POR CATEGORÍA* ━━━\n`;
      const catsOrdenadas = Object.entries(costoPorCat).sort((a, b) => b[1] - a[1]);
      catsOrdenadas.forEach(([cat, costo]) => {
        const emoji = CAT_EMOJI[cat] || '📦';
        const pct = Math.round((costo / totalRestock) * 100);
        pie += `${emoji} ${cat}: *$${fp(costo)}* (${pct}%)\n`;
      });
      pie += `\n💰 *INVERSIÓN TOTAL: $${fp(totalRestock)}*\n`;
    }
    pie += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    parteActual += pie;
    partes.push(parteActual);

    if (partes.length === 1) return partes[0];
    return { tipo: 'mensajes', partes };

  } catch(e) {
    console.error('Error restock:', e.message);
    return '❌ No pude calcular el restock. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// REPORTE COMPLETO: VENTAS VS INVENTARIO
// ──────────────────────────────────────────────

async function reporteVentasVsInventario() {
  try {
    const inventario = await monitor.consultarTodoInventario() || [];
    const { browser, page } = await monitor.crearSesionPOS();
    const ventasMes = await monitor.extraerVentasProducto(page, monitor.fechaInicioMes(), monitor.fechaHoy());
    await browser.close();

    // Unificar inventario + ventas
    const mapa = {};
    inventario.forEach(p => {
      mapa[p.nombre] = {
        nombre: p.nombre, stock: p.saldo, medida: p.medida || '',
        costoUnidad: p.costoUnidad || 0, costoTotal: p.costoTotal || 0,
        vendidoMes: 0, valorMes: 0,
      };
    });
    ventasMes.forEach(p => {
      if (!mapa[p.nombre]) mapa[p.nombre] = { nombre: p.nombre, stock: null, medida: '', costoUnidad: 0, costoTotal: 0, vendidoMes: 0, valorMes: 0 };
      mapa[p.nombre].vendidoMes = p.cantidad;
      mapa[p.nombre].valorMes   = p.valor;
    });

    const items = Object.values(mapa)
      .filter(i => i.vendidoMes > 0 || (i.stock !== null && i.stock > 0))
      .sort((a, b) => b.vendidoMes - a.vendidoMes);

    if (!items.length) return '📦 Sin datos de productos para este período.';

    const totalVendido  = items.reduce((s, i) => s + i.valorMes, 0);
    const totalStockVal = items.reduce((s, i) => s + (i.costoTotal || 0), 0);
    const mes = new Date().toLocaleString('es-CO', { month: 'long', year: 'numeric' });

    // Cálculo de velocidad de rotación
    const hoyD2 = ahoraColombia();
    const inicioMesD2 = new Date(Date.UTC(hoyD2.getUTCFullYear(), hoyD2.getUTCMonth(), 1));
    const diasTransc2 = Math.max(1, Math.floor((hoyD2 - inicioMesD2) / 86400000) + 1);

    // Sección de alertas críticas al tope
    const ORDENES2 = { agotado: 0, critico: 1, alerta: 2 };
    const criticos2 = items
      .map(item => {
        const tasa = item.vendidoMes > 0 ? item.vendidoMes / diasTransc2 : 0;
        const dias = (item.stock > 0 && tasa > 0) ? Math.round(item.stock / tasa) : null;
        let urg = 'ok';
        if (item.stock !== null && item.stock <= 0 && item.vendidoMes > 0) urg = 'agotado';
        else if (dias !== null && dias <= 5)  urg = 'critico';
        else if (dias !== null && dias <= 10) urg = 'alerta';
        return { ...item, tasaDiaria: tasa, diasParaAgotarse: dias, urgencia: urg };
      })
      .filter(i => i.urgencia !== 'ok')
      .sort((a, b) => (ORDENES2[a.urgencia] ?? 9) - (ORDENES2[b.urgencia] ?? 9));

    // Construir líneas individuales
    const lineas = [];
    items.forEach(item => {
      const tasa = item.vendidoMes > 0 ? item.vendidoMes / diasTransc2 : 0;
      const diasAgotar = (item.stock > 0 && tasa > 0) ? Math.round(item.stock / tasa) : null;
      const nivelStock = item.stock === null ? '❔' :
        item.stock <= 0  ? '🚨' : item.stock <= 5 ? '🔴' : item.stock <= 20 ? '🟡' : '🟢';
      const velLabel = diasAgotar !== null
        ? (diasAgotar <= 5  ? ` ⚡~${diasAgotar}d`
        :  diasAgotar <= 10 ? ` 🔴~${diasAgotar}d`
        :  diasAgotar <= 20 ? ` 🟡~${diasAgotar}d` : '')
        : '';

      let bloque = `▪️ *${item.nombre}*\n`;
      bloque += `   📈 Vendido: ${item.vendidoMes} uds`;
      if (item.valorMes > 0) bloque += ` — $${item.valorMes.toLocaleString('es-CO')}`;
      if (tasa > 0) bloque += ` | ⏱${tasa.toFixed(1)}/d`;
      bloque += `\n`;
      if (item.stock !== null) {
        bloque += `   ${nivelStock} Stock: ${item.stock} ${item.medida}${velLabel}`;
        if (item.costoUnidad > 0) bloque += ` | 💵 $${item.costoUnidad.toLocaleString('es-CO')}/u`;
        if (item.costoTotal  > 0) bloque += ` | Total: $${item.costoTotal.toLocaleString('es-CO')}`;
        bloque += `\n`;
      }
      lineas.push(bloque);
    });

    // Sección alerta crítica al inicio
    let seccionCritica = '';
    if (criticos2.length > 0) {
      const iconUrg2 = { agotado: '🚨', critico: '⚡', alerta: '🔴' };
      seccionCritica += `\n⚠️ *ATENCIÓN — ${criticos2.length} producto(s) se agotan pronto:*\n`;
      criticos2.forEach(i => {
        const ico = iconUrg2[i.urgencia] || '🔴';
        const d   = i.diasParaAgotarse;
        const lab = i.urgencia === 'agotado' ? 'AGOTADO' : d !== null ? `~${d} días` : '?';
        seccionCritica += `${ico} *${i.nombre}*: stock ${i.stock} ${i.medida} → *${lab}*\n`;
      });
      seccionCritica += '\n';
    }

    // Dividir en partes de máx 3500 chars
    const encabezado = `📦 *VENTAS VS INVENTARIO — ${mes.toUpperCase()}*\n_${monitor.fechaInicioMes()} → ${monitor.fechaHoy()}_\n_(${items.length} productos)_\n${seccionCritica}\n`;
    let pie = `\n💰 *Total vendido: $${totalVendido.toLocaleString('es-CO')}*\n`;
    if (totalStockVal > 0) pie += `🏦 Valor total en stock: $${totalStockVal.toLocaleString('es-CO')}\n`;
    pie += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;

    const partes = [];
    let parteActual = encabezado;
    for (const linea of lineas) {
      if ((parteActual + linea).length > 3500) {
        partes.push(parteActual);
        parteActual = `📦 _(continuación)_\n\n`;
      }
      parteActual += linea;
    }
    parteActual += pie;
    partes.push(parteActual);

    return { tipo: 'mensajes', partes };
  } catch(e) {
    console.error('Error ventas vs inventario:', e.message);
    return '❌ No pude generar el reporte. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// CRUCE PRODUCTO EN RANGO DE FECHAS
// ──────────────────────────────────────────────

async function cruzarProductoRango(query, desde, hasta) {
  const palabras = query.toLowerCase().trim().split(/\s+/).filter(p => p.length > 1);
  function coincide(nombre) {
    const n = nombre.toLowerCase();
    return palabras.every(p => n.includes(p));
  }

  try {
    const inventario = await monitor.consultarTodoInventario() || [];
    const { browser, page } = await monitor.crearSesionPOS();
    const ventasRango = await monitor.extraerVentasProducto(page, desde, hasta);
    await browser.close();

    const invFiltrado    = inventario.filter(p => coincide(p.nombre));
    const ventasFiltrado = ventasRango.filter(p => coincide(p.nombre));

    if (!invFiltrado.length && !ventasFiltrado.length) {
      return `🔍 No encontré _"${query}"_ en inventario ni en ventas del período.\n\nIntenta con un término más corto.`;
    }

    const mapa = {};
    invFiltrado.forEach(p => {
      mapa[p.nombre] = { nombre: p.nombre, stock: p.saldo, medida: p.medida || '', vendido: 0, valor: 0 };
    });
    ventasFiltrado.forEach(p => {
      if (!mapa[p.nombre]) mapa[p.nombre] = { nombre: p.nombre, stock: null, medida: '', vendido: 0, valor: 0 };
      mapa[p.nombre].vendido = p.cantidad;
      mapa[p.nombre].valor   = p.valor;
    });

    const items = Object.values(mapa).sort((a, b) => b.vendido - a.vendido);
    const numDias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
    const labelPeriodo = numDias === 1 ? desde :
      numDias <= 7 ? `semana (${desde} → ${hasta})` :
      numDias <= 15 ? `quincena (${desde} → ${hasta})` : `${desde} → ${hasta}`;

    let msg = `🔍 *"${query.toUpperCase()}" — ${labelPeriodo.toUpperCase()}*\n\n`;

    items.forEach(item => {
      const nivelStock = item.stock === null ? '' :
        item.stock <= 0 ? ' 🚨 AGOTADO' : item.stock <= 5 ? ' 🔴' : item.stock <= 20 ? ' 🟡' : ' 🟢';
      msg += `📦 *${item.nombre}*\n`;
      if (item.vendido > 0) msg += `   📈 Vendido: ${item.vendido} uds — $${item.valor.toLocaleString('es-CO')}\n`;
      else                  msg += `   📈 Sin ventas en este período\n`;
      if (item.stock !== null) msg += `   📦 Stock actual: *${item.stock} ${item.medida}*${nivelStock}\n`;
      msg += '\n';
    });

    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;
  } catch(e) {
    console.error('Error cruce producto rango:', e.message);
    return '❌ No pude consultar los datos. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// CRUCE VENTAS + INVENTARIO por producto/categoría
// ──────────────────────────────────────────────

async function cruzarProducto(query) {
  const palabras = query.toLowerCase().trim().split(/\s+/).filter(p => p.length > 1);

  function coincide(nombre) {
    const n = nombre.toLowerCase();
    return palabras.every(p => n.includes(p));
  }

  try {
    // Ejecutar secuencialmente para no saturar memoria en Railway
    // 1. Inventario completo (app.vectorpos.com.co)
    const inventario = await monitor.consultarTodoInventario() || [];

    // 2. Ventas del mes (pos.vectorpos.com.co)
    const { browser, page } = await monitor.crearSesionPOS();
    const ventasMes = await monitor.extraerVentasProducto(page, monitor.fechaInicioMes(), monitor.fechaHoy());
    const ventasHoy = await monitor.extraerVentasProducto(page, monitor.fechaHoy(), monitor.fechaHoy());
    await browser.close();

    // Filtrar por query
    const invFiltrado   = inventario.filter(p => coincide(p.nombre));
    const ventasFiltMes = ventasMes.filter(p  => coincide(p.nombre));
    const ventasFiltHoy = ventasHoy.filter(p  => coincide(p.nombre));

    if (!invFiltrado.length && !ventasFiltMes.length) {
      return `🔍 No encontré _"${query}"_ en inventario ni en ventas del mes.\n\nVerifica el nombre exacto o intenta con un término más corto (ej: "lattafa", "tapa plana", "alcohol").`;
    }

    // Construir mapa unificado: nombre → { stock, medida, vendidoMes, valorMes, vendidoHoy }
    const mapa = {};

    invFiltrado.forEach(p => {
      if (!mapa[p.nombre]) mapa[p.nombre] = { nombre: p.nombre, stock: 0, medida: '', vendidoMes: 0, valorMes: 0, vendidoHoy: 0 };
      mapa[p.nombre].stock  = p.saldo;
      mapa[p.nombre].medida = p.medida;
    });

    ventasFiltMes.forEach(p => {
      if (!mapa[p.nombre]) mapa[p.nombre] = { nombre: p.nombre, stock: null, medida: '', vendidoMes: 0, valorMes: 0, vendidoHoy: 0 };
      mapa[p.nombre].vendidoMes = p.cantidad;
      mapa[p.nombre].valorMes   = p.valor;
    });

    ventasFiltHoy.forEach(p => {
      if (mapa[p.nombre]) mapa[p.nombre].vendidoHoy = p.cantidad;
    });

    const items = Object.values(mapa).sort((a, b) => (b.vendidoMes - a.vendidoMes) || (b.stock - a.stock));

    // Cálculo de velocidad de rotación
    const hoyD = ahoraColombia();
    const inicioMesD = new Date(Date.UTC(hoyD.getUTCFullYear(), hoyD.getUTCMonth(), 1));
    const diasTranscurridos = Math.max(1, Math.floor((hoyD - inicioMesD) / 86400000) + 1);

    let msg = `🔍 *ANÁLISIS — "${query.toUpperCase()}"*\n`;
    msg += `_Ventas del mes + stock actual + proyección_\n\n`;

    items.forEach(item => {
      const nivelStock = item.stock === null ? '' :
        item.stock <= 0    ? ' 🚨 *AGOTADO*' :
        item.stock <= 5    ? ' 🔴 CRÍTICO' :
        item.stock <= 20   ? ' 🟡 BAJO' : ' 🟢';

      const tasaDiaria = item.vendidoMes > 0 ? item.vendidoMes / diasTranscurridos : 0;
      const diasParaAgotarse = (item.stock > 0 && tasaDiaria > 0)
        ? Math.round(item.stock / tasaDiaria) : null;
      const alertaVel = diasParaAgotarse !== null
        ? (diasParaAgotarse <= 5  ? ` ⚡ se agota en ~${diasParaAgotarse} días`
        :  diasParaAgotarse <= 10 ? ` 🔴 ~${diasParaAgotarse} días restantes`
        :  diasParaAgotarse <= 20 ? ` 🟡 ~${diasParaAgotarse} días restantes`
        : '') : '';

      msg += `📦 *${item.nombre}*\n`;

      if (item.stock !== null) {
        msg += `   📦 Stock: *${item.stock} ${item.medida}*${nivelStock}\n`;
      } else {
        msg += `   📦 Stock: sin datos\n`;
      }

      if (item.vendidoMes > 0) {
        msg += `   📈 Vendido (mes): ${item.vendidoMes} uds — $${item.valorMes.toLocaleString('es-CO')}\n`;
        msg += `   ⏱ Ritmo: ${tasaDiaria.toFixed(1)}/día${alertaVel}\n`;
      } else {
        msg += `   📈 Sin ventas este mes\n`;
      }

      if (item.vendidoHoy > 0) {
        msg += `   🕐 Hoy: ${item.vendidoHoy} uds\n`;
      }

      msg += '\n';
    });

    msg += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    return msg;

  } catch(e) {
    console.error('Error cruce producto:', e.message);
    return '❌ No pude cruzar los datos. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// CRUCE FALTANTES POR CATEGORÍA
// Muestra ventas vs stock por cada categoría clave
// y detecta inconsistencias (vendido > stock, no en inventario)
// ──────────────────────────────────────────────

async function cruceFaltantesCategorias() {
  // Regex de servicios (no son mercancía real)
  const esServicio = n => /^preparac|^prep\b|^recarga(\s+\d|\s*$)|^alcohol\b/i.test(n.trim());

  try {
    const inventario = await monitor.consultarTodoInventario() || [];
    const { browser, page } = await monitor.crearSesionPOS();
    const ventasMes = await monitor.extraerVentasProducto(page, monitor.fechaInicioMes(), monitor.fechaHoy());
    await browser.close();

    const fp = n => (n || 0).toLocaleString('es-CO');
    const invDisponible = inventario.length > 0;

    // Construir mapa cruzado — filtrar servicios
    const mapa = {};
    inventario.forEach(p => {
      if (esServicio(p.nombre)) return;
      mapa[p.nombre] = {
        nombre: p.nombre,
        cat: (p.categoria || monitor.inferirCategoria(p.nombre, p.medida || '')).toUpperCase(),
        stock: p.saldo, medida: p.medida || '',
        costoUnidad: p.costoUnidad || 0, vendidoMes: 0, valorMes: 0,
      };
    });
    ventasMes.forEach(p => {
      if (esServicio(p.nombre)) return;
      if (!mapa[p.nombre]) {
        mapa[p.nombre] = {
          nombre: p.nombre,
          cat: monitor.inferirCategoria(p.nombre, '').toUpperCase(),
          stock: null, medida: '', costoUnidad: 0, vendidoMes: 0, valorMes: 0,
        };
      }
      mapa[p.nombre].vendidoMes = p.cantidad;
      mapa[p.nombre].valorMes   = p.valor;
    });

    const todos = Object.values(mapa);

    // Grupos: 'ESENCIAS' como prefijo captura ESENCIAS M, F, U y ESENCIAS genérico
    const GRUPOS = [
      { nombre: 'ENVASES',      cat: 'ENVASE',        icon: '📦' },
      { nombre: 'ESENCIAS',     cat: 'ESENCIAS',      icon: '🌸' },
      { nombre: 'RÉPLICAS 1.1', cat: 'REPLICA 1.1',   icon: '🔁' },
      { nombre: 'ORIGINALES',   cat: 'ORIGINALES',    icon: '⭐' },
      { nombre: 'INSUMOS',      cat: 'INSUMOS VARIOS',icon: '🧪' },
      { nombre: 'CREMAS',       cat: 'CREMA CORPORAL',icon: '🧴' },
    ];

    const bloques = [];
    let resumenAlertas = '';
    let totalDiscrep = 0;

    for (const grupo of GRUPOS) {
      const items = todos.filter(i => i.cat.startsWith(grupo.cat));
      if (!items.length) continue;

      const totalVend = items.reduce((s, i) => s + i.valorMes, 0);
      const totalUds  = items.reduce((s, i) => s + i.vendidoMes, 0);
      const prodVend  = items.filter(i => i.vendidoMes > 0).length;

      // Solo hacer análisis de inconsistencias si inventario está disponible
      const sinRegistro       = invDisponible ? items.filter(i => i.vendidoMes > 0 && i.stock === null) : [];
      const vendidoMayorStock = invDisponible ? items.filter(i => i.vendidoMes > 0 && i.stock !== null && i.vendidoMes > i.stock) : [];
      const agotados          = invDisponible ? items.filter(i => i.stock === 0 && i.vendidoMes > 0) : [];
      const totalStk          = invDisponible ? items.filter(i => i.stock > 0).reduce((s, i) => s + i.stock, 0) : null;
      const refConStock       = invDisponible ? items.filter(i => i.stock > 0).length : null;

      const disc = sinRegistro.length + vendidoMayorStock.length;
      totalDiscrep += disc;

      let b = `${grupo.icon} *${grupo.nombre}*\n`;
      b += `   📈 Vendido mes: ${prodVend} ref | ${totalUds} uds | *$${fp(totalVend)}*\n`;

      if (invDisponible) {
        b += `   📦 Stock actual: ${totalStk} uds en ${refConStock} ref\n`;
      } else {
        b += `   📦 Stock: no disponible\n`;
      }

      // Top 5 más vendidos de la categoría
      const top = items.filter(i => i.vendidoMes > 0).sort((a,b) => b.vendidoMes - a.vendidoMes).slice(0, 5);
      if (top.length) {
        top.forEach(i => {
          const stk = i.stock !== null ? ` | stock ${i.stock}${i.medida ? ' '+i.medida : ''}` : '';
          b += `   • ${i.nombre}: ${i.vendidoMes} vend${stk}\n`;
        });
      }

      if (invDisponible) {
        if (sinRegistro.length > 0) {
          b += `   ⚠️ Sin registro en inventario (${sinRegistro.length}):\n`;
          sinRegistro.slice(0, 4).forEach(i => {
            b += `      🔴 ${i.nombre}: ${i.vendidoMes} vendidos\n`;
          });
          if (sinRegistro.length > 4) b += `      _...y ${sinRegistro.length - 4} más_\n`;
        }
        if (vendidoMayorStock.length > 0) {
          b += `   ⚠️ Vendido > Stock (${vendidoMayorStock.length}):\n`;
          vendidoMayorStock.slice(0, 4).forEach(i => {
            b += `      🟡 ${i.nombre}: vend ${i.vendidoMes} / stock ${i.stock} (diff ${i.vendidoMes - i.stock})\n`;
          });
          if (vendidoMayorStock.length > 4) b += `      _...y ${vendidoMayorStock.length - 4} más_\n`;
        }
        if (agotados.length > 0) {
          b += `   🚨 Agotados: ${agotados.length} ref\n`;
        }
        if (disc === 0 && agotados.length === 0) b += `   ✅ Cuadra\n`;
      }

      bloques.push(b);
      if (disc > 0) resumenAlertas += `${grupo.icon} ${grupo.nombre}: ${disc} inconsistencia(s)\n`;
    }

    if (!bloques.length) return '📦 Sin datos de ventas para hacer el cruce.';

    const mes = new Date().toLocaleString('es-CO', { month: 'long', year: 'numeric' });
    let header = `🔍 *FALTANTES POR CATEGORÍA — ${mes.toUpperCase()}*\n`;
    header += `_${monitor.fechaInicioMes()} → ${monitor.fechaHoy()}_\n`;

    if (!invDisponible) {
      header += `\n⚠️ _Inventario no disponible — solo se muestran ventas._\n`;
      header += `_Para cruce completo intenta de nuevo en 1 minuto._\n\n`;
    } else if (totalDiscrep > 0) {
      header += `\n⚠️ *${totalDiscrep} posible(s) inconsistencia(s):*\n${resumenAlertas}`;
      header += `_"Vendido > Stock" puede ser reposición de mercancía o faltante real._\n\n`;
    } else {
      header += `\n✅ *Todo cuadra — sin inconsistencias detectadas*\n\n`;
    }

    const msgs = [];
    let actual = header;
    for (const b of bloques) {
      if ((actual + b).length > 3800) { msgs.push(actual); actual = `🔍 _(continuación)_\n\n`; }
      actual += b + '\n';
    }
    actual += `─────────────────\n🤖 _Asistente de Chu Vanegas_`;
    msgs.push(actual);

    return msgs.length === 1 ? msgs[0] : { tipo: 'mensajes', partes: msgs };

  } catch(e) {
    console.error('Error cruceFaltantesCategorias:', e.message);
    return '❌ No pude generar el cruce. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// BALANCE CRÍTICO — delegado a monitor-pos
// ──────────────────────────────────────────────

async function balanceCritico() {
  try {
    const msg = await monitor.reporteBalanceCritico({ soloSiHayCriticos: false });
    return msg || '❌ No pude calcular el balance. Intenta de nuevo.';
  } catch(e) {
    console.error('Error balanceCritico:', e.message);
    return '❌ No pude generar el balance crítico. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// REQUERIMIENTOS
// ──────────────────────────────────────────────

async function guardarNuevoRequerimiento(descripcion) {
  try {
    const req = await db.guardarRequerimiento(descripcion.trim());
    return `✅ *Requerimiento #${req.id} creado*\n\n📝 _"${req.descripcion}"_\n📅 ${req.fecha}\n\nEscribe *V* para ver todos los requerimientos.`;
  } catch(e) {
    console.error('Error guardando requerimiento:', e.message);
    return '❌ No pude guardar el requerimiento. Intenta de nuevo.';
  }
}

async function verRequerimientos() {
  try {
    const lista = await db.listarRequerimientos();
    if (!lista.length) return '📋 No hay requerimientos registrados.';

    const pendientes = lista.filter(r => r.estado === 'pendiente');
    const resueltos  = lista.filter(r => r.estado !== 'pendiente');

    let msg = `📋 *REQUERIMIENTOS* (${lista.length} total)\n\n`;
    if (pendientes.length) {
      msg += `🔴 *PENDIENTES (${pendientes.length}):*\n`;
      pendientes.slice(-10).forEach(r => {
        msg += `• *#${r.id}* ${r.descripcion}\n  _${r.fecha?.split('T')[0] || ''}_\n`;
      });
    }
    if (resueltos.length) {
      msg += `\n✅ *RESUELTOS (${resueltos.length})*\n`;
      resueltos.slice(-5).forEach(r => {
        msg += `• ~~#${r.id}~~ ${r.descripcion}\n`;
      });
    }
    msg += `\n_Escribe *R* para crear uno nuevo_`;
    return msg;
  } catch(e) {
    return '❌ No pude cargar los requerimientos.';
  }
}

// ──────────────────────────────────────────────
// EXPORTAR EN EXCEL (CSV con BOM para Excel)
// ──────────────────────────────────────────────

async function exportarExcelMes() {
  try {
    const desde = monitor.fechaInicioMes();
    const hasta  = monitor.fechaHoy();

    const { browser, page } = await monitor.crearSesionPOS();
    const ventas    = await monitor.extraerVentasGenerales(page, desde, hasta);
    const cajeros   = await monitor.extraerVentasCajero(page, desde, hasta);
    const productos = await monitor.extraerVentasProducto(page, desde, hasta);
    await browser.close();

    // Construir CSV (BOM \uFEFF para que Excel detecte UTF-8)
    let csv = '\uFEFF';
    csv += `REPORTE MENSUAL - ${desde} al ${hasta}\n\n`;

    csv += 'VENTAS POR DIA\n';
    csv += 'Fecha,Total,Tickets,Efectivo,Bancolombia,Nequi\n';
    ventas.forEach(v => {
      csv += `${v.fecha},${v.totalVentas},${v.tickets},${v.efectivo},${v.bancolombia},${v.nequi}\n`;
    });

    csv += '\nCAJEROS DEL MES\n';
    csv += 'Cajero,Total,Tickets,Efectivo,Bancolombia,Nequi\n';
    cajeros.forEach(c => {
      csv += `"${c.cajero}",${c.total},${c.tickets},${c.efectivo},${c.bancolombia},${c.nequi}\n`;
    });

    csv += '\nPRODUCTOS MAS VENDIDOS\n';
    csv += 'Producto,Cantidad,Valor\n';
    productos.slice(0, 100).forEach(p => {
      csv += `"${p.nombre}",${p.cantidad},${p.valor}\n`;
    });

    const filePath = path.join(os.tmpdir(), `Reporte_${hasta}.csv`);
    fs.writeFileSync(filePath, csv, 'utf8');

    return {
      tipo: 'archivo',
      path: filePath,
      nombre: `Reporte_${hasta}.csv`,
      caption: `📊 Reporte mensual ${desde} → ${hasta}\n_Ventas por día, cajeros y productos_`,
    };
  } catch(e) {
    console.error('Error generando Excel:', e.message);
    return '❌ No pude generar el archivo. Intenta de nuevo.';
  }
}

// ──────────────────────────────────────────────
// GESTIÓN DE USUARIOS AUTORIZADOS
// ──────────────────────────────────────────────

async function agregarUsuarioAutorizado(chatId, nombre) {
  try {
    const agregado = await db.agregarUsuario({ chatId, nombre });
    if (!agregado) return `ℹ️ El usuario *${nombre}* (ID: \`${chatId}\`) ya tiene acceso.`;
    return `✅ *${nombre}* agregado correctamente.\n\nAhora puede escribirle a Chu en Telegram con su cuenta.`;
  } catch(e) {
    return '❌ No pude agregar el usuario. Intenta de nuevo.';
  }
}

async function verUsuariosAutorizados() {
  try {
    const lista = await db.listarUsuarios();
    if (!lista.length) return '👥 No hay usuarios autorizados aún.\n\nDi: _"agrega al usuario 123456 como Laura"_';
    let msg = `👥 *USUARIOS AUTORIZADOS (${lista.length})*\n\n`;
    lista.forEach((u, i) => {
      msg += `${i + 1}. *${u.nombre}* — ID: \`${u.chatId}\`\n   _Desde: ${u.fecha?.split('T')[0]}_\n`;
    });
    msg += `\n_Para quitar: "quita acceso al usuario [chatId]"_`;
    return msg;
  } catch(e) {
    return '❌ No pude cargar los usuarios.';
  }
}

async function quitarUsuarioAutorizado(chatId) {
  try {
    const quitado = await db.quitarUsuario(chatId);
    if (!quitado) return `ℹ️ No encontré un usuario con ID \`${chatId}\`.`;
    return `✅ Usuario \`${chatId}\` removido. Ya no tiene acceso a Chu.`;
  } catch(e) {
    return '❌ No pude quitar el usuario. Intenta de nuevo.';
  }
}

function mensajeBienvenida() {
  return `👋 *¡Hola jefe, qué vas a hacer hoy?*\n\n` + mensajeMenu();
}

function mensajeMenu() {
  return (
    `✨ *SALMA PERFUM*\n\n` +

    `📈 *VENTAS*\n` +
    `1·Hoy  2·Mes  3·Mes ant  4·Semana  5·Rango  6·General\n\n` +

    `🧑‍💼 *CAJEROS*\n` +
    `7·Quién trabajó  8·Ranking  9·Hora pico  10·Medios de pago\n\n` +

    `🧾 *CAJA*\n` +
    `11·Hoy  12·Semana  13·Mes\n\n` +

    `🛒 *PRODUCTOS*\n` +
    `14·Top vendidos  15·Ventas vs inventario\n\n` +

    `📦 *INVENTARIO GENERAL*\n` +
    `16·Completo  21·🚨 Restock urgente\n\n` +

    `⚗️ *ESENCIAS*\n` +
    `17·Todas  28·👔 Masculinas  29·🌺 Femeninas  30·🌿 Unisex\n\n` +

    `🫙 *ENVASES*\n` +
    `18·Stock de envases\n\n` +

    `✨ *ORIGINALES & RÉPLICAS*\n` +
    `19·Originales  20·Réplicas 1.1\n\n` +

    `📊 *ANÁLISIS*\n` +
    `25·Faltantes  26·Balance crítico  27·🧠 Análisis libre\n\n` +

    `💸 *GASTOS*\n` +
    `22·Gastos del mes\n\n` +

    `📸 *REDES SOCIALES*\n` +
    `23·Checklist hoy  24·Plan semana\n\n` +

    `⚙️ *ADMIN*  R·Requerimiento  V·Ver reqs  E·Excel\n\n` +

    `🔧 *SISTEMA*  /diagnostico · /reconectar\n\n` +

    `_hoy · ayer · semana · mes · esencias · envases · originales · restock · faltantes · balance_`
  );
}

module.exports = { procesarMensaje, activarEsperaEleccion, mensajeBienvenida, exportarExcelMes };
