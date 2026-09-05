"""ENTSO-E File Library (fms.tp.entsoe.eu) client.

The File Library is the only surface that exposes `UpdateTime(UTC)` -- the fact
ticket #14 turns on. The web API does not: its `createdDateTime` is the time the
*response* was generated, not the time the data published.

Unlike the web API it authenticates with the Transparency Platform *account*
(email + password, OAuth2 password grant against Keycloak), not the API token.
Credentials come from .env as TP_USERNAME / TP_PASSWORD. Password grant tokens
are short-lived, so every run re-authenticates; that is fine for a one-off
measurement and this never runs in the daily path.

Protocol confirmed against EnergieID/entsoe-py `entsoe/files/entsoe_files.py`.
"""
import io
import json
import pathlib
import zipfile

from tp_http import post

ROOT = pathlib.Path(__file__).resolve().parents[1]
KEYCLOAK = "https://keycloak.tp.entsoe.eu/realms/tp/protocol/openid-connect/token"
FMS = "https://fms.tp.entsoe.eu/"


def _env():
    vals = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()
    return vals


def token():
    import urllib.parse
    env = _env()
    missing = [k for k in ("TP_USERNAME", "TP_PASSWORD") if not env.get(k)]
    if missing:
        raise SystemExit(
            "Missing " + ", ".join(missing) + " in .env.\n"
            "The File Library needs the Transparency Platform *account* login "
            "(the email and password you sign in to transparency.entsoe.eu with), "
            "not the API token.")
    body = urllib.parse.urlencode({
        "client_id": "tp-fms-public",
        "grant_type": "password",
        "username": env["TP_USERNAME"],
        "password": env["TP_PASSWORD"],
    })
    status, raw = post(KEYCLOAK, body, "token.json",
                       content_type="application/x-www-form-urlencoded")
    if status != 200:
        raise SystemExit(f"Keycloak returned HTTP {status}: {raw[:400]!r}")
    return json.loads(raw)["access_token"]


def list_folder(access_token, folder=""):
    """{name: fileId} for a folder under /TP_export/.

    Folder entries carry no fileId, so theirs is None; only files have one.
    """
    if folder and not folder.endswith("/"):
        folder += "/"
    body = json.dumps({
        "path": "/TP_export/" + folder,
        "sorterList": [{"key": "periodCovered.from", "ascending": True}],
        "pageInfo": {"pageIndex": 0, "pageSize": 5000},
    })
    safe = (folder or "root").rstrip("/").replace("/", "_") or "root"
    status, raw = post(FMS + "listFolder", body, f"ls_{safe}.json",
                       headers={"Authorization": f"Bearer {access_token}"})
    if status != 200:
        raise SystemExit(f"listFolder({folder!r}) -> HTTP {status}: {raw[:400]!r}")
    data = json.loads(raw)
    return {x["name"]: x.get("fileId") for x in data.get("contentItemList", [])}


def download(access_token, folder, filename, cache_dir):
    """Fetch one extract, unzip it, cache the CSV bytes on disk. Returns the path."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / filename
    if cached.exists() and cached.stat().st_size > 0:
        return cached
    if not folder.endswith("/"):
        folder += "/"
    body = json.dumps({
        "folder": "/TP_export/" + folder,
        "filename": filename,
        "downloadAsZip": True,
        "topLevelFolder": "TP_export",
    })
    status, raw = post(FMS + "downloadFileContent", body, filename + ".zip",
                       headers={"Authorization": f"Bearer {access_token}"})
    if status != 200:
        raise SystemExit(f"download({filename!r}) -> HTTP {status}: {raw[:400]!r}")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    cached.write_bytes(zf.read(zf.filelist[0].filename))
    return cached
