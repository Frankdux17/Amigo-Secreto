# 🎄 Amigo Secreto Navidad

Aplicación web para el intercambio de regalos navideño entre amigos: registro con datos completos,
**sorteo automático y aleatorio** al completarse el cupo, perfiles visibles para todos (pero con las
asignaciones privadas), fotos, panel de administración y un **bot duende** que sugiere regalos y
guarda lo que cada quien quiere recibir.

Todo se guarda en **SQLite**: en tu PC, en un archivo dentro del proyecto (`data/amigo_secreto.db`); en producción, en **Turso** (SQLite alojado) para que los datos no se pierdan.

---

## 🚀 Probar en local

```bash
cd amigo-secreto
npm install
npm start
```

Abre **http://localhost:3600**

| Acceso | Usuario | Contraseña |
|---|---|---|
| Administrador | `admin` | `admin123` |
| Participantes | el que cada quien cree | la que elija |

> El puerto se puede cambiar con `PORT=4000 npm start`.

---

## 🎁 Cómo funciona

1. **Cada amigo crea su usuario** en `/registro`. Son obligatorios: usuario, contraseña, nombre,
   correo, teléfono, gustos, hobbies, talla de ropa, talla de zapato, color favorito y su deseo
   principal. La foto es opcional (se recorta y comprime en el navegador antes de enviarse).
2. **Al registrarse el participante número 8**, el sorteo se ejecuta **solo**, sin intervención de
   nadie. El algoritmo usa `crypto.randomInt` (aleatoriedad criptográfica) y genera un **ciclo
   único**: nadie se saca a sí mismo y no se forman parejas que se regalan entre ellas.
3. **Al entrar, cada quien abre su caja de regalo** y descubre a su amigo secreto, con confeti,
   sus gustos, tallas y lista de deseos.
4. **Todos ven el perfil de todos**, pero nadie puede ver a quién le tocó otra persona.
   La lista privada del duende de un participante solo la ve quien lo sacó en el sorteo.
5. **El duende 🧝** (en `/bot`) da ideas de regalo según el perfil del amigo secreto y **aprende**:
   si escribes *"quiero una manta polar"*, lo guarda en tu lista para que tu amigo secreto lo vea.

### 🧝 El duende flotante (asistente animado)

Un personaje animado en SVG (camina, saluda, parpadea, le suena el pompón) acompaña al usuario en
**todas las páginas**, igual que un widget de chat de soporte:

- **Avisa el resultado del sorteo automáticamente.** Apenas el participante inicia sesión después
  del sorteo, se abre una tarjeta de felicitación con confeti: *«Tu amigo secreto es…»*, con su
  foto, lo que le gusta, lo que pidió y sus tallas. No hace falta buscar nada.
- **Cuenta los gustos del amigo secreto en cuanto este los llena**: *«A Diego le gusta el fútbol y
  el gym»*, *«Dato útil: usa talla XL y zapato 43»*, *«Ojo: no le gusta…»*.
- **Da ideas de regalo** según el perfil del amigo, y **aprende** lo que el usuario quiere recibir
  («quiero una manta polar» → queda en su lista, visible solo para quien lo sacó).
- Antes del sorteo recuerda cuántos amigos faltan y anima a completar el perfil.
- **Aprende de verdad.** El motor está en `src/knn.js` y no usa ninguna librería:
  cada amigo se convierte en un vector de intereses (categorías del catálogo + palabras
  sueltas, pesadas según la fuente y normalizadas), se comparan con **similitud del
  coseno**, se toman los **k vecinos más cercanos** (k=3) y se recomienda por
  **filtrado colaborativo basado en usuario**:
  `score(idea) = 2·sim(destino, idea) + Σ sim(destino, vecino)·sim(vecino, idea)`.
  El primer término evita el arranque en frío; el segundo es el aprendizaje propiamente
  dicho y pesa más conforme el grupo se llena. Cada sugerencia viene con su porqué.
