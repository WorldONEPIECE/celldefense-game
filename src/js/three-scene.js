/**
 * ThreeScene — Three.js 背景场景
 *
 * Phase 1A：静态细胞3D背景，半透明渲染在canvas后层。
 * Phase 1C T15：关键动作触发的5-8秒镜头动画。
 *
 * 动画类型（triggerAnimation(type) 外部调用）：
 *   'innate'       — 先天免疫感应卡：相机推进 + 细胞脉冲放大 + Y轴加速旋转
 *   'attack'       — 效应/杀伤卡：相机猛推进 + 细胞X轴震颤
 *   'metabolic'    — 代谢/修复卡：相机拉远 + 细胞温和脉冲
 *   'viral_attack' — 病毒回合行动：细胞XY轴震动（指数衰减）+ 相机微推
 *   'overload'     — 病毒载量过载：相机+细胞双重剧烈震动 + Y轴快速旋转
 *   'victory'      — 胜利：相机缓慢拉远 + 细胞慢速放大旋转
 *   'default'      — 其余卡：轻微推拉
 *
 * 场景内容：
 *   - 半透明细胞球体（细胞膜）
 *   - 细胞核球体（内层）
 *   - 线粒体椭球（随机分布）
 *   - 粒子系统（胞质溶胶）
 *   - 慢速旋转 idle 动画
 */

export class ThreeScene {
  constructor(canvas) {
    this._canvas    = canvas;
    this._renderer  = null;
    this._scene     = null;
    this._camera    = null;
    this._animId    = null;
    this._clock     = null;
    this._cellGroup = null;
    this._anim      = null;
  }

  triggerAnimation(type) {
    if (!this._renderer) return;
    const DURATIONS = {
      innate: 5.5, attack: 6.0, metabolic: 5.0,
      viral_attack: 5.0, overload: 6.0, victory: 8.0, default: 5.0,
    };
    this._anim = { type, startElapsed: this._clock.elapsedTime, duration: DURATIONS[type] ?? 5.0 };
    console.log(`[ThreeScene] Animation start: ${type} (${DURATIONS[type] ?? 5}s)`);
  }

  init() {
    if (!window.THREE) { console.warn('[ThreeScene] THREE.js not loaded, skipping 3D init.'); return; }
    const THREE = window.THREE;
    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(this._canvas.offsetWidth, this._canvas.offsetHeight);
    this._scene = new THREE.Scene();
    this._clock = new THREE.Clock();
    this._camera = new THREE.PerspectiveCamera(45, this._canvas.offsetWidth / this._canvas.offsetHeight, 0.1, 100);
    this._camera.position.set(0, 0, 8);
    const ambient = new THREE.AmbientLight(0x203060, 0.8);
    const point   = new THREE.PointLight(0x4080ff, 1.2, 20);
    point.position.set(3, 4, 3);
    const point2  = new THREE.PointLight(0x00ffaa, 0.6, 15);
    point2.position.set(-4, -2, 2);
    this._scene.add(ambient, point, point2);
    this._buildCell(THREE);
    window.addEventListener('resize', () => this._onResize());
    console.log('[ThreeScene] Initialized.');
  }

