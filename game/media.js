/* Photo and AR share a single capture session. No images/video are uploaded. */
const media = (() => {
  const $ = id => document.getElementById(id);
  const session = new RosaCamera.CameraSession(navigator.mediaDevices);
  let mode = 'idle', facing = 'user', mirror = true, busy = false, operation = 0, photoURL;
  const photo = $('camera-feed'), game = $('game-feed'), frame = $('frame-overlay');
  const shutter = $('shutter-btn'), switcher = $('switch-camera-btn');
  let ar = null;
  function message(text) { $('media-status').textContent = text; }
  function ready() {
    return mode === 'photo' && !busy && !!session.stream && photo.readyState >= 2 && photo.videoWidth > 0 && frame.complete && frame.naturalWidth > 0;
  }
  function controls() { shutter.disabled = !ready(); switcher.disabled = busy || mode !== 'photo'; }
  function stopCapture() {
    operation++; busy = false; session.stop(); ar?.stop();
    photo.srcObject = null; game.srcObject = null; controls();
  }
  async function attach(video, stream, ticket) {
    video.srcObject = stream;
    await video.play();
    if (ticket !== operation) throw new DOMException('Cancelled', 'AbortError');
    if (video.readyState >= 2 && video.videoWidth) return;
    await new Promise((resolve, reject) => {
      const done = () => { if (video.readyState >= 2 && video.videoWidth) { cleanup(); resolve(); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('映像を取得できませんでした。再試行してください。')); }, 10000);
      function cleanup() { clearTimeout(timer); video.removeEventListener('loadeddata', done); }
      video.addEventListener('loadeddata', done); done();
    });
    if (ticket !== operation) throw new DOMException('Cancelled', 'AbortError');
  }
  async function openPhotoCamera(next = facing, exact = false) {
    if (busy) return;
    if (document.hidden) { message('カメラを停止しています。画面に戻って「再試行」を押してください。'); return; }
    busy = true; controls(); const ticket = ++operation; const previous = facing;
    message('カメラを準備しています…');
    try {
      let stream;
      try { stream = await session.open(next, exact); }
      catch (error) {
        if (ticket !== operation) return;
        if (!exact || error.name === 'NotAllowedError') throw error;
        stream = await session.open(previous);
        next = previous;
        message('切り替え先を利用できないため、元のカメラに戻しました。');
      }
      if (ticket !== operation) return;
      await attach(photo, stream, ticket);
      const actual = stream.getVideoTracks()[0].getSettings().facingMode;
      facing = actual || next; mirror = facing === 'user';
      photo.style.transform = mirror ? 'scaleX(-1)' : 'none';
      switcher.textContent = facing === 'user' ? 'アウトカメラへ' : 'インカメラへ';
      if ($('media-status').textContent === 'カメラを準備しています…') message('');
      if (frame.complete && !frame.naturalWidth) message('フレームを読み込めません。「再試行」を押してください。');
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (session.stream === stream) { stopCapture(); message('カメラが停止しました。「再試行」で再開できます。'); }
      });
    } catch (error) {
      if (ticket === operation) { session.stop(); photo.srcObject = null; message(RosaCamera.cameraError(error)); }
    } finally { if (ticket === operation) { busy = false; controls(); } }
  }
  function fitPhoto() {
    const box = $('photo-area').getBoundingClientRect();
    const ratio = 1027 / 1180;
    const width = Math.min(box.width, box.height * ratio);
    $('photo-stage').style.width = `${width}px`;
    $('photo-stage').style.height = `${width / ratio}px`;
  }
  async function openPhoto() {
    stopCapture(); mode = 'photo';
    document.querySelector('a-scene').pause();
    $('game-camera').hidden = true; $('ar-toggle').hidden = true;
    $('photo-screen').style.display = 'flex'; $('media-status').style.zIndex = '210';
    fitPhoto(); await openPhotoCamera('user');
  }
  async function startAR() {
    if (busy || mode === 'photo' || document.hidden) return;
    busy = true; mode = 'ar'; const ticket = ++operation;
    $('ar-toggle').disabled = true; message('カメラを準備しています…');
    try {
      const stream = await session.open('environment');
      if (ticket !== operation) return;
      await attach(game, stream, ticket);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (session.stream === stream) {
          stopCapture(); mode = 'idle'; $('game-camera').hidden = true;
          $('ar-toggle').disabled = false; $('ar-toggle').textContent = 'ARを開始';
          message('カメラが停止しました。「ARを開始」で再試行できます。');
        }
      });
      $('game-camera').hidden = false;
      if (!ar) ar = new RosaAR(game, $('marker-canvas'));
      await ar.start();
      if (ticket !== operation) return;
      message(''); $('ar-toggle').textContent = 'ARを停止';
    } catch (error) {
      if (ticket === operation) { stopCapture(); mode = 'idle'; $('game-camera').hidden = true; message(RosaCamera.cameraError(error)); }
    } finally { if (mode !== 'photo') { busy = false; $('ar-toggle').disabled = false; } }
  }
  $('ar-toggle').addEventListener('click', () => {
    if (mode === 'ar') { stopCapture(); mode = 'idle'; $('game-camera').hidden = true; $('ar-toggle').textContent = 'ARを開始'; message(''); }
    else startAR();
  });
  switcher.addEventListener('click', () => openPhotoCamera(facing === 'user' ? 'environment' : 'user', true));
  $('retry-camera-btn').addEventListener('click', () => {
    if (!frame.complete || !frame.naturalWidth) frame.src = `frame.svg?retry=${Date.now()}`;
    openPhotoCamera();
  });
  $('finish-photo-btn').addEventListener('click', () => {
    stopCapture(); mode = 'idle'; $('preview-modal').style.display = 'none';
    if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
    $('photo-screen').style.display = 'none'; $('end-screen').hidden = false; message('');
  });
  $('restart-btn').addEventListener('click', () => location.reload());
  for (const event of ['loadeddata', 'playing', 'emptied', 'waiting']) photo.addEventListener(event, controls);
  frame.addEventListener('load', controls);
  frame.addEventListener('error', () => { controls(); message('フレームを読み込めません。「再試行」を押してください。'); });
  shutter.addEventListener('click', async () => {
    if (!ready()) return;
    busy = true; controls(); const ticket = operation;
    try {
      const canvas = $('photo-canvas'); canvas.width = 1027; canvas.height = 1180;
      const ctx = canvas.getContext('2d');
      const crop = RosaCamera.coverCrop(photo.videoWidth, photo.videoHeight, canvas.width, canvas.height);
      ctx.save(); if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(photo, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height); ctx.restore();
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (ticket !== operation) return;
      if (!blob) throw new Error('写真を作成できませんでした。');
      if (photoURL) URL.revokeObjectURL(photoURL);
      photoURL = URL.createObjectURL(blob); $('captured-image').src = photoURL; $('save-photo').href = photoURL;
      $('preview-modal').style.display = 'flex'; $('close-preview-btn').focus();
    } catch (error) { message(error.message); }
    finally { if (ticket === operation) { busy = false; controls(); } }
  });
  $('close-preview-btn').addEventListener('click', () => { $('preview-modal').style.display = 'none'; shutter.focus(); });
  window.addEventListener('resize', fitPhoto);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopCapture(); $('ar-toggle').disabled = false; $('ar-toggle').textContent = 'ARを開始'; if (mode === 'ar') mode = 'idle'; $('game-camera').hidden = true; message('カメラを停止しました。再開するにはAR開始または再試行を押してください。'); }
  });
  window.addEventListener('pagehide', stopCapture);
  return { openPhoto, startAR, stop: stopCapture };
})();
