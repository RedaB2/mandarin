#!/usr/bin/env python3
"""One-off script to re-embed all memories into Chroma with the current embedding model.

Run after switching RAG_EMBEDDING_MODEL (e.g. from MiniLM to BGE) so that all vectors
in Chroma use the new model. Clears the memory collection, then re-adds every Memory
from the DB.

Usage (from project root):
  python scripts/reembed_memories.py
  python scripts/reembed_memories.py --dry-run   # report count only, do not clear or write
"""
import sys
from pathlib import Path

# Ensure project root is on path when run as scripts/reembed_memories.py
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Re-embed all memories into Chroma with the current model.")
    parser.add_argument("--dry-run", action="store_true", help="Only report how many memories would be re-embedded.")
    args = parser.parse_args()

    from app import app
    from backend.models import Memory
    from backend.services import rag

    with app.app_context():
        memories = Memory.query.all()
        count = len(memories)

        if args.dry_run:
            print(f"Dry run: would clear Chroma memory collection and re-embed {count} memories.")
            return 0

        rag.clear_memory_collection()
        for m in memories:
            try:
                rag.add_memory(m.id, m.content)
            except Exception as e:
                print(f"Error re-embedding memory id={m.id}: {e}", file=sys.stderr)
                return 1

        print(f"Re-embedded {count} memories.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
