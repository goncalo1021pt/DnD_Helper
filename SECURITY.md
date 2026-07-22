# Security Policy

Quest Board is a small self-hosted app, but it handles real credentials
(passwords, TOTP secrets, sessions), so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.** Instead:

- Use GitHub's private vulnerability reporting:
  https://github.com/goncalo1021pt/DnD_Helper/security/advisories/new
- Or email the maintainer: goncalo.pereira.1021@gmail.com

Include what you found, how to reproduce it, and what you think the impact is.
You'll get a reply as soon as possible — this is a solo hobby project, so
"as soon as possible" usually means days, not hours.

## Supported versions

Only the latest release (and `main`) receives fixes.

## Scope notes

- Quest Board is self-hosted: the security of any individual deployment
  (server hardening, `.env` secrets, database access, tunnel configuration)
  is the operator's responsibility. See `docs/DEPLOY.md` for the recommended
  production setup — Cloudflare Tunnel only, no exposed ports, Postgres off
  the network.
- The development login (`APP_ENV != production`) is intentionally
  unauthenticated and is never mounted in production builds; reports about it
  in dev mode are expected behavior.
