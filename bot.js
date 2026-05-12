/**
 * bot.js — Chu, asistente personal de ventas
 *
 * Modo: WEBHOOK cuando RAILWAY_PUBLIC_DOMAIN está definido (Railway)
 *       POLLING en local / desarrollo
 *
 * Webhook elimina el 409 Conflict porque no hay polling competitivo.
 */

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const crypto      = require('crypto');
const agente      = require('./agente');
const reportes    = require('./reportes');
const db          = require('./database');
const monitor     = require('./monitor-pos');
const fs          = require('fs');

// ──────────────────────────────────────────────
// RATE LIMITING (en memoria, por chatId)
// ──────────────────────────────────────────────

const _rateLimitMap = new Map(); // chatId → { count, resetAt }
const RATE_LIMIT_MAX = 8;        // máx mensajes por ventana
const RATE_LIMIT_WINDOW = 30000; // ventana de 30 segundos

function _checkRateLimit(chatId) {
  const now = Date.now();
  const entry = _rateLimitMap.get(chatId);
  if (!entry || now > entry.resetAt) {
    _rateLimitMap.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true; // permitido
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) return false; // bloqueado
  return true;
}

// Limpiar entradas viejas cada 5 minutos para evitar memory leak
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of _rateLimitMap.entries()) {
    if (now > entry.resetAt) _rateLimitMap.delete(id);
  }
}, 300000);

// ──────────────────────────────────────────────
// VALIDACIONES
// ──────────────────────────────────────────────

const errores = [];
if (!process.env.ANTHROPIC_API_KEY)  errores.push('ANTHROPIC_API_KEY');
if (!process.env.SUPABASE_URL)       errores.push('SUPABASE_URL');
if (!process.env.SUPABASE_KEY)       errores.push('SUPABASE_KEY');
if (!process.env.VECTORPOS_USER)     errores.push('VECTORPOS_USER');
if (!process.env.VECTORPOS_PASS)     errores.push('VECTORPOS_PASS');
if (!process.env.TELEGRAM_TOKEN)     errores.push('TELEGRAM_TOKEN');
if (!process.env.TELEGRAM_ADMIN_ID)  errores.push('TELEGRAM_ADMIN_ID');

if (errores.length > 0) {
  console.error('❌ Faltan variables en .env:');
  errores.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

const ADMIN_ID   = process.env.TELEGRAM_ADMIN_ID;
const TOKEN      = process.env.TELEGRAM_TOKEN;
const PORT       = parseInt(process.env.PORT) || 3000;

// Railway pone el dominio público en esta variable
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.WEBHOOK_URL || '';
const USE_WEBHOOK    = !!RAILWAY_DOMAIN;

// Secret token para verificar que los updates vienen de Telegram
// Usar variable de entorno o generar uno fijo a partir del token (determinístico)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ||
  crypto.createHmac('sha256', 'chu-webhook-salt').update(TOKEN).digest('hex').slice(0, 32);

// Token sanitizado para logs (nunca mostrar el token real)
const TOKEN_SAFE = TOKEN ? TOKEN.slice(0, 6) + '***' + TOKEN.slice(-4) : '???';

// ──────────────────────────────────────────────
// CLIENTE TELEGRAM
// ──────────────────────────────────────────────

let bot;

if (USE_WEBHOOK) {
  // Modo webhook — Railway: sin polling, sin 409
  bot = new TelegramBot(TOKEN, { webHook: false });
  console.log(`🔗 Modo: WEBHOOK → https://${RAILWAY_DOMAIN} (token: ${TOKEN_SAFE})`);
} else {
  // Modo polling — local / desarrollo
  bot = new TelegramBot(TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10, allowed_updates: ['message', 'callback_query'] },
    },
  });
  console.log('🔄 Modo: POLLING (local)');
}

