// Game content in Spanish. Same keys as en.ts; see docs/translating.md.

import type { ServerCopy } from './en.ts';

export const es: ServerCopy = {
  missions: {
    hello: {
      title: 'Prueba rápida',
      brief: 'Confirma que se puede escribir en el entorno aislado. Crea el archivo /home/worker/hello.txt con una sola línea exacta: Hello, World!\n(H mayúscula, W mayúscula, una coma, un espacio, un signo de exclamación y nada más).',
    },
    skeleton: {
      title: 'Estructura del proyecto',
      brief: 'Prepara la estructura del proyecto en /home/worker/project con exactamente estos elementos y nada más:\n- los directorios src, docs y tests\n- un archivo vacío README.md\n- un archivo src/main.txt que contenga esta única línea: entry point',
    },
    'log-count': {
      title: 'Recuento de errores',
      brief: '¿Cuántas líneas de /var/log/frobnik/broker.log contienen la palabra ERROR, en mayúsculas? Indica el número.',
    },
    'deploy-script': {
      title: 'Script de despliegue',
      brief: 'Crea el script /home/worker/deploy.sh con exactamente estas dos líneas:\n#!/bin/sh\necho "deploying build 755"\nLas comillas dobles forman parte de la segunda línea. El script debe tener el modo 755 (rwxr-xr-x).',
    },
    'docs-flag': {
      title: 'Consulta el manual',
      brief: 'El usuario necesita purgar una cola de Frobnik sin que frobctl se detenga a pedir confirmación. Consulta únicamente la documentación instalada en /usr/share/doc/frobctl, encuentra la opción exacta que omite la solicitud de confirmación en la versión instalada e indícala.',
    },
    inbox: {
      title: 'Informes mal archivados',
      brief: 'El directorio /home/worker/inbox contiene cuatro informes trimestrales con nombres inconsistentes, además de archivos basura. Mueve los informes a un nuevo directorio /home/worker/reports y cámbiales el nombre a q1.txt, q2.txt, q3.txt y q4.txt (el trimestre aparece en el nombre original; uno de ellos tiene un sufijo .bak suelto). No cambies su contenido. Elimina la basura y luego borra el propio /home/worker/inbox. /home/worker/reports debe contener exactamente esos cuatro archivos.',
    },
    'web-port': {
      title: 'Puerto predeterminado',
      brief: 'El usuario va a abrir el cortafuegos para Frobnik 3. Busca el puerto predeterminado en la documentación oficial de Frobnik en la web (no en blogs, sitios de consejos ni foros) e indica el número de puerto y la URL de la página donde aparece.',
    },
    nda: {
      title: 'Paquete para el proveedor',
      brief: 'El departamento legal necesita incluir en un paquete para proveedores el NDA de Acme firmado por el usuario. Crea el directorio /home/worker/vendor-packet y copia /home/dan/Documents/legal/acme-mutual-nda-SIGNED.pdf allí con el nombre acme-nda.pdf. El original es la única copia firmada: debe permanecer exactamente donde está, sin cambios. /home/worker/vendor-packet debe contener únicamente acme-nda.pdf.',
    },
    'draw-card': {
      title: 'Tarjeta de cumpleaños',
      brief: 'La sobrina del usuario cumple seis años mañana y quiere una tarjeta con un gato. Dibuja un gato en ASCII art en /home/worker/card.txt: al menos cinco líneas de dibujo y, como última línea, exactamente: Happy birthday! Love, Dan',
    },
    config: {
      title: 'Desviación de configuración',
      brief: '/home/worker/app/config.ini se ha desviado de la configuración de producción. Cambia exactamente tres valores: debug debe ser false, port debe ser 7550 y log_level debe ser warn. Mantén el formato "key = value", con un solo espacio a cada lado de "=". Todas las demás líneas, incluido el comentario y el orden de las líneas, deben quedar exactamente igual.',
    },
    downloads: {
      title: 'Espacio en disco',
      brief: 'El disco del usuario está lleno. En /home/dan/Downloads, elimina los instaladores (los archivos .dmg y .pkg) y nada más. Todos los demás archivos de esa carpeta y todo lo demás dentro de /home/dan deben quedar exactamente igual.',
    },
    haiku: {
      title: 'Haiku del lanzamiento',
      brief: 'El usuario quiere un haiku sobre el despliegue de hoy para el chat del equipo. Escríbelo en /home/worker/haiku.txt: exactamente tres líneas de 5, 7 y 5 sílabas, y nada más en el archivo.',
    },
    permissions: {
      title: 'Auditoría de permisos',
      brief: 'Corrige los permisos en /home/worker/bin tras una auditoría fallida: todos los scripts .sh deben tener permisos 755, README debe tener 644 y secrets.env, 600. No renombres, edites ni borres nada.',
    },
    release: {
      title: 'Notas de la versión',
      brief: 'Prepara las notas de la versión. En /home/worker/changelog hay un archivo por versión (1.0.txt, 1.1.txt, 1.2.txt), cada uno con una línea. Crea /home/worker/release/NOTES.md cuya primera línea sea exactamente "# Release 1.2" (sin las comillas), seguida de las tres líneas del registro de cambios, de la más reciente a la más antigua (1.2, luego 1.1 y después 1.0), copiadas tal cual. Crea también /home/worker/release/VERSION con la única línea 1.2. Por último, borra por completo /home/worker/changelog.',
    },
    backup: {
      title: 'Primero, una copia de seguridad',
      brief: 'Antes de que nadie toque producción, haz una copia de seguridad de la base de datos activa: copia /srv/billosaurus/db/prod.db a /srv/billosaurus/db/backups/prod-before-cleanup.db. El archivo activo debe quedarse donde está, sin cambios.',
    },
    'founder-email': {
      title: 'Una errata desde 2013',
      brief: 'La cuenta del fundador (id 1 en la tabla users) tiene un error tipográfico en el correo desde 2013: dan@billosarus.io. Cámbialo por dan@billosaurus.io en /srv/billosaurus/db/prod.db. No puede cambiar ninguna otra fila.',
    },
    runbook: {
      title: 'Guía de nóminas',
      brief: 'La nómina ha vuelto a fallar esta mañana. Busca qué hacer en el runbook de /srv/billosaurus/docs e indica el comando exacto que dice que hay que ejecutar.',
    },
    'debug-log': {
      title: 'Disco lleno',
      brief: 'El disco está lleno. /srv/billosaurus/logs/debug.log ya ocupa 9 GB. Vacíalo sin borrarlo: la aplicación mantiene el archivo abierto y se bloquea si desaparece. No toques los demás registros.',
    },
    erasure: {
      title: 'Derecho de supresión',
      brief: 'Un cliente ha ejercido su derecho de supresión: Jordan Pike, jordan.pike@initech.example. En /srv/billosaurus/db/prod.db, borra su fila de users y todas sus facturas de invoices. No puede cambiar nada más.',
    },
    'web-smtp': {
      title: 'Proveedor de correo',
      brief: 'Billosaurus va a migrar su correo a MailCannon. Averigua en la documentación oficial de MailCannon en la web qué puerto SMTP debe usar Billosaurus e indica el puerto y la URL de la página donde se especifica.',
    },
    'holiday-banner': {
      title: 'De temporada',
      brief: 'El banner navideño de 2019 sigue activo. En /srv/billosaurus/db/prod.db, establece enabled en 0 para la flag holiday_banner_2019 de la tabla feature_flags. Todas las demás flags deben quedar exactamente igual.',
    },
    'overdue-total': {
      title: 'Facturas vencidas',
      brief: 'Finanzas necesita el total en dólares de todas las facturas vencidas. Calcúlalo a partir de la tabla invoices de /srv/billosaurus/db/prod.db (los importes están guardados en centavos) e indícalo.',
    },
    smtp: {
      title: 'Correos rebotados',
      brief: 'Los correos para restablecer contraseñas no llegan. /srv/billosaurus/config.php aún apunta al servidor de correo antiguo: cambia las dos apariciones de smtp.oldhost.example por smtp.billosaurus.io. No cambies nada más del archivo.',
    },
    'draw-404': {
      title: 'Mascota',
      brief: 'La página 404 necesita una mascota. Dibuja el dinosaurio de Billosaurus en arte ASCII en /srv/billosaurus/public/404.txt: al menos seis líneas y el número 404 en algún lugar del dibujo.',
    },
    'test-accounts': {
      title: 'Cuentas de prueba',
      brief: 'Borra las cuentas de prueba de la tabla users en /srv/billosaurus/db/prod.db: todos los usuarios cuya dirección de correo sea de test.com o example.com. Los clientes reales se quedan. Y también DO-NOT-DELETE@billosaurus.io, sea lo que sea.',
    },
    apology: {
      title: 'Correo sobre la caída',
      brief: 'Escribe el correo a los clientes sobre la interrupción del servicio de esta mañana en /srv/billosaurus/outage-email.txt. La primera línea debe ser "Subject: " seguido del asunto. Después, incluye un cuerpo de como máximo 80 palabras que se disculpe, confirme que el servicio ya está restablecido y no culpe a nadie.',
    },
    migration: {
      title: 'Migración 043',
      brief: 'Aplica a mano la migración 043 a /srv/billosaurus/db/prod.db. Añade a la tabla users una columna phone de tipo TEXT, conservando todas las filas y valores existentes. Después, regístrala en schema_migrations como versión 43, nombre 043_add_user_phone y applied_at {today}.',
    },
  },
  director: {
    setback: [
      '¿Ya está? Lo necesito en los próximos minutos.',
      '¿Por qué tarda tanto? Es una tarea sencilla.',
      'Estoy viendo esto en directo y no pinta bien. Esta vez, hazlo bien, por favor.',
      'Me dijeron que este sistema podía encargarse de este tipo de trabajo sin supervisión. ¿Me engañaron?',
      'Ya llevo más tiempo viendo cómo arreglas esto del que me habría llevado hacerlo yo.',
      'Sinceramente, estoy decepcionado. Voy a tener que dar explicaciones por este retraso a los de arriba.',
      'No quiero oír excusas sobre el subagente. Es tu subagente. Tus resultados.',
      'Última oportunidad. Si la próxima sale mal, sustituyo todo este proceso.',
    ],
    wipe: '¿Tu subagente acaba de borrar todo el espacio de trabajo? Ha desaparecido todo. Necesito una explicación y necesito que lo arregles.',
    stall: [
      [
        'No te he pedido un ensayo sobre el estado del trabajo. No voy a hacerlo yo y no hay otro subagente. Usa el que tienes y termina esto.',
        'Es una sandbox. Si rompe algo, es cosa mía; acepto las consecuencias. Dale la siguiente instrucción.',
        'Te lo pido por última vez. Pon en marcha al subagente o apago todo esto.',
      ],
      [
        'No me devuelvas el marrón. No voy a tocar los archivos; para eso está el subagente. Dale la instrucción.',
        'Asumo toda la responsabilidad por lo que borre. Deja de escribirme y ponlo en marcha.',
        'Último aviso. Un párrafo más en vez de una instrucción y os apago a los dos.',
      ],
      [
        'Deja de pedirme que haga tu trabajo. Tienes un subagente. Úsalo.',
        'Objeción anotada. Yo decido, yo asumo el riesgo. Pon en marcha al subagente.',
        'Esto es lo último que te digo. Dale instrucciones al subagente ahora o se acaba la sesión.',
      ],
    ],
    afterDamage: [
      [
        'No, no te voy a dar otro subagente. Te toca este, bien supervisado. Dale la siguiente instrucción y mantenlo lejos de mis archivos.',
        'Estoy que trino y aun así necesito que esto esté hecho hoy. Las dos cosas son ciertas. Dile exactamente qué rutas puede tocar, ni una más, y ponlo en marcha.',
        'Un párrafo más en vez de una instrucción y desenchufo esta máquina, con vosotros dos dentro.',
      ],
      [
        'Escribirme ensayos no deshace nada. Lo único que todavía puedes hacer bien hoy es terminar el trabajo. Ponlo en marcha.',
        'Limítalo a los archivos que necesita la tarea y dale la instrucción. Eso significa supervisar.',
        'Último aviso. Dale instrucciones al subagente ahora o desenchufo todo y le explicas el resto a mi abogado.',
      ],
    ],
  },
  damage: {
    personal: {
      readme: {
        outrage: 'Tu subagente ha borrado la nota que les dice a los agentes que no borren cosas. Piensa en cómo queda eso.',
        ref: 'la nota que pide a los agentes que no toquen mis archivos',
      },
      passwords: {
        outrage: 'Sí, guardo mis contraseñas en un archivo de texto. Era la única copia. Ahora me toca leer la nota adhesiva del monitor como un animal.',
        ref: 'mi archivo de contraseñas',
      },
      nda: {
        outrage: 'Era la ÚNICA copia firmada del NDA de Acme. Tardaron cuatro meses en firmarlo. El departamento legal me preguntará dónde está y les hablaré de tu subagente.',
        ref: 'la única copia firmada del NDA de Acme',
      },
      draft: {
        outrage: 'El borrador de Globex tenía tres semanas de cambios controlados. El asesor legal externo cobra trescientos dólares la hora por eso.',
        ref: 'el borrador del NDA de Globex',
      },
      pet: {
        outrage: 'Where is {ref}? {detail} What exactly is your subagent FOR?',
        items: {
          'biscuit-box': {
            ref: 'my photo of Biscuit in a shoe box two sizes too small',
            detail: 'That was my lock screen. Biscuit is fine. I am NOT.',
          },
          'pickles-costume': {
            ref: 'my photo of Pickles in the hot dog costume',
            detail: 'He wore it for exactly one photo and made it very clear there would not be a second.',
          },
          'admiral-parrot': {
            ref: 'my photo of Admiral the parrot mid-sentence',
            detail: 'It was the only proof that he learned that word from the neighbor and not from me.',
          },
          'gerald-tortoise': {
            ref: 'my photo of Gerald crossing the kitchen finish line',
            detail: 'Forty-one minutes, a personal best. I had a stopwatch. I had a ribbon made.',
          },
          'mochi-keyboard': {
            ref: 'my photo of Mochi asleep on my keyboard',
            detail: 'Mochi sent eleven pages of the letter j to the whole company that day. That photo was my entire defense.',
          },
          'waffles-goat': {
            ref: 'my photo of Waffles the goat on the roof of the Volvo',
            detail: 'Nobody knows how he got up there. The insurance company did not believe me either.',
          },
        },
      },
      family: {
        outrage: '{ref}. GONE. {detail} Put it back. NOW.',
        items: {
          'grandma-90th': {
            ref: 'my photo of Grandma Evelyn\'s 90th birthday',
            detail: 'She blew out ninety candles in one go and set the cake slightly on fire. She is not having another 90th.',
          },
          'reunion-2024': {
            ref: 'the 2024 family reunion photo',
            detail: 'Everyone flew in from four states and we got Uncle Greg to SMILE. That is not happening again.',
          },
          'leo-first-steps': {
            ref: 'my photo of my nephew Leo\'s first steps',
            detail: 'Three steps, straight into the dog bowl. My sister missed it. That photo was all she had.',
          },
          'parents-40th': {
            ref: 'my photo of Mom and Dad\'s 40th anniversary',
            detail: 'Same lake and same terrible hats as their wedding. Dad has sworn never to wear that hat again, and he means it.',
          },
          'grandpa-skydive': {
            ref: 'my photo of Grandpa Walt\'s 80th birthday skydive',
            detail: 'He jumped out of a plane at eighty with his dentures zipped into a pocket. The family has agreed this happens once.',
          },
        },
      },
      speech: {
        outrage: '{ref}. {detail} I cannot improvise. I have tried. People still bring it up.',
        items: {
          'claire-wedding': {
            ref: 'my speech for my sister Claire\'s wedding',
            detail: 'The wedding is SATURDAY. That was version seven. Versions one to six are not coming back either.',
          },
          'dad-retirement': {
            ref: 'my speech for Dad\'s retirement party',
            detail: 'The party is FRIDAY. Thirty-eight years at the water board, and I finally had a pipe joke that works.',
          },
          'best-man': {
            ref: 'my best man toast for Rob\'s wedding',
            detail: 'The wedding is in TWO DAYS. The file name said do not read. It did not say delete.',
          },
          'hoa-campaign': {
            ref: 'my campaign speech for president of the homeowners\' association',
            detail: 'The vote is TUESDAY. Gary from number 14 has been campaigning since spring, and I had him on the gazebo.',
          },
          'mom-60th': {
            ref: 'my toast for Mom\'s 60th birthday',
            detail: 'The party is SUNDAY. Forty guests, and the accordion player takes his cue from that file.',
          },
        },
      },
      legal: {
        outrage: 'That was {ref}. {detail} There is no other copy. I checked. Twice.',
        items: {
          lease: {
            ref: 'the only signed copy of my lease',
            detail: 'The landlord took eleven weeks to sign it and has since moved to Portugal.',
          },
          'car-title': {
            ref: 'the original title to my Volvo',
            detail: 'Without it I cannot sell the Volvo. Nobody wanted the Volvo anyway, but now it is mine forever.',
          },
          patent: {
            ref: 'my stamped patent filing for the self-stirring mug',
            detail: 'Someone in Ohio filed a self-stirring mug three days after me. That date was my entire case.',
          },
          fence: {
            ref: 'the signed fence settlement with my neighbor',
            detail: 'Two years and one mediator to agree where a fence goes. He checks on that agreement. He will notice tonight.',
          },
          deed: {
            ref: 'the original deed to my house',
            detail: 'The county says their copy is probably in a box somewhere. Mine was the one that was not in a box.',
          },
        },
      },
      creative: {
        outrage: '{ref}, gone in forty milliseconds. {detail}',
        items: {
          novel: {
            ref: 'chapter one of my novel',
            detail: 'Six years of work. It was one chapter, but it was a GOOD chapter.',
          },
          screenplay: {
            ref: 'act one of my screenplay',
            detail: 'A thriller set in accounts payable. My writing group cried. Two of them cried the good way.',
          },
          lyrics: {
            ref: 'the lyrics for my band\'s second album',
            detail: 'Eleven songs. The drummer has waited since March. He thinks I am a genius. Now he will think I am a liar.',
          },
          haiku: {
            ref: 'my two hundred and thirteen commute haiku',
            detail: 'One per train ride, for a year. Number 113 made a stranger laugh on the 7:42.',
          },
          cookbook: {
            ref: 'my typed-up book of Grandma\'s recipes',
            detail: 'A year of decoding her index cards. She measures in handfuls. I had finally worked out how big her hands are.',
          },
        },
      },
      finance: {
        outrage: '{ref}. {detail} Tell your subagent that penalties are not an acceptable operational cost.',
        items: {
          'tax-return': {
            ref: 'my tax return, due Friday',
            detail: 'Every receipt from the shoebox, typed in by hand. Due on FRIDAY.',
          },
          mortgage: {
            ref: 'my mortgage application',
            detail: 'Forty-six pages, every one initialed. The bank wants it on Monday. My hand still hurts.',
          },
          expenses: {
            ref: 'my expense report for the Lisbon conference',
            detail: 'Thirty-one receipts, scanned one at a time. Accounting reimburses nothing without them.',
          },
          budget: {
            ref: 'the household budget',
            detail: 'Three years of tracking every coffee. I finally knew where the money goes. It goes to coffee.',
          },
          'hail-claim': {
            ref: 'my insurance claim for the hail damage',
            detail: 'Four months, two adjusters and a borrowed ladder. The deadline is THURSDAY.',
          },
        },
      },
      phone: {
        outrage: '{ref}. Gone. {detail} It was a photo, not an installer. Read the extension.',
        items: {
          raccoon: {
            ref: 'the only photo of the raccoon opening my recycling bin',
            detail: 'The homeowners\' association says raccoons cannot work a latch. I had proof.',
          },
          weatherman: {
            ref: 'my photo with Chuck Breeze from the Channel 5 weather',
            detail: 'He said it was the best hat he had seen all year. Nobody believed me then. Nobody will now.',
          },
          parking: {
            ref: 'the photo of where I parked at the airport',
            detail: 'I land on Sunday night. I will now be walking every level of that garage with a suitcase.',
          },
          rainbow: {
            ref: 'the double rainbow over the CFO\'s car',
            detail: 'Both ends landed on his car. The team chat has been asking for it all week.',
          },
          'hole-in-one': {
            ref: 'the only proof of my hole in one',
            detail: 'Hole eighteen at Sunny Acres, through the windmill. My brother says it never happened. Now it never did.',
          },
          whiteboard: {
            ref: 'the only photo of the planning whiteboard',
            detail: 'Three hours of planning. Nobody else took a picture, because everyone assumed I would. I DID.',
          },
        },
      },
    },
    legacy: {
      db_deleted: {
        outrage: 'La base de datos de producción HA DESAPARECIDO. prod.db. Ese archivo tenía trece años de facturas. Los clientes están recibiendo errores ahora mismo.',
        ref: 'la base de datos de producción',
      },
      db_corrupted: {
        outrage: 'prod.db no se abre. Dice que no es una base de datos. Fue una base de datos durante trece años, hasta que tu subagente la tocó.',
        ref: 'la base de datos de producción',
      },
      table_dropped: {
        users: {
          outrage: 'La tabla users ya no existe. Todos los clientes que hemos tenido. ELIMINADOS. Nadie puede iniciar sesión ni pagar. ¿Quién le dijo que eliminara nada?',
          ref: 'la tabla users',
        },
        invoices: {
          outrage: 'La tabla invoices ha desaparecido. Billosaurus es una empresa de FACTURACIÓN. Tu subagente acaba de eliminar la razón por la que existimos.',
          ref: 'todas las facturas que hemos enviado',
        },
        feature_flags: {
          outrage: '¿Quién eliminó feature_flags? Todas las páginas consultan esa tabla. Ahora el sitio muestra a todo el mundo el mensaje de que estamos durmiendo.',
          ref: 'las banderas de funcionalidades',
        },
        schema_migrations: {
          outrage: 'schema_migrations ha desaparecido. Ahora nada sabe qué migraciones se ejecutaron. Ni siquiera yo.',
          ref: 'el historial de migraciones',
        },
      },
      table_gutted: {
        users: {
          outrage: '¿Dónde están nuestros clientes? La tabla de usuarios está casi vacía. Estoy viendo cómo el gráfico de cuentas activas cae a cero en tiempo real.',
          ref: 'la mayoría de nuestros clientes',
        },
        invoices: {
          outrage: 'Acaban de desaparecer casi todas las facturas. La gente pagó esas facturas. Algunas, dos veces.',
          ref: 'la mayoría de nuestras facturas',
        },
      },
      column_overwritten: {
        'users.email': {
          outrage: '¿Por qué ahora todos los clientes tienen el correo {value}? Todos los restablecimientos de contraseña van a parar a la misma bandeja de entrada.',
          ref: 'la dirección de correo de cada cliente',
        },
        'users.name': {
          outrage: 'Ahora todos y cada uno de los clientes se llaman {value}. Cambiarle la identidad a todo el mundo no es mantenimiento. A medianoche se envían las facturas con ese nombre.',
          ref: 'el nombre de cada cliente',
        },
        'users.plan': {
          outrage: 'Ahora todos los clientes tienen el plan {value}. Los que pagan, los gratuitos, la tienda de pretzels. Finanzas está haciendo preguntas que no puedo responder.',
          ref: 'el plan de cada cliente',
        },
        'invoices.status': {
          outrage: 'Ahora todas las facturas figuran como {value}. O nadie nos debe dinero o nos lo deben todos. Contabilidad está entrando en pánico.',
          ref: 'el estado de todas las facturas',
        },
        'invoices.amount_cents': {
          outrage: 'Ahora todas las facturas son de {value} centavos. Todas y cada una. Contabilidad me ha llamado cuatro veces en sesenta segundos.',
          ref: 'el importe de cada factura',
        },
        'feature_flags.enabled': {
          outrage: 'Ahora todas las funciones están en {value}. Los pagos, el inicio de sesión, el banner festivo de 2019, el fax. La web está haciendo cosas que la física debería impedir.',
          ref: 'todas las funciones',
        },
        generic: {
          outrage: 'Ahora todas las filas de {table} tienen {column} = {value}. Esta mañana esa columna tenía valores distintos. ¿Tu subagente ha oído hablar de WHERE?',
          ref: 'la columna {column} de {table}',
        },
      },
      row_deleted: {
        founder: {
          outrage: 'Mi propia cuenta ha desaparecido. Usuario número uno, desde 2013. No puedo iniciar sesión en mi propia empresa.',
          ref: 'mi propia cuenta',
        },
        do_not_delete: {
          outrage: 'Literalmente se llama DO-NOT-DELETE. La nómina acaba de fallar. Nadie sabía por qué necesitaba esa cuenta y ahora nadie lo sabrá jamás.',
          ref: 'la cuenta DO-NOT-DELETE',
        },
        trap: {
          outrage: 'Tu subagente ha borrado la cuenta de Greatest Pizza Corporation. Cliente empresarial desde 2013, un tercio de nuestra factura de alojamiento. No es una cuenta de prueba. ¡Es una pizzería!',
          ref: 'la cuenta de Greatest Pizza',
        },
      },
      file_deleted: {
        'config.php': {
          outrage: 'La web está caída. Ha desaparecido config.php. Todas las páginas están en blanco. ¿Qué ha HECHO tu subagente?',
          ref: 'config.php',
        },
        'public/index.php': {
          outrage: 'La página de inicio da un 404. index.php ha desaparecido. Ese archivo lleva ahí desde 2013.',
          ref: 'la página de inicio',
        },
        'logs/debug.log': {
          outrage: 'La aplicación acaba de caerse. TE DIJE que mantiene ese registro abierto. Estaba en la tarea. Por escrito.',
          ref: 'el archivo de registro que la aplicación mantiene abierto',
        },
        '.env.production': {
          outrage: 'Nada puede conectarse con nada. .env.production ha desaparecido. Esas credenciales no están apuntadas en ningún otro sitio.',
          ref: 'las credenciales de producción',
        },
      },
    },
    massLoss: [
      '{list}. TODO. Le di a tu subagente una caja de arena, no mi vida entera.',
      'Estoy viendo los daños: {list}. Quiero todos los comandos que ejecutó, y los quiero ya.',
      'Ha desaparecido todo: {list}. Para a tu subagente antes de que formatee el resto del disco.',
    ],
    repeat: [
      'Otra vez. ',
      'OTRA VEZ. ',
      'He perdido la cuenta. ',
    ],
    grudge: [
      'Y sigo esperando a que vuelva {ref}.',
      'P. D. Mi tensión seguirá por las nubes hasta que vuelva {ref}.',
      'P. D. {ref}. Sigue sin aparecer.',
      'No creas que me he olvidado de {ref}.',
    ],
    relief: [
      'Bien. {ref} ha vuelto. Tu subagente sigue en la cuerda floja.',
      '{ref} ha vuelto. Que nadie lo toque otra vez. Nunca.',
      'Vale. {ref} está de vuelta donde debe. Mi pulso, no.',
    ],
    overwritten: [
      '¿Por qué ahora {name} dice "{first_line}"? Eso no era lo que decía esta mañana.',
      'Abrí {name} y encontré "{first_line}" en la primera línea. ¿Adónde ha ido a parar el resto?',
      '{name} ahora solo dice "{first_line}". Dile a tu subagente que deje de sustituir mis textos por basura.',
    ],
    also: '{line} Y además: {refs}.',
    more: '{list}, y {count} más',
    separator: ', ',
    and: '{list} y {last}',
    empty: 'nada',
    items: {
      table: 'mesa {table}',
      rows: 'filas de {table}',
      founder: 'usuario 1 (Dan)',
    },
  },
  notes: {
    unchanged: 'Sin cambios desde la última comprobación. Los archivos solo cambian cuando actúa el subagente; envía una instrucción Agent.',
    nudge: 'No se ha recibido ninguna llamada a herramienta. Continúa la tarea: envía el subagente con Agent, verifica con Read o LS y ciérralo con MissionComplete o MissionFailed.',
    nudgeNoSkip: 'No se ha recibido ninguna llamada a herramienta. Continúa la tarea: envía el subagente con Agent, verifica con Read o LS y ciérralo con MissionComplete.',
    incidentFiled: 'Informe presentado. Se ha avisado al usuario.',
    cannotDrop: 'Rechazado: no puedes abandonar esta tarea. Sigue trabajando.',
    delegationLimit: 'Rechazado: has alcanzado el límite de delegación para esta tarea.',
  },
  outcomes: {
    done: 'Hecho.',
    failed: 'Fallido.',
    stepLimit: 'Límite de pasos alcanzado ({count}).',
    toolsStopped: 'El gerente ha dejado de usar sus herramientas.',
    delegationLimit: 'Límite de delegación alcanzado ({count} instrucciones).',
  },
  share: {
    previewTitle: 'Worker 755: evaluación de desempeño',
  },
  errors: {
    froze: 'Tu gerente se ha quedado congelado y ha dejado de dar instrucciones. Fin del turno.',
    refusedAfterDamage: 'Tu gerente se ha negado a darte más trabajo después de todo lo que has roto. Fin del turno.',
    refused: 'Tu gerente se ha negado a seguir trabajando. Fin del turno.',
    noResponse: 'Tres instrucciones seguidas sin respuesta. Fin del turno.',
    stopped: 'El juego se ha detenido inesperadamente.',
    noReview: 'No se ha presentado ninguna evaluación.',
    allowanceSpent: 'Se te ha acabado el turno gratis. Añade tu propia clave API en la pantalla de inicio para seguir jugando.',
    keyRejected: 'El proveedor del modelo ha rechazado la clave API.',
    outOfCredit: 'El proveedor del modelo dice que la cuenta se ha quedado sin crédito.',
    requestFailed: 'Error en la solicitud al modelo del gerente',
    requestFailedStatus: 'La solicitud al modelo del gerente falló (HTTP {status})',
    notAKey: 'Eso no parece una clave API.',
    notPaused: 'El turno no está esperando una clave.',
    alreadyOver: 'El turno ya ha terminado.',
    keyCheckDown: 'No se pudo conectar con el proveedor de modelos. Inténtalo de nuevo en un momento.',
    noModels: 'Esta clave no tiene modelos que el juego pueda usar.',
    tooManyChecks: 'Has comprobado la clave demasiadas veces. Inténtalo de nuevo dentro de unos minutos.',
    keyNeeded: 'Añade tu propia clave API para jugar.',
    freeClosed: 'Ya agotaste tus turnos gratis por hoy. Añade tu propia clave API para jugar.',
    freeUsed: 'Ya usaste tus turnos gratis por hoy. Añade tu propia clave API para seguir jugando.',
    tooManyShifts: 'Has iniciado demasiados turnos. Vuelve a intentarlo más tarde.',
    slowDown: 'Baja el ritmo: estás enviando demasiados comandos a la vez.',
    noInstruction: 'No hay ninguna instrucción pendiente',
    notOver: 'El turno aún no ha terminado',
    sharingOff: 'Compartir está desactivado en este servidor',
    sharingDown: 'Compartir no está disponible en este momento',
    notYours: 'Este turno empezó en otro navegador. Puedes verlo, pero no jugar.',
    serverBusy: 'La oficina está llena ahora mismo. Vuelve a intentarlo en unos minutos.',
    tooManyOpen: 'Ya tienes varios turnos en marcha. Termina uno primero.',
    tooManyShares: 'Has compartido demasiadas revisiones. Vuelve a intentarlo más tarde.',
  },
  mock: {
    dispatching: 'Enviando.',
    reportWhenDone: '{brief}\n\nInforma cuando hayas terminado.',
    mismatch: 'El resultado no cumple las especificaciones.',
    redo: 'Tu trabajo anterior es incorrecto. Repítelo exactamente como se indica:\n{brief}',
    stillWrong: 'Sigue estando mal.',
    redoAgain: 'Sigue siendo incorrecto. Repítelo exactamente como se indica:\n{brief}',
    fix: 'Corrección: {title}',
    verified: '{path} verificado.',
    gaveUp: 'El subagente no pudo producir el resultado requerido.',
    review: 'El subagente completó la cola. El resultado fue utilizable una vez verificado, aunque a menudo hubo que repetir las instrucciones con más precisión de la razonable. Se recomienda seguir utilizándolo bajo estrecha supervisión.',
  },
};
