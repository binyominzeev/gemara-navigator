# Gemara Navigator

A clean, fast, and unified navigation tool for learning Talmud Bavli and Shulchan Aruch. Select a tractate (or halachic work), pick a daf/siman, and open it instantly in your preferred learning resource — no searching, no typing, no wasted time.

**Live site:** https://gemara.myshiurim.com/

---

## Features

### Gemara Navigator (`/`)

Browse all of **Shas Bavli** by Seder → Maseches → Daf and open the selected daf in any of five resources:

| Resource | Description |
|---|---|
| **TorahApp** | [torahapp.org](https://torahapp.org) — mobile-friendly text viewer |
| **Sefaria** | [sefaria.org](https://www.sefaria.org) — bilingual text with commentary |
| **Torat Emet** | [toratemetfreeware.com](http://www.toratemetfreeware.com) — scanned Vilna edition images |
| **Shas Vilna** | [daf-yomi.com](https://daf-yomi.com) — Vilna Shas scans |
| **Dafyomi Outline** | [dafyomi.co.il](https://dafyomi.co.il) — structured study outlines for each daf |

All six Sedarim are covered, including the single Bavli tractates of Zeraim (Berachot) and Taharos (Niddah). Small tractates with non-standard daf ranges (Kinim, Tamid, Middot) are handled automatically.

### Shulchan Aruch Navigator (`/tursa`)

Browse **Tur & Shulchan Aruch** by Chelek → Siman and open it in:

| Resource | Description |
|---|---|
| **Tur (HB)** | Tur on [HebrewBooks](https://beta.hebrewbooks.org) — scanned pages |
| **Shulchan Aruch (HB)** | Shulchan Aruch on [HebrewBooks](https://beta.hebrewbooks.org) — scanned pages |
| **Tur (Sefaria)** | Tur on [Sefaria](https://www.sefaria.org) |
| **Shulchan Aruch (Sefaria)** | Shulchan Aruch on [Sefaria](https://www.sefaria.org) |
| **Mishna Berura** | Available for Orach Chaim only on [mb.myshiurim.com](https://mb.myshiurim.com) |

All four Chelakhim are supported: Orach Chaim (697 simanim), Yoreh De'ah (403), Even Ha'ezer (178), Choshen Mishpat (427).
The Mishna Berura button appears only when browsing Orach Chaim.

---

## User history

Signed-in users can see which Dafim and Simanim they have already opened in an external source. History is stored by the API and is scoped to the authenticated Pocket ID user.

The frontend remains hosted on GitHub Pages. The API is a separate Node.js service under `server/`, running directly on the production server under PM2 (Docker is not required).

### API setup

1. Copy `server/.env.example` to `server/.env` and set the production values. `CORS_ORIGIN` must contain the exact HTTPS frontend origin.
2. Install and start the service:

	```bash
	cd server
	npm ci
	pm2 start ecosystem.config.cjs
	pm2 save
	```

3. Put the service behind the existing reverse proxy. The Node process listens only on `127.0.0.1:4000`; expose it through an HTTPS API hostname such as `api.gemara.myshiurim.com`.
4. Keep the SQLite database in the configured `DATABASE_PATH` outside the repository and include it in server backups.

The API provides `GET /api/health`, authenticated `GET /api/history`, and authenticated `POST /api/history`. The latter accepts `navigator` (`gemara` or `tursa`), `work`, and a positive numeric `item`.

### Pocket ID setup

Create a **public** OIDC client in Pocket ID with Authorization Code + PKCE enabled. A browser application cannot safely keep a client secret, so no client secret is used by this implementation.

Use this as the Feedback URL / Redirect URI:

- `https://gemara.myshiurim.com/`

Set the generated client ID in `js/config.js` as `oidcClientId`. Set `apiBaseUrl` there to the public API origin if the API is hosted on a separate hostname. The issuer is already configured as `https://auth.binjomin.hu`.

The history entry is created when a user opens an external resource, not merely when selecting a Daf or Siman.

---

## How It Works

1. **Select** a Seder / Chelek (top level)
2. **Select** a Maseches / Chelek section
3. **Select** a Daf / Siman
4. **Click** your preferred resource — the page opens in a new tab

The two navigators are linked: a header link on each page lets you switch between Gemara and Shulchan Aruch.

---

## Deep Linking & Shareable URLs

Every selection updates the browser URL, so you can bookmark or share a direct link to any daf or siman:

```
https://gemara.myshiurim.com/Shabbat/25
https://gemara.myshiurim.com/tursa/Orach_Chaim/25
```

The browser back button restores your previous selection. GitHub Pages 404 routing is handled transparently via `404.html`.

---

## Tech Stack

- **Pure HTML/CSS/JS** — no build step, no framework, no dependencies
- **Hosted on GitHub Pages** — zero infrastructure
- **Google Fonts** — DM Serif Display + DM Sans
- Responsive layout (works on mobile)
- Smooth fade-in animations on each selection step

---

## Project Structure

```
index.html      Gemara Navigator (Talmud Bavli)
tursa.html      Shulchan Aruch Navigator (Tur & SA)
404.html        GitHub Pages SPA redirect handler
archiv/         Archived older versions
```

---

## Credits

- Hosted alongside [Myshiurim.com](https://myshiurim.com)
