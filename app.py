import argparse
import io
import json
import os
import re
import shutil
import zipfile

from flask import Flask, jsonify, render_template, request, send_file

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GALAXIES_DIR = os.path.join(BASE_DIR, "galaxies")
GALAXY_PATH_FILE = os.path.join(BASE_DIR, "galaxy_path.json")
INDEX_NOTE_FILE = os.path.join(BASE_DIR, "index_note.json")

VALID_NAME_RE = re.compile(r"^[^/\\:*?\"<>|\x00-\x1f]+$")
IMPORT_SKIP_DIRS = {".venv", "__pycache__", "node_modules", ".git", "static", "templates"}

HOME_DIR = os.path.realpath(os.path.expanduser("~"))
BROWSE_ROOTS = (HOME_DIR, os.path.realpath(BASE_DIR))

app = Flask(__name__)


def within_browse_roots(target):
    if not target:
        return False
    return any(
        os.path.commonpath([target, root]) == root
        for root in BROWSE_ROOTS
    )


def is_within(child, root):
    try:
        return os.path.commonpath([os.path.realpath(child), os.path.realpath(root)]) == os.path.realpath(root)
    except ValueError:
        return False


def resolve_inside(root, rel):
    if not rel:
        return None
    target = os.path.realpath(os.path.join(root, rel))
    root_real = os.path.realpath(root)
    if os.path.commonpath([target, root_real]) != root_real:
        return None
    return target


def rel_from_base(target):
    return os.path.relpath(target, BASE_DIR).replace(os.sep, "/")


def load_galaxy():
    try:
        with open(GALAXY_PATH_FILE, "r", encoding="utf-8") as f:
            path = json.load(f)["path"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError, TypeError):
        return None
    if not isinstance(path, str) or not path:
        return None
    target = resolve_inside(BASE_DIR, path)
    if (
        not target
        or target == GALAXIES_DIR
        or not is_within(target, GALAXIES_DIR)
        or not os.path.isdir(target)
    ):
        return None
    return rel_from_base(target)


def save_galaxy(rel):
    with open(GALAXY_PATH_FILE, "w", encoding="utf-8") as f:
        json.dump({"path": rel}, f)


