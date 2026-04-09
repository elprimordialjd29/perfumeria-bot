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
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const historial = [];

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
[RESTOCK]           → costo de restock, cuánto costaría reponer el inventario bajo, qué falta y cuánto cuesta, inversión para restock
[VENTAS_INVENTARIO] → reporte completo ventas vs inventario de TODOS los productos: stock actual + vendido este mes, ordenado por más vendido
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
"qué falta y cuánto cuesta" → [RESTOCK]
"cuánto necesito para reponer el inventario" → [RESTOCK]
"cuánto costaría el restock" → [RESTOCK]
"qué falta" → [RESTOCK]
"ventas vs inventario de todo" → [VENTAS_INVENTARIO]
"dame el estado del inventario" → [VENTAS_INVENTARIO]
"estado del inventario" → [VENTAS_INVENTARIO]
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
"ya publiqué en whatsapp" / "listo instagram" / "subí tiktok" → [CONTENIDO_MARCAR:whatsapp] / [CONTENIDO_MARCAR:instagram] / [CONTENIDO_MARCAR:tiktok]`;

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
  '18': '[INVENTARIO_CAT:ENVASE]',
  '19': '[INVENTARIO_CAT:ORIGINALES]',
  '20': '[INVENTARIO_CAT:REPLICA 1.1]',
  '21': '[RESTOCK]',
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
    'cajeros':    '[RANKING_MES]',
    'caja':       '[CAJA_HOY]',
    'menu':       '[MENU]',
    'menú':       '[MENU]',
    'esencias':   '[INVENTARIO_CAT:ESENCIAS]',
    'envases':    '[INVENTARIO_CAT:ENVASE]',
    'originales': '[INVENTARIO_CAT:ORIGINALES]',
    'replicas':   '[INVENTARIO_CAT:REPLICA 1.1]',
    'réplicas':   '[INVENTARIO_CAT:REPLICA 1.1]',
    'redes':      '[CONTENIDO_HOY]',
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

  try {
    const r = fechasRelativas();
    const contextoFechas = `\n\nCONTEXTO ACTUAL: Hoy es ${r.hoy} (${new Date().toLocaleDateString('es-CO',{weekday:'long'})}). Ayer fue ${r.ayer}. Antier fue ${r.antier}. Esta semana va del lunes ${r.lunes} al ${r.hoy}.`;

    const restriccion = esAdmin ? '' : '\n\nNOTA: Este usuario NO es el administrador. NO uses etiquetas de administración: [AGREGAR_USUARIO], [VER_USUARIOS], [QUITAR_USUARIO], [REQUERIMIENTO], [VER_REQS], [EXPORTAR_EXCEL].';

    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: SYSTEM_PROMPT + contextoFechas + restriccion,
      messages: historial,
    });

    const raw = resp.content[0].text.trim();
    historial.push({ role: 'assistant', content: raw });

    return await ejecutarAccion(raw);

  } catch (e) {
    if (e?.status === 429) return '⏳ Demasiadas consultas. Espera unos segundos.';
    console.error('Error Claude:', e?.message);
    return '❌ Error procesando tu mensaje. Intenta de nuevo.';
  }
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
      // Reporte mensual completo con barra de meta
      const datos = await monitor.monitorearVentasDiarias();
      if (!datos) return '❌ No pude conectar a VectorPOS.';
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

    if (raw.startsWith('[INVENTARIO]')) {
      const resultado = await monitor.consultarAlertasInventario();
      return monitor.generarMensajeAlertas(resultado);
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
      return await reporteInventarioCategoria(cat);
    }

    if (raw.startsWith('[VENTAS_INVENTARIO]')) {
      return await reporteVentasVsInventario();
    }

    if (raw.startsWith('[RESTOCK]')) {
      return await reporteRestock();
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

    return raw.replace(/\[.*?\]/g, '').trim() || raw;
}

// ──────────────────────────────────────────────
// REPORTE GENERAL (mismo del matutino, bajo demanda)
// ──────────────────────────────────────────────

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

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;

    // Inventario bajo — todos, dividido en partes separadas
    const partesMsgs = [msg];
    try {
      const alertas = await monitor.consultarAlertasInventario();
      // Agotados primero (saldo=0), luego críticos, luego bajos
      const bajos = [...(alertas?.alertasGramos || []), ...(alertas?.alertasUnidades || [])]
        .sort((a, b) => {
          if (a.saldo === 0 && b.saldo > 0) return -1;
          if (b.saldo === 0 && a.saldo > 0) return 1;
          return a.saldo - b.saldo;
        });

      if (bajos.length > 0) {
        const agotados = bajos.filter(p => p.saldo <= 0);
        const enc = `⚠️ *INVENTARIO BAJO (${bajos.length} productos)*\n` +
          (agotados.length > 0 ? `🚨 *${agotados.length} AGOTADOS*\n` : '') + `\n`;
        let parteInv = enc;
        for (const p of bajos) {
          const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= 5 ? '🔴 CRÍTICO' : '🟡 BAJO';
          const linea = `${nivel} *${p.nombre}*: ${p.saldo} ${p.medida || 'uds'}\n`;
          if ((parteInv + linea).length > 3500) {
            partesMsgs.push(parteInv);
            parteInv = `⚠️ _(inventario bajo — continuación)_\n\n`;
          }
          parteInv += linea;
        }
        partesMsgs.push(parteInv);
      } else {
        partesMsgs[0] += `\n✅ *Inventario: sin alertas*`;
      }
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

async function reporteRango(desde, hasta, titulo) {
  const tituloFinal = titulo || `${desde} al ${hasta}`;
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const ventas  = await monitor.extraerVentasGenerales(page, desde, hasta);
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    await browser.close();

    // extraerVentasGenerales puede retornar 0 para rangos cortos por formato de fecha;
    // usamos cajeros como fuente principal de total/tickets (siempre confiable)
    const totalDeCajeros  = cajeros.reduce((s, c) => s + c.total, 0);
    const ticketsDeCajeros = cajeros.reduce((s, c) => s + c.tickets, 0);
    const totalDeVentas   = ventas.reduce((s, v) => s + v.totalVentas, 0);
    const ticketsDeVentas = ventas.reduce((s, v) => s + v.tickets, 0);

    const total   = totalDeCajeros   > 0 ? totalDeCajeros   : totalDeVentas;
    const tickets = ticketsDeCajeros > 0 ? ticketsDeCajeros : ticketsDeVentas;
    const medallas = ['🥇', '🥈', '🥉'];

    let msg = `📊 *REPORTE — ${tituloFinal}*\n`;
    msg += `_${desde} → ${hasta}_\n\n`;
    msg += `💰 *Total: $${total.toLocaleString('es-CO')}*\n`;
    msg += `🎫 Tickets: ${tickets}\n`;
    if (tickets > 0) msg += `💵 Promedio ticket: $${Math.round(total / tickets).toLocaleString('es-CO')}\n`;

    if (cajeros.length > 0) {
      msg += `\n👥 *RANKING CAJEROS:*\n`;
      cajeros.forEach((c, i) => {
        const pct = total > 0 ? ((c.total / total) * 100).toFixed(0) : 0;
        msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${pct}%) | ${c.tickets} tickets\n`;
      });
    }

    msg += bloquesMeta(total, desde, hasta);
    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    console.error('Error reporte rango:', e.message);
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
    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
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
    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
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

