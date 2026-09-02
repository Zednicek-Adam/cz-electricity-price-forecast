"""HTTP that actually works on this machine.

curl and Python's ssl both reject the local TLS-intercepting CA
("Basic Constraints of CA cert not marked critical"), so every request goes
through PowerShell's Invoke-WebRequest, which uses the Windows trust store.
"""
import pathlib, subprocess, sys

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
