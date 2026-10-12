import './style.css'

// ============================================================
//  视频抠图工具 - 主程序
// ============================================================

// ---- 全局状态 ----
const state = {
  video: null,
  canvas: null,       // 显示用画布（带透明度）
  offscreen: null,    // 离屏画布（用于读取像素）
  ctx: null,
  offCtx: null,
  bgColor: null,      // {r, g, b} 背景颜色（平均値，用于显示）
  bgColors: [],       // 多点采样背景颜色数组
  lumaKeyMode: null,  // null | 'white' | 'black' 亮度键控模式
  tolerance: 40,      // 颜色容差 (0-200)
  feather: 15,        // 边缘羽化范围 (0-80)
  spillSuppress: true,// 溢出抑制
  spillStrength: 60,  // 溢出抑制强度
  colorSpace: 'auto', // 颜色空间: auto/ycbcr/hsv/rgb
  bgVariance: 0,      // 背景颜色方差（用于自适应容差）
  // 抠图模式: 'chroma' | 'ai' | 'diff'
  mode: 'chroma',
  // AI模式状态
  aiModel: null,       // body-segmentation segmenter 实例
  aiLoaded: false,     // 模型是否已加载
  aiLoading: false,    // 正在加载中
  aiThreshold: 0.5,    // 分割灵敏度
  aiSmooth: 3,         // 边缘平滑度
  aiMaskCanvas: null,  // AI掩码画布
  aiMaskCtx: null,
  // 背景差分模式状态
  bgFrameData: null,   // 背景参考帧 ImageData
  diffThreshold: 25,   // 差异阈值
  diffFeather: 10,     // 差分羽化
  // Alpha后处理
  alphaBlur: 2,        // Alpha通道模糊半径 (0-5)
  alphaContrast: 0.3,  // Alpha通道对比度增强 (0-1)
  isPlaying: false,
  isProcessing: false,
  videoWidth: 0,
  videoHeight: 0,
  duration: 0,
  isExporting: false,
  tempCanvas: null,  // 复用的临时画布
  tempCtx: null,
  // 画面裁剪
  cropEnabled: false,  // 是否启用裁剪
  cropRect: null,      // {x, y, width, height} 视频像素坐标
  cropAspectRatio: 0,  // 0=自由比例, 否则按指定宽高比约束
}

// ---- 渲染 HTML 模板 ----
const app = document.getElementById('app')
app.innerHTML = `
  <header class="app-header">
    <div class="app-title">
      <span class="icon">🎬</span>
      视频抠图工具
      <span class="app-subtitle">Video Matting Tool · 本地运行 · 无需上传</span>
    </div>
    <button class="btn btn-secondary" id="btnNewVideo" style="width:auto;display:none">更换视频</button>
  </header>

  <!-- 上传区域 -->
  <div id="uploadArea" class="upload-area">
    <div class="upload-icon">📁</div>
    <div class="upload-text">点击或拖拽视频文件到此处</div>
    <div class="upload-hint">支持 MP4 / WebM / MOV / AVI 等格式</div>
    <input type="file" id="fileInput" accept="video/*" style="display:none" />
  </div>

  <!-- 工作区 -->
  <div id="workspace" class="workspace">
    <!-- 预览区 -->
    <div class="preview-container">
      <!-- 原始视频 -->
      <div class="preview-panel">
        <div class="panel-header">
          <span class="panel-title">原始视频</span>
          <div class="panel-header-actions">
            <button class="btn-crop-toggle" id="btnCropToggle" title="画面裁剪">✂️ 裁剪</button>
            <span class="panel-badge" id="videoInfo">-</span>
          </div>
        </div>
        <div class="video-wrapper" id="videoWrapper">
          <video id="video" playsinline></video>
          <div class="click-hint" id="clickHint">👆 点击视频中的背景区域以识别颜色</div>
          <div class="crop-overlay" id="cropOverlay">
            <div class="crop-rect" id="cropRect">
              <div class="crop-handle" data-handle="nw"></div>
              <div class="crop-handle" data-handle="n"></div>
              <div class="crop-handle" data-handle="ne"></div>
              <div class="crop-handle" data-handle="e"></div>
              <div class="crop-handle" data-handle="se"></div>
              <div class="crop-handle" data-handle="s"></div>
              <div class="crop-handle" data-handle="sw"></div>
              <div class="crop-handle" data-handle="w"></div>
            </div>
          </div>
        </div>
        <div class="playback-controls">
          <button id="btnPlay" title="播放/暂停">▶</button>
          <div class="timeline" id="timeline">
            <div class="timeline-progress" id="timelineProgress"></div>
          </div>
          <span class="time-display" id="timeDisplay">00:00 / 00:00</span>
        </div>
        <div class="crop-controls" id="cropControls" style="display:none">
          <div class="crop-presets">
            <button class="crop-preset active" data-ratio="0">自由</button>
            <button class="crop-preset" data-ratio="1.7778">16:9</button>
            <button class="crop-preset" data-ratio="0.5625">9:16</button>
            <button class="crop-preset" data-ratio="1.3333">4:3</button>
            <button class="crop-preset" data-ratio="1">1:1</button>
            <button class="crop-preset" data-ratio="0.75">3:4</button>
          </div>
          <span class="crop-dimensions" id="cropDimensions">-</span>
          <button class="btn btn-secondary" id="btnResetCrop" style="width:auto;padding:4px 10px;font-size:12px">重置裁剪区</button>
        </div>
      </div>

      <!-- 处理结果 -->
      <div class="preview-panel">
        <div class="panel-header">
          <span class="panel-title">抠图结果</span>
          <span class="panel-badge" id="canvasInfo">等待处理</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="canvas"></canvas>
        </div>
      </div>
    </div>

    <!-- 控制面板 -->
    <div class="controls-panel">
      <!-- 模式切换 -->
      <div class="mode-selector">
        <div class="mode-tabs">
          <div class="mode-tab active" data-mode="chroma">🎨 色度键控</div>
          <div class="mode-tab" data-mode="ai">🤖 AI人像分割</div>
          <div class="mode-tab" data-mode="diff">📸 背景差分</div>
        </div>
      </div>

      <!-- 色度键控控制 -->
      <div id="chromaControls" class="mode-controls active">
        <div class="controls-grid">
          <!-- 左列 -->
          <div class="control-group">
            <div class="control-label">
              <span>🎨 背景颜色 <span id="sampleCount" style="font-size:11px;color:var(--accent)"></span></span>
              <span id="lumaKeyBadge" style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--accent-dim);color:var(--accent);display:none">亮度键控</span>
            </div>
            <div class="color-display">
              <div class="color-swatch">
                <div class="color-swatch-inner" id="colorSwatch" style="background:transparent"></div>
              </div>
              <div class="color-info">
                <div>已选颜色: <span class="hex" id="colorHex">未选择</span></div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">点击视频画面可叠加采样点</div>
              </div>
              <button class="btn btn-secondary" id="btnClearSamples" style="width:auto;padding:6px 10px;font-size:12px;flex-shrink:0">清除</button>
            </div>

            <div class="control-label" style="margin-top:4px">
              <span>颜色容差</span>
              <span class="control-value" id="toleranceValue">40</span>
            </div>
            <input type="range" id="toleranceSlider" min="0" max="200" value="40" />

            <div class="control-label" style="margin-top:4px">
              <span>边缘羽化</span>
              <span class="control-value" id="featherValue">15</span>
            </div>
            <input type="range" id="featherSlider" min="0" max="80" value="15" />
          
            <div class="control-label" style="margin-top:4px">
              <span>边缘锐化</span>
              <span class="control-value" id="alphaContrastValue">0.3</span>
            </div>
            <input type="range" id="alphaContrastSlider" min="0" max="100" value="30" />
          
            <div class="control-label" style="margin-top:4px">
              <span>边缘平滑</span>
              <span class="control-value" id="alphaBlurValue">2</span>
            </div>
            <input type="range" id="alphaBlurSlider" min="0" max="5" value="2" />
          </div>

          <!-- 右列 -->
          <div class="control-group">
            <div class="toggle-row">
              <span style="font-size:13px;color:var(--text-secondary)">溢出抑制（去除边缘色渍）</span>
              <div class="toggle active" id="spillToggle"></div>
            </div>

            <div class="control-label" style="margin-top:4px">
              <span>溢出抑制强度</span>
              <span class="control-value" id="spillStrengthValue">60</span>
            </div>
            <input type="range" id="spillStrengthSlider" min="0" max="100" value="60" />

            <div class="control-label" style="margin-top:4px">
              <span>颜色匹配模式</span>
            </div>
            <div class="select-wrapper">
              <select id="colorSpaceSelect">
                <option value="auto">智能自动（推荐）</option>
                <option value="ycbcr">YCbCr 色彩空间（绿幕/蓝幕最佳）</option>
                <option value="hsv">HSV 色彩空间（同色系背景）</option>
                <option value="rgb">RGB 加权距离（通用）</option>
              </select>
            </div>

            <div class="control-label" style="margin-top:4px">
              <span>背景替换预览</span>
            </div>
            <div class="select-wrapper">
              <select id="bgPreviewSelect">
                <option value="checker">透明（棋盘格）</option>
                <option value="white">白色背景</option>
                <option value="black">黑色背景</option>
                <option value="green">绿色背景</option>
                <option value="blue">蓝色背景</option>
                <option value="red">红色背景</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- AI人像分割控制 -->
      <div id="aiControls" class="mode-controls">
        <div class="controls-grid">
          <!-- 左列 -->
          <div class="control-group">
            <div class="ai-status" id="aiStatus">
              <span id="aiStatusIcon">⏳</span>
              <span id="aiStatusText">AI模型未加载，点击右侧按钮加载</span>
            </div>

            <div class="control-label" style="margin-top:8px">
              <span>分割灵敏度</span>
              <span class="control-value" id="aiThresholdValue">0.5</span>
            </div>
            <input type="range" id="aiThresholdSlider" min="0" max="100" value="50" />

            <div class="control-label" style="margin-top:4px">
              <span>边缘平滑度</span>
              <span class="control-value" id="aiSmoothValue">3</span>
            </div>
            <input type="range" id="aiSmoothSlider" min="0" max="10" value="3" />
          </div>

          <!-- 右列 -->
          <div class="control-group">
            <button class="btn btn-primary" id="btnLoadAIModel" style="margin-bottom:10px">加载AI模型</button>

            <div class="control-label" style="margin-top:4px">
              <span>背景替换预览</span>
            </div>
            <div class="select-wrapper">
              <select id="aiBgPreviewSelect">
                <option value="checker">透明（棋盘格）</option>
                <option value="white">白色背景</option>
                <option value="black">黑色背景</option>
                <option value="green">绿色背景</option>
                <option value="blue">蓝色背景</option>
                <option value="red">红色背景</option>
              </select>
            </div>

            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5">
              💡 AI人像分割无需纯色背景，可直接识别画面中的人物轮廓。首次加载需要下载模型文件（约2-5MB）。
            </div>
          </div>
        </div>
      </div>

      <!-- 背景差分控制 -->
      <div id="diffControls" class="mode-controls">
        <div class="controls-grid">
          <!-- 左列 -->
          <div class="control-group">
            <div class="control-label">
              <span>📸 背景参考帧</span>
            </div>
            <button class="capture-btn" id="btnCaptureBg">📷 捕获当前帧作为背景</button>
            <canvas class="bg-preview-thumb" id="bgPreviewThumb"></canvas>

            <div class="control-label" style="margin-top:4px">
              <span>差异阈值</span>
              <span class="control-value" id="diffThresholdValue">25</span>
            </div>
            <input type="range" id="diffThresholdSlider" min="5" max="100" value="25" />

            <div class="control-label" style="margin-top:4px">
              <span>边缘羽化</span>
              <span class="control-value" id="diffFeatherValue">10</span>
            </div>
            <input type="range" id="diffFeatherSlider" min="0" max="50" value="10" />
          </div>

          <!-- 右列 -->
          <div class="control-group">
            <div class="control-label" style="margin-top:4px">
              <span>背景替换预览</span>
            </div>
            <div class="select-wrapper">
              <select id="diffBgPreviewSelect">
                <option value="checker">透明（棋盘格）</option>
                <option value="white">白色背景</option>
                <option value="black">黑色背景</option>
                <option value="green">绿色背景</option>
                <option value="blue">蓝色背景</option>
                <option value="red">红色背景</option>
              </select>
            </div>

            <button class="btn btn-secondary" id="btnResetDiffBg" style="margin-top:8px">清除参考帧</button>

            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5">
              💡 背景差分适用于固定摄像头场景。先将视频暂停在无人/无主体的画面，点击捕获作为参考帧，再播放视频进行抠图。
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-secondary" id="btnReset" style="margin-top:12px">重置参数</button>
    </div>

    <!-- 导出面板 -->
    <div class="export-panel">
      <h3>📤 导出</h3>
      <div class="export-grid">
        <!-- WebM 导出 -->
        <div class="export-card">
          <h4>🎬 导出 WebM 视频</h4>
          <div class="desc">导出带透明通道的 WebM 视频文件，可直接用于视频合成。</div>
          <div class="export-options">
            <div class="select-wrapper">
              <select id="webmFpsSelect">
                <option value="30">30 FPS</option>
                <option value="24">24 FPS</option>
                <option value="15">15 FPS</option>
                <option value="10">10 FPS</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary" id="btnExportWebM">导出 WebM 视频</button>
          <div class="progress-container" id="webmProgress">
            <div class="progress-bar"><div class="progress-fill" id="webmProgressFill"></div></div>
            <div class="progress-text" id="webmProgressText">准备中...</div>
          </div>
        </div>

        <!-- 图片帧导出 -->
        <div class="export-card">
          <h4>🖼️ 导出图片帧</h4>
          <div class="desc">将视频逐帧导出为带透明通道的 PNG 或 WebP 图片。</div>
          <div class="export-options">
            <div class="select-wrapper">
              <select id="frameFormatSelect">
                <option value="png">PNG 格式</option>
                <option value="webp">WebP 格式</option>
              </select>
            </div>
            <div class="select-wrapper">
              <select id="frameIntervalSelect">
                <option value="1">每帧都导出</option>
                <option value="2">每隔 1 帧</option>
                <option value="5">每隔 4 帧</option>
                <option value="10">每隔 9 帧</option>
                <option value="15">每隔 14 帧</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary" id="btnExportFrames">导出图片帧</button>
          <div class="progress-container" id="frameProgress">
            <div class="progress-bar"><div class="progress-fill" id="frameProgressFill"></div></div>
            <div class="progress-text" id="frameProgressText">准备中...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>
`

