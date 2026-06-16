#!/usr/bin/env python3
"""
ClassNode 使用统计服务 v1.0

功能：
  - 接收客户端心跳（GET /ping）
  - 存入 SQLite 数据库（/var/lib/classnode/pings.db）
  - 网页仪表盘（GET /）— 查看统计分析
  - JSON 数据接口（GET /api/stats）

用法：
  python3 ping-server.py [端口号]
  默认端口：20601
"""
import http.server
import sqlite3
import json
import sys
import os
import time
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 20601
DB_DIR = '/var/lib/classnode'
DB_PATH = os.path.join(DB_DIR, 'pings.db')


# ======================== 数据库 ========================

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT,
            os TEXT,
            arch TEXT,
            instance_id TEXT,
            client_ip TEXT,
            classes INTEGER DEFAULT 0,
            students INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    ''')
    # 兼容旧表：新增列
    try:
        conn.execute('ALTER TABLE pings ADD COLUMN classes INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute('ALTER TABLE pings ADD COLUMN students INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
    conn.execute('CREATE INDEX IF NOT EXISTS idx_pings_instance ON pings(instance_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_pings_time ON pings(created_at)')
    conn.commit()
    conn.close()


def record_ping(version, os_name, arch, instance_id, client_ip, classes=0, students=0):
    conn = get_db()
    conn.execute(
        'INSERT INTO pings (version, os, arch, instance_id, client_ip, classes, students) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (version, os_name, arch, instance_id, client_ip, classes, students),
    )
    conn.commit()
    conn.close()


def get_daily_active(days=30):
    conn = get_db()
    rows = conn.execute('''
        SELECT date(created_at) as day, COUNT(DISTINCT instance_id) as devices
        FROM pings
        WHERE created_at >= datetime('now', ? || ' days', 'localtime')
        GROUP BY day ORDER BY day
    ''', (-days,)).fetchall()
    conn.close()
    return [{'date': r['day'], 'count': r['devices']} for r in rows]


def get_version_dist():
    conn = get_db()
    rows = conn.execute('''
        SELECT version, COUNT(DISTINCT instance_id) as count
        FROM pings GROUP BY version ORDER BY count DESC
    ''').fetchall()
    conn.close()
    return [{'name': r['version'] or 'unknown', 'count': r['count']} for r in rows]


def get_os_dist():
    conn = get_db()
    rows = conn.execute('''
        SELECT os, COUNT(DISTINCT instance_id) as count
        FROM pings GROUP BY os ORDER BY count DESC
    ''').fetchall()
    conn.close()
    return [{'name': r['os'] or 'unknown', 'count': r['count']} for r in rows]


def get_arch_dist():
    conn = get_db()
    rows = conn.execute('''
        SELECT arch, COUNT(DISTINCT instance_id) as count
        FROM pings GROUP BY arch ORDER BY count DESC
    ''').fetchall()
    conn.close()
    return [{'name': r['arch'] or 'unknown', 'count': r['count']} for r in rows]


def get_recent_pings(limit=50):
    conn = get_db()
    rows = conn.execute(
        'SELECT id, version, os, arch, instance_id, client_ip, classes, students, created_at FROM pings ORDER BY id DESC LIMIT ?',
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_overview():
    conn = get_db()
    total = conn.execute('SELECT COUNT(*) as c FROM pings').fetchone()['c']
    unique = conn.execute('SELECT COUNT(DISTINCT instance_id) as c FROM pings').fetchone()['c']
    today = conn.execute(
        "SELECT COUNT(DISTINCT instance_id) as c FROM pings WHERE date(created_at) = date('now', 'localtime')"
    ).fetchone()['c']
    this_week = conn.execute(
        "SELECT COUNT(DISTINCT instance_id) as c FROM pings WHERE created_at >= datetime('now', '-7 days', 'localtime')"
    ).fetchone()['c']
    first_ping = conn.execute(
        'SELECT MIN(created_at) as t FROM pings'
    ).fetchone()['t']
    conn.close()
    return {
        'total_pings': total,
        'unique_devices': unique,
        'active_today': today,
        'active_this_week': this_week,
        'first_ping': first_ping,
    }


# ======================== 网页仪表盘 ========================

DASHBOARD_HTML = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClassNode 统计</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f1f5f9;color:#1e293b;padding:20px}}
.header{{max-width:1200px;margin:0 auto 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}}
.header h1{{font-size:1.5rem;font-weight:700;color:#0f172a}}
.header span{{font-size:0.813rem;color:#64748b}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;max-width:1200px;margin:0 auto 24px}}
.card{{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}}
.card .label{{font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px}}
.card .value{{font-size:1.75rem;font-weight:700;margin-top:8px;color:#0f172a}}
.card .sub{{font-size:0.75rem;color:#94a3b8;margin-top:4px}}
.charts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;max-width:1200px;margin:0 auto 24px}}
.chart-card{{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}}
.chart-card h3{{font-size:0.875rem;font-weight:600;margin-bottom:16px;color:#334155}}
.chart-card canvas{{max-height:260px}}
.table-wrap{{max-width:1200px;margin:0 auto}}
.table-wrap h3{{font-size:0.875rem;font-weight:600;margin-bottom:12px;color:#334155}}
table{{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)}}
th,td{{text-align:left;padding:10px 14px;font-size:0.813rem}}
th{{background:#f8fafc;font-weight:600;color:#64748b;font-size:0.688rem;text-transform:uppercase;letter-spacing:0.5px}}
tr{{border-bottom:1px solid #f1f5f9}}
tr:last-child{{border-bottom:none}}
.code{{font-family:monospace;font-size:0.75rem;color:#6366f1;background:#eef2ff;padding:2px 6px;border-radius:4px}}
.tag{{display:inline-block;padding:1px 8px;border-radius:100px;font-size:0.688rem;font-weight:500}}
.tag-mac{{background:#fef3c7;color:#92400e}}
.tag-win{{background:#dbeafe;color:#1e40af}}
.tag-lin{{background:#dcfce7;color:#166534}}
.empty{{text-align:center;padding:60px 20px;color:#94a3b8}}
.empty h2{{font-size:1.25rem;margin-bottom:8px}}
.empty p{{font-size:0.875rem}}
</style>
</head>
<body>
<div class="header">
<div><h1>ClassNode 使用统计</h1></div>
<span id="updateTime"></span>
</div>
<div class="grid" id="overviewCards"></div>
<div class="charts">
<div class="chart-card"><h3>每日活跃设备（近30天）</h3><canvas id="dailyChart"></canvas></div>
<div class="chart-card"><h3>版本分布</h3><canvas id="versionChart"></canvas></div>
<div class="chart-card"><h3>操作系统</h3><canvas id="osChart"></canvas></div>
<div class="chart-card"><h3>架构分布</h3><canvas id="archChart"></canvas></div>
</div>
<div class="table-wrap"><h3>最近心跳</h3><table><thead><tr><th>时间</th><th>版本</th><th>系统</th><th>架构</th><th>班级/学生</th><th>实例</th><th>IP</th></tr></thead><tbody id="recentTable"></tbody></table></div>
<script>
function tag(os){{
if(os==='darwin')return'<span class="tag tag-mac">macOS</span>'
if(os==='win32')return'<span class="tag tag-win">Windows</span>'
if(os==='linux')return'<span class="tag tag-lin">Linux</span>'
return'<span class="tag">'+os+'</span>'
}}
function fmt(d){{
if(!d)return'-'
return d.replace('T',' ').slice(0,19)
}}
async function load(){{
const r=await fetch('/api/stats')
const data=await r.json()
document.getElementById('updateTime').textContent='更新于 '+new Date().toLocaleString('zh-CN')
const cards=document.getElementById('overviewCards')
cards.innerHTML=
'<div class="card"><div class="label">总心跳次数</div><div class="value">'+data.overview.total_pings+'</div></div>'+
'<div class="card"><div class="label">累计设备数</div><div class="value">'+data.overview.unique_devices+'</div><div class="sub">按实例ID去重</div></div>'+
'<div class="card"><div class="label">今日活跃</div><div class="value">'+data.overview.active_today+'</div></div>'+
'<div class="card"><div class="label">本周活跃</div><div class="value">'+data.overview.active_this_week+'</div></div>'+
'<div class="card"><div class="label">首个记录</div><div class="value" style="font-size:1rem">'+(data.overview.first_ping||'-')+'</div></div>'
new Chart(document.getElementById('dailyChart'),{{type:'bar',data:{{labels:data.daily.map(d=>d.date),datasets:[{{label:'活跃设备',data:data.daily.map(d=>d.count),backgroundColor:'rgba(99,102,241,0.6)',borderColor:'#6366f1',borderWidth:1,borderRadius:4}}]}},options:{{responsive:true,plugins:{{legend:{{display:false}}}},scales:{{y:{{beginAtZero:true,ticks:{{stepSize:1}}}}}}}}}})
new Chart(document.getElementById('versionChart'),{{type:'doughnut',data:{{labels:data.versions.map(d=>d.name||'未知'),datasets:[{{data:data.versions.map(d=>d.count),backgroundColor:['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4']}}]}},options:{{responsive:true,plugins:{{legend:{{position:'bottom'}}}}}}}})
new Chart(document.getElementById('osChart'),{{type:'doughnut',data:{{labels:data.platforms.map(d=>{{const m={{darwin:'macOS',win32:'Windows',linux:'Linux'}};return m[d.name]||d.name}}),datasets:[{{data:data.platforms.map(d=>d.count),backgroundColor:['#6366f1','#f59e0b','#10b981']}}]}},options:{{responsive:true,plugins:{{legend:{{position:'bottom'}}}}}}}})
new Chart(document.getElementById('archChart'),{{type:'doughnut',data:{{labels:data.archs.map(d=>d.name),datasets:[{{data:data.archs.map(d=>d.count),backgroundColor:['#6366f1','#f59e0b','#10b981','#ef4444']}}]}},options:{{responsive:true,plugins:{{legend:{{position:'bottom'}}}}}}}})
const tbody=document.getElementById('recentTable')
tbody.innerHTML=data.recent.map(p=>'<tr><td style="white-space:nowrap">'+fmt(p.created_at)+'</td><td><span class="code">'+p.version+'</span></td><td>'+tag(p.os)+'</td><td>'+p.arch+'</td><td style="font-size:0.75rem;color:#64748b">'+(p.classes||0)+'班 / '+(p.students||0)+'人</td><td style="font-family:monospace;font-size:0.688rem;color:#94a3b8">'+p.instance_id.slice(0,8)+'</td><td style="font-family:monospace;font-size:0.688rem;color:#94a3b8">'+p.client_ip+'</td></tr>').join('')
}}
load()
setInterval(load,10000)
</script>
</body>
</html>'''


