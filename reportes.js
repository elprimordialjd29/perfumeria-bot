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

  // ── Detector de cierres y apertura: cada 10 minutos ──
  cron.schedule('*/10 * * * *', async () => {
    await detectarNuevoCierre();
    await detectarApertura();
  }, { timezone: 'America/Bogota' });

  // ── Reporte de mediodía: 12:00 PM ──
  cron.schedule('0 12 * * *', async () => {
    console.log('🌞 Enviando reporte mediodía...');
    await enviarReporteMediodia();
  }, { timezone: 'America/Bogota' });

  console.log('✅ Reportes automáticos activados:');
  console.log('   🌅 Matutino (ayer + mes + inventario): 7:30 AM diario');
  console.log('   🌞 Mediodía: 12:00 PM diario');
  console.log('   📅 Semanal: lunes 8:00 AM');
  console.log('   🏧 Detector cierres/apertura: cada 10 min');
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

// ──────────────────────────────────────────────
// DETECTOR DE CIERRE DE CAJA
// Revisa cada 10 min si hay un nuevo cierre. Si lo hay, envía reporte.
// ──────────────────────────────────────────────

async function detectarNuevoCierre() {
  try {
    const hoy = monitor.fechaHoy();
    const fp  = (v) => Math.round(v).toLocaleString('es-CO');

    // Leer último cierre conocido desde config
    const cfg = await db.obtenerConfig();
    let ultimoTurnoConocido = cfg?.ultimo_cierre || '';

    // Obtener cierres de hoy
    const { browser, page } = await monitor.crearSesionPOS();
    const cierres = await monitor.extraerCierresCaja(page, hoy, hoy);

    if (!cierres.length) { await browser.close(); return; }

    // El turno más reciente del día
    const ultimoCierre = cierres[cierres.length - 1];
    const turnoId = `${ultimoCierre.fecha}|${ultimoCierre.turnos}`;

    if (turnoId === ultimoTurnoConocido) { await browser.close(); return; } // sin cambios

    // ── Nuevo cierre detectado ── obtener datos del día
    const cajeros   = await monitor.extraerVentasCajero(page, hoy, hoy);
    const productos = await monitor.extraerVentasProducto(page, hoy, hoy);
    await browser.close();

    // Guardar nuevo estado en config
    await db.actualizarConfig({ ultimo_cierre: turnoId });

    // ── Construir mensaje ──
    const totalDia    = cajeros.reduce((s, c) => s + c.total, 0);
    const ticketsDia  = cajeros.reduce((s, c) => s + c.tickets, 0);
    const efectivoDia = cajeros.reduce((s, c) => s + (c.efectivo || 0), 0);
    const bancoDia    = cajeros.reduce((s, c) => s + (c.bancolombia || 0), 0);
    const nequiDia    = cajeros.reduce((s, c) => s + (c.nequi || 0), 0);

    const meta       = parseInt(process.env.META_MENSUAL) || 10000000;
    const diasEnMes  = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const metaDiaria = Math.round(meta / diasEnMes);
    const faltaDia   = Math.max(0, metaDiaria - totalDia);
    const pct        = Math.min(100, Math.round((totalDia / metaDiaria) * 100));
    const barra      = Math.min(Math.round(pct / 10), 10);
    const progreso   = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);

    // Extraer nombre del cajero del turno
    const cajeroNombre = ultimoCierre.turnos?.split(' ').slice(-2).join(' ') || 'Cajero';

    let msg = `🏧 *CIERRE DE CAJA — ${hoy}*\n`;
    msg += `👤 *${cajeroNombre}*\n\n`;

    msg += `💰 *Vendido hoy: $${fp(totalDia)}*\n`;
    msg += `🎫 Tickets: ${ticketsDia}\n`;
    if (efectivoDia > 0) msg += `💵 Efectivo: $${fp(efectivoDia)}\n`;
    if (bancoDia > 0)    msg += `🏦 Bancolombia: $${fp(bancoDia)}\n`;
    if (nequiDia > 0)    msg += `📱 Nequi: $${fp(nequiDia)}\n`;

    msg += `\n🎯 *Meta del día: $${fp(metaDiaria)}*\n`;
    msg += `${progreso} ${pct}%\n`;
    if (faltaDia > 0) {
      msg += `📉 Faltó: *$${fp(faltaDia)}*\n`;
    } else {
      msg += `🏆 *¡Meta del día cumplida!*\n`;
    }

    // Top 5 productos vendidos
    if (productos.length > 0) {
      msg += `\n📦 *Top productos hoy:*\n`;
      productos.slice(0, 5).forEach((p, i) => {
        const medallas = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        msg += `${medallas[i]} *${p.producto || p.nombre}*: ${p.unidades || p.cantidad || 0} uds\n`;
      });
    }

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;

    await notificar('🏧 Cierre de Caja', msg);
    console.log(`🏧 Cierre detectado y notificado: ${cajeroNombre}`);

  } catch(e) {
    console.error('Error detector cierre:', e.message);
  }
}

