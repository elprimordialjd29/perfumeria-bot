/**
 * reportes.js — Reportes automáticos
 * Envía a Telegram + Email simultáneamente
 */

const cron = require('node-cron');
const db = require('./database');
const monitor = require('./monitor-pos');
const { enviarEmail } = require('./email');

let telegramBot = null;
let adminId = null;

function iniciar(bot) {
  telegramBot = bot;
  adminId = process.env.TELEGRAM_ADMIN_ID;

  // ── Reporte matutino: 7:30 AM todos los días ──
  cron.schedule('30 7 * * *', async () => {
    console.log('🌅 Enviando reporte matutino 7:30 AM...');
    await enviarReporteMatutino();
  }, { timezone: 'America/Bogota' });

  // ── Reporte semanal: lunes 8:00 AM ──
  cron.schedule('0 8 * * 1', async () => {
    console.log('📨 Enviando reporte semanal...');
    await enviarReporteSemanal();
  }, { timezone: 'America/Bogota' });

  console.log('✅ Reportes automáticos activados:');
  console.log('   🌅 Matutino (ayer + mes + inventario): 7:30 AM diario');
  console.log('   📅 Semanal: lunes 8:00 AM');
}

// ──────────────────────────────────────────────
// NOTIFICAR — Telegram + Email simultáneo
// ──────────────────────────────────────────────

async function notificar(asunto, mensaje) {
  const promesas = [];

  // Telegram
  if (telegramBot && adminId) {
    promesas.push(
      telegramBot.sendMessage(adminId, mensaje, { parse_mode: 'Markdown' })
        .catch(e => {
          // Fallback sin formato
          return telegramBot.sendMessage(adminId, mensaje).catch(() => {});
        })
    );
  }

  // Email
  promesas.push(enviarEmail(asunto, mensaje));

  await Promise.allSettled(promesas);
  console.log(`✅ Notificación enviada: ${asunto}`);
}

// ──────────────────────────────────────────────
// REPORTE MATUTINO — 7:30 AM
// Ventas ayer + avance del mes + inventario bajo
// ──────────────────────────────────────────────

async function enviarReporteMatutino() {
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

    // ── 1. Ventas de ayer (sesión propia) ──
    const { browser: b1, page: p1 } = await monitor.crearSesionPOS();
    const cajerosAyer = await monitor.extraerVentasCajero(p1, fAyer, fAyer);
    await b1.close();

    const totalAyer   = cajerosAyer.reduce((s, c) => s + c.total,   0);
    const ticketsAyer = cajerosAyer.reduce((s, c) => s + c.tickets, 0);

    // ── 2. Avance del mes (función validada) ──
    const datosMes = await monitor.monitorearVentasDiarias();
    const totalMes  = datosMes?.totalMes  || 0;
    const cajerosMes = datosMes?.cajerosMes || [];
    const faltaMeta = Math.max(0, meta - totalMes);
    const pctMeta   = ((totalMes / meta) * 100).toFixed(1);
    const promNecesario = Math.round(faltaMeta / diasRestantes);
    const barra = Math.min(Math.round(Number(pctMeta) / 10), 10);
    const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);

    const encabezado = `🌅 *BUENOS DÍAS — ${hoy.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}*`;

    // Mensaje 1: ayer + mes
    let msg1 = `${encabezado}\n\n`;
    msg1 += `📅 *VENTAS DE AYER (${labelAyer.toUpperCase()})*\n`;
    msg1 += `💰 Total: *$${totalAyer.toLocaleString('es-CO')}* | 🎫 ${ticketsAyer} tickets\n`;
    if (totalAyer > 0 && ticketsAyer > 0) {
      msg1 += `💵 Promedio ticket: $${Math.round(totalAyer / ticketsAyer).toLocaleString('es-CO')}\n`;
    }
    if (cajerosAyer.length > 0) {
      msg1 += `👥 Cajeros:\n`;
      cajerosAyer.forEach((c, i) => {
        msg1 += `   ${medallas[i] || `${i+1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${c.tickets} tkt)\n`;
      });
    } else {
      msg1 += `_Sin ventas registradas ayer_\n`;
    }

    msg1 += `\n📊 *AVANCE DEL MES*\n`;
    msg1 += `${progreso} ${pctMeta}%\n`;
    msg1 += `💰 Vendido: *$${totalMes.toLocaleString('es-CO')}* / $${meta.toLocaleString('es-CO')}\n`;
    if (faltaMeta > 0) {
      msg1 += `📉 Falta: *$${faltaMeta.toLocaleString('es-CO')}*\n`;
      msg1 += `📌 Necesario/día: $${promNecesario.toLocaleString('es-CO')} | Meta/día: $${metaDiaria.toLocaleString('es-CO')}\n`;
      msg1 += `📆 Días restantes: ${diasRestantes}\n`;
    } else {
      msg1 += `🏆 *¡META DEL MES CUMPLIDA!*\n`;
    }
    if (cajerosMes.length > 0) {
      const totalGen = cajerosMes.reduce((s,c) => s + c.total, 0);
      msg1 += `\n👥 *Ranking del mes:*\n`;
      cajerosMes.forEach((c, i) => {
        const pct = totalGen > 0 ? ((c.total / totalGen)*100).toFixed(0) : 0;
        msg1 += `   ${medallas[i] || `${i+1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${pct}%)\n`;
      });
    }

    await notificar('🌅 Reporte Matutino', msg1);

    // ── 3. Inventario bajo — todos, dividido en partes ──
    try {
      const alertas = await monitor.consultarAlertasInventario();
      const bajos = [
        ...(alertas?.alertasGramos   || []),
        ...(alertas?.alertasUnidades || []),
      ].sort((a, b) => {
        if (a.saldo === 0 && b.saldo > 0) return -1;
        if (b.saldo === 0 && a.saldo > 0) return 1;
        return a.saldo - b.saldo;
      }); // agotados primero, luego críticos, luego bajos

      if (bajos.length === 0) {
        await notificar('✅ Inventario', `✅ *Inventario: sin alertas*\n_Todos los productos tienen stock suficiente_`);
        return;
      }

      // Dividir en partes de ~3000 chars
      const encInv = `⚠️ *INVENTARIO BAJO (${bajos.length} productos)*\n\n`;
      const partes = [];
      let parteActual = encInv;
      for (const p of bajos) {
        const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= 5 ? '🔴 CRÍTICO' : '🟡 BAJO';
        const linea = `${nivel} *${p.nombre}*: ${p.saldo} ${p.medida || 'uds'}\n`;
        if ((parteActual + linea).length > 3000) {
          partes.push(parteActual);
          parteActual = `⚠️ _(inventario bajo — continuación)_\n\n`;
        }
        parteActual += linea;
      }
      partes.push(parteActual + `\n─────────────────\n🤖 _Reporte automático — Chu_`);

      for (const parte of partes) {
        await notificar('⚠️ Inventario Bajo', parte);
      }
    } catch(e) {
      console.error('Error inventario matutino:', e.message);
    }

  } catch(e) {
    console.error('Error reporte matutino:', e.message);
  }
}