// ============================================================
//  DOM 引用
// ============================================================
const dom = {
  uploadArea: document.getElementById('uploadArea'),
  fileInput: document.getElementById('fileInput'),
  workspace: document.getElementById('workspace'),
  video: document.getElementById('video'),
  videoWrapper: document.getElementById('videoWrapper'),
  clickHint: document.getElementById('clickHint'),
  canvas: document.getElementById('canvas'),
  videoInfo: document.getElementById('videoInfo'),
  canvasInfo: document.getElementById('canvasInfo'),
  btnPlay: document.getElementById('btnPlay'),
  timeline: document.getElementById('timeline'),
  timelineProgress: document.getElementById('timelineProgress'),
  timeDisplay: document.getElementById('timeDisplay'),
  colorSwatch: document.getElementById('colorSwatch'),
  colorHex: document.getElementById('colorHex'),
  toleranceSlider: document.getElementById('toleranceSlider'),
  toleranceValue: document.getElementById('toleranceValue'),
  featherSlider: document.getElementById('featherSlider'),
  featherValue: document.getElementById('featherValue'),
  spillToggle: document.getElementById('spillToggle'),
  spillStrengthSlider: document.getElementById('spillStrengthSlider'),
  spillStrengthValue: document.getElementById('spillStrengthValue'),
  bgPreviewSelect: document.getElementById('bgPreviewSelect'),
  btnReset: document.getElementById('btnReset'),
  webmFpsSelect: document.getElementById('webmFpsSelect'),
  btnExportWebM: document.getElementById('btnExportWebM'),
  webmProgress: document.getElementById('webmProgress'),
  webmProgressFill: document.getElementById('webmProgressFill'),
  webmProgressText: document.getElementById('webmProgressText'),
  frameFormatSelect: document.getElementById('frameFormatSelect'),
  frameIntervalSelect: document.getElementById('frameIntervalSelect'),
  btnExportFrames: document.getElementById('btnExportFrames'),
  frameProgress: document.getElementById('frameProgress'),
  frameProgressFill: document.getElementById('frameProgressFill'),
  frameProgressText: document.getElementById('frameProgressText'),
  toast: document.getElementById('toast'),
  btnNewVideo: document.getElementById('btnNewVideo'),
  colorSpaceSelect: document.getElementById('colorSpaceSelect'),
  // 色度键控增强
  sampleCount: document.getElementById('sampleCount'),
  lumaKeyBadge: document.getElementById('lumaKeyBadge'),
  btnClearSamples: document.getElementById('btnClearSamples'),
  alphaContrastSlider: document.getElementById('alphaContrastSlider'),
  alphaContrastValue: document.getElementById('alphaContrastValue'),
  alphaBlurSlider: document.getElementById('alphaBlurSlider'),
  alphaBlurValue: document.getElementById('alphaBlurValue'),
  // 模式切换
  modeTabs: document.querySelectorAll('.mode-tab'),
  chromaControls: document.getElementById('chromaControls'),
  aiControls: document.getElementById('aiControls'),
  diffControls: document.getElementById('diffControls'),
  // AI控制
  aiStatus: document.getElementById('aiStatus'),
  aiStatusIcon: document.getElementById('aiStatusIcon'),
  aiStatusText: document.getElementById('aiStatusText'),
  aiThresholdSlider: document.getElementById('aiThresholdSlider'),
  aiThresholdValue: document.getElementById('aiThresholdValue'),
  aiSmoothSlider: document.getElementById('aiSmoothSlider'),
  aiSmoothValue: document.getElementById('aiSmoothValue'),
  aiBgPreviewSelect: document.getElementById('aiBgPreviewSelect'),
  btnLoadAIModel: document.getElementById('btnLoadAIModel'),
  // 背景差分控制
  btnCaptureBg: document.getElementById('btnCaptureBg'),
  bgPreviewThumb: document.getElementById('bgPreviewThumb'),
  diffThresholdSlider: document.getElementById('diffThresholdSlider'),
  diffThresholdValue: document.getElementById('diffThresholdValue'),
  diffFeatherSlider: document.getElementById('diffFeatherSlider'),
  diffFeatherValue: document.getElementById('diffFeatherValue'),
  diffBgPreviewSelect: document.getElementById('diffBgPreviewSelect'),
  btnResetDiffBg: document.getElementById('btnResetDiffBg'),
  // 画面裁剪
  btnCropToggle: document.getElementById('btnCropToggle'),
  cropOverlay: document.getElementById('cropOverlay'),
  cropRect: document.getElementById('cropRect'),
  cropControls: document.getElementById('cropControls'),
  cropDimensions: document.getElementById('cropDimensions'),
  btnResetCrop: document.getElementById('btnResetCrop'),
  cropPresets: document.querySelectorAll('.crop-preset'),
}