// ──────────────────────────────────────────────
// DETECTOR DE APERTURA
// Detecta la primera venta del día y notifica quién abrió y a qué hora
// ──────────────────────────────────────────────

async function detectarApertura() {
  try {
    const hoy = monitor.fechaHoy();
    const fp  = (v) => Math.round(v).toLocaleString('es-CO');

    // Verificar si ya notificamos apertura hoy
    const cfg = await db.obtenerConfig();
    if (cfg?.ultima_apertura_fecha === hoy) return; // ya notificado hoy

    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros  = await monitor.extraerVentasCajero(page, hoy, hoy);
    const porHora  = await monitor.extraerVentasPorHora(page, hoy, hoy);
    const productos = await monitor.extraerVentasProducto(page, hoy, hoy);
    await browser.close();

    const activos = cajeros.filter(c => c.tickets > 0);
    if (!activos.length) return; // aún no hay ventas hoy

    // Hora de apertura = primera hora con ventas
    const primeraHora = porHora.find(h => h.total > 0);
    const horaApertura = primeraHora
      ? `${String(primeraHora.hora).padStart(2, '0')}:00`
      : 'N/A';

    // Guardar que ya notificamos apertura hoy
    await db.actualizarConfig({ ultima_apertura_fecha: hoy });

    const totalActual  = activos.reduce((s, c) => s + c.total, 0);
    const ticketsTotal = activos.reduce((s, c) => s + c.tickets, 0);
    const meta         = parseInt(process.env.META_MENSUAL) || 10000000;
    const diasEnMes    = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const metaDiaria   = Math.round(meta / diasEnMes);

    let msg = `🔓 *APERTURA DE CAJA — ${hoy}*\n\n`;
    activos.forEach(c => {
      msg += `👤 *${c.cajero}* abrió a las *${horaApertura}*\n`;
    });

    if (totalActual > 0) {
      msg += `\n📊 *Avance actual:*\n`;
      msg += `💰 Vendido: $${fp(totalActual)} | 🎫 ${ticketsTotal} tickets\n`;
      const pct = Math.min(100, Math.round((totalActual / metaDiaria) * 100));
      msg += `🎯 Meta del día: $${fp(metaDiaria)} (${pct}% completado)\n`;
    }

    // Primera venta del día (producto más vendido por ahora)
    if (productos.length > 0) {
      msg += `\n🛍️ *Primera venta del día:*\n`;
      msg += `🥇 *${productos[0].producto || productos[0].nombre}*\n`;
    }

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    await notificar('🔓 Apertura de Caja', msg);
    console.log(`🔓 Apertura detectada y notificada: ${activos.map(c => c.cajero).join(', ')}`);

  } catch(e) {
    console.error('Error detector apertura:', e.message);
  }
}

// ──────────────────────────────────────────────
// REPORTE DE MEDIODÍA — 12:00 PM
// Resumen de la mañana: vendido, cajero activo, meta del día
// ──────────────────────────────────────────────

