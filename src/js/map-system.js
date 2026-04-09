/**
 * map-system.js — Roguelike 分支地图系统 (T13)
 *
 * 生命周期：
 *   1. boot() 末尾调用 mapSystem.generateMap() 生成一次地图
 *   2. 每关胜利 → (奖励卡选完后) → mapSystem.showMapOverlay()
 *   3. 玩家点击节点 → 回调 onNodeSelected(levelId) → main.js startNextLevel()
 *   4. HIV boss层（layer 4）只有一个节点，自动选择，不弹窗
 *
 * GameState.mapState：
 *   layers: [ [nodeObj,...], ... ]  // 5层，layer 0-4
 *   currentLayerIndex: number       // 下一个要选的层
 *   completedNodeIds: Set<string>   // 已通关节点
 *   selectedPath: string[]          // 走过的 levelId 序列
 *
 * nodeObj：{ levelId, virusId, virusName, levelName, difficulty,
 *            icon, isBoss, isCompleted, isUnlocked, layerIndex }
 *
 * Bug fix（初始版本）：generateMap() 过滤 _comment 等非关卡条目，
 * 条件：l && typeof l === 'object' && l.virus_id
 */

export class MapSystem {
  constructor(levelsData, virusesData, i18n, gameState, onNodeSelected) {
    this._levelsData     = levelsData;
    this._virusesData    = virusesData;
    this._i18n           = i18n;
    this._gameState      = gameState;
    this._onNodeSelected = onNodeSelected;
    this._overlay        = null;
  }

  generateMap() {
    const allLevels    = Object.values(this._levelsData)
      .filter(l => l && typeof l === 'object' && l.virus_id);
    const bossLevel    = allLevels.find(l => l.next_level === null);
    const normalLevels = allLevels.filter(l => l !== bossLevel);

    const layers = this._buildLayers(normalLevels, bossLevel);

    this._gameState.mapState = {
      layers,
      currentLayerIndex: 0,
      completedNodeIds:  new Set(),
      selectedPath:      [],
    };

    console.log('[MapSystem] Generated:', layers.map(l => l.map(n => n.levelId)));
  }

  _buildLayers(normalLevels, bossLevel) {
    const weighted = this._weightedShuffle(normalLevels);
    const n        = weighted.length; // 4
    const layers   = [];

    // Layer 0-3：每层2个节点，相邻层交叉，制造路线分支感
    for (let i = 0; i < 4; i++) {
      layers.push([
        this._buildNode(weighted[i % n],       i),
        this._buildNode(weighted[(i + 1) % n], i),
      ]);
    }

    // Layer 4：仅 boss
    if (bossLevel) layers.push([this._buildNode(bossLevel, 4)]);

    // 解锁第一层
    layers[0].forEach(nd => { nd.isUnlocked = true; });

    return layers;
  }

  _weightedShuffle(levels) {
    const arr = [...levels];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  _buildNode(level, layerIndex) {
    const difficultyMap = {
      influenza_h1n1: 'easy', adenovirus_5: 'medium',
      sars_cov_2: 'medium',  hsv_1: 'hard', hiv_1: 'boss',
    };
    const iconMap = {
      influenza_h1n1: '🦠', adenovirus_5: '🔷',
      sars_cov_2: '👑',     hsv_1: '⚡',  hiv_1: '💀',
    };
    return {
      levelId:     level.id,
      virusId:     level.virus_id,
      virusName:   this._i18n.get(`viruses.${level.virus_id}.short_name`) || level.virus_id,
      levelName:   this._i18n.get(level.name_key) || level.id,
      difficulty:  difficultyMap[level.virus_id] ?? 'medium',
      icon:        iconMap[level.virus_id] ?? '🦠',
      isBoss:      level.next_level === null,
      isCompleted: false,
      isUnlocked:  false,
      layerIndex,
    };
  }

  showMapOverlay() {
    const ms        = this._gameState.mapState;
    const nextLayer = ms?.layers[ms.currentLayerIndex];

    if (!nextLayer || nextLayer.length === 0) {
      console.log('[MapSystem] No more layers');
      return;
    }

    // Boss 层：自动选择，不弹窗
    if (nextLayer.length === 1 && nextLayer[0].isBoss) {
      console.log('[MapSystem] Auto-select boss:', nextLayer[0].levelId);
      this._selectNode(nextLayer[0]);
      return;
    }

    this._renderOverlay(nextLayer, ms);
  }

  _renderOverlay(currentLayerNodes, ms) {
    this._overlay = document.getElementById('map-overlay');
    const mapGrid = document.getElementById('map-grid');
    if (!this._overlay || !mapGrid) return;

    mapGrid.innerHTML = '';

    const layerNames = [
      this._i18n.get('map.layer_1') || '第一关',
      this._i18n.get('map.layer_2') || '第二关',
      this._i18n.get('map.layer_3') || '第三关',
      this._i18n.get('map.layer_4') || '第四关',
      this._i18n.get('map.layer_5') || '最终关',
    ];

    // 从上到下：第5层→第1层（倒序显示）
    for (let li = ms.layers.length - 1; li >= 0; li--) {
      const layer   = ms.layers[li];
      const layerEl = document.createElement('div');
      layerEl.className = 'map-layer';

      const labelEl = document.createElement('div');
      labelEl.className   = 'map-layer-label';
      labelEl.textContent = layerNames[li] ?? `第${li+1}关`;
      layerEl.appendChild(labelEl);

      const nodesEl = document.createElement('div');
      nodesEl.className = 'map-nodes';

      const isCurrentLayer = li === ms.currentLayerIndex;
      const isPastLayer    = li < ms.currentLayerIndex;

      for (const node of layer) {
        const nodeEl = document.createElement('div');
        let stateClass = isCurrentLayer ? 'map-node-selectable'
                       : isPastLayer    ? 'map-node-skipped'
                       :                  'map-node-locked';
        if (node.isCompleted) stateClass = 'map-node-completed';

        nodeEl.className = `map-node map-node-${node.difficulty} ${stateClass}`;
        if (ms.selectedPath.includes(node.levelId)) nodeEl.classList.add('map-node-on-path');

        nodeEl.innerHTML = `
          <div class="map-node-icon">${node.icon}</div>
          <div class="map-node-name">${node.virusName}</div>
          <div class="map-node-diff map-diff-${node.difficulty}">${this._diffLabel(node.difficulty)}</div>`;

        if (isCurrentLayer) nodeEl.addEventListener('click', () => this._selectNode(node));
        nodesEl.appendChild(nodeEl);
      }

      layerEl.appendChild(nodesEl);
      mapGrid.appendChild(layerEl);
    }

    this._overlay.style.display = 'flex';
  }

  _selectNode(node) {
    const ms = this._gameState.mapState;
    node.isCompleted = true;
    ms.completedNodeIds.add(node.levelId);
    ms.selectedPath.push(node.levelId);
    ms.currentLayerIndex++;

    const nextLayer = ms.layers[ms.currentLayerIndex];
    if (nextLayer) nextLayer.forEach(nd => { nd.isUnlocked = true; });

    if (this._overlay) this._overlay.style.display = 'none';
    console.log(`[MapSystem] Selected: ${node.levelId}, nextLayer: ${ms.currentLayerIndex}`);
    this._onNodeSelected(node.levelId);
  }

  _diffLabel(diff) {
    return { easy: '★ 入门', medium: '★★ 中等', hard: '★★★ 困难', boss: '☠ Boss' }[diff] ?? diff;
  }
}