- **Se refuerza con el uso.** Todo lo que aprende va a la tabla `senales` con un peso:
  repetir algo sube el peso (con logaritmo, para que repetir diez veces no valga diez
  veces más), los 👍/👎 de cada idea ajustan el perfil, y lo que dice un tercero pesa
  menos que lo que dice el propio interesado.
- **Entretiene mientras no hay sorteo.** Cuenta del grupo, describe a cada amigo,
  calcula con quién tienes más en común y propone juegos (adivinar de quién son unos
  gustos, suponer qué le gusta a alguien). Todo lo que sale jugando se aprende.
- **Lleva recados.** «dile a Fabio que eres muy social» y el duende se lo entrega
  cuando Fabio entre. Un recado que intente destripar el sorteo se bloquea.
- **Se le puede hablar.** Botón 🎤 en el chat (reconocimiento de voz del navegador,
  es-PE). Si el navegador no lo soporta, el botón no aparece.
- **Se pasea y tiene cosquillas.** Camina y vuela por la página cada cierto rato (se
  queda quieto si el chat está abierto, en móvil o si el sistema pide menos
  movimiento). Tres toques seguidos y se muere de risa.
- **Nunca revela el sorteo.** No por buena voluntad, sino por construcción: el módulo
  del duende recibe del servidor **únicamente** la asignación de quien pregunta. Las
  parejas de los demás no entran nunca en ese código, así que no hay nada que filtrar.
  A quien insista, lo esquiva con gracia.
- **Habla.** Tiene voz de duendecito con la síntesis de voz del propio navegador: narra el
  resultado del sorteo, sus avisos y sus respuestas del chat. No usa ningún servicio externo ni
  archivos de audio.
  - Las voces instaladas cambian de un equipo a otro, así que la app elige sola la de mejor
    calidad disponible (prioriza las de Google, que suenan mucho mejor que las "Desktop" de
    Windows) y, desde el engranaje del chat, cada quien puede **elegir otra voz y probarla al
    instante**, además de tres tonos: Duende, Niño y Normal.
  - Se silencia con el botón 🔊 junto al personaje. Voz, tono y silencio quedan guardados en ese
    navegador.

### Otros detalles navideños
- Nieve animada, guirnalda de luces y confeti.
- Un **Papá Noel / duende / reno paseando** por la parte baja de la página con la foto de cada
  participante y frases de ánimo.
- Caja de regalo animada que se abre con clic (para volver a ver el resultado cuando quiera).

### 🎨 Diseño
Sigue la línea de los proyectos de Grupo Brunner: paleta verde corporativa (`#219447`, `#379a50`,
lima `#a4bf41`) combinada con rojo y oro navideños sobre un fondo nocturno, y tipografía
**Public Sans** (la misma del portal de soporte) con **Baloo 2** para los títulos.

---

## 👑 Panel de administración (`/admin`)

- Ver **todas las parejas** del sorteo (es el único que las ve) y quién ya abrió su regalo.
- Configurar: título del evento, número de participantes, monto sugerido, fecha y lugar.
- **Ejecutar, forzar (nueva ronda) o reiniciar** el sorteo.
- Crear, editar, desactivar o eliminar participantes.
- **Subir la foto** de cualquier participante.
- **Cambiar credenciales**: si alguien olvida su clave o quiere otro nombre de usuario, el
  administrador se lo cambia desde la ficha del participante.

> **Son 9 cuentas: los 8 amigos + el administrador.** El admin organiza, pero **no entra al
> sorteo**: este se juega solo entre los 8 participantes registrados.

> Si eliminas a un participante cuando el sorteo ya estaba hecho, el sorteo se reinicia
> automáticamente para que no queden parejas inconsistentes.

---

## 🗄️ Dónde se guardan los datos

La app usa **SQLite** siempre. Lo único que cambia es dónde vive el archivo:

