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
    const fHoy  = hoy.toISOString().split('T')[0];
    const fMes  = monitor.fechaInicioMes();
    const meta  = parseInt(process.env.META_MENSUAL) || 10000000;

    const labelAyer = ayer.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(1, diasEnMes - hoy.getDate());
    const metaDiaria = Math.round(meta / diasEnMes);

    // 1. Ventas de ayer
    const { browser, page } = await monitor.crearSesionPOS();
    const cajerosAyer = await monitor.extraerVentasCajero(page, fAyer, fAyer);
    const cajerosMes  = await monitor.extraerVentasCajero(page, fMes, fAyer);
    await browser.close();

    const totalAyer = cajerosAyer.reduce((s, c) => s + c.total, 0);
    const ticketsAyer = cajerosAyer.reduce((s, c) => s + c.tickets, 0);
    const totalMes  = cajerosMes.reduce((s, c) => s + c.total, 0);
    const faltaMeta = Math.max(0, meta - totalMes);
    const pctMeta   = ((totalMes / meta) * 100).toFixed(1);
    const promNecesario = Math.round(faltaMeta / diasRestantes);

    const barra = Math.min(Math.round(Number(pctMeta) / 10), 10);
    const progreso = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);
    const medallas = ['🥇', '🥈', '🥉'];

    let msg = `🌅 *BUENOS DÍAS — ${hoy.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}*\n\n`;

    // Bloque ayer
    msg += `📅 *VENTAS DE AYER (${labelAyer.toUpperCase()})*\n`;
    msg += `💰 Total: *$${totalAyer.toLocaleString('es-CO')}* | 🎫 ${ticketsAyer} tickets\n`;
    if (totalAyer > 0 && ticketsAyer > 0) {
      msg += `💵 Promedio ticket: $${Math.round(totalAyer / ticketsAyer).toLocaleString('es-CO')}\n`;
    }
    if (cajerosAyer.length > 0) {
      msg += `👥 Cajeros:\n`;
      cajerosAyer.forEach((c, i) => {
        msg += `   ${medallas[i] || `${i+1}.`} *${c.cajero}*: $${c.total.toLocaleString('es-CO')} (${c.tickets} tkt)\n`;
      });
    } else {
      msg += `_Sin ventas registradas ayer_\n`;
    }

    // Bloque mes
    msg += `\n📊 *AVANCE DEL MES*\n`;
    msg += `${progreso} ${pctMeta}%\n`;
    msg += `💰 Vendido: *$${totalMes.toLocaleString('es-CO')}* / $${meta.toLocaleString('es-CO')}\n`;
    if (faltaMeta > 0) {
      msg += `📉 Falta: *$${faltaMeta.toLocaleString('es-CO')}*\n`;
      msg += `📌 Necesario/día: $${promNecesario.toLocaleString('es-CO')} | Meta/día: $${metaDiaria.toLocaleString('es-CO')}\n`;
      msg += `📆 Días restantes: ${diasRestantes}\n`;
    } else {
      msg += `🏆 *¡META DEL MES CUMPLIDA!*\n`;
    }

    // Bloque inventario bajo
    try {
      const alertas = await monitor.consultarAlertasInventario();
      const bajos = [
        ...(alertas?.alertasGramos   || []),
        ...(alertas?.alertasUnidades || []),
      ];
      if (bajos.length > 0) {
        msg += `\n⚠️ *INVENTARIO BAJO (${bajos.length} productos)*\n`;
        bajos.slice(0, 10).forEach(p => {
          const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= 5 ? '🔴 CRÍTICO' : '🟡 BAJO';
          msg += `${nivel} *${p.nombre}*: ${p.saldo} ${p.medida || 'uds'}\n`;
        });
        if (bajos.length > 10) msg += `_...y ${bajos.length - 10} más_\n`;
      } else {
        msg += `\n✅ *Inventario: sin alertas*\n`;
      }
    } catch(e) {
      msg += `\n⚠️ _No pude verificar el inventario_\n`;
    }

    msg += `\n─────────────────\n🤖 _Reporte automático — Chu_`;
    await notificar('🌅 Reporte Matutino', msg);

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
