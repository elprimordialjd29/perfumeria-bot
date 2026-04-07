/**
 * index.js - Bot de WhatsApp para Perfumería
 *
 * FUNCIONES:
 *  ✅ Agente vendedor con Groq AI (GRATIS)
 *  ✅ Base de datos Supabase (nube)
 *  ✅ Monitoreo diario de VectorPOS
 *  ✅ Registro automático de ventas
 *  ✅ Ranking vendedores + progreso meta $10M
 *  ✅ Reportes automáticos WhatsApp
 *
 * USO:
 *  1. Copia .env.example → .env y configura las 3 variables
 *  2. npm start
 *  3. Escanea el QR con WhatsApp
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
if (!process.env.GROQ_API_KEY)     errores.push('GROQ_API_KEY (groq.com - gratis)');
if (!process.env.SUPABASE_URL)     errores.push('SUPABASE_URL (supabase.com - gratis)');
if (!process.env.SUPABASE_KEY)     errores.push('SUPABASE_KEY (supabase.com - gratis)');
if (!process.env.VECTORPOS_USER)   errores.push('VECTORPOS_USER (tu email de VectorPOS)');
if (!process.env.VECTORPOS_PASS)   errores.push('VECTORPOS_PASS (tu clave de VectorPOS)');

if (errores.length > 0) {
  console.error('❌ ERROR: Faltan estas variables en el archivo .env:');
  errores.forEach(e => console.error(`   - ${e}`));
  console.error('\n👉 Copia .env.example → .env y completa los valores');
  process.exit(1);
}

// Configurar número de admin desde .env automáticamente
const ADMIN_PHONE = process.env.ADMIN_PHONE || '';

// ──────────────────────────────────────────────
// INICIALIZAR CLIENTE WHATSAPP
// ──────────────────────────────────────────────

const waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: './data/.wa-session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// ──────────────────────────────────────────────
// EVENTOS DEL CLIENTE WHATSAPP
// ──────────────────────────────────────────────

waClient.on('qr', (qr) => {
  console.log('\n📱 Escanea este QR con WhatsApp (Linked Devices):\n');
  qrcode.generate(qr, { small: true });
  console.log('\n⏳ Esperando escaneo...\n');
});

waClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
});

waClient.on('ready', async () => {
  console.log('\n✅ ¡Bot de Perfumería ACTIVO!');
  console.log('───────────────────────────────────');
  console.log('🌺 Vendedor: Nico (Groq/Llama - GRATIS)');
  console.log('🗄️  Base de datos: Supabase');
  console.log('💻 POS: VectorPOS (monitoreo automático)');
  console.log('🎯 Meta: $10.000.000/mes');
  console.log('📨 Reportes: 7AM, 7PM, 8PM');
  console.log('───────────────────────────────────\n');

  // Configurar número admin desde .env si no está en BD
  if (ADMIN_PHONE) {
    const cfg = await db.obtenerConfig().catch(() => ({}));
    if (!cfg.adminNumber) {
      await db.actualizarConfig({ adminNumber: ADMIN_PHONE }).catch(() => {});
      console.log(`📱 Admin configurado: +57 ${ADMIN_PHONE}`);
    }
  }

  // Iniciar reportes automáticos
  reportes.iniciar(waClient);
});

waClient.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
});

waClient.on('disconnected', (reason) => {
  console.warn('⚠️  WhatsApp desconectado:', reason);
  console.log('🔄 Reiniciando en 5 segundos...');
  setTimeout(() => waClient.initialize(), 5000);
});

// ──────────────────────────────────────────────
// MANEJO DE MENSAJES
// ──────────────────────────────────────────────

waClient.on('message', async (msg) => {
  // Ignorar estados de WhatsApp y broadcasts
  if (msg.from === 'status@broadcast') return;
  if (msg.isStatus) return;

  // Ignorar mensajes de grupos (opcional: cambia a false para activar en grupos)
  if (msg.isGroupMsg) return;

  // Ignorar mensajes del propio bot
  if (msg.fromMe) return;

  const chatId = msg.from;
  const texto = msg.body.trim();
  const config = db.obtenerConfig();

  // ──── MENSAJES VACÍOS ────
  if (!texto) return;

  console.log(`📩 [${new Date().toLocaleTimeString('es-CO')}] ${chatId}: ${texto.substring(0, 80)}`);

  try {

    // ──── COMANDOS ESPECIALES DE ADMIN ────
    if (chatId === formatearNumeroLocal(config.adminNumber)) {
      const respuestaAdmin = await manejarComandoAdmin(msg, texto, chatId);
      if (respuestaAdmin !== null) {
        await msg.reply(respuestaAdmin);
        return;
      }
    }

    // ──── COMANDO /SETADMIN (cualquiera puede activarlo la primera vez) ────
    if (texto.toLowerCase() === '/setadmin') {
      const numeroActual = config.adminNumber;
      if (!numeroActual) {
        db.actualizarConfig({ adminNumber: chatId.replace('@c.us', '') });
        await msg.reply('✅ ¡Tu número ha sido configurado como *Administrador*!\n\nEscribe */ayuda* para ver todos los comandos disponibles.');
      } else {
        await msg.reply('⚠️ Ya hay un administrador configurado.\n\nSi eres el propietario, contacta al desarrollador para restablecerlo.');
      }
      return;
    }

    // ──── COMANDO /RESET (limpiar historial del chat) ────
    if (texto.toLowerCase() === '/reset') {
      db.limpiarHistorial(chatId);
      await msg.reply('🔄 ¡Conversación reiniciada! ¿En qué te puedo ayudar hoy?');
      return;
    }

    // ──── AGENTE VENDEDOR (respuesta normal con IA) ────
    const { texto: respuesta, venta } = await agente.procesarMensaje(chatId, texto);

    // Enviar respuesta del agente
    await msg.reply(respuesta);

    // Si se registró una venta, notificar al admin
    if (venta) {
      await notificarVentaAlAdmin(venta, chatId);
    }

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error.message);
    await msg.reply('😅 Tuve un inconveniente. Por favor escríbeme de nuevo en un momento.');
  }
});