def load_index_notes():
    try:
        with open(INDEX_NOTE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def save_index_notes(data):
    with open(INDEX_NOTE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f)


def current_index_note():
    rel = load_galaxy()
    if not rel:
        return None
    return load_index_notes().get(rel)


def galaxy_path():
    rel = load_galaxy()
    if not rel:
        return None
    return os.path.realpath(os.path.join(BASE_DIR, rel))


def galaxy_guard():
    if not galaxy_path():
        return jsonify({"error": "no galaxy configured"}), 409
    return None


def resolve_in_galaxy(rel):
    root = galaxy_path()
    if not root:
        raise ValueError("no galaxy configured")
    path = resolve_inside(root, rel)
    if not path:
        raise ValueError("path outside galaxy")
    return path


def walk_tree(directory, rel_prefix=""):
    entries = []
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return entries
    for name in names:
        if name.startswith("."):
            continue
        full = os.path.join(directory, name)
        rel = os.path.join(rel_prefix, name) if rel_prefix else name
        if os.path.isdir(full):
            entries.append({"type": "star", "path": rel, "children": walk_tree(full, rel)})
        elif name.endswith(".md"):
            entries.append({"type": "planet", "path": rel})
    return entries


def copy_tree(src, dst):
    def ignore(dirpath, names):
        return [n for n in names if n.startswith(".")]

    shutil.copytree(src, dst, ignore=ignore, symlinks=False)


# ---------- Galaxies ----------


@app.get("/api/galaxy")
def api_get_galaxy():
    return jsonify({"path": load_galaxy()})


@app.put("/api/galaxy")
def api_set_galaxy():
    body = request.get_json(silent=True) or {}
    path = body.get("path", "")
    target = resolve_inside(BASE_DIR, path)
    if (
        not target
        or target == GALAXIES_DIR
        or not is_within(target, GALAXIES_DIR)
        or not os.path.isdir(target)
    ):
        return jsonify({"error": "invalid galaxy path"}), 400
    rel = rel_from_base(target)
    save_galaxy(rel)
    return jsonify({"path": rel})


@app.get("/api/galaxies")
def api_galaxies():
    cur = load_galaxy()
    galaxies = []
    if os.path.isdir(GALAXIES_DIR):
        for name in sorted(os.listdir(GALAXIES_DIR)):
            if name.startswith("."):
                continue
            full = os.path.join(GALAXIES_DIR, name)
            if not os.path.isdir(full):
                continue
            rel = rel_from_base(full)
            galaxies.append({"name": name, "path": rel, "current": rel == cur})
    return jsonify({"galaxies": galaxies})


@app.post("/api/galaxies")
def api_create_galaxy():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip().strip("/")
    if not name or name.startswith(".") or not VALID_NAME_RE.match(name):
        return jsonify({"error": "invalid galaxy name"}), 400
    target = os.path.join(GALAXIES_DIR, name)
    if os.path.exists(target):
        return jsonify({"error": "galaxy already exists"}), 409
    os.makedirs(target, exist_ok=True)
    rel = rel_from_base(target)
    save_galaxy(rel)
    return jsonify({"path": rel, "name": name})


@app.post("/api/galaxy/import")
def api_import_galaxy():
    body = request.get_json(silent=True) or {}
    source = (body.get("source") or "").strip()
    name = (body.get("name") or "").strip().strip("/")
    if not source:
        return jsonify({"error": "source folder required"}), 400
    src = os.path.expanduser(source)
    src = os.path.realpath(src if os.path.isabs(src) else os.path.join(BASE_DIR, src))
    if not os.path.isdir(src):
        return jsonify({"error": "source folder not found"}), 404
    if not within_browse_roots(src):
        return jsonify({"error": "source outside allowed roots"}), 400
    if not name or name.startswith(".") or not VALID_NAME_RE.match(name):
        name = os.path.basename(src.rstrip("/"))
    if not name or name.startswith(".") or not VALID_NAME_RE.match(name):
        return jsonify({"error": "invalid galaxy name"}), 400
    dst = os.path.join(GALAXIES_DIR, name)
    if is_within(src, GALAXIES_DIR):
        if os.path.realpath(src) == os.path.realpath(GALAXIES_DIR):
            return jsonify({"error": "source contains the galaxy folder"}), 400
        rel = rel_from_base(src)
        save_galaxy(rel)
        return jsonify({"path": rel, "name": os.path.basename(rel), "adopted": True})
    if is_within(dst, src):
        return jsonify({"error": "source contains the galaxy folder"}), 400
    if os.path.exists(dst):
        return jsonify({"error": "galaxy already exists"}), 409
    os.makedirs(GALAXIES_DIR, exist_ok=True)
    try:
        copy_tree(src, dst)
    except OSError as e:
        return jsonify({"error": "import failed: " + str(e)}), 500
    rel = rel_from_base(dst)
    save_galaxy(rel)
    return jsonify({"path": rel, "name": name})


@app.get("/api/galaxy/download")
def api_download_galaxy():
    root = galaxy_path()
    if not root:
        return jsonify({"error": "no galaxy configured"}), 409
    name = os.path.basename(root.rstrip("/")) or "galaxy"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if fname.startswith("."):
                    continue
                full = os.path.join(dirpath, fname)
                arc = os.path.relpath(full, root).replace(os.sep, "/")
                zf.write(full, arc)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name=name + ".zip",
        mimetype="application/zip",
    )


@app.get("/api/dirs")
def api_dirs():
    rel = request.args.get("path", "")
    if rel:
        if os.path.isabs(rel):
            root = os.path.realpath(rel)
        else:
            root = resolve_inside(BASE_DIR, rel)
    else:
        root = os.path.realpath(BASE_DIR)
    if not root or not os.path.isdir(root):
        return jsonify({"error": "invalid path"}), 400
    if not within_browse_roots(root):
        return jsonify({"error": "path outside allowed roots"}), 400
    dirs = []
    try:
        for name in sorted(os.listdir(root)):
            if name.startswith("."):
                continue
            if os.path.realpath(root) == os.path.realpath(BASE_DIR) and name in IMPORT_SKIP_DIRS:
                continue
            if os.path.isdir(os.path.join(root, name)):
                dirs.append(os.path.join(root, name))
    except OSError:
        pass
    parent = os.path.dirname(root)
    if parent == root:
        parent = None
    elif not within_browse_roots(parent):
        parent = None
    return jsonify({"current": root, "dirs": dirs, "parent": parent})


# ---------- Planets (notes) ----------


@app.get("/api/index-note")
def api_get_index_note():
    guard = galaxy_guard()
    if guard:
        return guard
    return jsonify({"path": current_index_note()})


