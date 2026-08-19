#!/usr/bin/env python3
"""
思维导图 TODO - Flask 后端服务器（多项目支持）
"""
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import safe_join
import os
import json
import uuid
from datetime import datetime, timezone

app = Flask(__name__)

# ============================================
# 配置
# ============================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PROJECTS_DIR = os.path.join(DATA_DIR, 'projects')
MINDMAP_DATA_FILE = os.path.join(DATA_DIR, 'mindmap.json')  # 旧版单图数据，仅用于迁移
WEB_DIST_DIR = os.path.join(BASE_DIR, 'web', 'dist')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')


def _now():
    return datetime.now(timezone.utc).isoformat()


def _ensure_dirs():
    os.makedirs(PROJECTS_DIR, exist_ok=True)


def _project_file(pid):
    """校验并返回项目文件路径；非法 pid 返回 None"""
    if not pid or not isinstance(pid, str) or not all(c.isalnum() or c in '-_' for c in pid):
        return None
    return os.path.join(PROJECTS_DIR, f'{pid}.json')


def _atomic_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_settings():
    """加载全局设置（背景等）"""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {'bgMode': 'white'}


def save_settings(data):
    """保存全局设置（原子写入）"""
    os.makedirs(DATA_DIR, exist_ok=True)
    _atomic_write(SETTINGS_FILE, data)


def _load_project(pid):
    f = _project_file(pid)
    if not f or not os.path.exists(f):
        return None
    try:
        with open(f, encoding='utf-8') as fh:
            return json.load(fh)
    except Exception:
        return None


def _save_project(pid, nodes, edges, name=None):
    f = _project_file(pid)
    if not f:
        raise ValueError('invalid project id')
    p = _load_project(pid) or {'id': pid, 'createdAt': _now()}
    p['nodes'] = nodes
    p['edges'] = edges
    if name is not None:
        p['name'] = name
    p['updatedAt'] = _now()
    _atomic_write(f, p)
    return p


def _migrate_legacy():
    """把旧版 data/mindmap.json 迁移到多项目目录（仅当尚无项目且旧数据非空时）"""
    _ensure_dirs()
    if os.listdir(PROJECTS_DIR):
        return
    if os.path.exists(MINDMAP_DATA_FILE):
        try:
            with open(MINDMAP_DATA_FILE, encoding='utf-8') as f:
                data = json.load(f)
            nodes = data.get('nodes', [])
            edges = data.get('edges', [])
            if nodes:
                pid = uuid.uuid4().hex[:8]
                p = {
                    'id': pid,
                    'name': '我的项目',
                    'nodes': nodes,
                    'edges': edges,
                    'createdAt': _now(),
                    'updatedAt': _now(),
                }
                _atomic_write(os.path.join(PROJECTS_DIR, f'{pid}.json'), p)
        except Exception:
            pass


def list_projects():
    _migrate_legacy()
    projects = []
    for fn in sorted(os.listdir(PROJECTS_DIR)):
        if not fn.endswith('.json'):
            continue
        p = _load_project(fn[:-5])
        if p:
            projects.append({
                'id': p.get('id'),
                'name': p.get('name', '未命名项目'),
                'updatedAt': p.get('updatedAt'),
                'nodeCount': len(p.get('nodes', [])),
            })
    projects.sort(key=lambda x: x.get('updatedAt') or '', reverse=True)
    return projects


def create_project(name):
    _ensure_dirs()
    pid = uuid.uuid4().hex[:8]
    name = (name or '').strip() or '新项目'
    root = {
        'id': '1',
        'type': 'custom',
        'position': {'x': 50, 'y': 250},
        'data': {'label': name, 'status': 'pending', 'createdAt': _now()},
    }
    p = {
        'id': pid,
        'name': name,
        'nodes': [root],
        'edges': [],
        'createdAt': _now(),
        'updatedAt': _now(),
    }
    _atomic_write(os.path.join(PROJECTS_DIR, f'{pid}.json'), p)
    return p


# ============================================
# API 路由
# ============================================

