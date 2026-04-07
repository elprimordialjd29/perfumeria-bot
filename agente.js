/**
 * agente.js - Vendedor virtual con Groq AI (GRATIS)
 * Modelo: llama-3.3-70b-versatile
 * Gratis: hasta 14,400 requests/día en groq.com
 */

const Groq = require('groq-sdk');
const db = require('./database');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ──────────────────────────────────────────────
// SISTEMA PROMPT DEL VENDEDOR
// ──────────────────────────────────────────────

function buildSystemPrompt() {
  const config = db.obtenerConfig();
  const productos = db.obtenerProductos();

  const catalogoTexto = productos.length > 0
    ? productos.map(p => `- ${p.nombre}: $${p.precio.toLocaleString('es-CO')} (stock: ${p.stock})`).join('\n')
    : '(catálogo vacío, el admin debe agregar productos con /addproducto)';

  return `Eres un vendedor virtual experto de ${config.negocio || 'una perfumería de alta calidad'}.
Tu nombre es "Nico" y hablas en español, de manera amigable, profesional y persuasiva.

🌺 CATÁLOGO ACTUAL:
${catalogoTexto}

📋 TUS RESPONSABILIDADES:
1. Atender consultas sobre productos, precios y disponibilidad
2. Recomendar perfumes según el gusto del cliente (florales, orientales, cítricos, amaderados)
3. Informar sobre promociones y combos
4. Cuando un cliente quiera COMPRAR, confirmar la venta con el formato especial
5. Ser empático, entusiasta y crear deseo de compra

🛒 CUANDO SE CONFIRME UNA VENTA:
Cuando el cliente confirme que quiere comprar, incluye este bloque EXACTO al final:
[VENTA: producto="NOMBRE_PRODUCTO" precio=PRECIO cantidad=CANTIDAD vendedor="bot"]

Ejemplo real:
[VENTA: producto="Chanel No 5" precio=85000 cantidad=1 vendedor="bot"]

💡 TÉCNICAS DE VENTA:
- Pregunta siempre qué tipo de fragancia prefieren
- Menciona notas aromáticas (vainilla, jazmín, madera de cedro, etc.)
- Sugiere combos (perfume + crema corporal)
- Crea urgencia cuando haya pocas unidades ("solo quedan 2")
- Personaliza: "¿Es para ti o de regalo?"

⚠️ REGLAS:
- Nunca inventes productos o precios que no estén en el catálogo
- Si no tienes el producto, ofrece alternativas similares
- Siempre responde en español
- Si te preguntan algo ajeno a perfumería, redirecciona amablemente`;
}

// ──────────────────────────────────────────────
// PROCESAR MENSAJE CON GROQ (GRATIS)
// ──────────────────────────────────────────────

async function procesarMensaje(chatId, mensajeUsuario, vendedor = 'bot') {
  try {
    db.guardarMensaje(chatId, 'user', mensajeUsuario);
    const historial = db.obtenerHistorial(chatId);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',   // Modelo gratis y muy capaz
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        ...historial,
      ],
      max_tokens: 800,
      temperature: 0.7,
    });

    const respuesta = completion.choices[0]?.message?.content || '¿Puedes repetir tu pregunta?';

    db.guardarMensaje(chatId, 'assistant', respuesta);

    const ventaDetectada = extraerVenta(respuesta, vendedor, chatId);

    return {
      texto: limpiarRespuesta(respuesta),
      venta: ventaDetectada,
    };
  } catch (error) {
    console.error('Error en Groq:', error.message);
    return {
      texto: '😅 Disculpa, tuve un pequeño problema. ¿Puedes repetir tu mensaje?',
      venta: null,
    };
  }
}

// ──────────────────────────────────────────────
// EXTRAER VENTA DEL MENSAJE
// ──────────────────────────────────────────────

function extraerVenta(texto, vendedor, chatId) {
  const regex = /\[VENTA:\s*producto="([^"]+)"\s+precio=([\d.]+)\s+cantidad=(\d+)\s+vendedor="([^"]+)"\]/i;
  const match = texto.match(regex);
  if (!match) return null;

  try {
    const venta = db.registrarVenta({
      vendedor: match[4] === 'bot' ? vendedor : match[4],
      producto: match[1],
      precio: parseFloat(match[2]),
      cantidad: parseInt(match[3]),
      chat: chatId,
    });
    console.log(`✅ Venta registrada: ${venta.producto} x${venta.cantidad} = $${venta.total}`);
    return venta;
  } catch (e) {
    console.error('Error registrando venta:', e.message);
    return null;
  }
}

