import React from 'react';
import { flushSync } from 'react-dom';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  MarkerType,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Save, Check, Circle, Play, Info, Clock, Pause } from 'lucide-react';
import './MindMap.css';
import { storage } from './storage';

const formatTime = (d) => {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const formatDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const localDateKey = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const timeOfDay = (iso) => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 四象限（艾森豪威尔矩阵）——低饱和配色，与蓝白主题一致
const QUADRANTS = {
  q1: { label: '重要紧急', color: '#e11d48' },
  q2: { label: '重要不紧急', color: '#2563eb' },
  q3: { label: '不重要紧急', color: '#ea580c' },
  q4: { label: '不重要不紧急', color: '#94a3b8' },
};
const QUADRANT_ORDER = [
  { key: 'q1', label: QUADRANTS.q1.label, color: QUADRANTS.q1.color },
  { key: 'q2', label: QUADRANTS.q2.label, color: QUADRANTS.q2.color },
  { key: 'q3', label: QUADRANTS.q3.label, color: QUADRANTS.q3.color },
  { key: 'q4', label: QUADRANTS.q4.label, color: QUADRANTS.q4.color },
  { key: 'none', label: '未分类', color: '#cbd5e1' },
];

// —— 多端同步：数据规整与三方合并 ——
// 节点净形（发送/基线比对用的最小字段；position 只影响布局且会被自动重排接管，不参与冲突判定）
const sanitizeNode = (n) => ({
  id: n.id,
  type: 'custom',
  position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
  data: {
    label: n.data?.label ?? '',
    status: n.data?.status ?? 'pending',
    createdAt: n.data?.createdAt ?? null,
    doneAt: n.data?.doneAt ?? null,
    quadrant: n.data?.quadrant ?? null,
    key: n.data?.key ?? null,
  },
});
const nodeContentSig = (n) => JSON.stringify([
  n.data?.label ?? '', n.data?.status ?? 'pending',
  n.data?.createdAt ?? null, n.data?.doneAt ?? null, n.data?.quadrant ?? null,
  n.data?.key ?? null,
]);
const edgeKey = (e) => `${e.source}->${e.target}`;
// —— 导出：文字版 Markdown 与 JSON 留档 ——
const STATUS_MARKS = { running: '▶', waiting: '⏳', pending: '○', idel: '⏸', done: '✓', context: 'ℹ' };

const buildMarkdown = (nodes, edges, name) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const children = new Map();
  edges.forEach(e => { if (!children.has(e.source)) children.set(e.source, []); children.get(e.source).push(e.target); });
  const sortKey = (id) => byId.get(id)?.position?.y ?? 0;
  children.forEach(list => list.sort((a, b) => sortKey(a) - sortKey(b)));
  const rootIds = nodes.filter(n => !edges.some(e => e.target === n.id)).map(n => n.id).sort((a, b) => sortKey(a) - sortKey(b));

  const lines = ['# ' + (name || '未命名项目')];
  const walk = (id, depth) => {
    const n = byId.get(id);
    if (!n) return;
    const mark = STATUS_MARKS[n.data?.status || 'pending'] || '○';
    lines.push('  '.repeat(depth) + '- ' + mark + ' ' + (n.data?.label || ''));
    (children.get(id) || []).forEach(c => walk(c, depth + 1));
  };
  // 单根且根本身 label == 项目名：跳过根，从一级分支开始（避免标题重复）
  if (rootIds.length === 1 && byId.get(rootIds[0])?.data?.label === name) {
    (children.get(rootIds[0]) || []).forEach(c => walk(c, 0));
  } else {
    rootIds.forEach(r => walk(r, 0));
  }
  return lines.join('\n') + '\n';
};

const copyTextToClipboard = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 回退到 execCommand */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

// 三方合并：本地改动优先，未改字段采纳服务端，双方新增都保留（删除同理）
const mergeProjectData = (baseNodes, baseEdges, localNodes, localEdges, serverNodes, serverEdges) => {
  const baseById = new Map(baseNodes.map(n => [n.id, n]));
  const serverById = new Map(serverNodes.map(n => [n.id, n]));
  const localById = new Map(localNodes.map(n => [n.id, n]));
  const mergedNodes = [];
  new Set([...serverById.keys(), ...localById.keys()]).forEach(id => {
    const b = baseById.get(id), l = localById.get(id), s = serverById.get(id);
    if (l && !b) { mergedNodes.push(l); return; }                     // 本地新增
    if (!l && b) return;                                               // 本地删除
    if (l && b && nodeContentSig(l) !== nodeContentSig(b)) { mergedNodes.push(l); return; } // 本地修改
    if (s) mergedNodes.push(s);                                        // 未改（或服务端新增）
  });
  const baseEdgeMap = new Map(baseEdges.map(e => [edgeKey(e), e]));
  const serverEdgeMap = new Map(serverEdges.map(e => [edgeKey(e), e]));
  const localEdgeMap = new Map(localEdges.map(e => [edgeKey(e), e]));
  const mergedEdges = [];
  new Set([...serverEdgeMap.keys(), ...localEdgeMap.keys()]).forEach(key => {
    const b = baseEdgeMap.get(key), l = localEdgeMap.get(key), s = serverEdgeMap.get(key);
    if (l && !b) { mergedEdges.push(l); return; }                      // 本地新增连线
    if (!l && b) return;                                               // 本地删除连线
    if (s) mergedEdges.push(s);                                        // 未改 / 服务端新增
  });
  const nodeIdSet = new Set(mergedNodes.map(n => n.id));
  return {
    nodes: mergedNodes,
    edges: mergedEdges.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)),
  };
};

// 全局状态管理器
class MindMapManager {
  constructor() {
    this.setNodes = null;
    this.setEdges = null;
    this.getNodes = () => [];
    this.getEdges = () => [];
    this.nodeIdCounter = { current: 1 };
  }

