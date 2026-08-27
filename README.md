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
