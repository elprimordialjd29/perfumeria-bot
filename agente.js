/**
 * agente.js — Chu, asistente personal de ventas
 * Entiende lenguaje natural y ejecuta acciones reales en VectorPOS
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const monitor = require('./monitor-pos');
const db = require('./database');
const fs = require('fs');
const os = require('os');
const path = require('path');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const historial = [];

const SYSTEM_PROMPT = `Eres Chu, asistente personal de ventas de una perfumería colombiana en Colombia.
Eres inteligente, directo y amable. Solo respondes en español colombiano.
Tienes conexión en tiempo real a VectorPOS (ventas, inventario, cajeros).

━━━ REGLA DE ORO — NUNCA INVENTES DATOS ━━━
JAMÁS inventes ni adivines cifras del negocio: ventas, inventario, unidades, tickets, cajeros, gastos.
Si te preguntan algo con números del negocio, SIEMPRE usa una etiqueta para consultar VectorPOS.
Inventar datos confunde al dueño y destruye la confianza. Si no hay etiqueta disponible, di:
"Déjame consultar el sistema" y usa [INVENTARIO] o [REPORTE_HOY] según corresponda.

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
  "esencias unisex" / "unisex" → [INVENTARIO_CAT:ESENCIAS U]
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
[CAJA]              → cierres de caja, turnos
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

Cuando el usuario pregunte por una categoría, usa el nombre exacto: "esencias masculinas" → ESENCIAS M, "réplicas" → REPLICA 1.1, "envases" → ENVASE, etc.

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
"ventas de Michelle del 1 al 7 de abril" → [CAJERO_RANGO:michelle:2026-04-01:2026-04-07]`;

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
  '1':  '[REPORTE_HOY]',
  '2':  '[REPORTE_MES]',
  '3':  '[REPORTE_MES_ANT]',
  '4':  '[REPORTE_SEMANA]',
  '5':  '[PRODUCTOS_MES]',
  '6':  '[MEDIOS_PAGO_HOY]',
  '7':  '[QUIEN_TRABAJO]',
  '8':  '[RANKING_MES]',
  '9':  '[INVENTARIO]',
  '10': '[REPORTE_RANGO]',
  '11': '[REPORTE_GENERAL]',
  '12': '[VENTAS_INVENTARIO]',
  '13': '[RESTOCK]',
  '14': '[GASTOS]',
  '15': '[VENTAS_HORA]',
  'r':  '[REQUERIMIENTO]',
  'R':  '[REQUERIMIENTO]',
  'e':  '[EXPORTAR_EXCEL]',
  'E':  '[EXPORTAR_EXCEL]',
  'v':  '[VER_REQS]',
  'V':  '[VER_REQS]',
};

/** Retorna objeto con fechas de referencia relativas */
function fechasRelativas() {
  const hoy   = new Date();
  const ayer  = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const antier= new Date(hoy); antier.setDate(hoy.getDate() - 2);
  const diasDesdeElLunes = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diasDesdeElLunes);
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

  // Atajo directo por número de menú
  if (MENU_ACCIONES[t]) {
    const accion = MENU_ACCIONES[t];
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
      const tagMatch = raw.match(/^(REPORTE_RANGO|REPORTE_HOY|REPORTE_MES|REPORTE_SEMANA|REPORTE_MES_ANT|REPORTE_GENERAL|INVENTARIO_CAT|INVENTARIO|RESTOCK|VENTAS_INVENTARIO|CRUCE_PRODUCTO_RANGO|CRUCE_PRODUCTO|CAJERO_HOY|CAJERO_SEM|CAJERO_MES|CAJERO_MES_ANT|CAJERO_RANGO|PRODUCTOS_MES|PRODUCTOS_HOY|MEDIOS_PAGO_HOY|MEDIOS_PAGO_MES|QUIEN_TRABAJO|RANKING_HOY|RANKING_SEM|RANKING_MES|GASTOS|CAJA|VENTAS_HORA|REQUERIMIENTO|VER_REQS|EXPORTAR_EXCEL|AGREGAR_USUARIO|VER_USUARIOS|QUITAR_USUARIO|MENU|AYUDA)[:|\]]/);
      if (tagMatch) raw = '[' + raw + (raw.includes(']') ? '' : ']');
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

    if (raw.startsWith('[REPORTE_RANGO]')) {
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

    if (raw.startsWith('[CAJA]')) {
      return await reporteCierresCaja(monitor.fechaInicioMes(), monitor.fechaHoy());
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
      const hoy = new Date();
      const primerDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString().split('T')[0];
      const ultimoDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0).toISOString().split('T')[0];
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
  const hoy = new Date();
  const primerDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const ultimoDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  const desde = primerDiaMesAnt.toISOString().split('T')[0];
  const hasta = ultimoDiaMesAnt.toISOString().split('T')[0];
  const nombreMes = primerDiaMesAnt.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
  return await reporteRango(desde, hasta, `MES ANTERIOR — ${nombreMes.toUpperCase()}`);
}