| Entorno | Almacenamiento | Se configura con |
|---|---|---|
| Tu PC (local) | `data/amigo_secreto.db` dentro del proyecto | nada, es el modo por defecto |
| Render | **Turso** (SQLite alojado, plan gratuito) | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` |

> **Por qué hace falta Turso.** En Render el proyecto vive dentro de un contenedor que se
> **recrea** en cada redespliegue y cada vez que el servicio despierta. Un archivo escrito ahí
> —sea SQLite o una foto— se borra. Turso guarda la misma base SQLite fuera del contenedor, así
> que los usuarios, las fotos y el sorteo **no se pierden nunca**, y además el plan gratuito
> sobra para 9 usuarios.

La app detecta sola el modo: si existe `TURSO_DATABASE_URL` usa Turso, si no, el archivo local.
En `/salud` y en el panel de administración se ve cuál está activo.

---

## ☁️ Subirlo a Render (gratis)

### 1. Crear la base en Turso

Entra a [turso.tech](https://turso.tech), crea una cuenta gratuita y luego, desde su panel web o
con su CLI:

```bash
turso db create amigo-secreto
turso db show amigo-secreto --url       # -> libsql://amigo-secreto-xxxx.turso.io
turso db tokens create amigo-secreto    # -> el token (una cadena larga)
```

Guarda esos dos valores: son `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.

### 2. Desplegar en Render

1. En Render: **New → Blueprint** y elige el repositorio `Amigo-Secreto`.
2. Render lee `render.yaml` y pide las variables marcadas como `sync: false`:
   - `TURSO_DATABASE_URL` → la URL del paso 1
   - `TURSO_AUTH_TOKEN` → el token del paso 1
   - `ADMIN_PASSWORD` → la contraseña que quieras para el usuario `admin`
     (**no dejes `admin123`** en un enlace público: quien la conozca vería todas las parejas)
3. **Apply** y espera el build (~3 minutos).

Listo: queda en `https://amigo-secreto-navidad.onrender.com`.

### Antes de mandar el link a tus amigos

1. Entra tú como `admin` con la contraseña que pusiste.
2. En **Admin → Configuración del evento** ajusta el monto, la fecha y el lugar.
3. Comprueba en **Admin → Base de datos** que dice *«Los datos están en Turso»*.
4. Recién ahí comparte el enlace. Cada amigo entra a **Crear mi usuario**.

> En el plan gratuito de Render el servicio se duerme tras 15 minutos sin visitas: la primera
> carga después puede tardar ~30 segundos. Los datos **no** se pierden, porque están en Turso.

---

## 🔐 Seguridad incluida

- Contraseñas con **bcrypt** (nunca se guardan en texto plano).
- Sesiones firmadas y **almacenadas en SQLite** (sobreviven a un reinicio del servidor).
- **Token CSRF** verificado en todas las peticiones POST.
- Límite de intentos de inicio de sesión (bloqueo temporal tras 6 fallos).
- Cookies `httpOnly`, `sameSite=lax` y `secure` en producción.
- Las asignaciones del sorteo se consultan **siempre** por el id del usuario en sesión:
  nadie puede ver la de otro cambiando la URL.

---

## 🗂️ Estructura

```
amigo-secreto/
├── server.js              # rutas y arranque del servidor Express
├── src/
│   ├── db.js              # conexión SQLite/Turso, esquema y configuración
│   ├── sorteo.js          # algoritmo del sorteo (ciclo único aleatorio)
│   ├── bot.js             # duende: catálogo de ideas y memoria de deseos
│   └── session-store.js   # sesiones guardadas en SQLite
├── views/                 # plantillas EJS
├── public/css|js          # estilos y animaciones (nieve, Papá Noel, confeti)
├── data/amigo_secreto.db  # ← la base de datos (se crea sola)
└── render.yaml            # despliegue en Render
```

## 💾 Respaldo

En local: copia el archivo `data/amigo_secreto.db` (contiene usuarios, fotos, sorteo y conversaciones).
En Turso: `turso db shell amigo-secreto .dump > respaldo.sql`.

## 🧹 Empezar de cero

Detén el servidor y borra `data/amigo_secreto.db` (y los `.db-wal` / `.db-shm` si existen).
Al volver a arrancar se crea vacía, con el usuario `admin` otra vez.
