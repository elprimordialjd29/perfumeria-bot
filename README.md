# 🌺 Bot Vendedor de Perfumería - WhatsApp + Claude AI

Bot inteligente para perfumería que responde WhatsApp, registra ventas automáticamente y envía reportes de ranking.

---

## ⚡ Instalación Rápida

### 1. Configurar API Key

```bash
# Copia el archivo de configuración
cp .env.example .env
```

Edita `.env` y agrega tu API key de Anthropic:
```
ANTHROPIC_API_KEY=sk-ant-tu-key-aqui
```

Obtén tu key en: https://console.anthropic.com

### 2. Iniciar el Bot

```bash
npm start
```

### 3. Escanear QR

- Abre WhatsApp en tu celular
- Ve a **Menú → Dispositivos vinculados → Vincular dispositivo**
- Escanea el QR que aparece en la terminal

✅ **¡Listo! El bot está activo.**

---

## 📱 Primera configuración

Envía este mensaje desde tu WhatsApp al número del bot:
```
/setadmin
```
Esto configura tu número para recibir reportes automáticos.

---

## 🛍️ Agregar productos al catálogo

Como admin, envía al bot:
```
/addproducto Chanel No 5|85000|10
/addproducto Dior Sauvage|95000|5
/addproducto Carolina Herrera 212|75000|8
```
Formato: `/addproducto Nombre|Precio|Stock`

---

## 📊 Comandos del Admin

| Comando | Descripción |
|---------|-------------|
| `/ranking` | Ranking de vendedores hoy |
| `/rankingsemana` | Ranking de la semana |
| `/rankingmes` | Ranking del mes |
| `/productos` | Top productos del mes |
| `/ventas` | Lista de ventas de hoy |
| `/venta Prod\|Precio\|Cant\|Vendedor` | Registrar venta manual |
| `/addproducto Nombre\|Precio\|Stock` | Agregar producto |
| `/reportediario` | Enviar reporte ahora |
| `/reportesemanal` | Enviar reporte semanal ahora |
| `/ayuda` | Ver todos los comandos |

---

## 🤖 Cómo funciona el agente vendedor

Cuando un cliente escribe al WhatsApp:

1. **Claude AI** responde como "Nico", el vendedor virtual
2. Sugiere productos según el gusto del cliente
3. Cuando el cliente confirma una compra, **registra la venta automáticamente**
4. El admin recibe una **notificación inmediata** de cada venta

### Ejemplo de conversación:
```
Cliente: "Busco un perfume para regalar a mi mamá"
Nico:    "¡Hola! 🌺 Con gusto te ayudo. ¿Qué tipo de fragancias 
          le gustan a tu mamá? ¿Florales, orientales o frescas?"
Cliente: "Le gustan las flores"
Nico:    "¡Perfecto! Tenemos el Chanel No 5 a $85,000, 
          ideal para ella. ¿Te lo envuelvo?"
Cliente: "Sí, lo llevo"
Nico:    "✅ ¡Listo! [registra la venta automáticamente]"
```

---

## 📨 Reportes Automáticos

El bot envía reportes automáticamente al número admin:

- **📅 Diario**: Todos los días a las **8:00 PM**
  - Total vendido
  - Ranking de vendedores
  - Top productos

- **📅 Semanal**: Todos los **lunes a las 8:00 AM**
  - Resumen de 7 días
  - Comparativa de vendedores
  - Promedio diario

---

## 📁 Estructura del proyecto

```
perfumeria-bot/
├── index.js        # Bot principal + manejo de mensajes
├── agente.js       # Vendedor virtual con Claude AI
├── database.js     # Base de datos JSON (ventas, productos)
├── reportes.js     # Reportes automáticos con cron
├── data/
│   └── ventas.json # Datos persistentes (se crea automático)
├── .env            # Tu configuración (API key)
└── package.json
```

---

## 🔧 Personalización

Edita `agente.js` para cambiar:
- **Nombre del vendedor** (busca "Nico")
- **Nombre del negocio**
- **Personalidad y tono** del vendedor
- **Horario de reportes** en `reportes.js`

---

## ❓ Solución de problemas

**El QR no aparece:**
- Asegúrate de tener Node.js v16+
- Borra la carpeta `data/.wa-session` y reinicia

**El bot no responde:**
- Verifica que `ANTHROPIC_API_KEY` está en `.env`
- Revisa la consola por errores

**Las ventas no se registran:**
- El agente detecta ventas cuando el cliente confirma
- También puedes registrarlas manualmente con `/venta`
