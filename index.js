/**
 * index.js — Chu, asistente personal de ventas
 *
 * Solo responde al número del administrador.
 * Entiende lenguaje natural en español.
 * Conecta con VectorPOS y Supabase en tiempo real.
 */

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const db = require('./database');
const agente = require('./agente');
const reportes = require('./reportes');
const monitor = require('./monitor-pos');

// ──────────────────────────────────────────────
// VALIDACIONES INICIALES
// ──────────────────────────────────────────────

const errores = [];
if (!process.env.GROQ_API_KEY)   errores.push('GROQ_API_KEY');
if (!process.env.SUPABASE_URL)   errores.push('SUPABASE_URL');
if (!process.env.SUPABASE_KEY)   errores.push('SUPABASE_KEY');
if (!process.env.VECTORPOS_USER) errores.push('VECTORPOS_USER');
if (!process.env.VECTORPOS_PASS) errores.push('VECTORPOS_PASS');
if (!process.env.ADMIN_PHONE)    errores.push('ADMIN_PHONE');

if (errores.length > 0) {
  console.error('❌ Faltan estas variables en .env:');
  errores.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

const ADMIN_ID = `${process.env.ADMIN_PHONE.replace(/\D/g, '')}@c.us`;

// ──────────────────────────────────────────────
// CLIENTE WHATSAPP
// ──────────────────────────────────────────────

const waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: './data/.wa-session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// ──────────────────────────────────────────────
// EVENTOS
// ──────────────────────────────────────────────

waClient.on('qr', (qr) => {
  console.log('\n📱 Escanea este QR con WhatsApp (Linked Devices):\n');
  qrcode.generate(qr, { small: true });
  console.log('\n⏳ Esperando escaneo...\n');
});

waClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado');
});

waClient.on('ready', async () => {
  console.log('\n✅ ¡Chu está ACTIVO!');
  console.log('───────────────────────────────────');
  console.log('🤖 Asistente: Chu (Groq/Llama — GRATIS)');
  console.log('🗄️  Base de datos: Supabase');
  console.log('💻 POS: VectorPOS (monitoreo automático)');
  console.log('🎯 Meta: $' + Number(process.env.META_MENSUAL || 10000000).toLocaleString('es-CO') + '/mes');
  console.log('📨 Reportes: 7AM, 7PM, 8PM');
  console.log(`📱 Admin: +57 ${process.env.ADMIN_PHONE}`);
  console.log('───────────────────────────────────\n');

  // Guardar admin en Supabase si no está
  try {
    const cfg = await db.obtenerConfig();
    if (!cfg.adminNumber) {
      await db.actualizarConfig({ adminNumber: process.env.ADMIN_PHONE });
    }
  } catch(e) {}

  // Iniciar reportes automáticos
  reportes.iniciar(waClient);

  // Mensaje de bienvenida al admin
  try {
    await waClient.sendMessage(ADMIN_ID,
      '🤖 *¡Hola! Soy Chu, tu asistente de ventas.*\n\nEstoy listo para ayudarte. Escríbeme lo que necesitas:\n• "dame el reporte"\n• "cómo vamos con la meta"\n• "ranking del mes"\n• "ayuda" para ver todo lo que puedo hacer'
    );
  } catch(e) {}
});

waClient.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
});

waClient.on('disconnected', (reason) => {
  console.warn('⚠️  WhatsApp desconectado:', reason);
  console.log('🔄 Reconectando en 5 segundos...');
  setTimeout(() => waClient.initialize(), 5000);
});

// ──────────────────────────────────────────────
// MANEJO DE MENSAJES
// ──────────────────────────────────────────────

waClient.on('message', async (msg) => {
  // Filtros: solo mensajes directos reales
  if (msg.from === 'status@broadcast') return;
  if (msg.isStatus) return;
  if (msg.isGroupMsg) return;
  if (msg.fromMe) return;

  // Solo responder al administrador
  if (msg.from !== ADMIN_ID) return;

  const texto = msg.body?.trim();
  if (!texto) return;

  console.log(`📩 [${new Date().toLocaleTimeString('es-CO')}] Chu recibió: ${texto.substring(0, 80)}`);

  try {
    const respuesta = await agente.procesarMensaje(texto);
    await msg.reply(respuesta);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await msg.reply('😅 Tuve un problema. Intenta de nuevo en un momento.');
  }
});

// ──────────────────────────────────────────────
// INICIAR
// ──────────────────────────────────────────────

console.log('\n🤖 Iniciando Chu...\n');
waClient.initialize();

process.on('SIGINT', async () => {
  console.log('\n👋 Cerrando Chu...');
  await waClient.destroy();
  process.exit(0);
});
