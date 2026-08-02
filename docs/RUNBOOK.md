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
