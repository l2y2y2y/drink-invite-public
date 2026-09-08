import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Literal, Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

LOGGER = logging.getLogger(__name__)
DB_PATH = os.environ.get("DRINK_INVITE_DB_PATH", "/tmp/drink_invite_public.db")


class HostResponse(BaseModel):
    id: str
    nickname: str
    avatar: str


class LoginRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=24)


class InviteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=60)
    event_date: str
    event_time: str
    venue: str = Field(..., min_length=1, max_length=100)
    vibe: str = Field("轻松喝点", max_length=20)
    message: str = Field("忙完这一周，见面再说。", max_length=140)
    capacity: int = Field(8, ge=2, le=50)
    aa_rule: str = Field(..., min_length=1, max_length=60)
    house_rules: str = Field("不灌酒，可跳过游戏，迟到提前说。", max_length=200)
    review_required: bool = True
    adults_only: bool = True
    public_share: bool = True
    cover_style: Literal["amber", "velvet"] = "amber"


class InviteUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=60)
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    venue: Optional[str] = Field(None, min_length=1, max_length=100)
    vibe: Optional[str] = Field(None, max_length=20)
    message: Optional[str] = Field(None, max_length=140)
    capacity: Optional[int] = Field(None, ge=2, le=50)
    aa_rule: Optional[str] = Field(None, min_length=1, max_length=60)
    house_rules: Optional[str] = Field(None, max_length=200)
    review_required: Optional[bool] = None
    adults_only: Optional[bool] = None
    public_share: Optional[bool] = None
    cover_style: Optional[Literal["amber", "velvet"]] = None
    status: Optional[Literal["open", "ongoing", "ended", "cancelled"]] = None


class RSVPRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=24)
    response: Literal["going", "maybe", "cancelled"]
    note: str = Field("", max_length=80)
    visitor_id: Optional[str] = None


class ReviewRequest(BaseModel):
    rsvp_id: str = Field(..., min_length=1)
    action: Literal["approve", "waitlist", "reject"]


class ReportRequest(BaseModel):
    reporter_name: str = Field(..., min_length=1, max_length=24)
    target_type: Literal["invite", "game", "external_game"]
    content: str = Field(..., min_length=1, max_length=200)


DAILY_GAME_POOL = [
    {"id": "truth-or-drink", "title": "Truth or Drink 在线局", "tag": "双人破冰", "fit": "适合熟人暖场", "jump_type": "h5", "url": "https://truthordrink.app/", "description": "问题强度适中，适合两三个人轮流接招。", "source": "精选 H5"},
    {"id": "gartic-phone", "title": "Gartic Phone 画画传话", "tag": "多人轻对抗", "fit": "适合 4-8 人", "jump_type": "h5", "url": "https://garticphone.com/zh-CN", "description": "适合酒局后半场，氛围容易被带起来。", "source": "白名单站点"},
    {"id": "skribbl", "title": "skribbl.io 你画我猜", "tag": "聚会向", "fit": "适合 3-10 人", "jump_type": "h5", "url": "https://skribbl.io/", "description": "规则简单，进入成本低，适合熟人群体。", "source": "白名单站点"},
    {"id": "aftertaste", "title": "Aftertaste 酒桌快问", "tag": "今晚精选", "fit": "适合 2-6 人", "jump_type": "internal", "url": "/?game=aftertaste", "description": "更适合朋友之间的快问快答，节奏轻。", "source": "内置扩展"},
    {"id": "playlist-battle", "title": "Playlist Battle 歌单对决", "tag": "轻剧情", "fit": "适合熟人局", "jump_type": "internal", "url": "/?game=playlist-battle", "description": "每人出一首歌配一个故事，更适合聊天局。", "source": "内置扩展"},
]


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def connection() -> sqlite3.Connection:
    database = sqlite3.connect(DB_PATH, timeout=15)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA foreign_keys = ON")
    database.execute("PRAGMA journal_mode = WAL")
    return database


