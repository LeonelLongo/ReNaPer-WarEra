# Lithuania Verification Bot — Setup Guide

## Prerequisites
- Node.js 18+
- PostgreSQL 14+
- A Discord Bot application (https://discord.com/developers/applications)

## 1. Create the Discord Bot

1. Go to https://discord.com/developers/applications and create a new application
2. Go to **Bot** tab, click **Reset Token**, and copy the token
3. Enable these **Privileged Gateway Intents**:
   - Server Members Intent
   - Message Content Intent
4. Go to **OAuth2** tab, note the **Client ID**
5. Invite the bot to your server using this URL (replace CLIENT_ID):
   ```
   https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=268503110&scope=bot%20applications.commands
   ```
   (Permissions: Manage Roles, Manage Channels, Send Messages, Read Messages, Embed Links)

## 2. Configure the Bot

Edit `config.json`:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "guildId": "YOUR_DISCORD_SERVER_ID",
  "countryId": "YOUR_WARERA_COUNTRY_ID",
  "adminUsers": ["YOUR_DISCORD_USER_ID"],
  "roles": {
    "unverified": "",
    "verified": "",
    "citizen": "",
    "governmentOfficial": "",
    "cabinet": "",
    "congress": "",
    "president": "",
    "vicePresident": "",
    "secretaryOfState": "",
    "secretaryOfDefense": "",
    "secretaryOfTreasury": "",
    "greenCardHolder": "",
    "diplomat": "",
    "visitorVisa": "",
    "deportee": "",
    "warBuild": "",
    "econBuild": "",
    "verifier": ""
  },
  "channels": {
    "portOfEntry": "",
    "ticketsCategory": "",
    "roleLogs": "",
    "logs": ""
  }
}
```

### Config fields:
- **token** — Bot token from Discord Developer Portal
- **clientId** — Application client ID
- **guildId** — Your Discord server ID (right-click server name → Copy Server ID)
- **countryId** — Your nation's WarEra country ID (the 24-char hex ID from the game URL)
- **adminUsers** — Array of Discord user IDs who have full admin access
- **roles** — Discord role IDs for each status. Create these roles in your server and paste their IDs. Leave empty string for roles you don't use.
- **channels.portOfEntry** — Channel where the "Apply for Entry" embed will be posted
- **channels.ticketsCategory** — Category under which verification ticket channels are created
- **channels.roleLogs** — Channel for role change audit logs (optional)
- **channels.logs** — Channel for bot log forwarding (optional)

### Finding your WarEra country ID:
Go to your country page on https://app.warera.io — the URL will be like:
`https://app.warera.io/country/6813b6XXXXXXXXXX`
The hex string after `/country/` is your country ID.

## 3. Set Up the Database

Create a PostgreSQL database and user:

```sql
CREATE USER lithtest WITH PASSWORD 'your_secure_password';
CREATE DATABASE lithtest OWNER lithtest;
```

If your DB credentials differ from the defaults, set environment variables:
```bash
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=lithtest
export PG_USER=lithtest
export PG_PASSWORD=your_secure_password
```

Run the migration:
```bash
node migrate.js
```

## 4. Deploy Commands & Start

```bash
# Register slash commands with Discord
node deploy-commands.js

# Start the bot
node index.js
```

For production, use PM2:
```bash
npm install -g pm2
pm2 start index.js --name lithbot
pm2 save
```

## Commands

| Command | Who Can Use | Description |
|---------|-------------|-------------|
| `/verify` | Everyone | Start an immigration application |
| `/manualverify` | Admin / Gov Officials | Bypass ticket system, verify directly |
| `/unverify` | Admin / President / Sec of State | Remove verification and strip roles |
| `/setverification` | Admin / Cabinet | Update a member's verification record and roles |

## How Verification Works

1. User clicks "Apply for Entry" in the port-of-entry channel (or uses `/verify`)
2. Bot looks up their game profile and opens a private ticket channel
3. User confirms their identity ("Yes, that's me")
4. Bot generates a verification code (LT-XXXXX) and asks user to rename a company to it
5. User renames company and clicks "Verify" — bot checks the game API
6. Staff reviews the application and clicks Approve/Deny/Diplomat/etc.
7. Bot assigns the correct roles and closes the ticket
