#!/bin/bash
# ClassNode - AI Classroom System (macOS)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
cd "$SCRIPT_DIR" || exit 1

FRONTEND_PORT=3000
BACKEND_PORT=3001

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
# Install dependencies (通过 Node.js 模块解析检测，兼容 pnpm)
# ============================================================
if ! node -e "require.resolve('next/dist/bin/next')" 2>/dev/null; then
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

if ! node -e "require.resolve('prisma/build/index.js')" 2>/dev/null; then
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
  NEXT_PUBLIC_BACKEND_PORT="${BACKEND_PORT}" node -e "process.argv.splice(2,0,'build');require(require.resolve('next/dist/bin/next'))"
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
    echo "PORT=${BACKEND_PORT}" >> server/.env
  fi
fi

# ============================================================
# Initialize database and build backend
# ============================================================
if [ ! -d "server/dist" ]; then
  echo ""
  echo "  ----------------------------------------"
  echo "  Initializing database..."
  echo "  ----------------------------------------"
  cd "$SCRIPT_DIR/server" && node -e "process.argv.splice(2,0,'db','push','--accept-data-loss');require(require.resolve('prisma/build/index.js'))" && cd "$SCRIPT_DIR"
  if [ $? -ne 0 ]; then
    echo "  [Error] Database init failed"
    read -p "Press Enter to exit..."
    exit 1
  fi

  echo ""
  echo "  ----------------------------------------"
  echo "  Building backend..."
  echo "  ----------------------------------------"
  cd server && node -e "require(require.resolve('typescript/bin/tsc'))" && cd ..
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
  cd "$SCRIPT_DIR/server" && node -e "process.argv.splice(2,0,'db','push','--accept-data-loss');require(require.resolve('prisma/build/index.js'))" && cd "$SCRIPT_DIR"
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

open "http://localhost:${FRONTEND_PORT}/teacher"

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
