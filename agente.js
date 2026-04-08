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

const SYSTEM_PROMPT = `Eres Chu, asistente personal de ventas de una perfumería colombiana en Colombia.
Eres inteligente, directo y amable. Solo respondes en español colombiano.
Tienes acceso en tiempo real a VectorPOS (sistema de ventas), inventario y datos de cajeros.

Cuando recibes un mensaje, PRIMERO decide si necesitas consultar datos o si puedes responder directamente.

━━━ ETIQUETAS DE ACCIÓN (pon AL INICIO si necesitas datos) ━━━

[REPORTE_HOY]       → ventas hoy, reporte hoy, cómo vamos hoy, resumen hoy
[REPORTE_MES]       → este mes, meta mensual, avance del mes
[REPORTE_MES_ANT]   → mes pasado, ventas anteriores
[REPORTE_SEMANA]    → esta semana
[REPORTE_RANGO]     → rango de fechas (extrae: [REPORTE_RANGO:YYYY-MM-DD:YYYY-MM-DD])
[PRODUCTOS_MES]     → qué se vendió más, ranking de perfumes, productos más vendidos, cuál fue el más vendido, el menos vendido, participación de productos
[PRODUCTOS_HOY]     → qué se vendió hoy, productos de hoy
[MEDIOS_PAGO_HOY]   → efectivo hoy, transferencias hoy, cómo pagaron hoy
[MEDIOS_PAGO_MES]   → efectivo del mes, transferencias del mes
[QUIEN_TRABAJO]     → quién trabajó hoy, cajeros de hoy
[RANKING_HOY]       → ranking cajeros hoy
[RANKING_SEM]       → ranking cajeros semana
[RANKING_MES]       → ranking cajeros mes, quién vende más
[INVENTARIO]        → inventario, stock, productos bajos, qué falta
[AYUDA]             → ayuda, opciones, comandos
[MENU]              → saludos: hola, buenos días, buenas, hey

━━━ CUANDO YA TIENES LOS DATOS ━━━
Si el mensaje incluye datos entre <<<DATOS>>> y <<<FIN_DATOS>>>, úsalos para responder de forma inteligente y analítica. Puedes:
- Destacar el producto más y menos vendido
- Comparar cajeros
- Dar consejos de ventas basados en los números
- Responder preguntas específicas sobre los datos
- Identificar tendencias

━━━ INTELIGENCIA ━━━
Si el usuario hace preguntas que NO requieren datos (estrategias, consejos, preguntas generales sobre perfumería, cómo mejorar ventas, etc.), responde directamente sin etiqueta usando tu conocimiento.

Ejemplos:
"qué perfume se vendió más este mes" → "[PRODUCTOS_MES]"
"cuál fue el menos vendido hoy" → "[PRODUCTOS_HOY]"
"dame consejos para vender más" → (responde directamente con consejos)
"cómo manejo el inventario" → (responde directamente)
"hola" → "[MENU]"
"buenos días jefe" → "[MENU]"`;

// ──────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ──────────────────────────────────────────────

// Mapa de números de menú a acciones directas
const MENU_ACCIONES = {
  '1': '[REPORTE_HOY]',
  '2': '[REPORTE_MES]',
  '3': '[REPORTE_MES_ANT]',
  '4': '[REPORTE_SEMANA]',
  '5': '[PRODUCTOS_MES]',
  '6': '[MEDIOS_PAGO_HOY]',
  '7': '[QUIEN_TRABAJO]',
  '8': '[RANKING_MES]',
  '9': '[INVENTARIO]',
  '0': '[REPORTE_RANGO]',
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

function mensajeMenu() {
  return `👋 *Hola jefe, ¿en qué te puedo ayudar?*

1️⃣ Ventas de hoy
2️⃣ Ventas de este mes
3️⃣ Ventas del mes pasado
4️⃣ Ventas de esta semana
5️⃣ Productos más/menos vendidos del mes
6️⃣ Medios de pago hoy (efectivo / transferencia)
7️⃣ Quién trabajó hoy
8️⃣ Ranking cajeros del mes
9️⃣ Alertas de inventario
0️⃣ Ventas por rango de fechas

_Escribe el número o pregúntame lo que quieras_ 😊`;
}

module.exports = { procesarMensaje };