// ============================================================
//  初始化
// ============================================================
function init() {
  state.video = dom.video
  state.canvas = dom.canvas
  state.ctx = state.canvas.getContext('2d')
  state.offscreen = document.createElement('canvas')
  state.offCtx = state.offscreen.getContext('2d', { willReadFrequently: true })
  state.tempCanvas = document.createElement('canvas')
  state.tempCtx = state.tempCanvas.getContext('2d')
  state.aiMaskCanvas = document.createElement('canvas')
  state.aiMaskCtx = state.aiMaskCanvas.getContext('2d', { willReadFrequently: true })

  bindEvents()
}

// ============================================================
//  事件绑定
// ============================================================
function bindEvents() {
  // 上传
  dom.uploadArea.addEventListener('click', () => dom.fileInput.click())
  dom.fileInput.addEventListener('change', handleFileSelect)

  dom.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault()
    dom.uploadArea.classList.add('dragover')
  })
  dom.uploadArea.addEventListener('dragleave', () => {
    dom.uploadArea.classList.remove('dragover')
  })
  dom.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault()
    dom.uploadArea.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('video/')) {
      loadVideo(file)
    } else {
      showToast('请选择视频文件', 'error')
    }
  })

  // 视频事件
  dom.video.addEventListener('loadedmetadata', onVideoLoaded)
  dom.video.addEventListener('play', () => {
    state.isPlaying = true
    dom.btnPlay.textContent = '⏸'
    renderLoop()
  })
  dom.video.addEventListener('pause', () => {
    state.isPlaying = false
    dom.btnPlay.textContent = '▶'
  })
  dom.video.addEventListener('ended', () => {
    state.isPlaying = false
    dom.btnPlay.textContent = '▶'
  })
  dom.video.addEventListener('timeupdate', updateTimeline)

  // 点击选取背景颜色（仅色度键控模式，裁剪模式时不触发）
  dom.videoWrapper.addEventListener('click', (e) => {
    if (state.cropEnabled) return
    if (state.mode === 'chroma') pickColor(e)
  })

  // 播放控制
  dom.btnPlay.addEventListener('click', togglePlay)
  dom.timeline.addEventListener('click', seekVideo)

  // 参数控制
  dom.toleranceSlider.addEventListener('input', (e) => {
    state.tolerance = parseInt(e.target.value)
    dom.toleranceValue.textContent = state.tolerance
    if (!state.isPlaying) processFrame()
  })
  dom.featherSlider.addEventListener('input', (e) => {
    state.feather = parseInt(e.target.value)
    dom.featherValue.textContent = state.feather
    if (!state.isPlaying) processFrame()
  })
  dom.spillStrengthSlider.addEventListener('input', (e) => {
    state.spillStrength = parseInt(e.target.value)
    dom.spillStrengthValue.textContent = state.spillStrength
    if (!state.isPlaying) processFrame()
  })
  dom.colorSpaceSelect.addEventListener('change', (e) => {
    state.colorSpace = e.target.value
    if (!state.isPlaying) processFrame()
  })
  // 清除采样点
  dom.btnClearSamples.addEventListener('click', () => {
    state.bgColors = []
    state.bgColor = null
    state.lumaKeyMode = null
    dom.colorSwatch.style.background = 'transparent'
    dom.colorHex.textContent = '未选择'
    dom.sampleCount.textContent = ''
    dom.lumaKeyBadge.style.display = 'none'
    dom.clickHint.style.display = ''
    if (!state.isPlaying) processFrame()
    showToast('已清除所有采样点', 'success')
  })
  // Alpha后处理
  dom.alphaContrastSlider.addEventListener('input', (e) => {
    state.alphaContrast = parseInt(e.target.value) / 100
    dom.alphaContrastValue.textContent = state.alphaContrast.toFixed(2)
    if (!state.isPlaying) processFrame()
  })
  dom.alphaBlurSlider.addEventListener('input', (e) => {
    state.alphaBlur = parseInt(e.target.value)
    dom.alphaBlurValue.textContent = state.alphaBlur
    if (!state.isPlaying) processFrame()
  })
  dom.spillToggle.addEventListener('click', () => {
    state.spillSuppress = !state.spillSuppress
    dom.spillToggle.classList.toggle('active', state.spillSuppress)
    if (!state.isPlaying) processFrame()
  })
  dom.bgPreviewSelect.addEventListener('change', () => {
    if (!state.isPlaying) processFrame()
  })

  // 重置
  dom.btnReset.addEventListener('click', resetParams)

  // 导出
  dom.btnExportWebM.addEventListener('click', exportWebM)
  dom.btnExportFrames.addEventListener('click', exportFrames)

  // 更换视频
  dom.btnNewVideo.addEventListener('click', () => {
    if (state.isExporting) {
      showToast('正在导出中，请稍候...', 'error')
      return
    }
    dom.fileInput.value = ''
    dom.fileInput.click()
  })

  // 模式切换
  dom.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode))
  })

  // AI模式控制
  dom.btnLoadAIModel.addEventListener('click', loadAIModel)
  dom.aiThresholdSlider.addEventListener('input', (e) => {
    state.aiThreshold = parseInt(e.target.value) / 100
    dom.aiThresholdValue.textContent = state.aiThreshold.toFixed(2)
    if (!state.isPlaying) processFrame()
  })
  dom.aiSmoothSlider.addEventListener('input', (e) => {
    state.aiSmooth = parseInt(e.target.value)
    dom.aiSmoothValue.textContent = state.aiSmooth
    if (!state.isPlaying) processFrame()
  })
  dom.aiBgPreviewSelect.addEventListener('change', () => {
    if (!state.isPlaying) processFrame()
  })

  // 背景差分控制
  dom.btnCaptureBg.addEventListener('click', captureBackgroundFrame)
  dom.btnResetDiffBg.addEventListener('click', () => {
    state.bgFrameData = null
    dom.btnCaptureBg.classList.remove('captured')
    dom.bgPreviewThumb.classList.remove('show')
    dom.btnCaptureBg.innerHTML = '📷 捕获当前帧作为背景'
    showToast('已清除背景参考帧', 'success')
  })
  dom.diffThresholdSlider.addEventListener('input', (e) => {
    state.diffThreshold = parseInt(e.target.value)
    dom.diffThresholdValue.textContent = state.diffThreshold
    if (!state.isPlaying && state.bgFrameData) processFrame()
  })
  dom.diffFeatherSlider.addEventListener('input', (e) => {
    state.diffFeather = parseInt(e.target.value)
    dom.diffFeatherValue.textContent = state.diffFeather
    if (!state.isPlaying && state.bgFrameData) processFrame()
  })
  dom.diffBgPreviewSelect.addEventListener('change', () => {
    if (!state.isPlaying) processFrame()
  })

  // 画面裁剪
  dom.btnCropToggle.addEventListener('click', toggleCrop)
  dom.cropOverlay.addEventListener('mousedown', onCropMouseDown)
  document.addEventListener('mousemove', onCropMouseMove)
  document.addEventListener('mouseup', onCropMouseUp)
  dom.btnResetCrop.addEventListener('click', () => {
    initCropRect()
    state.cropAspectRatio = 0
    dom.cropPresets.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ratio === '0')
    })
    updateCropOverlay()
    if (!state.isPlaying) processFrame()
  })
  dom.cropPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      applyCropAspectRatio(parseFloat(btn.dataset.ratio))
    })
  })
  window.addEventListener('resize', () => {
    if (state.cropEnabled) {
      syncCropOverlaySize()
      updateCropOverlay()
    }
  })
}

