import json
import os
import re
import shutil

import markdown
from flask import Flask, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GALAXIES_DIR = os.path.join(BASE_DIR, "galaxies")
GALAXY_PATH_FILE = os.path.join(BASE_DIR, "galaxy_path.json")
INDEX_NOTE_FILE = os.path.join(BASE_DIR, "index_note.json")

MD_EXTENSIONS = ["fenced_code", "tables", "codehilite", "nl2br"]
VALID_NAME_RE = re.compile(r"^[^/\\:*?\"<>|\x00-\x1f]+$")
IMPORT_SKIP_DIRS = {".venv", "__pycache__", "node_modules", ".git", "static", "templates"}

app = Flask(__name__)


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
    os.rename(src, dst)
    return jsonify({"from": body.get("from"), "to": body.get("to")})


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


@app.route("/api/preview", methods=["GET", "POST"])
def api_preview():
    if request.method == "GET":
        body = request.args.get("markdown", "")
    else:
        body = (request.get_json(silent=True) or {}).get("markdown", "")
    return jsonify({"html": render_markdown(body)})


def render_markdown(text):
    return markdown.markdown(
        text,
        extensions=MD_EXTENSIONS,
        output_format="html5",
    )


@app.get("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    os.makedirs(GALAXIES_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=5005, debug=True)
