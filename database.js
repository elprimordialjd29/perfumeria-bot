/**
 * database.js - Base de datos Supabase (PostgreSQL en la nube)
 * Guarda: ventas, productos, conversaciones, config y datos del POS
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// CLIENTE SUPABASE
// ──────────────────────────────────────────────

let supabase = null;

function getSupabase() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error('Faltan SUPABASE_URL y SUPABASE_KEY en el .env');
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return supabase;
}

// ──────────────────────────────────────────────
// VENTAS
// ──────────────────────────────────────────────

async function registrarVenta({ vendedor, producto, precio, cantidad = 1, chat, fuente = 'bot' }) {
  const total = parseFloat(precio) * parseInt(cantidad);
  const { data, error } = await getSupabase()
    .from('ventas')
    .insert([{
      vendedor: vendedor.trim(),
      producto: producto.trim(),
      precio: parseFloat(precio),
      cantidad: parseInt(cantidad),
      total,
      chat: chat || '',
      fuente,
    }])
    .select()
    .single();

  if (error) throw new Error(`Error registrando venta: ${error.message}`);
  return data;
}

async function obtenerVentas({ desde, hasta, vendedor } = {}) {
  let query = getSupabase().from('ventas').select('*').order('fecha', { ascending: false });

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  if (vendedor) query = query.ilike('vendedor', vendedor);

  const { data, error } = await query;
  if (error) throw new Error(`Error obteniendo ventas: ${error.message}`);
  return data || [];
}

// ──────────────────────────────────────────────
// VENTAS DEL POS (VectorPOS)
// ──────────────────────────────────────────────

async function guardarDatosPOS({ fecha, total_dia, num_transacciones, raw_data }) {
  const { error } = await getSupabase()
    .from('ventas_pos')
    .upsert([{ fecha, total_dia, num_transacciones, raw_data }], { onConflict: 'fecha' });

  if (error) throw new Error(`Error guardando datos POS: ${error.message}`);
}

async function obtenerDatosPOS({ desde, hasta } = {}) {
  let query = getSupabase().from('ventas_pos').select('*').order('fecha', { ascending: false });
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  const { data, error } = await query;
  if (error) throw new Error(`Error obteniendo datos POS: ${error.message}`);
  return data || [];
}

// ──────────────────────────────────────────────
// RANKING DE VENTAS
// ──────────────────────────────────────────────

function calcularRanking(ventas) {
  const resumen = {};
  for (const v of ventas) {
    if (!resumen[v.vendedor]) resumen[v.vendedor] = { vendedor: v.vendedor, totalVentas: 0, totalMonto: 0, productos: {} };
    resumen[v.vendedor].totalVentas += v.cantidad;
    resumen[v.vendedor].totalMonto += parseFloat(v.total);
    resumen[v.vendedor].productos[v.producto] = (resumen[v.vendedor].productos[v.producto] || 0) + v.cantidad;
  }
  return Object.values(resumen).sort((a, b) => b.totalMonto - a.totalMonto);
}

function calcularRankingProductos(ventas) {
  const resumen = {};
  for (const v of ventas) {
    if (!resumen[v.producto]) resumen[v.producto] = { producto: v.producto, totalVendido: 0, totalMonto: 0 };
    resumen[v.producto].totalVendido += v.cantidad;
    resumen[v.producto].totalMonto += parseFloat(v.total);
  }
  return Object.values(resumen).sort((a, b) => b.totalMonto - a.totalMonto);
}

// ──────────────────────────────────────────────
// PRODUCTOS DEL CATÁLOGO
// ──────────────────────────────────────────────

async function agregarProducto({ nombre, precio, stock = 0 }) {
  const { error } = await getSupabase()
    .from('productos')
    .upsert([{ nombre: nombre.trim(), precio: parseFloat(precio), stock: parseInt(stock) }], { onConflict: 'nombre' });
  if (error) throw new Error(`Error agregando producto: ${error.message}`);
}

async function obtenerProductos() {
  const { data, error } = await getSupabase().from('productos').select('*').order('nombre');
  if (error) return [];
  return data || [];
}

// ──────────────────────────────────────────────
// HISTORIAL DE CONVERSACIÓN
// ──────────────────────────────────────────────

// Usamos un caché local en memoria (no necesita persistir entre reinicios)
const cacheConversaciones = {};

function guardarMensaje(chatId, role, content) {
  if (!cacheConversaciones[chatId]) cacheConversaciones[chatId] = [];
  cacheConversaciones[chatId].push({ role, content });
  if (cacheConversaciones[chatId].length > 20) {
    cacheConversaciones[chatId] = cacheConversaciones[chatId].slice(-20);
  }
}

function obtenerHistorial(chatId) {
  return cacheConversaciones[chatId] || [];
}

function limpiarHistorial(chatId) {
  cacheConversaciones[chatId] = [];
}

// ──────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────

const configCache = {};

async function obtenerConfig() {
  if (Object.keys(configCache).length > 0) return configCache;

  const { data } = await getSupabase().from('config').select('*');
  const cfg = {
    adminNumber: '',
    negocio: 'Perfumería',
    metaMensual: parseInt(process.env.META_MENSUAL) || 10000000,
  };

  if (data) {
    for (const row of data) cfg[row.key] = row.value;
  }

  Object.assign(configCache, cfg);
  return configCache;
}

async function actualizarConfig(campos) {
  const rows = Object.entries(campos).map(([key, value]) => ({ key, value: String(value) }));
  await getSupabase().from('config').upsert(rows, { onConflict: 'key' });
  Object.assign(configCache, campos);
}

// ──────────────────────────────────────────────
// REQUERIMIENTOS
// Guardados como JSON en la tabla config (clave: "requerimientos")
// ──────────────────────────────────────────────

async function guardarRequerimiento(descripcion) {
  const client = getSupabase();
  const { data } = await client.from('config').select('value').eq('key', 'requerimientos').single();
  const lista = data?.value ? JSON.parse(data.value) : [];

  const nuevoId = (lista.length > 0 ? Math.max(...lista.map(r => r.id)) : 0) + 1;
  const nuevo = {
    id: nuevoId,
    descripcion,
    fecha: new Date().toISOString(),
    estado: 'pendiente',
  };
  lista.push(nuevo);

  await client.from('config').upsert(
    [{ key: 'requerimientos', value: JSON.stringify(lista) }],
    { onConflict: 'key' }
  );
  return nuevo;
}

async function listarRequerimientos() {
  const { data } = await getSupabase().from('config').select('value').eq('key', 'requerimientos').single();
  return data?.value ? JSON.parse(data.value) : [];
}

module.exports = {
  registrarVenta,
  obtenerVentas,
  guardarDatosPOS,
  obtenerDatosPOS,
  calcularRanking,
  calcularRankingProductos,
  agregarProducto,
  obtenerProductos,
  guardarMensaje,
  obtenerHistorial,
  limpiarHistorial,
  obtenerConfig,
  actualizarConfig,
  guardarRequerimiento,
  listarRequerimientos,
};