async function enviarReporteMediodia() {
  try {
    const hoy = monitor.fechaHoy();
    const fp  = (v) => Math.round(v).toLocaleString('es-CO');
    const meta       = parseInt(process.env.META_MENSUAL) || 10000000;
    const diasEnMes  = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const metaDiaria = Math.round(meta / diasEnMes);

    const { browser, page } = await monitor.crearSesionPOS();
    const cajeros   = await monitor.extraerVentasCajero(page, hoy, hoy);
    const porHora   = await monitor.extraerVentasPorHora(page, hoy, hoy);
    const productos = await monitor.extraerVentasProducto(page, hoy, hoy);
    await browser.close();

    const activos     = cajeros.filter(c => c.tickets > 0);
    const totalHoy    = activos.reduce((s, c) => s + c.total, 0);
    const ticketsHoy  = activos.reduce((s, c) => s + c.tickets, 0);
    const efectivoHoy = activos.reduce((s, c) => s + (c.efectivo || 0), 0);
    const bancoHoy    = activos.reduce((s, c) => s + (c.bancolombia || 0), 0);
    const nequiHoy    = activos.reduce((s, c) => s + (c.nequi || 0), 0);
    const faltaDia    = Math.max(0, metaDiaria - totalHoy);
    const pct         = Math.min(100, Math.round((totalHoy / metaDiaria) * 100));
    const barra       = Math.min(Math.round(pct / 10), 10);
    const progreso    = '🟩'.repeat(barra) + '⬜'.repeat(10 - barra);

    // Hora pico de la mañana
    const horaPico = porHora.length > 0
      ? porHora.reduce((max, h) => h.total > max.total ? h : max, porHora[0])
      : null;

    let msg = `🌞 *MEDIODÍA — ${hoy}*\n\n`;

    if (!activos.length) {
      msg += `_Sin ventas registradas esta mañana_\n`;
    } else {
      activos.forEach(c => {
        msg += `👤 *${c.cajero}* | 🎫 ${c.tickets} tickets\n`;
      });
      msg += `\n💰 *Vendido esta mañana: $${fp(totalHoy)}*\n`;
      if (efectivoHoy > 0) msg += `   💵 Efectivo: $${fp(efectivoHoy)}\n`;
      if (bancoHoy > 0)    msg += `   🏦 Bancolombia: $${fp(bancoHoy)}\n`;
      if (nequiHoy > 0)    msg += `   📱 Nequi: $${fp(nequiHoy)}\n`;
      if (ticketsHoy > 0)  msg += `   💳 Ticket promedio: $${fp(totalHoy / ticketsHoy)}\n`;

      if (horaPico && horaPico.total > 0) {
        msg += `\n⚡ Hora pico: *${String(horaPico.hora).padStart(2,'0')}:00* — $${fp(horaPico.total)}\n`;
      }

      msg += `\n🎯 *Meta del día: $${fp(metaDiaria)}*\n`;
      msg += `${progreso} ${pct}%\n`;
      if (faltaDia > 0) {
        msg += `📉 Falta para completar: *$${fp(faltaDia)}*\n`;
      } else {
        msg += `🏆 *¡Meta del día ya cumplida!*\n`;
      }
    }

    // Top 3 productos de la mañana
    if (productos.length > 0) {
      msg += `\n📦 *Top productos esta mañana:*\n`;
      const medallas = ['🥇','🥈','🥉'];
      productos.slice(0, 3).forEach((p, i) => {
        msg += `${medallas[i]} *${p.producto || p.nombre}*: ${p.unidades || p.cantidad || 0} uds\n`;
      });
    }

    msg += `\n─────────────────\n🤖 _VectorPOS — Chu_`;
    await notificar('🌞 Reporte Mediodía', msg);
  } catch(e) {
    console.error('Error reporte mediodía:', e.message);
  }
}

module.exports = { iniciar, notificar, enviarReporteDiario, enviarReporteSemanal };
