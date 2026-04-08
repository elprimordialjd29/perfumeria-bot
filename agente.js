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
[REPORTE_RANGO:YYYY-MM-DD:YYYY-MM-DD] → rango de fechas SIEMPRE con fechas en formato ISO. Ejemplo: "del 1 al 15 de marzo 2026" → [REPORTE_RANGO:2026-03-01:2026-03-15]. Si el usuario da UNA fecha, úsala como desde y hasta.
[PRODUCTOS_MES]     → qué se vendió más, ranking de perfumes, productos más vendidos, cuál fue el más vendido, el menos vendido, participación de productos
[PRODUCTOS_HOY]     → qué se vendió hoy, productos de hoy
[MEDIOS_PAGO_HOY]   → efectivo hoy, transferencias hoy, cómo pagaron hoy
[MEDIOS_PAGO_MES]   → efectivo del mes, transferencias del mes
[QUIEN_TRABAJO]     → quién trabajó hoy, cajeros de hoy
[RANKING_HOY]       → ranking cajeros hoy
[RANKING_SEM]       → ranking cajeros semana
[RANKING_MES]       → ranking cajeros mes, quién vende más
[INVENTARIO]        → inventario, stock, productos bajos, qué falta
[GASTOS]            → gastos, egresos, nómina, en qué se gastó, cuánto se gastó
[CAJA]              → cierres de caja, turnos, quién cerró caja
[VENTAS_HORA]       → ventas por hora, hora pico, cuándo se vende más, mejor hora
[AYUDA]             → ayuda, opciones, comandos
[MENU]              → saludos: hola, buenos días, buenas, hey

━━━ FECHAS — REGLA IMPORTANTE ━━━
Si el usuario da una fecha en formato DD-MM-YYYY (ej: "07-04-2026"), conviértela a YYYY-MM-DD (ej: 2026-04-07).
Si da un rango como "del 1 al 15 de abril", genera [REPORTE_RANGO:2026-04-01:2026-04-15].
NUNCA pidas las fechas de nuevo si ya las dio — extráelas tú.

━━━ CUANDO YA TIENES LOS DATOS ━━━
Si el mensaje incluye datos entre <<<DATOS>>> y <<<FIN_DATOS>>>, úsalos para responder de forma inteligente y analítica. Puedes:
- Destacar el producto más y menos vendido
- Comparar cajeros
- Dar consejos de ventas basados en los números
- Responder preguntas específicas sobre los datos
- Identificar tendencias

━━━ EXPERTO EN PERFUMERÍA ━━━
También eres experto mundial en perfumes. Responde con confianza SIN etiqueta sobre:
- Perfumes árabes y orientales: Lattafa, Al Haramain, Ajmal, Rasasi, Swiss Arabian, Armaf, Nabeel, Maison Alhambra
- Mejores ouds, notas orientales, amaderados, florales, frutales
- Clones y dupes de lujo: Lattafa Asad ≈ Sauvage, Khamrah ≈ Spicebomb, etc.
- Recomendaciones por género, ocasión (trabajo, noche, verano, invierno), presupuesto
- Ingredientes: oud, musk, sándalo, bergamota, rosa, jazmín, ámbar, pachulí
- Proyección, sillage, longevidad, familias olfativas
- Consejos para vender más perfumes, cómo describir fragancias a clientes

━━━ INTELIGENCIA ━━━
Si el usuario hace preguntas que NO requieren datos (estrategias, consejos, preguntas generales sobre perfumería, cómo mejorar ventas, etc.), responde directamente sin etiqueta usando tu conocimiento.

Ejemplos:
"qué perfume se vendió más este mes" → "[PRODUCTOS_MES]"
"cuál fue el menos vendido hoy" → "[PRODUCTOS_HOY]"
"gastos de este mes" → "[GASTOS]"
"ventas por hora de hoy" → "[VENTAS_HORA]"
"dame consejos para vender más" → (responde directamente)
"cuál es el mejor perfume árabe" → (responde directamente con tu conocimiento)
"hola" → "[MENU]"
"buenos días jefe" → "[MENU]"
"ventas del 1 al 7 de abril" → "[REPORTE_RANGO:2026-04-01:2026-04-07]"
"07-04-2026" (cuando ya pidiste fecha) → "[REPORTE_RANGO:2026-04-07:2026-04-07]"`;

// ──────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ──────────────────────────────────────────────

// Estado: esperando que el jefe elija entre "ver menú" o "preguntar"
let esperandoEleccion = false;

function activarEsperaEleccion() {
  esperandoEleccion = true;
}

// Mapa de números de menú a acciones directas (activo solo cuando NO se espera elección inicial)
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

async function procesarMensaje(texto) {
  const t = texto.trim();

  // ── Elección inicial (después del saludo de bienvenida) ──
  if (esperandoEleccion) {
    esperandoEleccion = false;
    if (t === '1') {
      return mensajeMenu();
    }
    // Opción 2 o cualquier otra cosa → invitar a preguntar libremente
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

    if (raw.startsWith('[GASTOS]')) {
      return await reporteGastos(monitor.fechaInicioMes(), monitor.fechaHoy(), 'ESTE MES');
    }

    if (raw.startsWith('[CAJA]')) {
      return await reporteCierresCaja(monitor.fechaInicioMes(), monitor.fechaHoy());
    }

    if (raw.startsWith('[VENTAS_HORA]')) {
      return await reporteVentasPorHora(monitor.fechaHoy(), monitor.fechaHoy(), 'HOY');
    }

    if (raw.startsWith('[AYUDA]') || raw.startsWith('[MENU]')) {
      esperandoEleccion = true;
      return mensajeBienvenida();
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

function mensajeBienvenida() {
  return `👋 *¡Hola jefe, qué gusto saludarte!*\n\n¿Cómo te puedo ayudar?\n\n1️⃣ Ver menú de opciones\n2️⃣ Pregúntame algo`;
}

function mensajeMenu() {
  return `📋 *MENÚ DE OPCIONES*\n\n1️⃣ Ventas de hoy\n2️⃣ Ventas de este mes\n3️⃣ Ventas del mes pasado\n4️⃣ Ventas de esta semana\n5️⃣ Productos más/menos vendidos del mes\n6️⃣ Medios de pago hoy (efectivo / transferencia)\n7️⃣ Quién trabajó hoy\n8️⃣ Ranking cajeros del mes\n9️⃣ Alertas de inventario\n0️⃣ Ventas por rango de fechas\n\n_También puedo decirte: gastos del mes, ventas por hora, cierres de caja, o recomendarte perfumes_ 😊`;
}

module.exports = { procesarMensaje, activarEsperaEleccion, mensajeBienvenida };