// ──────────────────────────────────────────────
// COMANDOS ADMIN
// ──────────────────────────────────────────────

async function manejarComandoAdmin(msg, texto, chatId) {
  const cmd = texto.split(' ')[0].toLowerCase();

  const comandosAdmin = ['/ranking', '/rankingdia', '/rankingsemana', '/rankingmes', '/productos', '/ventas', '/ayuda'];

  if (comandosAdmin.includes(cmd)) {
    return await agente.respuestaAdmin(cmd);
  }

  // Agregar producto: /addproducto Chanel No 5|85000|10
  if (cmd === '/addproducto') {
    const partes = texto.substring('/addproducto '.length).split('|');
    if (partes.length < 2) {
      return '❌ Formato: /addproducto Nombre|Precio|Stock\n\nEjemplo:\n/addproducto Chanel No 5|85000|10';
    }
    db.agregarProducto({
      nombre: partes[0].trim(),
      precio: parseFloat(partes[1]),
      stock: parseInt(partes[2] || '0'),
    });
    return `✅ Producto agregado:\n*${partes[0].trim()}* - $${parseFloat(partes[1]).toLocaleString('es-CO')} (Stock: ${partes[2] || 0})`;
  }

  // Venta manual: /venta Producto|Precio|Cantidad|Vendedor
  if (cmd === '/venta') {
    const partes = texto.substring('/venta '.length).split('|');
    if (partes.length < 3) {
      return '❌ Formato: /venta Producto|Precio|Cantidad|Vendedor\n\nEjemplo:\n/venta Chanel No 5|85000|1|Maria';
    }
    const venta = db.registrarVenta({
      producto: partes[0].trim(),
      precio: parseFloat(partes[1]),
      cantidad: parseInt(partes[2] || '1'),
      vendedor: partes[3]?.trim() || 'admin',
      chat: chatId,
    });
    return `✅ Venta registrada manualmente:\n\n📦 *${venta.producto}*\n👤 Vendedor: ${venta.vendedor}\n🔢 Cantidad: ${venta.cantidad}\n💰 Total: $${venta.total.toLocaleString('es-CO')}`;
  }

  // Reporte inmediato
  if (cmd === '/reportediario') {
    await reportes.enviarReporteDiario();
    return '📊 Reporte diario enviado.';
  }

  if (cmd === '/reportesemanal') {
    await reportes.enviarReporteSemanal();
    return '📊 Reporte semanal enviado.';
  }

  // Meta mensual + VectorPOS
  if (cmd === '/meta') {
    const datos = await monitor.monitorearVentasDiarias();
    return monitor.generarMensajeMeta(datos);
  }

  if (cmd === '/pos') {
    const datos = await monitor.monitorearVentasDiarias();
    return monitor.generarMensajeMeta(datos);
  }

  return null; // No es comando admin, continuar flujo normal
}

// ──────────────────────────────────────────────
// NOTIFICAR VENTA AL ADMIN
// ──────────────────────────────────────────────

async function notificarVentaAlAdmin(venta, chatId) {
  const config = db.obtenerConfig();
  if (!config.adminNumber) return;

  const adminChatId = `${config.adminNumber.replace(/\D/g, '')}@c.us`;
  if (adminChatId === chatId) return; // No notificar si el admin mismo hizo la venta

  const mensaje = `🔔 *NUEVA VENTA REGISTRADA*\n\n`
    + `📦 Producto: *${venta.producto}*\n`
    + `🔢 Cantidad: ${venta.cantidad}\n`
    + `💰 Total: *$${venta.total.toLocaleString('es-CO')}*\n`
    + `👤 Vendedor: ${venta.vendedor}\n`
    + `⏰ ${new Date(venta.fecha).toLocaleString('es-CO')}`;

  try {
    await waClient.sendMessage(adminChatId, mensaje);
  } catch (e) {
    console.error('Error notificando al admin:', e.message);
  }
}

// ──────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────

function formatearNumeroLocal(numero) {
  if (!numero) return '';
  return `${numero.replace(/\D/g, '')}@c.us`;
}

// ──────────────────────────────────────────────
// INICIAR BOT
// ──────────────────────────────────────────────

console.log('\n🌺 Iniciando Bot de Perfumería...\n');
waClient.initialize();

// Manejo de cierre limpio
process.on('SIGINT', async () => {
  console.log('\n👋 Cerrando bot...');
  await waClient.destroy();
  process.exit(0);
});