// ──────────────────────────────────────────────
// MANEJO DE MENSAJES (igual en ambos modos)
// ──────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId  = msg.chat.id.toString();
  const esAdmin = chatId === ADMIN_ID;

  // ── Rate limiting (antes de cualquier otra validación) ──
  if (!_checkRateLimit(chatId)) {
    // Silencioso para no revelar info al atacante
    return;
  }

  // ── Validar longitud del mensaje ──
  const textoRaw = msg.text?.trim() || '';
  if (textoRaw.length > 4000) return; // ignorar mensajes excesivamente largos

  // Verificar acceso
  if (!esAdmin) {
    const autorizado = await db.esUsuarioAutorizado(chatId);
    if (!autorizado) {
      if (msg.text === '/start' || msg.text === '/id') {
        await bot.sendMessage(chatId,
          `👋 Hola! Soy *Chu*, el asistente de la perfumería.\n\nPara acceder, comparte este ID con el administrador:\n\`${chatId}\``,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId,
          `⛔ No tienes acceso a Chu.\nComparte tu ID con el administrador: \`${chatId}\``,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }
  }

  let texto = textoRaw;
  if (!texto) return;

  // Mapear comandos "/" → palabras clave
  const SLASH_MAP = {
    '/menu': 'menú',     '/start': 'menú',
    '/hoy': 'hoy',       '/mes': 'mes',
    '/mesanterior': 'mes anterior',  '/semana': 'semana',
    '/general': 'reporte general',   '/cajeros': 'cajeros',
    '/horapico': 'hora pico',        '/caja': 'caja',
    '/productos': 'productos más vendidos',
    '/inventario': 'inventario',     '/esencias': 'esencias',
    '/envases': 'envases',           '/originales': 'originales',
    '/replicas': 'réplicas',         '/restock': 'restock',
    '/faltantes': 'faltantes',       '/balance': 'balance',
    '/gastos': 'gastos',             '/redes': 'redes',
    '/analisis': 'analisis',
    '/diagnostico': 'diagnostico',   '/reconectar': 'reconectar',
  };
  const cmdBase = texto.split('@')[0].toLowerCase();
  if (SLASH_MAP[cmdBase]) texto = SLASH_MAP[cmdBase];

  const nombre = msg.from?.first_name || chatId;
  console.log(`📩 [${new Date().toLocaleTimeString('es-CO')}] ${nombre}: ${texto.substring(0, 80)}`);

  // ── Comandos de sistema (admin only, sin pasar por agente) ──
  if (esAdmin && texto === 'diagnostico') {
    await bot.sendChatAction(chatId, 'typing');
    const diag = await monitor.generarMensajeDiagnostico();
    await enviarMensaje(chatId, diag);
    return;
  }

  if (esAdmin && texto === 'reconectar') {
    await enviarMensaje(chatId, '🔧 Iniciando reparación...');
    const { ok, pasos } = await monitor.autoReparar('manual');
    const resumen =
      `🔧 *Reparación completada*\n\n` +
      pasos.map(p => `• ${p}`).join('\n') + '\n\n' +
      (ok
        ? `✅ VectorPOS accesible. Ya puedes usar /mes o /hoy.`
        : `⚠️ VectorPOS sin respuesta. Puede haber un corte externo.\nIntenta en unos minutos.`);
    await enviarMensaje(chatId, resumen);
    return;
  }

  // Comandos que consultan VectorPOS (pueden tardar en cold-start de Railway)
  const COMANDOS_POS = [
    'hoy', 'mes', 'mes anterior', 'semana', 'reporte general',
    'cajeros', 'hora pico', 'caja', 'productos más vendidos', 'analisis',
    // Inventario: también lanza Puppeteer
    'inventario', 'esencias', 'envases', 'originales', 'réplicas',
    'restock', 'faltantes', 'balance',
  ];
  const esComandoPOS = COMANDOS_POS.some(c => texto.toLowerCase() === c ||
    texto.toLowerCase().startsWith(c + ' ') || texto.toLowerCase().startsWith(c + ':'));

  // Para comandos POS: aviso inmediato + 3 min de timeout
  // Para el resto: solo typing + 95s de timeout
  if (esComandoPOS) {
    await bot.sendMessage(chatId, '⏳ Consultando VectorPOS...');
  } else {
    await bot.sendChatAction(chatId, 'typing');
  }

  // Renovar "escribiendo..." cada 4s (Telegram lo muestra 5s)
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4000);

  // Timeout: 3 min para comandos POS (cold-start), 95s para el resto
  const TIMEOUT_MS = esComandoPOS ? 90000 : 60000;
  const _timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('__TIMEOUT_GLOBAL__')), TIMEOUT_MS)
  );

  try {
    const respuesta = await Promise.race([
      agente.procesarMensaje(texto, esAdmin),
      _timeoutPromise,
    ]);
    clearInterval(typingInterval);

    if (respuesta && typeof respuesta === 'object' && respuesta.tipo === 'archivo') {
      await bot.sendDocument(chatId, respuesta.path, {}, {
        filename: respuesta.nombre,
        contentType: 'text/csv',
      });
      await enviarMensaje(chatId, respuesta.caption || '📎 Archivo enviado.');
      try { fs.unlinkSync(respuesta.path); } catch(e) {}
    } else if (respuesta && typeof respuesta === 'object' && respuesta.tipo === 'mensajes') {
      for (const parte of respuesta.partes) {
        await enviarMensaje(chatId, parte);
      }
    } else if (respuesta && typeof respuesta === 'object' && respuesta.tipo === 'menu_redes') {
      await bot.sendMessage(chatId, respuesta.texto, {
        parse_mode: 'Markdown',
        reply_markup: respuesta.reply_markup,
      }).catch(() => bot.sendMessage(chatId, respuesta.texto));
    } else {
      await enviarMensaje(chatId, respuesta);
    }
  } catch (error) {
    clearInterval(typingInterval);
    if (error.message === '__TIMEOUT_GLOBAL__') {
      console.error(`⏱️  Timeout ${TIMEOUT_MS/1000}s para:`, texto.substring(0, 50));
      await bot.sendMessage(chatId, '❌ VectorPOS no respondió. Intenta de nuevo en unos segundos.');
    } else {
      console.error('❌ Error mensaje:', error.message);
      await bot.sendMessage(chatId, '😅 Tuve un problema. Intenta de nuevo en un momento.');
    }
  }
});

