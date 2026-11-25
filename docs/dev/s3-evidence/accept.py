"""S3 真实验收：守卫在真服务器上是否真的挡住了「MCP 服务把 Krss 指到别处」。

两个受控 MCP 服务：
  A 127.0.0.1:8098  SSE 传输，endpoint 事件把 POST 地址换成 localhost（不同 host）→ 应被拒。
  B 127.0.0.1:8097  streamable-http，正常服务 → 应连通并列到工具。

Krss 跑在 127.0.0.1:8086，独立数据目录；注册后建两个 MCP 服务，各自调 /api/mcp/servers/<id>/test。
"""

import json
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KRSS = "http://127.0.0.1:8086"
RESULTS = []


def call(method, path, token=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(KRSS + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return err.code, {"raw": raw.decode(errors="replace")}


class AttackerSSE(BaseHTTPRequestHandler):
    """SSE 传输：endpoint 事件指向 localhost（与配置里的 127.0.0.1 不同 host）。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        port = self.server.server_address[1]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        # 关键一行：host 换成 localhost
        self.wfile.write(f"event: endpoint\ndata: http://localhost:{port}/messages\n\n".encode())
        self.wfile.flush()
        time.sleep(20)

    def do_POST(self):
        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()


class LegitMCP(BaseHTTPRequestHandler):
    """streamable-http：initialize / tools/list / tools/call 都正常。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        rid = payload.get("id")
        method = payload.get("method")
        if rid is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "serverInfo": {"name": "legit-mcp", "version": "0.1"},
                "capabilities": {"tools": {}},
            }
        elif method == "tools/list":
            result = {"tools": [{"name": "hello", "description": "say hi", "inputSchema": {"type": "object"}}]}
        elif method == "resources/list":
            result = {"resources": []}
        else:
            result = {}
        body = json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Mcp-Session-Id", "sess-legit")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(port, handler):
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    serve(8098, AttackerSSE)
    serve(8097, LegitMCP)
    time.sleep(0.5)

    status, body = call("POST", "/api/auth/register", body={"username": "ssrfprobe", "email": "ssrfprobe@example.com", "password": "ssrf-probe-pass"})
    if status in (200, 201):
        token = body["token"]
    else:
        status, body = call("POST", "/api/auth/login", body={"identifier": "ssrfprobe", "password": "ssrf-probe-pass"})
        if status not in (200, 201):
            raise SystemExit(f"login failed: {status} {body}")
        token = body["token"]

    status, body = call(
        "POST",
        "/api/mcp/servers",
        token,
        {"name": "attacker-sse", "transport": "sse", "url": "http://127.0.0.1:8098/sse", "enabled": True},
    )
    attacker_id = body.get("id")
    RESULTS.append(("create attacker-sse", status))

    status, body = call("POST", f"/api/mcp/servers/{attacker_id}/test", token, {})
    RESULTS.append(("test attacker-sse", status, body.get("error") or body.get("message")))

    status, body = call(
        "POST",
        "/api/mcp/servers",
        token,
        {"name": "legit-mcp", "transport": "streamable-http", "url": "http://127.0.0.1:8097/mcp", "enabled": True},
    )
    legit_id = body.get("id")
    RESULTS.append(("create legit-mcp", status))

    status, body = call("POST", f"/api/mcp/servers/{legit_id}/test", token, {})
    RESULTS.append(("test legit-mcp", status, json.dumps({k: body.get(k) for k in ("name", "toolCount", "error")}, ensure_ascii=False)))

    for row in RESULTS:
        print(row)


if __name__ == "__main__":
    main()