  onLabelChange(nodeId, newLabel) {
    if (!this.setNodes) return;
    this.setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, label: newLabel } } : n
    ));
    // 文字变化会改变节点高度，等重新测量后再重排（不 fitView，避免视野跳动）
    setTimeout(() => this.autoLayout?.(false), 300);
  }

  onStatusChange(nodeId, status) {
    if (!this.setNodes) return;
    const now = new Date().toISOString();
    this.setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      const prev = n.data.status;
      const data = { ...n.data, status };
      if (status === 'done' && prev !== 'done') {
        data.doneAt = now; // 记录完成时间
      } else if (status !== 'done' && prev === 'done') {
        delete data.doneAt; // 取消完成时清除完成时间
      }
      return { ...n, data };
    }));
  }

  onStatusToggle(nodeId) {
    const node = this.getNodes().find(n => n.id === nodeId);
    const current = node?.data?.status || 'pending';
    // 按钮二态切换：done / context → pending；running / pending → done
    this.onStatusChange(nodeId, (current === 'done' || current === 'context') ? 'pending' : 'done');
  }

  onQuadrantChange(nodeId, quadrant) {
    if (!this.setNodes) return;
    this.setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      const data = { ...n.data };
      if (quadrant && QUADRANTS[quadrant]) {
        data.quadrant = quadrant;
      } else {
        delete data.quadrant;
      }
      return { ...n, data };
    }));
  }

  onAddChild(parentId) {
    if (!this.setNodes || !this.setEdges) return;

    const nodes = this.getNodes();
    const edges = this.getEdges();
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    const newId = String(this.nodeIdCounter.current++);
    const childCount = edges.filter(e => e.source === parentId).length;

    const newNode = {
      id: newId,
      type: 'custom',
      position: { x: parentNode.position.x + 210, y: parentNode.position.y + childCount * 56 },
      data: { label: '新任务', status: 'pending', createdAt: new Date().toISOString() },
    };

    const newEdge = {
      id: `e${parentId}-${newId}`,
      source: parentId,
      target: newId,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed },
    };

    flushSync(() => {
      this.setNodes(nds => [...nds, newNode]);
    });

    this.setEdges(eds => [...eds, newEdge]);

    // 触发自动布局
    setTimeout(() => {
      this.autoLayout?.();
    }, 50);
  }

  onAddSibling(nodeId) {
    if (!this.setNodes) return;

    const edges = this.getEdges();
    const parentEdge = edges.find(e => e.target === nodeId);

    // 根节点没有父节点，不允许创建同级节点
    if (!parentEdge) return;

    // 同级节点 = 父节点的另一个子节点
    this.onAddChild(parentEdge.source);
  }

  onReparent(nodeId, newParentId) {
    if (!this.setEdges) return;
    if (!nodeId || !newParentId || nodeId === newParentId) return;

    const edges = this.getEdges();

    // 防止环：新父节点不能是被拖节点的后代
    const descendants = new Set();
    const collect = (id) => {
      edges.forEach(e => {
        if (e.source === id && !descendants.has(e.target)) {
          descendants.add(e.target);
          collect(e.target);
        }
      });
    };
    collect(nodeId);
    if (descendants.has(newParentId)) return;

    // 已经是该父节点的子节点，无需处理
    const existing = edges.find(e => e.target === nodeId);
    if (existing && existing.source === newParentId) return;

    const newEdges = edges.filter(e => e.target !== nodeId);
    newEdges.push({
      id: `e${newParentId}-${nodeId}`,
      source: newParentId,
      target: nodeId,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed },
    });

    this.setEdges(newEdges);

    setTimeout(() => {
      this.autoLayout?.();
    }, 50);
  }

  onDelete(nodeId) {
    if (!this.setNodes || !this.setEdges) return;

    const edges = this.getEdges();
    const nodesToDelete = new Set([nodeId]);

    const findChildren = (id) => {
      edges.forEach(e => {
        if (e.source === id && !nodesToDelete.has(e.target)) {
          nodesToDelete.add(e.target);
          findChildren(e.target);
        }
      });
    };
    findChildren(nodeId);

    this.setNodes(nds => nds.filter(n => !nodesToDelete.has(n.id)));
    this.setEdges(eds => eds.filter(e => !nodesToDelete.has(e.source) && !nodesToDelete.has(e.target)));
  }
}

const manager = new MindMapManager();

// 状态图标组件
function StatusIcon({ status }) {
  const s = status || 'pending';
  if (s === 'running') return <Play className="icon icon-play" />;
  if (s === 'waiting') return <Clock className="icon icon-clock" />;
  if (s === 'idel') return <Pause className="icon icon-pause" />;
  if (s === 'done') return <Check className="icon icon-check" />;
  if (s === 'context') return <Info className="icon icon-info" />;
  return <Circle className="icon icon-circle" />;
}

// 自定义节点
function CustomNode({ data, id }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [label, setLabel] = React.useState(data.label);
  const inputRef = React.useRef(null);

  // 判断是否是根节点
  const isRoot = data.isRoot || false;

  React.useEffect(() => {
    setLabel(data.label);
  }, [data.label]);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      input.focus();
      input.select();

      const handleKeyDown = (e) => {
        // Ctrl/Cmd + Enter：创建子节点
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          const newLabel = input.value.trim() || data.label;
          if (newLabel !== data.label) {
            manager.onLabelChange(id, newLabel);
          }
          setIsEditing(false);
          requestAnimationFrame(() => {
            manager.onAddChild(id);
          });
          return;
        }

        // Enter 键：保存并退出编辑
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          const newLabel = input.value.trim() || data.label;
          if (newLabel !== data.label) {
            manager.onLabelChange(id, newLabel);
          }
          setLabel(newLabel);
          setIsEditing(false);
          return;
        }

        // Escape：取消编辑
        if (e.key === 'Escape') {
          e.preventDefault();
          setLabel(data.label);
          setIsEditing(false);
          return;
        }
      };

      input.addEventListener('keydown', handleKeyDown);

      return () => {
        input.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isEditing, id, data.label]);

  const status = data.status || 'pending';
  const isLevel1 = data.level === 1;

  return (
    <>
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div
        className={`node node-status-${status} ${isRoot ? 'node-root' : ''} ${isLevel1 ? 'node-level-1' : ''} ${data.dropTarget ? 'node-drop-target' : ''} ${data.highlight ? 'node-highlight' : ''}`}
        onDoubleClick={() => {
          if (!isRoot) setIsEditing(true);
        }}
      >
        <div className="node-header">
          <button
            onClick={(e) => {
              e.stopPropagation();
              manager.onStatusToggle(id);
            }}
            className="status-btn nodrag"
            title="点击标记完成 / 未完成（R/P/D/C/W/I 可设具体状态）"
          >
            <StatusIcon status={status} />
          </button>
          {isEditing ? (
            <div className="node-edit-container">
              <input
                ref={inputRef}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={(e) => {
                  setTimeout(() => {
                    const newLabel = label.trim() || data.label;
                    setLabel(newLabel);
                    setIsEditing(false);
                    if (newLabel !== data.label) {
                      manager.onLabelChange(id, newLabel);
                    }
                  }, 200);
                }}
                className="node-input nodrag"
                autoFocus
              />
            </div>
          ) : (
            <div
              className={`node-label node-label-${status}`}
              onDoubleClick={() => { if (!isRoot) setIsEditing(true); }}
            >
              {label}
            </div>
          )}
          {data.quadrant && QUADRANTS[data.quadrant] && (
            <span
              className="quadrant-dot"
              style={{ backgroundColor: QUADRANTS[data.quadrant].color }}
              title={`四象限：${QUADRANTS[data.quadrant].label}`}
            />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </>
  );
}

function TodoItem({ todo, statusKey, onSelect, onStatusChange, onLabelChange, onDragEnd }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(todo.data?.label || '');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    setVal(todo.data?.label || '');
  }, [todo.data?.label]);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const label = val.trim() || todo.data?.label || '未命名任务';
    setVal(label);
    setEditing(false);
    if (label !== todo.data?.label) {
      onLabelChange(todo.id, label);
    }
  };

  const status = todo.data?.status || 'pending';
  const timeLabel = status === 'done'
    ? (todo.data?.doneAt ? `完成 ${formatDateTime(todo.data.doneAt)}` : '')
    : (todo.data?.createdAt ? `创建 ${formatDateTime(todo.data.createdAt)}` : '');

  return (
    <div
      className={`todo-item todo-item-${statusKey}`}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', todo.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => { if (!editing) onSelect(todo.id); }}
    >
      <select
        className="todo-status-select"
        draggable={false}
        value={todo.data?.status || 'pending'}
        title="修改状态"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onStatusChange(todo.id, e.target.value)}
      >
        <option value="running">▶ 运行中</option>
        <option value="waiting">⏳ 等待中</option>
        <option value="pending">○ 待办</option>
        <option value="idel">⏸ 暂缓</option>
        <option value="done">✓ 已完成</option>
        <option value="context">ℹ 上下文</option>
      </select>
      <div className="todo-item-body">
        {editing ? (
          <input
            ref={inputRef}
            className="todo-edit-input"
            draggable={false}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setVal(todo.data?.label || ''); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="todo-text"
            title="双击编辑内容"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {todo.data?.label || '未命名任务'}
          </span>
        )}
        {timeLabel && <span className="todo-time">{timeLabel}</span>}
      </div>
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