# ======================== HTTP ========================

class PingHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/ping':
            self.handle_ping(parsed)
        elif parsed.path == '/api/stats':
            self.handle_stats()
        elif parsed.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
        else:
            self.handle_dashboard()

    def handle_ping(self, parsed):
        params = parse_qs(parsed.query)
        version = params.get('v', [''])[0]
        os_name = params.get('os', [''])[0]
        arch = params.get('arch', [''])[0]
        inst_id = params.get('id', [''])[0]
        classes = int(params.get('classes', ['0'])[0] or 0)
        students = int(params.get('students', ['0'])[0] or 0)
        client_ip = self.client_address[0]

        record_ping(version, os_name, arch, inst_id, client_ip, classes, students)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def handle_stats(self):
        data = {
            'overview': get_overview(),
            'daily': get_daily_active(),
            'versions': get_version_dist(),
            'platforms': get_os_dist(),
            'archs': get_arch_dist(),
            'recent': get_recent_pings(),
        }
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def handle_dashboard(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(DASHBOARD_HTML.encode())

    def log_message(self, fmt, *args):
        pass  # 控制台安静


if __name__ == '__main__':
    init_db()
    server = http.server.HTTPServer(('0.0.0.0', PORT), PingHandler)
    print('=' * 50)
    print('  ClassNode 统计服务 v1.0')
    print('  Dashboard : http://0.0.0.0:{}/'.format(PORT))
    print('  Ping API  : http://0.0.0.0:{}/ping'.format(PORT))
    print('  DB        : {}'.format(DB_PATH))
    print('=' * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
        server.server_close()
