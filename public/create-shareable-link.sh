#!/bin/bash

# Cloudflare Tunnel Script
# This script creates a shareable public link using Cloudflare Tunnel

echo "🌐 Creating shareable public link with Cloudflare Tunnel..."

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared is not installed."
    echo ""
    echo "📥 To install cloudflared:"
    echo "   macOS: brew install cloudflared"
    echo "   Linux: Download from https://github.com/cloudflare/cloudflared/releases"
    echo "   Windows: Download from https://github.com/cloudflare/cloudflared/releases"
    echo ""
    exit 1
fi

# Start local server in background
echo "🚀 Starting local server on port 8080..."
cd public
if command -v python3 &> /dev/null; then
    python3 -m http.server 8080 > /dev/null 2>&1 &
elif command -v python &> /dev/null; then
    python -m http.server 8080 > /dev/null 2>&1 &
else
    echo "❌ Python not found. Please install Python 3."
    exit 1
fi

SERVER_PID=$!
sleep 2

echo "🔗 Creating Cloudflare tunnel..."
echo "⏳ This may take a few seconds..."
echo ""

# Create tunnel
cloudflared tunnel --url http://localhost:8080 &
TUNNEL_PID=$!

# Wait a bit for tunnel to establish
sleep 3

echo ""
echo "✅ Tunnel created! Check the output above for your public URL."
echo "📋 Share the https://....trycloudflare.com URL with anyone!"
echo ""
echo "🛑 Press Ctrl+C to stop both the server and tunnel"

# Function to cleanup when script exits
cleanup() {
    echo ""
    echo "🛑 Stopping server and tunnel..."
    kill $SERVER_PID 2>/dev/null
    kill $TUNNEL_PID 2>/dev/null
    echo "✅ Cleanup complete"
    exit 0
}

# Set trap to cleanup on exit
trap cleanup SIGINT SIGTERM

# Wait for user to stop
wait $TUNNEL_PID