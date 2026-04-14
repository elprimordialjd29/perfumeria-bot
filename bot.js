/**
 * bot.js — Chu, asistente personal de ventas
 *
 * Modo: WEBHOOK cuando RAILWAY_PUBLIC_DOMAIN está definido (Railway)
 *       POLLING en local / desarrollo
 *
 * Webhook elimina el 409 Conflict porque no hay polling competitivo.
 */

require('dotenv').config();

// ── Health check HTTP — arranca PRIMERO antes de todo ──────────────────────
// Railway necesita un puerto HTTP activo o marca 502
const http = require('http');
const PORT = parseInt(process.env.PORT) || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', bot: 'Chu Perfumeria', uptime: process.uptime() }));
}).listen(PORT, () => console.log(`Health check activo en puerto ${PORT}`));

const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const agente      = require('./agente');
const reportes    = require('./reportes');
const db          = require('./database');
const fs          = require('fs');

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

// ──────────────────────────────────────────────
// CLIENTE TELEGRAM
// ──────────────────────────────────────────────

let bot;

if (USE_WEBHOOK) {
  // Modo webhook — Railway: sin polling, sin 409
  bot = new TelegramBot(TOKEN, { webHook: false });
  console.log(`🔗 Modo: WEBHOOK → https://${RAILWAY_DOMAIN}`);
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

  let texto = msg.text?.trim();
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
  };
  const cmdBase = texto.split('@')[0].toLowerCase();
  if (SLASH_MAP[cmdBase]) texto = SLASH_MAP[cmdBase];

  const nombre = msg.from?.first_name || chatId;
  console.log(`📩 [${new Date().toLocaleTimeString('es-CO')}] ${nombre}: ${texto.substring(0, 80)}`);

  await bot.sendChatAction(chatId, 'typing');

  try {
    const respuesta = await agente.procesarMensaje(texto, esAdmin);

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
    } else {
      await enviarMensaje(chatId, respuesta);
    }
  } catch (error) {
    console.error('❌ Error mensaje:', error.message);
    await bot.sendMessage(chatId, '😅 Tuve un problema. Intenta de nuevo en un momento.');
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
        res.json({ status: 'ok', bot: 'Chu (Perfumeria)', uptime: Math.floor(process.uptime()), error: e.message });
      }
    });

    app.listen(PORT, async () => {
      console.log(`🌐 Servidor webhook escuchando en puerto ${PORT}`);

      // Registrar webhook en Telegram
      try {
        await bot.setWebHook(WEBHOOK_URL);
        console.log(`✅ Webhook registrado: ${WEBHOOK_URL}`);
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
        res.json({ status: 'ok', bot: 'Chu (Perfumeria)', uptime: Math.floor(process.uptime()), error: e.message });
      }
    });
    app.listen(PORT, () => console.log(`HTTP activo en puerto ${PORT} (modo polling)`));
    await postIniciar();
  }
}

async function postIniciar() {
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
      { command: 'gastos',       description: 'Gastos del mes' },
      { command: 'redes',        description: 'Checklist de redes sociales hoy' },
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