// ============================================================
//  文件处理
// ============================================================
function handleFileSelect(e) {
  const file = e.target.files[0]
  if (file) loadVideo(file)
}

function loadVideo(file) {
  const url = URL.createObjectURL(file)
  dom.video.src = url
  dom.video.load()
  showToast(`已加载: ${file.name}`, 'success')
}

function onVideoLoaded() {
  state.videoWidth = dom.video.videoWidth
  state.videoHeight = dom.video.videoHeight
  state.duration = dom.video.duration

  // 设置画布尺寸
  state.canvas.width = state.videoWidth
  state.canvas.height = state.videoHeight
  state.offscreen.width = state.videoWidth
  state.offscreen.height = state.videoHeight

  // 显示信息
  dom.videoInfo.textContent = `${state.videoWidth}×${state.videoHeight}`
  dom.canvasInfo.textContent = '等待选取背景色'
  dom.timeDisplay.textContent = `00:00 / ${formatTime(state.duration)}`

  // 切换到工作区
  dom.uploadArea.style.display = 'none'
  dom.workspace.classList.add('active')
  dom.btnNewVideo.style.display = 'inline-flex'

  // 重置状态
  state.bgColor = null
  state.bgColors = []
  state.lumaKeyMode = null
  state.colorSpace = 'auto'
  state.bgVariance = 0
  state.bgFrameData = null
  state.alphaBlur = 2
  state.alphaContrast = 0.3
  dom.colorSwatch.style.background = 'transparent'
  dom.colorHex.textContent = '未选择'
  dom.clickHint.style.display = ''
  dom.colorSpaceSelect.value = 'auto'
  dom.sampleCount.textContent = ''
  dom.lumaKeyBadge.style.display = 'none'
  dom.alphaBlurSlider.value = 2
  dom.alphaBlurValue.textContent = '2'
  dom.alphaContrastSlider.value = 30
  dom.alphaContrastValue.textContent = '0.30'
  dom.btnCaptureBg.classList.remove('captured')
  dom.bgPreviewThumb.classList.remove('show')
  dom.btnCaptureBg.innerHTML = '📷 捕获当前帧作为背景'

  // 重置裁剪状态
  state.cropEnabled = false
  state.cropAspectRatio = 0
  initCropRect()
  dom.btnCropToggle.classList.remove('active')
  dom.cropOverlay.classList.remove('active')
  dom.cropControls.style.display = 'none'
  dom.cropPresets.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ratio === '0')
  })

  // 绘制第一帧到画布（不处理，仅预览）
  dom.video.currentTime = 0
  dom.video.addEventListener('seeked', () => {
    state.ctx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)
    // 设置当前模式的提示
    switchMode(state.mode)
  }, { once: true })
}

// ============================================================
//  画面裁剪 - 交互逻辑
// ============================================================
let cropInteraction = null  // {type:'move'|'resize', handle, startMouseX, startMouseY, startRect, scaleX, scaleY}

function initCropRect() {
  const w = Math.round(state.videoWidth * 0.8)
  const h = Math.round(state.videoHeight * 0.8)
  const x = Math.round((state.videoWidth - w) / 2)
  const y = Math.round((state.videoHeight - h) / 2)
  state.cropRect = { x, y, width: w, height: h }
  state.cropAspectRatio = 0
}

function toggleCrop() {
  if (!state.videoWidth) return
  state.cropEnabled = !state.cropEnabled

  if (state.cropEnabled) {
    if (!state.cropRect) initCropRect()
    dom.btnCropToggle.classList.add('active')
    dom.cropOverlay.classList.add('active')
    dom.cropControls.style.display = ''
    dom.clickHint.style.display = 'none'
    syncCropOverlaySize()
    updateCropOverlay()
  } else {
    dom.btnCropToggle.classList.remove('active')
    dom.cropOverlay.classList.remove('active')
    dom.cropControls.style.display = 'none'
    if (state.mode === 'chroma' && !state.bgColor) {
      dom.clickHint.style.display = ''
    }
  }

  if (!state.isPlaying) processFrame()
}

function syncCropOverlaySize() {
  const videoRect = dom.video.getBoundingClientRect()
  const wrapperRect = dom.videoWrapper.getBoundingClientRect()
  dom.cropOverlay.style.left = (videoRect.left - wrapperRect.left) + 'px'
  dom.cropOverlay.style.top = (videoRect.top - wrapperRect.top) + 'px'
  dom.cropOverlay.style.width = videoRect.width + 'px'
  dom.cropOverlay.style.height = videoRect.height + 'px'
}

function updateCropOverlay() {
  if (!state.cropRect) return
  const videoRect = dom.video.getBoundingClientRect()
  if (videoRect.width === 0) return
  const scaleX = videoRect.width / state.videoWidth
  const scaleY = videoRect.height / state.videoHeight
  const r = state.cropRect
  dom.cropRect.style.left = (r.x * scaleX) + 'px'
  dom.cropRect.style.top = (r.y * scaleY) + 'px'
  dom.cropRect.style.width = (r.width * scaleX) + 'px'
  dom.cropRect.style.height = (r.height * scaleY) + 'px'
  dom.cropDimensions.textContent =
    `${Math.round(r.width)}×${Math.round(r.height)} @ (${Math.round(r.x)}, ${Math.round(r.y)})`
}

function constrainCropRect(rect) {
  const minSize = 50
  let w = Math.max(minSize, Math.round(rect.width))
  let h = Math.max(minSize, Math.round(rect.height))
  let x = Math.max(0, Math.round(rect.x))
  let y = Math.max(0, Math.round(rect.y))
  if (x + w > state.videoWidth) {
    x = state.videoWidth - w
    if (x < 0) { x = 0; w = state.videoWidth }
  }
  if (y + h > state.videoHeight) {
    y = state.videoHeight - h
    if (y < 0) { y = 0; h = state.videoHeight }
  }
  return { x, y, width: w, height: h }
}

function onCropMouseDown(e) {
  if (!state.cropEnabled) return
  const handleEl = e.target.closest('.crop-handle')
  const rectEl = e.target.closest('.crop-rect')
  if (!handleEl && !rectEl) return
  e.preventDefault()
  e.stopPropagation()

  const videoRect = dom.video.getBoundingClientRect()
  cropInteraction = {
    type: handleEl ? 'resize' : 'move',
    handle: handleEl ? handleEl.dataset.handle : null,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    startRect: { ...state.cropRect },
    scaleX: state.videoWidth / videoRect.width,
    scaleY: state.videoHeight / videoRect.height,
  }
}

function onCropMouseMove(e) {
  if (!cropInteraction) return
  const dx = (e.clientX - cropInteraction.startMouseX) * cropInteraction.scaleX
  const dy = (e.clientY - cropInteraction.startMouseY) * cropInteraction.scaleY
  const s = cropInteraction.startRect

  if (cropInteraction.type === 'move') {
    state.cropRect = constrainCropRect({
      x: s.x + dx, y: s.y + dy, width: s.width, height: s.height,
    })
  } else {
    let x = s.x, y = s.y, w = s.width, h = s.height
    const hd = cropInteraction.handle
    if (hd.includes('w')) { x = s.x + dx; w = s.width - dx }
    if (hd.includes('e')) { w = s.width + dx }
    if (hd.includes('n')) { y = s.y + dy; h = s.height - dy }
    if (hd.includes('s')) { h = s.height + dy }

    // 宽高比约束
    if (state.cropAspectRatio > 0) {
      if (hd === 'n' || hd === 's') {
        w = h * state.cropAspectRatio
        x = s.x + (s.width - w) / 2
      } else if (hd === 'e' || hd === 'w') {
        h = w / state.cropAspectRatio
        y = s.y + (s.height - h) / 2
      } else {
        // 角落手柄：以变化较大的维度为准
        const dw = Math.abs(w - s.width)
        const dh = Math.abs(h - s.height)
        if (dw / state.cropAspectRatio > dh) {
          h = w / state.cropAspectRatio
          if (hd.includes('n')) y = s.y + s.height - h
        } else {
          w = h * state.cropAspectRatio
          if (hd.includes('w')) x = s.x + s.width - w
        }
      }
    }

    state.cropRect = constrainCropRect({ x, y, width: w, height: h })
  }

  updateCropOverlay()
  if (!state.isPlaying) processFrame()
}

function onCropMouseUp() {
  cropInteraction = null
}

function applyCropAspectRatio(ratio) {
  state.cropAspectRatio = ratio
  // 更新预设按钮高亮
  dom.cropPresets.forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.ratio) === ratio)
  })
  if (ratio <= 0 || !state.cropRect) return

  const r = state.cropRect
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  let w = r.width
  let h = w / ratio
  if (h > r.height) { h = r.height; w = h * ratio }
  if (w > state.videoWidth) { w = state.videoWidth; h = w / ratio }
  if (h > state.videoHeight) { h = state.videoHeight; w = h * ratio }

  state.cropRect = constrainCropRect({
    x: cx - w / 2, y: cy - h / 2, width: w, height: h,
  })
  updateCropOverlay()
  if (!state.isPlaying) processFrame()
}

