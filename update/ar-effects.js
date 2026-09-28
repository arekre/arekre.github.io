/* Replace patternUrl with the final pattern marker when supplied. */
const AR_CONFIG = Object.freeze({ patternUrl: 'assets/patt.hiro', cameraParametersUrl: 'assets/camera_para.dat',
  interval: 1000, batch: 12, maxPetals: 48, lifetime: 3.2 });
class RosaAR {
  constructor(video, canvas) {
    this.video = video; this.canvas = canvas; this.running = false; this.particles = []; this.generation = 0;
    this.scene = new THREE.Scene(); this.camera = new THREE.Camera(); this.scene.add(this.camera);
    this.marker = new THREE.Group(); this.scene.add(this.marker);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    // A small curved petal mesh, rather than copying a marked-up reference image.
    const shape = new THREE.Shape();
    shape.moveTo(0, -.6); shape.bezierCurveTo(-.65, -.15, -.6, .6, -.12, .48);
    shape.bezierCurveTo(.05, .36, .27, .65, .48, .38); shape.bezierCurveTo(.7, .02, .2, -.42, 0, -.6);
    this.geometry = new THREE.ShapeGeometry(shape, 8);
    const position = this.geometry.attributes.position;
    const colors = [];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      position.setZ(i, .25 * x * x + .15 * y * y);
      const color = new THREE.Color().lerpColors(new THREE.Color('#d87399'), new THREE.Color('#ffe3de'), (y + .6) / 1.2);
      colors.push(color.r, color.g, color.b);
    }
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals(); this.lastBurst = -Infinity;
  }
  async start() {
    this.stop();
    const generation = this.generation;
    if (!window.THREEx) throw new Error('ARライブラリを読み込めませんでした。');
    if (!this.initializing) {
      this.initializing = this.init().catch(error => { this.initializing = null; throw error; });
    }
    await this.initializing;
    if (generation !== this.generation) return;
    this.running = true; this.lastTime = performance.now(); this.lastBurst = -Infinity;
    this.loop(this.lastTime);
  }
  async init() {
    // Preflight reports missing files rather than silently waiting for marker detection.
    for (const url of [AR_CONFIG.patternUrl, AR_CONFIG.cameraParametersUrl]) {
      const response = await fetch(url); if (!response.ok) throw new Error('マーカーデータを読み込めませんでした。');
    }
    this.context = new THREEx.ArToolkitContext({ detectionMode: 'mono', cameraParametersUrl: AR_CONFIG.cameraParametersUrl,
      canvasWidth: 640, canvasHeight: 480, maxDetectionRate: 30 });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ARの準備がタイムアウトしました。再試行してください。')), 20000);
      this.context.init(() => { clearTimeout(timeout); resolve(); });
    });
    this.camera.projectionMatrix.copy(this.context.getProjectionMatrix());
    this.controls = new THREEx.ArMarkerControls(this.context, this.marker, { type: 'pattern', patternUrl: AR_CONFIG.patternUrl, size: 1 });
  }
  burst(now) {
    if (now - this.lastBurst < AR_CONFIG.interval) return;
    this.lastBurst = now;
    for (let i = 0; i < AR_CONFIG.batch && this.particles.length < AR_CONFIG.maxPetals; i++) {
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(this.geometry, material);
      const angle = Math.random() * Math.PI * 2, speed = .3 + Math.random() * .55;
      mesh.scale.setScalar(.12 + Math.random() * .16); mesh.rotation.set(Math.random()*3, Math.random()*3, angle);
      this.marker.add(mesh);
      this.particles.push({ mesh, age: 0, angle, vx: Math.cos(angle)*speed, vz: Math.sin(angle)*speed, vy: .6 + Math.random()*.6 });
    }
  }
  clear() { for (const p of this.particles) { this.marker.remove(p.mesh); p.mesh.material.dispose(); } this.particles.length = 0; }
  stop() { this.generation++; this.running = false; cancelAnimationFrame(this.raf); this.clear(); this.renderer.clear(); }
  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, .05); this.lastTime = now;
    if (this.video.readyState >= 2) {
      this.context.update(this.video);
      if (this.marker.visible) this.burst(now); else this.clear();
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]; p.age += dt;
        if (p.age >= AR_CONFIG.lifetime) { this.marker.remove(p.mesh); p.mesh.material.dispose(); this.particles.splice(i, 1); continue; }
        p.mesh.position.set(p.vx*p.age + Math.sin(p.age*3+p.angle)*.1, p.vy*p.age-.22*p.age*p.age, p.vz*p.age);
        p.mesh.rotation.x += dt; p.mesh.rotation.z += dt * .8;
        p.mesh.material.opacity = Math.min(1, p.age*5, (AR_CONFIG.lifetime-p.age)*2);
      }
      // Detector maps the full source onto its 640x480 processing image.
      // Stretch rendering back to source aspect, then apply the same cover crop as video.
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      const scale = Math.max(innerWidth/vw, innerHeight/vh);
      const width = vw*scale, height = vh*scale;
      if (this.canvas.width !== 640) this.renderer.setSize(640, 480, false);
      this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
      this.canvas.style.left = `${(innerWidth-width)/2}px`; this.canvas.style.top = `${(innerHeight-height)/2}px`;
      this.renderer.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(time => this.loop(time));
  }
}