bot.on('callback_query', async (callbackQuery) => {
  try {
    const manejado = await reportes.manejarCallbackContenido(bot, callbackQuery);
    if (!manejado) await bot.answerCallbackQuery(callbackQuery.id);
  } catch(e) {
    console.error('❌ Error callback_query:', e.message);
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
  }
});

bot.on('polling_error', (err) => {
  // Suprimir logs de 409 en modo polling local (son transitorios)
  if (err.code === 'ETELEGRAM' && err.message.includes('409')) return;
  console.error('❌ Polling error:', err.message);
});

// ──────────────────────────────────────────────
// ENVIAR MENSAJE (con fallback si falla Markdown)
// ──────────────────────────────────────────────

async function enviarMensaje(chatId, texto) {
  if (!texto) return;
  try {
    await bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
  } catch(e) {
    try {
      await bot.sendMessage(chatId, texto);
    } catch(e2) {
      console.error('Error enviando mensaje:', e2.message);
    }
  }
}

// ──────────────────────────────────────────────
// INICIO
// ──────────────────────────────────────────────

async function iniciar() {
  console.log('\n🤖 Iniciando Chu...');
  console.log('───────────────────────────────────');
  console.log(`📱 Telegram: ${USE_WEBHOOK ? 'WEBHOOK' : 'POLLING'}`);
  console.log('🧠 IA: Claude Haiku + Groq fallback');
  console.log('🗄️  DB: Supabase');
  console.log('💻 POS: VectorPOS');
  console.log(`👤 Admin ID: ${ADMIN_ID}`);
  console.log('───────────────────────────────────\n');

  if (USE_WEBHOOK) {
    // ── Servidor Express para recibir updates de Telegram ──
    const app = express();
    app.use(express.json());

    const WEBHOOK_PATH = `/webhook/${TOKEN}`;
    const WEBHOOK_URL  = `https://${RAILWAY_DOMAIN}${WEBHOOK_PATH}`;

    // Endpoint que Telegram llama con cada update
    app.post(WEBHOOK_PATH, (req, res) => {
      // Verificar secret_token enviado por Telegram en el header
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (incomingSecret !== WEBHOOK_SECRET) {
        console.warn(`⚠️  Webhook: secret inválido desde ${req.ip}`);
        return res.sendStatus(401);
      }
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });

    // Health check para Railway
    app.get('/', (req, res) => res.json({ status: 'ok', bot: 'Chu', mode: 'webhook' }));

    // API de estado para VANEGAS — datos reales del bot
    app.get('/api/status', async (req, res) => {
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        const [ventasHoy, datosPOS] = await Promise.allSettled([
          db.obtenerVentas({ desde: hoy }),
          db.obtenerDatosPOS({ desde: hoy, hasta: hoy }),
        ]);

        const ventas = ventasHoy.status === 'fulfilled' ? ventasHoy.value : [];
        const pos    = datosPOS.status === 'fulfilled' ? datosPOS.value : [];

        const totalHoy   = ventas.reduce((s, v) => s + (v.total || 0), 0);
        const ticketsHoy = ventas.length;
        const posHoy     = pos[0] || null;

        res.json({
          status: 'ok',
          bot: 'Chu (Perfumeria)',
          uptime: Math.floor(process.uptime()),
          fecha: hoy,
          ventas_bot: { total: totalHoy, tickets: ticketsHoy },
          pos: posHoy ? {
            total_dia: posHoy.total_dia,
            transacciones: posHoy.num_transacciones,
          } : null,
          meta_mensual: process.env.META_MENSUAL || null,
        });
      } catch (e) {
        console.error('❌ /api/status error:', e.message);
        res.json({ status: 'ok', bot: 'Chu (Perfumeria)', uptime: Math.floor(process.uptime()) });
      }
    });

    app.listen(PORT, async () => {
      console.log(`🌐 Servidor webhook escuchando en puerto ${PORT}`);

      // Registrar webhook en Telegram (con secret_token para seguridad)
      try {
        await bot.setWebHook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET });
        // No loguear la URL completa (contiene el token)
        console.log(`✅ Webhook registrado (token: ${TOKEN_SAFE})`);
      } catch(e) {
        console.error('❌ Error registrando webhook:', e.message);
      }

      await postIniciar();
    });
  } else {
    // Modo polling — HTTP server para Railway health check + API status
    const app = require('express')();
    app.use(require('express').json());
    app.get('/', (req, res) => res.json({ status: 'ok', bot: 'Chu', mode: 'polling' }));
    app.get('/api/status', async (req, res) => {
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        const [ventasHoy, datosPOS] = await Promise.allSettled([
          db.obtenerVentas({ desde: hoy }),
          db.obtenerDatosPOS({ desde: hoy, hasta: hoy }),
        ]);
        const ventas = ventasHoy.status === 'fulfilled' ? ventasHoy.value : [];
        const pos    = datosPOS.status === 'fulfilled' ? datosPOS.value : [];
        const posHoy = pos[0] || null;
        res.json({
          status: 'ok', bot: 'Chu (Perfumeria)',
          uptime: Math.floor(process.uptime()), fecha: hoy,
          ventas_bot: { total: ventas.reduce((s, v) => s + (v.total || 0), 0), tickets: ventas.length },
          pos: posHoy ? { total_dia: posHoy.total_dia, transacciones: posHoy.num_transacciones } : null,
          meta_mensual: process.env.META_MENSUAL || null,
        });
      } catch (e) {
        console.error('❌ /api/status error:', e.message);
        res.json({ status: 'ok', bot: 'Chu (Perfumeria)', uptime: Math.floor(process.uptime()) });
      }
    });
    app.listen(PORT, () => console.log(`HTTP activo en puerto ${PORT} (modo polling)`));
    await postIniciar();
  }
}

