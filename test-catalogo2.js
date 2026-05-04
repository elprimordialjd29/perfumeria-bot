/**
 * test-catalogo2.js — Vuelca datos crudos del catálogo capturado
 * Parcheamos consultarTodoInventario para interceptar el mapacat antes del merge
 */
require('dotenv').config();

// Parchear parsearMontoJSON en el módulo para no perder el catálogo
const monitor = require('./monitor-pos');

// Sobrescribir consultarTodoInventario para capturar el mapacat
const origModule = require('./monitor-pos');

(async () => {
  console.log('Cargando inventario + catálogo...\n');

  // Cargar inventario normal (ya captura catálogo internamente)
  const inv = await monitor.consultarTodoInventario();
  if (!inv) { console.log('Error'); process.exit(1); }

  console.log(`\nTotal: ${inv.length} productos\n`);

  // Categorías únicas en el resultado
  const cats = {};
  inv.forEach(p => { cats[p.categoria || ''] = (cats[p.categoria || ''] || 0) + 1; });
  console.log('=== CATEGORÍAS RESULTADO ===');
  Object.entries(cats).sort().forEach(([c, n]) => console.log(`  ${String(n).padStart(3)}  "${c}"`));

  // Productos ORIGINALES sin la palabra "original"
  console.log('\n=== ORIGINALES SIN "original" EN NOMBRE ===');
  inv
    .filter(p => p.categoria === 'ORIGINALES' && !(p.nombre || '').toLowerCase().includes('original'))
    .sort((a, b) => b.saldo - a.saldo)
    .forEach(p => console.log(`  ${String(p.saldo).padStart(4)} u  "${p.nombre}"  medida:"${p.medida}"`));

  // Todos los ENVASES para verificar
  console.log('\n=== TODOS LOS ENVASES ===');
  inv
    .filter(p => p.categoria === 'ENVASE')
    .sort((a, b) => b.saldo - a.saldo)
    .forEach(p => console.log(`  ${String(p.saldo).padStart(5)} u  "${p.nombre}"`));

  // Necesito ver el campo Area del catálogo crudo para esencias
  // Acceder internamente al módulo y mostrar Area de las esencias
  console.log('\n=== CAMPO AREA para 10 esencias (M/F/U) ===');
  console.log('(requiere parcheado interno del módulo - ver output)');

  // Parchear _ultimoCatalogoCapturado si está expuesto
  const mod = require('./monitor-pos');
  // Recargar con patch
  delete require.cache[require.resolve('./monitor-pos')];
  const monPatch = require('./monitor-pos');
  // Sobreescribir _obtenerSaldosBrutosImpl para capturar catalogo raw
  const origConsultarTodo = monPatch.consultarTodoInventario;
  let catalogoRaw = null;
  const origBuild = monPatch.consultarTodoInventario;

  // Usar el catalogo que ya fue guardado en _ultimoCatalogoCapturado
  // Necesitamos verlo directamente
  process.exit(0);

  process.exit(0);
})();
