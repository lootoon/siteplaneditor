"""SQLite storage. Project content (drawings meta, categories, BQ, marks, bookmarks)
is stored as one JSON document per project; PDF files live on disk under data/files."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Keep the live database outside OneDrive: sync clients can corrupt an open SQLite file.
# Back up / share via the .takeoff project file instead.
_default_data = os.path.join(os.environ["LOCALAPPDATA"], "TakeOff") if os.environ.get("LOCALAPPDATA") \
    else os.path.join(BASE_DIR, "data")
DATA_DIR = os.environ.get("TAKEOFF_DATA", _default_data)
FILES_DIR = os.path.join(DATA_DIR, "files")
DB_PATH = os.path.join(DATA_DIR, "takeoff.db")

os.makedirs(FILES_DIR, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL,
    created REAL NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT, path TEXT NOT NULL,
    size INTEGER, uploaded REAL NOT NULL);
"""

EMPTY_PROJECT = {"drawings": [], "categories": [], "bq": [], "marks": [], "bookmarks": []}


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript(SCHEMA)


def new_id():
    return uuid.uuid4().hex[:16]


# ---- settings ---------------------------------------------------------------
def get_setting(key, default=None):
    with conn() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(r["value"]) if r else default


def set_setting(key, value):
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value)))


# ---- projects ---------------------------------------------------------------
def list_projects():
    with conn() as c:
        rows = c.execute("SELECT id,name,created,updated FROM projects ORDER BY updated DESC").fetchall()
    return [dict(r) for r in rows]


def create_project(name, data=None):
    pid, now = new_id(), time.time()
    with conn() as c:
        c.execute("INSERT INTO projects VALUES(?,?,?,?,?)",
                  (pid, name, json.dumps(data or EMPTY_PROJECT), now, now))
    return get_project(pid)


def get_project(pid):
    with conn() as c:
        r = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["data"] = json.loads(d["data"])
    return d


def save_project(pid, name, data):
    with conn() as c:
        cur = c.execute("UPDATE projects SET name=?, data=?, updated=? WHERE id=?",
                        (name, json.dumps(data), time.time(), pid))
        return cur.rowcount > 0


def delete_project(pid):
    for f in list_files(pid):
        try:
            os.remove(f["path"])
        except OSError:
            pass
    with conn() as c:
        c.execute("DELETE FROM files WHERE project_id=?", (pid,))
        c.execute("DELETE FROM projects WHERE id=?", (pid,))


# ---- files ------------------------------------------------------------------
def add_file(pid, name, content: bytes):
    fid = new_id()
    path = os.path.join(FILES_DIR, fid + ".pdf")
    with open(path, "wb") as fh:
        fh.write(content)
    with conn() as c:
        c.execute("INSERT INTO files VALUES(?,?,?,?,?,?)",
                  (fid, pid, name, path, len(content), time.time()))
    return fid


def get_file(fid):
    with conn() as c:
        r = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
    return dict(r) if r else None


def list_files(pid):
    with conn() as c:
        rows = c.execute("SELECT * FROM files WHERE project_id=?", (pid,)).fetchall()
    return [dict(r) for r in rows]