// ============================================================
//  颜色选取 - 多点累积采样
// ============================================================
function pickColor(e) {
  if (state.isExporting) return

  const rect = dom.video.getBoundingClientRect()
  const scaleX = dom.video.videoWidth / rect.width
  const scaleY = dom.video.videoHeight / rect.height
  const x = Math.floor((e.clientX - rect.left) * scaleX)
  const y = Math.floor((e.clientY - rect.top) * scaleY)

  state.offCtx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)

  // 9x9 区域采样
  const sampleSize = 9
  const half = Math.floor(sampleSize / 2)
  const sx = Math.max(0, x - half)
  const sy = Math.max(0, y - half)
  const sw = Math.min(sampleSize, state.videoWidth - sx)
  const sh = Math.min(sampleSize, state.videoHeight - sy)

  const sampleData = state.offCtx.getImageData(sx, sy, sw, sh).data
  let sumR = 0, sumG = 0, sumB = 0, count = 0
  for (let i = 0; i < sampleData.length; i += 4) {
    sumR += sampleData[i]
    sumG += sampleData[i + 1]
    sumB += sampleData[i + 2]
    count++
  }

  const avgR = Math.round(sumR / count)
  const avgG = Math.round(sumG / count)
  const avgB = Math.round(sumB / count)

  // 累积采样点
  state.bgColors.push({ r: avgR, g: avgG, b: avgB })

  // 计算平均颜色（用于显示和去污染）
  let totalR = 0, totalG = 0, totalB = 0
  for (const c of state.bgColors) {
    totalR += c.r; totalG += c.g; totalB += c.b
  }
  state.bgColor = {
    r: Math.round(totalR / state.bgColors.length),
    g: Math.round(totalG / state.bgColors.length),
    b: Math.round(totalB / state.bgColors.length)
  }

  // 计算颜色方差
  let varSum = 0
  for (const c of state.bgColors) {
    const dr = c.r - state.bgColor.r
    const dg = c.g - state.bgColor.g
    const db = c.b - state.bgColor.b
    varSum += dr * dr + dg * dg + db * db
  }
  state.bgVariance = Math.sqrt(varSum / state.bgColors.length / 3)

  // 自动选择颜色空间和亮度键控
  if (state.colorSpace === 'auto') {
    autoSelectColorSpace()
  }

  // 更新 UI
  const hex = rgbToHex(state.bgColor)
  dom.colorSwatch.style.background = hex
  dom.colorHex.textContent = hex.toUpperCase()
  dom.canvasInfo.textContent = '处理中...'
  dom.clickHint.style.display = 'none'
  dom.sampleCount.textContent = state.bgColors.length > 1 ? `(${state.bgColors.length} 采样点)` : ''

  processFrame()
  showToast(`已添加背景采样点 (${state.bgColors.length} 个)`, 'success')
}

// 自动选择颜色空间 + 亮度键控检测
function autoSelectColorSpace() {
  const bg = state.bgColor
  if (!bg) return

  const luminance = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b
  const max = Math.max(bg.r, bg.g, bg.b)
  const min = Math.min(bg.r, bg.g, bg.b)
  const saturation = max > 0 ? (max - min) / max : 0

  // 检测白底/黑底 → 亮度键控
  if (luminance > 210 && saturation < 0.15) {
    state.lumaKeyMode = 'white'
    dom.lumaKeyBadge.style.display = ''
    dom.lumaKeyBadge.textContent = '亮度键控 · 白底'
  } else if (luminance < 40 && saturation < 0.15) {
    state.lumaKeyMode = 'black'
    dom.lumaKeyBadge.style.display = ''
    dom.lumaKeyBadge.textContent = '亮度键控 · 黑底'
  } else {
    state.lumaKeyMode = null
    dom.lumaKeyBadge.style.display = 'none'
  }

  // 选择色彩空间
  const isGreenScreen = bg.g > bg.r + 20 && bg.g > bg.b + 20
  const isBlueScreen = bg.b > bg.r + 20 && bg.b > bg.g + 20
  const isRedScreen = bg.r > bg.g + 20 && bg.r > bg.b + 20

  if (isGreenScreen || isBlueScreen || isRedScreen) {
    state.colorSpace = 'ycbcr'
  } else if (max - min > 30) {
    state.colorSpace = 'hsv'
  } else {
    state.colorSpace = 'rgb'
  }
  dom.colorSpaceSelect.value = state.colorSpace
}

// ============================================================
//  色彩空间转换工具函数
// ============================================================

// RGB -> YCbCr
function rgbToYCbCr(r, g, b) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,           // Y
    -0.168736 * r - 0.331264 * g + 0.5 * b + 128, // Cb
    0.5 * r - 0.418688 * g - 0.081312 * b + 128   // Cr
  ]
}

// RGB -> HSV  (H: 0-360, S: 0-1, V: 0-1)
function rgbToHSV(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max > 0 ? d / max : 0
  return [h, s, max]
}

// smoothstep 平滑插值 (比线性插值更平滑)
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// ============================================================
//  核心抠图算法 - chromaKey
//  统一处理函数，被 processFrame / exportWebM / exportFrames 共用
// ============================================================
function chromaKey(imageData) {
  // 亮度键控模式（白底/黑底）
  if (state.lumaKeyMode) {
    lumaKey(imageData)
    postProcessAlpha(imageData)
    return imageData
  }

  const data = imageData.data
  const bg = state.bgColor  // 平均颜色，用于去污染
  const bgColors = state.bgColors.length > 0 ? state.bgColors : [bg]
  const tolerance = state.tolerance
  const feather = state.feather
  const colorSpace = state.colorSpace === 'auto' ? 'rgb' : state.colorSpace
  const spillStrength = state.spillStrength / 100
  const featherEnd = tolerance + feather

  // 预计算背景在各色彩空间的值（每个采样点）
  const bgYList = bgColors.map(c => rgbToYCbCr(c.r, c.g, c.b))
  const bgHList = bgColors.map(c => rgbToHSV(c.r, c.g, c.b))

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // 计算到每个采样点的最小距离
    let minDist = Infinity
    for (let s = 0; s < bgColors.length; s++) {
      let dist
      if (colorSpace === 'ycbcr') {
        const y = 0.299 * r + 0.587 * g + 0.114 * b
        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
        const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
        const dCb = cb - bgYList[s][1]
        const dCr = cr - bgYList[s][2]
        const dY = y - bgYList[s][0]
        dist = Math.sqrt(dCb * dCb + dCr * dCr + dY * dY * 0.08)
      } else if (colorSpace === 'hsv') {
        const hsv = rgbToHSV(r, g, b)
        let hueDiff = Math.abs(hsv[0] - bgHList[s][0])
        if (hueDiff > 180) hueDiff = 360 - hueDiff
        const satWeight = Math.max(hsv[1], bgHList[s][1])
        const hueDist = (hueDiff / 180) * 100 * satWeight
        const satDist = Math.abs(hsv[1] - bgHList[s][1]) * 80
        const valDist = Math.abs(hsv[2] - bgHList[s][2]) * 60
        dist = Math.sqrt(hueDist * hueDist + satDist * satDist + valDist * valDist)
      } else {
        const dr = r - bgColors[s].r
        const dg = g - bgColors[s].g
        const db = b - bgColors[s].b
        dist = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)
      }
      if (dist < minDist) minDist = dist
    }

    // 计算 alpha (smoothstep 曲线)
    let alpha
    let edgeRatio = 0

    if (minDist < tolerance) {
      alpha = 0
      edgeRatio = 1
    } else if (feather > 0 && minDist < featherEnd) {
      const t = (minDist - tolerance) / feather
      const smoothT = t * t * (3 - 2 * t)
      alpha = Math.round(smoothT * 255)
      edgeRatio = 1 - smoothT
    } else {
      alpha = 255
      if (feather > 0 && minDist < featherEnd + feather) {
        edgeRatio = (featherEnd + feather - minDist) / (feather * 2)
      }
    }

    // 溢出抑制
    if (state.spillSuppress && edgeRatio > 0.01) {
      suppressSpill(data, i, bg, spillStrength, edgeRatio)
    }

    // 颜色去污染
    if (alpha > 2 && alpha < 253) {
      const a = alpha / 255
      const invA = 1 - a
      const fgR = (r - bg.r * invA) / a
      const fgG = (g - bg.g * invA) / a
      const fgB = (b - bg.b * invA) / a
      data[i] = Math.max(0, Math.min(255, fgR))
      data[i + 1] = Math.max(0, Math.min(255, fgG))
      data[i + 2] = Math.max(0, Math.min(255, fgB))
    }

    data[i + 3] = alpha
  }

  // Alpha 后处理
  postProcessAlpha(imageData)
  return imageData
}

