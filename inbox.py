"""Pieces the agent opened, waiting for the Desktop page: one JSON file each under
``<hermes home>/plugin-data/stave/inbox/``. The page lists them, adds them to its own storage and
acknowledges them, which removes the file."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

_ID = re.compile(r"^h[0-9a-f]{12}$")
_MAX = 50


def _data_dir() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return plugin_data_dir("stave")
    except Exception:
        home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
        path = home / "plugin-data" / "stave"
        path.mkdir(parents=True, exist_ok=True)
        return path


class Inbox:
    def __init__(self, root: Path | None = None):
        self.dir = (root or _data_dir()) / "inbox"
        self.dir.mkdir(parents=True, exist_ok=True)

    def put(self, entry: dict) -> None:
        tmp = self.dir / f".{entry['id']}.tmp"
        tmp.write_text(json.dumps(entry), encoding="utf-8")
        tmp.replace(self.dir / f"{entry['id']}.json")
        for old in sorted(self.dir.glob("h*.json"), key=lambda p: p.stat().st_mtime)[:-_MAX]:
            old.unlink(missing_ok=True)

    def list(self) -> list[dict]:
        out = []
        for path in sorted(self.dir.glob("h*.json"), key=lambda p: p.stat().st_mtime):
            try:
                out.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return out

    def ack(self, piece_id: str) -> bool:
        if not _ID.match(piece_id or ""):
            return False
        path = self.dir / f"{piece_id}.json"
        existed = path.exists()
        path.unlink(missing_ok=True)
        return existed
