# Discord Installation and App Directory Checklist

## Make the app installable on multiple servers

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Select the application.
2. Open **Installation**.
3. Enable **Guild Install**.
4. Choose **Discord Provided Link**.
5. Under Guild Install, add scopes `applications.commands` and `bot`.
6. Add bot permissions: View Channels, Send Messages, Embed Links, Attach Files, and Read Message History.
7. Copy the installation link and test it in a private test server.
8. Start the hosted bot with `DEVELOPMENT_GUILD_ID` blank so commands register globally.
9. In the test server, run `/setup` and confirm all buttons and manager controls work.

This installation link can be shared before the app is listed publicly in the App Directory.

## Prepare for public Discovery

Discord currently requires the team owner to complete identity and application verification before enabling Discovery. The exact qualification checklist appears under **App Verification** in the Developer Portal and can change, so use the Portal as the authority.

After verification:

1. Open **Discovery → Discovery Status** and complete every eligibility item.
2. Add a support server and support link.
3. Add a privacy policy explaining stored IDs, names, shifts, corrections, and retention.
4. Add terms of service.
5. Complete the install settings and test the installation link.
6. Add a square icon, cover image, screenshots, summary, expanded description, and useful search tags.
7. Enable Discovery and allow up to 24 hours for the listing to appear.

Official guides:

- [Discord app setup and install links](https://docs.discord.com/developers/quick-start/getting-started)
- [Enabling Discovery](https://docs.discord.com/developers/discovery/enabling-discovery)
- [Discovery best practices](https://docs.discord.com/developers/discovery/best-practices)

## Suggested listing copy

### Summary

Clock staff in and out, track duty minutes, correct missed shifts, export weekly reports, and reset payroll totals for any GTA RP business.

### Expanded description

Run staff duty tracking without spreadsheets or manual timers. Team members clock on and off through clear Discord buttons while managers can see who is working, review total minutes and shift counts, correct forgotten time, export payroll-ready CSV reports, and reset totals for the next period.

Each Discord server chooses its own business name, clock channel, private log channel, timezone, and manager role through `/setup`. The server owner can also approve individual managers without changing Discord roles.

Key features:

- Button-based clock on and clock off
- Private My Time button with personal totals and recent shifts
- Live on-duty list
- Exact clock-on and clock-off timestamps in the server timezone
- Minute-based pay-period reports
- Manager time corrections with a searchable member picker and audit logs
- Simple one-line-per-person text export with a confirmed reset
- Separate configuration and records for each server
- Eastern, Central, Mountain, Pacific, UTC, and UK timezone choices

After installation, the server owner runs `/setup` once and selects the requested channels and manager role.

### Suggested tags

- roleplay
- gta
- staff
- time tracking
- business