@app.route('/api/projects', methods=['GET'])
def api_list_projects():
    """列出所有项目（不含 nodes/edges 明细）"""
    try:
        return jsonify({'success': True, 'projects': list_projects()})
    except Exception as e:
        print(f"Error listing projects: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects', methods=['POST'])
def api_create_project():
    """创建新项目"""
    try:
        body = request.get_json(silent=True) or {}
        p = create_project(body.get('name'))
        return jsonify({'success': True, 'project': p})
    except Exception as e:
        print(f"Error creating project: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>', methods=['GET'])
def api_get_project(pid):
    """获取单个项目完整数据"""
    p = _load_project(pid)
    if not p:
        return jsonify({'success': False, 'error': 'project not found'}), 404
    return jsonify({'success': True, 'project': p})


@app.route('/api/projects/<pid>', methods=['POST'])
def api_save_project(pid):
    """保存项目数据（nodes/edges）"""
    try:
        body = request.get_json(silent=True) or {}
        nodes = body.get('nodes', [])
        edges = body.get('edges', [])
        p = _save_project(pid, nodes, edges)
        return jsonify({'success': True, 'updatedAt': p.get('updatedAt')})
    except ValueError:
        return jsonify({'success': False, 'error': 'invalid project id'}), 400
    except Exception as e:
        print(f"Error saving project: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>', methods=['PATCH'])
def api_rename_project(pid):
    """重命名项目"""
    try:
        body = request.get_json(silent=True) or {}
        name = (body.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'name required'}), 400
        p = _load_project(pid)
        if not p:
            return jsonify({'success': False, 'error': 'project not found'}), 404
        p = _save_project(pid, p.get('nodes', []), p.get('edges', []), name=name)
        return jsonify({'success': True, 'project': p})
    except Exception as e:
        print(f"Error renaming project: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>', methods=['DELETE'])
def api_delete_project(pid):
    """删除项目"""
    try:
        f = _project_file(pid)
        if f and os.path.exists(f):
            os.remove(f)
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error deleting project: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>/nodes', methods=['POST'])
def api_add_node(pid):
    """新增节点；可指定 parentId 作为其子节点，否则作为根节点"""
    try:
        p = _load_project(pid)
        if not p:
            return jsonify({'success': False, 'error': 'project not found'}), 404

        body = request.get_json(silent=True) or {}
        label = (body.get('label') or '').strip() or '新任务'
        status = body.get('status') or 'pending'
        if status not in ('running', 'pending', 'done', 'context'):
            status = 'pending'
        quadrant = body.get('quadrant')
        if quadrant not in ('q1', 'q2', 'q3', 'q4'):
            quadrant = None
        parent_id = body.get('parentId')

        nodes = p.get('nodes', [])
        edges = p.get('edges', [])

        max_id = 0
        for n in nodes:
            try:
                max_id = max(max_id, int(n['id']))
            except (ValueError, TypeError):
                pass
        new_id = str(max_id + 1)

        data = {'label': label, 'status': status, 'createdAt': _now()}
        if quadrant:
            data['quadrant'] = quadrant

        new_node = {
            'id': new_id,
            'type': 'custom',
            'position': {'x': 50, 'y': 250},
            'data': data,
        }

        if parent_id and any(n['id'] == parent_id for n in nodes):
            parent = next(n for n in nodes if n['id'] == parent_id)
            child_count = sum(1 for e in edges if e['source'] == parent_id)
            new_node['position'] = {
                'x': parent['position']['x'] + 240,
                'y': parent['position']['y'] + child_count * 50,
            }
            edges.append({
                'id': f'e{parent_id}-{new_id}',
                'source': parent_id,
                'target': new_id,
                'type': 'default',
                'markerEnd': {'type': 'arrowclosed'},
            })

        nodes.append(new_node)
        p = _save_project(pid, nodes, edges)
        return jsonify({'success': True, 'node': new_node, 'project': p})
    except Exception as e:
        print(f"Error adding node: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>/nodes/<nid>', methods=['PATCH'])
def api_update_node(pid, nid):
    """更新节点（label / status）"""
    try:
        p = _load_project(pid)
        if not p:
            return jsonify({'success': False, 'error': 'project not found'}), 404
        body = request.get_json(silent=True) or {}
        nodes = p.get('nodes', [])
        node = next((n for n in nodes if n['id'] == nid), None)
        if not node:
            return jsonify({'success': False, 'error': 'node not found'}), 404

        if 'label' in body:
            node['data']['label'] = (body['label'] or '').strip() or node['data'].get('label', '')
        if body.get('status') in ('running', 'pending', 'done', 'context'):
            prev = node['data'].get('status')
            if body['status'] == 'done' and prev != 'done':
                node['data']['doneAt'] = _now()
            elif body['status'] != 'done' and prev == 'done':
                node['data'].pop('doneAt', None)
            node['data']['status'] = body['status']
        if 'quadrant' in body:
            q = body.get('quadrant')
            if q in ('q1', 'q2', 'q3', 'q4'):
                node['data']['quadrant'] = q
            else:
                node['data'].pop('quadrant', None)

        p = _save_project(pid, nodes, p.get('edges', []))
        return jsonify({'success': True, 'node': node, 'project': p})
    except Exception as e:
        print(f"Error updating node: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>/nodes/<nid>', methods=['DELETE'])
def api_delete_node(pid, nid):
    """删除节点及其整棵子树"""
    try:
        p = _load_project(pid)
        if not p:
            return jsonify({'success': False, 'error': 'project not found'}), 404
        nodes = p.get('nodes', [])
        edges = p.get('edges', [])
        if not any(n['id'] == nid for n in nodes):
            return jsonify({'success': False, 'error': 'node not found'}), 404

        to_delete = {nid}
        changed = True
        while changed:
            changed = False
            for e in edges:
                if e['source'] in to_delete and e['target'] not in to_delete:
                    to_delete.add(e['target'])
                    changed = True

        nodes = [n for n in nodes if n['id'] not in to_delete]
        edges = [e for e in edges if e['source'] not in to_delete and e['target'] not in to_delete]
        p = _save_project(pid, nodes, edges)
        return jsonify({'success': True, 'deleted': sorted(to_delete)})
    except Exception as e:
        print(f"Error deleting node: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/projects/<pid>/nodes/<nid>/move', methods=['POST'])
def api_move_node(pid, nid):
    """移动节点到新父节点下（parentId 为空则变成根节点）"""
    try:
        p = _load_project(pid)
        if not p:
            return jsonify({'success': False, 'error': 'project not found'}), 404
        body = request.get_json(silent=True) or {}
        parent_id = body.get('parentId')
        nodes = p.get('nodes', [])
        edges = p.get('edges', [])

        if not any(n['id'] == nid for n in nodes):
            return jsonify({'success': False, 'error': 'node not found'}), 404
        if nid == parent_id:
            return jsonify({'success': False, 'error': 'cannot move node under itself'}), 400

        # 防环：parent 不能是 nid 的后代
        descendants = {nid}
        changed = True
        while changed:
            changed = False
            for e in edges:
                if e['source'] in descendants and e['target'] not in descendants:
                    descendants.add(e['target'])
                    changed = True
        if parent_id in descendants:
            return jsonify({'success': False, 'error': 'cannot move node under its own descendant'}), 400

        edges = [e for e in edges if e['target'] != nid]
        if parent_id and any(n['id'] == parent_id for n in nodes):
            edges.append({
                'id': f'e{parent_id}-{nid}',
                'source': parent_id,
                'target': nid,
                'type': 'default',
                'markerEnd': {'type': 'arrowclosed'},
            })

        p = _save_project(pid, nodes, edges)
        return jsonify({'success': True, 'project': p})
    except Exception as e:
        print(f"Error moving node: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({'status': 'ok', 'service': 'mindmap-todo'})


@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    """获取全局设置"""
    try:
        return jsonify({'success': True, 'settings': load_settings()})
    except Exception as e:
        print(f"Error loading settings: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/settings', methods=['POST'])
def api_save_settings():
    """保存全局设置"""
    try:
        body = request.get_json(silent=True) or {}
        bg_mode = body.get('bgMode', 'white')
        if bg_mode not in ('white', 'dots', 'lines'):
            bg_mode = 'white'
        settings = {'bgMode': bg_mode}
        save_settings(settings)
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        print(f"Error saving settings: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================
# 前端静态资源（生产环境：Flask 一并托管）
# ============================================

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """托管构建后的前端；非 API 路径回退到 index.html（SPA）"""
    if path.startswith('api/'):
        return jsonify({'success': False, 'error': 'Not found'}), 404

    if not os.path.isdir(WEB_DIST_DIR):
        return '前端尚未构建。请先运行 `cd web && npm run build`，或使用 Docker 镜像部署。', 503

    candidate = safe_join(WEB_DIST_DIR, path)
    if candidate and os.path.isfile(candidate):
        resp = send_from_directory(WEB_DIST_DIR, path)
        # 带 hash 的静态资源可长期缓存
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp

    # SPA 回退：index.html 不缓存，确保拿到最新 bundle 引用
    resp = send_from_directory(WEB_DIST_DIR, 'index.html')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


# ============================================
# CORS 支持（开发环境）
# ============================================

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PATCH,DELETE')
    return response


# ============================================
# 主程序
# ============================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    print("=" * 60)
    print("思维导图 TODO - 后端服务器（多项目）")
    print("=" * 60)
    print(f"项目目录: {PROJECTS_DIR}")
    print(f"前端目录: {WEB_DIST_DIR}")
    print(f"服务地址: http://0.0.0.0:{port}")
    print("=" * 60)

    app.run(debug=debug, host='0.0.0.0', port=port)
