# Piotr Jandura

Personal site for Piotr Jandura. Static files only: `index.html`, `styles.css`, `script.js`.

## Local preview

```bash
python3 -m http.server 5173
```

Then visit [http://localhost:5173](http://localhost:5173).

## Hosting (GitHub Pages, free)

This repo is set up for [GitHub Pages](https://pages.github.com/):

- `CNAME` points the custom domain to **piotrjandura.com**
- `.nojekyll` tells Pages to serve the files as-is (no Jekyll build)

Pages source: branch `main`, folder `/` (site root).

Temporary URL (before DNS): `https://scrunchuies.github.io/piotrjandura.com/`

Intended production URL: [https://piotrjandura.com](https://piotrjandura.com)

## Custom domain DNS (piotrjandura.com)

**Registrar:** Squarespace Domains. **Do not add these records at Squarespace** — nameservers already point at Cloudflare (`brett.ns.cloudflare.com`, `zariyah.ns.cloudflare.com`). Add or replace records in the **Cloudflare dashboard** for the `piotrjandura.com` zone: [dash.cloudflare.com](https://dash.cloudflare.com) → select the domain → **DNS** → **Records**.

Keep the existing iCloud SPF TXT record (`v=spf1 include:icloud.com ~all`) if you still use iCloud email with this domain.

Set **Proxy status to DNS only** (grey cloud), not Proxied. GitHub Pages custom-domain HTTPS often fails behind Cloudflare’s orange-cloud proxy.

### Apex (`piotrjandura.com`)

Remove the current Cloudflare-proxied A/AAAA records that produce error 1033, then add:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | DNS only |
| A | `@` | `185.199.109.153` | DNS only |
| A | `@` | `185.199.110.153` | DNS only |
| A | `@` | `185.199.111.153` | DNS only |
| AAAA | `@` | `2606:50c0:8000::153` | DNS only |
| AAAA | `@` | `2606:50c0:8001::153` | DNS only |
| AAAA | `@` | `2606:50c0:8002::153` | DNS only |
| AAAA | `@` | `2606:50c0:8003::153` | DNS only |

### www (`www.piotrjandura.com`)

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `www` | `scrunchuies.github.io` | DNS only |

After DNS propagates, GitHub Pages → Settings → Pages should show the custom domain as verified, with HTTPS enabled. That is not done until these records exist; the domain is **not** connected yet.

### epics (`epics.piotrjandura.com`)

Coming-soon page in this repo: [piotrjandura.com/epics/](https://piotrjandura.com/epics/).

GitHub Pages allows **one custom domain per site**, so the apex site cannot also be `epics.piotrjandura.com`. For the subdomain:

1. Create a second public repo (for example `epics`) with GitHub Pages enabled (`main`, `/`).
2. Put the contents of `epics/` at that repo’s root, plus a `CNAME` file whose only line is `epics.piotrjandura.com`. Point `../styles.css` and `../script.js` at copies of those files, or inline the styles.
3. In Cloudflare DNS for `piotrjandura.com`:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `epics` | `scrunchuies.github.io` | DNS only |

Then set that repo’s Pages custom domain to **epics.piotrjandura.com** and wait for HTTPS.

### balance (`balance.piotrjandura.com`)

Public Venmo ledger: [piotrjandura.com/balance/](https://piotrjandura.com/balance/).

Venmo does not offer a public API for private balances or payments, so this page does **not** log into Venmo. It reads `balance/transactions.json` in this repo. After a Venmo payment, add a row and push; the site will show who paid, how much, and the running balance.

Example entry:

```json
{
  "date": "2026-08-27",
  "type": "received",
  "from": "Alex Kim",
  "amount": 24.5,
  "note": "dinner"
}
```

Use `"type": "sent"` and `"to"` for money you paid out. `startingBalance` is the wallet amount before the first listed payment. `asOf` is the date shown above the total.

Same GitHub Pages limit as EPICS: one custom domain per site. For the subdomain, either serve the path above, or:

1. Create a second public repo with GitHub Pages (`main`, `/`) and a `CNAME` file whose only line is `balance.piotrjandura.com`.
2. In Cloudflare DNS for `piotrjandura.com`:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `balance` | `scrunchuies.github.io` | DNS only |

Then set that repo’s Pages custom domain to **balance.piotrjandura.com** and wait for HTTPS. This ledger is public; do not put amounts you want to keep private.

### Auto-update from Venmo email

Venmo has no API, so the ledger updates by parsing payment emails. **Do not** turn on Cloudflare Email Routing for `piotrjandura.com` — MX already points at iCloud, and replacing it would break that inbox.

Instead, forward Venmo mail into Gmail and let `email-ingest/Code.gs` append rows to [scrunchuies/balance.piotrjandura.com](https://github.com/scrunchuies/balance.piotrjandura.com) `transactions.json`.

1. Turn on payment emails in the Venmo app (Settings → Notifications).
2. Set `startingBalance` in `transactions.json` to today’s Venmo wallet **before** the first forwarded payment, or the running total will be wrong.
3. On [icloud.com/mail](https://www.icloud.com/mail): Settings → Rules → if the message is from `venmo.com`, forward to a Gmail address.
4. At [script.google.com](https://script.google.com), create a project, paste `email-ingest/Code.gs`, and add a script property `GITHUB_TOKEN` (fine-grained PAT, Contents read/write on `scrunchuies/balance.piotrjandura.com`).
5. Run `ingestVenmo` once to grant access, then add a time-driven trigger every 5 minutes.

### wedding (`wedding.piotrjandura.com`)

Wedding site for Cecylia & Greg (May 15, 2027), rebuilt from the Canva design PDF. Self-contained static site in `wedding/`: `index.html`, `styles.css`, `images/`, `favicon.svg`, `CNAME`, `.nojekyll`. Fonts come from Google Fonts (Pinyon Script, Cormorant Garamond, Marcellus).

Local preview:

```bash
python3 -m http.server 5173
```

Then visit [http://localhost:5173/wedding/](http://localhost:5173/wedding/).

Same GitHub Pages limit as EPICS and balance: one custom domain per site, so the subdomain needs its own repo. `wedding/` already contains the `CNAME` file, so it can be published straight from this repo with `git subtree`:

1. On GitHub, create an **empty** repo (no README, .gitignore, or license) named `wedding.piotrjandura.com` under `scrunchuies`.
2. From this repo's root, push the `wedding/` folder as that repo's `main` branch. Rerun the same command after every change to `wedding/`:

   ```bash
   git subtree push --prefix=wedding https://github.com/scrunchuies/wedding.piotrjandura.com.git main
   ```

3. In that repo: Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/`. The custom domain fills in from the `CNAME` file; if it does not, enter **wedding.piotrjandura.com**.
4. In Cloudflare DNS for `piotrjandura.com`:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `wedding` | `scrunchuies.github.io` | DNS only |

5. Wait for the Pages custom-domain check to pass, then tick **Enforce HTTPS**.

### RSVP → Google Sheet

The RSVP page posts into a spreadsheet. Google login is required on your account, so this last mile is on you:

1. Open [sheets.new](https://sheets.new) and name it **Wedding RSVPs**.
2. **Extensions → Apps Script**. Replace the stub with `wedding/rsvp/Code.gs` (copy from this repo). Save.
3. **File → New → HTML file**. Name it exactly `GuestForm` (no `.html`). Paste `wedding/rsvp/GuestForm.html`. Save.
4. Click **Run** on `setupSheets` and allow access. That creates **Guests**, **Responses**, and **Latest** tabs.
5. Reload the spreadsheet. Use **Wedding RSVP → Add guest** for the primary / plus-one / child / invited / events form. **Edit selected party** reopens whoever’s row you have selected.
6. **Deploy → New deployment → Web app**. Execute as **Me**, who has access **Anyone**. Copy the `/exec` URL.
7. Paste that URL into `RSVP_ENDPOINT` at the top of `wedding/rsvp/rsvp.js`, then push `wedding/` as usual.

Definitely invited guests appear on the RSVP page and only see the events you checked. Maybe invited stays on your B-list until you switch them. Re-RSVPs overwrite **Latest**; **Responses** is a full log.

Placeholders still to fill: the gift registry link, the Hilton room-block booking link, and the phone numbers, handles, and emails under Contact Details.
