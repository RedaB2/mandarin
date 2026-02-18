"""SQLAlchemy ORM models. Chat, Message, Memory."""
from datetime import datetime
import json
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Text, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.sqlite import JSON

db = SQLAlchemy()


class Chat(db.Model):
    __tablename__ = "chats"
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    title = db.Column(Text, nullable=False, default="New chat")
    created_at = db.Column(DateTime, default=datetime.utcnow)
    updated_at = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    context_ids = db.Column(JSON, nullable=True)  # list of context file ids

    messages = db.relationship("Message", backref="chat", order_by="Message.created_at", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "context_ids": self.context_ids or [],
        }


class Message(db.Model):
    __tablename__ = "messages"
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    chat_id = db.Column(Integer, ForeignKey("chats.id"), nullable=False)
    role = db.Column(Text, nullable=False)  # "user" | "assistant"
    content = db.Column(Text, nullable=False, default="")
    created_at = db.Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "chat_id": self.chat_id,
            "role": self.role,
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Memory(db.Model):
    __tablename__ = "memory"
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    content = db.Column(Text, nullable=False)
    tags = db.Column(JSON, nullable=True)  # list of strings
    created_at = db.Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "content": self.content,
            "tags": self.tags or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