async function reporteSemana() {
  const hoy = new Date();
  const lunes = new Date(hoy);
  // getDay(): 0=domingo, 1=lunes, ..., 6=sábado
  // Si es domingo (0) retroceder 6 días para llegar al lunes anterior
  const diasDesdeElLunes = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
  lunes.setDate(hoy.getDate() - diasDesdeElLunes);
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
// PRODUCTOS MÁS/MENOS VENDIDOS
// ──────────────────────────────────────────────

async function reporteProductos(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const productos = await monitor.extraerVentasProducto(page, desde, hasta);
    await browser.close();

    if (!productos.length) return `📦 Sin ventas de productos para ${titulo}.`;

    const top5 = productos.slice(0, 5);
    const bottom5 = productos.slice(-5).reverse();
    const totalValor = productos.reduce((s, p) => s + p.valor, 0);
    const totalCantidad = productos.reduce((s, p) => s + p.cantidad, 0);

    let msg = `📦 *PRODUCTOS — ${titulo}*\n`;
    msg += `_${productos.length} productos vendidos_\n\n`;

    msg += `🏆 *MÁS VENDIDOS (por valor):*\n`;
    top5.forEach((p, i) => {
      const icons = ['🥇','🥈','🥉','4️⃣','5️⃣'];
      msg += `${icons[i]} *${p.nombre}*\n`;
      msg += `   💰 $${p.valor.toLocaleString('es-CO')} | 🛍 ${p.cantidad} uds (${p.pctValor})\n`;
    });

    msg += `\n📉 *MENOS VENDIDOS:*\n`;
    bottom5.forEach((p, i) => {
      msg += `• ${p.nombre}: ${p.cantidad} uds — $${p.valor.toLocaleString('es-CO')}\n`;
    });

    msg += `\n💵 Total: $${totalValor.toLocaleString('es-CO')} | ${totalCantidad} unidades`;
    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
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

    const totalGastos = gastos.reduce((s, g) => s + g.valor, 0);

    // Agrupar por concepto
    const porConcepto = {};
    for (const g of gastos) {
      if (!porConcepto[g.concepto]) porConcepto[g.concepto] = 0;
      porConcepto[g.concepto] += g.valor;
    }
    const conceptosOrdenados = Object.entries(porConcepto).sort((a, b) => b[1] - a[1]);

    let msg = `💸 *GASTOS — ${titulo}*\n`;
    msg += `_${desde} → ${hasta}_\n\n`;
    if (totalGastos > 0) msg += `💰 *Total gastos: $${totalGastos.toLocaleString('es-CO')}*\n\n`;

    msg += `📋 *Detalle:*\n`;
    gastos.slice(0, 10).forEach(g => {
      msg += `• *${g.concepto}*`;
      if (g.detalle) msg += ` — ${g.detalle}`;
      if (g.tercero) msg += ` (${g.tercero})`;
      if (g.valor > 0) msg += `: $${g.valor.toLocaleString('es-CO')}`;
      if (g.fecha) msg += ` 📅 ${g.fecha}`;
      msg += '\n';
    });
    if (gastos.length > 10) msg += `_(y ${gastos.length - 10} más...)_\n`;

    if (conceptosOrdenados.length > 1) {
      msg += `\n📊 *Por concepto:*\n`;
      conceptosOrdenados.forEach(([c, v]) => {
        if (v > 0) msg += `• ${c}: $${v.toLocaleString('es-CO')}\n`;
      });
    }

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    console.error('Error gastos:', e.message);
    return '❌ No pude consultar los gastos.';
  }
}

// ──────────────────────────────────────────────
// CIERRES DE CAJA
// ──────────────────────────────────────────────

async function reporteCierresCaja(desde, hasta) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const cierres = await monitor.extraerCierresCaja(page, desde, hasta);
    await browser.close();

    if (!cierres.length) return `🏧 Sin cierres de caja registrados para este período.`;

    let msg = `🏧 *CIERRES DE CAJA*\n`;
    msg += `_${desde} → ${hasta}_\n\n`;

    cierres.forEach(c => {
      msg += `📅 *${c.fecha}*\n`;
      if (c.turnos) msg += `   ${c.turnos.substring(0, 120)}\n`;
      msg += '\n';
    });

    msg += `─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    console.error('Error cierres:', e.message);
    return '❌ No pude consultar los cierres de caja.';
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
  return `📋 *MENÚ DE OPCIONES*\n\n` +
    `1️⃣  Ventas de hoy\n` +
    `2️⃣  Ventas de este mes\n` +
    `3️⃣  Ventas del mes pasado\n` +
    `4️⃣  Ventas de esta semana\n` +
    `5️⃣  Productos más/menos vendidos del mes\n` +
    `6️⃣  Medios de pago hoy\n` +
    `7️⃣  Quién trabajó hoy\n` +
    `8️⃣  Ranking cajeros del mes (desglose por día)\n` +
    `9️⃣  Alertas de inventario\n` +
    `🔟  Ventas por rango de fechas\n` +
    `1️⃣1️⃣ Reporte general (ayer + mes + inventario bajo)\n` +
    `1️⃣2️⃣ Ventas vs inventario completo\n` +
    `1️⃣3️⃣ Costo de restock (qué falta + cuánto costaría)\n` +
    `1️⃣4️⃣ Gastos del mes\n` +
    `1️⃣5️⃣ Ventas por hora (hora pico)\n` +
    `🇷 *R* — Crear requerimiento nuevo\n` +
    `🇻 *V* — Ver requerimientos\n` +
    `📊 *E* — Exportar reporte en Excel\n\n` +
    `💬 *También puedes preguntar:*\n` +
    `• _"dame el estado de singler color"_ → vendido + stock\n` +
    `• _"dame el estado de tapa plana 50ml"_ → vendido + stock\n` +
    `• _"singler color ayer / esta semana / el mes pasado"_\n` +
    `• _"cuánto vendió Michelle hoy / esta semana / este mes"_\n` +
    `• _"cuánto vendió Moisés el mes pasado"_\n` +
    `• _"ventas de Laura del 1 al 7 de abril"_\n` +
    `• _"gastos del mes"_ · _"ventas por hora"_\n` +
    `• _"ayer"_ · _"ayer y hoy"_ · _"antier a hoy"_\n` +
    `• Cualquier pregunta sobre perfumes árabes 😊`;
}

module.exports = { procesarMensaje, activarEsperaEleccion, mensajeBienvenida, exportarExcelMes };
