"""Backend for the Stave page in Hermes Desktop, mounted at ``/api/plugins/stave/``.

It serves the inbox of pieces the agent opened with ``stave_open`` (files under
``<hermes home>/plugin-data/stave/inbox/``) and removes each one once the page has taken it.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def _inbox_module():
    name = "hermes_stave_inbox"
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / "inbox.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module


router = APIRouter()


@router.get("/inbox")
def inbox() -> dict:
    return {"pieces": _inbox_module().Inbox().list()}


@router.post("/inbox/{piece_id}/ack")
def ack(piece_id: str) -> dict:
    return {"removed": _inbox_module().Inbox().ack(piece_id)}
