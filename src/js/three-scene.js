export class ThreeScene {
  constructor(canvas) {
    this._canvas = canvas; this._renderer = null; this._scene = null;
    this._camera = null; this._animId = null; this._clock = null; this._cellGroup = null;
  }

  init() {
    if (!window.THREE) { console.warn('[ThreeScene] THREE.js not loaded.'); return; }
    const THREE = window.THREE;
    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(this._canvas.offsetWidth, this._canvas.offsetHeight);
    this._scene = new THREE.Scene();
    this._clock = new THREE.Clock();
    this._camera = new THREE.PerspectiveCamera(45, this._canvas.offsetWidth / this._canvas.offsetHeight, 0.1, 100);
    this._camera.position.set(0, 0, 8);
    const ambient = new THREE.AmbientLight(0x203060, 0.8);
    const p1 = new THREE.PointLight(0x4080ff, 1.2, 20); p1.position.set(3, 4, 3);
    const p2 = new THREE.PointLight(0x00ffaa, 0.6, 15); p2.position.set(-4, -2, 2);
    this._scene.add(ambient, p1, p2);
    this._buildCell(THREE);
    window.addEventListener('resize', () => this._onResize());
    console.log('[ThreeScene] Initialized.');
  }

  _buildCell(THREE) {
    this._cellGroup = new THREE.Group();
    // 细胞膜
    this._cellGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 48, 48),
      new THREE.MeshPhongMaterial({ color: 0x2255aa, transparent: true, opacity: 0.12, side: THREE.DoubleSide, shininess: 60 })
    ));
    // 膜线框
    this._cellGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(3.22, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x4488ff, wireframe: true, transparent: true, opacity: 0.06 })
    ));
    // 细胞核
    const nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 32, 32),
      new THREE.MeshPhongMaterial({ color: 0xaa4488, transparent: true, opacity: 0.55, shininess: 80 })
    );
    nucleus.position.set(0.2, 0.1, 0);
    this._cellGroup.add(nucleus);
    // 核膜
    this._cellGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xdd88cc, wireframe: true, transparent: true, opacity: 0.18 })
    ));
    // 线粒体
    [[1.8,0.8,0.5],[-1.5,1.2,-0.3],[0.8,-1.8,0.7],[-1.9,-0.5,0.8],[1.2,-0.6,-1.5],[-0.6,1.6,1.0]].forEach(([x,y,z]) => {
      const geo = new THREE.SphereGeometry(0.18, 10, 8);
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.45, 0.45));
      const mito = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x00dd88, transparent: true, opacity: 0.6, shininess: 40 }));
      mito.position.set(x, y, z);
      mito.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      this._cellGroup.add(mito);
    });
    // 胞质粒子
    const n = 200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2.8, t = Math.random() * Math.PI * 2, p = Math.acos(2*Math.random()-1);
      pos[i*3] = r*Math.sin(p)*Math.cos(t); pos[i*3+1] = r*Math.sin(p)*Math.sin(t); pos[i*3+2] = r*Math.cos(p);
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._cellGroup.add(new THREE.Points(ptGeo, new THREE.PointsMaterial({ color: 0x88aaff, size: 0.04, transparent: true, opacity: 0.5 })));
    this._scene.add(this._cellGroup);
  }

  startLoop() {
    if (!this._renderer) return;
    const animate = () => {
      this._animId = requestAnimationFrame(animate);
      const t = this._clock.getElapsedTime();
      if (this._cellGroup) { this._cellGroup.rotation.y = t * 0.05; this._cellGroup.rotation.x = Math.sin(t*0.02)*0.08; }
      this._renderer.render(this._scene, this._camera);
    };
    animate();
  }

  stopLoop() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

  _onResize() {
    if (!this._renderer || !this._canvas) return;
    const w = this._canvas.offsetWidth, h = this._canvas.offsetHeight;
    this._camera.aspect = w / h; this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }
}