// 亮度键控：白底/黑底
function lumaKey(imageData) {
  const data = imageData.data
  const tolerance = state.tolerance
  const feather = state.feather
  const isWhite = state.lumaKeyMode === 'white'
  const threshold = isWhite ? (255 - tolerance) : tolerance
  const spillStrength = state.spillStrength / 100
  const bg = state.bgColor

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = 0.299 * r + 0.587 * g + 0.114 * b

    // diff > 0 表示像素在背景范围内
    const diff = isWhite ? (luma - threshold) : (threshold - luma)

    let alpha
    let edgeRatio = 0

    if (diff > 0) {
      alpha = 0
      edgeRatio = 1
    } else if (feather > 0 && diff > -feather) {
      const t = (-diff) / feather
      const smoothT = t * t * (3 - 2 * t)
      alpha = Math.round((1 - smoothT) * 255)
      edgeRatio = smoothT
    } else {
      alpha = 255
      if (feather > 0 && diff > -(feather * 2)) {
        edgeRatio = (feather * 2 + diff) / (feather * 2)
      }
    }

    // 溢出抑制
    if (state.spillSuppress && edgeRatio > 0.01 && bg) {
      suppressSpill(data, i, bg, spillStrength, edgeRatio)
    }

    data[i + 3] = alpha
  }
}

// Alpha 通道后处理：模糊 + 对比度增强
function postProcessAlpha(imageData) {
  if (state.alphaBlur > 0) {
    blurAlpha(imageData.data, state.videoWidth, state.videoHeight, state.alphaBlur)
  }
  if (state.alphaContrast > 0) {
    contrastAlpha(imageData.data, state.alphaContrast)
  }
}

// Alpha 通道模糊（可分离的盒式模糊，高性能）
function blurAlpha(data, width, height, radius) {
  if (radius <= 0) return
  const len = width * height
  const a = new Uint8Array(len)

  // 提取 alpha 通道
  for (let i = 0, j = 3; i < len; i++, j += 4) {
    a[i] = data[j]
  }

  // 水平模糊
  const hBuf = new Uint8Array(len)
  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0
      const start = Math.max(0, x - radius)
      const end = Math.min(width - 1, x + radius)
      for (let xi = start; xi <= end; xi++) {
        sum += a[rowStart + xi]
        count++
      }
      hBuf[rowStart + x] = sum / count
    }
  }

  // 垂直模糊
  for (let y = 0; y < height; y++) {
    const start = Math.max(0, y - radius)
    const end = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0
      for (let yi = start; yi <= end; yi++) {
        sum += hBuf[yi * width + x]
        count++
      }
      data[(y * width + x) * 4 + 3] = sum / count
    }
  }
}

// Alpha 通道对比度增强
function contrastAlpha(data, amount) {
  if (amount <= 0) return
  // 对比度系数，amount=1 时 factor=5，效果最强
  const factor = 1 + amount * 4
  for (let i = 3; i < data.length; i += 4) {
    const val = data[i] / 255
    const contrasted = 0.5 + (val - 0.5) * factor
    data[i] = Math.max(0, Math.min(255, Math.round(contrasted * 255)))
  }
}

// 增强溢出抑制 - 多通道颜色分离
function suppressSpill(data, i, bg, strength, ratio) {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  const amt = strength * ratio

  if (bg.g > bg.r && bg.g > bg.b) {
    // 绿幕: 去除多余绿色，同时补充红蓝
    const excess = g - Math.max(r, b)
    if (excess > 0) {
      const cut = excess * amt
      data[i + 1] = Math.max(0, g - cut)
      data[i] = Math.min(255, r + cut * 0.15)
      data[i + 2] = Math.min(255, b + cut * 0.15)
    }
  } else if (bg.b > bg.r && bg.b > bg.g) {
    // 蓝幕: 去除多余蓝色
    const excess = b - Math.max(r, g)
    if (excess > 0) {
      const cut = excess * amt
      data[i + 2] = Math.max(0, b - cut)
      data[i] = Math.min(255, r + cut * 0.15)
      data[i + 1] = Math.min(255, g + cut * 0.15)
    }
  } else if (bg.r > bg.g && bg.r > bg.b) {
    // 红幕: 去除多余红色
    const excess = r - Math.max(g, b)
    if (excess > 0) {
      const cut = excess * amt
      data[i] = Math.max(0, r - cut)
      data[i + 1] = Math.min(255, g + cut * 0.15)
      data[i + 2] = Math.min(255, b + cut * 0.15)
    }
  } else {
    // 通用: 向灰色去饱和
    const gray = (r + g + b) / 3
    data[i] = r + (gray - r) * amt * 0.5
    data[i + 1] = g + (gray - g) * amt * 0.5
    data[i + 2] = b + (gray - b) * amt * 0.5
  }
}

// ============================================================
//  模式切换
// ============================================================
function switchMode(mode) {
  if (state.isExporting) {
    showToast('正在导出中，请稍候...', 'error')
    return
  }
  state.mode = mode

  // 更新Tab状态
  dom.modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode)
  })

  // 显示对应控制面板
  dom.chromaControls.classList.toggle('active', mode === 'chroma')
  dom.aiControls.classList.toggle('active', mode === 'ai')
  dom.diffControls.classList.toggle('active', mode === 'diff')

  // 更新点击提示
  if (mode === 'chroma') {
    dom.clickHint.textContent = '👆 点击视频中的背景区域以识别颜色'
    dom.clickHint.style.display = state.bgColor ? 'none' : ''
  } else if (mode === 'ai') {
    dom.clickHint.textContent = '🤖 AI模式：无需点击，自动识别人物'
    dom.clickHint.style.display = state.aiLoaded ? 'none' : ''
  } else if (mode === 'diff') {
    dom.clickHint.textContent = '📸 暂停到无主体画面，点击“捕获背景帧”'
    dom.clickHint.style.display = state.bgFrameData ? 'none' : ''
  }

  processFrame()
}

// ============================================================
//  AI 模型加载
// ============================================================
let tfLoaded = false
let bodySegLoaded = false

async function loadAIModel() {
  if (state.aiLoaded || state.aiLoading) return
  state.aiLoading = true

  dom.btnLoadAIModel.disabled = true
  dom.aiStatus.className = 'ai-status loading'
  dom.aiStatusIcon.innerHTML = '<span class="spinner"></span>'
  dom.aiStatusText.textContent = '正在加载 TensorFlow.js...'

  try {
    // 1. 加载 TensorFlow.js
    if (!tfLoaded) {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js')
      tfLoaded = true
    }
    dom.aiStatusText.textContent = '正在加载分割模型...'

    // 2. 加载 body-segmentation
    if (!bodySegLoaded) {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js')
      bodySegLoaded = true
    }
    dom.aiStatusText.textContent = '正在初始化模型...'

    // 3. 创建分割器
    const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation
    state.aiModel = await bodySegmentation.createSegmenter(model, {
      runtime: 'mediapipe',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747',
      modelType: 'general',
    })

    state.aiLoaded = true
    state.aiLoading = false
    dom.aiStatus.className = 'ai-status ready'
    dom.aiStatusIcon.textContent = '✓'
    dom.aiStatusText.textContent = 'AI模型已就绪！可开始抠图'
    dom.btnLoadAIModel.textContent = '模型已加载'
    dom.btnLoadAIModel.disabled = true
    dom.clickHint.style.display = 'none'
    showToast('AI模型加载成功！', 'success')

    processFrame()
  } catch (err) {
    console.error('AI模型加载失败:', err)
    state.aiLoading = false
    dom.aiStatus.className = 'ai-status error'
    dom.aiStatusIcon.textContent = '✗'
    dom.aiStatusText.textContent = `加载失败: ${err.message}`
    dom.btnLoadAIModel.disabled = false
    showToast('AI模型加载失败，请检查网络', 'error')
  }
}

// ============================================================
//  AI 分割掩码处理
// ============================================================
async function applyAIMask(imageData, videoElement) {
  if (!state.aiModel) return imageData

  // 运行AI分割
  const segmentation = await state.aiModel.segmentPeople(videoElement, {
    flipHorizontal: false,
  })

  if (!segmentation || segmentation.length === 0) return imageData

  const mask = segmentation[0].mask
  const maskData = mask.data // Float32Array, values 0-1
  const maskW = mask.width
  const maskH = mask.height
  const data = imageData.data

  // 将掩码绘制到掩码画布
  state.aiMaskCanvas.width = maskW
  state.aiMaskCanvas.height = maskH
  const maskImageData = state.aiMaskCtx.createImageData(maskW, maskH)
  const threshold = state.aiThreshold

  for (let i = 0; i < maskData.length; i++) {
    // 应用阈值，并用smoothstep平滑
    let val = maskData[i]
    // 灵敏度调整：阈值越低，保留越多（前景更多）
    const adjusted = (val - threshold) / (1 - threshold + 0.001)
    val = Math.max(0, Math.min(1, adjusted))
    // smoothstep
    val = val * val * (3 - 2 * val)
    const byteVal = Math.round(val * 255)
    maskImageData.data[i * 4] = byteVal
    maskImageData.data[i * 4 + 1] = byteVal
    maskImageData.data[i * 4 + 2] = byteVal
    maskImageData.data[i * 4 + 3] = 255
  }
  state.aiMaskCtx.putImageData(maskImageData, 0, 0)

  // 缩放掩码到视频分辨率（用drawImage自动插值）
  state.tempCanvas.width = state.videoWidth
  state.tempCanvas.height = state.videoHeight
  state.tempCtx.clearRect(0, 0, state.videoWidth, state.videoHeight)

  // 边缘平滑：通过多次绘制实现简单模糊
  const smooth = state.aiSmooth
  if (smooth > 0) {
    state.tempCtx.filter = `blur(${smooth}px)`
  } else {
    state.tempCtx.filter = 'none'
  }
  state.tempCtx.drawImage(state.aiMaskCanvas, 0, 0, state.videoWidth, state.videoHeight)
  state.tempCtx.filter = 'none'

  // 读取缩放后的掩码
  const scaledMask = state.tempCtx.getImageData(0, 0, state.videoWidth, state.videoHeight)

  // 应用掩码作为alpha通道
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = scaledMask.data[i] // 用掩码的红色通道作为alpha
  }

  return imageData
}

