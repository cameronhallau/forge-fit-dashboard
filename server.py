#!/usr/bin/env python3
import argparse, json, os, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

PARTICIPANTS = {'ca':'Ca','cl':'Cl','p':'P','g':'G'}
CHALLENGE_START = '2026-08-17'

def empty_state():
    return {'version': 7, 'participants': {pid: {'name': name, 'startDate': CHALLENGE_START} for pid, name in PARTICIPANTS.items()}}

def hydrate_state(state):
    state = state if isinstance(state, dict) else empty_state()
    state['version'] = 7
    people = state.setdefault('participants', {})
    for pid, name in PARTICIPANTS.items():
        participant = people.setdefault(pid, {'name': name})
        participant['name'] = name
        participant['startDate'] = CHALLENGE_START
    return state

class AppHandler(SimpleHTTPRequestHandler):
    server_version = 'ForgeFit/1.0'
    def _json(self, status, payload):
        body=json.dumps(payload,separators=(',',':')).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path.split('?',1)[0]=='/api/state':
            with self.server.data_lock: self._json(200,self.server.read_state())
            return
        return super().do_GET()
    def do_POST(self):
        if self.path!='/api/participant': self._json(404,{'error':'not found'}); return
        try:
            length=int(self.headers.get('Content-Length','0')); data=json.loads(self.rfile.read(length)); pid=data['id']; participant=data['participant']
            if pid not in PARTICIPANTS or not isinstance(participant,dict): raise ValueError()
            participant['name'] = PARTICIPANTS[pid]; participant['startDate'] = CHALLENGE_START
            with self.server.data_lock:
                state=self.server.read_state(); state['participants'][pid]=participant; self.server.write_state(state)
            self._json(200,{'ok':True})
        except Exception: self._json(400,{'error':'invalid request'})
    def end_headers(self):
        if self.path.endswith(('.html','.js','.css','/')) or '?' in self.path: self.send_header('Cache-Control','no-cache, no-store, must-revalidate')
        super().end_headers()
    def log_message(self, fmt, *args): print(f'{self.address_string()} - {fmt%args}')

class ForgeServer(ThreadingHTTPServer):
    def __init__(self,address,handler,data_path):
        self.data_path=Path(data_path); self.data_lock=threading.Lock(); super().__init__(address,handler)
        self.write_state(self.read_state())
    def read_state(self):
        try: return hydrate_state(json.loads(self.data_path.read_text()))
        except Exception: return empty_state()
    def write_state(self,state):
        self.data_path.parent.mkdir(parents=True,exist_ok=True); tmp=self.data_path.with_suffix('.tmp'); tmp.write_text(json.dumps(hydrate_state(state),indent=2)); os.replace(tmp,self.data_path)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--host',default='0.0.0.0'); ap.add_argument('--port',type=int,default=8888); ap.add_argument('--data',default='./data/state.json'); args=ap.parse_args()
    os.chdir(Path(__file__).resolve().parent); server=ForgeServer((args.host,args.port),AppHandler,args.data); print(f'Forge Fit serving on {args.host}:{args.port}'); server.serve_forever()
if __name__=='__main__': main()
