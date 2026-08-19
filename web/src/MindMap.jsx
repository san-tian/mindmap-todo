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
import { Plus, Save, Check, Circle, Play, Info } from 'lucide-react';
import './MindMap.css';

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
  if (s === 'done') return <Check className="icon icon-check" />;
  if (s === 'context') return <Info className="icon icon-info" />;
  return <Circle className="icon icon-circle" />;
}

// 自定义节点
function CustomNode({ data, id }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [label, setLabel] = React.useState(data.label);
  const [showHint, setShowHint] = React.useState(false);
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
      setShowHint(true);

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
        setShowHint(false);
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
            title="点击标记完成 / 未完成（R/P/D 可设具体状态）"
          >
            {status === 'running' ? (
              <Play className="icon icon-play" />
            ) : status === 'done' ? (
              <Check className="icon icon-check" />
            ) : status === 'context' ? (
              <Info className="icon icon-info" />
            ) : (
              <Circle className="icon icon-circle" />
            )}
          </button>
          {isEditing ? (
            <div className="node-edit-container" style={{ position: 'relative' }}>
              {showHint && (
                <div className="shortcut-hint">
                  Enter: 保存 | Ctrl+Enter: 子节点 | Esc: 取消
                </div>
              )}
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
        <option value="pending">○ 待办</option>
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
  const [viewMode, setViewMode] = React.useState('status'); // status | time
  const [bgMode, setBgMode] = React.useState('white'); // white | dots | lines
  const bgModeLoadedRef = React.useRef(false);

  // 使用 ref 存储最新状态
  const nodesRef = React.useRef([]);
  const edgesRef = React.useRef([]);
  const flowRef = React.useRef(null);
  const loadedRef = React.useRef(false);
  const saveTimerRef = React.useRef(null);
  const currentProjectIdRef = React.useRef(null);

  React.useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // 加载背景设置（持久化到后端）
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then(r => r.json())
      .then(res => {
        if (cancelled) return;
        if (res.success && res.settings?.bgMode) {
          setBgMode(res.settings.bgMode);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          // 延迟标记，避免把刚加载的设置又存一遍
          setTimeout(() => { bgModeLoadedRef.current = true; }, 0);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // 背景变化时保存到后端
  React.useEffect(() => {
    if (!bgModeLoadedRef.current) return;
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bgMode }),
    }).catch(() => {});
  }, [bgMode]);

  // 自动保存到后端（防抖 1200ms）
  const doSave = React.useCallback(async () => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    setSaveStatus('saving');
    try {
      const nodesToSave = nodesRef.current.map(n => ({
        ...n,
        data: {
          label: n.data.label,
          status: n.data.status,
          createdAt: n.data.createdAt,
          doneAt: n.data.doneAt,
        },
      }));
      const response = await fetch(`/api/projects/${pid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: nodesToSave, edges: edgesRef.current }),
      });
      const result = await response.json();
      if (result.success) {
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('自动保存失败:', error);
      setSaveStatus('error');
    }
  }, []);

  React.useEffect(() => {
    if (!loadedRef.current) return;
    setSaveStatus('pending');
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

  // 初始化
  React.useEffect(() => {
    initProjects();
  }, []);

  // 自动布局函数：固定缩进的经典树形（每层对齐在同一竖线上，父节点垂直居中）
  const autoLayout = React.useCallback(() => {
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

      const START_X = 24;
      const START_Y = 28;
      const INDENT_X = 200;
      const LEAF_H = 46;
      const LEAF_W = 220;
      const GAP_Y = 8;
      const ROOT_GAP = 28;

      const layoutNode = (nodeId, x, y) => {
        const node = nodeMap.get(nodeId);
        if (!node) return { w: 0, h: 0 };

        node.position = { x, y };

        const kids = childrenMap.get(nodeId) || [];
        if (kids.length === 0) {
          return { w: LEAF_W, h: LEAF_H };
        }

        let cy = y;
        let mw = LEAF_W;
        kids.forEach(kid => {
          const r = layoutNode(kid, x + INDENT_X, cy);
          cy += r.h + GAP_Y;
          mw = Math.max(mw, INDENT_X + r.w);
        });

        const totalH = cy - y - GAP_Y;
        if (totalH > LEAF_H) {
          node.position.y = y + (totalH - LEAF_H) / 2;
        }
        return { w: mw, h: Math.max(totalH, LEAF_H) };
      };

      let cy = START_Y;
      rootNodes.forEach((root, i) => {
        const r = layoutNode(root.id, START_X, cy);
        cy += r.h + (i < rootNodes.length - 1 ? ROOT_GAP : 0);
      });

      return Array.from(nodeMap.values());
    });

    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.08, duration: 200, maxZoom: 1.2 });
    });
  }, [setNodes]);

  // 绑定到 manager
  React.useEffect(() => {
    manager.autoLayout = autoLayout;
  }, [autoLayout]);

  const onConnect = React.useCallback((params) => {
    setEdges(eds => [...eds, {
      ...params,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed },
    }]);
  }, [setEdges]);

  // 计算被拖节点当前悬停的目标节点（用于高亮提示）
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

    const dw = dragged.width || 180;
    const dh = dragged.height || 48;
    const a = { x: dragged.position.x, y: dragged.position.y, w: dw, h: dh };

    let best = null;
    let bestArea = 0;
    nodesRef.current.forEach(n => {
      if (invalid.has(n.id)) return;
      const w = n.width || 180;
      const h = n.height || 48;
      const overlapX = Math.max(0, Math.min(a.x + a.w, n.position.x + w) - Math.max(a.x, n.position.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, n.position.y + h) - Math.max(a.y, n.position.y));
      const area = overlapX * overlapY;
      if (area > 0 && area > bestArea) {
        bestArea = area;
        best = n;
      }
    });
    return best;
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

  const applyProjectData = (project) => {
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
    setNodes(nodesWithRoot);
    setEdges(edges);
    setSelectedNodeId(null);
    setDropTargetId(null);
    const maxId = nodes.reduce((m, n) => Math.max(m, parseInt(n.id) || 0), 0);
    manager.nodeIdCounter.current = maxId + 1;

    // 旧项目会保留历史坐标；加载后主动按当前更紧凑的规则重新排版一次
    setTimeout(() => {
      manager.autoLayout?.();
    }, 80);
  };

  const loadProject = async (id) => {
    if (!id) return;
    loadedRef.current = false;
    currentProjectIdRef.current = id;
    setCurrentProjectId(id);
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${id}`);
      const result = await response.json();
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
    const response = await fetch('/api/projects');
    const result = await response.json();
    let list = (result.projects || []).map(p => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt,
    }));
    if (list.length === 0) {
      // 没有任何项目时自动创建一个默认项目
      const c = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '我的项目' }),
      });
      const cr = await c.json();
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
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
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
    const response = await fetch(`/api/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (result.success) {
      setProjects(prev => prev.map(p => (p.id === pid ? { ...p, name } : p)));
      // 同步根节点标题为项目名
      setNodes(nds => nds.map(n => (n.data?.isRoot ? { ...n, data: { ...n.data, label: name } } : n)));
    }
  };

  const deleteProject = async () => {
    const pid = currentProjectIdRef.current;
    if (!pid) return;
    if (!window.confirm('确定删除当前项目？此操作不可恢复。')) return;
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' });
    const list = await fetchProjects();
    setProjects(list);
    if (list[0]) {
      await loadProject(list[0].id);
    }
  };

  const groupedTodos = React.useMemo(() => {
    const byStatus = { running: [], pending: [], done: [] };
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
          <p className="subtitle">双击编辑 | 选中后：Tab 子节点 · Enter 同级 · Del 删除 · R/P/D 状态 · 拖拽到另一节点改层级</p>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => setShowTodos(!showTodos)} className="btn btn-outline">
            {showTodos ? '隐藏' : '显示'} 任务 ({todos.length})
          </button>
          <select
            className="project-select bg-select"
            value={bgMode}
            onChange={(e) => setBgMode(e.target.value)}
            title="切换背景"
          >
            <option value="white">纯白背景</option>
            <option value="dots">点阵背景</option>
            <option value="lines">网格背景</option>
          </select>
          <button onClick={doSave} className="btn btn-primary" disabled={saveStatus === 'saving'}>
            <Save className="icon-sm" />
            {saveStatus === 'saving' ? '保存中…' : '保存'}
          </button>
          <span className={`save-status save-status-${saveStatus}`}>
            {saveStatus === 'saved' && (lastSavedAt ? `已自动保存 ${formatTime(lastSavedAt)}` : '已自动保存')}
            {saveStatus === 'pending' && '待保存…'}
            {saveStatus === 'error' && '保存失败，点击重试'}
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
              edges={edges}
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
              defaultMarkerColor="#b9c2d0"
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
                  gap={14}
                  size={1}
                  color="#e3e5e8"
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
                      { key: 'pending', title: '待办', icon: <Circle className="icon-sm todo-icon" /> },
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
            ) : (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
