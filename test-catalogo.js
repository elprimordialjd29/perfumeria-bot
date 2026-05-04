require('dotenv').config();
const puppeteer = require('puppeteer');
const APP_BASE = 'https://app.vectorpos.com.co';
const ARGS = ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage'];

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  let catalogoData = null;

  page.on('response', async res => {
    if (catalogoData) return;
    if (!res.url().includes('getDatosToConfiguracion')) return;
    try {
      const d = JSON.parse(await res.text());
      const arr = d?.datos || d?.data || (Array.isArray(d) ? d : null);
      if (arr && arr.length > 5) { catalogoData = arr; console.log('Catalogo:', arr.length, 'items'); }
    } catch(e) {}
  });

  await page.goto(APP_BASE + '/index.php?r=site/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.type('#txtEmail', process.env.VECTORPOS_USER, { delay: 30 });
  await page.type('#txtClave', process.env.VECTORPOS_PASS, { delay: 30 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    page.click('#btnEntrar')
  ]);
  await new Promise(r => setTimeout(r, 3000));

  if (page.url().includes('cambioSucursal')) {
    const links = await page.$$('a');
    for (const l of links) {
      const t = await l.evaluate(e => e.textContent.trim());
      if (/sucursal|continuar|principal/i.test(t)) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
          l.click()
        ]);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Click Inventario
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, a')].find(b => /^inventario$/i.test((b.innerText || '').trim()));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Click Productos
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('a, li, span')].find(b => /^productos$/i.test((b.innerText || '').trim()));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 8000));
  await browser.close();

  if (!catalogoData) { console.log('SIN CATALOGO'); process.exit(0); }

  // Categorías únicas
  const cats = {};
  catalogoData.forEach(p => { cats[p.Categoria || '(vacío)'] = (cats[p.Categoria || '(vacío)'] || 0) + 1; });
  console.log('\n=== CATEGORÍAS EN EL CATÁLOGO VectorPOS ===');
  Object.entries(cats).sort().forEach(([c, n]) => console.log(`  ${n.toString().padStart(3)}  "${c}"`));

  // Productos sospechosos
  console.log('\n=== PRODUCTOS SOSPECHOSOS ===');
  [
    'chess 30ml', 'fame color 30ml', 'victory 50ml', 'perfumes en aerosol',
    'delina 30 ml', 'tom ford 25ml', 'xerjoff 50ml', 'asad lattafa',
    'club de nuit intense', 'sublime lataffa', 'splash victoria\'s secret',
    'mayar original', 'lataffa oud for glory original'
  ].forEach(s => {
    const f = catalogoData.find(p => (p.Nombre || '').toLowerCase().trim() === s);
    if (f) {
      console.log(`  MATCH: "${f.Nombre}" → Cat:"${f.Categoria}" Med:"${f.Medida}"`);
    } else {
      const ps = catalogoData.filter(p => (p.Nombre || '').toLowerCase().includes(s.split(' ')[0]));
      console.log(`  NO_MATCH: "${s}" | parciales: ${ps.slice(0, 3).map(p => '"' + p.Nombre + '"(' + p.Categoria + ')').join(' | ') || 'ninguno'}`);
    }
  });

  // Muestra todos los productos con Categoria ORIGINALES o vacía
  console.log('\n=== TODOS LOS "ORIGINALES" DEL CATALOGO ===');
  catalogoData
    .filter(p => p.Categoria === 'ORIGINALES' || p.Categoria === '')
    .forEach(p => console.log(`  "${p.Nombre}" Cat:"${p.Categoria}" Med:"${p.Medida}"`));

  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
