#!/bin/bash

# Quick Local Server Script
# This script starts a local development server for testing

echo "🚀 Starting local development server..."

# Check if Python 3 is available
if command -v python3 &> /dev/null; then
    echo "📍 Using Python 3 HTTP server"
    echo "🌐 Server will be available at: http://localhost:8080"
    echo "🛑 Press Ctrl+C to stop the server"
    echo ""
    cd public && python3 -m http.server 8080
elif command -v python &> /dev/null; then
    echo "📍 Using Python HTTP server"
    echo "🌐 Server will be available at: http://localhost:8080"
    echo "🛑 Press Ctrl+C to stop the server"
    echo ""
    cd public && python -m http.server 8080
elif command -v node &> /dev/null; then
    echo "📍 Using Node.js serve (installing if needed)"
    if ! command -v serve &> /dev/null; then
        echo "Installing serve globally..."
        npm install -g serve
    fi
    echo "🌐 Server will be available at: http://localhost:8080"
    echo "🛑 Press Ctrl+C to stop the server"
    echo ""
    cd public && serve -p 8080
else
    echo "❌ No suitable server found. Please install Python 3 or Node.js"
    echo "   Python 3: https://python.org"
    echo "   Node.js: https://nodejs.org"
    exit 1
fi