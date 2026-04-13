/**
 * bot.js — Chu, asistente personal de ventas
 *
 * Interface: Telegram Bot (sin QR, sin PC, 24/7)
 * IA: Groq (Llama 3.3 70B — gratis)
 * POS: VectorPOS (Puppeteer)
 * DB: Supabase
 * Email: Gmail (nodemailer)
 */

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const agente = require('./agente');
const reportes = require('./reportes');
const db = require('./database');
const fs = require('fs');

// ──────────────────────────────────────────────
// VALIDACIONES
// ──────────────────────────────────────────────

const errores = [];
if (!process.env.ANTHROPIC_API_KEY) errores.push('ANTHROPIC_API_KEY');
if (!process.env.SUPABASE_URL)     errores.push('SUPABASE_URL');
if (!process.env.SUPABASE_KEY)     errores.push('SUPABASE_KEY');
if (!process.env.VECTORPOS_USER)   errores.push('VECTORPOS_USER');
if (!process.env.VECTORPOS_PASS)   errores.push('VECTORPOS_PASS');
if (!process.env.TELEGRAM_TOKEN)   errores.push('TELEGRAM_TOKEN');
if (!process.env.TELEGRAM_ADMIN_ID) errores.push('TELEGRAM_ADMIN_ID');

if (errores.length > 0) {
  console.error('❌ Faltan variables en .env:');
  errores.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// ──────────────────────────────────────────────
// CLIENTE TELEGRAM
// ──────────────────────────────────────────────

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 10, allowed_updates: ['message', 'callback_query'] },
  },
  // Elimina updates pendientes al iniciar — evita 409 Conflict entre deploys
  onlyFirstMatch: true,
});

// Al iniciar, descartar updates antiguos para evitar conflicto con instancia anterior
bot.getUpdates({ offset: -1, timeout: 0 }).catch(() => {});

// ──────────────────────────────────────────────
// INICIO
// ──────────────────────────────────────────────

async function iniciar() {
  console.log('\n🤖 Iniciando Chu...');
  console.log('───────────────────────────────────');
  console.log('📱 Interface: Telegram');
  console.log('🧠 IA: Groq / Llama 3.3 70B');
  console.log('🗄️  DB: Supabase');
  console.log('💻 POS: VectorPOS');
  console.log('📧 Email: ' + (process.env.EMAIL_USER || 'no configurado'));
  console.log(`👤 Admin ID: ${ADMIN_ID}`);
  console.log('───────────────────────────────────\n');

  // Iniciar reportes automáticos
  reportes.iniciar(bot);

  // Registrar comandos "/" en Telegram (aparecen al escribir /)
  try {
    await bot.setMyCommands([
      { command: 'menu',           description: 'Ver menú principal' },
      { command: 'hoy',            description: 'Ventas de hoy' },
      { command: 'mes',            description: 'Ventas de este mes' },
      { command: 'mesanterior',    description: 'Ventas del mes pasado' },
      { command: 'semana',         description: 'Ventas de esta semana' },
      { command: 'general',        description: 'Reporte general completo' },
      { command: 'cajeros',        description: 'Ranking cajeros del mes' },
      { command: 'horapico',       description: 'Ventas por hora pico' },
      { command: 'caja',           description: 'Movimiento de caja del mes' },
      { command: 'productos',      description: 'Productos más vendidos del mes' },
      { command: 'inventario',     description: 'Inventario general con alertas' },
      { command: 'esencias',       description: 'Inventario esencias' },
      { command: 'envases',        description: 'Inventario envases' },
      { command: 'originales',     description: 'Inventario originales' },
      { command: 'replicas',       description: 'Inventario réplicas 1.1' },
      { command: 'restock',        description: 'Qué falta + costo de reposición' },
      { command: 'faltantes',      description: 'Faltantes por categoría (cruce ventas/inv)' },
      { command: 'balance',        description: 'Balance crítico — qué se agota pronto' },
      { command: 'gastos',         description: 'Gastos del mes' },
      { command: 'redes',          description: 'Checklist de redes sociales hoy' },
    ]);
    console.log('✅ Comandos / registrados en Telegram');
  } catch(e) {
    console.log('⚠️  No se pudieron registrar comandos:', e.message);
  }

  // Mensaje de bienvenida con menú directo
  try {
    await bot.sendMessage(ADMIN_ID, agente.mensajeBienvenida(), { parse_mode: 'Markdown' });
  } catch(e) {
    console.log('ℹ️  No se pudo enviar mensaje de bienvenida (normal en primer inicio)');
  }

  console.log('✅ ¡Chu ACTIVO en Telegram!');
}

// ──────────────────────────────────────────────
// MANEJO DE MENSAJES
// ──────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
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

  // Mapear comandos "/" a las palabras clave que el agente ya entiende
  const SLASH_MAP = {
    '/menu': 'menú', '/start': 'menú',
    '/hoy': 'hoy', '/mes': 'mes', '/mesanterior': 'mes anterior',
    '/semana': 'semana', '/general': 'reporte general',
    '/cajeros': 'cajeros', '/horapico': 'hora pico',
    '/caja': 'caja', '/productos': 'productos más vendidos',
    '/inventario': 'inventario', '/esencias': 'esencias',
    '/envases': 'envases', '/originales': 'originales',
    '/replicas': 'réplicas', '/restock': 'restock',
    '/faltantes': 'faltantes', '/balance': 'balance',
    '/gastos': 'gastos', '/redes': 'redes',
    '/analisis': 'analisis',
  };
  // Extraer comando base (ignorar @BotName si viene en grupo)
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
    console.error('❌ Error:', error.message);
    await bot.sendMessage(chatId, '😅 Tuve un problema. Intenta de nuevo en un momento.');
  }
});

// ──────────────────────────────────────────────
// BOTONES INLINE (checklist contenido)
// ──────────────────────────────────────────────

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
  console.error('❌ Error Telegram polling:', err.message);
});

// ──────────────────────────────────────────────
// ENVIAR MENSAJE (con fallback si falla Markdown)
// ──────────────────────────────────────────────

async function enviarMensaje(chatId, texto) {
  try {
    await bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
  } catch(e) {
    // Si falla el formato Markdown, enviar como texto plano
    try {
      await bot.sendMessage(chatId, texto);
    } catch(e2) {
      console.error('Error enviando mensaje:', e2.message);
    }
  }
}

// Exportar para que reportes.js pueda enviar mensajes
module.exports = { bot, enviarMensaje, ADMIN_ID };

// ──────────────────────────────────────────────
// ARRANCAR
// ──────────────────────────────────────────────

iniciar();

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando Chu...');
  bot.stopPolling();
  process.exit(0);
});
