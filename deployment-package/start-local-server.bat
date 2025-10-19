@echo off
REM Quick Local Server Script for Windows
REM This script starts a local development server for testing

echo 🚀 Starting local development server...

REM Check if Python 3 is available
python3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo 📍 Using Python 3 HTTP server
    echo 🌐 Server will be available at: http://localhost:8080
    echo 🛑 Press Ctrl+C to stop the server
    echo.
    cd public && python3 -m http.server 8080
    goto :end
)

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo 📍 Using Python HTTP server
    echo 🌐 Server will be available at: http://localhost:8080
    echo 🛑 Press Ctrl+C to stop the server
    echo.
    cd public && python -m http.server 8080
    goto :end
)

REM Check if Node.js is available
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo 📍 Using Node.js serve
    npm list -g serve >nul 2>&1
    if %errorlevel% neq 0 (
        echo Installing serve globally...
        npm install -g serve
    )
    echo 🌐 Server will be available at: http://localhost:8080
    echo 🛑 Press Ctrl+C to stop the server
    echo.
    cd public && serve -p 8080
    goto :end
)

echo ❌ No suitable server found. Please install Python 3 or Node.js
echo    Python 3: https://python.org
echo    Node.js: https://nodejs.org
pause

:end