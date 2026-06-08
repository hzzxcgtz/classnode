@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set FRONTEND_PORT=3000
set BACKEND_PORT=3001

echo.
echo  ========================================
echo     ClassNode - AI Classroom System
echo  ========================================
echo.

:: ============================================================
:: Check Node.js and pnpm
:: ============================================================
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [Error] Node.js not found. Install from https://nodejs.org
    goto :end
)
for /f "tokens=*" %%i in ('node -v') do echo  Node.js %%i

where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  Installing pnpm...
    call npm install -g pnpm@11.3.0
    if errorlevel 1 (
        echo  [Error] pnpm install failed
        goto :end
    )
)
for /f "tokens=*" %%i in ('pnpm -v') do echo  pnpm %%i

:: ============================================================
:: Clean up old processes on target ports
:: ============================================================
for %%p in (%FRONTEND_PORT% %BACKEND_PORT%) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p "') do (
        taskkill /f /pid %%a >nul 2>nul
    )
)

:: ============================================================
:: Install dependencies (pnpm 方式，兼容所有平台)
:: ============================================================
echo.
echo  ----------------------------------------
echo  Installing dependencies...
echo  ----------------------------------------
call pnpm install --frozen-lockfile 2>nul
if errorlevel 1 call pnpm install
if errorlevel 1 (
    echo  [Error] Install failed
    goto :end
)

:: ============================================================
:: Build frontend
:: ============================================================
if not exist "out" (
    echo.
    echo  ----------------------------------------
    echo  Building frontend...
    echo  ----------------------------------------
    set "NEXT_PUBLIC_BACKEND_PORT=%BACKEND_PORT%"
    call pnpm build
    if errorlevel 1 (
        echo  [Error] Frontend build failed
        goto :end
    )
)

:: ============================================================
:: Create .env if missing
:: ============================================================
if not exist "server\.env" (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo  Created server\.env
    ) else (
        echo DATABASE_URL="file:./dev.db" > "server\.env"
        echo PORT=%BACKEND_PORT% >> "server\.env"
    )
)

:: ============================================================
:: Initialize database and build backend
:: ============================================================
if not exist "server\dist" (
    echo.
    echo  ----------------------------------------
    echo  Initializing database...
    echo  ----------------------------------------
    call pnpm --filter classnode-server db:push
    if errorlevel 1 (
        echo  [Error] Database init failed
        goto :end
    )

    echo.
    echo  ----------------------------------------
    echo  Building backend...
    echo  ----------------------------------------
    call pnpm --filter classnode-server build
    if errorlevel 1 (
        echo  [Error] Backend build failed
        goto :end
    )
) else (
    echo.
    echo  ----------------------------------------
    echo  Updating database...
    echo  ----------------------------------------
    call pnpm --filter classnode-server db:push
)

:: ============================================================
:: Start services
:: ============================================================
echo.
echo  ----------------------------------------
echo  Starting services...
echo  ----------------------------------------
set SUCCESS=1

start "ClassNode-Server" cmd /d /c "cd /d server && set PORT=%BACKEND_PORT% && set FRONTEND_PORT=%FRONTEND_PORT% && node dist/index.js"
timeout /t 3 /nobreak >nul

start "ClassNode-Frontend" cmd /d /c "cd /d %~dp0 && set PORT=%FRONTEND_PORT% && set BACKEND_PORT=%BACKEND_PORT% && node serve-frontend.js"
timeout /t 2 /nobreak >nul

echo.
echo  ========================================
echo     ClassNode is running!
echo.
echo     Teacher: http://localhost:%FRONTEND_PORT%/teacher
echo     Student: http://localhost:%FRONTEND_PORT%/classroom
echo.
echo     Close the service windows to stop.
echo  ========================================
echo.

start http://localhost:%FRONTEND_PORT%/teacher
timeout /t 2 /nobreak >nul

:end
echo.
if not defined SUCCESS (
    echo  Press any key to exit...
    pause >nul
)
