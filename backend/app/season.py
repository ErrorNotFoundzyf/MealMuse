from datetime import datetime
from zoneinfo import ZoneInfo


def time_context(at: datetime | None = None):
    local = (at or datetime.now(ZoneInfo("Asia/Shanghai"))).astimezone(ZoneInfo("Asia/Shanghai"))
    month = local.month
    season = "spring" if 3 <= month <= 5 else "summer" if 6 <= month <= 8 else "autumn" if 9 <= month <= 11 else "winter"
    return {"as_of_date": local.date().isoformat(), "timezone": "Asia/Shanghai",
            "current_season": season, "calendar_id": "month_based_v1"}


def season_status(seasons: list[str], season: str):
    if not seasons:
        return "season_unknown"
    return "in_season" if "all_year" in seasons or season in seasons else "out_of_season"
