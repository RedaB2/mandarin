"""Flask app entry. Local deployment only; serves React build and API."""
import os
from pathlib import Path

from flask import Flask, render_template, current_app

import config
from backend.models import db
from backend.routes.api import api_bp
from backend.services.rag import sync_memories_from_db

config.ensure_data_dirs()

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="frontend/build",
    static_url_path="",
)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{config.DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)
app.register_blueprint(api_bp)

with app.app_context():
    db.create_all()
    # Migration: add web_search and message.meta columns if missing (e.g. existing DBs)
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            for stmt in (
                "ALTER TABLE chats ADD COLUMN web_search_enabled BOOLEAN DEFAULT 0",
                "ALTER TABLE messages ADD COLUMN meta JSON",
                "ALTER TABLE messages ADD COLUMN attachments JSON",
            ):
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception:
                    pass
    except Exception:
        pass
    sync_memories_from_db(app)


@app.route("/")
def index_chat():
    return render_template("index.html", page="chat")


@app.route("/contexts")
def index_contexts():
    return render_template("index.html", page="contexts")


@app.route("/rules")
def index_rules():
    return render_template("index.html", page="rules")


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    """Serve built frontend assets so CSS and JS load reliably."""
    return current_app.send_static_file("assets/" + filename)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
