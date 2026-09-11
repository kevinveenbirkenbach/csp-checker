import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BODY = b"<!doctype html><html><head><title>web-slow</title></head><body><p>slow</p></body></html>"


class SlowHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        delay = float(parse_qs(urlparse(self.path).query).get("delay", ["0"])[0])
        time.sleep(delay)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(BODY)))
            self.end_headers()
            self.wfile.write(BODY)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        pass


ThreadingHTTPServer(("", 80), SlowHandler).serve_forever()