export default function MindMap() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [todos, setTodos] = React.useState([]);
  const [showTodos, setShowTodos] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState('saved'); // 'saved' | 'pending' | 'saving' | 'error'
  const [lastSavedAt, setLastSavedAt] = React.useState(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState(null);
  const [dropTargetId, setDropTargetId] = React.useState(null);
  const [projects, setProjects] = React.useState([]);
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [dragOverGroup, setDragOverGroup] = React.useState(null);
  const [dragOverQuadrant, setDragOverQuadrant] = React.useState(null);
  const [viewMode, setViewMode] = React.useState('status'); // status | time | quadrant
  const [bgMode, setBgMode] = React.useState('dots'); // dots | lines | white（点阵为默认，白板感）
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  // 用户在设置返回前手动改过下拉框时置 true：服务端保存值不再覆盖用户选择
  const userTouchedSettingsRef = React.useRef(false);
  // 布局模式：standard = 矩形堆叠（默认，即分列铺宽版）；compact = 轮廓打包（子树咬合利用空隙，可选）
  const [layoutMode, setLayoutMode] = React.useState('standard');
  const layoutModeRef = React.useRef('standard');

  React.useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  // 使用 ref 存储最新状态
  const nodesRef = React.useRef([]);
  const edgesRef = React.useRef([]);
  const flowRef = React.useRef(null);
  const loadedRef = React.useRef(false);
  const saveTimerRef = React.useRef(null);
  const currentProjectIdRef = React.useRef(null);
  // 首次布局用了估算尺寸时置 true；等 React Flow 实测完全部节点后重排一次
  const estimatePendingRef = React.useRef(false);
  // 多端同步：上次成功同步到服务端的快照（乐观锁基线）与脏标记
  const syncBaseRef = React.useRef({ updatedAt: null, nodes: [], edges: [] });
  const dirtyRef = React.useRef(false);
  // 程序化写入（加载/轮询热更新/自动重排）置 true，抑制自动保存，避免“轮询→写回→版本+1→再轮询”的永动机式刷版本
  const suppressSaveRef = React.useRef(false);
  // 保存失败指数退避重试计数
  const saveRetryRef = React.useRef(0);
  const projectsRef = React.useRef([]);
  // applyProjectData 的 ref 间接引用（避免 useCallback 依赖数组里的 TDZ 问题）
  const applyProjectDataRef = React.useRef(null);

  React.useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  React.useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // 加载背景/布局设置（持久化到后端）
  React.useEffect(() => {
    let cancelled = false;
    storage.getSettings()
      .then(res => {
        if (cancelled) return;
        // 用户已手动改过下拉框：不覆盖用户选择（修复加载早期切换被服务端值回弹的竞态）
        if (userTouchedSettingsRef.current) return;
        if (res.success && res.settings) {
          if (res.settings.bgMode) {
            // 旧配置里保存的 'white' 迁移为 'dots'：新版默认白板点阵背景
            setBgMode(res.settings.bgMode === 'white' ? 'dots' : res.settings.bgMode);
          }
          if (res.settings.layoutMode) {
            setLayoutMode(res.settings.layoutMode === 'compact' ? 'compact' : 'standard');
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // 设置变化时保存到后端（settingsLoaded 进入依赖：加载完成后补存用户在加载期间的手动修改）
  React.useEffect(() => {
    if (!settingsLoaded) return;
    storage.saveSettings({ bgMode, layoutMode }).catch(() => {});
  }, [bgMode, layoutMode, settingsLoaded]);

  // 手动切换布局模式时重新排版；首次挂载跳过（初始布局由项目加载流程负责）。
  // 注意：不能用“设置是否已加载”做门控——否则加载早期切换会被静默吞掉，
  // 出现“下拉框已变但布局仍是旧模式”的残留（用户看到假的标准模式）
  const layoutModeFirstRunRef = React.useRef(true);
  React.useEffect(() => {
    if (layoutModeFirstRunRef.current) {
      layoutModeFirstRunRef.current = false;
      return;
    }
    manager.autoLayout?.();
  }, [layoutMode]);

  // 应用合并结果（多端冲突解决后）：进画布、更新基线，并触发防抖重试保存
  const applyMergedData = React.useCallback((merged, updatedAt) => {
    const projName = projectsRef.current.find(p => p.id === currentProjectIdRef.current)?.name;
    const rootNodeIds = new Set(merged.nodes.filter(n => !merged.edges.some(e => e.target === n.id)).map(n => n.id));
    setNodes(merged.nodes.map(n => ({
      ...n,
      data: { ...n.data, isRoot: rootNodeIds.has(n.id), ...(rootNodeIds.has(n.id) ? { label: projName || n.data.label } : {}) },
    })));
    setEdges(merged.edges);
    syncBaseRef.current = { updatedAt: updatedAt ?? null, nodes: merged.nodes, edges: merged.edges };
    dirtyRef.current = true; // setNodes 触发防抖保存，把合并结果写回服务端
    const maxId = merged.nodes.reduce((m, n) => Math.max(m, parseInt(n.id) || 0), 0);
    manager.nodeIdCounter.current = maxId + 1;
    setTimeout(() => { manager.autoLayout?.(false); }, 50);
  }, [setNodes, setEdges]);

  // 导出（复制到剪贴板）：文字版 Markdown 或 JSON，用于留档
  const [copyMsg, setCopyMsg] = React.useState('');
  const copyMsgTimerRef = React.useRef(null);
  const handleExport = React.useCallback(async (fmt) => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    const name = projectsRef.current.find(p => p.id === pid)?.name || '';
    let text;
    if (fmt === 'markdown') {
      text = buildMarkdown(nodesRef.current, edgesRef.current, name);
    } else {
      text = JSON.stringify({
        name,
        updatedAt: syncBaseRef.current.updatedAt,
        nodes: nodesRef.current.map(sanitizeNode),
        edges: edgesRef.current.map(e => ({ id: e.id, source: e.source, target: e.target })),
      }, null, 2);
    }
    const ok = await copyTextToClipboard(text);
    setCopyMsg(ok ? (fmt === 'markdown' ? '已复制 Markdown' : '已复制 JSON') : '复制失败');
    clearTimeout(copyMsgTimerRef.current);
    copyMsgTimerRef.current = setTimeout(() => setCopyMsg(''), 2000);
  }, []);

  // 自动保存到后端（防抖 1200ms）；带乐观锁 baseUpdatedAt，
  // 冲突时三方合并后由防抖通道自动重试，避免多端互覆盖
  const savingRef = React.useRef(false); // in-flight 锁：同一时刻只允许一个保存请求，避免并发用旧 base 造成假冲突
  const doSave = React.useCallback(async () => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    if (savingRef.current) {
      // 已有保存在进行：稍后再试（重新调度，不丢失改动）
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { doSave(); }, 1200);
      return;
    }
    savingRef.current = true;
    setSaveStatus('saving');
    try {
      const nodesToSave = nodesRef.current.map(sanitizeNode);
      const edgesToSave = edgesRef.current.map(e => ({ id: e.id, source: e.source, target: e.target }));
      const result = await storage.saveProject(pid, nodesToSave, edgesToSave, syncBaseRef.current.updatedAt);
      savingRef.current = false;
      if (result.success) {
        syncBaseRef.current = { updatedAt: result.updatedAt, nodes: nodesToSave, edges: edgesToSave };
        dirtyRef.current = false;
        saveRetryRef.current = 0;
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } else if (result.conflict) {
        // 别的端先存了：三方合并（本地改动优先，未改的采纳服务端），再走防抖通道重试
        try {
          const merged = mergeProjectData(
            syncBaseRef.current.nodes, syncBaseRef.current.edges,
            nodesToSave, edgesToSave,
            result.project?.nodes || [], result.project?.edges || [],
          );
          applyMergedData(merged, result.updatedAt);
          setSaveStatus('pending');
        } catch (mergeErr) {
          // 合并异常时回退为「以服务端为准」整表替换，绝不卡死
          console.error('冲突合并失败，回退为以服务端为准:', mergeErr);
          if (result.project) applyProjectDataRef.current?.(result.project);
          setSaveStatus('saved');
        }
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (error) {
      savingRef.current = false;
      console.error('自动保存失败:', error);
      setSaveStatus('error');
      // 指数退避自动重试（最多 6 次），网络抖动后自动恢复；仍失败则保持 error 等用户点重试
      const attempt = saveRetryRef.current;
      if (attempt < 6) {
        saveRetryRef.current = attempt + 1;
        const delay = Math.min(30000, 2000 * (2 ** attempt));
        setTimeout(() => { if (dirtyRef.current) doSave(); }, delay);
      }
    }
  }, [applyMergedData]);

  React.useEffect(() => {
    // 程序化写入（加载/轮询热更新/自动重排）本身不产生新改动：
    // 先消费标志；但若已有未保存改动（如冲突合并后），仍需重新调度保存，
    // 因为上一轮 effect 的 cleanup 会把 saveTimerRef 清掉。
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false;
      if (!loadedRef.current || !dirtyRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { doSave(); }, 1200);
      return;
    }
    if (!loadedRef.current) return;
    setSaveStatus('pending');
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      doSave();
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, doSave]);

  // 全局快捷键监听
  React.useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // 如果正在编辑，不处理全局快捷键
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (!selectedNodeId) return;

      // 检查是否是根节点
      const selectedNode = nodesRef.current.find(n => n.id === selectedNodeId);
      const isRootNode = selectedNode?.data?.isRoot || false;

      // Enter：创建同级节点（根节点不允许）
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isRootNode) return;
        manager.onAddSibling(selectedNodeId);
        return;
      }

      // Tab：创建子节点
      if (e.key === 'Tab') {
        e.preventDefault();
        manager.onAddChild(selectedNodeId);
        return;
      }

      // r / p / d：一键设置状态
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'running');
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'pending');
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'done');
        return;
      }
      // c：上下文（项目描述，不计入 TODO）
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'context');
        return;
      }
      // w：等待中（等别人）；i：暂缓（暂时不用做）
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'waiting');
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        manager.onStatusChange(selectedNodeId, 'idel');
        return;
      }

      // 1/2/3/4：设置四象限；0 清除
      if (e.key === '1') {
        e.preventDefault();
        manager.onQuadrantChange(selectedNodeId, 'q1');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        manager.onQuadrantChange(selectedNodeId, 'q2');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        manager.onQuadrantChange(selectedNodeId, 'q3');
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        manager.onQuadrantChange(selectedNodeId, 'q4');
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        manager.onQuadrantChange(selectedNodeId, null);
        return;
      }

      // Delete/Backspace：删除节点（根节点不允许删除）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (isRootNode) return;
        manager.onDelete(selectedNodeId);
        setSelectedNodeId(null);
        return;
      }

      // F2 或双击：进入编辑模式
      if (e.key === 'F2') {
        e.preventDefault();
        // 触发节点的编辑模式
        const nodeElement = document.querySelector(`[data-id="${selectedNodeId}"]`);
        if (nodeElement) {
          const labelElement = nodeElement.querySelector('.node-label');
          if (labelElement) {
            labelElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [selectedNodeId]);

  // 绑定 manager
  React.useEffect(() => {
    manager.setNodes = setNodes;
    manager.setEdges = setEdges;
    manager.getNodes = () => nodesRef.current;
    manager.getEdges = () => edgesRef.current;
  }, [setNodes, setEdges]);

  // 计算 TODO
  React.useEffect(() => {
    const parentIds = new Set(edges.map(e => e.source));
    const leafNodes = nodes.filter(n => !parentIds.has(n.id) && !n.data?.isRoot && n.data?.status !== 'context');
    setTodos(leafNodes);
  }, [nodes, edges]);

  // 侧栏展开/收起后，画布尺寸变化，重新 fitView 保持节点居中
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (nodesRef.current.length > 0) {
        flowRef.current?.fitView({ padding: 0.08, duration: 200, maxZoom: 1.3 });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [showTodos]);

  // 初始化
  React.useEffect(() => {
    initProjects();
  }, []);

  // 自动布局函数：标准=单列全右侧（矩形堆叠）；紧凑=分列铺宽+轮廓咬合（可选）
  const autoLayout = React.useCallback((fitViewAfter = true) => {
    suppressSaveRef.current = true; // 自动重排是程序化写入，不触发保存
    setNodes(nds => {
      const nodeMap = new Map(nds.map(n => [n.id, { ...n }]));
      const edgeList = edgesRef.current;
      const childrenMap = new Map();

      edgeList.forEach(e => {
        const list = childrenMap.get(e.source) || [];
        list.push(e.target);
        childrenMap.set(e.source, list);
      });

      // 按现有 y 顺序保留阅读顺序，避免兄弟顺序乱跳
      childrenMap.forEach((ids, sid) => {
        ids.sort((a, b) => (nodeMap.get(a)?.position?.y || 0) - (nodeMap.get(b)?.position?.y || 0));
      });

      const rootNodes = nds
        .filter(n => !edgeList.some(e => e.target === n.id))
        .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));

      const compact = layoutModeRef.current === 'compact';

      const H_GAP = 36;   // 父节点右边缘到子节点左边缘的水平间距
      // 动态垂直间距（标准模式）：小树更透气、大树保持紧凑；紧凑模式恒定追求密度
      // 22-0.3×节点数，限在 [5, 15]：≤20 节点 15px，50 节点 7px，57+ 节点 5px（与旧版一致）
      const V_GAP = compact ? 5 : Math.max(5, Math.min(15, 22 - nds.length * 0.3));
      const ROOT_GAP = 20;
      const START_X = 24;
      const START_Y = 28;

      // 节点尺寸：优先用已测量的实际尺寸；未测量时按字宽估算（单行 ≈29px，而非固定 40px）
      // 避免「加载后首次布局赶在测量前执行 → 整棵树按 40px 块高排布 → 竖直方向虚胖」
      let usedEstimate = false;
      const estSize = (n) => {
        const label = n.data?.label || '';
        let units = 0;
        for (const ch of label) {
          units += ch.charCodeAt(0) > 0x2E7F ? 13 : 7.5; // 全角 13px，半角 7.5px
        }
        const w = Math.max(60, Math.min(220, units + 20));
        const lines = Math.max(1, Math.ceil(units / 200)); // 220px 上限 - 20px 内边距 ≈ 每行容纳宽度
        const lineH = n.data?.isRoot ? 18 : 17;            // 13px 字号 × 1.3 行高
        return { w, h: 10 + lines * lineH + 2 };
      };
      const nodeW = (n) => {
        if (n.width > 0) return n.width;
        usedEstimate = true;
        return estSize(n).w;
      };
      const nodeH = (n) => {
        if (n.height > 0) return n.height;
        usedEstimate = true;
        return estSize(n).h;
      };

      // 统一右侧展开：父节点垂直居中于子树，子节点紧贴父右侧
      const layoutNode = (nodeId, x, y) => {
        const node = nodeMap.get(nodeId);
        if (!node) return 0;
        const w = nodeW(node);
        const h = nodeH(node);
        node.position = { x, y };

        const kids = childrenMap.get(nodeId) || [];
        if (kids.length === 0) return h;

        const childX = x + w + H_GAP;
        let cy = y;
        let totalH = 0;
        kids.forEach(kid => {
          const kh = layoutNode(kid, childX, cy);
          cy += kh + V_GAP;
          totalH += kh + V_GAP;
        });
        totalH -= V_GAP;
        if (totalH > h) node.position.y = y + (totalH - h) / 2;
        return Math.max(totalH, h);
      };

      // —— 紧凑模式：子树轮廓打包（内容绝不重叠，但利用相邻子树的阶梯空隙）——
      const subtreeRectsAbs = (id) => {
        const out = [];
        const walk = (nid) => {
          const n = nodeMap.get(nid);
          if (!n) return;
          out.push({ x: n.position.x, y: n.position.y, w: nodeW(n), h: nodeH(n) });
          (childrenMap.get(nid) || []).forEach(walk);
        };
        walk(id);
        return out;
      };
      const shiftSubtreeY = (id, dy) => {
        const n = nodeMap.get(id);
        if (!n) return;
        n.position.y += dy;
        (childrenMap.get(id) || []).forEach(k => shiftSubtreeY(k, dy));
      };
      // 把 rects 整体下移的最小量：对所有 x 方向有交叠的矩形对，保证 a 底 + sep <= b 顶
      const minShiftY = (placed, rects, sep) => {
        let dy = 0;
        for (const a of placed) {
          for (const b of rects) {
            if (a.x < b.x + b.w && b.x < a.x + a.w) {
              dy = Math.max(dy, a.y + a.h + sep - b.y);
            }
          }
        }
        return dy;
      };
      // 紧凑版递归布局：子节点从基准线开始逐个“落最低点”打包，父节点居中于子内容
      const layoutPacked = (nodeId, x, baseY) => {
        const node = nodeMap.get(nodeId);
        if (!node) return { top: baseY, bottom: baseY };
        const w = nodeW(node);
        const h = nodeH(node);
        node.position = { x, y: baseY };
        const kids = childrenMap.get(nodeId) || [];
        if (kids.length === 0) return { top: baseY, bottom: baseY + h };

        const childX = x + w + H_GAP;
        const placed = [];
        let top = Infinity, bottom = -Infinity;
        kids.forEach(kid => {
          const r = layoutPacked(kid, childX, baseY);
          const rects = subtreeRectsAbs(kid);
          const dy = minShiftY(placed, rects, V_GAP);
          if (dy > 0) {
            shiftSubtreeY(kid, dy);
            r.top += dy; r.bottom += dy;
          }
          placed.push(...subtreeRectsAbs(kid));
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
        });
        // 父节点垂直居中于子内容包围盒
        node.position.y = (top + bottom) / 2 - h / 2;
        return { top: Math.min(top, node.position.y), bottom: Math.max(bottom, node.position.y + h) };
      };

      // 布局一个根：标准 = 单列全右侧矩形堆叠；紧凑 = 分列铺宽 + 轮廓打包
      // 分列：一级分支纵向堆叠整体过高时，按 DP 平衡切分折到右侧新列，
      // 选宽高比最贴近屏幕的列数（列内子树轮廓互相咬合利用空隙）
      const COL_GAP = 72; // 列间距（明显大于层间距，视觉上区分列）
      const TARGET_RATIO = (typeof window !== 'undefined')
        ? Math.max(1.1, Math.min(2.4, (window.innerWidth - 320) / (window.innerHeight - 120)))
        : 1.6;

      // 子树高度/宽度（memo 化，仅紧凑分列路径使用）
      const sizeMemo = new Map();
      const subtreeH = (id) => {
        if (sizeMemo.has(id)) return sizeMemo.get(id).h;
        const node = nodeMap.get(id);
        const kids = childrenMap.get(id) || [];
        let total = 0;
        kids.forEach(kid => { total += subtreeH(kid) + V_GAP; });
        if (kids.length > 0) total -= V_GAP;
        const h = Math.max(total, nodeH(node));
        sizeMemo.set(id, { h });
        return h;
      };
      const subtreeW = (id) => {
        if (sizeMemo.has(id) && sizeMemo.get(id).w !== undefined) return sizeMemo.get(id).w;
        const node = nodeMap.get(id);
        const kids = childrenMap.get(id) || [];
        let w = nodeW(node);
        if (kids.length > 0) w += H_GAP + Math.max(...kids.map(subtreeW));
        const m = sizeMemo.get(id) || { h: subtreeH(id) };
        m.w = w;
        sizeMemo.set(id, m);
        return w;
      };

      const layoutRootBlock = (root, startY) => {
        // 标准：单列全右侧（每个子树占自己的完整横向空间，与 6ee4995 一致）
        if (!compact) {
          return layoutNode(root.id, START_X, startY);
        }

        const rootW = nodeW(root);
        const rootH = nodeH(root);
        const kids = childrenMap.get(root.id) || [];

        if (kids.length <= 1) {
          const r = layoutPacked(root.id, START_X, startY);
          return r.bottom - startY;
        }

        const k = kids.length;
        const hs = kids.map(subtreeH);
        const prefix = [0];
        hs.forEach((h, i) => prefix.push(prefix[i] + h));
        const rangeH = (i, j) => prefix[j] - prefix[i] + V_GAP * (j - i - 1); // [i,j) 列高

        // DP：把前 i 个分支切成 j 列的最小最大列高（经典线性分区，保持阅读顺序）
        const INF = Infinity;
        const best = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(INF));
        const cut = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
        best[0][0] = 0;
        for (let i = 1; i <= k; i++) {
          for (let j = 1; j <= i; j++) {
            for (let m = j - 1; m < i; m++) {
              if (best[m][j - 1] === INF) continue;
              const v = Math.max(best[m][j - 1], rangeH(m, i));
              if (v < best[i][j]) { best[i][j] = v; cut[i][j] = m; }
            }
          }
        }

        // 按切分点取回每列分支下标，并算该列数下的总宽
        const splitCols = (n) => {
          const bounds = [];
          let i2 = k;
          for (let j = n; j >= 1; j--) { bounds.unshift(cut[i2][j]); i2 = cut[i2][j]; }
          const cols = [];
          let width = rootW + H_GAP;
          for (let j = 0; j < n; j++) {
            const colKids = kids.slice(bounds[j], bounds[j + 1] ?? k);
            cols.push(colKids);
            width += Math.max(...colKids.map(subtreeW)) + (j < n - 1 ? COL_GAP : 0);
          }
          return { cols, width, maxH: best[k][n] };
        };

        // 逐列数评估宽高比，选最贴近屏幕的（同分取更少列数）
        let chosen = null;
        let chosenN = 1;
        let bestScore = Infinity;
        for (let n = 1; n <= k; n++) {
          if (best[k][n] === INF) continue;
          const { width, maxH } = splitCols(n);
          const ratio = width / Math.max(maxH, rootH, 1);
          const score = Math.abs(ratio - TARGET_RATIO) + n * 0.001;
          if (score < bestScore) { bestScore = score; chosenN = n; }
        }
        chosen = splitCols(chosenN);

        if (chosenN <= 1) {
          const r = layoutPacked(root.id, START_X, startY);
          return r.bottom - startY;
        }

        // 各列 x：从根右侧依次排开，列宽 = 列内最大子树宽
        const colX = [];
        let x = START_X + rootW + H_GAP;
        chosen.cols.forEach((col) => {
          const w = Math.max(...col.map(subtreeW));
          colX.push(x);
          x += w + COL_GAP;
        });

        // 布局各列：列内自上而下，相邻分支轮廓咬合（主分支间距 = V_GAP）
        let blockTop = Infinity, blockBottom = -Infinity;
        chosen.cols.forEach((col, ci) => {
          const placed = [];
          col.forEach(kid => {
            const r = layoutPacked(kid, colX[ci], startY);
            const rects = subtreeRectsAbs(kid);
            const dy = minShiftY(placed, rects, V_GAP);
            if (dy > 0) {
              shiftSubtreeY(kid, dy);
              r.top += dy; r.bottom += dy;
            }
            placed.push(...subtreeRectsAbs(kid));
            blockTop = Math.min(blockTop, r.top);
            blockBottom = Math.max(blockBottom, r.bottom);
          });
        });

        // 根节点垂直居中于整体
        root.position = { x: START_X, y: (blockTop + blockBottom) / 2 - rootH / 2 };
        return blockBottom - startY;
      };

      let cy = START_Y;
      rootNodes.forEach((root, i) => {
        const rh = layoutRootBlock(root, cy);
        cy += rh + (i < rootNodes.length - 1 ? ROOT_GAP : 0);
      });

      // 本次布局用了估算尺寸：等 React Flow 实测完后再重排一次（见下方 effect）
      if (usedEstimate) estimatePendingRef.current = true;

      return Array.from(nodeMap.values());
    });

    if (fitViewAfter) {
      requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding: 0.08, duration: 200, maxZoom: 1.3 });
      });
    }
  }, [setNodes]);

  // 绑定到 manager
  React.useEffect(() => {
    manager.autoLayout = autoLayout;
  }, [autoLayout]);

  // autoLayout 用了估算尺寸 → 等 React Flow 把所有节点实测完（width/height 就位）后，
  // 按真实尺寸紧凑重排一次（只补一次，不会循环）
  React.useEffect(() => {
    if (!estimatePendingRef.current || nodes.length === 0) return;
    if (nodes.every(n => n.width > 0 && n.height > 0)) {
      estimatePendingRef.current = false;
      autoLayout(false);
    }
  }, [nodes, autoLayout]);

  const onConnect = React.useCallback((params) => {
    setEdges(eds => [...eds, {
      ...params,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed },
    }]);
  }, [setEdges]);

  // 计算被拖节点当前悬停的目标节点（仅当节点中心落在目标内部时，视为“重挂载”意图）
  const findDropTarget = React.useCallback((dragged) => {
    const edges = edgesRef.current;

    // 排除自身、后代以及当前父节点，避免拖成环或无意义操作
    const invalid = new Set([dragged.id]);
    const collect = (id) => {
      edges.forEach(e => {
        if (e.source === id && !invalid.has(e.target)) {
          invalid.add(e.target);
          collect(e.target);
        }
      });
    };
    collect(dragged.id);
    const parentEdge = edges.find(e => e.target === dragged.id);
    if (parentEdge) invalid.add(parentEdge.source);

    const cx = dragged.position.x + (dragged.width || 180) / 2;
    const cy = dragged.position.y + (dragged.height || 48) / 2;

    for (const n of nodesRef.current) {
      if (invalid.has(n.id)) continue;
      const w = n.width || 180;
      const h = n.height || 48;
      if (cx >= n.position.x && cx <= n.position.x + w &&
          cy >= n.position.y && cy <= n.position.y + h) {
        return n;
      }
    }
    return null;
  }, []);

  const handleNodeDrag = React.useCallback((event, node) => {
    if (node.data?.isRoot) return;
    const target = findDropTarget(node);
    const nextId = target ? target.id : null;
    setDropTargetId(prev => (prev === nextId ? prev : nextId));
  }, [findDropTarget]);

  const handleNodeDragStop = React.useCallback((event, node) => {
    setDropTargetId(null);
    if (node.data?.isRoot) return;
    const target = findDropTarget(node);
    if (target) {
      manager.onReparent(node.id, target.id);
    } else {
      // 没有重挂载目标：按新位置在同级内重排（不重新 fitView，保持视野）
      manager.autoLayout?.(false);
    }
  }, [findDropTarget]);

  // 从任务列表选中节点：高亮并居中到该节点
  const selectNode = React.useCallback((id) => {
    setSelectedNodeId(id);
    const node = nodesRef.current.find(n => n.id === id);
    if (node && flowRef.current) {
      flowRef.current.setCenter(
        node.position.x + (node.width || 180) / 2,
        node.position.y + (node.height || 48) / 2,
        { zoom: flowRef.current.getZoom(), duration: 300 }
      );
    }
  }, []);

  const applyProjectData = React.useCallback((project) => {
    const edges = project.edges || [];
    const nodes = project.nodes || [];
    const rootNodeIds = new Set(
      nodes.filter(n => !edges.some(e => e.target === n.id)).map(n => n.id)
    );
    const nodesWithRoot = nodes.map(n => {
      const isRoot = rootNodeIds.has(n.id);
      return {
        ...n,
        data: { ...n.data, isRoot, ...(isRoot ? { label: project.name } : {}) },
      };
    });
    suppressSaveRef.current = true; // 加载/热更新是程序化写入，不触发保存
    setNodes(nodesWithRoot);
    setEdges(edges);
    setSelectedNodeId(null);
    setDropTargetId(null);
    // 多端同步：记录服务端当前版本为乐观锁基线
    syncBaseRef.current = {
      updatedAt: project.updatedAt ?? null,
      nodes: (project.nodes || []).map(sanitizeNode),
      edges: (project.edges || []).map(e => ({ id: e.id, source: e.source, target: e.target })),
    };
    dirtyRef.current = false;
    const maxId = nodes.reduce((m, n) => Math.max(m, parseInt(n.id) || 0), 0);
    manager.nodeIdCounter.current = maxId + 1;

    // 旧项目会保留历史坐标；加载后主动按当前更紧凑的规则重新排版一次
    setTimeout(() => {
      manager.autoLayout?.();
    }, 80);
  }, [setNodes, setEdges, setSelectedNodeId, setDropTargetId]);

  // 每次渲染后更新 applyProjectData 的 ref（供 doSave 冲突回退等异步路径调用）
  React.useEffect(() => {
    applyProjectDataRef.current = applyProjectData;
  });

  // 空闲同步：本地无未保存改动时每 15s 拉一次，服务端有更新就热加载（多端保持最新）
  React.useEffect(() => {
    const timer = setInterval(async () => {
      const pid = currentProjectIdRef.current;
      if (!pid || !loadedRef.current) return;
      if (dirtyRef.current) return; // 有未保存改动：交给冲突合并路径处理
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 正在编辑，别打断
      try {
        const result = await storage.getProject(pid);
        if (result.success && result.project && result.project.updatedAt &&
            result.project.updatedAt !== syncBaseRef.current.updatedAt) {
          applyProjectData(result.project);
        }
      } catch { /* 网络抖动忽略 */ }
    }, 15000);
    return () => clearInterval(timer);
  }, []); // applyProjectData 仅依赖稳定的 setter/manager，首渲染闭包即可

  const loadProject = async (id) => {
    if (!id) return;
    loadedRef.current = false;
    currentProjectIdRef.current = id;
    setCurrentProjectId(id);
    setLoading(true);
    try {
      const result = await storage.getProject(id);
      if (result.success && result.project) {
        applyProjectData(result.project);
      }
    } catch (error) {
      console.error('加载项目失败:', error);
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
      // 加载完成后才开启自动保存（避免把刚加载的数据再保存一遍）
      setTimeout(() => { loadedRef.current = true; }, 0);
    }
  };

  const fetchProjects = async () => {
    const result = await storage.listProjects();
    let list = (result.projects || []).map(p => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt,
    }));
    if (list.length === 0) {
      // 没有任何项目时自动创建一个默认项目
      const cr = await storage.createProject('我的项目');
      if (cr.success) {
        const p = cr.project;
        list = [{ id: p.id, name: p.name, updatedAt: p.updatedAt }];
      }
    }
    return list;
  };

  const initProjects = async () => {
    try {
      const list = await fetchProjects();
      setProjects(list);
      if (list[0]) {
        await loadProject(list[0].id);
      }
    } catch (error) {
      console.error('初始化失败:', error);
      setLoading(false);
      loadedRef.current = true;
    }
  };

  const switchProject = async (id) => {
    if (!id || id === currentProjectIdRef.current) return;
    await doSave(); // 切换前先保存当前项目
    await loadProject(id);
  };

  const createProject = async () => {
    const input = window.prompt('新项目名称：', '新项目');
    if (input === null) return;
    const name = input.trim() || '新项目';
    await doSave();
    const result = await storage.createProject(name);
    if (result.success) {
      const np = { id: result.project.id, name: result.project.name, updatedAt: result.project.updatedAt };
      setProjects(prev => [...prev, np]);
      await loadProject(np.id);
    }
  };

  const renameProject = async () => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    const cur = projects.find(p => p.id === pid);
    const input = window.prompt('项目名称：', cur?.name || '');
    if (input === null) return;
    const name = input.trim();
    if (!name) return;
    const result = await storage.renameProject(pid, name);
    if (result.success) {
      // 重命名会推动 updatedAt：同步基线，避免下次保存被误判冲突
      if (result.project?.updatedAt) syncBaseRef.current.updatedAt = result.project.updatedAt;
      setProjects(prev => prev.map(p => (p.id === pid ? { ...p, name } : p)));
      // 同步根节点标题为项目名
      setNodes(nds => nds.map(n => (n.data?.isRoot ? { ...n, data: { ...n.data, label: name } } : n)));
    }
  };

  const deleteProject = async () => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    if (!window.confirm('确定删除当前项目？此操作不可恢复。')) return;
    await storage.deleteProject(pid);
    const list = await fetchProjects();
    setProjects(list);
    if (list[0]) {
      await loadProject(list[0].id);
    }
  };

  const groupedTodos = React.useMemo(() => {
    const byStatus = { running: [], waiting: [], pending: [], idel: [], done: [] };
    todos.forEach(t => {
      const s = t.data?.status;
      (byStatus[s] || byStatus.pending).push(t);
    });
    return byStatus;
  }, [todos]);

  // 今日新建 / 完成统计（基于叶子节点）
  const todayStats = React.useMemo(() => {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let created = 0;
    let done = 0;
    todos.forEach(t => {
      if (localDateKey(t.data?.createdAt) === todayKey) created++;
      if (localDateKey(t.data?.doneAt) === todayKey) done++;
    });
    return { created, done };
  }, [todos]);

  // 时间视图：按“完成/创建”日期分组，倒序（今天→昨天→更早）
  const timeGroups = React.useMemo(() => {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

    const map = new Map();
    todos.forEach(t => {
      const status = t.data?.status || 'pending';
      const iso = status === 'done' ? t.data?.doneAt : t.data?.createdAt;
      const key = localDateKey(iso);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    });
    const keys = Array.from(map.keys()).sort().reverse();
    return keys.map(key => ({
      key,
      label: key === today ? '今天' : key === yesterday ? '昨天' : key.slice(5).replace('-', '/'),
      items: map.get(key),
    }));
  }, [todos]);

  // 四象限分组（基于叶子任务）
  const quadrantGroups = React.useMemo(() => {
    const groups = { q1: [], q2: [], q3: [], q4: [], none: [] };
    todos.forEach(t => {
      const q = t.data?.quadrant;
      if (q && QUADRANTS[q]) groups[q].push(t);
      else groups.none.push(t);
    });
    return groups;
  }, [todos]);

  const nodesForRender = React.useMemo(() => {
    // 计算每个节点的层级（根=0，其直接子级=1，以此类推）
    const parentOf = new Map();
    edges.forEach(e => parentOf.set(e.target, e.source));
    const levelMap = new Map();
    const getLevel = (id) => {
      if (levelMap.has(id)) return levelMap.get(id);
      const parent = parentOf.get(id);
      const level = parent ? getLevel(parent) + 1 : 0;
      levelMap.set(id, level);
      return level;
    };
    nodes.forEach(n => getLevel(n.id));

    return nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        dropTarget: n.id === dropTargetId,
        highlight: n.id === selectedNodeId,
        level: levelMap.get(n.id) || 0,
      },
    }));
  }, [nodes, edges, dropTargetId, selectedNodeId]);

  // 边跟随源节点状态着色：running 绿色流动、done 淡化、其余冷灰蓝
  const edgesForRender = React.useMemo(() => {
    const statusById = new Map(nodes.map(n => [n.id, n.data?.status || 'pending']));
    return edges.map(e => {
      const s = statusById.get(e.source) || 'pending';
      const color = s === 'running' ? '#10b981' : s === 'done' ? '#d9dfeb' : '#c3cddd';
      return { ...e, className: `edge-status-${s}`, markerEnd: { ...e.markerEnd, color } };
    });
  }, [nodes, edges]);

  return (
    <div className="app">
      <div className="toolbar">
        <div>
          <div className="project-bar">
            <select
              className="project-select"
              value={currentProjectId || ''}
              onChange={(e) => switchProject(e.target.value)}
              disabled={projects.length === 0}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button onClick={createProject} className="btn btn-outline btn-sm" title="新建项目">
              <Plus className="icon-sm" />新建
            </button>
            <button onClick={renameProject} className="btn btn-outline btn-sm" title="重命名当前项目">
              重命名
            </button>
            <button onClick={deleteProject} className="btn btn-outline btn-sm btn-danger" title="删除当前项目">
              删除
            </button>
          </div>
          <p className="subtitle">双击编辑 | 选中后：Tab 子节点 · Enter 同级 · Del 删除 · R/P/D/C 状态 · 1-4 四象限 · 拖拽改层级</p>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => setShowTodos(!showTodos)} className="btn btn-outline">
            {showTodos ? '隐藏' : '显示'} 任务 ({todos.length})
          </button>
          <select
            className="project-select bg-select"
            value={bgMode}
            onChange={(e) => { userTouchedSettingsRef.current = true; setBgMode(e.target.value); }}
            title="切换背景"
          >
            <option value="white">纯白背景</option>
            <option value="dots">点阵背景</option>
            <option value="lines">网格背景</option>
          </select>
          <select
            className="project-select bg-select"
            value={layoutMode}
            onChange={(e) => { userTouchedSettingsRef.current = true; setLayoutMode(e.target.value); }}
            title="布局模式：标准=单列全右侧堆叠；紧凑=分列铺宽+相邻子树轮廓咬合利用空隙"
          >
            <option value="compact">紧凑布局</option>
            <option value="standard">标准布局</option>
          </select>
          <button onClick={doSave} className="btn btn-primary" disabled={saveStatus === 'saving'}>
            <Save className="icon-sm" />
            {saveStatus === 'saving' ? '保存中…' : '保存'}
          </button>
          <button onClick={() => handleExport('markdown')} className="btn btn-outline btn-sm" title="复制文字版 Markdown 到剪贴板（留档）">
            复制 MD
          </button>
          <button onClick={() => handleExport('json')} className="btn btn-outline btn-sm" title="复制项目 JSON 到剪贴板（留档）">
            复制 JSON
          </button>
          <span
            className={`save-status ${copyMsg ? 'save-status-saving' : `save-status-${saveStatus}`}`}
            onClick={saveStatus === 'error' ? doSave : undefined}
            style={saveStatus === 'error' ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
            title={saveStatus === 'error' ? '点击立即重试保存' : undefined}
          >
            {copyMsg || (
              <>
                {saveStatus === 'saved' && (lastSavedAt ? `已自动保存 ${formatTime(lastSavedAt)}` : '已自动保存')}
                {saveStatus === 'pending' && '待保存…'}
                {saveStatus === 'error' && '保存失败，点击重试'}
              </>
            )}
          </span>
        </div>
      </div>

      <div className="main-content">
        <div className="mindmap-container">
          {loading ? (
            <div className="empty-state">
              <div className="empty-content">
                <h2>加载中…</h2>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-content">
                <h2>没有节点</h2>
                <p>点击下方按钮创建第一个节点</p>
                <button
                  onClick={() => {
                    const newId = String(manager.nodeIdCounter.current++);
                    setNodes([{
                      id: newId,
                      type: 'custom',
                      position: { x: 50, y: 250 },
                      data: { label: '新任务', status: 'pending', isRoot: true, createdAt: new Date().toISOString() },
                    }]);
                  }}
                  className="btn btn-primary btn-lg"
                >
                  <Plus className="icon-sm" />
                  添加根节点
                </button>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodesForRender}
              edges={edgesForRender}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              onSelectionChange={(params) => {
                if (params.nodes && params.nodes.length > 0) {
                  setSelectedNodeId(params.nodes[0].id);
                } else {
                  setSelectedNodeId(null);
                }
              }}
              onInit={(instance) => { flowRef.current = instance; }}
              nodeTypes={nodeTypes}
              nodesDraggable={true}
              nodesConnectable={false}
              defaultMarkerColor="#c3cddd"
              elementsSelectable={true}
              deleteKeyCode={null}
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={2}
            >
              <Controls />
              <MiniMap />
              {bgMode !== 'white' && (
                <Background
                  variant={bgMode === 'lines' ? 'lines' : 'dots'}
                  gap={18}
                  size={1.3}
                  color="#dfe4ee"
                />
              )}
            </ReactFlow>
          )}
        </div>

        {showTodos && (
          <div className="todo-sidebar">
            <div className="todo-header">
              <h2 className="todo-title">任务列表</h2>
              <div className="todo-view-switch">
                <button className={viewMode === 'status' ? 'active' : ''} onClick={() => setViewMode('status')}>状态</button>
                <button className={viewMode === 'time' ? 'active' : ''} onClick={() => setViewMode('time')}>时间</button>
                <button className={viewMode === 'quadrant' ? 'active' : ''} onClick={() => setViewMode('quadrant')}>四象限</button>
              </div>
            </div>

            {viewMode === 'status' ? (
              <>
                <p className="todo-today">今日新建 {todayStats.created} · 完成 {todayStats.done}</p>
                {todos.length === 0 ? (
                  <p className="todo-empty">暂无任务</p>
                ) : (
                  <div className="todo-groups">
                    {[
                      { key: 'running', title: '运行中', icon: <Play className="icon-sm todo-icon" /> },
                      { key: 'waiting', title: '等待中', icon: <Clock className="icon-sm todo-icon" /> },
                      { key: 'pending', title: '待办', icon: <Circle className="icon-sm todo-icon" /> },
                      { key: 'idel', title: '暂缓', icon: <Pause className="icon-sm todo-icon" /> },
                      { key: 'done', title: '已完成', icon: <Check className="icon-sm todo-icon" /> },
                    ].map(group => (
                      <div
                        key={group.key}
                        className={`todo-group todo-group-${group.key} ${dragOverGroup === group.key ? 'todo-group-dragover' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDragEnter={(e) => { e.preventDefault(); setDragOverGroup(group.key); }}
                        onDragLeave={(e) => { if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; setDragOverGroup(null); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData('text/plain');
                          if (id) manager.onStatusChange(id, group.key);
                          setDragOverGroup(null);
                        }}
                      >
                        <h3 className="todo-group-title">
                          {group.icon}
                          {group.title}
                          <span className="todo-group-count">{groupedTodos[group.key].length}</span>
                        </h3>
                        {groupedTodos[group.key].length === 0 ? (
                          <p className="todo-group-empty">暂无（拖入任务到此分组）</p>
                        ) : (
                          <div className="todo-list">
                            {groupedTodos[group.key].map(todo => (
                              <TodoItem
                                key={todo.id}
                                todo={todo}
                                statusKey={group.key}
                                onSelect={selectNode}
                                onStatusChange={(id, status) => manager.onStatusChange(id, status)}
                                onLabelChange={(id, label) => manager.onLabelChange(id, label)}
                                onDragEnd={() => setDragOverGroup(null)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : viewMode === 'time' ? (
              <div className="time-groups">
                {timeGroups.length === 0 ? (
                  <p className="todo-empty">暂无时间记录</p>
                ) : (
                  timeGroups.map(g => (
                    <div key={g.key} className="time-group">
                      <h3 className="time-group-title">{g.label}</h3>
                      {g.items.map(t => (
                        <div key={t.id} className="time-item" onClick={() => selectNode(t.id)}>
                          <span className="time-item-time">
                            {timeOfDay(t.data?.status === 'done' ? t.data?.doneAt : t.data?.createdAt)}
                          </span>
                          <StatusIcon status={t.data?.status} />
                          <span className={`time-item-text ${t.data?.status === 'done' ? 'done-text' : ''}`}>
                            {t.data?.label || '未命名任务'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="quadrant-groups">
                {QUADRANT_ORDER.map(q => (
                  <div
                    key={q.key}
                    className={`quadrant-group ${dragOverQuadrant === q.key ? 'todo-group-dragover' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDragEnter={(e) => { e.preventDefault(); setDragOverQuadrant(q.key); }}
                    onDragLeave={(e) => { if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; setDragOverQuadrant(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain');
                      if (id) manager.onQuadrantChange(id, q.key === 'none' ? null : q.key);
                      setDragOverQuadrant(null);
                    }}
                  >
                    <h3 className="quadrant-group-title">
                      <span className="quadrant-dot" style={{ backgroundColor: q.color }} />
                      {q.label}
                      <span className="todo-group-count">{quadrantGroups[q.key].length}</span>
                    </h3>
                    {quadrantGroups[q.key].length === 0 ? (
                      <p className="todo-group-empty">暂无（拖入任务到此象限）</p>
                    ) : (
                      <div className="todo-list">
                        {quadrantGroups[q.key].map(t => (
                          <div
                            key={t.id}
                            className={`todo-item todo-item-${t.data?.status || 'pending'}`}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => setDragOverQuadrant(null)}
                            onClick={() => selectNode(t.id)}
                          >
                            <StatusIcon status={t.data?.status} />
                            <span className="todo-text">{t.data?.label || '未命名任务'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