@app.put("/api/index-note")
def api_set_index_note():
    guard = galaxy_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    rel = (body.get("path") or "").strip()
    notes = load_index_notes()
    key = load_galaxy()
    if not rel:
        notes.pop(key, None)
    else:
        try:
            path = resolve_in_galaxy(rel)
        except ValueError:
            return jsonify({"error": "path traversal rejected"}), 400
        if not rel.endswith(".md") or not os.path.isfile(path):
            return jsonify({"error": "invalid index note"}), 400
        notes[key] = rel
    save_index_notes(notes)
    return jsonify({"path": rel or None})


@app.get("/api/tree")
def api_tree():
    guard = galaxy_guard()
    if guard:
        return guard
    return jsonify({"tree": walk_tree(galaxy_path())})


@app.get("/api/file")
def api_read_file():
    guard = galaxy_guard()
    if guard:
        return guard
    rel = request.args.get("path", "")
    try:
        path = resolve_in_galaxy(rel)
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404
    with open(path, "r", encoding="utf-8") as f:
        return jsonify({"content": f.read()})


@app.put("/api/file")
def api_save_file():
    guard = galaxy_guard()
    if guard:
        return guard
    rel = request.args.get("path", "")
    body = request.get_json(silent=True) or {}
    try:
        path = resolve_in_galaxy(rel)
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    if not rel.endswith(".md"):
        return jsonify({"error": "only .md files"}), 400
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body.get("content", ""))
    return jsonify({"ok": True})


@app.post("/api/file")
def api_create_file():
    guard = galaxy_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    rel = body.get("path", "")
    try:
        path = resolve_in_galaxy(rel)
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    if not rel.endswith(".md"):
        return jsonify({"error": "only .md files"}), 400
    if os.path.exists(path):
        return jsonify({"error": "already exists"}), 409
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("")
    return jsonify({"path": rel})


@app.post("/api/star")
def api_create_star():
    guard = galaxy_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    rel = body.get("path", "")
    try:
        path = resolve_in_galaxy(rel)
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    os.makedirs(path, exist_ok=True)
    return jsonify({"path": rel})


@app.post("/api/rename")
def api_rename():
    guard = galaxy_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    try:
        src = resolve_in_galaxy(body.get("from", ""))
        dst = resolve_in_galaxy(body.get("to", ""))
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    if not os.path.exists(src):
        return jsonify({"error": "source not found"}), 404
    if os.path.exists(dst):
        return jsonify({"error": "target already exists"}), 409
    os.makedirs(os.path.dirname(dst), exist_ok=True)

    # Estructura vieja de archivos para resolver wikilinks antes del rename
    root = galaxy_path()
    frm = body.get("from", "")
    to = body.get("to", "")
    planets_before = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not name.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/")
            planets_before.append(rel)
    by_base_before = {}
    for pid in planets_before:
        base = pid[:-3] if pid.endswith(".md") else pid
        by_base_before.setdefault(base.rsplit("/", 1)[-1], []).append(pid)
    is_file = frm.endswith(".md")
    old_base = os.path.basename(frm)[:-3] if is_file else os.path.basename(frm)
    new_base = os.path.basename(to)[:-3] if to.endswith(".md") else os.path.basename(to)
    old_noext = frm[:-3] if is_file else frm
    new_noext = to[:-3] if to.endswith(".md") else to

    os.rename(src, dst)

    # Reconstruir los wikilinks de todos los planetas tras el rename
    updated = 0
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not name.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/")
            full = os.path.join(dirpath, name)
            try:
                with open(full, "r", encoding="utf-8") as f:
                    content = f.read()
            except OSError:
                continue
            repls = []
            for m in re.finditer(r"\[\[([^\]\n]*?)\]\]", content):
                raw = m.group(1).strip()
                pipe = raw.find("|")
                target = raw[:pipe].strip() if pipe != -1 else raw
                alias = raw[pipe + 1 :] if pipe != -1 else None
                if not target:
                    continue
                if "/" in target:
                    # Ruta completa: archivo o carpeta
                    if is_file:
                        if target == old_noext:
                            repls.append((m.start(1), m.end(1), new_noext, alias))
                    elif target == frm or target.startswith(frm + "/"):
                        repls.append((m.start(1), m.end(1), to + target[len(frm) :], alias))
                elif is_file and old_base != new_base and target == old_base:
                    # Nombre base: solo si apuntaba realmente al archivo renombrado
                    if _resolve_wikilink(target, rel, planets_before, by_base_before) == frm:
                        repls.append((m.start(1), m.end(1), new_base, alias))
            if not repls:
                continue
            out = content
            for start, end, sub, alias in reversed(repls):
                new_raw = sub if alias is None else sub + "|" + alias
                out = out[:start] + new_raw + out[end:]
            if out != content:
                with open(full, "w", encoding="utf-8") as f:
                    f.write(out)
                updated += 1

    # Nota índice de la galaxia
    key = load_galaxy()
    index = load_index_notes().get(key)
    if index and (index == frm or index.startswith(frm + "/")):
        notes = load_index_notes()
        notes[key] = to + index[len(frm) :]
        save_index_notes(notes)

    return jsonify({"from": body.get("from"), "to": body.get("to"), "updated": updated})


