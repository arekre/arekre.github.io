/* MindAR 1.2.5 Controller: use the existing CameraSession and A-Frame THREE. */
const AR_CONFIG = Object.freeze({ imageTargetSrc: 'targets.mind', targetIndex: 0,
  interval: 1000, batch: 12, maxPetals: 48, lifetime: 3.2 });
class RosaAR {
  constructor(video, canvas) {
    this.video = video; this.canvas = canvas; this.running = false; this.particles = []; this.generation = 0;
    this.scene = new THREE.Scene(); this.camera = new THREE.Camera(); this.scene.add(this.camera);
    this.anchor = new THREE.Group(); this.anchor.matrixAutoUpdate = false; this.scene.add(this.anchor);
    this.marker = new THREE.Group(); this.marker.rotation.x = Math.PI / 2;
    this.marker.visible = false; this.anchor.add(this.marker);
    this.input = document.createElement('canvas'); this.input.width = 640; this.input.height = 480;
    this.inputContext = this.input.getContext('2d');
    this.pending = Promise.resolve(); this.detectedFrames = 0; this.missedFrames = 0;
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
    if (!this.initializing) this.initializing = this.init().catch(error => { this.initializing = null; throw error; });
    await this.initializing;
    await this.pending; // Let an old worker request finish before reusing the controller.
    if (generation !== this.generation) return;
    this.transform = null; this.detectedFrames = 0; this.missedFrames = 0;
    this.running = true; this.lastTime = performance.now(); this.lastBurst = -Infinity;
    this.trackFrame(generation);
    this.loop(this.lastTime);
  }
  async init() {
    // Keep Three.js and camera ownership with the existing game. No second camera or scan UI.
    const { Controller } = await import('./assets/mindar-image-1.2.5.prod.js');
    const response = await fetch(AR_CONFIG.imageTargetSrc, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('targets.mindを読み込めませんでした。ファイルの配置を確認してください。');
    const buffer = await response.arrayBuffer();
    if (!this.controller) this.controller = new Controller({ inputWidth: 640, inputHeight: 480, maxTrack: 1 });
    const { dimensions } = this.controller.addImageTargetsFromBuffer(buffer);
    const dimensionsForTarget = dimensions[AR_CONFIG.targetIndex];
    if (!dimensionsForTarget) throw new Error('targets.mindに指定された画像番号がありません。');
    const [width, height] = dimensionsForTarget;
    // MindAR stores poses in target-image pixels. Normalize width to 1, centered on the image.
    this.targetMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(width / 2, height / 2, 0), new THREE.Quaternion(), new THREE.Vector3(width, width, width));
    this.camera.projectionMatrix.fromArray(this.controller.getProjectionMatrix());
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.inputContext.drawImage(this.video, 0, 0, 640, 480);
    this.controller.dummyRun(this.input);
  }
  trackFrame(generation) {
    if (!this.running || generation !== this.generation) return;
    // Serialize detect/match/track: no outstanding worker result can revive a stopped AR session.
    this.pending = (async () => {
      if (this.video.readyState < 2) return;
      this.inputContext.drawImage(this.video, 0, 0, 640, 480);
      let transform = this.transform;
      if (transform) {
        const features = await this.controller.track(this.input, transform, AR_CONFIG.targetIndex);
        transform = await this.controller.trackUpdate(transform, features);
      } else {
        const { featurePoints } = await this.controller.detect(this.input);
        ({ modelViewTransform: transform } = await this.controller.match(featurePoints, AR_CONFIG.targetIndex));
      }
      if (!this.running || generation !== this.generation) return;
      this.transform = transform;
      if (transform) {
        this.detectedFrames++; this.missedFrames = 0;
        this.anchor.matrix.fromArray(this.controller.getWorldMatrix(transform, AR_CONFIG.targetIndex)).multiply(this.targetMatrix);
        this.anchor.matrixWorldNeedsUpdate = true;
        if (this.detectedFrames >= 5) this.marker.visible = true;
      } else {
        this.detectedFrames = 0; this.missedFrames++;
        if (this.missedFrames >= 5) { this.marker.visible = false; this.clear(); }
      }
    })().catch(error => {
      if (generation !== this.generation) return;
      this.stop();
      this.video.dispatchEvent(new CustomEvent('rosa-ar-error', { detail: error }));
    }).finally(() => {
      if (this.running && generation === this.generation) this.trackingTimer = setTimeout(() => this.trackFrame(generation), 33);
    });
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
  stop() { this.generation++; this.running = false; clearTimeout(this.trackingTimer); cancelAnimationFrame(this.raf); this.marker.visible = false; this.clear(); this.renderer.clear(); }
  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, .05); this.lastTime = now;
    if (this.video.readyState >= 2) {
      if (this.marker.visible) this.burst(now); else this.clear();
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]; p.age += dt;
        if (p.age >= AR_CONFIG.lifetime) { this.marker.remove(p.mesh); p.mesh.material.dispose(); this.particles.splice(i, 1); continue; }
        p.mesh.position.set(p.vx*p.age + Math.sin(p.age*3+p.angle)*.1, p.vy*p.age-.22*p.age*p.age, p.vz*p.age);
        p.mesh.rotation.x += dt; p.mesh.rotation.z += dt * .8;
        p.mesh.material.opacity = Math.min(1, p.age*5, (AR_CONFIG.lifetime-p.age)*2);
      }
      // MindAR analyzes the full source on a 640x480 processing image.
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
