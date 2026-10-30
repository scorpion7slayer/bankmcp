# Deploying this fork

This fork is for one person, on their own Dokploy server, reading their own
Belfius account. It stays read-only. Configure it with environment variables
so the setup page never opens on the network. The values below are
placeholders.

## Environment

Set these on the Dokploy service. Do not leave them empty and finish setup
in a browser.

| Variable | Placeholder |
| --- | --- |
| `EB_APP_ID` | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| `EB_PRIVATE_KEY_PATH` | `/data/enablebanking.pem` (or set `EB_PRIVATE_KEY` instead) |
| `EB_PRIVATE_KEY` | base64 of the `.pem`, when the file cannot be mounted |
| `ADMIN_PASSWORD_HASH` | scrypt hash from `npm run hash-password` |
| `BASE_URL` | `https://bank.example.com` |

With the application id, a private key, and `ADMIN_PASSWORD_HASH` all set,
setup is closed. That is the configuration to use.

`SETUP_TOKEN` is only for the case where those are not all set yet:

- `BANKMCP_LOCAL=1` is the desktop stdio mode. Setup stays available. Never
  set it on a server.
- `SETUP_TOKEN` set: `GET /` and the `/setup` routes require that secret.
  Send it as `/?setup_token=…`, the `X-Setup-Token` header, or the
  `setup_token` form field. A match sets an httpOnly cookie for 30 minutes
  so the rest of the browser flow can continue. The compare is constant-time.
- `SETUP_TOKEN` unset, and not local mode: setup is refused for every
  client, including localhost. A localhost exception would be spoofable,
  because the server trusts one proxy hop. The response says to configure
  the variables above or set `SETUP_TOKEN`.

`EB_API_BASE`, `EB_CP_BASE`, and `EB_PROFILE_BASE` are ignored. Account
calls go to `https://api.enablebanking.com`. The optional signup flow uses
`https://enablebanking.com` and the official profile document URL.

Leave `NOTIFY_WEBHOOK_URL` unset unless you want login and watch alerts.
If you set it, it must be `https://`. An `http://` URL is not called.

Restrict `ALLOWED_REDIRECT_HOSTS` to the MCP client you actually use, for
example `claude.ai` or `cursor.com`. The default list is wider than one
client.

## Data

Mount a private Dokploy volume at `/data` (`DATA_DIR`). It holds the `.pem`
application key, Enable Banking session ids, and IBANs in the clear. Do not
put it on a shared or public volume.

The image starts as root only long enough for the entrypoint to give `/data`
to the `node` user, then drops privileges with `su-exec`. It does not set
`USER node`, because a root-owned volume would otherwise stay unwritable.

## Network

Publish the port only through the Dokploy reverse proxy. If the proxy runs
on the same machine, set `BIND_HOST=127.0.0.1`. The process sets
`trust proxy` to one hop, which is right behind that proxy and wrong if the
port is reachable directly: a client could then spoof `X-Forwarded-For`.

Do not commit real secrets.