// ──────────────────────────────────────────────
// REPORTE DIARIO
// ──────────────────────────────────────────────

async function enviarReporteDiario() {
  try {
    const datosPOS = await monitor.monitorearVentasDiarias();
    const fecha = new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    let msg = `🌺 *REPORTE DIARIO*\n_${fecha}_\n\n`;
    msg += monitor.generarMensajeMeta(datosPOS);
    msg += `\n\n─────────────────\n🤖 _Reporte automático — Chu_`;

    await notificar('📊 Reporte Diario', msg);
  } catch(e) {
    console.error('Error reporte diario:', e.message);
  }
}

// ──────────────────────────────────────────────
// REPORTE SEMANAL
// ──────────────────────────────────────────────

async function enviarReporteSemanal() {
  try {
    const hoy = new Date();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
    const desde = lunes.toISOString().split('T')[0];
    const hasta = monitor.fechaHoy();

    const { browser, page } = await monitor.crearSesionPOS();
    const ventas = await monitor.extraerVentasGenerales(page, desde, hasta);
    const cajeros = await monitor.extraerVentasCajero(page, desde, hasta);
    await browser.close();

    const total = ventas.reduce((s, v) => s + v.totalVentas, 0);
    const tickets = ventas.reduce((s, v) => s + v.tickets, 0);
    const medallas = ['🥇', '🥈', '🥉'];

    const fechaI = lunes.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
    const fechaF = hoy.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });

    let msg = `📊 *REPORTE SEMANAL*\n_${fechaI} — ${fechaF}_\n\n`;
    msg += `💰 *Total: $${total.toLocaleString('es-CO')}*\n`;
    msg += `🎫 Tickets: ${tickets}\n\n`;

    if (cajeros.length > 0) {
      msg += `👥 *RANKING CAJEROS:*\n`;
      cajeros.forEach((c, i) => {
        const pct = total > 0 ? ((c.total / total) * 100).toFixed(0) : 0;
        msg += `${medallas[i] || `${i + 1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${pct}%)\n`;
      });
    }

    const diasRestantes = calcularDiasRestantes();
    const promNecesario = Math.max(0, (monitor.META_MENSUAL - total) / diasRestantes);
    msg += `\n🎯 Meta/día necesaria: $${Math.round(promNecesario).toLocaleString('es-CO')}\n`;
    msg += `─────────────────\n🤖 _Reporte automático — Chu_`;

    await notificar('📊 Reporte Semanal', msg);
  } catch(e) {
    console.error('Error reporte semanal:', e.message);
  }
}

function calcularDiasRestantes() {
  const hoy = new Date();
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return Math.max(1, ultimoDia - hoy.getDate());
}

module.exports = { iniciar, notificar, enviarReporteDiario, enviarReporteSemanal };