async function planContenidoSemana() {
  const contenido = require('./contenido');
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const diasDesdelunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasDesdelunes);
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

    bloque += `📱 *WhatsApp:*\n${cal.whatsapp}\n\n`;

    if (cal.instagram) {
      bloque += `📸 *Instagram — ${cal.instagram.tipo}:*\n`;
      bloque += `💡 ${cal.instagram.idea}\n`;
      bloque += `_Copy:_ ${cal.instagram.copy}\n\n`;
    } else {
      bloque += `📸 Instagram: ➖ _No toca_\n\n`;
    }

    if (cal.tiktok) {
      bloque += `🎵 *TikTok — ${cal.tiktok.tipo}:*\n`;
      bloque += `💡 ${cal.tiktok.idea}\n`;
      bloque += `_Copy:_ ${cal.tiktok.copy}\n\n`;
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
    const { browser, page } = await monitor.crearSesionPOS();
    const raw = await monitor.extraerVentasProducto(page, desde, hasta);
    await browser.close();

    if (!raw.length) return `📦 Sin ventas de productos para ${titulo}.`;

    const fp = monitor.formatPesos;
    const icons = ['🥇','🥈','🥉','4️⃣','5️⃣'];

    // 1. Excluir PREPARACIÓN (mano de obra, no producto real)
    const productos = raw.filter(p => !p.nombre.toLowerCase().includes('preparac'));

    // 2. Clasificar por categoría usando la misma lógica del inventario
    const grupos = { ESENCIAS: [], ENVASE: [], ORIGINALES: [], 'REPLICA 1.1': [], OTROS: [] };
    for (const p of productos) {
      const cat = monitor.inferirCategoria(p.nombre);
      if (cat.startsWith('ESENCIAS'))       grupos.ESENCIAS.push(p);
      else if (cat === 'ENVASE')            grupos.ENVASE.push(p);
      else if (cat === 'ORIGINALES')        grupos.ORIGINALES.push(p);
      else if (cat === 'REPLICA 1.1')       grupos['REPLICA 1.1'].push(p);
      else                                  grupos.OTROS.push(p);
    }

    const totalValor    = productos.reduce((s, p) => s + p.valor, 0);
    const totalCantidad = productos.reduce((s, p) => s + p.cantidad, 0);

    const partes = [];
    let msg = `📦 *PRODUCTOS — ${titulo}*\n`;
    msg += `_${productos.length} productos | $${fp(totalValor)} | ${totalCantidad} uds_\n\n`;

    // Helper: bloque por categoría
    const bloqueCategoria = (emoji, nombre, lista) => {
      if (!lista.length) return;
      const top = lista.slice(0, 5);
      const totalCat = lista.reduce((s, p) => s + p.valor, 0);
      msg += `${emoji} *${nombre}* — $${fp(totalCat)}\n`;
      top.forEach((p, i) => {
        const precioUnd = p.cantidad > 0 ? Math.round(p.valor / p.cantidad) : 0;
        msg += `${icons[i]} *${p.nombre}*\n`;
        msg += `   💰 $${fp(p.valor)} | ${p.cantidad} uds | ~$${fp(precioUnd)}/u\n`;
      });
      if (lista.length > 5) msg += `   _+${lista.length - 5} más_\n`;
      msg += `\n`;
      if (msg.length > 3500) { partes.push(msg); msg = `📦 _(continuación)_\n\n`; }
    };

    bloqueCategoria('🧪', 'ESENCIAS',    grupos.ESENCIAS);
    bloqueCategoria('🧴', 'ENVASES',     grupos.ENVASE);
    bloqueCategoria('✨', 'ORIGINALES',  grupos.ORIGINALES);
    bloqueCategoria('🔁', 'RÉPLICAS 1.1', grupos['REPLICA 1.1']);
    if (grupos.OTROS.length) bloqueCategoria('📦', 'OTROS', grupos.OTROS);

    // Menos vendidos (global, sin preparación)
    const bottom5 = [...productos].sort((a, b) => a.valor - b.valor).slice(0, 5);
    msg += `📉 *MENOS VENDIDOS:*\n`;
    bottom5.forEach(p => {
      const precioUnd = p.cantidad > 0 ? Math.round(p.valor / p.cantidad) : 0;
      msg += `• *${p.nombre}*: ${p.cantidad} uds — $${fp(p.valor)} (~$${fp(precioUnd)}/u)\n`;
    });

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
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
    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
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

    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
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
    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
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

    const { browser, page } = await monitor.crearSesionPOS();
    const cierres = await monitor.extraerCierresCaja(page, desde, hasta);
    // Ventas del período completo (una sola llamada)
    const cajerosRango = await monitor.extraerVentasCajero(page, desde, hasta);
    // Ventas de hoy por separado para meta diaria
    const cajerosHoy = desde === hasta && desde === hoy
      ? cajerosRango
      : await monitor.extraerVentasCajero(page, hoy, hoy);
    await browser.close();

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

      if (cajerosF.length === 0) {
        msg += `_Sin ventas registradas_\n\n`;
      } else {
        cajerosF.forEach(c => {
          msg += `👤 *${c.cajero}* | 🎫 ${c.tickets} tickets\n`;
          if (c.total > 0)        msg += `   💰 Total: *$${fp(c.total)}*\n`;
          if (c.efectivo > 0)     msg += `   💵 Efectivo: $${fp(c.efectivo)}\n`;
          if (c.bancolombia > 0)  msg += `   🏦 Bancolombia: $${fp(c.bancolombia)}\n`;
          if (c.nequi > 0)        msg += `   📱 Nequi: $${fp(c.nequi)}\n`;
          msg += `\n`;
        });

        if (esHoy) {
          const totalHoy = cajerosF.reduce((s, c) => s + c.total, 0);
          const pct      = Math.min(100, Math.round((totalHoy / metaDiaria) * 100));
          const barra    = Math.min(Math.round(pct / 10), 10);
          const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);
          const falta    = Math.max(0, metaDiaria - totalHoy);
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

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
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
    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    console.error('Error ventas hora:', e.message);
    return '❌ No pude consultar las ventas por hora.';
  }
}

