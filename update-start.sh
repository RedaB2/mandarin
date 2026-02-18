#!/bin/bash

cd frontend && npm install && npm run build && cd ..

if [ ! -d "venv" ]; then
    python -m venv venv
fi

source venv/bin/activate

pip install -r requirements.txt

python app.py