"""Settings, read from backend/.env (or real environment variables, which take precedence)."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore", populate_by_name=True)

    # Read-only role (database/roles/001_api_readonly_role.sql). Used by every GET endpoint.
    api_database_url: str = Field(..., alias="API_DATABASE_URL")
    # Write role (database/roles/002_api_write_role.sql). Used only by the import endpoints.
    api_write_database_url: str | None = Field(None, alias="API_WRITE_DATABASE_URL")
    # Optional schema to run against (isolated test schemas). Production leaves it unset (public).
    db_search_path: str | None = None
    db_pool_min: int = 1
    db_pool_max: int = 5
    db_connect_timeout: float = 10.0

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Import limits.
    import_max_bytes: int = 5 * 1024 * 1024
    import_max_rows: int = 5000
    import_session_hours: int = 24

    # Workspace metadata shown in the header. Not stored in the database.
    app_profile: str = Field("demo", alias="APP_PROFILE")
    workspace_name: str = "Demo Fund I"
    workspace_currency: str = "USD"
    workspace_unit: str = "millions"
    workspace_user_name: str = "Demo User"
    workspace_user_role: str = "Operating Partner"

    # AI investigation (Gemini REST API). Without a key only the labelled mock investigation is offered.
    gemini_api_key: str | None = Field(None, alias="GEMINI_API_KEY")
    gemini_model: str = Field("gemini-2.5-flash", alias="GEMINI_MODEL")
    ai_timeout_seconds: float = 45.0

    @property
    def ai_mode(self) -> str:
        return "live" if self.gemini_api_key else "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
