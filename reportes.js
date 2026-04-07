/**
 * reportes.js - Reportes automáticos con meta de $10M/mes
 * Combina ventas del bot + datos de VectorPOS
 */

const cron = require('node-cron');
const db = require('./database');
const monitor = require('./monitor-pos');

let clienteWA = null;

function iniciar(waClient) {
  clienteWA = waClient;

  // ── Monitoreo VectorPOS: cada día a las 7:00 AM y 7:00 PM ──
  cron.schedule('0 7,19 * * *', async () => {
    console.log('🔍 Revisando VectorPOS...');
    await revisarYNotificarPOS();
  }, { timezone: 'America/Bogota' });

  // ── Reporte diario: 8:00 PM ──
  cron.schedule('0 20 * * *', async () => {
    console.log('📨 Enviando reporte diario...');
    await enviarReporteDiario();
  }, { timezone: 'America/Bogota' });

  // ── Reporte semanal: lunes 8:00 AM ──
  cron.schedule('0 8 * * 1', async () => {
    console.log('📨 Enviando reporte semanal...');
    await enviarReporteSemanal();
  }, { timezone: 'America/Bogota' });

  console.log('✅ Reportes y monitoreo automáticos activados:');
  console.log('   🔍 VectorPOS: 7:00 AM y 7:00 PM');
  console.log('   📅 Reporte diario: 8:00 PM');
  console.log('   📅 Reporte semanal: lunes 8:00 AM');
}

// ──────────────────────────────────────────────
// REVISAR POS Y NOTIFICAR AL ADMIN
// ──────────────────────────────────────────────

async function revisarYNotificarPOS() {
  try {
    const datos = await monitor.monitorearVentasDiarias();
    const mensaje = monitor.generarMensajeMeta(datos);
    await enviarMensajeAdmin(mensaje);
  } catch (e) {
    console.error('Error en monitoreo POS:', e.message);
  }
}

// ──────────────────────────────────────────────
// REPORTE DIARIO COMPLETO
// ──────────────────────────────────────────────

async function enviarReporteDiario() {
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
  const finDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).toISOString();

  const ventas = await db.obtenerVentas({ desde: inicioDia, hasta: finDia });
  const datosPOS = await monitor.monitorearVentasDiarias();

  const fecha = ahora.toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let msg = `🌺 *REPORTE DIARIO*\n_${fecha}_\n\n`;

  // ── Ventas del POS ──
  if (datosPOS.hoy?.exitoso && datosPOS.hoy.total_dia > 0) {
    msg += `💻 *VectorPOS hoy:* $${datosPOS.hoy.total_dia.toLocaleString('es-CO')}\n`;
  }

  // ── Ventas del bot ──
  if (ventas.length > 0) {
    const totalBot = ventas.reduce((s, v) => s + parseFloat(v.total), 0);
    const ranking = db.calcularRanking(ventas);
    const medallas = ['🥇', '🥈', '🥉'];

    msg += `🤖 *Bot WhatsApp hoy:* $${totalBot.toLocaleString('es-CO')} (${ventas.length} ventas)\n\n`;
    msg += `🏆 *Ranking Vendedores:*\n`;
    ranking.forEach((r, i) => {
      const m = medallas[i] || `${i + 1}.`;
      msg += `${m} ${r.vendedor}: $${r.totalMonto.toLocaleString('es-CO')}\n`;
    });
    msg += '\n';
  } else {
    msg += `🤖 *Bot WhatsApp:* Sin ventas hoy\n\n`;
  }

  // ── Progreso meta mensual ──
  msg += monitor.generarMensajeMeta(datosPOS);
  msg += `\n\n─────────────────\n🤖 _Reporte automático_`;

  await enviarMensajeAdmin(msg);
}

// ──────────────────────────────────────────────
// REPORTE SEMANAL
// ──────────────────────────────────────────────

async function enviarReporteSemanal() {
  const ahora = new Date();
  const inicioSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

  const ventas = await db.obtenerVentas({ desde: inicioSemana.toISOString() });
  const datosPOS = await db.obtenerDatosPOS({ desde: inicioSemana.toISOString().split('T')[0] });

  const totalBot = ventas.reduce((s, v) => s + parseFloat(v.total), 0);
  const totalPOS = datosPOS.reduce((s, d) => s + parseFloat(d.total_dia || 0), 0);
  const totalGeneral = totalBot + totalPOS;

  const fechaI = inicioSemana.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
  const fechaF = ahora.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });

  let msg = `📊 *REPORTE SEMANAL*\n_${fechaI} - ${fechaF}_\n\n`;
  msg += `💵 *Total semanal: $${totalGeneral.toLocaleString('es-CO')}*\n`;
  msg += `   • POS: $${totalPOS.toLocaleString('es-CO')}\n`;
  msg += `   • Bot: $${totalBot.toLocaleString('es-CO')}\n\n`;

  if (ventas.length > 0) {
    const ranking = db.calcularRanking(ventas);
    const medallas = ['🥇', '🥈', '🥉'];
    msg += `🏆 *Ranking Vendedores (bot):*\n`;
    ranking.forEach((r, i) => {
      msg += `${medallas[i] || `${i + 1}.`} *${r.vendedor}*: $${r.totalMonto.toLocaleString('es-CO')}\n`;
    });
    msg += '\n';
  }

  // Promedio diario vs meta
  const promedioDiario = totalGeneral / 7;
  const promNecesario = (monitor.META_MENSUAL - totalGeneral) / calcularDiasRestantes();
  msg += `📈 *Promedio esta semana:* $${promedioDiario.toLocaleString('es-CO', { maximumFractionDigits: 0 })}/día\n`;
  msg += `🎯 *Necesitas:* $${Math.max(0, promNecesario).toLocaleString('es-CO', { maximumFractionDigits: 0 })}/día para llegar a la meta\n`;
  msg += `\n─────────────────\n🤖 _Reporte automático_`;

  await enviarMensajeAdmin(msg);
}

// ──────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────

function calcularDiasRestantes() {
  const hoy = new Date();
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return Math.max(1, ultimoDia - hoy.getDate());
}

async function enviarMensajeAdmin(mensaje) {
  try {
    const config = await db.obtenerConfig();
    if (!config.adminNumber || !clienteWA) {
      console.log('ℹ️  Sin admin configurado. Mensaje:\n', mensaje);
      return;
    }
    const chatId = `${config.adminNumber.replace(/\D/g, '')}@c.us`;
    await clienteWA.sendMessage(chatId, mensaje);
    console.log(`✅ Mensaje enviado al admin`);
  } catch (e) {
    console.error('Error enviando al admin:', e.message);
  }
}

module.exports = {
  iniciar,
  enviarReporteDiario,
  enviarReporteSemanal,
  revisarYNotificarPOS,
  enviarMensajeAdmin,
};
