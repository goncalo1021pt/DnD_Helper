# Runbook

Things that go wrong, and what to type. Written to be read on a phone from the
Proxmox console or an SSH app, so every step is one line you can copy.

Everything here needs a shell on the production host. That is deliberate: none
of it is reachable from the internet, so none of it can be aimed at you.

```sh
cd /path/to/DnD_Helper      # wherever the repo is checked out on the VM
```

---

## A player is locked out of two-factor auth

They have lost their authenticator **and** their recovery codes. (If they still
have a recovery code, they should use it — sign-in accepts one in place of the
six-digit code.)

### 1. Make sure they are who they say

This is the whole of the security, and no command can do it for you. Someone
asking you to remove a stranger's second factor is exactly what an attack looks
like.

Ask them something an attacker would not know and a player would:

- Talk to them on Discord voice, or in person at the table
- The invite code of a campaign they are in
- Their character's name, class and level

**If anything feels off, stop.** There is no rush; the account is not going
anywhere.

### 2. See who you are about to touch

```sh
docker compose exec app /server admin unlock-2fa --login bryn
```

`--login` takes their **username or their email**. Nothing is written by this
run — it prints the account so you can check the name before acting:

```
  user     Bryn Ashford <bryn@example.com>
  id       f283beb6-ba1b-4184-ab51-3b8eea36021f
  2FA      ON, 3 recovery code(s) unused

  Nothing written. Check the name above, then re-run with --confirm.
```

If it says **no password account matches**, they sign in with Discord or Google.
Their provider holds their second factor and there is nothing here to clear —
send them to that provider's account recovery.

### 3. Clear it

```sh
docker compose exec app /server admin unlock-2fa --login bryn --note "verified on Discord voice" --confirm
```

The `--note` is worth typing. It is the only record of *how* you decided they
were themselves, and it is the part you will want if this is ever questioned.

### 4. Tell them

They can now sign in **with their password alone**. Say so, and tell them to set
two-factor up again straight away — until they do, their account is one
password away from anyone who has it.

### Reading the trail later

```sh
docker compose exec postgres psql -U questboard -d questboard -c "SELECT created_at, action, target_label, note FROM admin_actions ORDER BY created_at DESC LIMIT 20;"
```

---

## An account lost its email address in the upgrade to #269

Until migration 57, an email address was only unique among *password* accounts,
so one person could end up with two accounts on one address — sign in with
Google after registering with a password and you got a second, separate you.
Migration 57 makes the address name exactly one account, and to do that it has
to resolve any pair that already exists.

**The rule it applies:** the account that held the address **first** keeps it.
Nothing is deleted and nothing is moved — the later account keeps its rows, its
username and its password, and can still sign in. It loses only the address,
and with it **password recovery**.

That is worth knowing about, so each one is recorded. After upgrading, check:

```bash
docker compose exec postgres psql -U questboard -d questboard -c \
  "SELECT created_at, target_label, note FROM admin_actions WHERE action = 'email_freed' ORDER BY created_at;"
```

An empty result means no account was affected, which is the usual case.

If one of the freed accounts is a real account somebody uses, the fix is theirs
to choose, and there are only two honest options:

- **Sign in to it and stop using it**, moving anything it owns to the account
  that kept the address. Nothing here does that for you: an account merge would
  repoint eighteen foreign keys and cannot be undone, so it is not a command.
- **Give it a different address.** There is no self-serve door for changing an
  address, so this is a direct update, and the address must not belong to
  anybody else:

```bash
docker compose exec postgres psql -U questboard -d questboard -c \
  "UPDATE users SET email = 'their-other@address.example', email_verified = false WHERE id = '<uuid>';"
```

They then confirm it the normal way, and from that point the provider button
will link to this account rather than being refused.

## Setting up offsite backups (once)

The nightly dumps land in `./backups` on this machine. That survives a bad
migration; it does not survive the disk. This mirrors them to Cloudflare R2,
encrypted.

### 1. In the Cloudflare dashboard

- **R2 → Create bucket** → name it `questboard-backups`
- **R2 → Manage API tokens → Create** → permission **Object Read & Write**,
  scoped to *that bucket only*, not account-wide
- Copy the **Access Key ID** and **Secret Access Key**, and note your
  **Account ID** (it is in the R2 page URL)

### 2. Pick a passphrase and obscure it

```sh
docker run --rm rclone/rclone:1.75 obscure 'a long passphrase you have not used elsewhere'
```

Run it against the **plain image**, not `docker compose run offsite`. The
`offsite` service sets `entrypoint: ["/bin/sh", "-c"]`, so the passphrase
arrives as `$0`, the shell tries to run `obscure` as a command, and you get
`<your passphrase>: line 0: obscure: not found` — the error echoes the
passphrase you were trying to keep quiet. If that happens, pick a different
one; nothing is encrypted with it yet.

