# Astro

Obsidian-like markdown editor in the browser. **Galaxies** hold **stars** (folders) and **planets** (notes). Void theme: black & white, minimalist.

## Requirements

- Python 3.14+

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://0.0.0.0:5005 (server listens on port 5005).

## Usage

- Top bar: galaxy manager (switch / create / import), search planets
- Sidebar: star/planet tree — hover a row for create / rename / delete actions
- Split view: markdown editor + live preview
- Autosave (debounced) + `Ctrl+S`
- `[[Wikilinks]]` open planets; dead links shown dashed until the planet exists
- Galaxies live in `galaxies/`; on first run you must create or import one. The current one is persisted in `galaxy_path.json` (gitignored)

## API

| Method | Route            | Purpose                     |
|--------|------------------|-----------------------------|
| GET    | `/api/galaxy`    | Get current galaxy path (null if none) |
| PUT    | `/api/galaxy`    | Switch to an existing galaxy |
| GET    | `/api/galaxies`  | List galaxies               |
| POST   | `/api/galaxies`  | Create galaxy `{name}`      |
| POST   | `/api/galaxy/import` | Import galaxy `{source, name}` (copies into `galaxies/`, or adopts if already there) |
| GET    | `/api/tree`      | Star/planet tree (`.md` only) |
| GET    | `/api/file`      | Read planet content         |
| PUT    | `/api/file`      | Save planet content         |
| POST   | `/api/file`      | Create planet               |
| POST   | `/api/star`      | Create star (folder)        |
| POST   | `/api/rename`    | Rename star/planet          |
| DELETE | `/api/file`      | Delete star/planet          |
| GET    | `/api/search`    | Search content across galaxy |
| GET    | `/api/dirs`      | List folders (galaxy import browser) |
| GET/POST | `/api/preview` | Server-side markdown render |