def init_database() -> None:
    database = connection()
    database.executescript(
        """
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY, nickname TEXT NOT NULL, avatar TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invites (
            id TEXT PRIMARY KEY, share_id TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL,
            title TEXT NOT NULL, event_date TEXT NOT NULL, event_time TEXT NOT NULL,
            venue TEXT NOT NULL, vibe TEXT NOT NULL, message TEXT NOT NULL,
            capacity INTEGER NOT NULL, aa_rule TEXT NOT NULL, house_rules TEXT NOT NULL,
            review_required INTEGER NOT NULL, adults_only INTEGER NOT NULL,
            public_share INTEGER NOT NULL, status TEXT NOT NULL, cover_style TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(host_id) REFERENCES hosts(id)
        );
        CREATE TABLE IF NOT EXISTS rsvps (
            id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, visitor_id TEXT NOT NULL,
            nickname TEXT NOT NULL, response TEXT NOT NULL, status TEXT NOT NULL,
            note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(invite_id, visitor_id), FOREIGN KEY(invite_id) REFERENCES invites(id)
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, kind TEXT NOT NULL,
            audience TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
            created_at TEXT NOT NULL, FOREIGN KEY(invite_id) REFERENCES invites(id)
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, label TEXT NOT NULL,
            scheduled_at TEXT NOT NULL, status TEXT NOT NULL,
            FOREIGN KEY(invite_id) REFERENCES invites(id)
        );
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, reporter_name TEXT NOT NULL,
            target_type TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(invite_id) REFERENCES invites(id)
        );
        """
    )
    database.commit()
    database.close()


def require_host(database: sqlite3.Connection, token: Optional[str]) -> sqlite3.Row:
    if not token:
        raise HTTPException(status_code=401, detail="请先确认主理人身份")
    host = database.execute("SELECT * FROM hosts WHERE token = ?", (token,)).fetchone()
    if host is None:
        raise HTTPException(status_code=401, detail="主理人身份已失效，请重新确认")
    return host


def notify(database: sqlite3.Connection, invite_id: str, kind: str, audience: str, title: str, body: str) -> None:
    database.execute(
        "INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)",
        (secrets.token_hex(8), invite_id, kind, audience, title, body, now_iso()),
    )


def sync_reminders(database: sqlite3.Connection, invite_id: str, event_date: str, event_time: str) -> None:
    database.execute("DELETE FROM reminders WHERE invite_id = ?", (invite_id,))
    try:
        event_at = datetime.strptime("%s %s" % (event_date, event_time), "%Y-%m-%d %H:%M")
    except ValueError:
        return
    options = [("T-1 天提醒", timedelta(days=1)), ("T-2 小时提醒", timedelta(hours=2)), ("T-30 分钟提醒", timedelta(minutes=30))]
    future = []
    for label, delta in options:
        scheduled_at = event_at - delta
        if scheduled_at > datetime.now():
            future.append((label, scheduled_at.replace(microsecond=0).isoformat() + "Z"))
    for label, scheduled_at in future[:2]:
        database.execute(
            "INSERT INTO reminders VALUES (?, ?, ?, ?, 'scheduled')",
            (secrets.token_hex(8), invite_id, label, scheduled_at),
        )


def approved_going(database: sqlite3.Connection, invite_id: str, exclude_id: Optional[str] = None) -> int:
    sql = "SELECT COUNT(*) AS total FROM rsvps WHERE invite_id = ? AND response = 'going' AND status = 'approved'"
    params = [invite_id]
    if exclude_id:
        sql += " AND id != ?"
        params.append(exclude_id)
    row = database.execute(sql, params).fetchone()
    return int(row["total"] if row else 0)


def initial_status(database: sqlite3.Connection, invite: sqlite3.Row, response: str, exclude_id: Optional[str] = None) -> str:
    if response == "cancelled":
        return "cancelled"
    if invite["status"] != "open":
        raise HTTPException(status_code=409, detail="当前酒局已关闭报名")
    if response == "going" and approved_going(database, invite["id"], exclude_id) >= int(invite["capacity"]):
        return "waitlist"
    return "pending" if int(invite["review_required"]) else "approved"


