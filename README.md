# DeskThing Home Assistant dashboard

A focused DeskThing interface for controlling selected Home Assistant lights, switches, and scenes from Spotify Car Thing.

The desktop app worker calls the Home Assistant REST API. The Car Thing client never receives the Home Assistant token or makes Home Assistant requests directly.

## Requirements

- Bun
- DeskThing server and client version 0.11 or newer
- A Home Assistant long-lived access token

## Setup

1. Create the token file and restrict its permissions:

   ```bash
   umask 077
   mkdir -p ~/.config/home-assistant
   read -rsp "Home Assistant token: " HA_TOKEN
   printf '%s' "$HA_TOKEN" > ~/.config/home-assistant/token
   unset HA_TOKEN
   chmod 600 ~/.config/home-assistant/token
   ```

2. Install dependencies and build the app:

   ```bash
   bun install
   bun run test
   bun run typecheck
   bun run build
   ```

3. Install the generated zip through the DeskThing apps page.

4. Configure the app in DeskThing:

   - `Home Assistant URL`: an origin such as `http://homeassistant.local:8123`
   - `Entity IDs`: values such as `light.office`, `switch.router`, and `scene.night`
   - `Light mode`: optional light theme

The URL must use HTTP or HTTPS and cannot contain credentials, a path, query parameters, or a fragment. The app sends the token to this configured origin, so only a trusted DeskThing administrator should change it. Prefer HTTPS; use HTTP only on a trusted local network.

## Development

```bash
bun run dev:mock
```

Mock mode uses in-memory light, switch, and scene entities. Its actions never call Home Assistant. Use `bun run dev` to test with the DeskThing development environment and your configured Home Assistant instance.

The app polls every five seconds and refreshes immediately after an action. Requests and optimistic UI state are bounded by timeouts so a stopped or disconnected app does not retain stale work.

## Security

The token stays in `~/.config/home-assistant/token` on the DeskThing host. Do not add this file, DeskThing settings data, generated bundles, or local logs to the repository.

## License

MIT, copyright NickTheWilder.
