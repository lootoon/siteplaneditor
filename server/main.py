import hashlib
import hmac
import io
import json
import os
import secrets
import zipfile

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import db

db.init()
STATIC_DIR = os.path.join(db.BASE_DIR, "static")


def _secret_key():
    key = db.get_setting("session_secret")
    if not key:
        key = secrets.token_hex(32)
        db.set_setting("session_secret", key)
    return key


def _hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${h}"


def _verify(password, stored):
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash(password, salt), stored)


app = FastAPI(title="TakeOff")

OPEN_PATHS = ("/login.html", "/api/auth/", "/app.css", "/favicon")


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if not request.session.get("user") and not path.startswith(OPEN_PATHS):
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Not logged in"}, status_code=401)
        return RedirectResponse("/login.html")
    return await call_next(request)


# Added after the auth middleware so it wraps it (session is available inside).
app.add_middleware(SessionMiddleware, secret_key=_secret_key(), max_age=60 * 60 * 24 * 30,
                   same_site="lax")


# ---- auth -------------------------------------------------------------------
@app.get("/api/auth/status")
def auth_status(request: Request):
    return {"hasPassword": bool(db.get_setting("password_hash")),
            "loggedIn": bool(request.session.get("user"))}


@app.post("/api/auth/setup")
def auth_setup(request: Request, password: str = Body(..., embed=True)):
    if db.get_setting("password_hash"):
        raise HTTPException(400, "Password already set")
    if len(password) < 4:
        raise HTTPException(400, "Password too short")
    db.set_setting("password_hash", _hash(password))
    request.session["user"] = "owner"
    return {"ok": True}


@app.post("/api/auth/login")
def auth_login(request: Request, password: str = Body(..., embed=True)):
    stored = db.get_setting("password_hash")
    if not stored or not _verify(password, stored):
        raise HTTPException(401, "Wrong password")
    request.session["user"] = "owner"
    return {"ok": True}


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.post("/api/auth/change")
def auth_change(old: str = Body(...), new: str = Body(...)):
    if not _verify(old, db.get_setting("password_hash")):
        raise HTTPException(401, "Wrong password")
    db.set_setting("password_hash", _hash(new))
    return {"ok": True}


# ---- projects ---------------------------------------------------------------
@app.get("/api/projects")
def projects():
    return db.list_projects()


@app.post("/api/projects")
def project_create(name: str = Body(..., embed=True)):
    return db.create_project(name.strip() or "Untitled")


@app.get("/api/projects/{pid}")
def project_get(pid: str):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404)
    return p


@app.put("/api/projects/{pid}")
def project_save(pid: str, name: str = Body(...), data: dict = Body(...)):
    if not db.save_project(pid, name, data):
        raise HTTPException(404)
    return {"ok": True}


@app.delete("/api/projects/{pid}")
def project_delete(pid: str):
    db.delete_project(pid)
    return {"ok": True}


# ---- files ------------------------------------------------------------------
@app.post("/api/projects/{pid}/files")
async def file_upload(pid: str, file: UploadFile = File(...)):
    if not db.get_project(pid):
        raise HTTPException(404)
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(400, "Not a PDF file")
    return {"fileId": db.add_file(pid, file.filename, content)}


@app.get("/api/files/{fid}")
def file_get(fid: str):
    f = db.get_file(fid)
    if not f or not os.path.exists(f["path"]):
        raise HTTPException(404)
    return FileResponse(f["path"], media_type="application/pdf",
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---- .takeoff project file (zip: project.json + files/<id>.pdf) --------------
def _file_ids(data):
    ids = set()
    for d in data.get("drawings", []):
        if d.get("fileId"):
            ids.add(d["fileId"])
        for r in d.get("revisions", []):
            if r.get("fileId"):
                ids.add(r["fileId"])
    return ids


@app.get("/api/projects/{pid}/export")
def project_export(pid: str):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", json.dumps({"format": "takeoff/1", "name": p["name"], "data": p["data"],
                                               "signatures": db.get_setting("signatures", [])}))
        for fid in _file_ids(p["data"]):
            f = db.get_file(fid)
            if f and os.path.exists(f["path"]):
                z.write(f["path"], f"files/{fid}.pdf")
    safe = "".join(ch for ch in p["name"] if ch.isalnum() or ch in " -_").strip() or "project"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.takeoff"'})


@app.post("/api/import")
async def project_import(file: UploadFile = File(...), name: str = Form(None)):
    try:
        z = zipfile.ZipFile(io.BytesIO(await file.read()))
        meta = json.loads(z.read("project.json"))
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise HTTPException(400, "Not a valid .takeoff file")
    data = meta["data"]
    p = db.create_project(name or meta.get("name") or "Imported")
    id_map = {}
    for old in _file_ids(data):
        try:
            id_map[old] = db.add_file(p["id"], f"{old}.pdf", z.read(f"files/{old}.pdf"))
        except KeyError:
            pass
    for d in data.get("drawings", []):
        d["fileId"] = id_map.get(d.get("fileId"), d.get("fileId"))
        for r in d.get("revisions", []):
            r["fileId"] = id_map.get(r.get("fileId"), r.get("fileId"))
    db.save_project(p["id"], p["name"], data)
    # merge signatures that are not already in the library
    sigs = db.get_setting("signatures", [])
    known = {s["id"] for s in sigs}
    sigs += [s for s in meta.get("signatures", []) if s.get("id") not in known]
    db.set_setting("signatures", sigs)
    return {"id": p["id"]}


# ---- signatures library -----------------------------------------------------
@app.get("/api/signatures")
def signatures_get():
    return db.get_setting("signatures", [])


@app.put("/api/signatures")
def signatures_put(items: list = Body(...)):
    db.set_setting("signatures", items)
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