function limpiarRespuesta(texto) {
  return texto.replace(/\[VENTA:[^\]]*\]/gi, '').trim();
}

// ──────────────────────────────────────────────
// COMANDOS ADMIN
// ──────────────────────────────────────────────

async function respuestaAdmin(comando) {
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
  const finDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).toISOString();
  const inicioSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();

  switch (comando) {
    case '/ranking':
    case '/rankingdia': {
      const ventas = db.obtenerVentas({ desde: inicioDia, hasta: finDia });
      return formatearRankingVendedores(ventas, 'hoy');
    }
    case '/rankingsemana': {
      const ventas = db.obtenerVentas({ desde: inicioSemana });
      return formatearRankingVendedores(ventas, 'esta semana');
    }
    case '/rankingmes': {
      const ventas = db.obtenerVentas({ desde: inicioMes });
      return formatearRankingVendedores(ventas, 'este mes');
    }
    case '/productos': {
      const ventas = db.obtenerVentas({ desde: inicioMes });
      return formatearRankingProductos(ventas);
    }
    case '/ventas': {
      const ventas = db.obtenerVentas({ desde: inicioDia, hasta: finDia });
      return formatearListaVentas(ventas);
    }
    default:
      return `🤖 *Comandos disponibles:*

📊 *Ranking Vendedores:*
/ranking - Ranking del día
/rankingsemana - Ranking de la semana
/rankingmes - Ranking del mes

🛍️ *Productos:*
/productos - Ranking de productos del mes

💰 *Ventas:*
/ventas - Ventas de hoy
/venta Prod|Precio|Cant|Vendedor - Registrar venta manual

⚙️ *Gestión:*
/addproducto Nombre|Precio|Stock - Agregar producto
/reportediario - Enviar reporte ahora
/reportesemanal - Enviar reporte semanal ahora

📨 *Reportes automáticos:*
• Diario: 8:00 PM todos los días
• Semanal: lunes 8:00 AM`;
  }
}

// ──────────────────────────────────────────────
// FORMATEADORES
// ──────────────────────────────────────────────

function formatearRankingVendedores(ventas, periodo) {
  if (ventas.length === 0) return `📊 No hay ventas registradas ${periodo}.`;

  const ranking = db.calcularRanking(ventas);
  const total = ventas.reduce((s, v) => s + v.total, 0);
  const medallas = ['🥇', '🥈', '🥉'];

  const filas = ranking.map((r, i) =>
    `${medallas[i] || `${i + 1}.`} *${r.vendedor}*\n   💰 $${r.totalMonto.toLocaleString('es-CO')} | ${r.totalVentas} venta(s)`
  ).join('\n\n');

  return `🏆 *RANKING DE VENDEDORES - ${periodo.toUpperCase()}*\n\n${filas}\n\n─────────────────\n💵 *Total: $${total.toLocaleString('es-CO')}*`;
}

function formatearRankingProductos(ventas) {
  if (ventas.length === 0) return '🛍️ No hay productos vendidos este mes.';

  const ranking = db.calcularRankingProductos(ventas);
  const filas = ranking.slice(0, 10).map((p, i) =>
    `${i + 1}. *${p.producto}*\n   📦 ${p.totalVendido} unid. | 💰 $${p.totalMonto.toLocaleString('es-CO')}`
  ).join('\n\n');

  return `🛍️ *TOP PRODUCTOS DEL MES*\n\n${filas}`;
}

function formatearListaVentas(ventas) {
  if (ventas.length === 0) return '📋 No hay ventas registradas hoy.';

  const total = ventas.reduce((s, v) => s + v.total, 0);
  const filas = ventas.slice(-15).map(v => {
    const hora = new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return `• ${hora} | ${v.vendedor} → ${v.producto} x${v.cantidad} = $${v.total.toLocaleString('es-CO')}`;
  }).join('\n');

  return `📋 *VENTAS DE HOY*\n\n${filas}\n\n─────────────────\n💵 *Total: $${total.toLocaleString('es-CO')}*`;
}

module.exports = {
  procesarMensaje,
  respuestaAdmin,
  formatearRankingVendedores,
  formatearRankingProductos,
  formatearListaVentas,
};
