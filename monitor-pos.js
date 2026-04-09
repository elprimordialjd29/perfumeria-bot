/**
 * monitor-pos.js - Monitor de VectorPOS con Puppeteer
 *
 * Extrae ventas diarias, acumulado del mes y ranking por cajero.
 * Usa Puppeteer (navegador real) porque el login de VectorPOS
 * requiere JavaScript del cliente.
 */

const puppeteer = require('puppeteer');
const db = require('./database');

const BASE = 'https://pos.vectorpos.com.co';
const ID_SYA = process.env.VECTORPOS_ID || 'A21431100100001';
const META_MENSUAL = parseInt(process.env.META_MENSUAL) || 10000000;

// ──────────────────────────────────────────────
// FORMATO DE FECHAS
// ──────────────────────────────────────────────

function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

function fechaInicioMes() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Convierte "1.553.000" (formato colombiano) → 1553000 */
function parsearMonto(str) {
  if (!str || str.trim() === '' || str.trim() === '-') return 0;
  const limpio = str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const num = parseFloat(limpio);
  return isNaN(num) ? 0 : num;
}

/**
 * Parsea valores numéricos que vienen del JSON de VectorPOS.
 * Pueden ser number (8277.79) o string en formato colombiano ("8.277,79").
 * NO elimina el punto si es el separador decimal estándar.
 */
function parsearMontoJSON(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s || s === '-') return 0;
  // Formato colombiano: tiene coma como decimal → "8.277,79"
  if (s.includes(',')) return parsearMonto(s);
  // Formato estándar con punto decimal → "8277.79" o "82777.916"
  const num = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

// ──────────────────────────────────────────────
// LOGIN CON PUPPETEER
// ──────────────────────────────────────────────

async function crearSesionPOS() {
  return await crearBrowserLogueado();
}