async function postIniciar() {
  // Conectar notificador → monitor-pos puede enviar mensajes Y fotos al admin
  monitor.setNotificador(
    texto => bot.sendMessage(ADMIN_ID, texto, { parse_mode: 'Markdown' }),
    (rutaFoto, caption) => bot.sendPhoto(ADMIN_ID, rutaFoto, { caption })
      .then(() => { try { fs.unlinkSync(rutaFoto); } catch(_) {} })
  );

  // Reportes automáticos
  reportes.iniciar(bot);

  // Registrar comandos "/"
  try {
    await bot.setMyCommands([
      { command: 'menu',         description: 'Ver menú principal' },
      { command: 'hoy',          description: 'Ventas de hoy' },
      { command: 'mes',          description: 'Ventas de este mes' },
      { command: 'mesanterior',  description: 'Ventas del mes pasado' },
      { command: 'semana',       description: 'Ventas de esta semana' },
      { command: 'general',      description: 'Reporte general completo' },
      { command: 'cajeros',      description: 'Ranking cajeros del mes' },
      { command: 'horapico',     description: 'Ventas por hora pico' },
      { command: 'caja',         description: 'Movimiento de caja del mes' },
      { command: 'productos',    description: 'Productos más vendidos del mes' },
      { command: 'inventario',   description: 'Inventario general con alertas' },
      { command: 'esencias',     description: 'Inventario esencias' },
      { command: 'envases',      description: 'Inventario envases' },
      { command: 'originales',   description: 'Inventario originales' },
      { command: 'replicas',     description: 'Inventario réplicas 1.1' },
      { command: 'restock',      description: 'Qué falta + costo de reposición' },
      { command: 'faltantes',    description: 'Faltantes por categoría' },
      { command: 'balance',      description: 'Balance crítico de inventario' },
      { command: 'gastos',        description: 'Gastos del mes' },
      { command: 'redes',         description: 'Checklist de redes sociales hoy' },
      { command: 'diagnostico',   description: '🔍 Estado y diagnóstico del sistema' },
      { command: 'reconectar',    description: '🔧 Forzar reparación de VectorPOS' },
    ]);
    console.log('✅ Comandos / registrados');
  } catch(e) {
    console.log('⚠️  Comandos no registrados:', e.message);
  }

  // Bienvenida
  try {
    await bot.sendMessage(ADMIN_ID, agente.mensajeBienvenida(), { parse_mode: 'Markdown' });
  } catch(e) {
    console.log('ℹ️  Sin mensaje de bienvenida (normal en primer inicio)');
  }

  console.log('✅ ¡Chu ACTIVO!');
}

// Exportar
module.exports = { bot, enviarMensaje, ADMIN_ID };

iniciar();

// ──────────────────────────────────────────────
// RESILIENCIA — capturar cualquier error no manejado
// ──────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err.message);
  console.error(err.stack);
  try {
    bot.sendMessage(ADMIN_ID, `⚠️ *Error interno (bot sigue activo):*\n\`${err.message.substring(0, 200)}\``, { parse_mode: 'Markdown' }).catch(() => {});
  } catch(_) {}
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('❌ unhandledRejection:', msg);
  try {
    bot.sendMessage(ADMIN_ID, `⚠️ *Promesa rechazada (bot sigue activo):*\n\`${msg.substring(0, 200)}\``, { parse_mode: 'Markdown' }).catch(() => {});
  } catch(_) {}
});

process.on('SIGTERM', async () => {
  console.log('👋 Cerrando Chu (SIGTERM)...');
  if (!USE_WEBHOOK) bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('👋 Cerrando Chu (SIGINT)...');
  if (!USE_WEBHOOK) bot.stopPolling();
  process.exit(0);
});
