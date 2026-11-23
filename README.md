# 🎄 Amigo Secreto Navidad

Aplicación web para el intercambio de regalos navideño entre amigos: registro con datos completos,
**sorteo automático y aleatorio** al completarse el cupo, perfiles visibles para todos (pero con las
asignaciones privadas), fotos, panel de administración y un **bot duende** que sugiere regalos y
guarda lo que cada quien quiere recibir.

Todo se guarda en **SQLite**, en un único archivo dentro del proyecto: `data/amigo_secreto.db`.

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

## ☁️ Subirlo a Render

### Opción A — con `render.yaml` (recomendada)

1. Sube el proyecto a un repositorio de GitHub.
2. En Render: **New → Blueprint**, elige el repositorio. Render lee `render.yaml` y crea
   el servicio con su disco persistente.
3. Listo. La app queda en `https://<tu-servicio>.onrender.com`.

### Opción B — manual

1. **New → Web Service** y conecta el repositorio.
2. Configura:
   - **Runtime:** Node
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/salud`
3. **Environment → Add Environment Variable**:
   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | una cadena larga y aleatoria |
   | `DB_DIR` | `/var/data` |
4. **Disks → Add Disk**: nombre `datos-amigo-secreto`, **Mount Path** `/var/data`, 1 GB.

### ⚠️ Importante sobre el plan gratuito

El disco persistente **solo está disponible en planes de pago** (Starter en adelante).
En el plan **Free** el sistema de archivos es efímero: cada vez que Render reinicie o
redespliegue el servicio **se perderían los usuarios, fotos y el sorteo**.

- Si usas el plan **Free**, no definas `DB_DIR`: la base vivirá en `data/` dentro del
  contenedor y servirá solo para pruebas. Haz el sorteo real cuando ya estén todos dentro
  y descarga un respaldo.
- Para el intercambio de verdad, usa el plan **Starter** con el disco montado en `/var/data`.

Además, en el plan Free el servicio se duerme tras 15 minutos sin tráfico: la primera visita
después tarda unos segundos en responder.

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
│   ├── db.js              # conexión SQLite, esquema y configuración
│   ├── sorteo.js          # algoritmo del sorteo (ciclo único aleatorio)
│   ├── bot.js             # duende: catálogo de ideas y memoria de deseos
│   └── session-store.js   # sesiones guardadas en SQLite
├── views/                 # plantillas EJS
├── public/css|js          # estilos y animaciones (nieve, Papá Noel, confeti)
├── data/amigo_secreto.db  # ← la base de datos (se crea sola)
└── render.yaml            # despliegue en Render
```

## 💾 Respaldo

Copia el archivo `data/amigo_secreto.db`: contiene usuarios, fotos, sorteo y conversaciones.
En Render puedes descargarlo desde la shell del servicio (`/var/data/amigo_secreto.db`).

## 🧹 Empezar de cero

Detén el servidor y borra `data/amigo_secreto.db` (y los `.db-wal` / `.db-shm` si existen).
Al volver a arrancar se crea vacía, con el usuario `admin` otra vez.