async function crearBrowserLogueado() {
  const user = process.env.VECTORPOS_USER;
  const pass = process.env.VECTORPOS_PASS;

  if (!user || !pass) {
    throw new Error('Faltan VECTORPOS_USER y VECTORPOS_PASS en el .env');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto(BASE + '/index.php?r=site/login', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    await page.type('#txtUser', user, { delay: 40 });
    await page.type('#txtPw', pass, { delay: 40 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }),
      page.click('input[type="submit"]'),
    ]);

    if (page.url().includes('login')) {
      await browser.close();
      throw new Error('Credenciales inválidas de VectorPOS');
    }

    return { browser, page };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

// ──────────────────────────────────────────────
// EXTRAER VENTAS GENERALES (por día)
// ──────────────────────────────────────────────

async function extraerVentasGenerales(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=ventas%2Fgeneral&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}&tipo=dia`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    const tabla = document.querySelector('table');
    if (!tabla) return rows;
    tabla.querySelectorAll('tr').forEach(row => {
      const cells = [...row.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      rows.push(cells);
    });
    return rows;
  });

  const datos = [];
  let cabeceras = [];

  for (const fila of filas) {
    if (fila[0] === 'Dia' || fila[0] === 'Día') {
      cabeceras = fila;
      continue;
    }
    if (!fila[0] || !fila[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    datos.push({
      fecha: fila[0],
      totalVentas: parsearMonto(fila[1]),
      tickets: parseInt(fila[7]) || 0,
      efectivo: parsearMonto(fila[9]),
      bancolombia: parsearMonto(fila[11]),
      nequi: parsearMonto(fila[12]),
    });
  }

  return datos;
}

// ──────────────────────────────────────────────
// EXTRAER VENTAS POR CAJERO
// ──────────────────────────────────────────────

async function extraerVentasCajero(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=ventas%2Fcajero&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    const tabla = document.querySelector('table');
    if (!tabla) return rows;
    tabla.querySelectorAll('tr').forEach(row => {
      const cells = [...row.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      rows.push(cells);
    });
    return rows;
  });

  // Detectar índices de columnas desde la fila de cabecera
  let colCajero   = 0;
  let colTickets  = 2;
  let colEfectivo = 3;
  let colBanc     = 4;
  let colNequi    = 5;
  let colTotal    = -1; // -1 = usar última columna

  for (const fila of filas) {
    if (fila[0] === 'Cajero' || fila[0] === 'cajero') {
      const h = fila.map(c => c.toLowerCase());
      const iTickets  = h.findIndex(c => c.includes('ticket') || c.includes('trans') || c.includes('fact'));
      const iEfectivo = h.findIndex(c => c.includes('efectivo'));
      const iBanc     = h.findIndex(c => c.includes('banc') || c.includes('colombia'));
      const iNequi    = h.findIndex(c => c.includes('nequi'));
      const iTotal    = h.lastIndexOf('total');  // la ÚLTIMA columna "Total"
      if (iTickets  > 0) colTickets  = iTickets;
      if (iEfectivo > 0) colEfectivo = iEfectivo;
      if (iBanc     > 0) colBanc     = iBanc;
      if (iNequi    > 0) colNequi    = iNequi;
      colTotal = iTotal > 0 ? iTotal : fila.length - 1;
      break;
    }
  }

  // Si no se detectó la cabecera, usar la última columna como total
  const usarUltimaCol = colTotal < 0;

  const cajeros = [];
  for (const fila of filas) {
    if (!fila[0] || fila[0] === 'Cajero' || fila[0] === 'cajero' || fila[0] === 'Total') continue;
    const iTotal = usarUltimaCol ? fila.length - 1 : colTotal;

    cajeros.push({
      cajero:      fila[colCajero] || '',
      tickets:     parseInt(fila[colTickets]) || 0,
      efectivo:    parsearMonto(fila[colEfectivo]),
      bancolombia: parsearMonto(fila[colBanc]),
      nequi:       parsearMonto(fila[colNequi]),
      total:       parsearMonto(fila[iTotal]),
    });
  }

  // Agrupar por cajero (puede haber múltiples filas por cajero)
  const porCajero = {};
  for (const c of cajeros) {
    if (!c.cajero) continue;
    if (!porCajero[c.cajero]) {
      porCajero[c.cajero] = { cajero: c.cajero, tickets: 0, efectivo: 0, bancolombia: 0, nequi: 0, total: 0 };
    }
    porCajero[c.cajero].tickets     += c.tickets;
    porCajero[c.cajero].efectivo    += c.efectivo;
    porCajero[c.cajero].bancolombia += c.bancolombia;
    porCajero[c.cajero].nequi       += c.nequi;
    porCajero[c.cajero].total       += c.total;
  }

  // Fallback: si todos los totales son 0 pero hay tickets, recalcular total
  // sumando los medios de pago conocidos
  const agrupados = Object.values(porCajero);
  for (const c of agrupados) {
    if (c.total === 0 && (c.efectivo + c.bancolombia + c.nequi) > 0) {
      c.total = c.efectivo + c.bancolombia + c.nequi;
    }
  }

  return agrupados.sort((a, b) => b.total - a.total);
}

// ──────────────────────────────────────────────
// MONITOREO PRINCIPAL
// ──────────────────────────────────────────────

async function monitorearVentasDiarias() {
  console.log('\n🔍 Iniciando monitoreo VectorPOS...');
  const hoy = fechaHoy();
  const inicioMes = fechaInicioMes();

  let browser = null;
  try {
    const { browser: b, page } = await crearBrowserLogueado();
    browser = b;

    // Datos de hoy — usamos cajeros como fuente principal (ventas/general
    // puede retornar vacío para rangos cortos por formato de fecha en VectorPOS)
    const cajerosHoy = await extraerVentasCajero(page, hoy, hoy);
    const totalHoy   = cajerosHoy.reduce((s, c) => s + c.total,   0);
    const ticketsHoy = cajerosHoy.reduce((s, c) => s + c.tickets, 0);
    console.log(`✅ Hoy: $${totalHoy.toLocaleString('es-CO')} | ${ticketsHoy} tickets`);

    // Guardar en Supabase
    if (totalHoy > 0) {
      await db.guardarDatosPOS({
        fecha: hoy,
        total_dia: totalHoy,
        num_transacciones: ticketsHoy,
        raw_data: { cajerosHoy },
      });
    }

    // Acumulado del mes
    const ventasMes = await extraerVentasGenerales(page, inicioMes, hoy);
    const totalMes = ventasMes.reduce((s, v) => s + v.totalVentas, 0);
    console.log(`📅 Mes acumulado: $${totalMes.toLocaleString('es-CO')}`);

    // Cajeros del mes
    const cajerosMes = await extraerVentasCajero(page, inicioMes, hoy);
    console.log(`👥 Cajeros: ${cajerosMes.length} encontrados`);

    await browser.close();
    browser = null;

    return {
      hoy: { fecha: hoy, total: totalHoy, tickets: ticketsHoy },
      totalMes,
      cajerosMes,
      meta: META_MENSUAL,
      porcentajeMeta: Math.min(100, ((totalMes / META_MENSUAL) * 100)).toFixed(1),
      faltan: Math.max(0, META_MENSUAL - totalMes),
      diasTranscurridos: new Date().getDate(),
      diasRestantes: calcularDiasRestantes(),
      promedioNecesario: calcularPromedioNecesario(totalMes),
      promedioAlcanzado: totalMes / new Date().getDate(),
    };

  } catch (e) {
    console.error('❌ Error en monitoreo VectorPOS:', e.message);
    if (browser) await browser.close();
    return null;
  }
}

// ──────────────────────────────────────────────
// GENERAR MENSAJE WHATSAPP
// ──────────────────────────────────────────────

function generarMensajeMeta(datos) {
  if (!datos) {
    return '⚠️ No se pudo conectar a VectorPOS. Verifica las credenciales en el .env';
  }

  const { hoy, totalMes, cajerosMes, meta, porcentajeMeta, faltan, diasTranscurridos, diasRestantes, promedioNecesario, promedioAlcanzado } = datos;

  // Barra de progreso
  const pct = Math.round(parseFloat(porcentajeMeta));
  const barraLlena = Math.round(pct / 10);
  const barra = '🟢'.repeat(barraLlena) + '⚪'.repeat(10 - barraLlena);

  let emoji = pct >= 80 ? '🟢' : pct >= 50 ? '🟡' : pct >= 25 ? '🟠' : '🔴';

  // Ranking cajeros
  const medallas = ['🥇', '🥈', '🥉'];
  const rankingCajeros = cajerosMes.map((c, i) => {
    const m = medallas[i] || `${i + 1}.`;
    const pctMes = totalMes > 0 ? ((c.total / totalMes) * 100).toFixed(0) : 0;
    return `${m} *${c.cajero}*\n   💰 $${c.total.toLocaleString('es-CO')} (${pctMes}%) | 🎫 ${c.tickets} tickets`;
  }).join('\n\n');

  return `${emoji} *VENTAS VECTORPOS - ${hoy.fecha}*

💵 *Hoy:* $${hoy.total.toLocaleString('es-CO')} (${hoy.tickets} tickets)

📊 *Mes (${diasTranscurridos} días):*
${barra} ${porcentajeMeta}%
💰 $${totalMes.toLocaleString('es-CO')} / $${meta.toLocaleString('es-CO')}
📉 Promedio/día: $${Math.round(promedioAlcanzado).toLocaleString('es-CO')}
🎯 Meta/día necesaria: $${Math.round(promedioNecesario).toLocaleString('es-CO')}
⏳ Faltan: $${faltan.toLocaleString('es-CO')} en ${diasRestantes} días

👥 *RANKING CAJEROS DEL MES:*
${rankingCajeros || '(sin datos)'}

─────────────────
🤖 _VectorPOS Bot_`;
}

// ──────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────

function calcularDiasRestantes() {
  const hoy = new Date();
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return Math.max(1, ultimoDia - hoy.getDate());
}

function calcularPromedioNecesario(totalActual) {
  const restantes = calcularDiasRestantes();
  return Math.max(0, (META_MENSUAL - totalActual) / restantes);
}

// ──────────────────────────────────────────────
// VENTAS POR PRODUCTO (participación)
// ──────────────────────────────────────────────

async function extraerVentasProducto(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=ventas%2FproductoParticipacion&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  });

  const productos = [];
  for (const fila of filas) {
    if (!fila[0] || fila[0] === 'Nombre') continue;
    const cantidad = parseInt(fila[1]?.replace(/\./g,'')) || 0;
    const valor = parsearMonto(fila[2]);
    if (cantidad === 0 && valor === 0) continue;
    productos.push({
      nombre: fila[0],
      cantidad,
      valor,
      pctCantidad: fila[6] || '0%',
      pctValor: fila[7] || '0%',
    });
  }

  return productos.sort((a, b) => b.valor - a.valor);
}

// ──────────────────────────────────────────────
// ALERTAS DE INVENTARIO
// ──────────────────────────────────────────────

const APP_BASE = 'https://app.vectorpos.com.co';

// ── Umbrales de alerta por categoría ──
// ESENCIAS (M/F/U) → ideal 500g, crítico ≤50g
// REPLICA 1.1 / ORIGINALES → se venden por unidad; solo alertar si saldo = 0
// ENVASE → ideal >50 u, crítico <10 u
// INSUMOS VARIOS (alcohol) → alerta < 500, SIN restock
// CREMA CORPORAL → alerta < 10
const UMBRALES = {
  'ESENCIAS M':      { alerta: 500, critico: 50, medida: 'gr', restock: true  },
  'ESENCIAS F':      { alerta: 500, critico: 50, medida: 'gr', restock: true  },
  'ESENCIAS U':      { alerta: 500, critico: 50, medida: 'gr', restock: true  },
  'REPLICA 1.1':     { alerta: 1,   critico: 1,  medida: 'u',  restock: true  },
  'ORIGINALES':      { alerta: 1,   critico: 1,  medida: 'u',  restock: true  },
  'ENVASE':          { alerta: 50,  critico: 10, medida: 'u',  restock: true  },
  'INSUMOS VARIOS':  { alerta: 500, critico: 100, medida: 'u', restock: false },
  'CREMA CORPORAL':  { alerta: 10,  critico: 3,  medida: 'u',  restock: true  },
};
const LIMITE_GRAMOS   = 500; // default gramos
const LIMITE_UNIDADES = 15;  // default unidades

/** Formatea un monto en pesos colombianos (enteros, sin decimales) */
function formatPesos(val) {
  return Math.round(val).toLocaleString('es-CO');
}

/**
 * Función base: hace login en app.vectorpos.com.co y retorna
 * el array crudo de productos del kardex/saldos.
 * Reutilizada por consultarAlertasInventario y consultarTodoInventario.
 */
async function _obtenerSaldosBrutos() {
  const user = process.env.VECTORPOS_USER;
  const pass = process.env.VECTORPOS_PASS;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    let saldosData = null;
    let productosData = null;
    page.on('response', async res => {
      const url = res.url();
      if (url.includes('kardex/saldos')) {
        try { saldosData = JSON.parse(await res.text()); } catch(e) {}
      }
      // Capturar catálogo de productos (endpoint con nombre, categoría, costo)
      if (url.includes('producto') && url.includes('lista') || url.includes('catalogo') || url.includes('inventario/producto')) {
        try { const d = JSON.parse(await res.text()); if (d?.datos || Array.isArray(d)) productosData = d?.datos || d; } catch(e) {}
      }
    });

    await page.goto(`${APP_BASE}/?r=site/login`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.type('#txtEmail', user, { delay: 30 });
    await page.type('#txtClave', pass, { delay: 30 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }),
      page.click('#btnEntrar'),
    ]);

    if (page.url().includes('cambioSucursal')) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }),
        page.click('a,button'),
      ]);
    }

    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === 'Consultar Saldos');
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    await page.evaluate(() => {
      const btn = document.querySelector('#btnCargar');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 5000));

    await browser.close();
    browser = null;

    const saldos = saldosData?.datos?.length ? saldosData.datos : [];
    // Loguear campos disponibles para diagnóstico
    if (saldos[0]) console.log('📋 Campos saldo:', Object.keys(saldos[0]).join(', '));
    return saldos;
  } catch (e) {
    console.error('❌ Error obteniendo saldos inventario:', e.message);
    if (browser) await browser.close();
    return null;
  }
}

/**
 * Obtiene el catálogo completo de productos (Nombre, Categoría, Costo)
 * desde app.vectorpos.com.co navegando al módulo de inventario/productos.
 */
async function _obtenerCatalogoProductos() {
  const user = process.env.VECTORPOS_USER;
  const pass = process.env.VECTORPOS_PASS;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    let catalogoData = null;
    page.on('response', async res => {
      const url = res.url();
      // Capturar cualquier respuesta JSON que parezca lista de productos
      if ((url.includes('producto') || url.includes('articulo') || url.includes('item')) &&
          (url.includes('lista') || url.includes('index') || url.includes('get') || url.includes('all'))) {
        try {
          const text = await res.text();
          const d = JSON.parse(text);
          const arr = d?.datos || d?.data || d?.items || (Array.isArray(d) ? d : null);
          if (arr?.length > 10) {
            console.log(`📦 Posible catálogo en: ${url} (${arr.length} items)`);
            if (arr[0]) console.log('📋 Campos catálogo:', Object.keys(arr[0]).join(', '));
            catalogoData = arr;
          }
        } catch(e) {}
      }
    });

    await page.goto(`${APP_BASE}/?r=site/login`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.type('#txtEmail', user, { delay: 30 });
    await page.type('#txtClave', pass, { delay: 30 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }),
      page.click('#btnEntrar'),
    ]);
    if (page.url().includes('cambioSucursal')) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }),
        page.click('a,button'),
      ]);
    }

    // Intentar navegar al módulo de productos/inventario
    await page.evaluate(() => {
      const textos = ['Productos', 'Artículos', 'Inventario', 'Items', 'Catálogo'];
      for (const t of textos) {
        const link = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === t);
        if (link) { link.click(); return; }
      }
    });
    await new Promise(r => setTimeout(r, 3000));

    // Intentar cargar lista si hay botón
    await page.evaluate(() => {
      const btn = document.querySelector('#btnCargar, #btnBuscar, [data-action="load"]');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 4000));

    await browser.close();
    browser = null;
    return catalogoData;
  } catch(e) {
    console.error('❌ Error catálogo productos:', e.message);
    if (browser) await browser.close();
    return null;
  }
}

/**
 * Infiere la categoría de un producto a partir de su nombre y medida,
 * cuando el catálogo del POS no provee esa información.
 * - Si medida es gr/g/ml → ESENCIAS
 * - Si medida es u/und/unidad → ORIGINALES (botella entera, no fraccionada)
 * - Palabras clave específicas tienen prioridad sobre la medida
 */
function _inferirCategoria(nombre, medida = '') {
  const n = nombre.toLowerCase();
  const m = medida.toLowerCase().trim();

  // 1. Palabras clave explícitas (prioridad máxima)
  if (n.includes('original')) return 'ORIGINALES';
  if (n.includes(' 1.1') || n.endsWith('1.1')) return 'REPLICA 1.1';
  if (['crema','locion','loción','mantequilla','corporal','body'].some(k => n.includes(k))) return 'CREMA CORPORAL';
  if (['alcohol','gramera','insumo','tapón','tapon'].some(k => n.includes(k))) return 'INSUMOS VARIOS';
  const kwEnvase = [
    'envase','tapa plana','tapa bala','singler','beirut','bomba','cartier','frasco',
    'botella','perfumero','maletín','maletin','star w','venecia','roma ',
    'paris ','london','empire','oval','redondo','cuadrado','roll on',
    'rollon','atomizador','dispensador',
  ];
  if (kwEnvase.some(kw => n.includes(kw))) return 'ENVASE';

  // 2. Usar medida para distinguir esencias (gr/ml) de unidades (originales)
  if (m === 'gr' || m === 'g' || m === 'ml' || m.startsWith('gr') || m.startsWith('ml')) return 'ESENCIAS';
  if (m === 'u' || m === 'und' || m === 'unidad' || m === 'unidades' || m.startsWith('u')) return 'ORIGINALES';

  return 'ESENCIAS'; // default
}

/** Retorna TODOS los productos del inventario cruzando saldos + catálogo */
async function consultarTodoInventario() {
  console.log('\n📦 Consultando inventario completo...');

  // Obtener saldos y catálogo en paralelo (sesiones separadas)
  const [saldos, catalogo] = await Promise.all([
    _obtenerSaldosBrutos(),
    _obtenerCatalogoProductos(),
  ]);

  if (!saldos) return null;
  console.log(`✅ ${saldos.length} saldos | catálogo: ${catalogo?.length || 0} productos`);

  // Construir mapa de catálogo por nombre normalizado
  const mapacat = {};
  if (catalogo) {
    catalogo.forEach(p => {
      const nombre = (p.Nombre || p.nombre || p.NOMBRE || '').trim();
      if (!nombre) return;
      const key = nombre.toLowerCase();
      mapacat[key] = {
        categoria:   p.Categoria  || p.categoria  || p.Categoría  || p.CATEGORIA  || '',
        medida:      p.Medida     || p.medida     || p.MEDIDA     || '',
        costoUnidad: parsearMontoJSON(p.Costo ?? p['Costo Unidad'] ?? p['Costo Unitario'] ?? p.costo ?? 0),
      };
    });
  }

  return saldos.map(p => {
    const nombre = (p.Nombre || '').trim();
    const key    = nombre.toLowerCase();
    const cat    = mapacat[key] || {};

    // Costo unidad: priorizar catálogo, fallback saldo
    const costoUnidad = cat.costoUnidad ||
      parsearMontoJSON(p['Costo Unidad'] ?? p['Costo Unitario'] ?? p['Costo'] ?? 0);
    const saldo = parseFloat(p['Saldo Actual']) || 0;

    return {
      nombre,
      saldo,
      medida:      cat.medida    || p.Medida || '',
      categoria:   cat.categoria || _inferirCategoria(nombre, cat.medida || p.Medida || ''),
      codigo:      p.Codigo || '',
      costoUnidad,
      costoTotal:  costoUnidad > 0 ? costoUnidad * saldo :
                   parsearMontoJSON(p['Costo Total'] ?? p['Valor Total'] ?? 0),
    };
  });
}

async function consultarAlertasInventario() {
  console.log('\n📦 Consultando alertas inventario...');
  const inv = await consultarTodoInventario();
  if (!inv) return null;
  console.log(`✅ ${inv.length} productos cargados`);

  const alertas = inv.filter(p => {
    const cat = (p.categoria || '').toUpperCase().trim();
    const umbral = Object.entries(UMBRALES).find(([k]) => cat.includes(k));
    const limite = umbral ? umbral[1].alerta :
      (p.medida?.toLowerCase().includes('gr') || p.medida?.toLowerCase().includes('ml')) ? LIMITE_GRAMOS : LIMITE_UNIDADES;
    return p.saldo < limite;
  }).map(p => ({
    nombre: p.nombre, saldo: p.saldo, medida: p.medida,
    categoria: p.categoria, costoUnidad: p.costoUnidad || 0,
  })).sort((a, b) => {
    if (a.saldo === 0 && b.saldo > 0) return -1;
    if (b.saldo === 0 && a.saldo > 0) return 1;
    return a.saldo - b.saldo;
  });

  // Separar por tipo para compatibilidad con código existente
  const alertasGramos   = alertas.filter(p => p.medida?.toLowerCase().includes('gr') || p.medida?.toLowerCase().includes('ml'));
  const alertasUnidades = alertas.filter(p => !p.medida?.toLowerCase().includes('gr') && !p.medida?.toLowerCase().includes('ml'));

  console.log(`⚠️ Alertas gramos: ${alertasGramos.length} | unidades: ${alertasUnidades.length}`);
  return { alertasGramos, alertasUnidades, alertas, total: inv.length };
}

// Palabras clave por categoría para filtrar por nombre cuando no hay categoría asignada
const KEYWORDS_CATEGORIA = {
  'ENVASE': [
    'envase', 'tapa plana', 'tapa bala', 'singler', 'beirut', 'bomba', 'cartier',
    'frasco', 'botella', 'perfumero', 'maletín', 'maletin', 'star w', 'venecia',
    'roma ', 'paris ', 'london', 'empire', 'oval', 'redondo', 'cuadrado',
    'roll on', 'rollon', 'atomizador', 'spray', 'dispensador',
  ],
  'INSUMOS VARIOS': [
    'alcohol', 'gramera', 'insumo', 'tapón', 'tapon', 'sello', 'etiqueta',
    'caja', 'bolsa', 'papel', 'cinta', 'precinto', 'tubo', 'pipeta',
  ],
  'CREMA CORPORAL': ['crema', 'loción', 'locion', 'mantequilla', 'corporal', 'body'],
  // Esencias: cuando no hay categoría, todo lo que NO sea envase/insumo/crema/original es esencia
  'ESENCIAS M':  ['_ESENCIA_'],
  'ESENCIAS F':  ['_ESENCIA_'],
  'ESENCIAS U':  ['_ESENCIA_'],
  'ESENCIAS':    ['_ESENCIA_'],
  'REPLICA 1.1': ['1.1', ' 1.1'],
  'ORIGINALES':  ['original'],
};

// Palabras clave que identifican envases/insumos/cremas (para excluirlos del match de esencias)
const _NO_ESENCIA = [
  'envase', 'tapa plana', 'tapa bala', 'singler', 'beirut', 'bomba', 'cartier', 'frasco', 'botella',
  'perfumero', 'maletín', 'maletin', 'star w', 'venecia', 'roma ', 'paris ', 'london',
  'roll on', 'rollon', 'atomizador', 'spray', 'dispensador',
  'alcohol', 'gramera', 'crema', 'locion', 'loción', 'mantequilla',
  'corporal', 'caja', 'bolsa', 'etiqueta', 'original',
];

function _esEsencia(nombre) {
  const n = nombre.toLowerCase();
  return !_NO_ESENCIA.some(kw => n.includes(kw));
}

/** Filtra inventario por categoría específica */
async function consultarInventarioPorCategoria(categoria) {
  const inv = await consultarTodoInventario();
  if (!inv) return null;
  const catN = categoria.toUpperCase().trim();

  const conCategoria = inv.filter(p => p.categoria).length;
  console.log(`🔍 Filtrar por "${catN}" | ${inv.length} productos | ${conCategoria} con categoría`);

  const resultado = inv.filter(p => {
    const cat = (p.categoria || '').toUpperCase().trim();
    const nombre = p.nombre.toLowerCase();

    // ── Con categoría asignada: match directo ──
    if (cat) {
      if (catN === 'ESENCIAS') return cat.startsWith('ESENCIAS');
      return cat === catN || cat.startsWith(catN);
    }

    // ── Sin categoría: fallback por nombre ──
    if (catN === 'ESENCIAS') return _esEsencia(p.nombre);
    if (catN === 'ESENCIAS M' || catN === 'ESENCIAS F' || catN === 'ESENCIAS U') return _esEsencia(p.nombre);
    if (catN === 'REPLICA 1.1') return nombre.includes('1.1');
    if (catN === 'ORIGINALES') return nombre.includes('original');
    if (catN === 'CREMA CORPORAL') return ['crema','locion','loción','mantequilla','corporal','body'].some(k => nombre.includes(k));
    if (catN === 'INSUMOS VARIOS') return ['alcohol','gramera','insumo','tapón','tapon','caja','bolsa'].some(k => nombre.includes(k));
    if (catN === 'ENVASE') {
      return KEYWORDS_CATEGORIA['ENVASE'].some(kw => nombre.includes(kw.trim()));
    }
    return false;
  });

  console.log(`✅ ${resultado.length} productos encontrados en "${catN}"`);
  return resultado.sort((a, b) => a.saldo - b.saldo);
}

function generarMensajeAlertas(resultado) {
  if (!resultado) {
    return '❌ No pude conectar al inventario de VectorPOS.';
  }

  const { alertasGramos, alertasUnidades, total } = resultado;

  if (alertasGramos.length === 0 && alertasUnidades.length === 0) {
    return `✅ *INVENTARIO OK*\n\nTodos los productos están sobre los límites mínimos.\n_(${total} productos revisados)_`;
  }

  let msg = `⚠️ *ALERTAS DE INVENTARIO*\n_(${total} productos revisados)_\n`;

  if (alertasGramos.length > 0) {
    msg += `\n🔴 *GRAMOS BAJOS (< ${LIMITE_GRAMOS}g)*\n`;
    alertasGramos.forEach(p => {
      const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= 10 ? '🔴 CRÍTICO' : '🟠 BAJO';
      msg += `${nivel} ${p.nombre}: *${p.saldo}g*\n`;
    });
  }

  if (alertasUnidades.length > 0) {
    msg += `\n🟡 *UNIDADES BAJAS (< ${LIMITE_UNIDADES}u)*\n`;
    alertasUnidades.forEach(p => {
      const nivel = p.saldo <= 0 ? '🚨 AGOTADO' : p.saldo <= 5 ? '🔴 CRÍTICO' : '🟠 BAJO';
      msg += `${nivel} ${p.nombre}: *${p.saldo} u*\n`;
    });
  }

  msg += `\n─────────────────\n🤖 _Alerta automática VectorPOS_`;
  return msg;
}

// ──────────────────────────────────────────────
// GASTOS / EGRESOS
// ──────────────────────────────────────────────

async function extraerGastos(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=compras%2Fgastos&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  });

  // Detectar fila de encabezados para mapear columnas dinámicamente
  let iConcepto = 0, iDetalle = 1, iTercero = 2, iFecha = 3, iValor = 4;
  const headerRow = filas.find(f =>
    f.some(c => c.toLowerCase().includes('concepto') || c.toLowerCase().includes('gasto'))
  );
  if (headerRow) {
    console.log('📋 Columnas gastos:', headerRow.join(' | '));
    headerRow.forEach((col, i) => {
      const c = col.toLowerCase();
      if (c.includes('concepto') || c.includes('gasto'))   iConcepto = i;
      else if (c.includes('detalle') || c.includes('desc')) iDetalle  = i;
      else if (c.includes('tercero') || c.includes('prov')) iTercero  = i;
      else if (c.includes('fecha'))                          iFecha    = i;
      else if (c.includes('valor') || c.includes('total') || c.includes('monto')) iValor = i;
    });
  }

  const gastos = [];
  for (const fila of filas) {
    if (!fila[iConcepto]) continue;
    const concepto = fila[iConcepto];
    if (concepto === 'Concepto' || concepto === 'Total' || concepto === 'Gasto') continue;

    // Parsear valor solo desde la columna detectada
    const valor = parsearMonto(fila[iValor] || '');

    gastos.push({
      concepto,
      detalle: fila[iDetalle] || '',
      tercero: fila[iTercero] || '',
      fecha:   fila[iFecha]   || '',
      valor,
    });
  }

  console.log(`💸 ${gastos.length} gastos extraídos. Ejemplo:`, gastos[0]);
  return gastos;
}

// ──────────────────────────────────────────────
// CIERRES DE CAJA
// ──────────────────────────────────────────────

async function extraerCierresCaja(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=ventas%2Fcierres&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  });

  const cierres = [];
  for (const fila of filas) {
    if (!fila[0] || fila[0] === 'Fecha' || fila[0] === 'Total') continue;
    if (!fila[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    cierres.push({
      fecha: fila[0],
      turnos: fila[1] || '',
      sucursal: fila[2] || '',
    });
  }
  return cierres;
}

// ──────────────────────────────────────────────
// VENTAS POR HORA
// ──────────────────────────────────────────────

async function extraerVentasPorHora(page, fechaInicial, fechaFinal) {
  const url = `${BASE}/index.php?r=ventas%2Fhora&idSyA=${ID_SYA}&fechaInicial=${fechaInicial}&fechaFinal=${fechaFinal}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const filas = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\s+/g, ' '));
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  });

  // Find header row to map hour columns
  let horasHeader = [];
  const porHora = {}; // hora → total acumulado

  for (const fila of filas) {
    if (fila[0] === 'Dia' || fila[0] === 'Día') {
      horasHeader = fila; // e.g. ["Dia","Total","Hora_5","Hora_6",...,"Hora_23"]
      continue;
    }
    if (!fila[0] || !fila[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    for (let i = 2; i < horasHeader.length; i++) {
      const hora = horasHeader[i]?.replace('Hora_', '') || String(i + 3);
      const val = parsearMonto(fila[i]);
      if (!porHora[hora]) porHora[hora] = 0;
      porHora[hora] += val;
    }
  }

  return Object.entries(porHora)
    .map(([hora, total]) => ({ hora: parseInt(hora), total }))
    .sort((a, b) => a.hora - b.hora);
}

module.exports = {
  monitorearVentasDiarias,
  generarMensajeMeta,
  consultarAlertasInventario,
  consultarTodoInventario,
  consultarInventarioPorCategoria,
  generarMensajeAlertas,
  crearSesionPOS,
  extraerVentasGenerales,
  extraerVentasCajero,
  extraerVentasProducto,
  extraerGastos,
  extraerCierresCaja,
  extraerVentasPorHora,
  META_MENSUAL,
  fechaHoy,
  fechaInicioMes,
  formatPesos,
  UMBRALES,
  inferirCategoria: _inferirCategoria,
};
