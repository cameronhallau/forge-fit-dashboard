#!/usr/bin/env python3
import argparse, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CENTRAL_API = os.environ.get('FORGE_CENTRAL_API', 'https://forge-fit-dashboard.vercel.app/api').rstrip('/')

def central_request(path, method='GET', body=None):
    request = Request(
        f'{CENTRAL_API}{path}', data=body,
        headers={'Content-Type': 'application/json'} if body else {}, method=method
    )
    try:
        with urlopen(request, timeout=12) as response:
            return response.status, response.read(), response.headers.get_content_type()
    except HTTPError as error:
        return error.code, error.read(), error.headers.get_content_type()
    except (URLError, TimeoutError, OSError):
        return 502, b'{"error":"central scoreboard unavailable"}', 'application/json'

class AppHandler(SimpleHTTPRequestHandler):
    server_version = 'ForgeFit/1.0'
    def _proxy(self, path, method='GET', body=None):
        status, response, content_type = central_request(path, method, body)
        self.send_response(status); self.send_header('Content-Type', content_type); self.send_header('Content-Length', str(len(response))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(response)
    def do_GET(self):
        if self.path.split('?',1)[0]=='/api/state':
            return self._proxy('/state')
        return super().do_GET()
    def do_POST(self):
        if self.path != '/api/participant': self.send_error(404); return
        length = int(self.headers.get('Content-Length', '0'))
        return self._proxy('/participant', 'POST', self.rfile.read(length))
    def end_headers(self):
        if self.path.endswith(('.html','.js','.css','/')) or '?' in self.path: self.send_header('Cache-Control','no-cache, no-store, must-revalidate')
        super().end_headers()
    def log_message(self, fmt, *args): print(f'{self.address_string()} - {fmt%args}')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--host',default='0.0.0.0'); ap.add_argument('--port',type=int,default=8888); ap.add_argument('--data',help='deprecated; state is central'); args=ap.parse_args()
    os.chdir(Path(__file__).resolve().parent); server=ThreadingHTTPServer((args.host,args.port),AppHandler); print(f'Forge Fit serving on {args.host}:{args.port} via {CENTRAL_API}'); server.serve_forever()
if __name__=='__main__': main()
