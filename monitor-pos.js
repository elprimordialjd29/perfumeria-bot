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

function fechaEnColombia(offsetDias = 0) {
  // Colombia = UTC-5, siempre (no tiene horario de verano)
  const ahora = new Date();
  const colombia = new Date(ahora.getTime() - 5 * 60 * 60 * 1000 + offsetDias * 86400000);
  return colombia.toISOString().split('T')[0];
}

function fechaHoy() {
  return fechaEnColombia(0);
}

function fechaInicioMes() {
  const hoy = fechaEnColombia(0);
  return hoy.substring(0, 8) + '01'; // YYYY-MM-01
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

  const agrupados = Object.values(porCajero);
  for (const c of agrupados) {
    // Si total = 0 pero hay medios de pago, recalcular
    if (c.total === 0 && (c.efectivo + c.bancolombia + c.nequi) > 0) {
      c.total = c.efectivo + c.bancolombia + c.nequi;
    }
    // Si nequi ≈ total y efectivo+bancolombia ya cubre el total,
    // significa que nequi capturó la columna del total por error → corregir
    if (c.nequi > 0 && Math.abs(c.nequi - c.total) < 1 && (c.efectivo + c.bancolombia) > 0) {
      c.nequi = Math.max(0, c.total - c.efectivo - c.bancolombia);
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
// ESENCIAS (M/F/U) → óptimo >300g, crítico ≤200g
// REPLICA 1.1 / ORIGINALES → solo alertar si saldo = 0
// ENVASE → NO alerta general; solo productos específicos (ver UMBRALES_PRODUCTO)
// INSUMOS VARIOS (alcohol) → alerta < 500, SIN restock
// CREMA CORPORAL → alerta < 10
const UMBRALES = {
  'ESENCIAS M':      { alerta: 300, critico: 200, medida: 'gr', restock: true  },
  'ESENCIAS F':      { alerta: 300, critico: 200, medida: 'gr', restock: true  },
  'ESENCIAS U':      { alerta: 300, critico: 200, medida: 'gr', restock: true  },
  'REPLICA 1.1':     { alerta: 1,   critico: 1,   medida: 'u',  restock: true  },
  'ORIGINALES':      { alerta: 1,   critico: 1,   medida: 'u',  restock: true  },
  'ENVASE':          { alerta: 50,  critico: 10,  medida: 'u',  restock: true  },
  'INSUMOS VARIOS':  { alerta: 500, critico: 100, medida: 'u',  restock: false },
  'CREMA CORPORAL':  { alerta: 10,  critico: 3,   medida: 'u',  restock: true  },
};

// ── Umbrales por producto específico (tienen prioridad sobre la categoría) ──
// Solo estos productos de ENVASE generan alertas
const UMBRALES_PRODUCTO = {
  'singler color 30ml': { alerta: 100, critico: 100, medida: 'u', restock: true },
};

const LIMITE_GRAMOS   = 300; // default gramos
const LIMITE_UNIDADES = 15;  // default unidades

/**
 * Retorna el umbral {alerta, critico} correcto para un producto.
 * Primero busca por nombre específico, luego por categoría.
 */
function _getUmbral(nombre, medida, categoria) {
  const nombreN = (nombre || '').toLowerCase();
  const cat     = (categoria || _inferirCategoria(nombre, medida)).toUpperCase().trim();

  // 1. Producto específico
  const prodKey = Object.keys(UMBRALES_PRODUCTO).find(k => nombreN.includes(k));
  if (prodKey) return UMBRALES_PRODUCTO[prodKey];

  // 2. Categoría
  const umbralCat = Object.entries(UMBRALES).find(([k]) => cat.includes(k));
  if (umbralCat) return umbralCat[1];

  // 3. Default por medida
  const esGramos = (medida || '').toLowerCase().match(/^(gr|g|ml)/);
  return { alerta: esGramos ? LIMITE_GRAMOS : LIMITE_UNIDADES, critico: esGramos ? 200 : 5 };
}

/**
 * Retorna emoji + texto de nivel según saldo real vs umbrales del producto.
 */
function getNivelAlerta(nombre, medida, saldo, categoria) {
  if (saldo <= 0) return '🚨 AGOTADO';
  const u = _getUmbral(nombre, medida, categoria);
  if (saldo <= u.critico) return '🔴 CRÍTICO';
  return '🟠 BAJO';
}

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

/**
 * Obtiene mapa {nombreNormalizado → categoria} desde el catálogo VectorPOS.
 * Usado para cruzar productos vendidos con su categoría real (ESENCIAS M/F/U, etc.)
 */
async function obtenerCategoriaProductos() {
  const catalogo = await _obtenerCatalogoProductos();
  const mapa = {};
  if (catalogo) {
    catalogo.forEach(p => {
      const nombre = (p.Nombre || p.nombre || p.NOMBRE || '').trim();
      if (!nombre) return;
      const key = nombre.toLowerCase();
      const cat = p.Categoria || p.categoria || p.Categoría || p.CATEGORIA || '';
      if (cat) mapa[key] = cat.toUpperCase().trim();
    });
    console.log(`🗂️  Mapa categorías: ${Object.keys(mapa).length} productos`);
  }
  return mapa;
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
    const nombreN = (p.nombre || '').toLowerCase();
    const cat     = (p.categoria || '').toUpperCase().trim();

    // 1. Producto específico tiene prioridad
    const prodKey = Object.keys(UMBRALES_PRODUCTO).find(k => nombreN.includes(k));
    if (prodKey) return p.saldo <= UMBRALES_PRODUCTO[prodKey].alerta;

    // 2. Categoría general (incluye ENVASE con sus umbrales normales)
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

  const todas = [...(resultado.alertas || [
    ...(alertasGramos || []),
    ...(alertasUnidades || []),
  ])];

  let msg = `⚠️ *ALERTAS DE INVENTARIO*\n_(${total} productos revisados)_\n`;

  // Agrupar por categoría
  const ORDEN_CATS = [
    { key: 'ESENCIAS M',     emoji: '🧪', label: 'ESENCIAS M (masculinas)' },
    { key: 'ESENCIAS F',     emoji: '🌸', label: 'ESENCIAS F (femeninas)'  },
    { key: 'ESENCIAS U',     emoji: '🌿', label: 'ESENCIAS U (unisex)'     },
    { key: 'ENVASE',         emoji: '🧴', label: 'ENVASES'                 },
    { key: 'ORIGINALES',     emoji: '✨', label: 'ORIGINALES'              },
    { key: 'REPLICA 1.1',    emoji: '🔁', label: 'RÉPLICAS 1.1'           },
    { key: 'CREMA CORPORAL', emoji: '🧴', label: 'CREMAS CORPORALES'       },
    { key: 'INSUMOS VARIOS', emoji: '🔧', label: 'INSUMOS VARIOS'          },
  ];

  for (const cat of ORDEN_CATS) {
    const prods = todas.filter(p => {
      const c = (p.categoria || _inferirCategoria(p.nombre, p.medida)).toUpperCase();
      return c.includes(cat.key);
    });
    if (prods.length === 0) continue;

    msg += `\n${cat.emoji} *${cat.label}*\n`;
    prods.forEach(p => {
      const unidad = (p.medida || '').toLowerCase().match(/^(gr|g|ml)/) ? `${p.saldo}g` : `${p.saldo} u`;
      msg += `${getNivelAlerta(p.nombre, p.medida, p.saldo, p.categoria)} *${p.nombre}*: ${unidad}\n`;
    });
  }

  // Productos sin categoría reconocida
  const conocidas = ORDEN_CATS.map(c => c.key);
  const otros = todas.filter(p => {
    const c = (p.categoria || _inferirCategoria(p.nombre, p.medida)).toUpperCase();
    return !conocidas.some(k => c.includes(k));
  });
  if (otros.length > 0) {
    msg += `\n📦 *OTROS*\n`;
    otros.forEach(p => {
      const unidad = (p.medida || '').toLowerCase().match(/^(gr|g|ml)/) ? `${p.saldo}g` : `${p.saldo} u`;
      msg += `${getNivelAlerta(p.nombre, p.medida, p.saldo, p.categoria)} *${p.nombre}*: ${unidad}\n`;
    });
  }

  msg += `\n─────────────────\n🤖 _Alerta automática VectorPOS_`;
  return msg;
}

// ──────────────────────────────────────────────
// GASTOS / EGRESOS
// ──────────────────────────────────────────────

async function extraerGastos(page, fechaInicial, fechaFinal) {
  // Columnas reales de compras/gastos en VectorPOS:
  // [0] NombreProducto | [1] Valor | [2] Detalle | [3] Proveedor
  // [4] Documento | [5] Medio Pago | [6] Fecha
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

  if (filas[0]) console.log('📋 Columnas gastos:', filas[0].join(' | '));

  const gastos = [];
  for (const fila of filas) {
    const concepto = fila[0] || '';
    // Saltar encabezado y filas de total
    if (!concepto || concepto === 'NombreProducto' || concepto === 'Total' ||
        concepto === 'Concepto' || concepto === 'Gasto') continue;

    gastos.push({
      concepto,
      valor:     parsearMonto(fila[1] || ''),
      detalle:   fila[2] || '',
      proveedor: fila[3] || '',
      documento: fila[4] || '',
      medioPago: fila[5] || '',
      fecha:     fila[6] || '',
    });
  }

  console.log(`💸 ${gastos.length} gastos. Ejemplo:`, JSON.stringify(gastos[0]));
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

// ──────────────────────────────────────────────
// HISTÓRICO DE FACTURAS (app.vectorpos.com.co)
// Permite cruzar productos con sus recargas/preparaciones exactas y descuentos
// ──────────────────────────────────────────────

// ── Helper: leer y cerrar el modal de detalle de una factura ──────────────────
async function _leerModalFactura(page) {
  return await page.evaluate(() => {
    // Buscar el modal abierto
    const container =
      document.querySelector('.modal.show') ||
      [...document.querySelectorAll('.modal')].find(m => {
        const s = window.getComputedStyle(m);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      }) ||
      // Fallback: cualquier div con texto "Factura N°"
      [...document.querySelectorAll('div,section')].find(el =>
        /factura\s*n[°º]/i.test(el.innerText?.substring(0,120) || '')
      );

    if (!container) return null;
    const text = container.innerText || '';

    // Items: filas donde cells[0] es número, cells[1] es nombre del producto
    const items = [];
    container.querySelectorAll('table tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')]
        .map(td => td.innerText.trim().replace(/\s+/g,' '));
      if (cells.length >= 3 && /^\d+$/.test(cells[0]) && cells[1].length > 1) {
        items.push({
          cantidad: parseInt(cells[0]) || 1,
          nombre:   cells[1],
          valor:    parseInt(cells[2].replace(/\./g,'').replace(/[^0-9]/g,'')) || 0,
        });
      }
    });

    // Leer totales del modal: SubTotal, Descuento, Total
    const exNum = (pat) => {
      const m = text.match(pat);
      return m ? parseInt(m[1].replace(/\./g,'').replace(/[^0-9]/g,'')) || 0 : 0;
    };
    const subTotal  = exNum(/sub\s*total[^\d]*([\d.]+)/i);
    const descModal = exNum(/descuento[^\d]*([\d.]+)/i);
    const totalModal= exNum(/^total[^\d]*([\d.]+)/im);

    // Forma de pago
    const ef = exNum(/ventas\s+efectivo[^\d]*([\d.]+)/i) ||
               exNum(/efectivo[^\d]*([\d.]+)/i);
    const bc = exNum(/bancolombia[^\d]*([\d.]+)/i);
    const nq = exNum(/nequi[^\d]*([\d.]+)/i);

    return items.length > 0 ? {
      items,
      subTotal, descuento: descModal, totalModal,
      efectivo: ef, bancolombia: bc, nequi: nq,
      medioPago: ef > 0 ? 'Efectivo' : bc > 0 ? 'Bancolombia' : nq > 0 ? 'Nequi' : 'Otro',
    } : null;
  });
}

async function _cerrarModalFactura(page) {
  await page.evaluate(() => {
    // Intentar botón "Cerrar" (texto exacto)
    const cerrar = [...document.querySelectorAll('button')]
      .find(b => /^cerrar$/i.test(b.innerText.trim()));
    if (cerrar) { cerrar.click(); return; }
    // Intentar × o data-dismiss
    const closeBtn = document.querySelector(
      'button[data-dismiss="modal"], .modal-header .close, [aria-label="Close"], .btn-close'
    );
    if (closeBtn) { closeBtn.click(); return; }
    // Intentar backdrop
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.click();
  });
  await new Promise(r => setTimeout(r, 700));
}

// ── Helper: login en app.vectorpos.com.co ─────────────────────────────────────
async function _loginApp(page, user, pass) {
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
  await new Promise(r => setTimeout(r, 2000));
}

// ── Helper: scrapear detalles de cada factura en la tabla actual ──────────────
async function _scrapeDetallesFacturas(page, facturasList) {
  if (facturasList.length === 0 || facturasList.length > 30) return;
  const parseNum = (s) => parseInt(String(s||'0').replace(/\./g,'').replace(/[^0-9]/g,'')) || 0;

  for (const factRow of facturasList) {
    const numFact = factRow.factura;
    try {
      // Click en el link del número de factura
      const clicked = await page.evaluate((num) => {
        const link = [...document.querySelectorAll('table td a')]
          .find(a => a.innerText.trim() === num);
        if (link) { link.click(); return true; }
        return false;
      }, numFact);

      if (!clicked) { console.log(`⚠️ No se encontró link para factura ${numFact}`); continue; }
      await new Promise(r => setTimeout(r, 1800));

      const detalle = await _leerModalFactura(page);
      if (detalle) {
        // El descuento real viene del modal (SubTotal - Total del modal)
        const descReal = detalle.subTotal > 0 && detalle.totalModal > 0
          ? Math.max(0, detalle.subTotal - detalle.totalModal)
          : detalle.descuento;
        Object.assign(factRow, detalle, { descuento: descReal });
      }

      await _cerrarModalFactura(page);
    } catch(e) {
      console.error(`⚠️ Detalle factura ${numFact}:`, e.message);
    }
  }
}

/**
 * Extrae facturas con sus items exactos para un rango de fechas.
 *
 * Para HOY: navega a Vender → Lista facturas (sin filtro de fecha).
 * Para rangos: navega a Histórico de Facturas con filtro de fechas.
 *
 * Con incluirDetalle=true hace clic en cada factura para obtener:
 *   items[], subTotal, descuento (real), medioPago
 *
 * @returns {Promise<Array>} [{factura, fecha, hora, venta, total, descuento, items?, medioPago?}]
 */
async function extraerHistoricoFacturas(fechaInicial, fechaFinal, incluirDetalle = false) {
  const user = process.env.VECTORPOS_USER;
  const pass = process.env.VECTORPOS_PASS;
  const hoy  = fechaEnColombia(0);
  let browser = null;
  const parseNum = (s) => parseInt(String(s||'0').replace(/\./g,'').replace(/[^0-9]/g,'')) || 0;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await _loginApp(page, user, pass);

    // ══════════════════════════════════════════
    // RUTA A: HOY → Lista Facturas (Vender → sidebar)
    // ══════════════════════════════════════════
    if (fechaInicial === hoy && fechaFinal === hoy) {
      // Paso 1: click en "Vender" del menú superior (por si no es la vista actual)
      await page.evaluate(() => {
        const vender = [...document.querySelectorAll('a,div,span,li')]
          .find(e => /^vender$/i.test(e.innerText?.trim() || ''));
        if (vender) vender.click();
      });
      await new Promise(r => setTimeout(r, 1200));

      // Paso 2: click en "Lista facturas" del sidebar izquierdo
      const ok = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a,li,span,div')]
          .find(e => /^lista\s*facturas?$/i.test(e.innerText?.trim() || ''));
        if (el) { el.click(); return true; }
        return false;
      });
      if (!ok) console.log('⚠️ No se encontró "Lista facturas" en sidebar');
      await new Promise(r => setTimeout(r, 2000));

      // Leer tabla
      // Columnas Lista Facturas: Estado(0) Factura(1) mesa(2) Venta(3) Propina(4)
      //   Domicilio(5) Total(6) EstadoDIAN(7) hora(8) plataforma(9) codPlat(10) Cajero(11)
      const filas = await page.evaluate(() => {
        const rows = [];
        document.querySelectorAll('table tbody tr, table tr').forEach(tr => {
          const cells = [...tr.querySelectorAll('td')]
            .map(td => td.innerText.trim().replace(/\s+/g,' '));
          if (cells.length >= 7 && /^\d+$/.test(cells[1])) rows.push(cells);
        });
        return rows;
      });

      const facturasList = filas.map(cells => ({
        factura:   cells[1],
        mesa:      cells[2] || '',
        venta:     parseNum(cells[3]),
        total:     parseNum(cells[6]),
        descuento: 0,   // se sobreescribe desde modal si incluirDetalle=true
        fecha:     hoy,
        hora:      cells[8] || '',
      }));

      console.log(`📄 Lista Facturas hoy: ${facturasList.length} facturas`);
      if (incluirDetalle) await _scrapeDetallesFacturas(page, facturasList);

      await browser.close();
      browser = null;
      return facturasList;
    }

    // ══════════════════════════════════════════
    // RUTA B: RANGO → Histórico de Facturas
    // ══════════════════════════════════════════

    // Intentar navegación por clicks (múltiples menús candidatos)
    const menusCandidatos = ['Caja', 'Vender', 'Estadísticas', 'Estadisticas', 'Reportes'];
    let histOk = false;

    for (const menuName of menusCandidatos) {
      const menuClicked = await page.evaluate((n) => {
        const el = [...document.querySelectorAll('a,div,span,li')]
          .find(e => e.innerText?.trim() === n);
        if (el) { el.click(); return true; }
        return false;
      }, menuName);
      if (!menuClicked) continue;
      await new Promise(r => setTimeout(r, 1200));

      histOk = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a,span,li,div')]
          .find(e => /hist[oó]rico\s*(?:de\s*)?factura/i.test(e.innerText?.trim() || ''));
        if (el) { el.click(); return true; }
        return false;
      });
      if (histOk) break;
    }

    if (!histOk) {
      console.log('⚠️ No se pudo navegar a Histórico de Facturas');
      await browser.close();
      return [];
    }
    await new Promise(r => setTimeout(r, 2000));

    // Establecer fechas
    await page.evaluate((fi, ff) => {
      const inputs = [...document.querySelectorAll('input[type="date"]')];
      const set = (inp, val) => {
        if (!inp) return;
        inp.value = val;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(inputs[0], fi);
      set(inputs[1], ff);
    }, fechaInicial, fechaFinal);

    // Click "Cargar"
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button,input[type="button"],a')]
        .find(el => /^cargar$/i.test(el.innerText?.trim() || el.value?.trim() || ''));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 4000));

    // Leer tabla Histórico
    // Columnas: Estado(0) Factura(1) Mesa(2) Venta(3) Propina(4) Domicilio(5)
    //   Total(6) Fecha(7 → "YYYY-MM-DD HH:MM:SS") EstadoDIAN(8) NombreCliente(9)
    const filas = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tbody tr, table tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')]
          .map(td => td.innerText.trim().replace(/\s+/g,' '));
        if (cells.length >= 7 && /^\d+$/.test(cells[1])) rows.push(cells);
      });
      return rows;
    });

    const facturasList = filas.map(cells => {
      const fechaHora = cells[7] || '';
      return {
        factura:   cells[1],
        mesa:      cells[2] || '',
        venta:     parseNum(cells[3]),
        total:     parseNum(cells[6]),
        descuento: 0,
        fecha:     fechaHora.split(' ')[0] || fechaInicial,
        hora:      fechaHora.split(' ')[1] || '',
      };
    });

    console.log(`📄 Histórico: ${facturasList.length} facturas (${fechaInicial}→${fechaFinal})`);
    if (incluirDetalle) await _scrapeDetallesFacturas(page, facturasList);

    await browser.close();
    browser = null;
    return facturasList;

  } catch(e) {
    console.error('❌ Error extraerHistoricoFacturas:', e.message);
    if (browser) await browser.close();
    return [];
  }
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
  UMBRALES_PRODUCTO,
  inferirCategoria: _inferirCategoria,
  getNivelAlerta,
  getUmbral: _getUmbral,
  obtenerCategoriaProductos,
  extraerHistoricoFacturas,
};