def promote_waitlist(database: sqlite3.Connection, invite: sqlite3.Row) -> None:
    if invite["status"] != "open" or approved_going(database, invite["id"]) >= int(invite["capacity"]):
        return
    item = database.execute(
        "SELECT * FROM rsvps WHERE invite_id = ? AND response = 'going' AND status = 'waitlist' ORDER BY created_at LIMIT 1",
        (invite["id"],),
    ).fetchone()
    if item:
        next_status = "pending" if int(invite["review_required"]) else "approved"
        database.execute("UPDATE rsvps SET status = ?, updated_at = ? WHERE id = ?", (next_status, now_iso(), item["id"]))
        notify(database, invite["id"], "waitlist_promoted", "guest", "候补有空位了", "%s 的状态已更新。" % item["nickname"])


def host_payload(row: sqlite3.Row) -> Dict[str, str]:
    return {"id": row["id"], "nickname": row["nickname"], "avatar": row["avatar"]}


def invite_payload(database: sqlite3.Connection, invite: sqlite3.Row, host_id: Optional[str] = None, visitor_id: Optional[str] = None) -> Dict[str, object]:
    host = database.execute("SELECT * FROM hosts WHERE id = ?", (invite["host_id"],)).fetchone()
    rsvps = database.execute("SELECT * FROM rsvps WHERE invite_id = ? ORDER BY created_at DESC", (invite["id"],)).fetchall()
    is_host = bool(host_id and host_id == invite["host_id"])
    counts = {"approved_going": 0, "approved_maybe": 0, "pending": 0, "waitlist": 0, "rejected": 0, "cancelled": 0}
    items = []
    for row in rsvps:
        status = row["status"]
        response = row["response"]
        if status == "approved" and response == "going":
            counts["approved_going"] += 1
        elif status == "approved" and response == "maybe":
            counts["approved_maybe"] += 1
        elif status in counts:
            counts[status] += 1
        is_self = bool(visitor_id and visitor_id == row["visitor_id"])
        items.append({
            "id": row["id"],
            "visitor_id": row["visitor_id"] if is_host or is_self else "",
            "nickname": row["nickname"],
            "response": response,
            "status": status,
            "note": row["note"] if is_host or is_self else "",
            "updated_at": row["updated_at"],
        })
    reminders = database.execute("SELECT * FROM reminders WHERE invite_id = ? ORDER BY scheduled_at", (invite["id"],)).fetchall()
    notes = database.execute("SELECT * FROM notifications WHERE invite_id = ? ORDER BY created_at DESC LIMIT 12", (invite["id"],)).fetchall() if is_host else []
    return {
        "id": invite["id"], "share_id": invite["share_id"], "title": invite["title"],
        "event_date": invite["event_date"], "event_time": invite["event_time"], "venue": invite["venue"],
        "vibe": invite["vibe"], "message": invite["message"], "capacity": invite["capacity"],
        "aa_rule": invite["aa_rule"], "house_rules": invite["house_rules"],
        "review_required": bool(invite["review_required"]), "adults_only": bool(invite["adults_only"]),
        "public_share": bool(invite["public_share"]), "status": invite["status"],
        "cover_style": invite["cover_style"], "created_at": invite["created_at"], "updated_at": invite["updated_at"],
        "viewer_is_host": is_host, "host": host_payload(host), "counts": dict(counts, total=len(items)), "rsvps": items,
        "reminders": [{"id": row["id"], "label": row["label"], "scheduled_at": row["scheduled_at"], "status": row["status"]} for row in reminders],
        "notifications": [{"id": row["id"], "kind": row["kind"], "audience": row["audience"], "title": row["title"], "body": row["body"], "created_at": row["created_at"]} for row in notes],
    }


def setup_permissions(app: FastAPI) -> None:
    """This public product intentionally uses invite-scoped tokens, not ByteCloud SSO."""


