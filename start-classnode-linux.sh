#!/bin/bash
# ClassNode - AI Classroom System (Linux)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
cd "$SCRIPT_DIR" || exit 1

FRONTEND_PORT=3001
BACKEND_PORT=3002

echo ""
echo "  ========================================"
echo "     ClassNode - AI Classroom System"
echo "  ========================================"
echo ""

# ============================================================
# Check Node.js
# ============================================================
if ! command -v node &> /dev/null; then
  echo "  [Error] Node.js not found. Install from https://nodejs.org"
  read -p "Press Enter to exit..."
  exit 1
fi
echo "  Node.js $(node -v)"

# ============================================================
# Clean up old processes on target ports
# ============================================================
for PORT in $FRONTEND_PORT $BACKEND_PORT; do
  PID=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID 2>/dev/null
    sleep 1
    echo "  Freed port $PORT (was PID $PID)"
  fi
done

# ============================================================
# Install dependencies
# ============================================================
if [ ! -d "node_modules" ]; then
  echo ""
  echo "  ----------------------------------------"
  echo "  Installing frontend dependencies..."
  echo "  ----------------------------------------"
  npm install
  if [ $? -ne 0 ]; then
    echo "  [Error] Frontend install failed"
    read -p "Press Enter to exit..."
    exit 1
  fi
fi

if [ ! -d "server/node_modules" ]; then
  echo ""
  echo "  ----------------------------------------"
  echo "  Installing server dependencies..."
  echo "  ----------------------------------------"
  cd server && npm install && cd ..
  if [ $? -ne 0 ]; then
    echo "  [Error] Server install failed"
    read -p "Press Enter to exit..."
    exit 1
  fi
fi

# ============================================================
# Build frontend
# ============================================================
if [ ! -d "out" ]; then
  echo ""
  echo "  ----------------------------------------"
  echo "  Building frontend..."
  echo "  ----------------------------------------"
  NEXT_PUBLIC_BACKEND_PORT="${BACKEND_PORT}" node "$SCRIPT_DIR/_run-cmd.js" next/dist/bin/next build
  if [ $? -ne 0 ]; then
    echo "  [Error] Frontend build failed"
    read -p "Press Enter to exit..."
    exit 1
  fi
fi

# ============================================================
# Create .env if missing
# ============================================================
if [ ! -f server/.env ]; then
  if [ -f server/.env.example ]; then
    cp server/.env.example server/.env
    echo "  ✔ Created server/.env"
  else
    echo 'DATABASE_URL="file:./dev.db"' > server/.env
    echo "PORT=3001" >> server/.env
  fi
fi

# ============================================================
# Ensure server dependencies installed (pnpm 可能导致 .bin 缺失)
# ============================================================

# ============================================================
# Initialize database and build backend
# ============================================================
if [ ! -d "server/dist" ]; then
  echo ""
  echo "  ----------------------------------------"
  echo "  Initializing database..."
  echo "  ----------------------------------------"
  if ! node -e "require.resolve('prisma/build/index.js')" 2>/dev/null; then
    cd server && npm install prisma && cd "$SCRIPT_DIR"
  fi
  cd "$SCRIPT_DIR/server" && node "$SCRIPT_DIR/_run-cmd.js" prisma/build/index.js db push --accept-data-loss && cd "$SCRIPT_DIR"
  if [ $? -ne 0 ]; then
    echo "  [Error] Database init failed"
    read -p "Press Enter to exit..."
    exit 1
  fi

  echo ""
  echo "  ----------------------------------------"
  echo "  Building backend..."
  echo "  ----------------------------------------"
  cd server && node -e "require.resolve('typescript/bin/tsc')" 2>/dev/null || npm install && node "$SCRIPT_DIR/_run-cmd.js" typescript/bin/tsc && cd ..
  if [ $? -ne 0 ]; then
    echo "  [Error] Backend build failed"
    read -p "Press Enter to exit..."
    exit 1
  fi
else
  echo ""
  echo "  ----------------------------------------"
  echo "  Updating database..."
  echo "  ----------------------------------------"
  if ! node -e "require.resolve('prisma/build/index.js')" 2>/dev/null; then
    cd server && npm install prisma && cd "$SCRIPT_DIR"
  fi
  cd "$SCRIPT_DIR/server" && node "$SCRIPT_DIR/_run-cmd.js" prisma/build/index.js db push --accept-data-loss && cd "$SCRIPT_DIR"
fi

# ============================================================
# Start services
# ============================================================
echo ""
echo "  ----------------------------------------"
echo "  Starting services..."
echo "  ----------------------------------------"

FRONTEND_PORT="${FRONTEND_PORT}" PORT="${BACKEND_PORT}" node "$SCRIPT_DIR/server/dist/index.js" &
SERVER_PID=$!

sleep 2

PORT="${FRONTEND_PORT}" BACKEND_PORT="${BACKEND_PORT}" node "$SCRIPT_DIR/serve-frontend.js" &
FRONTEND_PID=$!

sleep 1

echo ""
echo "  ========================================"
echo "    ClassNode is running!"
echo ""
echo "    Teacher: http://localhost:${FRONTEND_PORT}/teacher"
echo "    Student: http://localhost:${FRONTEND_PORT}/classroom"
echo ""
echo "    Press Ctrl+C to stop"
echo "  ========================================"
echo ""

if command -v xdg-open &> /dev/null; then
  xdg-open "http://localhost:${FRONTEND_PORT}/teacher"
fi

cleanup() {
  echo ""
  echo "  Shutting down..."
  kill $SERVER_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  echo "  Stopped"
  exit 0
}
trap cleanup INT TERM
wait