// ──────────────────────────────────────────────
// INVENTARIO POR CATEGORÍA
// ──────────────────────────────────────────────

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
    parte += `─────────────────\n🤖 _VectorPOS — Chu_`;
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

async function reporteRestock() {
  try {
    const inventario = await monitor.consultarTodoInventario() || [];

    // Productos con stock bajo (mismo umbral que alertas)
    const bajos = inventario.filter(p => {
      if (p.medida && (p.medida.toLowerCase().includes('gr') || p.medida.toLowerCase().includes('ml'))) {
        return p.saldo < 500;
      }
      return p.saldo < 20;
    }).sort((a, b) => a.saldo - b.saldo);

    if (!bajos.length) return '✅ *Restock:* Todos los productos tienen stock suficiente.';

    const tieneCostos = bajos.some(p => p.costoUnidad > 0);

    const lineas = [];
    let totalRestock = 0;

    // Agotados primero
    bajos.sort((a, b) => {
      if (a.saldo === 0 && b.saldo > 0) return -1;
      if (b.saldo === 0 && a.saldo > 0) return 1;
      return a.saldo - b.saldo;
    });

    const fp = monitor.formatPesos;
    bajos.forEach(p => {
      const cat = (p.categoria || '').toUpperCase();
      const umbralKey = Object.keys(monitor.UMBRALES).find(k => cat.includes(k) || k.includes(cat));
      const umbralCat = umbralKey ? monitor.UMBRALES[umbralKey] : null;
      const limiteReponer = umbralCat?.alerta ||
        (p.medida?.toLowerCase().includes('gr') ? 500 : 20);
      const esRestock = umbralCat ? umbralCat.restock : true;
      const nivelCritico = umbralCat?.critico || 5;

      const nivel = p.saldo <= 0 ? '🚨' : p.saldo <= nivelCritico ? '🔴' : '🟡';
      let bloque = `${nivel} *${p.nombre}*`;
      if (p.categoria) bloque += ` _(${p.categoria})_`;
      bloque += `\n   📦 Saldo: ${p.saldo} ${p.medida}\n`;

      if (p.costoUnidad > 0) {
        bloque += `   💵 Costo unidad: $${fp(p.costoUnidad)}\n`;
      }
      if (tieneCostos && p.costoUnidad > 0 && esRestock) {
        const reponer = Math.max(0, limiteReponer - p.saldo);
        const costoReponer = Math.round(reponer * p.costoUnidad);
        totalRestock += costoReponer;
        bloque += `   🛒 Reponer: ${reponer} ${p.medida} → *$${fp(costoReponer)}*\n`;
      } else if (!esRestock) {
        bloque += `   ℹ️ Solo alerta (sin restock programado)\n`;
      }
      lineas.push(bloque);
    });

    const encabezado = `💰 *COSTO DE RESTOCK (${bajos.length} productos bajos)*\n\n`;
    const partes = [];
    let parteActual = encabezado;
    for (const linea of lineas) {
      if ((parteActual + linea).length > 3500) {
        partes.push(parteActual);
        parteActual = `💰 _(restock — continuación)_\n\n`;
      }
      parteActual += linea;
    }

    let pie = `\n`;
    if (tieneCostos && totalRestock > 0) {
      pie += `💰 *INVERSIÓN TOTAL PARA RESTOCK: $${monitor.formatPesos(totalRestock)}*\n`;
      pie += `_Para reponer al mínimo recomendado_\n`;
    }
    pie += `─────────────────\n🤖 _VectorPOS — Chu_`;
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

    // Construir líneas individuales
    const lineas = [];
    items.forEach(item => {
      const nivelStock = item.stock === null ? '❔' :
        item.stock <= 0  ? '🚨' : item.stock <= 5 ? '🔴' : item.stock <= 20 ? '🟡' : '🟢';
      let bloque = `▪️ *${item.nombre}*\n`;
      bloque += `   📈 Vendido: ${item.vendidoMes} uds`;
      if (item.valorMes > 0) bloque += ` — $${item.valorMes.toLocaleString('es-CO')}`;
      bloque += `\n`;
      if (item.stock !== null) {
        bloque += `   ${nivelStock} Stock: ${item.stock} ${item.medida}`;
        if (item.costoUnidad > 0) bloque += ` | 💵 $${item.costoUnidad.toLocaleString('es-CO')}/u`;
        if (item.costoTotal  > 0) bloque += ` | Total: $${item.costoTotal.toLocaleString('es-CO')}`;
        bloque += `\n`;
      }
      lineas.push(bloque);
    });

    // Dividir en partes de máx 3500 chars
    const encabezado = `📦 *VENTAS VS INVENTARIO — ${mes.toUpperCase()}*\n_${monitor.fechaInicioMes()} → ${monitor.fechaHoy()}_\n_(${items.length} productos)_\n\n`;
    let pie = `\n💰 *Total vendido: $${totalVendido.toLocaleString('es-CO')}*\n`;
    if (totalStockVal > 0) pie += `🏦 Valor total en stock: $${totalStockVal.toLocaleString('es-CO')}\n`;
    pie += `─────────────────\n🤖 _VectorPOS — Chu_`;

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

    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
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

    let msg = `🔍 *ANÁLISIS — "${query.toUpperCase()}"*\n`;
    msg += `_Ventas del mes + stock actual_\n\n`;

    items.forEach(item => {
      const nivelStock = item.stock === null ? '' :
        item.stock <= 0    ? ' 🚨 *AGOTADO*' :
        item.stock <= 5    ? ' 🔴 CRÍTICO' :
        item.stock <= 20   ? ' 🟡 BAJO' : ' 🟢';

      msg += `📦 *${item.nombre}*\n`;

      if (item.stock !== null) {
        msg += `   📦 Stock: *${item.stock} ${item.medida}*${nivelStock}\n`;
      } else {
        msg += `   📦 Stock: sin datos\n`;
      }

      if (item.vendidoMes > 0) {
        msg += `   📈 Vendido (mes): ${item.vendidoMes} uds — $${item.valorMes.toLocaleString('es-CO')}\n`;
      } else {
        msg += `   📈 Sin ventas este mes\n`;
      }

      if (item.vendidoHoy > 0) {
        msg += `   🕐 Hoy: ${item.vendidoHoy} uds\n`;
      }

      msg += '\n';
    });

    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;

  } catch(e) {
    console.error('Error cruce producto:', e.message);
    return '❌ No pude cruzar los datos. Intenta de nuevo.';
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
  return `👋 *¡Hola jefe, qué gusto saludarte!*\n\n¿Cómo te puedo ayudar?\n\n1️⃣ Ver menú de opciones\n2️⃣ Pregúntame algo`;
}

function mensajeMenu() {
  return `📋 *MENÚ — SALMA PERFUM*\n\n` +

    `💰 *VENTAS*\n` +
    `1 · Ventas de hoy\n` +
    `2 · Ventas de este mes\n` +
    `3 · Ventas del mes pasado\n` +
    `4 · Ventas de esta semana\n` +
    `5 · Ventas por rango de fechas\n` +
    `6 · Reporte general completo\n\n` +

    `👥 *CAJEROS*\n` +
    `7 · Quién trabajó hoy\n` +
    `8 · Ranking cajeros del mes\n` +
    `9 · Ventas por hora (hora pico)\n` +
    `10 · Medios de pago de hoy\n\n` +

    `🏧 *MOVIMIENTO DE CAJA*\n` +
    `11 · Caja de hoy\n` +
    `12 · Caja de esta semana\n` +
    `13 · Caja de este mes\n\n` +

    `📦 *PRODUCTOS*\n` +
    `14 · Más/menos vendidos del mes\n` +
    `15 · Ventas vs inventario completo\n\n` +

    `🧪 *INVENTARIO*\n` +
    `16 · Todo el inventario\n` +
    `17 · Inventario esencias\n` +
    `18 · Inventario envases\n` +
    `19 · Inventario originales\n` +
    `20 · Inventario réplicas 1.1\n` +
    `21 · Restock (qué falta + costo)\n\n` +

    `💸 *GASTOS*\n` +
    `22 · Gastos del mes\n\n` +

    `📱 *REDES SOCIALES*\n` +
    `23 · Contenido de hoy (checklist)\n` +
    `24 · Plan de redes esta semana\n\n` +

    `⚙️ *ADMIN*\n` +
    `R · Crear requerimiento\n` +
    `V · Ver requerimientos\n` +
    `E · Exportar Excel\n\n` +

    `💬 *Palabras rápidas:*\n` +
    `_hoy · ayer · semana · mes · gastos · inventario · caja · cajeros · restock · redes_\n\n` +

    `💬 *Preguntas libres:*\n` +
    `• _"cuánto vendió Michelle esta semana"_\n` +
    `• _"estado de singler color / tapa plana 50ml"_\n` +
    `• _"ventas del 1 al 15 de marzo"_\n` +
    `• _"mañana"_ · _"pasado mañana"_ → contenido de redes`;
}

module.exports = { procesarMensaje, activarEsperaEleccion, mensajeBienvenida, exportarExcelMes };
