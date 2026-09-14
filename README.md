# GTA RP Business Duty Bot

A multi-server Discord app for GTA RP businesses. Each Discord server configures its own business name, channels, timezone, manager role, individually approved managers, shifts, reports, and Sunday resets.

## Features

- Staff Clock On, Clock Off, and Who's On buttons
- All work time displayed in minutes
- Separate clock-off and management log channel
- Current on-duty list and count
- Current pay-period report with minutes and shift count per person
- Manager-only time corrections, CSV export, and reset controls
- `/add-manager`, `/remove-manager`, and `/list-managers`
- Server-owner `/setup` with Discord channel and role pickers
- Separate data and configuration for every Discord server
- Global commands, allowing one installation link to be used on many servers
- Eastern Time by default, with several timezones selectable during setup
- Full history retained when current totals are reset

## 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select **New Application**, enter the app's name, then open **Bot**.
3. Select **Reset Token**, copy the token, and keep it private.
4. Open **Installation**.
5. Enable **Guild Install**. User Install is not required for this server-based bot.
6. Select **Discord Provided Link** under Install Link.
7. Under the default Guild Install settings, add the `applications.commands` and `bot` scopes.
8. Select these bot permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
9. Save, then copy the install link. Anyone with Manage Server permission can use it to add the app to a server.

The bot only requests the standard Guilds intent. It does not require Message Content, Guild Members, or Administrator access.

## 2. Add the hosting settings

On Windows, double-click `setup.bat` once. It installs the bot and creates `.env`. Add:

- `DISCORD_TOKEN`: private bot token from the Bot page
- `CLIENT_ID`: Application ID from General Information
- `DEVELOPMENT_GUILD_ID`: optional test-server ID; leave blank for the public multi-server app
- `DEFAULT_BUSINESS_NAME`: fallback name before a server runs `/setup`
- `DEFAULT_TIMEZONE`: fallback timezone; `America/New_York` automatically handles EST and EDT
- `DATA_FILE`: keep `./data/shifts.json` locally; use `/data/shifts.json` with a Railway volume

Never place the real bot token in GitHub or send it to another person.

## 3. Start the bot

Run `start.bat`, or:

```bash
npm install
npm start
```

With `DEVELOPMENT_GUILD_ID` blank, the bot registers global commands for every server where it is installed. Discord may take a little time to show a newly registered global command.

## 4. Configure each Discord server

The server owner or a Discord administrator runs `/setup` and selects:

- Clock channel
- Separate log channel
- Manager role
- Business name
- Timezone

The bot checks its channel permissions, saves the settings for that server, and posts the permanent button panel. Re-running `/setup` safely updates that server without changing another server's data.

## Permissions inside the bot

The following can run reports, adjust time, force clock-offs, export, and reset:

- Server owner
- Discord administrators
- Anyone with the manager role chosen in `/setup`
- Anyone individually approved with `/add-manager`

Only the server owner, Discord administrators, and members of the configured manager role can add or remove individually approved managers. An individually approved manager cannot grant access to another person unless they also have the configured role.

## Commands and buttons

| Control | Who can use it | Purpose |
| --- | --- | --- |
| Clock On | Everyone | Starts the member's shift |
| Clock Off | Everyone | Ends the shift and logs its minutes |
| Who's On | Everyone | Shows active staff and current minutes |
| Weekly Report | Managers | Shows current totals and shift counts |
| Adjust Time | Managers | Opens a form to add or remove minutes |
| Export & Reset | Managers | Delivers a CSV, then starts a new period at zero |
| `/setup` | Owner/admin | Selects channels, manager role, business name, and timezone |
| `/setup-status` | Managers | Shows the server's saved configuration |
| `/add-manager` | Owner/admin/manager role | Approves one person individually |
| `/remove-manager` | Owner/admin/manager role | Removes an individual approval |
| `/list-managers` | Managers | Shows the configured role and approved people |
| `/duty-report` | Managers | Current period or up to eight earlier calendar weeks |
| `/force-clock-off` | Managers | Ends a forgotten active shift |
| `/adjust-time` | Managers | Alternative correction command with a member picker |
| `/refresh-duty-panel` | Managers | Restores the panel if its message was deleted |

## Sunday payroll workflow

1. Press **Weekly Report** to review everyone’s minutes.
2. Correct mistakes with **Adjust Time**. Positive numbers add minutes; negative numbers remove them.
3. Press **Export & Reset** and confirm.
4. Download the CSV containing each member's ID, display name, total minutes, shift count, adjustments, and current status.

The reset happens only after Discord successfully delivers the CSV. Active staff stay clocked on: their old minutes go into the export, while their new total begins from the exact reset time. Raw history remains in the data file.

## Recommended hosting: GitHub plus Railway

GitHub stores the private source repository; Railway runs the always-on process.

1. Create a private GitHub repository and upload this project. Do not upload `.env`.
2. In Railway, create a project and choose **Deploy from GitHub repo**.
3. Add `DISCORD_TOKEN`, `CLIENT_ID`, `DEFAULT_BUSINESS_NAME`, `DEFAULT_TIMEZONE`, and `DATA_FILE=/data/shifts.json` under **Variables**.
4. Leave `DEVELOPMENT_GUILD_ID` blank.
5. Add a persistent Railway volume mounted at `/data`.
6. Deploy. Railway detects the included `Dockerfile`; the bot does not need a public domain.

The persistent volume is essential. Without it, settings and shift records can disappear during a redeploy.

## Docker on your own server

Copy `.env.example` to `.env`, enter the token and application ID, then run:

```bash
docker compose up -d --build
```

The included `restart: unless-stopped` policy restarts the bot after a failure or host restart. The `data` directory is mounted outside the container.

## App Directory publication

The Discord Provided Link can be used to install the app on different servers immediately; an App Directory listing is a separate discovery step. Before Discord allows Discovery, the app owner must complete Discord's identity and app-verification requirements shown in the Developer Portal. After verification, complete **Discovery → Discovery Status**, add the app description, support server, tags, images, privacy policy, and terms, then enable Discovery.

See [APP_DIRECTORY.md](APP_DIRECTORY.md) for the full release checklist and suggested listing copy.

## Backups and scaling

All server settings and duty records are stored in `data/shifts.json`. Back it up regularly. The atomic file storage is suitable for a small or medium deployment running as one bot process. If the app grows into many busy servers or multiple bot processes, migrate storage to PostgreSQL before horizontally scaling it.

## Common problems

- **Commands do not appear:** confirm `CLIENT_ID`; leave `DEVELOPMENT_GUILD_ID` blank for global commands, then restart and allow Discord time to update them.
- **Setup rejects a channel:** give the bot View Channel and Send Messages there. The clock channel also needs Embed Links and Read Message History.
- **Clock-off logs are missing:** rerun `/setup` and select a log channel the bot can access.
- **Manager is denied:** assign the configured manager role or use `/add-manager` from an authorized account.
- **Panel was deleted:** run `/refresh-duty-panel`.
- **Railway lost data:** ensure a persistent volume is mounted at `/data` and `DATA_FILE=/data/shifts.json`.

## Data privacy

The bot stores server IDs, channel and role IDs, Discord user IDs, display names, shift times, corrections, reset records, and responsible manager IDs. It does not read ordinary messages.
