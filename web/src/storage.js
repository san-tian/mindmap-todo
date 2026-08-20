// 数据存储层
// - api 模式：走 Flask 后端（默认，NAS 部署）
// - local 模式：浏览器 localStorage（静态部署 / GitHub Pages，无后端）
// 通过构建时环境变量 VITE_STORAGE=local 切换。

const LS_PROJECTS = 'mindmap.projects';
const LS_SETTINGS = 'mindmap.settings';

const now = () => new Date().toISOString();
const genId = () => Math.random().toString(16).slice(2, 10) || 'x'.repeat(8);

function readProjects() {
  try {
    return JSON.parse(localStorage.getItem(LS_PROJECTS)) || {};
  } catch {
    return {};
  }
}

function writeProjects(all) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(all));
}

// ---------- localStorage 实现 ----------
const localAdapter = {
  async listProjects() {
    const all = readProjects();
    const projects = Object.values(all)
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        nodeCount: (p.nodes || []).length,
      }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { success: true, projects };
  },

  async createProject(name) {
    const all = readProjects();
    const id = genId();
    const label = (name || '').trim() || '新项目';
    const p = {
      id,
      name: label,
      nodes: [{
        id: '1',
        type: 'custom',
        position: { x: 50, y: 250 },
        data: { label, status: 'pending', createdAt: now() },
      }],
      edges: [],
      createdAt: now(),
      updatedAt: now(),
    };
    all[id] = p;
    writeProjects(all);
    return { success: true, project: p };
  },

  async getProject(id) {
    const p = readProjects()[id];
    if (!p) return { success: false, error: 'project not found' };
    return { success: true, project: p };
  },

  async saveProject(id, nodes, edges) {
    const all = readProjects();
    const p = all[id];
    if (!p) return { success: false, error: 'project not found' };
    p.nodes = nodes;
    p.edges = edges;
    p.updatedAt = now();
    writeProjects(all);
    return { success: true, updatedAt: p.updatedAt };
  },

  async renameProject(id, name) {
    const all = readProjects();
    const p = all[id];
    if (!p) return { success: false, error: 'project not found' };
    p.name = (name || '').trim() || p.name;
    p.updatedAt = now();
    writeProjects(all);
    return { success: true, project: p };
  },

  async deleteProject(id) {
    const all = readProjects();
    delete all[id];
    writeProjects(all);
    return { success: true };
  },

  async getSettings() {
    let s = { bgMode: 'white' };
    try {
      s = JSON.parse(localStorage.getItem(LS_SETTINGS)) || s;
    } catch {
      /* ignore */
    }
    return { success: true, settings: s };
  },

  async saveSettings(settings) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    return { success: true, settings };
  },
};

// ---------- api 实现 ----------
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const apiAdapter = {
  listProjects: () => request('GET', '/api/projects'),
  createProject: (name) => request('POST', '/api/projects', { name }),
  getProject: (id) => request('GET', `/api/projects/${id}`),
  saveProject: (id, nodes, edges) => request('POST', `/api/projects/${id}`, { nodes, edges }),
  renameProject: (id, name) => request('PATCH', `/api/projects/${id}`, { name }),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (settings) => request('POST', '/api/settings', settings),
};

export const storage = import.meta.env.VITE_STORAGE === 'local' ? localAdapter : apiAdapter;