// ============================================================
//  背景差分模式
// ============================================================
function captureBackgroundFrame() {
  if (!state.videoWidth) return

  state.offCtx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)
  state.bgFrameData = state.offCtx.getImageData(0, 0, state.videoWidth, state.videoHeight)

  // 显示缩略图
  const thumbCtx = dom.bgPreviewThumb.getContext('2d')
  dom.bgPreviewThumb.width = 160
  dom.bgPreviewThumb.height = 90
  thumbCtx.drawImage(dom.video, 0, 0, 160, 90)
  dom.bgPreviewThumb.classList.add('show')
  dom.btnCaptureBg.classList.add('captured')
  dom.btnCaptureBg.innerHTML = '✓ 背景帧已捕获'
  dom.clickHint.style.display = 'none'

  showToast('背景参考帧已捕获！', 'success')
  processFrame()
}

function diffKey(imageData) {
  if (!state.bgFrameData) return imageData

  const data = imageData.data
  const bgData = state.bgFrameData.data
  const threshold = state.diffThreshold
  const feather = state.diffFeather
  const featherEnd = threshold + feather

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgData[i]
    const dg = data[i + 1] - bgData[i + 1]
    const db = data[i + 2] - bgData[i + 2]
    // 加权差异距离
    const diff = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)

    let alpha
    if (diff < threshold) {
      alpha = 0
    } else if (feather > 0 && diff < featherEnd) {
      const t = (diff - threshold) / feather
      const smoothT = t * t * (3 - 2 * t)
      alpha = Math.round(smoothT * 255)
    } else {
      alpha = 255
    }
    data[i + 3] = alpha
  }

  return imageData
}

// ============================================================
//  统一帧处理 (调度器)
// ============================================================
function getBgPreviewColor() {
  let bgMode = 'checker'
  if (state.mode === 'chroma') bgMode = dom.bgPreviewSelect.value
  else if (state.mode === 'ai') bgMode = dom.aiBgPreviewSelect.value
  else if (state.mode === 'diff') bgMode = dom.diffBgPreviewSelect.value

  if (bgMode === 'checker') return null
  const colors = {
    white: '#ffffff', black: '#000000',
    green: '#00b140', blue: '#0033cc', red: '#cc0000'
  }
  return colors[bgMode] || null
}

async function processFrame() {
  if (!state.videoWidth) return

  // 检查前置条件
  if (state.mode === 'chroma' && !state.bgColor) return
  if (state.mode === 'ai' && !state.aiLoaded) return
  if (state.mode === 'diff' && !state.bgFrameData) return

  // 绘制视频帧到离屏画布（全帧，不变）
  state.offCtx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)
  const imageData = state.offCtx.getImageData(0, 0, state.videoWidth, state.videoHeight)

  // 根据模式处理（全帧，不变）
  if (state.mode === 'chroma') {
    chromaKey(imageData)
  } else if (state.mode === 'diff') {
    diffKey(imageData)
  } else if (state.mode === 'ai') {
    await applyAIMask(imageData, dom.video)
  }

  // 计算输出区域（裁剪）
  const crop = state.cropEnabled && state.cropRect ? state.cropRect : null
  const outW = crop ? crop.width : state.videoWidth
  const outH = crop ? crop.height : state.videoHeight

  // 设置显示画布尺寸
  state.canvas.width = outW
  state.canvas.height = outH
  state.ctx.clearRect(0, 0, outW, outH)

  const bgColor = getBgPreviewColor()
  if (bgColor) {
    state.ctx.fillStyle = bgColor
    state.ctx.fillRect(0, 0, outW, outH)
  }

  // 全帧处理结果写入 tempCanvas
  state.tempCanvas.width = state.videoWidth
  state.tempCanvas.height = state.videoHeight
  state.tempCtx.putImageData(imageData, 0, 0)

  // 裁剪绘制：只把裁剪区域绘制到显示画布
  if (crop) {
    state.ctx.drawImage(state.tempCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH)
  } else {
    state.ctx.drawImage(state.tempCanvas, 0, 0)
  }

  dom.canvasInfo.textContent = crop ? `${outW}×${outH} (裁剪)` : '已处理'
}

// 统一导出处理函数
async function processForExport(imageData, videoElement) {
  if (state.mode === 'chroma') {
    chromaKey(imageData)
  } else if (state.mode === 'diff') {
    diffKey(imageData)
  } else if (state.mode === 'ai') {
    await applyAIMask(imageData, videoElement)
  }
  return imageData
}

// ============================================================
//  渲染循环
// ============================================================
let rafId = null
let renderLoopRunning = false

async function renderLoop() {
  if (!state.isPlaying || state.isExporting || renderLoopRunning) return
  renderLoopRunning = true
  await processFrame()
  renderLoopRunning = false
  if (state.isPlaying && !state.isExporting) {
    rafId = requestAnimationFrame(renderLoop)
  }
}

// ============================================================
//  播放控制
// ============================================================
function togglePlay() {
  if (dom.video.paused) {
    dom.video.play()
  } else {
    dom.video.pause()
  }
}

function seekVideo(e) {
  const rect = dom.timeline.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  dom.video.currentTime = ratio * state.duration
  if (!state.isPlaying) {
    dom.video.addEventListener('seeked', () => processFrame(), { once: true })
  }
}

function updateTimeline() {
  const ratio = (dom.video.currentTime / state.duration) * 100
  dom.timelineProgress.style.width = `${ratio}%`
  dom.timeDisplay.textContent = `${formatTime(dom.video.currentTime)} / ${formatTime(state.duration)}`
}

// ============================================================
//  WebM 导出
// ============================================================
async function exportWebM() {
  if (!state.bgColor) {
    showToast('请先点击视频选取背景颜色', 'error')
    return
  }
  if (state.isExporting) return

  state.isExporting = true
  dom.btnExportWebM.disabled = true
  dom.webmProgress.classList.add('active')
  dom.webmProgressFill.style.width = '0%'
  dom.webmProgressText.textContent = '准备中...'

  try {
    const fps = parseInt(dom.webmFpsSelect.value)

    // 检查浏览器支持
    const mimeType = getSupportedWebMMimeType()
    if (!mimeType) {
      throw new Error('当前浏览器不支持 WebM 视频录制')
    }

    // 暂停视频
    dom.video.pause()

    // 计算裁剪区域
    const crop = state.cropEnabled && state.cropRect ? state.cropRect : null
    const outW = crop ? crop.width : state.videoWidth
    const outH = crop ? crop.height : state.videoHeight

    // 创建导出用画布
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = outW
    exportCanvas.height = outH
    const exportCtx = exportCanvas.getContext('2d')

    // 获取画布流
    const stream = exportCanvas.captureStream(fps)
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 8000000,
    })

    const chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    const exportPromise = new Promise((resolve) => {
      recorder.onstop = resolve
    })

    // 处理函数 - 在导出画布上绘制
    async function processExportFrame() {
      exportCtx.clearRect(0, 0, outW, outH)

      // 绘制视频帧到离屏画布（全帧）
      state.offCtx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)
      const imageData = state.offCtx.getImageData(0, 0, state.videoWidth, state.videoHeight)

      // 统一抠图处理（支持三模式）
      await processForExport(imageData, dom.video)

      // 复用临时画布绘制（全帧）
      state.tempCanvas.width = state.videoWidth
      state.tempCanvas.height = state.videoHeight
      state.tempCtx.putImageData(imageData, 0, 0)

      // 裁剪绘制：只把裁剪区域绘制到导出画布
      if (crop) {
        exportCtx.drawImage(state.tempCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH)
      } else {
        exportCtx.drawImage(state.tempCanvas, 0, 0)
      }
    }

    // 开始录制
    recorder.start()

    // 回到视频开头
    dom.video.currentTime = 0
    await new Promise(r => dom.video.addEventListener('seeked', r, { once: true }))

    // 播放视频并逐帧处理
    const totalFrames = Math.ceil(state.duration * fps)
    let frameCount = 0

    const frameInterval = 1000 / fps
    let lastTime = 0

    state.isPlaying = false // 防止播放事件触发渲染循环
    await dom.video.play()

    await new Promise((resolve) => {
      async function processExportLoop() {
        if (dom.video.ended || dom.video.paused) {
          recorder.stop()
          resolve()
          return
        }

        const currentTime = dom.video.currentTime
        const expectedFrame = Math.floor(currentTime * fps)

        if (expectedFrame > frameCount || frameCount === 0) {
          await processExportFrame()
          frameCount = expectedFrame
          const progress = Math.min(100, (currentTime / state.duration) * 100)
          dom.webmProgressFill.style.width = `${progress}%`
          dom.webmProgressText.textContent = `导出中... ${progress.toFixed(1)}% (${formatTime(currentTime)} / ${formatTime(state.duration)})`
        }

        requestAnimationFrame(processExportLoop)
      }
      processExportLoop()
    })

    await exportPromise

    // 创建下载
    const blob = new Blob(chunks, { type: 'video/webm' })
    const fileName = crop
      ? `matting_crop_${outW}x${outH}_${Date.now()}.webm`
      : `matting_output_${Date.now()}.webm`
    downloadBlob(blob, fileName)

    dom.webmProgressFill.style.width = '100%'
    dom.webmProgressText.textContent = '导出完成！'
    showToast('WebM 视频导出成功！', 'success')

    setTimeout(() => {
      dom.webmProgress.classList.remove('active')
    }, 3000)

  } catch (err) {
    console.error(err)
    showToast(`导出失败: ${err.message}`, 'error')
    dom.webmProgress.classList.remove('active')
  } finally {
    state.isExporting = false
    state.isPlaying = false
    dom.btnExportWebM.disabled = false
    dom.video.pause()
    dom.btnPlay.textContent = '▶'
  }
}

