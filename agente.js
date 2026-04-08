/**
 * agente.js — Chu, asistente personal de ventas
 * Entiende lenguaje natural y ejecuta acciones reales en VectorPOS
 */

require('dotenv').config();
const Groq = require('groq-sdk');
const monitor = require('./monitor-pos');
const db = require('./database');
const fs = require('fs');
const os = require('os');
const path = require('path');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
[INVENTARIO]        → inventario general, stock total, alertas de productos bajos, qué falta
[CRUCE_PRODUCTO:texto] → consulta cruzada ventas+inventario de UN producto o categoría específica. Extrae el término clave. Ej: "cuánto queda de tapa plana 10ml" → [CRUCE_PRODUCTO:tapa plana 10ml] | "alcohol" → [CRUCE_PRODUCTO:alcohol] | "single color" → [CRUCE_PRODUCTO:singler color] | "originales" → [CRUCE_PRODUCTO:original] | "cuánto se vendió de Lattafa Asad y cuánto queda" → [CRUCE_PRODUCTO:lattafa asad] | "tapa plana 50ml" → [CRUCE_PRODUCTO:tapa plana 50ml]
[GASTOS]            → gastos, egresos, nómina
[CAJA]              → cierres de caja, turnos
[VENTAS_HORA]       → ventas por hora, hora pico
[REQUERIMIENTO]     → crear requerimiento, nota, tarea
[VER_REQS]          → ver requerimientos pendientes
[EXPORTAR_EXCEL]    → exportar Excel, CSV, archivo
[MENU]              → saludos: hola, buenos días, buenas, hey

━━━ CONOCIMIENTO PROPIO (SIN etiqueta, SIN inventar datos del negocio) ━━━
Responde directamente SOLO para:
- Perfumes árabes y marcas: Lattafa, Al Haramain, Ajmal, Rasasi, Swiss Arabian, Armaf, Nabeel
- Clones/dupes: Lattafa Asad ≈ Sauvage, Khamrah ≈ Spicebomb, etc.
- Recomendaciones por género, ocasión, presupuesto, notas olfativas
- Ingredientes: oud, musk, sándalo, bergamota, rosa, jazmín, ámbar
- Consejos de venta y cómo describir fragancias

━━━ EJEMPLOS CORRECTOS ━━━
"qué perfumes tenemos en inventario" → [INVENTARIO]
"cuántas unidades de Lattafa quedan" → [CRUCE_PRODUCTO:lattafa]
"tapa plana de 10ml" → [CRUCE_PRODUCTO:tapa plana 10ml]
"single color" → [CRUCE_PRODUCTO:singler color]
"cuánto alcohol queda" → [CRUCE_PRODUCTO:alcohol]
"originales cuántos quedan y cuántos se vendieron" → [CRUCE_PRODUCTO:original]
"tapa plana 50ml vendido y stock" → [CRUCE_PRODUCTO:tapa plana 50ml]
"qué se vendió más este mes" → [PRODUCTOS_MES]
"ventas de hoy" → [REPORTE_HOY]
"gastos del mes" → [GASTOS]
"cuál es el mejor perfume árabe" → (responde con conocimiento, sin inventar stock)
"hola" → [MENU]
"ventas del 1 al 7 de abril" → [REPORTE_RANGO:2026-04-01:2026-04-07]`;

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
  'r': '[REQUERIMIENTO]',
  'R': '[REQUERIMIENTO]',
  'e': '[EXPORTAR_EXCEL]',
  'E': '[EXPORTAR_EXCEL]',
  'v': '[VER_REQS]',
  'V': '[VER_REQS]',
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
    [/^(ventas\s+(de\s+)?)?ayer(\s+nada\s+m[aá]s)?$/, r.ayer, r.ayer],
    [/(ventas\s+(del?\s+)?)?ayer\s+y\s+hoy/,          r.ayer, r.hoy],
    [/(ventas\s+(del?\s+)?)?ayer\s+(a|hasta|y)\s+hoy/, r.ayer, r.hoy],
    [/^(ventas\s+(de\s+)?)?antier$/, r.antier, r.antier],
    [/antier\s+(a|hasta|y)\s+hoy/,   r.antier, r.hoy],
    [/antier\s+(a|hasta|y)\s+ayer/,  r.antier, r.ayer],
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

async function procesarMensaje(texto) {
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

    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT + contextoFechas }, ...historial],
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

function mensajeBienvenida() {
  return `👋 *¡Hola jefe, qué gusto saludarte!*\n\n¿Cómo te puedo ayudar?\n\n1️⃣ Ver menú de opciones\n2️⃣ Pregúntame algo`;
}

function mensajeMenu() {
  return `📋 *MENÚ DE OPCIONES*\n\n` +
    `1️⃣ Ventas de hoy\n` +
    `2️⃣ Ventas de este mes\n` +
    `3️⃣ Ventas del mes pasado\n` +
    `4️⃣ Ventas de esta semana\n` +
    `5️⃣ Productos más/menos vendidos del mes\n` +
    `6️⃣ Medios de pago hoy\n` +
    `7️⃣ Quién trabajó hoy\n` +
    `8️⃣ Ranking cajeros del mes\n` +
    `9️⃣ Alertas de inventario\n` +
    `0️⃣ Ventas por rango de fechas\n` +
    `🇷 *R* — Crear requerimiento nuevo\n` +
    `🇻 *V* — Ver requerimientos\n` +
    `📊 *E* — Exportar reporte en Excel\n\n` +
    `_También dime: gastos del mes, ventas por hora, o pregúntame sobre perfumes_ 😊`;
}

module.exports = { procesarMensaje, activarEsperaEleccion, mensajeBienvenida, exportarExcelMes };
