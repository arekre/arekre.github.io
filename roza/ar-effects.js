const AR_CONFIG = Object.freeze({
  interval: 1000,
  batch: 12,
  maxPetals: 48,
  lifetime: 3.2
});

class RosaAR {
  constructor(targetEl) {
    this.targetEl = targetEl; // MindARのターゲットエンティティ
    this.running = false;
    this.particles = [];
    this.lastTime = 0;
    this.lastBurst = -Infinity;

    // 花びらの3D形状作成
    const shape = new THREE.Shape();
    shape.moveTo(0, -.6);
    shape.bezierCurveTo(-.65, -.15, -.6, .6, -.12, .48);
    shape.bezierCurveTo(.05, .36, .27, .65, .48, .38);
    shape.bezierCurveTo(.7, .02, .2, -.42, 0, -.6);
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
    this.geometry.computeVertexNormals();

    this.group = new THREE.Group();
    this.targetEl.object3D.add(this.group);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.lastBurst = -Infinity;
    this.loop(this.lastTime);
  }

  burst(now) {
    if (now - this.lastBurst < AR_CONFIG.interval) return;
    this.lastBurst = now;

    for (let i = 0; i < AR_CONFIG.batch && this.particles.length < AR_CONFIG.maxPetals; i++) {
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      const angle = Math.random() * Math.PI * 2;
      const speed = .3 + Math.random() * .55;

      mesh.scale.setScalar(.12 + Math.random() * .16);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, angle);

      this.group.add(mesh);
      this.particles.push({
        mesh,
        age: 0,
        angle,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: .6 + Math.random() * .6
      });
    }
  }

  clear() {
    for (const p of this.particles) {
      this.group.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.particles.length = 0;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.clear();
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, .05);
    this.lastTime = now;

    // ターゲットが見えているときに花びらを発生
    if (this.targetEl.object3D.visible) {
      this.burst(now);
    } else {
      this.clear();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= AR_CONFIG.lifetime) {
        this.group.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.mesh.position.set(
        p.vx * p.age + Math.sin(p.age * 3 + p.angle) * .1,
        p.vy * p.age - .22 * p.age * p.age,
        p.vz * p.age
      );
      p.mesh.rotation.x += dt;
      p.mesh.rotation.z += dt * .8;
      p.mesh.material.opacity = Math.min(1, p.age * 5, (AR_CONFIG.lifetime - p.age) * 2);
    }

    this.raf = requestAnimationFrame(time => this.loop(time));
  }
}