Put the **output** in `.env` as `BACKUP_CRYPT_PASSWORD`, and put the
**passphrase itself in your password manager** before you go any further.

> An encrypted backup whose key only existed on the machine that died is not a
> backup. This is the one step with no second chance.

### 3. Fill in `.env` and start it

```sh
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=questboard-backups
BACKUP_CRYPT_PASSWORD=<the obscured output>
```

```sh
docker compose up -d offsite
docker compose logs -f offsite
```

It waits five minutes for a dump to exist, then syncs and repeats daily. If
`R2_BUCKET` is empty it idles and says so — it will not crash-loop.

## Verifying a restore actually works

**Do this once, now, and not during an emergency.** A backup nobody has
restored from is a hope.

### 1. See what is off-box

```sh
docker compose run --rm offsite lsl VAULT:
```

Filenames come back readable here because rclone decrypts them on the way out.
In the bucket itself they are ciphertext.

### 2. Pull the newest one down

```sh
docker compose run --rm -v "$PWD/restore-test:/restore" offsite copy VAULT: /restore --max-age 2d
ls -lh restore-test/
```

### 3. Load it into a throwaway database and count something

```sh
docker compose exec -T postgres createdb -U questboard restorecheck
gunzip -c restore-test/questboard-*.sql.gz | docker compose exec -T postgres psql -U questboard -d restorecheck -q
docker compose exec -T postgres psql -U questboard -d restorecheck -c "SELECT count(*) AS campaigns FROM campaigns; SELECT count(*) AS heroes FROM characters;"
```

Those counts should look like your live table. If they do, the backup is real.

### 4. Clean up

```sh
docker compose exec -T postgres dropdb -U questboard restorecheck
rm -rf restore-test
```

---

## Watching the site from outside the house

Grafana watches the app from inside the homelab, which cannot tell you the
tunnel is down, the VM is off, or the power is out — in all three cases the
thing that would alert you is also down. That needs a check from somewhere else.

### What to point it at

```
https://dnd.fontao.net/api/health
```

Verified behaviour, not assumed:

| State | Response |
|---|---|
| Healthy | `200` · `{"status":"ok"}` |
| Database down | `503` · `{"status":"degraded"}` |
| No session cookie | still answers — the endpoint is public |

So a plain **HTTP status check** is enough. It catches the app being gone *and*
the database having died, needs no authentication, and needs no keyword match.
If your monitor offers keyword matching anyway, `"status":"ok"` is the string.

**Interval:** 5 minutes is plenty. This is a game table, not a payments API, and
tighter intervals mostly buy false alarms from transient tunnel blips.

### Two layers worth having

**1. An external poller** — UptimeRobot's free tier (50 monitors, 5-minute
checks) is the usual choice. Add an HTTP(s) monitor on the URL above.

> Discord wiring has a catch: Discord webhooks expect `{"content": "..."}`, and a
> generic "POST to this URL" alert usually will not render. If your monitor
> cannot shape the payload, send the alert to **email** instead — it is less
> satisfying and it works. Check this when you set it up rather than assuming
> the first test alert arriving means it is wired.

**2. Cloudflare's own tunnel notification** — you are already in that dashboard.
Zero Trust → Notifications can alert when a tunnel goes down, which is exactly
the "VM is off / house has no power" case, and it costs nothing extra. Worth
checking whether your plan includes it.

The two catch different things and neither replaces the other: the tunnel
notification knows the connection died, and the poller knows the app answered
badly. A 503 from a perfectly healthy tunnel is invisible to the first and
obvious to the second.

### Not the same as the backup ping

`HEALTHCHECK_URL` in `.env` is a *dead-man's switch* for the nightly offsite
sync — the backup job pings it on success and you are told when the ping stops.
That answers "did the backup run". It says nothing about whether the site is up,
and the site being up says nothing about the backup. Both, or neither is worth
much.

---

## Why there is no admin page for this

Clearing someone's two-factor auth is the single most dangerous thing this app
can do. It turns "an attacker needs the password **and** the device" into "an
attacker needs the password" — and an endpoint that does it would sit on the
public internet every second of every day to serve something that may happen
never.

A command needs a shell on the box. You already have one; an attacker on the
other side of the tunnel does not, and cannot phish their way to one.

This is also where comparable self-hosted projects landed — GitLab, Mastodon and
Nextcloud all clear a user's 2FA from a console or CLI rather than a page.

The trade is real and worth knowing: **you cannot do this from your phone
without a shell.** Proxmox's web console or an SSH app is enough, which is why
this page is written to be read on one.
