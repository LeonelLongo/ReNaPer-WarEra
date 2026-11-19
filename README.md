# ReNaPer-WarEra

Bot de Discord que automatiza la verificación de ingreso de nuevos miembros de una comunidad del juego online [WarEra](https://app.warera.io). Valida el perfil del jugador contra la API del juego, abre un ticket privado para la revisión del staff y asigna los roles de Discord que correspondan.

## Qué hace

- Flujo de verificación completo con tickets privados por solicitud.
- Valida la identidad del jugador contra la API de WarEra: el usuario renombra una empresa con un código único y el bot lo comprueba.
- Resuelve el estado migratorio sugerido (ciudadano, residente, diplomático, visa de visitante, deportado) según el país del jugador y la diplomacia vigente.
- Clasifica la build del jugador (guerra o economía) a partir de sus habilidades.
- Sincroniza roles de Discord (gobierno, gabinete, congreso, estados migratorios) y deja un registro de auditoría de cambios de rol.
- Persiste las verificaciones en PostgreSQL.
- Mensajes bilingües (español / inglés).

## Comandos

| Comando | Quién lo usa | Descripción |
|---|---|---|
| `/verify` | Todos | Inicia la solicitud de ingreso |
| `/manualverify` | Admin / funcionarios | Verifica directamente, sin ticket |
| `/unverify` | Admin / presidente / canciller | Quita la verificación y los roles |
| `/setverification` | Admin / gabinete | Actualiza el registro y los roles de un miembro |

## Cómo funciona la verificación

1. El usuario usa `/verify` o el botón de la entrada al servidor.
2. El bot busca su perfil en el juego y abre un canal de ticket privado.
3. El usuario confirma que ese perfil es suyo.
4. El bot genera un código y le pide renombrar una de sus empresas con ese código.
5. El bot consulta la API del juego y comprueba que el cambio se hizo.
6. El staff aprueba o rechaza la solicitud con botones.
7. El bot asigna los roles y cierra el ticket.

## Stack

- Node.js 18+
- discord.js v14
- PostgreSQL (`pg`)
- dotenv
- Desplegado en un VPS Linux con PM2 y Nginx

## Estructura

```
index.js                  Arranque del bot
commands/                 Comandos slash
verificationFlow.js       Flujo de verificación y tickets
verificationButtons.js    Botones de la interfaz
gameApi.js                Cliente de la API de WarEra
immigrationResolver.js    Estado migratorio según país y diplomacia
buildClassifier.js        Clasificación de build (guerra / economía)
roleSync.js, roleLogger.js  Sincronización y auditoría de roles
db.js, migrate.js         Conexión y migración de PostgreSQL
```

## Instalación

Requisitos: Node.js 18+, PostgreSQL 14+ y una aplicación de bot creada en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).

```bash
git clone https://github.com/LeonelLongo/ReNaPer-WarEra.git
cd ReNaPer-WarEra
npm install
```

Creá un archivo `.env` con:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
WARERA_API_KEY=
WARERA_COUNTRY_ID=
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=
```

Completá los IDs de roles y canales en `config.json` (ver [SETUP.md](SETUP.md)) y ejecutá:

```bash
npm run migrate   # crea las tablas
npm run deploy    # registra los comandos slash
npm start         # inicia el bot
```

En producción: `pm2 start index.js --name renaper`.

## Seguridad

Los secretos van en `.env`, que está ignorado por Git. No subas tokens ni claves al repositorio.

## Autor

Leonel Longo — [GitHub](https://github.com/LeonelLongo)
