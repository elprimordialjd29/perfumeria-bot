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

// ──────────────────────────────────────────────
// VALIDACIONES
// ──────────────────────────────────────────────

const errores = [];
if (!process.env.GROQ_API_KEY)     errores.push('GROQ_API_KEY');
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

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ──────────────────────────────────────────────
// INICIO
// ──────────────────────────────────────────────

async function iniciar() {
  console.log('\n🤖 Iniciando Chu...');
  console.log('───────────────────────────────────');
  console.log('📱 Interface: Telegram');
  console.log('🧠 IA: Groq / Llama 3.3 70B (GRATIS)');
  console.log('🗄️  DB: Supabase');
  console.log('💻 POS: VectorPOS');
  console.log('📧 Email: ' + (process.env.EMAIL_USER || 'no configurado'));
  console.log(`👤 Admin ID: ${ADMIN_ID}`);
  console.log('───────────────────────────────────\n');

  // Iniciar reportes automáticos
  reportes.iniciar(bot);

  // Mensaje de bienvenida al admin
  try {
    await bot.sendMessage(ADMIN_ID,
      '👋 *Hola jefe, ¿en qué te puedo ayudar?*\n\n' +
      'Elige una opción:\n\n' +
      '1️⃣ Ventas de hoy\n' +
      '2️⃣ Ventas de este mes\n' +
      '3️⃣ Ventas del mes pasado\n' +
      '4️⃣ Ventas de esta semana\n' +
      '5️⃣ Medios de pago hoy\n' +
      '6️⃣ Quién trabajó hoy\n' +
      '7️⃣ Ranking cajeros hoy\n' +
      '8️⃣ Ranking cajeros del mes\n' +
      '9️⃣ Alertas de inventario\n' +
      '0️⃣ Ventas por rango de fechas\n\n' +
      '_Escribe el número o dime lo que necesitas_ 😊',
      { parse_mode: 'Markdown' }
    );
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

  // Solo responder al administrador
  if (chatId !== ADMIN_ID) {
    // Si alguien desconocido escribe, mostrar su ID para facilitar configuración
    if (msg.text === '/start' || msg.text === '/id') {
      await bot.sendMessage(chatId, `Tu Chat ID es: \`${chatId}\`\nAgrega este número como TELEGRAM_ADMIN_ID en el .env`, { parse_mode: 'Markdown' });
    }
    return;
  }

  const texto = msg.text?.trim();
  if (!texto) return;

  console.log(`📩 [${new Date().toLocaleTimeString('es-CO')}] Chu recibió: ${texto.substring(0, 80)}`);

  // Indicador de "escribiendo..."
  await bot.sendChatAction(chatId, 'typing');

  try {
    const respuesta = await agente.procesarMensaje(texto);
    await enviarMensaje(chatId, respuesta);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await bot.sendMessage(chatId, '😅 Tuve un problema. Intenta de nuevo en un momento.');
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