function getSupportedWebMMimeType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

// ============================================================
//  图片帧导出
// ============================================================
async function exportFrames() {
  if (!state.bgColor) {
    showToast('请先点击视频选取背景颜色', 'error')
    return
  }
  if (state.isExporting) return

  state.isExporting = true
  dom.btnExportFrames.disabled = true
  dom.frameProgress.classList.add('active')
  dom.frameProgressFill.style.width = '0%'
  dom.frameProgressText.textContent = '准备中...'

  try {
    const format = dom.frameFormatSelect.value
    const interval = parseInt(dom.frameIntervalSelect.value)
    const fps = 30 // 假设源视频 30fps
    const totalFrames = Math.ceil(state.duration * fps)
    const exportFramesList = []

    dom.video.pause()

    // 计算裁剪区域
    const crop = state.cropEnabled && state.cropRect ? state.cropRect : null
    const outW = crop ? crop.width : state.videoWidth
    const outH = crop ? crop.height : state.videoHeight

    // 裁剪输出用的画布
    const frameCanvas = document.createElement('canvas')
    const frameCtx = frameCanvas.getContext('2d')

    // 计算需要导出的时间点
    const timePoints = []
    for (let i = 0; i < totalFrames; i += interval) {
      timePoints.push(i / fps)
    }

    dom.frameProgressText.textContent = `共 ${timePoints.length} 帧待导出...`

    // 逐帧处理
    for (let idx = 0; idx < timePoints.length; idx++) {
      const time = timePoints[idx]
      dom.video.currentTime = Math.min(time, state.duration - 0.01)

      // 等待 seek 完成
      await new Promise(r => dom.video.addEventListener('seeked', r, { once: true }))

      // 处理帧（全帧）
      state.offCtx.drawImage(dom.video, 0, 0, state.videoWidth, state.videoHeight)
      const imageData = state.offCtx.getImageData(0, 0, state.videoWidth, state.videoHeight)

      // 统一抠图处理（支持三模式）
      await processForExport(imageData, dom.video)

      // 全帧结果写入 tempCanvas
      state.tempCanvas.width = state.videoWidth
      state.tempCanvas.height = state.videoHeight
      state.tempCtx.putImageData(imageData, 0, 0)

      // 裁剪绘制到输出画布
      frameCanvas.width = outW
      frameCanvas.height = outH
      frameCtx.clearRect(0, 0, outW, outH)
      if (crop) {
        frameCtx.drawImage(state.tempCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH)
      } else {
        frameCtx.drawImage(state.tempCanvas, 0, 0)
      }

      const mimeType = format === 'png' ? 'image/png' : 'image/webp'
      const quality = format === 'webp' ? 0.9 : undefined
      const blob = await new Promise(resolve => {
        frameCanvas.toBlob(resolve, mimeType, quality)
      })

      const frameNum = String(idx + 1).padStart(5, '0')
      exportFramesList.push({
        blob,
        name: `frame_${frameNum}.${format}`
      })

      const progress = ((idx + 1) / timePoints.length) * 100
      dom.frameProgressFill.style.width = `${progress}%`
      dom.frameProgressText.textContent = `导出中... ${idx + 1} / ${timePoints.length} (${progress.toFixed(1)}%)`

      // 让出主线程
      await new Promise(r => setTimeout(r, 10))
    }

    // 下载帧
    if (exportFramesList.length <= 5) {
      // 少量帧直接下载
      for (const frame of exportFramesList) {
        downloadBlob(frame.blob, frame.name)
        await new Promise(r => setTimeout(r, 200))
      }
    } else {
      // 大量帧使用 JSZip 打包
      dom.frameProgressText.textContent = '正在打包为 ZIP...'
      const zipBlob = await createZip(exportFramesList)
      if (zipBlob) {
        const zipName = crop
          ? `matting_crop_${outW}x${outH}_frames_${Date.now()}.zip`
          : `matting_frames_${Date.now()}.zip`
        downloadBlob(zipBlob, zipName)
      }
    }

    dom.frameProgressFill.style.width = '100%'
    dom.frameProgressText.textContent = `导出完成！共 ${exportFramesList.length} 帧`
    showToast(`成功导出 ${exportFramesList.length} 帧图片！`, 'success')

    setTimeout(() => {
      dom.frameProgress.classList.remove('active')
    }, 3000)

  } catch (err) {
    console.error(err)
    showToast(`导出失败: ${err.message}`, 'error')
    dom.frameProgress.classList.remove('active')
  } finally {
    state.isExporting = false
    state.isPlaying = false
    dom.btnExportFrames.disabled = false
    // 恢复显示画布
    dom.video.currentTime = 0
    dom.video.addEventListener('seeked', () => processFrame(), { once: true })
  }
}

// ============================================================
//  ZIP 打包（动态加载 JSZip）
// ============================================================
let jsZipLoaded = false

async function ensureJSZip() {
  if (jsZipLoaded && window.JSZip) return true
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js')
    jsZipLoaded = true
    return true
  } catch {
    return false
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function createZip(files) {
  const hasZip = await ensureJSZip()
  if (hasZip) {
    const zip = new JSZip()
    for (const file of files) {
      zip.file(file.name, file.blob)
    }
    return await zip.generateAsync({ type: 'blob' })
  }
  // 降级方案：如果 JSZip 加载失败，逐个下载
  for (const file of files) {
    downloadBlob(file.blob, file.name)
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

// ============================================================
//  工具函数
// ============================================================
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

let toastTimer = null
function showToast(message, type = '') {
  clearTimeout(toastTimer)
  dom.toast.textContent = message
  dom.toast.className = `toast ${type} show`
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show')
  }, 3000)
}

function resetParams() {
  // 色度键控参数
  state.tolerance = 40
  state.feather = 15
  state.spillStrength = 60
  state.spillSuppress = true
  state.colorSpace = 'auto'

  dom.toleranceSlider.value = 40
  dom.toleranceValue.textContent = '40'
  dom.featherSlider.value = 15
  dom.featherValue.textContent = '15'
  dom.spillStrengthSlider.value = 60
  dom.spillStrengthValue.textContent = '60'
  dom.spillToggle.classList.add('active')
  dom.bgPreviewSelect.value = 'checker'
  dom.colorSpaceSelect.value = 'auto'

  // AI参数
  state.aiThreshold = 0.5
  state.aiSmooth = 3
  dom.aiThresholdSlider.value = 50
  dom.aiThresholdValue.textContent = '0.50'
  dom.aiSmoothSlider.value = 3
  dom.aiSmoothValue.textContent = '3'
  dom.aiBgPreviewSelect.value = 'checker'

  // 差分参数
  state.diffThreshold = 25
  state.diffFeather = 10
  dom.diffThresholdSlider.value = 25
  dom.diffThresholdValue.textContent = '25'
  dom.diffFeatherSlider.value = 10
  dom.diffFeatherValue.textContent = '10'
  dom.diffBgPreviewSelect.value = 'checker'

  // 重新自动选择颜色空间
  if (state.bgColor) {
    autoSelectColorSpace()
  }

  if (!state.isPlaying) processFrame()
  showToast('参数已重置', 'success')
}

// ============================================================
//  启动
// ============================================================
init()