  _buildCell(THREE) {
    this._cellGroup = new THREE.Group();
    const membraneGeo = new THREE.SphereGeometry(3.2, 48, 48);
    const membraneMat = new THREE.MeshPhongMaterial({ color: 0x2255aa, transparent: true, opacity: 0.12, side: THREE.DoubleSide, shininess: 60 });
    this._cellGroup.add(new THREE.Mesh(membraneGeo, membraneMat));
    const wireGeo = new THREE.SphereGeometry(3.22, 20, 16);
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, wireframe: true, transparent: true, opacity: 0.06 });
    this._cellGroup.add(new THREE.Mesh(wireGeo, wireMat));
    const nucleusGeo = new THREE.SphereGeometry(1.1, 32, 32);
    const nucleusMat = new THREE.MeshPhongMaterial({ color: 0xaa4488, transparent: true, opacity: 0.55, shininess: 80 });
    const nucleus = new THREE.Mesh(nucleusGeo, nucleusMat);
    nucleus.position.set(0.2, 0.1, 0);
    this._cellGroup.add(nucleus);
    const nuclearEnvGeo = new THREE.SphereGeometry(1.18, 24, 24);
    const nuclearEnvMat = new THREE.MeshBasicMaterial({ color: 0xdd88cc, wireframe: true, transparent: true, opacity: 0.18 });
    this._cellGroup.add(new THREE.Mesh(nuclearEnvGeo, nuclearEnvMat));
    [[1.8,0.8,0.5],[-1.5,1.2,-0.3],[0.8,-1.8,0.7],[-1.9,-0.5,0.8],[1.2,-0.6,-1.5],[-0.6,1.6,1.0]].forEach(([x,y,z]) => {
      const geo = new THREE.SphereGeometry(0.18, 10, 8);
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.45, 0.45));
      const mat = new THREE.MeshPhongMaterial({ color: 0x00dd88, transparent: true, opacity: 0.6, shininess: 40 });
      const mito = new THREE.Mesh(geo, mat);
      mito.position.set(x, y, z);
      mito.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      this._cellGroup.add(mito);
    });
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = Math.random() * 2.8, theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
      positions[i*3] = r*Math.sin(phi)*Math.cos(theta); positions[i*3+1] = r*Math.sin(phi)*Math.sin(theta); positions[i*3+2] = r*Math.cos(phi);
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const ptMat = new THREE.PointsMaterial({ color: 0x88aaff, size: 0.04, transparent: true, opacity: 0.5 });
    this._cellGroup.add(new THREE.Points(ptGeo, ptMat));
    this._scene.add(this._cellGroup);
  }

  startLoop() {
    if (!this._renderer) return;
    const animate = () => {
      this._animId = requestAnimationFrame(animate);
      const elapsed = this._clock.getElapsedTime();
      if (this._cellGroup) {
        if (this._anim) {
          const t = Math.min((elapsed - this._anim.startElapsed) / this._anim.duration, 1);
          this._tickAnim(t, elapsed);
          if (t >= 1) this._finishAnim();
        } else {
          this._cellGroup.rotation.y = elapsed * 0.05;
          this._cellGroup.rotation.x = Math.sin(elapsed * 0.02) * 0.08;
          this._camera.position.z = 8;
        }
      }
      this._renderer.render(this._scene, this._camera);
    };
    animate();
  }

  stopLoop() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

  _tickAnim(t, elapsed) {
    const g = this._cellGroup, c = this._camera;
    const easeInOut = x => x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x+2, 2)/2;
    const baseRotY = elapsed * 0.05, baseRotX = Math.sin(elapsed * 0.02) * 0.08;
    switch (this._anim.type) {
      case 'innate': {
        c.position.z = 8 - 2.5 * Math.sin(t * Math.PI);
        g.scale.setScalar(1 + 0.14 * Math.sin(t * Math.PI));
        g.rotation.y = baseRotY + t * Math.PI * 1.8; g.rotation.x = baseRotX; break;
      }
      case 'attack': {
        c.position.z = 8 - 3.5 * easeInOut(Math.sin(t * Math.PI));
        g.position.x = (t > 0.15 && t < 0.75) ? Math.sin(t*120)*0.18*Math.sin(((t-0.15)/0.6)*Math.PI) : 0;
        g.rotation.y = baseRotY + t * Math.PI; g.rotation.x = baseRotX; break;
      }
      case 'metabolic': {
        c.position.z = 8 + 2.0 * Math.sin(t * Math.PI);
        g.scale.setScalar(1 + 0.07 * Math.sin(t * Math.PI * 2));
        g.rotation.y = baseRotY; g.rotation.x = baseRotX; break;
      }
      case 'viral_attack': {
        const decay = Math.exp(-t * 3.2);
        g.position.x = Math.sin(t*85)*0.22*decay; g.position.y = Math.sin(t*68+1)*0.12*decay;
        c.position.z = 8 - 1.6 * Math.sin(t * Math.PI);
        g.rotation.y = baseRotY; g.rotation.x = baseRotX; break;
      }
      case 'overload': {
        const decay = Math.exp(-t * 2.0);
        g.position.x = Math.sin(t*95)*0.28*decay; g.position.y = Math.sin(t*78+2)*0.16*decay;
        c.position.z = 8 - 4.0*Math.sin(t*Math.PI) + Math.sin(t*110)*0.06*decay;
        g.rotation.y = baseRotY + t*Math.PI*3.0; g.rotation.x = baseRotX + Math.sin(t*30)*0.08*decay; break;
      }
      case 'victory': {
        c.position.z = 8 + easeInOut(t) * 6.0;
        g.scale.setScalar(1 + easeInOut(t) * 0.12);
        g.rotation.y = baseRotY + t*Math.PI*2.5; g.rotation.x = Math.sin(elapsed*0.4)*0.25; break;
      }
      default: { c.position.z = 8 - 1.5*Math.sin(t*Math.PI); g.rotation.y = baseRotY; g.rotation.x = baseRotX; break; }
    }
  }

  _finishAnim() {
    console.log(`[ThreeScene] Animation complete: ${this._anim.type}`);
    this._anim = null;
    if (this._camera) this._camera.position.z = 8;
    if (this._cellGroup) { this._cellGroup.position.set(0,0,0); this._cellGroup.scale.setScalar(1); }
  }

  _onResize() {
    if (!this._renderer || !this._canvas) return;
    const w = this._canvas.offsetWidth, h = this._canvas.offsetHeight;
    this._camera.aspect = w / h; this._camera.updateProjectionMatrix(); this._renderer.setSize(w, h);
  }
}