@app.delete("/api/file")
def api_delete():
    guard = galaxy_guard()
    if guard:
        return guard
    rel = request.args.get("path", "")
    try:
        path = resolve_in_galaxy(rel)
    except ValueError:
        return jsonify({"error": "path traversal rejected"}), 400
    if not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    if os.path.isdir(path):
        shutil.rmtree(path)
    else:
        os.remove(path)
    return jsonify({"ok": True})


def _resolve_wikilink(target, from_path, planets, by_base):
    target = (target or "").strip()
    if not target:
        return None
    if target.endswith(".md"):
        target = target[:-3]
    if "/" in target:
        return target + ".md" if target + ".md" in planets else None
    lst = by_base.get(target)
    if not lst:
        return None
    if len(lst) == 1:
        return lst[0]
    if from_path:
        i = from_path.rfind("/")
        d = from_path[:i] if i != -1 else ""
        for p in lst:
            if d:
                if p.startswith(d + "/"):
                    return p
            elif "/" not in p:
                return p
    return lst[0]


@app.get("/api/graph")
def api_graph():
    root = galaxy_path()
    if not root:
        return jsonify({"nodes": [], "links": []})
    nodes = []
    links = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        rel = os.path.relpath(dirpath, root).replace(os.sep, "/")
        rel = "." if rel == "." else rel
        md_files = sorted(f for f in files if f.endswith(".md"))
        nodes.append(
            {
                "id": rel,
                "path": rel,
                "name": "galaxy" if rel == "." else rel.rsplit("/", 1)[-1],
                "type": "star",
                "planets": len(md_files),
            }
        )
        if rel != ".":
            links.append(
                {"source": rel.rsplit("/", 1)[0] if "/" in rel else ".", "target": rel, "type": "hierarchy"}
            )
        for md in md_files:
            planet_id = md if rel == "." else rel + "/" + md
            size = 0
            try:
                size = os.path.getsize(os.path.join(dirpath, md))
            except OSError:
                pass
            nodes.append(
                {"id": planet_id, "path": planet_id, "name": md[:-3], "type": "planet", "size": size}
            )
            links.append({"source": rel, "target": planet_id, "type": "planet"})
    planets = {n["id"]: n for n in nodes if n["type"] == "planet"}
    by_base = {}
    for pid in planets:
        base = pid[:-3] if pid.endswith(".md") else pid
        name = base.rsplit("/", 1)[-1]
        by_base.setdefault(name, []).append(pid)
    seen = set()
    for pid in planets:
        try:
            with open(os.path.join(root, pid), "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue
        for m in re.finditer(r"\[\[([^\]\n]*?)\]\]", content):
            raw = m.group(1).strip()
            pipe = raw.find("|")
            target = raw[:pipe].strip() if pipe != -1 else raw
            res = _resolve_wikilink(target, pid, planets, by_base)
            if not res or res == pid:
                continue
            key = (pid, res)
            if key in seen:
                continue
            seen.add(key)
            links.append({"source": pid, "target": res, "type": "wikilink"})
    return jsonify({"nodes": nodes, "links": links})


@app.get("/api/search")
def api_search():
    guard = galaxy_guard()
    if guard:
        return guard
    q = request.args.get("q", "").strip().lower()
    if not q:
        return jsonify({"results": []})
    root = galaxy_path()
    results = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not name.endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            title = name[:-3]
            if q in title.lower():
                results.append({"path": rel, "title": title, "snippet": ""})
                continue
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except OSError:
                continue
            idx = content.lower().find(q)
            if idx != -1:
                start = max(0, idx - 40)
                snippet = content[start : idx + len(q) + 40].replace("\n", " ")
                results.append({"path": rel, "title": title, "snippet": snippet})
    return jsonify({"results": results})


@app.get("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Astro markdown notes server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5005)
    parser.add_argument("--debug", action="store_true", help="enable Flask debug mode (unsafe on networks)")
    args = parser.parse_args()

    os.makedirs(GALAXIES_DIR, exist_ok=True)
    app.run(host=args.host, port=args.port, debug=args.debug)
