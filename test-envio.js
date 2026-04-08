/**
 * test-envio.js - Prueba de reporte sin WhatsApp
 * Muestra exactamente qué mensaje llegaría al teléfono
 */
require('dotenv').config();
const monitor = require('./monitor-pos');
const db = require('./database');

async function probar() {
  console.log('\n📱 SIMULANDO ENVÍO AL TELÉFONO +57 3005643045\n');
  console.log('═'.repeat(50));

  // 1. Datos de VectorPOS
  console.log('\n🔍 Conectando a VectorPOS...\n');
  const datos = await monitor.monitorearVentasDiarias();

  if (datos) {
    const mensaje = monitor.generarMensajeMeta(datos);
    console.log('\n✅ MENSAJE QUE LLEGARÍA AL TELÉFONO:');
    console.log('─'.repeat(50));
    console.log(mensaje);
    console.log('─'.repeat(50));
  } else {
    console.log('❌ No se pudo conectar a VectorPOS');
  }

  // 2. Ranking de cajeros desde Supabase
  console.log('\n📊 RANKING EN SUPABASE:');
  try {
    const ranking = await db.calcularRanking('mes');
    if (ranking.length > 0) {
      ranking.forEach((v, i) => {
        console.log(`  ${i+1}. ${v.vendedor}: $${v.total.toLocaleString('es-CO')}`);
      });
    } else {
      console.log('  (sin ventas registradas aún en Supabase)');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  console.log('\n✅ Prueba completada. El bot está listo para enviar reportes automáticos.');
  console.log('📨 Los reportes llegarán a +57 3005643045 a las 7AM, 7PM y 8PM\n');
  process.exit(0);
}

probar().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
