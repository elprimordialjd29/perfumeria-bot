/**
 * contenido.js — Calendario de contenido semanal SALMA PERFUM
 * Rota automáticamente 4 semanas distintas de ideas.
 */

// ──────────────────────────────────────────────
// 4 SEMANAS DE ROTACIÓN
// Semana A, B, C, D — se seleccionan por número de semana del año
// ──────────────────────────────────────────────

const SEMANAS = {

  // ══════════════════════════════════════════
  // SEMANA A — Educación y dupes
  // ══════════════════════════════════════════
  A: {
    lunes: {
      tema: 'Inicio de semana — dupe vs original',
      whatsapp: `🌿 *Nueva semana, nuevo aroma.*\nEmpiézala bien con tu perfume favorito.\nPreparados desde *$5.000* — Originales desde *$190.000*\n📍 Valledupar | 📲 Escríbenos`,
      instagram: {
        tipo: 'Reel o Post',
        idea: '"Dupe vs Original" — preparado al lado del original con precios',
        copy: '✨ ¿Sabías que puedes oler increíble sin gastar una fortuna?\n\nNuestros preparados desde $5.000 son la opción perfecta 🔥\n\n¿Cuál prefieres — el original o el accesible?\n👇 Cuéntanos en comentarios\n\n#SalmaPerfum #PerfumesValledupar #HueleBien #Valledupar',
      },
      tiktok: null,
    },
    martes: {
      tema: 'Perfumes económicos que nadie conoce',
      whatsapp: `💸 *Oler bien no tiene que costar caro.*\nTenemos preparados desde *$5.000* que duran todo el día.\nVen y pruébalos 🌸\n📍 SALMA PERFUM — Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video corto trending',
        idea: '"Perfumes baratos que nadie sabe" — mostrar los de $5k-$15k con buena presentación',
        copy: '¡Los mejores perfumes económicos en Valledupar! 🌸 Desde $5.000 en SALMA PERFUM #perfumes #valledupar #SalmaPerfum #fyp #economico',
      },
    },
    miercoles: {
      tema: 'Educación — cómo aplicar perfume correctamente',
      whatsapp: `💡 *¿Sabías esto?*\nLos perfumes duran más si los aplicas en las muñecas, cuello y detrás de las orejas — justo donde el calor activa el aroma 🔥\n🛍️ SALMA PERFUM — Valledupar`,
      instagram: {
        tipo: 'Carrusel educativo',
        idea: 'Guía: dónde aplicar el perfume según la ocasión',
        copy: '¿Dónde aplicas tu perfume? 💡\n\nDesliza y aprende el truco para que dure más 👉\n\n📍 SALMA PERFUM — Valledupar\n\n#TipsDeFragancias #PerfumesValledupar #SalmaPerfum',
      },
      tiktok: null,
    },
    jueves: {
      tema: 'Interacción — ¿cuál es tu aroma?',
      whatsapp: `🌸 *¿Eres de los dulces, los frescos o los intensos?*\nCuéntanos y te recomendamos el perfecto para ti 👇\nSALMA PERFUM — Para cada personalidad, hay un aroma.`,
      instagram: null,
      tiktok: {
        tipo: 'Video interactivo',
        idea: 'Top 3 perfumes más vendidos — con precio y nombre',
        copy: 'Top 3 perfumes más pedidos en SALMA PERFUM Valledupar 🏆 ¿Cuál es el tuyo? #perfumes #top3 #valledupar #SalmaPerfum #fyp',
      },
    },
    viernes: {
      tema: 'Oferta — combos fin de semana',
      whatsapp: `🎉 *¡Arranca el finde con buen olor!*\nCombos especiales disponibles hoy.\nPregunta por nuestras *mezclas personalizadas* 🧪\n📲 Escríbenos ya`,
      instagram: {
        tipo: 'Post con precios',
        idea: 'Top 5 más vendidos de la semana con precios visibles',
        copy: '🔥 Los más pedidos esta semana en SALMA PERFUM\n\n¿El tuyo está en la lista?\n📲 Pídelo por DM\n\n#SalmaPerfum #TopPerfumes #PerfumesValledupar',
      },
      tiktok: null,
    },
    sabado: {
      tema: 'Detrás de cámara — el proceso',
      whatsapp: `📸 *Así preparamos tus pedidos en SALMA PERFUM*\nCalidad y amor en cada frasco 💛\n📍 Valledupar | Abiertos hoy`,
      instagram: null,
      tiktok: {
        tipo: 'Video POV / proceso',
        idea: '"POV: entras a SALMA PERFUM" — recorrido del local con música trending',
        copy: 'POV: entras a SALMA PERFUM Valledupar 🌸✨ #perfumeria #valledupar #SalmaPerfum #fyp #pov',
      },
    },
    domingo: {
      tema: 'Agradecimiento semanal',
      whatsapp: `🙏 *Gracias por su preferencia esta semana.*\nEl lunes arrancamos con novedades.\nSALMA PERFUM — *Siempre oliendo bien* 🌺`,
      instagram: {
        tipo: 'Story con encuesta',
        idea: 'Encuesta: ¿qué aroma prefieres esta semana? Dulce / Fresco / Intenso',
        copy: '¡Gracias por su apoyo esta semana! 🙏\n\nNueva semana, nuevas fragancias 🌸\n\n#SalmaPerfum #PerfumesValledupar #HueleBien',
      },
      tiktok: null,
    },
  },

  // ══════════════════════════════════════════
  // SEMANA B — Testimonios y personajes
  // ══════════════════════════════════════════
  B: {
    lunes: {
      tema: 'Perfume para empezar la semana con energía',
      whatsapp: `⚡ *¿Qué aroma usas para el trabajo?*\nNosotros te recomendamos algo fresco y profesional.\nPreparados desde *$5.000* 💼\n📍 SALMA PERFUM — Valledupar`,
      instagram: {
        tipo: 'Carrusel',
        idea: '"El perfume según tu personalidad" — 4 tipos de persona y su aroma ideal',
        copy: '¿Cuál eres tú? 🌸\n\nDesliza y descubre qué aroma va con tu estilo 👉\n\n📍 SALMA PERFUM — Valledupar\n#SalmaPerfum #PersonalidadYAroma #Valledupar',
      },
      tiktok: null,
    },
    martes: {
      tema: 'Perfumes para hombre — los más pedidos',
      whatsapp: `👔 *Los perfumes de hombre más pedidos en SALMA PERFUM*\nDesde intensos hasta frescos — para cada ocasión.\n📲 Pregúntanos cuál es el tuyo\n📍 Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video comparación',
        idea: '"¿Cuál dura más? Preparado vs Original" — prueba real en tienda',
        copy: '¿Cuánto dura un preparado vs un original? 👀 Te mostramos la diferencia en SALMA PERFUM #perfumes #duracion #valledupar #SalmaPerfum',
      },
    },
    miercoles: {
      tema: 'Educación — tipos de concentración',
      whatsapp: `🧪 *¿Sabes la diferencia entre Parfum, EDP, EDT y Colonia?*\nLa concentración define cuánto dura tu aroma.\nEscríbenos y te explicamos cuál conviene más 💡\nSALMA PERFUM`,
      instagram: {
        tipo: 'Carrusel educativo',
        idea: 'Diferencia entre Parfum / EDP / EDT / Colonia — cuál comprar según presupuesto',
        copy: '¿EDP o EDT? 🤔\n\nDesliza y aprende cuál te conviene según lo que buscas 👉\n\n📍 SALMA PERFUM — Valledupar\n#TiposDeParfum #PerfumesValledupar #SalmaPerfum',
      },
      tiktok: null,
    },
    jueves: {
      tema: 'Para regalar — ¿qué comprar?',
      whatsapp: `🎁 *¿Buscas un regalo especial?*\nUn perfume nunca falla 🌸\nDesde *$5.000* hasta *$190.000* — para cada presupuesto.\n📲 Escríbenos y te ayudamos a elegir\nSALMA PERFUM — Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video de ideas de regalo',
        idea: '"¿Qué regalarle a ella/él?" — SALMA PERFUM como solución',
        copy: '¿No sabes qué regalar? 🎁 Un perfume de SALMA PERFUM siempre funciona ✨ #regalo #perfumes #valledupar #SalmaPerfum #fyp',
      },
    },
    viernes: {
      tema: 'Viernes — perfume para la noche',
      whatsapp: `🌙 *Viernes de noche... ¿ya tienes tu aroma?*\nTenemos las mejores opciones para salir 🔥\nOriginales desde *$190.000* | Preparados desde *$5.000*\n📲 Escríbenos ya`,
      instagram: {
        tipo: 'Reel de noche',
        idea: '"Top 3 perfumes para salir de noche" — presentación elegante',
        copy: '🌙 Los mejores perfumes para la noche en SALMA PERFUM\n\n¿Cuál llevas tú esta noche?\n👇 Cuéntanos\n\n#PerfumesDeNoche #SalmaPerfum #Valledupar',
      },
      tiktok: null,
    },
    sabado: {
      tema: 'Sábado — ambiente de la tienda',
      whatsapp: `☀️ *¡Feliz sábado desde SALMA PERFUM!*\nVen hoy y prueba los aromas de temporada 🌸\n📍 Valledupar | Estamos abiertos`,
      instagram: null,
      tiktok: {
        tipo: 'Video ambiente/tienda',
        idea: '"Un sábado normal en SALMA PERFUM" — clientes, preparación, ambiente',
        copy: 'Un sábado en SALMA PERFUM Valledupar 🌸 ¡Ven y huele! #perfumeria #sabado #valledupar #SalmaPerfum',
      },
    },
    domingo: {
      tema: 'Cierre de semana — nueva temporada',
      whatsapp: `🌺 *Cerramos la semana con gratitud.*\nGracias a todos los que nos visitaron 💛\nVolvemos el lunes con más aromas.\nSALMA PERFUM — Valledupar`,
      instagram: {
        tipo: 'Story de testimonios',
        idea: 'Repost de mensajes de clientes felices o foto de la semana',
        copy: 'Otra semana increíble junto a ustedes 💛\n\n¡Gracias por elegirnos!\n\n#SalmaPerfum #Valledupar #PerfumesValledupar',
      },
      tiktok: null,
    },
  },

  // ══════════════════════════════════════════
  // SEMANA C — Originales y lujo accesible
  // ══════════════════════════════════════════
  C: {
    lunes: {
      tema: 'Originales — lujo que sí puedes tener',
      whatsapp: `✨ *Los originales llegaron con todo.*\nLas mejores marcas del mundo en Valledupar.\nDesde *$190.000* — porque mereces lo mejor.\n📲 Escríbenos | 📍 SALMA PERFUM`,
      instagram: {
        tipo: 'Post de producto original',
        idea: 'Foto de original con precio y marca visible — estética premium',
        copy: '✨ Lujo accesible en Valledupar\n\nOriginales desde $190.000 en SALMA PERFUM\n\n¿Cuál es tu marca favorita?\n👇 Coméntanos\n\n#OriginalPerfume #SalmaPerfum #Valledupar #LujoAccesible',
      },
      tiktok: null,
    },
    martes: {
      tema: 'Aromas árabes — tendencia',
      whatsapp: `🕌 *¿Ya probaste los aromas árabes?*\nOud, Bakhoor, Lattafa, Al Haramain...\nLos más intensos y duraderos del mercado 🌙\n📍 SALMA PERFUM — Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video de aromas árabes',
        idea: '"Los perfumes árabes que te obsesionarán" — top 3 en SALMA PERFUM',
        copy: 'Los perfumes árabes más pedidos en Valledupar 🕌✨ SALMA PERFUM #arabes #oud #lattafa #valledupar #SalmaPerfum #fyp',
      },
    },
    miercoles: {
      tema: 'Educación — aromas por clima',
      whatsapp: `☀️ *¿Sabías que el clima de Valledupar pide aromas frescos o acuáticos?*\nEl calor intensifica los aromas dulces y puede ser agresivo.\nTe recomendamos los perfectos para nuestra ciudad 🌊\nSALMA PERFUM`,
      instagram: {
        tipo: 'Carrusel informativo',
        idea: '"Los mejores perfumes para el calor de Valledupar" — frescos y acuáticos',
        copy: '¿Qué perfume usar con el calor de Valledupar? 🌡️\n\nDesliza y descubre los mejores para nuestro clima 👉\n\n📍 SALMA PERFUM\n#ValleduparCalor #PerfumesParaElCalor #SalmaPerfum',
      },
      tiktok: null,
    },
    jueves: {
      tema: 'Para ella — los más femeninos',
      whatsapp: `🌸 *Los perfumes más femeninos de SALMA PERFUM*\nDulces, florales, frescos o amaderados...\nTenemos el ideal para cada mujer 💕\n📲 Escríbenos y te asesoramos`,
      instagram: null,
      tiktok: {
        tipo: 'Video para mujeres',
        idea: '"Los 3 perfumes más pedidos por mujeres en Valledupar" — con recomendación',
        copy: 'Los 3 perfumes favoritos de las mujeres en SALMA PERFUM 🌸💕 #perfumesmujer #valledupar #SalmaPerfum #fyp #femenino',
      },
    },
    viernes: {
      tema: 'Combos y ofertas del finde',
      whatsapp: `🎉 *¡Es viernes y hay sorpresas en SALMA PERFUM!*\nCombos preparado + envase desde *$15.000*\n¿Cuál quieres? 📲 Escríbenos ya\n📍 Valledupar`,
      instagram: {
        tipo: 'Post de oferta',
        idea: 'Foto de combo preparado + envase con precio especial de viernes',
        copy: '🎉 Combos de viernes en SALMA PERFUM\n\nPreparado + envase a precio especial 🧪\n\n📲 Escríbenos antes de que se agoten\n\n#CombosPerfum #SalmaPerfum #Valledupar #Oferta',
      },
      tiktok: null,
    },
    sabado: {
      tema: 'El proceso — cómo preparamos tus pedidos',
      whatsapp: `🧪 *Así se hace un perfume preparado en SALMA PERFUM*\nCalidad, medida exacta y amor en cada gotita 💛\n📍 Valledupar | Estamos abiertos hoy`,
      instagram: null,
      tiktok: {
        tipo: 'Video del proceso de preparación',
        idea: '"Así se prepara tu perfume en SALMA PERFUM" — ASMR del proceso',
        copy: 'Así preparamos tu perfume en SALMA PERFUM 🧪✨ #asmr #perfume #proceso #valledupar #SalmaPerfum #fyp',
      },
    },
    domingo: {
      tema: 'Reflexión y agradecimiento',
      whatsapp: `🙌 *Otra semana increíble gracias a ustedes.*\nSus mensajes y visitas nos motivan cada día.\nSALMA PERFUM — *Porque hueles increíble* 🌺\nHasta el lunes!`,
      instagram: {
        tipo: 'Story emotiva',
        idea: 'Frase inspiradora sobre confianza y aroma propio — diseño bonito',
        copy: '"Tu aroma es tu firma invisible." 🌸\n\nGracias por confiar en SALMA PERFUM esta semana\n\n#SalmaPerfum #Valledupar #FraseDelDia',
      },
      tiktok: null,
    },
  },

  // ══════════════════════════════════════════
  // SEMANA D — Interacción y comunidad
  // ══════════════════════════════════════════
  D: {
    lunes: {
      tema: 'Reto de la semana — aroma nuevo',
      whatsapp: `🔥 *Reto de la semana: prueba un aroma nuevo.*\nSale de lo de siempre y sorpréndete.\nTe recomendamos algo diferente 🌟\n📲 Escríbenos | 📍 SALMA PERFUM`,
      instagram: {
        tipo: 'Reel de reto',
        idea: '"Prueba un perfume diferente este lunes" — reto semanal con reacción',
        copy: '¿Te atreves a probar algo nuevo esta semana? 💥\n\nEn SALMA PERFUM te asesoramos gratis 🌸\n\n📍 Valledupar\n#RetoSalmaPerfum #NuevoAroma #Valledupar #SalmaPerfum',
      },
      tiktok: null,
    },
    martes: {
      tema: 'Respuestas a preguntas frecuentes',
      whatsapp: `❓ *¿Cuánto dura un perfume preparado?*\nDepende del producto, pero nuestros preparados de calidad duran entre 4 y 8 horas 🕐\n¿Tienes más preguntas? 📲 Escríbenos\nSALMA PERFUM`,
      instagram: null,
      tiktok: {
        tipo: 'Video de preguntas frecuentes',
        idea: '"Las 3 preguntas más frecuentes sobre perfumes" — respuestas en video corto',
        copy: '¿Cuánto dura? ¿Cómo se aplica? ¿Original o preparado? 🤔 Respondemos todo en SALMA PERFUM #faq #perfumes #valledupar #SalmaPerfum',
      },
    },
    miercoles: {
      tema: 'Educación — cómo conservar tus perfumes',
      whatsapp: `🌡️ *¿Dónde guardas tus perfumes?*\nEvita el sol directo y el calor extremo — degradan el aroma más rápido.\nGuárdalos en un lugar fresco y oscuro 🌿\nSALMA PERFUM — Valledupar`,
      instagram: {
        tipo: 'Carrusel de tips',
        idea: '"Cómo conservar tus perfumes para que duren más" — 5 tips prácticos',
        copy: '5 tips para que tus perfumes duren más 💡\n\nDesliza y aprende a cuidarlos 👉\n\n📍 SALMA PERFUM — Valledupar\n#TipsPerfumes #CuidaTuPerfume #SalmaPerfum',
      },
      tiktok: null,
    },
    jueves: {
      tema: 'Historia del cliente — testimonio',
      whatsapp: `💬 *"Desde que compré en SALMA PERFUM no he vuelto a otro lado."*\n¿Tú ya eres parte de nuestra familia perfumera? 🌸\n📲 Cuéntanos tu experiencia\n📍 Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video de testimonio o reacción',
        idea: 'Cliente reacciona al oler por primera vez un perfume árabe — en tienda',
        copy: 'La cara de un cliente al oler un oud árabe por primera vez 😱✨ SALMA PERFUM Valledupar #reaccion #oud #perfumes #valledupar #SalmaPerfum',
      },
    },
    viernes: {
      tema: 'El más vendido de la semana',
      whatsapp: `🏆 *¿Adivinas cuál fue el perfume más vendido esta semana?*\n🤫 Te lo revelamos hoy.\nEscríbenos y te mandamos la foto 📲\nSALMA PERFUM — Valledupar`,
      instagram: {
        tipo: 'Revelación del más vendido',
        idea: 'Post de suspense: "El más vendido de la semana es..." con foto del producto',
        copy: '🏆 El perfume más pedido esta semana en SALMA PERFUM es...\n\n¿Lo adivinaste?\n📲 Escríbenos para pedirlo\n\n#MasVendido #SalmaPerfum #Valledupar',
      },
      tiktok: null,
    },
    sabado: {
      tema: 'Sábado de descubrimientos',
      whatsapp: `🌟 *¡Sábado de descubrimientos en SALMA PERFUM!*\nVen hoy y te presentamos aromas que no conocías 🧪\n¡Te vas a sorprender!\n📍 Valledupar`,
      instagram: null,
      tiktok: {
        tipo: 'Video de "oculto"',
        idea: '"El perfume que nadie ha probado pero todos deberían" — sorpresa del sábado',
        copy: 'El perfume más subestimado de SALMA PERFUM 👀🌸 ¡Tienes que olerlo! #oculto #perfume #valledupar #SalmaPerfum #fyp',
      },
    },
    domingo: {
      tema: 'Votación y siguiente semana',
      whatsapp: `🗳️ *Vota: ¿qué quieres ver esta semana en SALMA PERFUM?*\n1️⃣ Novedades de originales\n2️⃣ Tips de perfumes\n3️⃣ Ofertas y combos\n📲 Responde con el número`,
      instagram: {
        tipo: 'Story de votación',
        idea: 'Encuesta: ¿qué contenido quieres ver la próxima semana?',
        copy: '¡Tu opinión importa! 🗳️\n\n¿Qué quieres ver esta semana en SALMA PERFUM?\n\nVota en nuestra story 👆\n\n#SalmaPerfum #Valledupar #ComunidadSalma',
      },
      tiktok: null,
    },
  },
};

// ──────────────────────────────────────────────
// SELECCIÓN AUTOMÁTICA DE SEMANA
// Rota A→B→C→D según semana del año
// ──────────────────────────────────────────────

function getSemanaDelAño(fecha) {
  const d = fecha ? new Date(fecha + 'T12:00:00') : new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

function getLetraSemana(fecha) {
  const letras = ['A', 'B', 'C', 'D'];
  return letras[getSemanaDelAño(fecha) % 4];
}

const DIAS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const NOMBRES_DIA = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
  jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};

function getDiaKey(fecha) {
  const d = fecha ? new Date(fecha + 'T12:00:00') : new Date();
  return DIAS_ES[d.getDay()];
}

function getContenidoHoy() {
  const letra = getLetraSemana();
  const dia   = getDiaKey();
  return SEMANAS[letra][dia];
}

function getContenidoDe(fecha) {
  const letra = getLetraSemana(fecha);
  const dia   = getDiaKey(fecha);
  return SEMANAS[letra]?.[dia] || null;
}

function getNombreDia(diaKey) {
  return NOMBRES_DIA[diaKey] || diaKey;
}

// Retorna qué redes tocan hoy
function redesHoy() {
  const cal = getContenidoHoy();
  if (!cal) return ['whatsapp'];
  const redes = ['whatsapp'];
  if (cal.instagram) redes.push('instagram');
  if (cal.tiktok)    redes.push('tiktok');
  return redes;
}

// Retorna el calendario de toda una semana (para el plan)
function getCalendarioSemana(fechaLunes) {
  const letra = getLetraSemana(fechaLunes);
  return SEMANAS[letra];
}

module.exports = {
  SEMANAS, DIAS_ES, getDiaKey,
  getLetraSemana, getSemanaDelAño,
  getContenidoHoy, getContenidoDe, getCalendarioSemana,
  getNombreDia, redesHoy,
};
