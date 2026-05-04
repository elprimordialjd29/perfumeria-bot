/**
 * test-inventario.js — Prueba directa del inventario completo
 * Llama a consultarTodoInventario() y muestra los productos por categoría
 */
require('dotenv').config();
const monitor = require('./monitor-pos');

async function probar() {
  console.log('\n📦 PRUEBA DE INVENTARIO COMPLETO');
  console.log('═'.repeat(50));
  console.log('Iniciando consulta... (puede tomar hasta 60s)\n');

  const inicio = Date.now();

  // Notificador para ver screenshots en consola
  monitor.setNotificador(
    txt => console.log('\n[NOTIF]', txt),
    (ruta, caption) => console.log(`[FOTO] ${caption} → ${ruta}`)
  );

  try {
    const productos = await monitor.consultarTodoInventario();
    const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);

    if (!productos || productos.length === 0) {
      console.log(`\n❌ Sin productos (${elapsed}s)`);
      const diag = monitor.obtenerDiagInventario ? monitor.obtenerDiagInventario() : null;
      if (diag) console.log('\nDIAGNÓSTICO:\n', diag);
      process.exit(1);
    }

    console.log(`\n✅ ${productos.length} productos en ${elapsed}s\n`);

    // Agrupar por categoría
    const porCat = {};
    for (const p of productos) {
      const cat = p.categoria || 'SIN CATEGORÍA';
      if (!porCat[cat]) porCat[cat] = [];
      porCat[cat].push(p);
    }

    // Mostrar resumen por categoría
    console.log('── RESUMEN POR CATEGORÍA ──');
    for (const [cat, items] of Object.entries(porCat).sort()) {
      console.log(`\n📂 ${cat} (${items.length} productos)`);
      items.slice(0, 5).forEach(p => {
        console.log(`   • ${p.nombre.substring(0, 45).padEnd(45)} | saldo: ${String(p.saldo).padStart(6)} ${p.medida || ''}`);
      });
      if (items.length > 5) console.log(`   ... y ${items.length - 5} más`);
    }

    // Mostrar alertas
    console.log('\n── ALERTAS ──');
    const alertas = productos.filter(p => p.saldo <= 0 || p.saldo < 10);
    if (alertas.length === 0) {
      console.log('✅ Sin alertas críticas');
    } else {
      alertas.slice(0, 15).forEach(p => {
        const nivel = p.saldo <= 0 ? '🚨' : '🔴';
        console.log(`${nivel} ${p.nombre.substring(0, 40)} | ${p.saldo} ${p.medida || ''} | ${p.categoria}`);
      });
    }

    // Primeros 3 productos raw para ver campos
    console.log('\n── CAMPOS RAW (primer producto) ──');
    if (productos[0]) console.log(JSON.stringify(productos[0], null, 2));

    // Debug: qué categorías únicas hay en el resultado
    const catUnicas = [...new Set(productos.map(p => p.categoria))].sort();
    console.log('\n── CATEGORÍAS ÚNICAS ──');
    catUnicas.forEach(c => {
      const count = productos.filter(p => p.categoria === c).length;
      console.log(`  "${c}": ${count} productos`);
    });

  } catch(e) {
    console.error('\n❌ Error:', e.message);
    console.error(e.stack);
  }

  process.exit(0);
}

probar();
