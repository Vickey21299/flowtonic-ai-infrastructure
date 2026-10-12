"""Create (or rotate the passwords of) the API database roles and write their URLs to .env.

    flownetic_api_ro  → API_DATABASE_URL        (read endpoints)
    flownetic_api_rw  → API_WRITE_DATABASE_URL  (import endpoints)

Uses the admin DATABASE_URL once; the API itself never connects with it.

    .venv/Scripts/python scripts/create_api_roles.py          # both roles
    .venv/Scripts/python scripts/create_api_roles.py rw       # only the write role
"""

import re
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

import psycopg

BACKEND = Path(__file__).resolve().parents[1]
ENV_FILE = BACKEND / ".env"
ROLES_DIR = BACKEND.parent / "database" / "roles"
ROLES = {
    "ro": ("flownetic_api_ro", ROLES_DIR / "001_api_readonly_role.sql", "API_DATABASE_URL"),
    "rw": ("flownetic_api_rw", ROLES_DIR / "002_api_write_role.sql", "API_WRITE_DATABASE_URL"),
}


def read_env() -> dict[str, str]:
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        m = re.match(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$', line)
        if m:
            env[m.group(1)] = m.group(2)
    return env


def set_env(name: str, value: str) -> None:
    text = ENV_FILE.read_text(encoding="utf-8")
    line = f'{name}="{value}"'
    if re.search(rf"^{name}=", text, flags=re.M):
        text = re.sub(rf"^{name}=.*$", lambda _: line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n" + line + "\n"
    ENV_FILE.write_text(text, encoding="utf-8")


def create(admin_url: str, key: str) -> None:
    role, sql_file, env_name = ROLES[key]
    password = secrets.token_urlsafe(32)  # URL-safe alphabet: no quoting problems in SQL or URLs
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(sql_file.read_text(encoding="utf-8").replace("__PASSWORD__", password))

    # Same host/port/db as the admin URL. The Supabase pooler expects "<role>.<project-ref>".
    parts = urlsplit(admin_url)
    admin_user = parts.username or ""
    user = f"{role}.{admin_user.split('.', 1)[1]}" if "." in admin_user else role
    set_env(env_name, f"postgresql://{quote(user)}:{password}@{parts.hostname}:{parts.port or 5432}{parts.path}")
    print(f"Role {role} ready; {env_name} written to backend/.env (user {user}).")


def main() -> None:
    keys = sys.argv[1:] or list(ROLES)
    admin_url = read_env()["DATABASE_URL"]
    for key in keys:
        create(admin_url, key)


if __name__ == "__main__":
    main()
