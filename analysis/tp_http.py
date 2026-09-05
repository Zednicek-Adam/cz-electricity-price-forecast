"""HTTP that actually works on this machine.

curl and Python's ssl both reject the local TLS-intercepting CA
("Basic Constraints of CA cert not marked critical"), so every request goes
through PowerShell's Invoke-WebRequest, which uses the Windows trust store.
"""
import json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "analysis" / "raw"

_PS = r"""
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {{
  $r = Invoke-WebRequest -Uri '{url}' -UseBasicParsing -TimeoutSec 120 -OutFile '{out}' -PassThru
  Write-Output "STATUS $($r.StatusCode)"
}} catch {{
  $resp = $_.Exception.Response
  if ($resp) {{
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    [IO.File]::WriteAllText('{out}', $sr.ReadToEnd())
    Write-Output "STATUS $([int]$resp.StatusCode)"
  }} else {{ Write-Output "STATUS 0"; Write-Output $_.Exception.Message }}
}}
"""


def get(url, name):
    """Fetch url into analysis/raw/<name>; return (status, bytes)."""
    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / name
    p = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
         _PS.format(url=url.replace("'", "''"), out=str(out).replace("'", "''"))],
        capture_output=True, text=True)
    status = 0
    for line in p.stdout.splitlines():
        if line.startswith("STATUS "):
            status = int(line.split()[1])
    body = out.read_bytes() if out.exists() else b""
    if status == 503 and b"Scheduled maintenance" in body:
        sys.exit("ENTSO-E Transparency Platform is in scheduled maintenance (503). "
                 "Nothing to measure until it is back.")
    return status, body


_PS_POST = r"""
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = [IO.File]::ReadAllText($env:TP_BODY_FILE)
$headers = @{}
if ($env:TP_HEADERS_FILE) {
  (Get-Content $env:TP_HEADERS_FILE -Raw | ConvertFrom-Json).PSObject.Properties |
    ForEach-Object { $headers[$_.Name] = $_.Value }
}
try {
  $r = Invoke-WebRequest -Uri $env:TP_URL -Method POST -Body $body `
        -ContentType $env:TP_CONTENT_TYPE -Headers $headers `
        -UseBasicParsing -TimeoutSec 600 -OutFile $env:TP_OUT -PassThru
  Write-Output "STATUS $($r.StatusCode)"
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    [IO.File]::WriteAllText($env:TP_OUT, $sr.ReadToEnd())
    Write-Output "STATUS $([int]$resp.StatusCode)"
  } else { Write-Output "STATUS 0"; Write-Output $_.Exception.Message }
}
"""


def post(url, body, name, content_type="application/json", headers=None):
    """POST body to url, capturing the response in analysis/raw/<name>.

    Body and headers travel via files, not argv: the token request carries the
    account password, and argv is world-readable on this machine.
    Returns (status, bytes).
    """
    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / name
    body_file = RAW / (name + ".req")
    hdr_file = RAW / (name + ".hdr") if headers else None
    body_file.write_text(body, encoding="utf-8")
    if hdr_file:
        hdr_file.write_text(json.dumps(headers), encoding="utf-8")
    env = dict(os.environ, TP_URL=url, TP_BODY_FILE=str(body_file),
               TP_OUT=str(out), TP_CONTENT_TYPE=content_type,
               TP_HEADERS_FILE=str(hdr_file) if hdr_file else "")
    try:
        p = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _PS_POST],
            capture_output=True, text=True, env=env)
    finally:
        body_file.unlink(missing_ok=True)
        if hdr_file:
            hdr_file.unlink(missing_ok=True)
    status = 0
    for line in p.stdout.splitlines():
        if line.startswith("STATUS "):
            status = int(line.split()[1])
    if status == 0:
        print(p.stdout, p.stderr)
    body_bytes = out.read_bytes() if out.exists() else b""
    if status == 503 and b"Scheduled maintenance" in body_bytes:
        sys.exit("ENTSO-E Transparency Platform is in scheduled maintenance (503).")
    return status, body_bytes
