/**
 * agente.js — Chu, asistente personal de ventas
 * Entiende lenguaje natural y ejecuta acciones reales en VectorPOS
 */

require('dotenv').config();
const Groq = require('groq-sdk');
const monitor = require('./monitor-pos');
const db = require('./database');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const historial = [];

const SYSTEM_PROMPT = `Eres Chu, asistente personal de ventas de una perfumería colombiana.
Eres directo, amable y eficiente. Solo respondes en español.
Ayudas al dueño con reportes de ventas, inventario, cajeros y metas de VectorPOS.

Detecta la intención del mensaje y pon la etiqueta AL INICIO de tu respuesta:

[REPORTE_HOY]       → ventas de hoy, reporte de hoy, cómo vamos hoy, resumen hoy
[REPORTE_MES]       → ventas de este mes, cómo va el mes, meta mensual, avance
[REPORTE_MES_ANT]   → mes pasado, ventas de marzo, ventas del mes anterior
[REPORTE_SEMANA]    → esta semana, ventas de la semana
[REPORTE_RANGO]     → ventas del [fecha] al [fecha], rango personalizado
[INVENTARIO]        → inventario, stock, saldos, qué falta, productos bajos, existencias
[RANKING_HOY]       → quién vendió hoy, ranking hoy
[RANKING_SEM]       → ranking semana, esta semana por cajero
[RANKING_MES]       → ranking mes, mejores cajeros, quién vende más
[CAJEROS]           → cajeros, vendedores, equipo, personal
[AYUDA]             → ayuda, qué puedes hacer, comandos, opciones

Si el usuario menciona fechas específicas, extráelas en formato YYYY-MM-DD en la etiqueta así:
[REPORTE_RANGO:2026-03-01:2026-03-31]

Si el usuario saluda (hola, buenos días, buenas, hey, etc.) responde SIEMPRE con el menú de opciones usando la etiqueta [MENU].

Si no detectas ninguna intención especial, responde como asistente normal.

Ejemplos:
"dame el reporte de hoy" → "[REPORTE_HOY] Consultando VectorPOS..."
"cómo vamos este mes" → "[REPORTE_MES] Revisando el avance del mes..."
"ventas del mes pasado" → "[REPORTE_MES_ANT] Consultando mes anterior..."
"qué falta en inventario" → "[INVENTARIO] Revisando el stock..."
"quién ha vendido más este mes" → "[RANKING_MES] Aquí el ranking del mes..."
"hola" → "[MENU]"
"buenos días" → "[MENU]"`;

// ──────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ──────────────────────────────────────────────

// Mapa de números de menú a acciones directas
const MENU_ACCIONES = {
  '1': '[REPORTE_HOY]',
  '2': '[REPORTE_MES]',
  '3': '[REPORTE_MES_ANT]',
  '4': '[REPORTE_SEMANA]',
  '5': '[RANKING_HOY]',
  '6': '[RANKING_MES]',
  '7': '[INVENTARIO]',
  '8': '[REPORTE_RANGO]',
};

async function procesarMensaje(texto) {
  // Atajo directo por número de menú
  if (MENU_ACCIONES[texto.trim()]) {
    const accion = MENU_ACCIONES[texto.trim()];
    historial.push({ role: 'user', content: texto });
    historial.push({ role: 'assistant', content: accion });
    // Reusar el mismo switch ejecutando con el raw simulado
    return await ejecutarAccion(accion);
  }

  historial.push({ role: 'user', content: texto });
  if (historial.length > 14) historial.shift();

  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...historial],
      max_tokens: 500,
      temperature: 0.5,
    });

    const raw = resp.choices[0].message.content.trim();
    historial.push({ role: 'assistant', content: raw });

    return await ejecutarAccion(raw);

  } catch (e) {
    if (e?.status === 429) return '⏳ Demasiadas consultas. Espera unos segundos.';
    console.error('Error Groq:', e?.message);
    return '❌ Error procesando tu mensaje. Intenta de nuevo.';
  }
}

async function ejecutarAccion(raw) {
    if (raw.startsWith('[REPORTE_HOY]')) {
      const datos = await monitor.monitorearVentasDiarias();
      if (!datos) return '❌ No pude conectar a VectorPOS.';
      return monitor.generarMensajeMeta(datos);
    }

    if (raw.startsWith('[REPORTE_MES]')) {
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

    if (raw.startsWith('[AYUDA]') || raw.startsWith('[MENU]')) {
      return mensajeMenu();
    }

    return raw.replace(/\[.*?\]/g, '').trim() || raw;
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
  lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
  const desde = lunes.toISOString().split('T')[0];
  const hasta = monitor.fechaHoy();
  return await reporteRango(desde, hasta, 'ESTA SEMANA');
}

async function reporteRango(desde, hasta, titulo) {
  const tituloFinal = titulo || `${desde} al ${hasta}`;
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const ventas = await monitor.extraerVentasGenerales(page, desde, hasta);
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    await browser.close();

    const total = ventas.reduce((s, v) => s + v.totalVentas, 0);
    const tickets = ventas.reduce((s, v) => s + v.tickets, 0);
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

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    console.error('Error reporte rango:', e.message);
    return '❌ No pude generar el reporte. Verifica la conexión a VectorPOS.';
  }
}

async function reporteRankingPOS(desde, hasta, titulo) {
  try {
    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    const ventas = await monitor.extraerVentasGenerales(page, desde, hasta);
    await browser.close();

    const total = ventas.reduce((s, v) => s + v.totalVentas, 0);
    const medallas = ['🥇', '🥈', '🥉'];

    if (!cajeros.length) return `📊 Sin datos de cajeros para ${titulo}.`;

    let msg = `👥 *RANKING ${titulo}*\n\n`;
    cajeros.forEach((c, i) => {
      const pct = total > 0 ? ((c.total / total) * 100).toFixed(0) : 0;
      msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*\n`;
      msg += `   💰 $${c.total.toLocaleString('es-CO')} (${pct}%) | 🎫 ${c.tickets} tickets\n\n`;
    });
    msg += `💵 Total: $${total.toLocaleString('es-CO')}\n─────────────────\n🤖 _VectorPOS — Chu_`;
    return msg;
  } catch (e) {
    return '❌ No pude consultar el ranking en VectorPOS.';
  }
}

// ──────────────────────────────────────────────
// AYUDA
// ──────────────────────────────────────────────

function mensajeMenu() {
  return `👋 *Hola jefe, ¿en qué te puedo ayudar?*

Elige una opción:

1️⃣ Reporte de hoy
2️⃣ Reporte de este mes
3️⃣ Reporte del mes pasado
4️⃣ Reporte de esta semana
5️⃣ Ranking cajeros hoy
6️⃣ Ranking cajeros del mes
7️⃣ Alertas de inventario
8️⃣ Ventas por rango de fechas

_Escribe el número o dime lo que necesitas_ 😊`;
}

module.exports = { procesarMensaje };
