/**
 * email.js — Envío de reportes por Gmail
 */

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: { ciphers: 'SSLv3' },
    });
  }
  return transporter;
}

/**
 * Convierte texto WhatsApp/Markdown a HTML simple para el email
 */
function textoAHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

async function enviarEmail(asunto, cuerpo) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const destino = process.env.EMAIL_DESTINO || process.env.EMAIL_USER;

  try {
    await getTransporter().sendMail({
      from: `"Chu Bot 🤖" <${process.env.EMAIL_USER}>`,
      to: destino,
      subject: `🤖 Chu: ${asunto}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #1a1a2e; color: white; padding: 15px; border-radius: 8px 8px 0 0;">
            <h2 style="margin:0">🤖 Chu — Asistente de Ventas</h2>
            <small style="opacity:0.7">${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</small>
          </div>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #ddd;">
            <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
              ${textoAHtml(cuerpo)}
            </div>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 10px;">
            Perfumería Bot — Reportes automáticos
          </p>
        </div>
      `,
    });
    console.log(`📧 Email enviado a ${destino}`);
  } catch (e) {
    console.error('❌ Error enviando email:', e.message);
  }
}

module.exports = { enviarEmail };
