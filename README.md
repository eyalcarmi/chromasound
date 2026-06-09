# ChromaSound

Turn colors into music. Click or drag across a color grid (or your own image) to play notes mapped from pixel color using the Web Audio API.

## Features

- **5 instruments:** Synth, Piano, Bass, Drums, Organ
- **Color mapping:** Hue → note, Lightness → octave, Saturation → timbre/volume
- **Upload images:** Use any photo as your playable canvas
- **Landscape mode:** Rotate your device for fullscreen play on mobile

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- npm (included with Node.js)

## Run locally

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

Click or tap the canvas once to unlock audio (browser autoplay policy).

## Build for production

```bash
npm run build
npm run preview
```

The production build is output to `dist/`.

## How to play

1. Choose an instrument from the toolbar.
2. Click and drag (or touch and drag on mobile) across the color grid.
3. Optionally upload an image to play colors from your own photos.
4. Rotate to landscape on mobile for fullscreen mode.

## Project structure

```
ColorSoundApp/
├── index.html          # HTML entry point
├── package.json        # Dependencies and scripts
├── vite.config.ts      # Vite configuration
├── src/
│   ├── main.tsx        # React bootstrap
│   ├── App.tsx         # ChromaSound app (from Claude Artifact)
│   └── index.css       # Global styles
└── README.md
```

## Deploy to Vercel

### Option A — Import from GitHub (recommended)

1. Push the repo to GitHub (see below).
2. Go to [vercel.com/new](https://vercel.com/new).
3. Import the `chromasound` repository.
4. Vercel auto-detects Vite. Confirm:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
5. Click **Deploy**.

### Option B — Vercel CLI

```bash
npx vercel login
npx vercel --prod
```

Or use the helper script:

```bash
./scripts/deploy-vercel.sh --prod
```

## Publish to GitHub

Install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) (provides `git`) if prompted, then:

```bash
# Authenticate with GitHub (one time)
gh auth login

# Create repo and push
./scripts/publish-github.sh chromasound
```

The script creates a public repo named `chromasound` and pushes `main`.
