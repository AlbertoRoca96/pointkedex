
## Pointkedex

### ⚠️ Important: where’s the API?
This repo ships only the static front-end.  The classifier endpoint it expects lives at: `api/predict`.

1. Deploy the Python `predict_server.py` anywhere you like (Render, Fly, Vercel, etc.).
2. Note the base URL of that deployment.  Let’s pretend it’s `https://poke-api.fly.dev/`.
3. When opening the site pass that URL in the `api` query-param so the front-end knows where to POST:
   ```
   https://albertoroca96.github.io/pointkedex/?api=https://poke-api.fly.dev/
   ```
4. Profit.

If you skip step 1 you’ll only ever see “loading...” because GitHub Pages is purely static and will 404 on `/api/predict`.

A lightweight in-browser Pokedex that lets you *point your camera at a Pokémon* and instantly get its name and some Pokédex trivia. Everything runs completely offline in the browser thanks to TensorFlow.js and a distilled ResNet-50 model (\~14&nbsp;MB after compression 😎).

## Live Demo

Once you push the repository to GitHub **and enable GitHub Pages** the app will be automatically built and deployed at:

```
https://<your-github-username>.github.io/pointkedex/
```

> 📌 **Replace** `<your-github-username>` in the URL above. After the first push it may take a minute for Pages to go live. Hit *Settings → Pages* in your repo for the canonical link.

---

## Local development

```bash
npm ci       # or yarn, but be consistent ✨
npm start    # serves at http://localhost:5173
```

The project uses plain JS/HTML/CSS so a dev-server is optional; but [Vite](https://vitejs.dev) gives you live-reload and HTTPS for the webcam permission prompt.

---

## Deployment details

### 1. GitHub Pages

A ready-to-rock GitHub Action lives at **.github/workflows/deploy.yml**. On every push to `main` it:

1. Checks out the repo
2. Copies the static assets to a temporary `site` dir (excluding the heavy \*.bin weight files)
3. Publishes the folder to the `gh-pages` branch

After the workflow finishes your site will be reachable at the GitHub Pages URL above.

### 2. Vercel (optional)

If you prefer Vercel, drop the repo URL into the Vercel dashboard and *Ship It*™️. A minimal **vercel.json** is included so Vercel knows this is a static site.

---

## 🐍 Backend (predict_server.py)

`predict_server.py` is a tiny Flask API the front-end calls at `/api/predict`.
It loads the exact same ResNet-50 model that was distilled for the TF-JS frontend, so you get identical predictions on both sides.

### Running locally

```bash
python -m venv .venv && source .venv/bin/activate  # optional but tidy
pip install -r requirements.txt  # we'll create this file in a sec 😉
python predict_server.py         # listens on http://localhost:5000
```

Because the front-end uses a **relative URL** (`/api/predict`) everything will just work when both parts run on the same origin.

### Containerised / production

The included Dockerfile builds the model, installs Gunicorn + Flask + TensorFlow, and exposes port 8000.

### Quick local test with Docker + ngrok 🐳⚡️

```bash
# build image without bloating the context (see .dockerignore we just added)
docker build -t pointkedex .

# run locally on :8000 and automatically expose it to the internet via ngrok
# (set NGROK_AUTHTOKEN once – https://dashboard.ngrok.com/get-started/your-authtoken)
docker run -e NGROK_AUTHTOKEN="$NGROK_AUTHTOKEN" -p 8000:8000 pointkedex
```

The container boots Gunicorn + Flask on http://localhost:8000 **and** spins up ngrok.
Copy the forwarding URL printed by ngrok (e.g. https://fuzzy-pony.ngrok.io) and pass it
to the front-end:

```
https://<your-github-username>.github.io/pointkedex/?api=https://fuzzy-pony.ngrok.io/
```

No more "loading…" – predictions now flow nicely.  Deploy the same image to any
Docker-friendly host (Render, Fly, Railway…) and swap the URL once you’re happy.

```bash
docker build -t pointkedex .
docker run -p 8000:8000 pointkedex
```

💡  Pair it with **Render.com** or **Fly.io** for a free HTTPS endpoint: push your repo, select the Dockerfile, and you're live.

Once deployed, edit `config.js` in the root of the repo and set:

```js
window.API_BASE = "https://your-backend-url.com";
```

That lets the static site hosted on GitHub Pages reach your API hosted elsewhere.

---

## License

MIT. Attribution for Pokémon data goes to Nintendo, Game Freak and The Pokémon Company. This project is a community fan-project and is **not** affiliated with them in any way.