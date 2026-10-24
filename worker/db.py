"""Service-role Supabase client for the worker. Never ship this key to a browser."""
from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
