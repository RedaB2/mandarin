#!/usr/bin/env bash
# Windows Git Bash version - uses venv/Scripts (Windows Python venv structure)

cd frontend && npm install && npm run build && cd ..

if [ ! -d "venv" ]; then
    python -m venv venv
fi

# Windows: venv/Scripts/activate; Unix: venv/bin/activate
if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

pip install -r requirements.txt
