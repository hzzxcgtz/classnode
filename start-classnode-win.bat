@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set FRONTEND_PORT=3002
set BACKEND_PORT=3003

echo.
echo  ========================================
echo     ClassNode - AI Classroom System
echo  ========================================
echo.

:: ============================================================
:: Check Node.js
:: ============================================================
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [Error] Node.js not found. Install from https://nodejs.org
    goto :end
)

for /f "tokens=*" %%i in ('node -v') do echo  Node.js %%i

:: ============================================================
:: Install dependencies
:: ============================================================
if not exist "node_modules" (
    echo.
    echo  ----------------------------------------
    echo  Installing frontend dependencies...
    echo  ----------------------------------------
    call npm install
    if errorlevel 1 (
        echo  [Error] Frontend install failed
        goto :end
    )
)

if not exist "server\node_modules" (
    echo.
    echo  ----------------------------------------
    echo  Installing server dependencies...
    echo  ----------------------------------------
    pushd server
    call npm install
    popd
    if errorlevel 1 (
        echo  [Error] Server install failed
        goto :end
    )
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
    set "NEXT_PUBLIC_FRONTEND_PORT=%FRONTEND_PORT%"
    node "node_modules\next\dist\bin\next" build --webpack
    if errorlevel 1 (
        echo  [Error] Frontend build failed
        goto :end
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
    pushd server
    call node_modules\.bin\prisma db push
    if errorlevel 1 (
        popd
        echo  [Error] Database init failed
        goto :end
    )
    popd

    echo.
    echo  ----------------------------------------
    echo  Building backend...
    echo  ----------------------------------------
    pushd server
    call ..\node_modules\.bin\tsc
    if errorlevel 1 (
        popd
        echo  [Error] Backend build failed
        goto :end
    )
    popd
) else (
    echo.
    echo  ----------------------------------------
    echo  Updating database...
    echo  ----------------------------------------
    pushd server
    call node_modules\.bin\prisma db push
    popd
)

:: ============================================================
:: Start services
:: ============================================================
echo.
echo  ----------------------------------------
echo  Starting services...
echo  ----------------------------------------
set SUCCESS=1

start "ClassNode-Server" cmd /d /c "cd /d server && set FRONTEND_PORT=%FRONTEND_PORT% && set PORT=%BACKEND_PORT% && node dist/index.js"
timeout /t 3 /nobreak >nul

start "ClassNode-Frontend" cmd /d /c "cd /d %~dp0 && set PORT=%FRONTEND_PORT% && node serve-frontend.js"
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