def register_routes(app: FastAPI) -> None:
    @app.get("/api")
    def index_handler() -> Dict[str, str]:
        return {"message": "drink invite public api ready"}

    @app.get("/api/v1/ping")
    def ping_handler() -> Dict[str, str]:
        return {"status": "ok", "now": now_iso()}

    @app.post("/api/v1/auth/wechat/demo")
    @app.post("/api/v1/auth/host")
    def create_host(payload: LoginRequest):
        database = connection()
        host_id = secrets.token_hex(8)
        token = secrets.token_urlsafe(24)
        database.execute("INSERT INTO hosts VALUES (?, ?, ?, ?, ?)", (host_id, payload.nickname, "", token, now_iso()))
        database.commit()
        host = database.execute("SELECT * FROM hosts WHERE id = ?", (host_id,)).fetchone()
        database.close()
        return {"host_token": token, "host": host_payload(host)}

    @app.get("/api/v1/games/daily")
    def daily_games() -> Dict[str, object]:
        start = datetime.utcnow().timetuple().tm_yday % len(DAILY_GAME_POOL)
        items = []
        for offset in range(4):
            item = dict(DAILY_GAME_POOL[(start + offset) % len(DAILY_GAME_POOL)])
            item["rank"] = offset + 1
            items.append(item)
        return {"date": datetime.utcnow().strftime("%Y-%m-%d"), "items": items}

    @app.post("/api/v1/invites")
    def create_invite(payload: InviteCreate, x_host_token: Optional[str] = Header(None)):
        database = connection()
        host = require_host(database, x_host_token)
        invite_id = secrets.token_hex(8)
        share_id = secrets.token_urlsafe(9).replace("-", "").replace("_", "")
        created_at = now_iso()
        database.execute(
            "INSERT INTO invites VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
            (invite_id, share_id, host["id"], payload.title, payload.event_date, payload.event_time, payload.venue, payload.vibe, payload.message, payload.capacity, payload.aa_rule, payload.house_rules, int(payload.review_required), int(payload.adults_only), int(payload.public_share), payload.cover_style, created_at, created_at),
        )
        sync_reminders(database, invite_id, payload.event_date, payload.event_time)
        notify(database, invite_id, "invite_created", "host", "酒局已创建", "%s 已生成公开分享链接。" % payload.title)
        database.commit()
        invite = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        result = invite_payload(database, invite, host["id"])
        database.close()
        return result

    @app.get("/api/v1/invites/{share_id}")
    def get_invite(share_id: str, x_host_token: Optional[str] = Header(None), x_visitor_id: Optional[str] = Header(None)):
        database = connection()
        invite = database.execute("SELECT * FROM invites WHERE share_id = ?", (share_id,)).fetchone()
        if invite is None:
            database.close()
            raise HTTPException(status_code=404, detail="这张邀请卡已经找不到了")
        host = database.execute("SELECT * FROM hosts WHERE token = ?", (x_host_token,)).fetchone() if x_host_token else None
        result = invite_payload(database, invite, host["id"] if host else None, x_visitor_id)
        database.close()
        return result

    @app.post("/api/v1/invites/{share_id}/rsvp")
    def submit_rsvp(share_id: str, payload: RSVPRequest):
        database = connection()
        invite = database.execute("SELECT * FROM invites WHERE share_id = ?", (share_id,)).fetchone()
        if invite is None:
            database.close()
            raise HTTPException(status_code=404, detail="邀请卡不存在")
        visitor_id = payload.visitor_id or secrets.token_urlsafe(12)
        existing = database.execute("SELECT * FROM rsvps WHERE invite_id = ? AND visitor_id = ?", (invite["id"], visitor_id)).fetchone()
        status = initial_status(database, invite, payload.response, existing["id"] if existing else None)
        if existing:
            was_confirmed = existing["response"] == "going" and existing["status"] == "approved"
            database.execute("UPDATE rsvps SET nickname = ?, response = ?, status = ?, note = ?, updated_at = ? WHERE id = ?", (payload.nickname, payload.response, status, payload.note, now_iso(), existing["id"]))
            if was_confirmed and payload.response == "cancelled":
                promote_waitlist(database, invite)
        else:
            database.execute("INSERT INTO rsvps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (secrets.token_hex(8), invite["id"], visitor_id, payload.nickname, payload.response, status, payload.note, now_iso(), now_iso()))
        notify(database, invite["id"], "rsvp_updated", "host", "报名状态有更新", "%s 提交了报名，当前状态为 %s。" % (payload.nickname, status))
        database.commit()
        fresh = database.execute("SELECT * FROM invites WHERE id = ?", (invite["id"],)).fetchone()
        result = invite_payload(database, fresh, visitor_id=visitor_id)
        database.close()
        return {"visitor_id": visitor_id, "invite": result}

    @app.post("/api/v1/invites/{invite_id}/review")
    def review_rsvp(invite_id: str, payload: ReviewRequest, x_host_token: Optional[str] = Header(None)):
        database = connection()
        host = require_host(database, x_host_token)
        invite = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        if invite is None or invite["host_id"] != host["id"]:
            database.close()
            raise HTTPException(status_code=403, detail="只有主理人能审核名单")
        rsvp = database.execute("SELECT * FROM rsvps WHERE id = ? AND invite_id = ?", (payload.rsvp_id, invite_id)).fetchone()
        if rsvp is None:
            database.close()
            raise HTTPException(status_code=404, detail="报名记录不存在")
        if payload.action == "approve":
            next_status = "waitlist" if rsvp["response"] == "going" and approved_going(database, invite_id, rsvp["id"]) >= int(invite["capacity"]) else "approved"
        else:
            next_status = "waitlist" if payload.action == "waitlist" else "rejected"
        database.execute("UPDATE rsvps SET status = ?, updated_at = ? WHERE id = ?", (next_status, now_iso(), rsvp["id"]))
        notify(database, invite_id, "review_decision", "guest", "主理人更新了报名状态", "%s 当前状态为 %s。" % (rsvp["nickname"], next_status))
        database.commit()
        fresh = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        result = invite_payload(database, fresh, host["id"])
        database.close()
        return result

    @app.patch("/api/v1/invites/{invite_id}")
    def update_invite(invite_id: str, payload: InviteUpdate, x_host_token: Optional[str] = Header(None)):
        database = connection()
        host = require_host(database, x_host_token)
        invite = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        if invite is None or invite["host_id"] != host["id"]:
            database.close()
            raise HTTPException(status_code=403, detail="只有主理人能修改这场局")
        updates = payload.dict(exclude_none=True)
        if updates:
            fields = []
            values = []
            for key, value in updates.items():
                fields.append("%s = ?" % key)
                values.append(int(value) if isinstance(value, bool) else value)
            fields.append("updated_at = ?")
            values.extend([now_iso(), invite_id])
            database.execute("UPDATE invites SET %s WHERE id = ?" % ", ".join(fields), values)
            if "event_date" in updates or "event_time" in updates:
                fresh_for_time = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
                sync_reminders(database, invite_id, fresh_for_time["event_date"], fresh_for_time["event_time"])
            if updates.get("status") in ("cancelled", "ended"):
                notify(database, invite_id, "invite_status", "all", "酒局状态有更新", "当前状态：%s" % updates["status"])
            database.commit()
        fresh = database.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
        result = invite_payload(database, fresh, host["id"])
        database.close()
        return result

    @app.post("/api/v1/invites/{share_id}/report")
    def report_invite(share_id: str, payload: ReportRequest):
        database = connection()
        invite = database.execute("SELECT * FROM invites WHERE share_id = ?", (share_id,)).fetchone()
        if invite is None:
            database.close()
            raise HTTPException(status_code=404, detail="邀请卡不存在")
        database.execute("INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?)", (secrets.token_hex(8), invite["id"], payload.reporter_name, payload.target_type, payload.content, now_iso()))
        notify(database, invite["id"], "report_created", "host", "收到一条举报", "举报类型：%s。" % payload.target_type)
        database.commit()
        database.close()
        return {"ok": True, "message": "已收到举报"}


init_database()
app = FastAPI(
    title="Drink Invite Public API",
    version="3.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


setup_permissions(app)
register_routes(app)


# ---------------------------DO NOT EDIT CODE BELOW THIS LINE---------------------------------
# This is the entry point for the FastAPI application.
if __name__ == "__main__":
    port = int(os.environ.get("_BYTEFAAS_RUNTIME_PORT", 8000))
    config = uvicorn.Config("main:app", port=port, log_level="info", host=None)
    server = uvicorn.Server(config)
    server.run()
# --------------------------------------------------------------------------------------------
