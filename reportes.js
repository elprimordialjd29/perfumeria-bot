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

  // ── Alertas inventario: 8:00 AM diario ──
  cron.schedule('0 8 * * *', async () => {
    console.log('📦 Revisando alertas de inventario...');
    try {
      const resultado = await monitor.consultarAlertasInventario();
      const hayAlertas = resultado && (resultado.alertasGramos.length > 0 || resultado.alertasUnidades.length > 0);
      if (hayAlertas) {
        const msg = monitor.generarMensajeAlertas(resultado);
        await notificar('⚠️ Alertas de Inventario', msg);
      }
    } catch(e) { console.error('Error alertas inventario:', e.message); }
  }, { timezone: 'America/Bogota' });

  // ── VectorPOS: 7:00 AM y 7:00 PM ──
  cron.schedule('0 7,19 * * *', async () => {
    console.log('🔍 Revisando VectorPOS...');
    try {
      const datos = await monitor.monitorearVentasDiarias();
      if (datos) await notificar('📊 Reporte VectorPOS', monitor.generarMensajeMeta(datos));
    } catch(e) { console.error('Error monitoreo POS:', e.message); }
  }, { timezone: 'America/Bogota' });

  // ── Reporte diario completo: 8:00 PM ──
  cron.schedule('0 20 * * *', async () => {
    console.log('📨 Enviando reporte diario...');
    await enviarReporteDiario();
  }, { timezone: 'America/Bogota' });

  // ── Reporte semanal: lunes 8:00 AM ──
  cron.schedule('0 8 * * 1', async () => {
    console.log('📨 Enviando reporte semanal...');
    await enviarReporteSemanal();
  }, { timezone: 'America/Bogota' });

  console.log('✅ Reportes automáticos activados:');
  console.log('   📦 Inventario: 8:00 AM');
  console.log('   🔍 VectorPOS: 7:00 AM y 7:00 PM');
  console.log('   📅 Diario: 8:00 PM');
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
